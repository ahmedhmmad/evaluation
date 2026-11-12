'use strict';
  /* ---------- الرواتب ----------
     «إعدادات الرواتب»: لكل شهر راتب كل موظف من «بيانات العاملين» وقواعد الدوام، في payroll_setup (supabase/payroll.sql).
     الشهر الذي لم تُحفظ له إعدادات يعتمد آخر شهر قبله حُفظت إعداداته؛ والحفظ يكتب إعدادات الشهر المعروض وحده.
     «حساب الرواتب»: من «دوام الموظفين» وقواعد الشهر: خصم الغياب والإجازات الزائدة والتأخير الزائد، وإضافات وخصومات يدوية،
     ثم يُعتمد الشهر فيُحفظ كشفه كما هو في payroll_runs، فلا يتغير لو عُدّل الدوام أو الراتب بعد ذلك. ومنه السليبات وكشف الرواتب.
     يصل إليهما المدير العام، ومن يعطيه صلاحية من حسابات المدير والمشرف (مشاهدة أو تعديل) في payroll_access */
  var PR_RULES = [
    ['late_days', 'أيام التأخير المسموح بها في الشهر', 'يوم', 1],
    ['late_hours', 'ساعات التأخير المسموح بها في الشهر', 'ساعة', 0.25],
    ['leave_days', 'أيام الإجازات المسموح بها في العام الدراسي', 'يوم', 1],
    ['leave_month', 'أيام الإجازات المسموح بها في الشهر', 'يوم', 1]
  ];
  var PR_LATE_MODES = { minutes: 'بالدقيقة: ما زاد عن الساعات المسموحة يُخصم بأجر الدقيقة', days: 'باليوم: كل يوم تأخير زائد عن الأيام المسموحة يُخصم منه جزء من أجر اليوم', both: 'الاثنان معًا: ما زاد عن الساعات المسموحة بالدقيقة، وكل يوم زاد عن الأيام المسموحة بجزء من أجر اليوم' };

  // صلاحية الرواتب: edit أو view أو ''
  function prLevel() { return isAdmin() ? 'edit' : isManager() ? S.prAccess || '' : ''; }
  function prCanEdit() { return prLevel() === 'edit' && !isReadOnly(); }

  function prState() {
    if (!ui.pr) ui.pr = { month: todayISO().slice(0, 7), sal: {}, rules: {}, chg: {}, busy: false, imp: null, acc: {} };
    if (!ui.pr.chg) ui.pr.chg = {};
    return ui.pr;
  }
  // العام الدراسي الذي فيه الشهر: من 1 سبتمبر إلى 30 يونيو
  function prSchoolYear(month) {
    var y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)), a = m >= 9 ? y : y - 1;
    return { from: a + '-09-01', to: (a + 1) + '-06-30' };
  }
  function prMonthEnd(month) { return month + '-' + String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()).padStart(2, '0'); }
  // إعدادات الشهر: المحفوظة له، وإلا آخر شهر قبله
  function prBase(month) {
    var rows = (S.pr && S.pr.rows) || [], hit = null;
    rows.forEach(function (r) { if (r.month <= month && (!hit || r.month > hit.month)) hit = r; });
    return hit;
  }
  function prRules(month, noDraft) {
    var b = prBase(month), sy = prSchoolYear(month);
    return Object.assign({ late_days: '', late_hours: '', leave_days: 6, leave_month: 2, leave_from: sy.from, leave_to: sy.to, work_days: 22, late_mode: 'minutes', late_fraction: 0.25, quran_in: '', quran_out: '10:00',
      signer_title: 'المشرف العام', signer_name: prDefaultSigner() },
      b ? b.rules || {} : {}, noDraft ? {} : prState().rules);
  }
  // الموقِّع على الرواتب افتراضيًا: صاحب حساب «مشرف عام» إن وُجد واحد
  function prDefaultSigner() {
    var g = (S.users || []).filter(function (u) { return roleKey(u) === 'gensup'; });
    return g.length === 1 ? g[0].full_name || '' : '';
  }
  function prSigns(P, first) {
    var R = P.rules || {}, list = first ? [first] : [['المحاسب', '']];
    list.push([R.signer_title || 'المشرف العام', R.signer_name || '']);
    return reportSigns(list);
  }
  // راتب الموظف في بداية الشهر، وتغييره خلاله إن وُجد: { from, amount }
  function prEff(month, id) {
    var b = prBase(month), v = b && b.salaries ? b.salaries[id] : null, c = b && b.changes ? b.changes[id] : null;
    if (c && c.from && c.from <= month + '-01') { v = c.amount; c = null; }        // تغيير سبق هذا الشهر: صار راتبه
    else if (c && c.from && c.from > prMonthEnd(month)) c = null;                   // تغيير بعد هذا الشهر
    return { salary: v == null ? null : Number(v), change: c };
  }
  function prSalary(id) {
    var st = prState();
    if (id in st.sal) return st.sal[id];
    var e = prEff(st.month, id);
    return e.salary == null ? '' : String(e.salary);
  }
  function prChange(id) {
    var st = prState();
    if (id in st.chg) return st.chg[id];
    var b = prBase(st.month), c = b && b.changes ? b.changes[id] : null;
    return c && c.from && c.from > st.month + '-01' ? { from: c.from, amount: String(c.amount) } : { from: '', amount: '' };
  }
  function prDirty() { var st = prState(); return Object.keys(st.sal).length + Object.keys(st.rules).length + Object.keys(st.chg || {}).length; }
  // العاملون في الشهر: من عُيّن قبل نهايته ولم ينته عقده قبل بدايته، ومعهم من له راتب محفوظ
  function prStaff(month) {
    var first = month + '-01', last = prMonthEnd(month), b = prBase(month);
    return saStaff('').filter(function (t) {
      var from = String(t.hire_date || '').slice(0, 10), to = String(t.contract_end || '').slice(0, 10);
      // من انتهى عقده قبل هذا الشهر لا يظهر فيه ولو بقي راتبه في إعدادات شهر سابق
      if (to && to < first) return false;
      return ((!from || from <= last) && (!to || to >= first)) || (b && ((b.salaries && b.salaries[t.id] != null) || (b.changes && b.changes[t.id])));
    });
  }
  function prNum(v) { var n = Number(latinDigits(String(v == null ? '' : v)).replace(/[,،\s]/g, '')); return isFinite(n) ? n : NaN; }
  function prMoney(x) { return (Math.round((Number(x) || 0) * 100) / 100).toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }

  var loadingPr = false;
  async function loadPr() {
    if (loadingPr) return;
    loadingPr = true;
    var r = await Promise.all([
      sb.from('payroll_setup').select('*').order('month'),
      sb.from('payroll_runs').select('*').order('month'),
      isAdmin() ? sb.from('payroll_access').select('*') : Promise.resolve({ data: [] }),
      !isManager() ? Promise.resolve({ data: null }) : sb.from('payroll_access').select('can_edit').eq('user_id', S.uid).maybeSingle()
    ]);
    loadingPr = false;
    if (isManager()) {
      S.prAccess = r[3].data ? (r[3].data.can_edit ? 'edit' : 'view') : '';
      if (!S.prAccess) { S.pr = null; renderSide(); return go('#/'); }
      renderSide();
    }
    var runs = {};
    (r[1].data || []).forEach(function (x) { runs[x.month] = x; });
    S.pr = { rows: r[0].data || [], missing: !!r[0].error, runs: runs, runsMissing: !!r[1].error, access: r[2].data || [], accessMissing: !!r[2].error };
    render();
  }

  function prHead(title, sub) {
    var note = isAdmin() || !S.pr ? '' : prCanEdit() ? '' : prLevel() === 'edit'
      ? '<p class="formhint">مُنح هذا الحساب تعديل الرواتب، لكنه حساب «جهة مشرفة» (مشاهدة وتصدير فقط في كل البرنامج)، فيبقى للمشاهدة. لتعديل الرواتب غيّر صلاحيته إلى «مدير» أو «مشرف عام».</p>'
      : '<p class="hint">صلاحيتك على الرواتب: مشاهدة (عرض وطباعة وتصدير).</p>';
    return '<div class="page-head"><div><h1>' + title + '</h1><p>' + sub + '</p>' + note + '</div></div>';
  }
  function prMissingHtml() {
    return '<div class="card empty">الرواتب تحتاج إلى جداول في قاعدة البيانات.<br>شغّل الملف <code dir="ltr">supabase/payroll.sql</code> في محرر SQL ثم حدّث الصفحة.</div>';
  }

  function renderPayroll() {
    var st = prState(), edit = prCanEdit(), dis = edit ? ' data-ro-mgr' : ' disabled';
    var head = prHead('إعدادات الرواتب', 'راتب كل موظف وقواعد الدوام لكل شهر. الشهر الذي لا تُحفظ إعداداته يعتمد أرقام آخر شهر قبله.');
    if (!S.pr) { app.innerHTML = head + '<div class="card empty">جارٍ التحميل…</div>'; loadPr(); return; }
    if (S.pr.missing) { app.innerHTML = head + prMissingHtml(); return; }
    var b = prBase(st.month), own = b && b.month === st.month, list = prStaff(st.month), R = prRules(st.month), dirty = prDirty();
    var src = own ? '<span class="badge paid">محفوظة لهذا الشهر</span>' + (b.updated_by ? ' <span class="hint" style="margin:0">' + esc(b.updated_by) + ' · ' + dmy(String(b.updated_at || '').slice(0, 10)) + '</span>' : '')
      : b ? '<span class="badge part">معتمدة من ' + esc(monthLabel(b.month)) + '</span> <span class="hint" style="margin:0">لم تُحفظ إعدادات لهذا الشهر' + (edit ? '؛ تُحفظ له عند «حفظ».' : '.') + '</span>'
      : '<span class="badge pending">لا توجد إعدادات بعد</span>';
    var run = S.pr.runs[st.month], locked = run && run.status === 'approved';
    var rows = list.map(function (t, i) {
      var v = prSalary(t.id), c = prChange(t.id), changed = t.id in st.sal || t.id in st.chg;
      return '<tr' + (changed ? ' style="background:#fffbeb"' : '') + '><td>' + (i + 1) + '</td>' +
        '<td><b>' + esc(t.name) + '</b><div class="hint" style="margin:0">' + esc(staffCat(t)) + (t.job_title ? ' · ' + esc(t.job_title) : '') + '</div></td>' +
        '<td><input type="text" inputmode="decimal" dir="ltr" data-prsal="' + t.id + '" value="' + esc(v) + '" placeholder="—" style="width:130px;text-align:right"' + dis + '></td>' +
        '<td><span style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">من <input type="date" data-prchg="' + t.id + '" data-k="from" value="' + esc(c.from) + '" style="width:auto"' + dis + '>' +
          ' يصبح <input type="text" inputmode="decimal" dir="ltr" data-prchg="' + t.id + '" data-k="amount" value="' + esc(c.amount) + '" placeholder="—" style="width:100px;text-align:right"' + dis + '></span></td></tr>';
    }).join('');
    var num = function (k, label, unit, step, hint) {
      return '<div><label class="field" for="pr-r-' + k + '">' + label + '</label><span style="display:flex;gap:6px;align-items:center"><input type="number" min="0" step="' + step + '" id="pr-r-' + k + '" data-prrule="' + k + '" value="' + esc(R[k]) + '" placeholder="بلا حد" style="width:120px"' + dis + '>' + unit + '</span>' + (hint ? '<div class="hint" style="margin:2px 0 0">' + hint + '</div>' : '') + '</div>';
    };
    var H = S.saHours || null, prTab = vtab('pr', 'sal');
    if (prTab === 'access' && !isAdmin()) prTab = 'sal';
    if (st.imp && edit) prTab = 'sal';
    app.innerHTML = head +
      '<div class="card"><div class="toolbar" style="align-items:center;margin:0">' +
        '<span class="monthpick"><label class="field" for="pr-month">الشهر</label><input type="month" id="pr-month" data-ro-ok value="' + st.month + '"></span>' + src +
        (locked ? ' <span class="badge paid">رواتب هذا الشهر معتمدة</span> <span class="hint" style="margin:0">تعديل الإعدادات لا يغيّر كشفه المعتمد.</span>' : '') + '</div></div>' +
      vtabsHtml('pr', 'sal', [['sal', 'رواتب الموظفين'], ['rules', 'قواعد الدوام والخصم']].concat(isAdmin() ? [['access', 'صلاحيات الرواتب']] : [])) +
      (st.imp && edit ? prImportHtml(list) : '') +
      (prTab !== 'rules' ? '' : '<div class="card"><h2>قواعد الدوام</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">' +
        '<div><label class="field" for="pr-r-work_days">أيام العمل في الشهر</label><span style="display:flex;gap:6px;align-items:center"><input type="number" min="1" max="31" step="1" id="pr-r-work_days" data-prrule="work_days" value="' + esc(R.work_days) + '" style="width:120px"' + dis + '>يوم</span>' +
          '<div class="hint" style="margin:2px 0 0">أجر اليوم = الراتب ÷ هذا العدد، في كل الشهور (العمل كل الأيام عدا الجمعة والسبت).</div></div>' +
        PR_RULES.map(function (r) { return num(r[0], r[1], r[2], r[3]); }).join('') +
        '<div><label class="field">فترة الإجازات (العام الدراسي)</label><span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">من <input type="date" data-prrule="leave_from" value="' + esc(R.leave_from) + '" style="width:auto"' + dis + '> إلى <input type="date" data-prrule="leave_to" value="' + esc(R.leave_to) + '" style="width:auto"' + dis + '></span></div>' +
      '</div>' +
      '<h3 style="margin:16px 0 6px">خصم التأخير الزائد</h3>' +
        Object.keys(PR_LATE_MODES).map(function (k) { return '<label style="display:block;margin:4px 0"><input type="radio" name="pr-latemode" data-prrule="late_mode" value="' + k + '"' + (R.late_mode === k ? ' checked' : '') + dis + '> ' + PR_LATE_MODES[k] + '</label>'; }).join('') +
        '<div style="margin:6px 0 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap"><label class="field" for="pr-r-late_fraction" style="margin:0">جزء اليوم المخصوم عن كل يوم تأخير زائد</label>' +
          '<select id="pr-r-late_fraction" data-prrule="late_fraction" style="width:auto"' + dis + '>' + [[0.25, 'ربع يوم'], [0.5, 'نصف يوم'], [1, 'يوم كامل']].map(function (o) { return '<option value="' + o[0] + '"' + (Number(R.late_fraction) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
      '<h3 style="margin:16px 0 6px">ساعات الدوام</h3>' +
        '<p class="hint" style="margin:0">من «دوام الموظفين» ← «مجموعات الدوام»: لكل موظف دوام مجموعته (8:00–12:30، 8:00–10:00…)، وبه يُحسب تأخيره وأجر ساعته. ' +
          (H ? 'الآن: الوقت الرسمي ' + H.time_in + '–' + H.time_out + ((H.groups || []).length ? '، و' + H.groups.map(function (g) { return esc(g.name) + ' ' + g.time_in + '–' + g.time_out; }).join('، ') : '، بلا مجموعات بعد') + '.' : '') + '</p>' +
      '<h3 style="margin:16px 0 6px">التوقيع على السليبات وكشف الرواتب</h3>' +
        '<span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">الصفة <input type="text" data-prrule="signer_title" value="' + esc(R.signer_title) + '" style="width:160px"' + dis + '>' +
        ' الاسم <input type="text" data-prrule="signer_name" value="' + esc(R.signer_name) + '" placeholder="اسم المشرف العام" style="width:220px"' + dis + '></span>' +
      '<p class="hint" style="margin:10px 0 0">الخانة الفارغة تعني بلا حد (لا خصم). الإجازات تراكمية عبر أشهر العام الدراسي (الفترة المحددة أعلاه)، فيُسمح بعدد أيام في العام وبحد أقصى في الشهر الواحد، وما زاد عن حد الشهر أو عن رصيد العام يُخصم من الراتب في شهره. أما أيام الغياب فتُخصم كل شهر. لا يُحسب الانصراف المبكر.</p></div>') +
      (edit && prTab !== 'access' ? '<div class="toolbar" style="align-items:center">' +
        '<button type="button" class="btn primary" data-prsave data-ro-mgr' + ((dirty || (!own && b)) && !st.busy ? '' : ' disabled') + '>' + (st.busy ? 'جارٍ الحفظ…' : 'حفظ إعدادات ' + esc(monthLabel(st.month)) + (dirty ? ' (' + dirty + ')' : '')) + '</button>' +
        (dirty ? '<button type="button" class="btn link" data-prcancel data-ro-mgr>تراجع عن غير المحفوظ</button>' : '') +
        (prTab === 'sal' ? '<button type="button" class="btn" data-primp data-ro-mgr>استيراد الرواتب من Excel</button>' : '') + '<input type="file" id="pr-file" accept=".xlsx,.xls,.csv" hidden>' + '</div>' : '') +
      (prTab !== 'sal' ? '' : '<div class="card">' + (list.length
        ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الموظف</th><th>الراتب (ج.م)</th><th>تغيير الراتب من تاريخ (اختياري)</th></tr></thead><tbody>' + rows + '</tbody>' +
          '<tfoot><tr><th colspan="2" style="text-align:right">مجموع الرواتب الشهرية</th><th id="pr-total" style="text-align:right"></th><th></th></tr></tfoot></table></div>' +
          '<p class="hint" style="margin:8px 0 0">تغيير الراتب خلال الشهر (مثل نصف نصاب ثم نصاب كامل): يُحسب الشهر بأيام العمل قبل التاريخ بالراتب القديم وبعده بالجديد، والأشهر التالية بالجديد.</p>'
        : '<div class="empty">لا يوجد عاملون في «بيانات العاملين».</div>') + '</div>') +
      (isAdmin() && prTab === 'access' ? prAccessHtml() : '');
    prTotal();
    if (!S.saHours) prLoadHours();
  }
  async function prLoadHours() {
    var h = await sb.from('staff_hours').select('*').eq('id', 1).maybeSingle();
    S.saHours = saParseHours(h.data);
    if (/^#\/pay/.test(location.hash)) render();
  }

  // من يصل إلى الرواتب غير المدير العام: حسابات المدير والمشرف، مشاهدة أو تعديل
  function prAccessHtml() {
    if (S.pr.accessMissing) return '';
    var st = prState(), lvl = {};
    S.pr.access.forEach(function (a) { lvl[a.user_id] = a.can_edit ? 'edit' : 'view'; });
    var users = S.users.filter(function (u) { return u.role === 'manager'; });
    var dirty = Object.keys(st.acc).length;
    return '<div class="card"><h2>صلاحيات الرواتب</h2><p class="hint" style="margin:0 0 8px">المدير العام يرى الرواتب ويعدّلها دائمًا. ولحسابات المدير والمشرف العام: بلا وصول، أو مشاهدة (يرى ويطبع ويصدّر)، أو تعديل (الإعدادات والحساب والاعتماد).</p>' +
      (users.length ? '<div class="table-wrap"><table class="grid"><thead><tr><th>الحساب</th><th>الصلاحية في البرنامج</th><th>الرواتب</th></tr></thead><tbody>' +
        users.map(function (u) {
          var v = u.id in st.acc ? st.acc[u.id] : lvl[u.id] || '';
          var o = function (k, l) { return '<option value="' + k + '"' + (v === k ? ' selected' : '') + '>' + l + '</option>'; };
          return '<tr' + (u.id in st.acc ? ' style="background:#fffbeb"' : '') + '><td><b>' + esc(u.full_name || u.email) + '</b><div class="hint" style="margin:0" dir="ltr">' + esc(u.email || '') + '</div></td><td>' + esc(ROLES[roleKey(u)] || u.role) + '</td>' +
            '<td><select data-pracc="' + u.id + '" style="width:auto">' + o('', 'بلا وصول') + o('view', 'مشاهدة') + (u.read_only ? '' : o('edit', 'تعديل')) + '</select>' +
              (u.read_only ? '<div class="hint" style="margin:0">«جهة مشرفة»: مشاهدة فقط</div>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="actions"><button type="button" class="btn primary" data-praccsave' + (dirty ? '' : ' disabled') + '>حفظ الصلاحيات' + (dirty ? ' (' + dirty + ')' : '') + '</button></div>'
        : '<div class="empty">لا توجد حسابات بصلاحية مدير أو مشرف عام.</div>') + '</div>';
  }
  async function prAccessSave() {
    var st = prState(), ids = Object.keys(st.acc);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i], v = st.acc[id];
      var r = v ? await sb.from('payroll_access').upsert({ user_id: id, can_edit: v === 'edit', granted_by: ttWho(), granted_at: new Date().toISOString() }, { onConflict: 'user_id' })
        : await sb.from('payroll_access').delete().eq('user_id', id);
      if (r.error) return fail(r.error);
    }
    st.acc = {};
    S.pr = null;
    render();
    toast('حُفظت صلاحيات الرواتب. تظهر لصاحبها بعد تحديث صفحته.');
  }

  // مجموع الرواتب: يُحدَّث مع الكتابة، من الخانات المعروضة
  function prTotal() {
    var el = document.getElementById('pr-total');
    if (!el) return;
    var sum = 0, n = 0, none = 0, bad = 0;
    document.querySelectorAll('[data-prsal]').forEach(function (inp) {
      var v = inp.value.trim();
      if (!v) { none++; return; }
      var x = prNum(v);
      if (isNaN(x) || x < 0) { bad++; inp.style.outline = '2px solid var(--red)'; return; }
      inp.style.outline = '';
      sum += x; n++;
    });
    el.innerHTML = '<b>' + money(sum) + '</b><div class="hint" style="margin:0">عدد الموظفين: ' + n + (none ? ' · بلا راتب: ' + none : '') + (bad ? ' · <span style="color:var(--red)">أرقام غير صحيحة: ' + bad + '</span>' : '') + '</div>';
  }

  async function prSave() {
    var st = prState(), b = prBase(st.month), sal = {}, changes = {}, bad = [];
    // رواتب بداية هذا الشهر، وما بقي من تغييرات خلاله أو بعده
    Object.keys((b && b.salaries) || {}).concat(Object.keys((b && b.changes) || {})).forEach(function (id) {
      var e = prEff(st.month, id);
      if (e.salary != null) sal[id] = e.salary;
      var c = b.changes && b.changes[id];
      if (c && c.from > st.month + '-01') changes[id] = c;
    });
    Object.keys(st.chg).forEach(function (id) {
      var c = st.chg[id], from = String(c.from || '').trim(), amt = String(c.amount || '').trim();
      if (!from && !amt) { delete changes[id]; return; }
      var x = prNum(amt), t = find(id);
      if (!from || !amt || isNaN(x) || x < 0) { bad.push((t ? t.name : id) + ' (التغيير يحتاج تاريخًا ومبلغًا)'); return; }
      if (from <= st.month + '-01') { bad.push((t ? t.name : id) + ' (تاريخ التغيير قبل بداية الشهر؛ اكتب الراتب الجديد في خانة الراتب)'); return; }
      changes[id] = { from: from, amount: x };
    });
    Object.keys(st.sal).forEach(function (id) {
      var v = String(st.sal[id]).trim();
      if (!v) { delete sal[id]; return; }
      var x = prNum(v);
      if (isNaN(x) || x < 0) { var t = find(id); bad.push(t ? t.name : id); return; }
      sal[id] = x;
    });
    if (bad.length) return toast('راتب غير صحيح: ' + bad.join('، '), true);
    var R = prRules(st.month), rules = {};
    PR_RULES.forEach(function (r) { var v = String(R[r[0]] == null ? '' : R[r[0]]).trim(); if (v !== '') rules[r[0]] = Number(v); });
    if (R.leave_from && R.leave_to && R.leave_from > R.leave_to) return toast('بداية فترة الإجازات بعد نهايتها', true);
    var wd = Number(R.work_days);
    if (!(wd >= 1 && wd <= 31)) return toast('أيام العمل في الشهر: رقم من 1 إلى 31', true);
    if (R.quran_in && R.quran_out && minsOf(R.quran_in) >= minsOf(R.quran_out)) return toast('بداية دوام المحفظين بعد نهايته', true);
    rules.leave_from = R.leave_from || ''; rules.leave_to = R.leave_to || '';
    rules.work_days = wd; rules.late_mode = R.late_mode === 'days' || R.late_mode === 'both' ? R.late_mode : 'minutes'; rules.late_fraction = Number(R.late_fraction) || 0.25;
    rules.quran_in = R.quran_in || ''; rules.quran_out = R.quran_out || '';
    rules.signer_title = String(R.signer_title || '').trim() || 'المشرف العام'; rules.signer_name = String(R.signer_name || '').trim();
    st.busy = true; render();
    var res = await sb.from('payroll_setup').upsert({ month: st.month, salaries: sal, changes: changes, rules: rules, updated_by: ttWho(), updated_at: new Date().toISOString() }, { onConflict: 'month' });
    st.busy = false;
    if (res.error) { render(); return fail(res.error); }
    st.sal = {}; st.rules = {}; st.chg = {};
    S.pr = null;
    render();
    toast('حُفظت إعدادات ' + monthLabel(st.month) + '. الأشهر التالية التي لم تُحفظ لها إعدادات تعتمدها.');
  }

  // استيراد الرواتب من كشف Excel: عمود «الاسم» وعمود «الراتب»؛ كل سطر يُطابَق بموظف، ويمكن تغيير المطابقة قبل التطبيق
  async function prReadFile(file) {
    try {
      await loadXlsx();
      var wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
      var aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
      var hi = -1, col = {};
      for (var i = 0; i < Math.min(aoa.length, 15) && hi < 0; i++) {
        aoa[i].forEach(function (h, j) {
          var n = norm(String(h));
          if (/^الاسم|اسم الموظف|اسم العامل/.test(n) && col.name == null) col.name = j;
          else if (/راتب|الاجر|المرتب/.test(n) && col.sal == null) col.sal = j;
        });
        if (col.name != null && col.sal != null) hi = i;
      }
      if (hi < 0) throw new Error('لم يُعثر على عمودي «الاسم» و«الراتب» في الملف');
      var staff = prStaff(prState().month), used = {};
      var rows = aoa.slice(hi + 1).map(function (r) {
        var name = String(r[col.name] == null ? '' : r[col.name]).replace(/\s+/g, ' ').trim(), sal = prNum(r[col.sal]);
        if (!name || /^\d+$/.test(name) || /مجموع|اجمالي|الاجمالي/.test(norm(name))) return null;
        var hit = staff.filter(function (t) { return norm(t.name) === norm(name); });
        if (!hit.length) hit = staff.filter(function (t) { return ttSameName(t.name, name); });
        var id = hit.length === 1 && !used[hit[0].id] ? hit[0].id : '';
        if (id) used[id] = 1;
        return { name: name, salary: isNaN(sal) ? '' : sal, id: id };
      }).filter(Boolean);
      if (!rows.length) throw new Error('لا توجد صفوف بأسماء في الملف');
      prState().imp = { file: file.name, rows: rows };
      render();
      window.scrollTo(0, 0);
    } catch (err) {
      toast(err.message, true);
    }
  }

  function prImportHtml(staff) {
    var imp = prState().imp, ok = imp.rows.filter(function (r) { return r.id && r.salary !== ''; }).length, sum = 0;
    var taken = {};
    imp.rows.forEach(function (r) { if (r.id) taken[r.id] = (taken[r.id] || 0) + 1; });
    var missing = staff.filter(function (t) { return !taken[t.id]; });
    return '<div class="card"><h2>استيراد الرواتب من «' + esc(imp.file) + '»</h2>' +
      '<p class="hint">سطور الملف: ' + imp.rows.length + ' · طوبق منها: ' + ok + '. راجع المطابقة؛ السطر الذي لم يُعرف صاحبه اختر له موظفًا أو اتركه «لا يُستورد». ' +
        'من ليس في «بيانات العاملين» أضفه هناك أولًا. لا يُحفظ شيء حتى «تطبيق» ثم «حفظ».</p>' +
      '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الاسم في الملف</th><th>الراتب</th><th>الموظف</th></tr></thead><tbody>' +
      imp.rows.map(function (r, i) {
        if (r.id && r.salary !== '') sum += Number(r.salary);
        return '<tr' + (!r.id ? ' style="background:#fff4e5"' : taken[r.id] > 1 ? ' style="background:#fde8e8"' : '') + '><td>' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td dir="ltr" style="text-align:right">' + (r.salary === '' ? '—' : esc(r.salary.toLocaleString('en'))) + '</td>' +
          '<td><select data-primpm="' + i + '" data-ro-mgr style="width:auto;max-width:260px"><option value="">— لا يُستورد —</option>' +
            staff.map(function (t) { return '<option value="' + t.id + '"' + (r.id === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select>' +
            (r.id && taken[r.id] > 1 ? ' <span class="badge" style="background:#fde8e8;color:var(--red)">مكرر</span>' : '') + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><th colspan="2" style="text-align:right">مجموع المطابَق</th><th colspan="2" style="text-align:right">' + money(sum) + '</th></tr></tfoot></table></div>' +
      (missing.length ? '<p class="hint">ليس لهم سطر في الملف (يبقى راتبهم كما هو): ' + missing.map(function (t) { return esc(t.name); }).join('، ') + '</p>' : '') +
      '<div class="actions"><button type="button" class="btn primary" data-primpapply data-ro-mgr>تطبيق الرواتب المطابَقة (' + ok + ') على ' + esc(monthLabel(prState().month)) + '</button>' +
        '<button type="button" class="btn link" data-primpclose data-ro-mgr>إلغاء الاستيراد</button></div></div>';
  }

  /* ----- حساب الرواتب ----- */
  function prunState() {
    if (!ui.prun) ui.prun = { month: todayISO().slice(0, 7), adj: {}, busy: false };
    return ui.prun;
  }
  var loadingPrAtt = false;
  async function loadPrAtt(month) {
    if (loadingPrAtt) return;
    loadingPrAtt = true;
    var R = prRules(month, true), first = month + '-01', last = prMonthEnd(month);
    var from = R.leave_from && R.leave_from < first ? R.leave_from : first;
    var rows = await fetchAll(function () { return sb.from('staff_attendance').select('teacher_id,day,status,time_in').gte('day', from).lte('day', last).order('day').order('teacher_id'); });
    if (!S.saHours) {
      var h = await sb.from('staff_hours').select('*').eq('id', 1).maybeSingle();
      S.saHours = saParseHours(h.data);
    }
    loadingPrAtt = false;
    var map = {};
    (rows || []).forEach(function (r) { (map[r.teacher_id] || (map[r.teacher_id] = {}))[String(r.day).slice(0, 10)] = r; });
    S.prAtt = { month: month, from: from, rows: map, missing: !rows };
    render();
  }

  // كشف الشهر لكل موظف له راتب: الحضور والخصومات والصافي
  function prCalc(month) {
    var b = prBase(month), R = prRules(month, true), H = S.saHours || { time_in: '07:30', time_out: '13:30' };
    var adj = Object.assign({}, ((S.pr.runs[month] || {}).adj) || {}), dAdj = prunState().adj;
    Object.keys(dAdj).forEach(function (id) { adj[id] = dAdj[id]; });
    var W = Number(R.work_days) || 22, first = month + '-01', last = prMonthEnd(month), days = [];
    for (var d = new Date(first + 'T00:00'); ; d.setDate(d.getDate() + 1)) {
      var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (iso > last) break;
      if (!attOff(iso)) days.push(iso);
    }
    var lf = R.leave_from || '', lt = R.leave_to || '', inPeriod = function (x) { return (!lf || x >= lf) && (!lt || x <= lt); };
    var allowLeave = R.leave_days === '' || R.leave_days == null ? null : Number(R.leave_days);
    var capLeave = R.leave_month === '' || R.leave_month == null ? Infinity : Number(R.leave_month);
    var allowMins = R.late_hours === '' || R.late_hours == null ? null : Number(R.late_hours) * 60;
    var allowDays = R.late_days === '' || R.late_days == null ? null : Number(R.late_days);
    var out = [];
    prStaff(month).forEach(function (t) {
      var eff = prEff(month, t.id), sal = eff.salary, salNote = '';
      if (sal == null) return;
      sal = Number(sal) || 0;
      if (eff.change) {
        var before = days.filter(function (dd) { return dd < eff.change.from; }).length, nw = Number(eff.change.amount) || 0;
        salNote = prMoney(sal) + ' حتى ' + dmy(days.filter(function (dd) { return dd < eff.change.from; }).pop() || first) + '، و' + prMoney(nw) + ' من ' + dmy(eff.change.from) +
          ' (' + before + ' و' + (days.length - before) + ' يوم عمل)';
        sal = days.length ? Math.round((sal * before + nw * (days.length - before)) / days.length * 100) / 100 : nw;
      }
      var T = shiftOf(t), quran = !T.id && staffCat(t) === 'محفظون' && R.quran_out && !(S.saHours.groups || []).length;
      var tin = quran ? (R.quran_in || T.time_in) : T.time_in, tout = quran ? R.quran_out : T.time_out;
      var hours = Math.max(0.5, ((minsOf(tout) || 0) - (minsOf(tin) || 0)) / 60), dayVal = sal / W, minVal = dayVal / (hours * 60);
      var rec = (S.prAtt.rows[t.id]) || {}, x = { t: t, salary: sal, salNote: salNote, dayVal: dayVal, hours: hours, present: 0, absent: 0, leave: 0, mission: 0, none: [], notEmp: 0, lateDays: 0, lateMins: 0, leaveBefore: 0 };
      // الإجازات المأخوذة في الفترة قبل هذا الشهر
      // إجازات الأشهر السابقة في العام الدراسي: ما غُطّي منها (حتى سقف كل شهر وما بقي من رصيد العام) يستهلك الرصيد، وما زاد خُصم في شهره
      var leaveByM = {}, usedLeave = 0, poolLeave = allowLeave == null ? Infinity : allowLeave;
      Object.keys(rec).forEach(function (dd) { if (dd < first && rec[dd].status === 'leave' && inPeriod(dd) && !attOff(dd)) { x.leaveBefore++; leaveByM[dd.slice(0, 7)] = (leaveByM[dd.slice(0, 7)] || 0) + 1; } });
      Object.keys(leaveByM).sort().forEach(function (mk) { usedLeave += Math.min(leaveByM[mk], capLeave, Math.max(0, poolLeave - usedLeave)); });
      var leaveIn = 0;
      days.forEach(function (dd) {
        if (!employedOn(t, dd)) { x.notEmp++; return; }
        var r = rec[dd];
        if (!r) { x.none.push(dd); return; }
        x[r.status] = (x[r.status] || 0) + 1;
        if (r.status === 'leave' && inPeriod(dd)) leaveIn++;
        if (r.status === 'present') {
          var a = minsOf(r.time_in), bb = minsOf(tin);
          if (a != null && bb != null && a > bb) { x.lateDays++; x.lateMins += a - bb; }
        }
      });
      var leaveCovered = Math.min(leaveIn, capLeave, Math.max(0, poolLeave - usedLeave));
      x.leaveExtra = leaveIn - leaveCovered;
      x.leaveLeft = allowLeave == null ? null : Math.max(0, allowLeave - usedLeave - leaveCovered);
      // التأخير: بالدقيقة، أو باليوم، أو الاثنان معًا (كلٌّ بحدّه المسموح)
      var exDays = allowDays == null ? 0 : Math.max(0, x.lateDays - allowDays), exMins = allowMins == null ? 0 : Math.max(0, x.lateMins - allowMins);
      var fracTxt = { 0.25: 'ربع يوم', 0.5: 'نصف يوم', 1: 'يوم كامل' }[Number(R.late_fraction)] || R.late_fraction;
      var useDays = R.late_mode === 'days' || R.late_mode === 'both', useMins = R.late_mode !== 'days';
      x.lateExtra = useDays && !useMins ? exDays : useMins && !useDays ? exMins : exDays + exMins;
      x.dLate = (useDays ? exDays * (Number(R.late_fraction) || 0.25) * dayVal : 0) + (useMins ? exMins * minVal : 0);
      x.lateNote = [useMins && exMins ? exMins + ' دقيقة زائدة' : '', useDays && exDays ? exDays + ' يوم تأخير زائد × ' + fracTxt : ''].filter(Boolean).join(' + ');
      var r2 = function (v) { return Math.round(v * 100) / 100; };
      x.dLate = r2(x.dLate);
      x.dAbsent = r2(x.absent * dayVal);
      x.dLeave = r2(x.leaveExtra * dayVal);
      x.dNotEmp = r2(x.notEmp * dayVal);
      var a = adj[t.id] || {};
      x.add = prNum(a.add) || 0; x.addNote = a.addNote || ''; x.ded = prNum(a.ded) || 0; x.dedNote = a.dedNote || '';
      x.deductions = x.dAbsent + x.dLeave + x.dLate + x.dNotEmp + x.ded;
      x.net = Math.max(0, Math.round((sal - x.deductions + x.add) * 100) / 100);
      out.push(x);
    });
    return { month: month, rules: R, H: H, workdays: days.length, rows: out, noSalary: prStaff(month).filter(function (t) { return !(b && b.salaries && b.salaries[t.id] != null); }) };
  }
  // ما يُحفظ عند الاعتماد: كل الأرقام كما حُسبت
  function prSnap(C) {
    return C.rows.map(function (x) {
      return { id: x.t.id, name: x.t.name, cat: staffCat(x.t), job: x.t.job_title || '', salary: x.salary, salNote: x.salNote || '', dayVal: Math.round(x.dayVal * 100) / 100,
        present: x.present, absent: x.absent, leave: x.leave, mission: x.mission, none: x.none.length, notEmp: x.notEmp, lateDays: x.lateDays, lateMins: x.lateMins,
        leaveExtra: x.leaveExtra, leaveLeft: x.leaveLeft, lateExtra: x.lateExtra, lateNote: x.lateNote,
        dAbsent: Math.round(x.dAbsent * 100) / 100, dLeave: Math.round(x.dLeave * 100) / 100, dLate: Math.round(x.dLate * 100) / 100, dNotEmp: Math.round(x.dNotEmp * 100) / 100,
        add: x.add, addNote: x.addNote, ded: x.ded, dedNote: x.dedNote, net: x.net };
    });
  }
  // الكشف المعروض: المعتمد كما حُفظ، وإلا المحسوب الآن
  function prSheet(month) {
    var run = S.pr.runs[month];
    if (run && run.status === 'approved') return { approved: true, run: run, rows: run.rows || [], rules: run.rules || {}, month: month };
    var C = prCalc(month);
    return { approved: false, calc: C, rows: prSnap(C), rules: C.rules, month: month };
  }

  function renderPayRun() {
    var st = prunState(), edit = prCanEdit(), dis = edit ? ' data-ro-mgr' : ' disabled';
    var head = prHead('حساب الرواتب', 'رواتب الشهر من «دوام الموظفين» وقواعد «إعدادات الرواتب»: خصم الغياب والإجازات الزائدة والتأخير الزائد، ثم الإضافات والخصومات اليدوية. بعد المراجعة يُعتمد الشهر.');
    if (!S.pr) { app.innerHTML = head + '<div class="card empty">جارٍ التحميل…</div>'; loadPr(); return; }
    if (S.pr.missing || S.pr.runsMissing) { app.innerHTML = head + prMissingHtml(); return; }
    var run = S.pr.runs[st.month], approved = run && run.status === 'approved';
    if (!approved && (!S.prAtt || S.prAtt.month !== st.month)) { app.innerHTML = head + '<div class="card empty">جارٍ جلب الدوام…</div>'; loadPrAtt(st.month); return; }
    var bar = '<div class="card"><div class="toolbar" style="align-items:center;margin:0">' +
      '<span class="monthpick"><label class="field" for="prun-month">الشهر</label><input type="month" id="prun-month" data-ro-ok value="' + st.month + '"></span>' +
      (approved ? '<span class="badge paid">معتمد</span> <span class="hint" style="margin:0">' + esc(run.approved_by || '') + ' · ' + dmy(String(run.approved_at || '').slice(0, 10)) + ' — الكشف محفوظ كما اعتُمد</span> ' +
        (run.show_slip ? '<span class="badge part">السليبات ظاهرة للموظفين في «دوامي وراتبي»</span>' : '<span class="badge pending">السليبات مخفية عن الموظفين</span>') : '<span class="badge pending">غير معتمد</span>') + '</div></div>';
    if (!approved && !prBase(st.month)) { app.innerHTML = head + bar + '<div class="card empty">لا توجد إعدادات رواتب لهذا الشهر ولا لما قبله. أدخل الرواتب في «إعدادات الرواتب».</div>'; return; }
    if (!approved && S.prAtt.missing) { app.innerHTML = head + bar + '<div class="card empty">تعذّر جلب «دوام الموظفين». شغّل <code dir="ltr">supabase/staff_attendance.sql</code> إن لم يُشغَّل.</div>'; return; }
    var P = prSheet(st.month), rows = P.rows, R = P.rules, sum = { salary: 0, ded: 0, add: 0, net: 0 }, noneN = 0, noneStaff = 0;
    rows.forEach(function (x) {
      sum.salary += x.salary; sum.net += x.net; sum.add += x.add;
      sum.ded += x.dAbsent + x.dLeave + x.dLate + x.dNotEmp + x.ded;
      if (x.none) { noneN += x.none; noneStaff++; }
    });
    var c = function (v) { return '<td class="c">' + (v ? v : '') + '</td>'; }, m = function (v) { return '<td class="c" style="white-space:nowrap">' + (v ? prMoney(v) : '') + '</td>'; };
    var dirtyAdj = Object.keys(st.adj).length;
    var body = rows.map(function (x, i) {
      var a = st.adj[x.id] || {}, val = function (k) { return esc(k in a ? a[k] : x[k] || ''); };
      return '<tr' + (st.adj[x.id] ? ' style="background:#fffbeb"' : '') + '><td>' + (i + 1) + '</td><td style="white-space:nowrap"><b>' + esc(x.name) + '</b><div class="hint" style="margin:0">' + esc(x.cat) + '</div></td>' +
        m(x.salary) + c(x.present) + '<td class="c">' + (x.absent || '') + (x.dAbsent ? '<div class="hint" style="margin:0;color:var(--red)">−' + prMoney(x.dAbsent) + '</div>' : '') + '</td>' +
        '<td class="c">' + (x.leave || '') + (x.dLeave ? '<div class="hint" style="margin:0;color:var(--red)">زائد ' + x.leaveExtra + ': −' + prMoney(x.dLeave) + '</div>' : '') + (x.leaveLeft != null ? '<div class="hint" style="margin:0">الرصيد ' + x.leaveLeft + '</div>' : '') + '</td>' +
        c(x.mission) + '<td class="c">' + (x.lateDays ? x.lateDays + ' يوم / ' + x.lateMins + ' د' : '') + (x.dLate ? '<div class="hint" style="margin:0;color:var(--red)">' + esc(x.lateNote) + ': −' + prMoney(x.dLate) + '</div>' : '') + '</td>' +
        '<td class="c">' + (x.none ? '<b style="color:#b54708">' + x.none + '</b>' : '') + (x.notEmp ? '<div class="hint" style="margin:0">خارج مدة العمل ' + x.notEmp + ': −' + prMoney(x.dNotEmp) + '</div>' : '') + '</td>' +
        (P.approved ? m(x.add) + m(x.ded) :
          '<td><input type="text" inputmode="decimal" dir="ltr" data-pradj="' + x.id + '" data-k="add" value="' + val('add') + '" placeholder="0" style="width:80px;text-align:right"' + dis + '><input type="text" data-pradj="' + x.id + '" data-k="addNote" value="' + val('addNote') + '" placeholder="السبب" style="width:110px;margin-top:2px"' + dis + '></td>' +
          '<td><input type="text" inputmode="decimal" dir="ltr" data-pradj="' + x.id + '" data-k="ded" value="' + val('ded') + '" placeholder="0" style="width:80px;text-align:right"' + dis + '><input type="text" data-pradj="' + x.id + '" data-k="dedNote" value="' + val('dedNote') + '" placeholder="السبب" style="width:110px;margin-top:2px"' + dis + '></td>') +
        '<td class="c" style="white-space:nowrap"><b>' + prMoney(x.net) + '</b></td>' +
        '<td><button type="button" class="btn link" data-prslip="' + x.id + '" data-ro-ok>السليب</button></td></tr>';
    }).join('');
    var card = function (lbl, num, sub, color) { return '<div class="card stat"><span class="lbl">' + lbl + '</span><span class="num"' + (color ? ' style="color:' + color + '"' : '') + '>' + num + '</span><span class="sub">' + sub + '</span></div>'; };
    var lateRule = R.late_mode === 'both' ? 'التأخير: ما زاد عن ' + (R.late_hours === '' || R.late_hours == null ? '— ساعة' : R.late_hours + ' ساعة') + ' بالدقيقة، وما زاد عن ' + (R.late_days === '' || R.late_days == null ? '— أيام' : R.late_days + ' أيام') + ' باليوم' : R.late_mode === 'days' ? 'التأخير باليوم: ما زاد عن ' + (R.late_days === '' || R.late_days == null ? '— (بلا حد)' : R.late_days + ' أيام') : 'التأخير بالدقيقة: ما زاد عن ' + (R.late_hours === '' || R.late_hours == null ? '— (بلا حد)' : R.late_hours + ' ساعة');
    app.innerHTML = head + bar +
      '<div class="stats">' + card('مجموع الرواتب', prMoney(sum.salary), rows.length + ' موظفًا') + card('الخصومات', prMoney(sum.ded), 'غياب وإجازات وتأخير ويدوي', sum.ded ? 'var(--red)' : '') +
        card('الإضافات', prMoney(sum.add), 'مكافآت وبدلات') + card('صافي الرواتب', prMoney(sum.net), 'بالجنيه المصري', 'var(--navy-dark)') + '</div>' +
      '<p class="hint">أجر اليوم = الراتب ÷ ' + (R.work_days || 22) + '. ' + esc(lateRule) + '. الإجازات: ' + (R.leave_days === '' || R.leave_days == null ? 'بلا حد في العام' : R.leave_days + ' أيام في العام الدراسي (' + dmy(R.leave_from) + ' – ' + dmy(R.leave_to) + '، تراكمية عبر الأشهر)') + (R.leave_month === '' || R.leave_month == null ? '' : '، بحد أقصى ' + R.leave_month + ' في الشهر') + ' وما زاد يُخصم. الغياب يُخصم كل شهر. المأمورية بلا خصم.</p>' +
      (!P.approved && noneN ? '<p class="formhint">أيام عمل غير مسجَّلة في الدوام: ' + noneN + '، عند ' + noneStaff + ' من الموظفين (العمود «غير مسجَّل»). لا تُخصم، لكن سجّلها في «دوام الموظفين» قبل الاعتماد.</p>' : '') +
      (!P.approved && P.calc.noSalary.length ? '<p class="hint">بلا راتب في الإعدادات (لا يظهرون في الكشف): ' + P.calc.noSalary.map(function (t) { return esc(t.name); }).join('، ') + '</p>' : '') +
      '<div class="toolbar" style="align-items:center">' +
        (!P.approved && edit ? '<button type="button" class="btn" data-pradjsave data-ro-mgr' + (dirtyAdj && !st.busy ? '' : ' disabled') + '>حفظ الإضافات والخصومات' + (dirtyAdj ? ' (' + dirtyAdj + ')' : '') + '</button>' +
          '<button type="button" class="btn primary" data-prapprove data-ro-mgr' + (st.busy ? ' disabled' : '') + '>اعتماد رواتب ' + esc(monthLabel(st.month)) + '</button>' : '') +
        (P.approved && isAdmin() ? '<button type="button" class="btn" data-prreopen>إلغاء الاعتماد</button>' : '') +
        (P.approved && edit ? '<button type="button" class="btn" data-prshowslips="' + (run.show_slip ? '0' : '1') + '" data-ro-mgr>' + (run.show_slip ? 'إخفاء السليبات عن الموظفين' : 'إظهار السليبات للموظفين') + '</button>' : '') +
        '<b style="margin-inline-start:8px">كشف الرواتب:</b><button type="button" class="btn" data-prrep="xlsx" data-ro-ok>Excel</button><button type="button" class="btn" data-prrep="pdf" data-ro-ok>PDF / طباعة</button>' +
        '<button type="button" class="btn primary" data-prslip="all" data-ro-ok>طباعة كل السليبات</button></div>' +
      '<div class="card">' + (rows.length
        ? '<div class="table-wrap"><table class="grid pr-run"><thead><tr><th>م</th><th>الموظف</th><th>الراتب</th><th>حضور</th><th>غياب</th><th>إجازة</th><th>مأمورية</th><th>تأخير</th><th>غير مسجَّل</th><th>إضافات</th><th>خصومات أخرى</th><th>الصافي</th><th></th></tr></thead><tbody>' + body + '</tbody>' +
          '<tfoot><tr><th colspan="2" style="text-align:right">المجموع</th><th class="c">' + prMoney(sum.salary) + '</th><th colspan="8"></th><th class="c">' + prMoney(sum.net) + '</th><th></th></tr></tfoot></table></div>'
        : '<div class="empty">لا يوجد موظفون لهم رواتب في هذا الشهر.</div>') + '</div>';
  }

  async function prAdjSave(quiet) {
    var st = prunState(), run = S.pr.runs[st.month], adj = Object.assign({}, (run && run.adj) || {});
    Object.keys(st.adj).forEach(function (id) {
      var a = st.adj[id], clean = {};
      ['add', 'ded'].forEach(function (k) { var v = prNum(a[k]); if (String(a[k] || '').trim() && !isNaN(v) && v > 0) clean[k] = v; });
      ['addNote', 'dedNote'].forEach(function (k) { if (String(a[k] || '').trim()) clean[k] = String(a[k]).trim(); });
      if (Object.keys(clean).length) adj[id] = clean; else delete adj[id];
    });
    var res = await sb.from('payroll_runs').upsert({ month: st.month, status: 'draft', adj: adj, updated_by: ttWho(), updated_at: new Date().toISOString() }, { onConflict: 'month' }).select().single();
    if (res.error) { fail(res.error); return false; }
    S.pr.runs[st.month] = res.data;
    st.adj = {};
    if (!quiet) { render(); toast('حُفظت الإضافات والخصومات'); }
    return true;
  }
  async function prApprove() {
    var st = prunState(), P = prSheet(st.month);
    var bad = Object.keys(st.adj).filter(function (id) { var a = st.adj[id]; return ['add', 'ded'].some(function (k) { return String(a[k] || '').trim() && isNaN(prNum(a[k])); }); });
    if (bad.length) return toast('مبلغ غير صحيح في الإضافات أو الخصومات', true);
    var none = P.rows.reduce(function (s, x) { return s + (x.none || 0); }, 0);
    var msg = 'اعتماد رواتب ' + monthLabel(st.month) + ' لـ ' + P.rows.length + ' موظفًا؟\nبعد الاعتماد يُحفظ الكشف كما هو، ولا يتغير لو عُدّل الدوام أو الرواتب.';
    if (none) msg = 'تنبيه: أيام عمل غير مسجَّلة في الدوام: ' + none + ' (لا تُخصم). الأفضل تسجيلها في «دوام الموظفين» أولًا.\n\n' + msg;
    if (!confirm(msg)) return;
    st.busy = true; render();
    if (Object.keys(st.adj).length && !(await prAdjSave(true))) { st.busy = false; return render(); }
    P = prSheet(st.month);
    var res = await sb.from('payroll_runs').upsert({ month: st.month, status: 'approved', rows: P.rows, rules: P.rules, adj: (S.pr.runs[st.month] || {}).adj || {},
      approved_by: ttWho(), approved_at: new Date().toISOString(), updated_by: ttWho(), updated_at: new Date().toISOString() }, { onConflict: 'month' }).select().single();
    st.busy = false;
    if (res.error) { render(); return fail(res.error); }
    S.pr.runs[st.month] = res.data;
    render();
    toast('اعتُمدت رواتب ' + monthLabel(st.month));
  }

  // كشف الرواتب: Excel أو PDF، والسليبات (لموظف أو للجميع)
  var pendingPay = null;
  async function prReport(fmt) {
    var st = prunState(), P = prSheet(st.month);
    if (fmt === 'pdf') { pendingPay = { kind: 'reg', P: P }; return printNow(); }
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      var top = [[schoolName()], ['كشف رواتب ' + monthLabel(P.month) + (P.approved ? ' (معتمد)' : ' (غير معتمد)')], []];
      var tot = { salary: 0, net: 0 };
      var data = P.rows.map(function (x, i) {
        tot.salary += x.salary; tot.net += x.net;
        return [i + 1, x.name, x.cat, x.job, x.salary, x.present, x.absent, x.leave, x.mission, x.lateDays, x.lateMins, x.none, x.dAbsent, x.dLeave, x.dLate, x.dNotEmp, x.ded, x.dedNote, x.add, x.addNote, x.net];
      });
      var ws = XLSX.utils.aoa_to_sheet(top.concat([['م', 'الموظف', 'الفئة', 'المسمى', 'الراتب', 'حضور', 'غياب', 'إجازة', 'مأمورية', 'أيام التأخير', 'دقائق التأخير', 'أيام غير مسجلة',
        'خصم الغياب', 'خصم الإجازات الزائدة', 'خصم التأخير', 'خصم خارج مدة العمل', 'خصومات أخرى', 'سببها', 'إضافات', 'سببها', 'الصافي']], data,
        [['', 'المجموع', '', '', tot.salary, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', Math.round(tot.net * 100) / 100]]));
      ws['!cols'] = [5, 28, 13, 16, 10, 6, 6, 6, 7, 8, 9, 9, 10, 12, 10, 12, 10, 16, 9, 16, 11].map(function (w) { return { wch: w }; });
      XLSX.utils.book_append_sheet(wb, ws, 'كشف الرواتب');
      XLSX.writeFile(wb, 'الرواتب-' + P.month + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }
  function buildPayRegSheet(P) {
    var n = 11, tot = { salary: 0, ded: 0, add: 0, net: 0 };
    // الكشف على صفحة أو أكثر: الترويسة ورأس الجدول في رأس الجدول فتتكرر في كل صفحة، وآخر صفحة فيها المجموع والتوقيعات.
    // ارتفاع الصف وخطه من عدد الصفوف في الصفحة (حتى 20 صفًّا تقريبًا)، فتبقى الأرقام والأسماء كبيرة وواضحة
    // الصفحة تُملأ بما يتسع فيها من الصفوف ثم يُنتقل إلى التالية؛ وآخر صفحة تتسع لصفوفها مع المجموع والتوقيعات
    // (مقاسات بالمليمتر: صفحة 275 صالحة للطباعة، ترويسة وعنوان نحو 94، سطر رقم الصفحة 8، المجموع 12، التوقيعات 46)
    var total = P.rows.length, avail = 275 - 94 - 8, lastRoom = avail - 12 - 46;
    // خط كبير وصفوف بارتفاع 10 مم: 17 موظفًا في الصفحة، وآخر صفحة تتسع لصفوفها مع المجموع والتوقيعات
    var rowMm = 10, fontPt = 13, nameEm = .96;
    // كل صفحة تُملأ بـ 17 صفًّا؛ وآخر صفحة بما بقي، وتضيّق صفوفها (حتى 7.5 مم) لتتسع مع المجموع والتوقيعات،
    // وإن لم تتسع (16 أو 17 صفًّا) تأخذ آخر أربعة صفوف فقط ليبقى المجموع والتوقيعات مع موظفين
    var cap = Math.max(1, Math.floor(avail / rowMm)), sizes = [], left = total;
    while (left > cap) { sizes.push(cap); left -= cap; }
    if (left * 7.5 > lastRoom && sizes.length >= 0 && left > 4) { sizes.push(left - 4); left = 4; }
    sizes.push(left);
    var rowsMm = sizes.map(function (n, i) { return i === sizes.length - 1 ? Math.min(rowMm, lastRoom / n) : rowMm; });
    var pages = sizes.length;
    var c = function (v, b) { return '<td class="c" style="white-space:nowrap">' + (b ? '<b>' + v + '</b>' : v ? v : '') + '</td>'; };
    // الأرقام المالية بخط أصغر قليلًا ليتسع أكبر مبلغ (مثل 10,714.29) داخل خليته دون تداخل؛ ويصغر أكثر إن زاد عن 9 خانات
    var m = function (v, b) {
      var t = String(v || ''), sz = t.length >= 11 ? .66 : t.length >= 10 ? .72 : .8;
      return '<td class="c" style="white-space:nowrap;overflow:hidden;font-size:' + sz + 'em">' + (b && t ? '<b>' + t + '</b>' : t) + '</td>';
    };
    var body = P.rows.map(function (x, i) {
      var ded = x.dAbsent + x.dLeave + x.dLate + x.dNotEmp + x.ded;
      tot.salary += x.salary; tot.ded += ded; tot.add += x.add; tot.net += x.net;
      return '<tr style="height:' + 'ROWMM' + 'mm">' + c(i + 1) + '<td style="font-size:' + (x.name.length > 26 ? .74 : x.name.length > 20 ? .84 : nameEm) + 'em;line-height:1.15"><b>' + esc(x.name) + '</b></td>' + m(prMoney(x.salary)) + c(x.present) + c(x.absent) + c(x.leave) +
        c(x.lateDays ? x.lateDays + '/' + x.lateMins + 'د' : '') + m(ded ? prMoney(ded) : '') + m(x.add ? prMoney(x.add) : '') + m(prMoney(x.net), true) + '<td></td></tr>';
    });
    // كشف الرواتب وحده بترويسة الأكاديمية والمؤسسة الشريكة، وتوقيعات مدير الأكاديمية ومدير المؤسسة المانحة ومدير المؤسسة الشريكة
    var head = reportHead('كشف الرواتب', [['الشهر', monthLabel(P.month)], ['الحالة', P.approved ? 'معتمد' : 'غير معتمد'], ['عدد الموظفين', P.rows.length]], { banner: 'banner-payroll.png' }).replace(/^<img class="wm"[^>]*>/, '');
    // كل صفحة قسم قائم بذاته: الترويسة وعنوان الكشف ورأس الجدول، فتظهر كلها في كل صفحة (الترويسة الطويلة لا يكرّرها رأس الجدول وحده)
    var colHead = '<colgroup><col style="width:3.5%"><col style="width:22.5%"><col style="width:10.5%"><col style="width:4.5%"><col style="width:4.5%"><col style="width:4.5%"><col style="width:6%"><col style="width:10%"><col style="width:10%"><col style="width:11%"><col style="width:12.5%"></colgroup><thead><tr><th>م</th><th>الموظف</th><th>الراتب</th><th>حضور</th><th>غياب</th><th>إجازة</th><th>تأخير<br>يوم/دقيقة</th><th>خصومات</th><th>إضافات</th><th>الصافي</th><th>التوقيع</th></tr></thead>';
    var totalRow = '<tr><td></td><td><b>المجموع</b></td>' + m(prMoney(tot.salary), true) + '<td colspan="4"></td>' + m(prMoney(tot.ded), true) + m(prMoney(tot.add), true) + m(prMoney(tot.net), true) + '<td></td></tr>';
    var parts = '';
    for (var pg = 0; pg < pages; pg++) {
      var last = pg === pages - 1, from = sizes.slice(0, pg).reduce(function (a, b) { return a + b; }, 0), chunk = body.slice(from, from + sizes[pg]).join('').split('ROWMM').join(String(Math.round(rowsMm[pg] * 100) / 100));
      parts += '<section class="pr-page" style="' + (last ? '' : 'break-after:page;page-break-after:always;') + '">' + head +
        '<table class="rz" style="table-layout:fixed;width:100%">' + colHead + '<tbody>' + chunk + (last ? totalRow : '') + '</tbody></table>' +
        (last ? reportSigns([['مدير الأكاديمية', principalName()], ['مدير المؤسسة المانحة', ''], ['مدير المؤسسة الشريكة', '']], true) : '') +
        (pages > 1 ? '<div style="text-align:center;font-size:.85em;margin-top:.6em">صفحة ' + (pg + 1) + ' من ' + pages + '</div>' : '') + '</section>';
    }
    sheet.className = 'ls pay-reg';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = fontPt + 'pt';
    sheet.style.width = '190mm';
    sheet.innerHTML = parts;
  }
  function prSlipHtml(x, P, withHead) {
    var tr = function (a, b, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th>' + a + '</th><td>' + b + '</td></tr>'; };
    var ded = [['الغياب', x.absent ? x.absent + ' يوم' : '', x.dAbsent], ['الإجازات الزائدة عن الرصيد', x.leaveExtra ? x.leaveExtra + ' يوم' : '', x.dLeave],
      ['التأخير', x.lateNote || '', x.dLate], ['أيام خارج مدة العمل', x.notEmp ? x.notEmp + ' يوم' : '', x.dNotEmp], ['خصومات أخرى', x.dedNote || '', x.ded]].filter(function (d) { return d[2]; });
    var dsum = ded.reduce(function (s, d) { return s + d[2]; }, 0);
    return (withHead ? reportHead('قسيمة راتب', [['الشهر', monthLabel(P.month)]], { lead: x.name }) : '') +
      '<div class="rsec">بيانات الموظف</div><table class="rk">' +
        '<tr><th>الاسم</th><td>' + esc(x.name) + '</td><th>الشهر</th><td>' + esc(monthLabel(P.month)) + '</td></tr>' +
        '<tr><th>الفئة</th><td>' + esc(x.cat) + '</td><th>المسمى الوظيفي</th><td>' + esc(x.job || '—') + '</td></tr></table>' +
      '<div class="rsec">الدوام</div><table class="rk">' +
        '<tr><th>أيام الحضور</th><td>' + x.present + '</td><th>أيام الغياب</th><td>' + x.absent + '</td></tr>' +
        '<tr><th>الإجازات</th><td>' + x.leave + (x.leaveLeft != null ? ' (المتبقي من الرصيد: ' + x.leaveLeft + ')' : '') + '</td><th>المأموريات</th><td>' + x.mission + '</td></tr>' +
        '<tr><th>أيام التأخير</th><td>' + x.lateDays + '</td><th>دقائق التأخير</th><td>' + x.lateMins + '</td></tr></table>' +
      '<div class="rsec">الراتب</div><table class="rk">' +
        tr('الراتب الأساسي', prMoney(x.salary) + ' ج.م' + (x.salNote ? '<div style="font-size:.85em">' + esc(x.salNote) + '</div>' : '')) +
        (x.add ? tr('إضافات' + (x.addNote ? ' (' + esc(x.addNote) + ')' : ''), '+ ' + prMoney(x.add) + ' ج.م') : '') +
        ded.map(function (d) { return tr('خصم: ' + d[0] + (d[1] ? ' (' + esc(d[1]) + ')' : ''), '− ' + prMoney(d[2]) + ' ج.م'); }).join('') +
        (ded.length ? tr('مجموع الخصومات', '− ' + prMoney(dsum) + ' ج.م') : '') +
        '<tr><th style="font-size:1.15em">صافي الراتب</th><td style="font-size:1.25em"><b>' + prMoney(x.net) + ' ج.م</b></td></tr></table>' +
      '<p style="margin:.6em 0 0;font-size:.85em">أجر اليوم = الراتب ÷ ' + esc(P.rules.work_days || 22) + (P.approved ? '' : ' · كشف غير معتمد') + '</p>' +
      prSigns(P, ['الموظف', x.name]);
  }
  function buildPaySlipSheet(q) {
    var list = q.id === 'all' ? q.P.rows : q.P.rows.filter(function (x) { return x.id === q.id; });
    sheet.className = 'ps';
    if (list.length === 1) { sheet.innerHTML = prSlipHtml(list[0], q.P, true); fitSheet(); return; }
    sheet.removeAttribute('data-fit');
    // العلامة المائية ثابتة الموضع وتتكرر في كل صفحة: صورة واحدة للملف كله، لا صورة لكل سليب (تراكمها يُغمّق الخلفية)
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' + list.map(function (x, i) {
      return '<div style="position:relative;' + (i < list.length - 1 ? 'break-after:page;page-break-after:always' : '') + '">' + prSlipHtml(x, q.P, true).replace(/^<img class="wm"[^>]*>/, '') + '</div>';
    }).join('');
  }

  document.addEventListener('click', function (e) {
    if (!/^#\/pay(roll|run)$/.test(location.hash) || !prLevel()) return;
    var el;
    if (location.hash === '#/payrun') {
      var rs = prunState();
      if ((el = e.target.closest('[data-prslip]'))) { pendingPay = { kind: 'slip', id: el.getAttribute('data-prslip'), P: prSheet(rs.month) }; return printNow(); }
      if ((el = e.target.closest('[data-prrep]'))) return prReport(el.getAttribute('data-prrep'));
      if (!prCanEdit()) return;
      if (e.target.closest('[data-pradjsave]')) { rs.busy = true; return prAdjSave().then(function () { rs.busy = false; render(); }); }
      if (e.target.closest('[data-prapprove]')) return prApprove();
      if ((el = e.target.closest('[data-prshowslips]'))) {
        var show = el.getAttribute('data-prshowslips') === '1';
        if (!confirm((show ? 'إظهار' : 'إخفاء') + ' سليبات ' + monthLabel(rs.month) + (show ? ' لكل موظف (يرى سليبه هو فقط) في «دوامي وراتبي»؟' : ' عن الموظفين؟'))) return;
        return sb.rpc('set_payroll_slips', { p_month: rs.month, p_show: show }).then(function (r) {
          if (r.error) return fail(r.error);
          S.pr.runs[rs.month].show_slip = show;
          render();
          toast(show ? 'السليبات ظاهرة للموظفين' : 'السليبات مخفية عن الموظفين');
        });
      }
      if (e.target.closest('[data-prreopen]') && isAdmin()) {
        if (!confirm('إلغاء اعتماد رواتب ' + monthLabel(rs.month) + '؟\nيعود الكشف يُحسب من الدوام والإعدادات الحالية، وقد تتغير أرقامه عمّا طُبع من سليبات.')) return;
        return sb.from('payroll_runs').update({ status: 'draft', rows: null, show_slip: false, approved_by: '', approved_at: null, updated_by: ttWho(), updated_at: new Date().toISOString() }).eq('month', rs.month).then(function (r) {
          if (r.error) return fail(r.error);
          S.pr = null; S.prAtt = null; render();
        });
      }
      return;
    }
    var st = prState();
    if (e.target.closest('[data-praccsave]') && isAdmin()) return prAccessSave();
    if (!prCanEdit()) return;
    if (e.target.closest('[data-prsave]')) return prSave();
    if (e.target.closest('[data-prcancel]')) { st.sal = {}; st.rules = {}; st.chg = {}; return render(); }
    if (e.target.closest('[data-primp]')) return document.getElementById('pr-file').click();
    if (e.target.closest('[data-primpclose]')) { st.imp = null; return render(); }
    if (e.target.closest('[data-primpapply]')) {
      var ids = {}, dup = [];
      st.imp.rows.forEach(function (r) { if (r.id) { if (ids[r.id]) dup.push(find(r.id).name); ids[r.id] = 1; } });
      if (dup.length) return toast('موظف مختار لأكثر من سطر: ' + dup.join('، '), true);
      var n = 0;
      st.imp.rows.forEach(function (r) { if (r.id && r.salary !== '') { st.sal[r.id] = String(r.salary); n++; } });
      st.imp = null;
      render();
      return toast('طُبّقت الرواتب المطابَقة (' + n + ') بخلفية صفراء. راجع ثم اضغط «حفظ».');
    }
  });
  function prSaveBtn() {
    var btn = document.querySelector('[data-prsave]'), st = prState();
    if (btn && !st.busy) { btn.disabled = false; btn.textContent = 'حفظ إعدادات ' + monthLabel(st.month) + ' (' + prDirty() + ')'; }
  }
  document.addEventListener('input', function (e) {
    if (!/^#\/pay(roll|run)$/.test(location.hash) || !prCanEdit()) return;
    var el = e.target;
    if (el.hasAttribute('data-prsal')) {
      prState().sal[el.getAttribute('data-prsal')] = el.value;
      el.closest('tr').style.background = '#fffbeb';
      prTotal();
      prSaveBtn();
    }
    if (el.hasAttribute('data-prchg')) {
      var pid = el.getAttribute('data-prchg'), pst = prState(), cur0 = pst.chg[pid] || Object.assign({}, prChange(pid));
      cur0[el.getAttribute('data-k')] = el.value;
      pst.chg[pid] = cur0;
      el.closest('tr').style.background = '#fffbeb';
      prSaveBtn();
    }
    if (el.hasAttribute('data-pradj')) {
      var rs = prunState(), id = el.getAttribute('data-pradj');
      var run = S.pr.runs[rs.month], cur = rs.adj[id] || Object.assign({}, ((run && run.adj) || {})[id] || {});
      cur[el.getAttribute('data-k')] = el.value;
      rs.adj[id] = cur;
      el.closest('tr').style.background = '#fffbeb';
      var b = document.querySelector('[data-pradjsave]');
      if (b) { b.disabled = false; b.textContent = 'حفظ الإضافات والخصومات (' + Object.keys(rs.adj).length + ')'; }
    }
  });
  document.addEventListener('change', function (e) {
    if (!/^#\/pay(roll|run)$/.test(location.hash) || !prLevel()) return;
    var el = e.target;
    if (el.id === 'prun-month') {
      var rs = prunState();
      if (!el.value) return;
      if (Object.keys(rs.adj).length && !confirm('في هذا الشهر إضافات أو خصومات لم تُحفظ. الانتقال يلغيها؟')) { el.value = rs.month; return; }
      rs.month = el.value; rs.adj = {}; S.prAtt = null; return render();
    }
    var st = prState();
    if (el.id === 'pr-month') {
      if (!el.value) return;
      if (prDirty() && !confirm('في هذا الشهر تعديلات لم تُحفظ. الانتقال يلغيها؟')) { el.value = st.month; return; }
      st.month = el.value; st.sal = {}; st.rules = {}; st.chg = {}; st.imp = null; return render();
    }
    if (el.hasAttribute('data-pracc')) { st.acc[el.getAttribute('data-pracc')] = el.value; return render(); }
    if (!prCanEdit()) return;
    if (el.id === 'pr-file') { var file = el.files && el.files[0]; el.value = ''; if (file) prReadFile(file); return; }
    if (el.hasAttribute('data-prrule')) {
      st.rules[el.getAttribute('data-prrule')] = el.value;
      return el.getAttribute('data-prrule') === 'late_mode' ? render() : prSaveBtn();
    }
    if (el.hasAttribute('data-primpm')) { st.imp.rows[Number(el.getAttribute('data-primpm'))].id = el.value; return render(); }
  });

  /* ---------- دوامي وراتبي ----------
     لكل حساب مربوط بسجل في «بيانات العاملين»: دوامه هو شهرًا بشهر (بحسب مجموعة دوامه)، وسليب راتبه إن اعتُمدت رواتب الشهر.
     البيانات من my_staff_month (supabase/staff_self.sql)، ولا يصل منها إلا ما يخص صاحب الحساب */
  function mineState() {
    if (!ui.mine) ui.mine = { month: todayISO().slice(0, 7) };
    return ui.mine;
  }
  var loadingMine = false;
