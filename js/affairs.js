'use strict';
  /* ---------- إدارة شئون الطلاب ----------
     بحث وقوائم فلترة للطلاب؛ المرور بالفأرة على اسم الطالب يعرض ملخص غيابه، والضغط عليه يفتح صفحته في الشاشة نفسها:
     سجل حضوره وغيابه في الفترة المختارة (طباعة وExcel) وملفه. يراها من يرى الحضور (المدير العام والمدير والمسجِّل والمشرف) */

  var AF_ABS = [['', 'كل الطلاب'], ['1', 'غابوا يومًا فأكثر'], ['3', 'غابوا 3 أيام فأكثر'], ['5', 'غابوا 5 أيام فأكثر'], ['10', 'غابوا 10 أيام فأكثر'], ['0', 'لم يغيبوا']];

  var pendingWarn = null;
  function afUi() { return ui.af || (ui.af = { q: '', cls: '', reg: '', abs: '', ride: '', from: '', to: '', rows: null, loadedFrom: '', loading: false }); }
  function afYearStart() { var m = /(\d{4})/.exec(academicYear()); return (m ? m[1] : String(new Date().getFullYear())) + '-08-01'; }
  function afCurrent() { var m = location.hash.match(/^#\/affairs\/([^/]+)\/(absence|file|warning|consent)$/); return m ? findStudent(m[1]) : null; }
  function afView() { var m = location.hash.match(/\/(absence|file|warning|consent)$/); return m ? m[1] : 'absence'; }

  async function afLoad(from) {
    var u = afUi();
    if (u.loading) return;
    u.loading = true;
    var rows = await fetchAttRange(from, todayISO());
    u.loading = false;
    if (rows) { u.rows = rows; u.loadedFrom = from; u.attErr = false; } else u.attErr = true;
    render();
  }

  // لكل طالب: أيام حضوره وغيابه وإذنه من السجلات المجلوبة، وأيام غيابه بملاحظاتها
  function afAgg() {
    var u = afUi(), per = {};
    (u.rows || []).forEach(function (r) {
      var p = per[r.student_id] || (per[r.student_id] = { present: 0, absent: 0, excused: 0, suspended: 0, abs: [] });
      p[r.status]++;
      if (r.status === 'absent') p.abs.push({ day: r.day, note: r.note || '' });
    });
    return per;
  }

  function renderAffairs() {
    var u = afUi();
    if (!u.from) { u.from = afYearStart(); u.to = todayISO(); }
    if (!u.rows && !u.loading && !u.attErr) { afLoad(u.from); }
    if (location.hash === '#/affairs/lists') { app.innerHTML = '<h1 class="page-title" style="margin:0 0 12px">إدارة شئون الطلاب — قوائم الطلاب</h1>' + slScreen(); return; }
    if (S.stLeaves == null && !S.stLeavesLoading) { S.stLeavesLoading = true; loadStLeaves().then(function () { S.stLeavesLoading = false; if (/^#\/affairs/.test(location.hash)) render(); }); }
    if (location.hash === '#/affairs/suspend') { app.innerHTML = '<h1 class="page-title" style="margin:0 0 12px">إدارة شئون الطلاب — الفصل المؤقت التأديبي</h1>' + spScreen(); return; }
    var cur = afCurrent();
    if (location.hash !== '#/affairs' && !cur) return go('#/affairs');
    app.innerHTML = '<h1 class="page-title" style="margin:0 0 12px">إدارة شئون الطلاب</h1>' + (cur ? (afView() === 'file' ? afFileScreen(cur) : afView() === 'warning' ? afWarnScreen(cur) : afView() === 'consent' ? afConsentScreen(cur) : afAbsenceScreen(cur)) : afListHtml());
  }

  /* ----- الفصل المؤقت التأديبي -----
     فترة فصل لطالب أو أكثر (supabase/student_suspensions.sql): سجل في student_leaves نوعه suspension.
     أيامه تُحفظ «مأذون» تلقائيًا كالإجازة فلا تُحتسب غيابًا، وتظهر في الكشوف «ف». يضيفه ويحذفه المدير العام والمسجِّل */
  function spUi() { return ui.sp || (ui.sp = { q: '', sids: [], from: '', to: '', reason: '', all: false, send: false, text: '' }); }
  var SP_TPL = 'السلام عليكم ورحمة الله وبركاته،\nولي أمر الطالب/ة {الاسم} المحترم،\nنحيطكم علمًا بأنه تقرر فصل ابنكم/ابنتكم فصلًا مؤقتًا من {من} إلى {إلى} بسبب {السبب}.\nيُرجى مراجعة إدارة الأكاديمية.\n{الأكاديمية}';
  function spMsg(u, from, to) {
    var t = (typeof waTpl === 'function' && waTpl('suspension')) || null;
    return (t ? t.body : SP_TPL).replace(/\{من\}/g, dmy(from)).replace(/\{إلى\}/g, dmy(to)).replace(/\{السبب\}/g, u.reason.trim() || '…');
  }
  // كتاب قرار الفصل المؤقت لولي الأمر
  var pendingSp = null;
  function addDaysISO(d, n) { var t = new Date(d + 'T12:00:00'); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); }
  function buildSpSheet(id) {
    var l = (S.stLeaves || []).filter(function (q) { return q.id === id; })[0], x = l && findStudent(l.student_id);
    if (!l || !x) { sheet.className = 'ps'; sheet.innerHTML = '<p>لا بيانات.</p>'; return; }
    var n = Math.round((new Date(l.to_day) - new Date(l.from_day)) / 864e5) + 1, g = x.guardian_name || (x.details && x.details.guardian_name) || '';
    sheet.className = 'ps';
    sheet.removeAttribute('data-fit');
    sheet.innerHTML = reportHead('قرار فصل مؤقت', [['التاريخ', dmy(todayISO())], ['الموضوع', 'فصل مؤقت تأديبي']], { noIssueDate: true }) +
      '<p style="margin:1.1em 0 .2em;font-size:1.1em"><b>السيد/ة ولي أمر الطالب/ة ' + esc(x.full_name) + '</b>' + (x.class_name ? ' — ' + esc(x.class_name) : '') + '</p>' +
      '<p style="margin:0 0 .8em">المحترم/ة،</p><p style="margin:0 0 .8em">تحية طيبة وبعد،</p>' +
      '<p style="margin:0 0 .6em;line-height:1.9">نحيطكم علمًا بأنه تقرر فصل ابنكم/ابنتكم المذكور/ة أعلاه فصلًا مؤقتًا لمدة ' + (n === 1 ? 'يوم واحد' : n === 2 ? 'يومين' : n + (n <= 10 ? ' أيام' : ' يومًا')) + '، من يوم ' + esc(dayName(l.from_day)) + ' ' + dmy(l.from_day) + ' إلى يوم ' + esc(dayName(l.to_day)) + ' ' + dmy(l.to_day) + '، وذلك بسبب: <b>' + esc(l.reason) + '</b>.</p>' +
      '<p style="margin:0 0 .6em;line-height:1.9">ويعود الطالب/ة إلى الدوام بعد انتهاء مدة الفصل، ونرجو مراجعة إدارة الأكاديمية ومتابعة سلوك ابنكم/ابنتكم حرصًا على مصلحته/ا.</p>' +
      '<p style="margin:.8em 0 0">وتفضلوا بقبول فائق الاحترام والتقدير،،،</p>' +
      reportSigns([['مدير/ة الأكاديمية', principalName()], ['ولي الأمر (إقرار بالاستلام)', g]]);
    fitSheet();
  }
  function spActive() { var t = todayISO(); return (S.stLeaves || []).filter(function (l) { return l.kind === 'suspension' && l.from_day <= t && t <= l.to_day; }).length; }
  function spMatches() {
    var u = spUi(), words = norm(u.q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return S.students.filter(function (x) {
      if (!enrolled(x) || u.sids.indexOf(x.id) > -1) return false;
      var n = norm(x.full_name);
      return words.every(function (w) { return n.indexOf(w) > -1; });
    }).slice(0, 12);
  }
  function spScreen() {
    var back = '<div class="toolbar"><a class="btn" href="#/affairs">→ رجوع إلى شئون الطلاب</a></div>';
    if (S.stLeaves == null) return back + '<div class="card empty">جارٍ التحميل…</div>';
    if (S.stSuspMissing) return back + '<div class="card empty">الفصل المؤقت يحتاج تحديثًا في قاعدة البيانات.<br>' + (isAdmin() ? 'شغّل الملف <code dir="ltr">supabase/student_suspensions.sql</code> في محرر SQL، ثم حدّث الصفحة.' : 'يشغّل المدير العام الملف <code dir="ltr">supabase/student_suspensions.sql</code>.') + '</div>';
    var u = spUi(), edit = canEditDisc(), today = todayISO(), m = spMatches();
    var list = S.stLeaves.filter(function (l) { return l.kind === 'suspension' && (u.all || l.to_day >= today); });
    return back + '<div class="card"><h2>فصل مؤقت تأديبي</h2>' +
      '<p class="hint" style="margin:0">الطالب المفصول يُسجَّل تلقائيًا في كل أيام فصله، في الموقع وتطبيق الموبايل، ويظهر في كشوف الحضور بعلامة «ف»، ولا يُحتسب ضمن أيام الغياب ولا في إنذارات الغياب.</p>' +
      (edit ? '<div class="toolbar" style="align-items:flex-end;margin-top:10px">' +
        '<div style="flex:2;min-width:240px"><label class="field" for="sp-q">الطلاب (اختر واحدًا أو أكثر)</label>' +
          (u.sids.length ? '<div class="toolbar" style="margin:0 0 6px;gap:6px">' + u.sids.map(function (id) { var x = findStudent(id) || {}; return '<span class="badge unpaid" style="display:inline-flex;gap:6px;align-items:center">' + esc(x.full_name || '') + ' <button type="button" data-spun="' + id + '" title="إزالة" style="border:0;background:none;cursor:pointer;font-weight:700">×</button></span>'; }).join('') + '</div>' : '') +
          '<input type="search" id="sp-q" autocomplete="off" placeholder="اكتب جزءًا من الاسم (الأول أو الأخير…)" value="' + esc(u.q) + '">' +
          (u.q.trim() ? '<div style="border:1px solid var(--line);border-radius:8px;margin-top:4px;max-height:240px;overflow:auto;background:var(--surface)">' + (m.length ? m.map(function (x) { return '<button type="button" class="btn" style="display:block;width:100%;text-align:right;border:0;border-radius:0" data-sppick="' + x.id + '">' + esc(x.full_name) + ' <span class="meta">— ' + esc(x.class_name || '') + '</span></button>'; }).join('') : '<div class="hint" style="padding:8px;margin:0">لا أسماء مطابقة.</div>') + '</div>' : '') + '</div>' +
        '<div><label class="field" for="sp-from">من</label><input type="date" id="sp-from" value="' + esc(u.from || today) + '"></div>' +
        '<div><label class="field" for="sp-to">إلى</label><input type="date" id="sp-to" value="' + esc(u.to || u.from || today) + '"></div>' +
        '<div style="flex:2;min-width:200px"><label class="field" for="sp-reason">سبب الفصل <span class="req">*</span></label><input type="text" id="sp-reason" value="' + esc(u.reason) + '" placeholder="مثال: مشاجرة داخل الصف"></div></div>' +
        '<div style="margin-top:10px"><label class="check" style="margin:0"><input type="checkbox" id="sp-send"' + (u.send ? ' checked' : '') + '> إرسال رسالة واتساب لولي الأمر (على جوال ولي الأمر)</label>' +
          (u.send ? '<textarea id="sp-text" rows="6" style="margin-top:6px">' + esc(u.text || spMsg(u, u.from || today, u.to || u.from || today)) + '</textarea><p class="hint" style="margin:4px 0 0">النص من قالب «فصل طالب» في «رسائل واتساب ← القوالب». {الاسم} و{الأكاديمية} تُستبدل عند الإرسال.</p>' : '') + '</div>' +
        '<div class="actions" style="margin-top:8px"><button type="button" class="btn primary" data-spadd>تسجيل الفصل المؤقت</button></div>' : '') +
      '<div class="toolbar" style="margin:12px 0 0;align-items:center"><label class="check" style="margin:0"><input type="checkbox" id="sp-all" data-ro-ok' + (u.all ? ' checked' : '') + '> عرض الفصل المنتهي أيضًا</label></div>' +
      (list.length ? '<div class="table-wrap"><table class="grid"><thead><tr><th>الطالب</th><th>الشعبة</th><th>من</th><th>إلى</th><th>الأيام</th><th>السبب</th><th>سجّله</th><th></th></tr></thead><tbody>' +
        list.map(function (l) {
          var x = findStudent(l.student_id), n = Math.round((new Date(l.to_day) - new Date(l.from_day)) / 864e5) + 1;
          return '<tr><td><b>' + esc(x ? x.full_name : '—') + '</b>' + (l.from_day <= today && today <= l.to_day ? ' <span class="badge unpaid">مفصول اليوم</span>' : l.from_day > today ? ' <span class="badge pending">لم يبدأ</span>' : '') + '</td><td>' + esc(x ? x.class_name || '' : '') + '</td><td>' + dmy(l.from_day) + '</td><td>' + dmy(l.to_day) + '</td><td>' + n + '</td><td>' + esc(l.reason) + '</td><td>' + esc(l.created_by || '') + '</td>' +
            '<td style="white-space:nowrap"><button type="button" class="btn" data-ro-ok data-spprint="' + l.id + '">كتاب الفصل</button> ' +
              (edit && l.from_day < today && l.to_day >= today ? '<button type="button" class="btn" data-spend="' + l.id + '">إنهاء اليوم</button> ' : '') +
              (edit ? '<button type="button" class="btn danger" data-spdel="' + l.id + '">حذف</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty" style="margin-top:8px">لا فصل مؤقت ' + (u.all ? 'مسجَّل' : 'حالي أو قادم') + '.</div>') + '</div>';
  }
  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/affairs/suspend') return;
    var el, u = spUi();
    if ((el = e.target.closest('[data-spprint]'))) { pendingSp = el.getAttribute('data-spprint'); return printNow(); }
    if (!canEditDisc()) return;
    if ((el = e.target.closest('[data-spend]'))) {
      var eid = el.getAttribute('data-spend'), el2 = S.stLeaves.filter(function (q) { return q.id === eid; })[0], y = addDaysISO(todayISO(), -1);
      if (!el2 || !confirm('إنهاء فصل ' + ((findStudent(el2.student_id) || {}).full_name || '') + ' اليوم؟ يعود الطالب إلى الدوام من اليوم، ويبقى الفصل مسجَّلًا حتى ' + dmy(y) + '.')) return;
      var ur = await sb.from('student_leaves').update({ to_day: y }).eq('id', eid).select();
      if (ur.error) return fail(ur.error);
      el2.to_day = y; S.attDay = {};
      render();
      return toast('انتهى الفصل. يُسجَّل الطالب في الحضور من اليوم كالمعتاد.');
    }
    if ((el = e.target.closest('[data-sppick]'))) { u.sids.push(el.getAttribute('data-sppick')); u.q = ''; render(); var qf = document.getElementById('sp-q'); if (qf) qf.focus(); return; }
    if ((el = e.target.closest('[data-spun]'))) { u.sids = u.sids.filter(function (id) { return id !== el.getAttribute('data-spun'); }); return render(); }
    if (e.target.closest('[data-spadd]')) {
      var sids = u.sids.slice(), from = document.getElementById('sp-from').value, to = document.getElementById('sp-to').value, reason = u.reason.trim();
      if (!sids.length) return toast('اختر طالبًا واحدًا على الأقل', true);
      if (!from || !to || to < from) return toast('اختر فترة صحيحة', true);
      if (!reason) return toast('اكتب سبب الفصل', true);
      var nm = sids.length === 1 ? (findStudent(sids[0]) || {}).full_name : sids.length + ' طلاب';
      if (!confirm('تسجيل فصل مؤقت لـ' + nm + ' من ' + dmy(from) + ' إلى ' + dmy(to) + '؟')) return;
      var by = (S.profile && S.profile.full_name) || displayName(S.email);
      var r = await sb.from('student_leaves').insert(sids.map(function (sid) { return { student_id: sid, from_day: from, to_day: to, reason: reason, kind: 'suspension', created_by: by }; })).select();
      if (r.error) return fail(r.error);
      S.stLeaves = (r.data || []).concat(S.stLeaves);
      S.attDay = {}; // الأيام المسجَّلة داخل الفصل صارت «مأذون» في القاعدة
      if (ui.af) ui.af.rows = null;
      var text = u.send ? (u.text || spMsg(u, from, to)) : '';
      ui.sp = null;
      render();
      toast('سُجِّل الفصل المؤقت لـ' + nm);
      if (text) {
        var w = await sb.functions.invoke('send-whatsapp', { body: { action: 'send', batch_id: 'susp-' + r.data[0].id, kind: 'suspension', title: 'فصل مؤقت', text: text, student_ids: sids, per: 'student', school: schoolName() } });
        var wd = w.data || {};
        if (w.error || wd.error) return toast('حُفظ الفصل، لكن تعذّر إرسال الرسالة: ' + (wd.error || w.error.message), true);
        toast('أُضيفت رسالة الفصل إلى قائمة الإرسال. تابعها في «رسائل واتساب».');
      }
      return;
    }
    if ((el = e.target.closest('[data-spdel]'))) {
      var id = el.getAttribute('data-spdel'), l = S.stLeaves.filter(function (q) { return q.id === id; })[0];
      if (!l || !confirm('حذف فصل ' + ((findStudent(l.student_id) || {}).full_name || '') + '؟ (ما سُجِّل في أيامه يبقى «مأذون» كما هو، ويُعدَّل يدويًا من الحضور إن لزم)')) return;
      var d = await sb.from('student_leaves').delete().eq('id', id);
      if (d.error) return fail(d.error);
      S.stLeaves = S.stLeaves.filter(function (q) { return q.id !== id; });
      render();
    }
  });
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/affairs/suspend') return;
    var u = spUi(), id = e.target.id;
    if (id === 'sp-all') { u.all = e.target.checked; return render(); }
    if (id === 'sp-send') { u.send = e.target.checked; return render(); }
    if (id === 'sp-from') { u.from = e.target.value; if (!u.to || u.to < u.from) u.to = u.from; return render(); }
    if (id === 'sp-to') u.to = e.target.value;
  });
  document.addEventListener('input', function (e) {
    if (location.hash !== '#/affairs/suspend') return;
    var u = spUi(), id = e.target.id;
    if (id === 'sp-reason') { u.reason = e.target.value; return; }
    if (id === 'sp-text') { u.text = e.target.value; return; }
    if (id === 'sp-q') { var pos = e.target.selectionStart; u.q = e.target.value; render(); var q = document.getElementById('sp-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} } }
  });

  /* ----- قوائم الطلاب (عامة) -----
     قائمة بعنوان (مثل «تطعيم الحصبة») يُختار فيها الطلاب (من وافق)، وتُطبع كشفًا حسب الشعبة للمختارين أو لغير المختارين.
     تصلح لأي غرض: تطعيم، رحلة، نشاط، استلام كتب. يعدّلها المدير العام والمسجِّل (supabase/student_lists.sql) */
  function slState() { return S.sl || (S.sl = { list: [], loaded: false, loading: false, missing: false, open: '', sel: null, dirty: false, cls: '', q: '', show: '', perPage: true, newTitle: '' }); }
  function slCanEdit() { return isAdmin() || isRegistrar(); }
  async function slLoad() {
    var c = slState();
    if (c.loading) return;
    c.loading = true;
    var rows = await fetchAll(function () { return sb.from('student_lists').select('*').order('created_at', { ascending: false }); });
    c.loading = false; c.loaded = true; c.missing = !rows; c.list = rows || [];
    render();
  }
  function slCur() { var c = slState(); return c.list.filter(function (x) { return x.id === c.open; })[0]; }
  function slStudents() {
    var order = attClasses();
    return S.students.filter(enrolled).slice().sort(function (a, b) {
      var ia = order.indexOf(a.class_name || ''), ib = order.indexOf(b.class_name || '');
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || String(a.full_name).localeCompare(String(b.full_name), 'ar');
    });
  }
  function slShown() {
    var c = slState(), q = norm(c.q);
    return slStudents().filter(function (x) {
      if (c.cls && (x.class_name || '') !== c.cls) return false;
      if (c.show === 'yes' && !c.sel[x.id]) return false;
      if (c.show === 'no' && c.sel[x.id]) return false;
      return !q || norm(x.full_name).indexOf(q) > -1;
    });
  }
  function slScreen() {
    var c = slState(), edit = slCanEdit();
    if (!c.loaded) { slLoad(); return '<div class="card empty">جارٍ التحميل…</div>'; }
    if (c.missing) return '<div class="card empty">قوائم الطلاب تحتاج جدولًا جديدًا.<br>شغّل الملف <code dir="ltr">supabase/student_lists.sql</code> في محرر SQL، ثم حدّث الصفحة.</div>';
    var back = '<div class="toolbar"><a class="btn" href="#/affairs">→ رجوع إلى شئون الطلاب</a></div>';
    var L = slCur();
    if (!L) {
      return back + '<div class="card"><h2 style="margin-top:0">قوائم الطلاب</h2><p class="hint" style="margin:0">قائمة لأي غرض (موافقة على تطعيم، رحلة، نشاط…): تختار فيها الطلاب، ثم تطبع كشفًا بأسمائهم حسب الشعبة، للمختارين أو لغير المختارين.</p>' +
        (edit ? '<div class="toolbar" style="margin-top:10px"><input type="text" id="sl-new" placeholder="عنوان القائمة، مثل: الموافقون على تطعيم الحصبة" style="flex:1;min-width:240px" value="' + esc(c.newTitle) + '"><button type="button" class="btn primary" data-slnew>إنشاء قائمة</button></div>' : '') +
        (c.list.length ? '<div class="table-wrap" style="margin-top:10px"><table class="grid"><thead><tr><th>القائمة</th><th>المختارون</th><th>التاريخ</th><th></th></tr></thead><tbody>' +
          c.list.map(function (x) {
            return '<tr><td><b>' + esc(x.title) + '</b></td><td>' + (x.student_ids || []).length + '</td><td>' + dmy(x.created_at) + '</td><td style="white-space:nowrap"><button type="button" class="btn primary" data-slopen="' + x.id + '">فتح</button>' +
              (edit ? ' <button type="button" class="btn" data-slren="' + x.id + '">إعادة تسمية</button> <button type="button" class="btn danger" data-sldel="' + x.id + '">حذف</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">لا توجد قوائم بعد.</div>') + '</div>';
    }
    if (!c.sel) { c.sel = {}; (L.student_ids || []).forEach(function (id) { c.sel[id] = true; }); }
    var all = slStudents(), yes = all.filter(function (x) { return c.sel[x.id]; }).length, shown = slShown();
    var opt = function (v, t, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(t) + '</option>'; };
    return back + '<div class="card"><div class="toolbar" style="align-items:center;margin:0"><h2 style="margin:0;flex:1">' + esc(L.title) + '</h2>' +
        (edit ? '<button type="button" class="btn primary" data-slsave' + (c.dirty ? '' : ' disabled') + '>' + (c.dirty ? 'حفظ التغييرات' : 'محفوظة') + '</button>' : '') + '<button type="button" class="btn" data-slclose>كل القوائم</button></div>' +
      '<p class="hint" style="margin:6px 0 0">المختارون (' + esc(L.yes_label) + '): <b>' + yes + '</b> — غير المختارين (' + esc(L.no_label) + '): <b>' + (all.length - yes) + '</b> من ' + all.length + ' طالبًا مسجلًا.</p>' +
      (edit ? '<div class="toolbar" style="margin:8px 0 0;align-items:center"><label class="field" for="sl-yes" style="margin:0">وصف المختارين</label><input type="text" id="sl-yes" value="' + esc(L.yes_label) + '" style="width:9em"><label class="field" for="sl-no" style="margin:0">وصف غير المختارين</label><input type="text" id="sl-no" value="' + esc(L.no_label) + '" style="width:9em"></div>' : '') +
      '<div class="toolbar" style="margin:10px 0 0;align-items:center"><b>طباعة كشف حسب الشعبة:</b>' +
        '<button type="button" class="btn" data-slprint="yes" data-ro-ok>' + esc(L.yes_label) + ' / PDF</button><button type="button" class="btn" data-slprint="no" data-ro-ok>' + esc(L.no_label) + ' / PDF</button><button type="button" class="btn" data-slprint="all" data-ro-ok>الكل مع الحالة / PDF</button>' +
        '<label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="sl-pp"' + (c.perPage ? ' checked' : '') + '> كل شعبة في صفحة</label>' +
        (c.cls ? '<span class="hint">(الشعبة المختارة فقط: ' + esc(c.cls) + ')</span>' : '') + '</div></div>' +
      '<div class="card"><div class="toolbar" style="align-items:center;margin:0">' +
        '<input type="search" id="sl-q" placeholder="ابحث بالاسم" style="flex:1;min-width:200px" value="' + esc(c.q) + '">' +
        '<select id="sl-cls" style="width:auto">' + opt('', 'كل الشعب', c.cls) + attClasses().map(function (n) { return opt(n, n, c.cls); }).join('') + '</select>' +
        '<select id="sl-show" style="width:auto">' + opt('', 'الكل', c.show) + opt('yes', 'المختارون فقط', c.show) + opt('no', 'غير المختارين فقط', c.show) + '</select>' +
        (edit ? '<button type="button" class="btn" data-slall="1">تحديد الظاهرين</button><button type="button" class="btn" data-slall="0">إلغاء تحديد الظاهرين</button>' : '') + '</div>' +
      (shown.length ? '<div class="table-wrap" style="margin-top:8px"><table class="grid"><thead><tr><th style="width:3em">✓</th><th>م</th><th>الطالب</th><th>الشعبة</th></tr></thead><tbody>' +
        shown.map(function (x, i) {
          return '<tr><td><input type="checkbox" data-slpick="' + x.id + '"' + (c.sel[x.id] ? ' checked' : '') + (edit ? '' : ' disabled') + ' aria-label="' + esc(x.full_name) + '"></td><td>' + (i + 1) + '</td><td><b>' + esc(x.full_name) + '</b></td><td>' + esc(x.class_name || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">لا طلاب مطابقون.</div>') + '</div>';
  }

  var pendingSl = null;
  // كشف القائمة: لكل شعبة عنوانها وعددها ثم الأسماء، مع عمود للحالة في «الكل»، وعمود فارغ للملاحظات
  function buildSlSheet(p) {
    var c = slState(), L = slCur(), mode = p.mode;
    var rows = slStudents().filter(function (x) { return (!c.cls || (x.class_name || '') === c.cls) && (mode === 'all' || (mode === 'yes' ? c.sel[x.id] : !c.sel[x.id])); });
    var groups = [], by = {};
    rows.forEach(function (x) { var k = x.class_name || 'بلا شعبة'; if (!by[k]) { by[k] = []; groups.push(k); } by[k].push(x); });
    var n = mode === 'all' ? 4 : 3, label = mode === 'yes' ? L.yes_label : mode === 'no' ? L.no_label : 'الكل';
    var head = reportHead(L.title, [['الكشف', label], ['العدد', rows.length]].concat(c.cls ? [['الشعبة', c.cls]] : [])).replace(/^<img class="wm"[^>]*>/, '');
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    var thHead = function (h) {
      return '<thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + h + '</td></tr>' +
        '<tr><th style="width:3em">م</th><th>اسم الطالب</th>' + (mode === 'all' ? '<th style="width:8em">الحالة</th>' : '') + '<th style="width:30%">ملاحظات</th></tr></thead>';
    };
    var body = function (g) {
      return '<tr class="total"><td colspan="' + n + '">الشعبة: ' + esc(g) + ' — العدد: ' + by[g].length + '</td></tr>' +
        by[g].map(function (x, i) { return '<tr><td class="c">' + (i + 1) + '</td><td><b>' + esc(x.full_name) + '</b></td>' + (mode === 'all' ? '<td class="c">' + esc(c.sel[x.id] ? L.yes_label : L.no_label) + '</td>' : '') + '<td></td></tr>'; }).join('');
    };
    var foot = '<tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot>';
    var signs = reportSigns([['شئون الطلاب', ''], ['مدير/ة الأكاديمية', principalName()]]);
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' + (c.perPage && groups.length > 1
      // كل شعبة جدول مستقل يبدأ صفحة جديدة: ترويسته باسم الشعبة وعددها، وتوقيعاته تحته
      ? groups.map(function (g, gi) {
          var h = reportHead(L.title, [['الكشف', label], ['الشعبة', g], ['العدد', by[g].length]]).replace(/^<img class="wm"[^>]*>/, '');
          return '<div' + (gi ? ' style="break-before:page;page-break-before:always"' : '') + '><table class="rz">' + thHead(h) + '<tbody>' + body(g) + '</tbody>' + foot + '</table>' + signs + '</div>';
        }).join('')
      : '<table class="rz">' + thHead(head) + '<tbody>' + groups.map(body).join('') + '</tbody>' + foot + '</table>' + signs);
  }

  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/affairs/lists') return;
    var el, c = slState(), L = slCur();
    if ((el = e.target.closest('[data-slopen]'))) { c.open = el.getAttribute('data-slopen'); c.sel = null; c.dirty = false; c.show = ''; scrollTo(0, 0); return render(); }
    if (e.target.closest('[data-slclose]')) { if (c.dirty && !confirm('لم تُحفظ التغييرات. الخروج بدون حفظ؟')) return; c.open = ''; c.sel = null; c.dirty = false; return render(); }
    if ((el = e.target.closest('[data-slprint]'))) { pendingSl = { mode: el.getAttribute('data-slprint') }; return printNow(); }
    if (!slCanEdit()) return;
    if (e.target.closest('[data-slnew]')) {
      var t = c.newTitle.trim();
      if (!t) return toast('اكتب عنوان القائمة', true);
      var r = await sb.from('student_lists').insert({ title: t, created_by: (S.profile && S.profile.full_name) || displayName(S.email) }).select().single();
      if (r.error) return fail(r.error);
      c.list.unshift(r.data); c.newTitle = ''; c.open = r.data.id; c.sel = null; c.dirty = false;
      return render();
    }
    if ((el = e.target.closest('[data-slren]'))) {
      var x = c.list.filter(function (q) { return q.id === el.getAttribute('data-slren'); })[0], nt = x && prompt('العنوان الجديد', x.title);
      if (!nt || !nt.trim()) return;
      var u = await sb.from('student_lists').update({ title: nt.trim(), updated_at: new Date().toISOString() }).eq('id', x.id);
      if (u.error) return fail(u.error);
      x.title = nt.trim(); return render();
    }
    if ((el = e.target.closest('[data-sldel]'))) {
      var y = c.list.filter(function (q) { return q.id === el.getAttribute('data-sldel'); })[0];
      if (!y || !confirm('حذف القائمة «' + y.title + '»؟')) return;
      var d = await sb.from('student_lists').delete().eq('id', y.id);
      if (d.error) return fail(d.error);
      c.list = c.list.filter(function (q) { return q.id !== y.id; }); return render();
    }
    if (!L) return;
    if ((el = e.target.closest('[data-slall]'))) { var on = el.getAttribute('data-slall') === '1'; slShown().forEach(function (s1) { if (on) c.sel[s1.id] = true; else delete c.sel[s1.id]; }); c.dirty = true; return render(); }
    if (e.target.closest('[data-slsave]')) {
      var valid = {}; slStudents().forEach(function (s2) { valid[s2.id] = 1; });
      var ids = Object.keys(c.sel).filter(function (id) { return c.sel[id]; });
      var keep = (L.student_ids || []).filter(function (id) { return !valid[id]; }); // طلاب انسحبوا يبقون كما كانوا
      var patch = { student_ids: keep.concat(ids), yes_label: L.yes_label, no_label: L.no_label, updated_at: new Date().toISOString() };
      var w = await sb.from('student_lists').update(patch).eq('id', L.id);
      if (w.error) return fail(w.error);
      Object.assign(L, patch); c.dirty = false; render(); toast('حُفظت القائمة');
    }
  });
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/affairs/lists') return;
    var c = slState(), L = slCur(), el = e.target, id;
    if ((id = el.getAttribute('data-slpick')) && slCanEdit()) { if (el.checked) c.sel[id] = true; else delete c.sel[id]; c.dirty = true; return render(); }
    if (el.id === 'sl-cls') { c.cls = el.value; return render(); }
    if (el.id === 'sl-show') { c.show = el.value; return render(); }
    if (el.id === 'sl-pp') { c.perPage = el.checked; return; }
    if (L && (el.id === 'sl-yes' || el.id === 'sl-no') && el.value.trim()) { L[el.id === 'sl-yes' ? 'yes_label' : 'no_label'] = el.value.trim(); c.dirty = true; return render(); }
  });
  document.addEventListener('input', function (e) {
    if (location.hash !== '#/affairs/lists') return;
    var c = slState();
    if (e.target.id === 'sl-new') { c.newTitle = e.target.value; return; }
    if (e.target.id === 'sl-q') { var pos = e.target.selectionStart; c.q = e.target.value; render(); var q = document.getElementById('sl-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} } }
  });

  /* ----- موافقة ولي الأمر -----
     نموذج موافقة يُكتب موضوعه (مثل «تطعيم الحصبة الألمانية») ويُطبع لطالب واحد، أو لكل الطلاب الظاهرين في البحث في ملف PDF واحد.
     في النموذج اسم الطالب وصفه، والموضوع، وتنبيه بأن عدم الرد رفض، وخانتا «أوافق / لا أوافق» واسم ولي الأمر ورقم جواله وتوقيعه.
     يُطبع نموذجان في الصفحة (بخط قصّ بينهما) أو نموذج واحد، بحسب الاختيار */
  var AF_CONSENT_NOTE = 'علمًا بأنه في حالة عدم الرد أو وضع علامة بدون توقيع يُعتبر ذلك رفضًا منكم وعلى مسؤوليتكم الشخصية، وفي حالة الرفض نرجو إحضار ما يثبت ذلك.';
  var pendingConsent = null;
  function afConsent() { var u = afUi(); return u.consent || (u.consent = { topic: '', note: AF_CONSENT_NOTE, per: '2' }); }

  function afConsentFields() {
    var c = afConsent();
    return '<div class="grid2" style="margin-top:10px">' +
      '<div style="grid-column:1/-1"><label class="field" for="afc-topic">موضوع الموافقة (يُكتب بعد «سيتم»)</label><input type="text" id="afc-topic" data-ro-ok autocomplete="off" placeholder="مثال: تطعيم الحصبة الألمانية (التطعيم الثاني)" value="' + esc(c.topic) + '"></div>' +
      '<div style="grid-column:1/-1"><label class="field" for="afc-note">التنبيه أسفل الموضوع</label><textarea id="afc-note" data-ro-ok rows="2">' + esc(c.note) + '</textarea></div>' +
      '<div><label class="field" for="afc-per">النماذج في الصفحة</label><select id="afc-per" data-ro-ok><option value="2"' + (c.per === '2' ? ' selected' : '') + '>نموذجان (بخط قصّ بينهما)</option><option value="3"' + (c.per === '3' ? ' selected' : '') + '>3 نماذج</option><option value="4"' + (c.per === '4' ? ' selected' : '') + '>4 نماذج</option><option value="1"' + (c.per === '1' ? ' selected' : '') + '>نموذج واحد بترويسة كاملة</option></select></div></div>';
  }

  function afConsentCardHtml(count) {
    return '<div class="card"><h2>موافقة ولي الأمر</h2><p class="hint" style="margin:0">اكتب موضوع الموافقة ثم اطبعها لكل الطلاب الظاهرين في النتائج بملف PDF واحد، أو لطالب بعينه من «موافقة ولي الأمر» تحت اسمه.</p>' +
      afConsentFields() + '<div class="actions"><span id="afc-batch" style="display:contents">' + afConsentBatchBtn(count) + '</span><button type="button" class="btn" data-afcblank data-ro-ok>طباعة نموذج فارغ بلا اسم (يُكتب باليد) / PDF</button></div></div>';
  }
  function afConsentBatchBtn(count) {
    return '<button type="button" class="btn primary" data-afcbatch data-ro-ok' + (count ? '' : ' disabled') + '>طباعة موافقة ولي الأمر لكل المعروضين' + (count ? ' (' + count + ' طالبًا) ' : '') + '/ PDF</button>' + (count ? '' : '<span class="hint" style="margin:0">اختر شعبة أو ابحث ليظهر الطلاب.</span>');
  }
  function afConsentScreen(x) {
    return afHead(x, 'موافقة ولي الأمر') + '<div class="card"><p class="hint" style="margin:0">تُطبع الموافقة لهذا الطالب وحده بالبيانات الآتية.</p>' + afConsentFields() +
      '<div class="actions"><button type="button" class="btn primary" data-afcprint="' + x.id + '" data-ro-ok>طباعة موافقة ولي الأمر / PDF</button></div></div>';
  }

  // نموذج الموافقة: per نماذج في الصفحة (1 بترويسة كاملة، 2، 3، 4)؛ من 3 فما فوق يُضغط التخطيط وتصغر الخطوط لتتسع في الصفحة
  var AF_CONSENT_SIZE = { 1: { h: 255, wm: 120, font: 11 }, 2: { h: 124, wm: 80, font: 11 }, 3: { h: 83, wm: 55, font: 10 }, 4: { h: 61, wm: 42, font: 8.4 } };
  function afConsentForm(x, c, per) {
    var year = academicYear(), dots = '..................................', Z = AF_CONSENT_SIZE[per] || AF_CONSENT_SIZE[2], dense = per >= 3, full = per === 1;
    var m = dense ? '.28em' : '.45em';
    var line = function (v) { return '<span style="flex:1;border-bottom:1px dotted #555;min-height:1.2em">' + (v == null ? '' : v) + '</span>'; };
    var row = function (k, v) { return '<div style="display:flex;gap:.5em;margin:' + m + ' 0;align-items:baseline"><span>' + k + '</span>' + line(v) + '</div>'; };
    var pair = function (k1, v1, k2, v2, w1) { return '<div style="display:flex;gap:1.2em;margin:' + m + ' 0;align-items:baseline"><span style="flex:' + (w1 || 1) + ';display:flex;gap:.4em;align-items:baseline"><span>' + k1 + '</span>' + line(v1) + '</span><span style="flex:1;display:flex;gap:.4em;align-items:baseline"><span>' + k2 + '</span>' + line(v2) + '</span></div>'; };
    var topic = '<b>' + (c.topic ? esc(c.topic) : dots) + '</b>', cls = '<b>' + esc(x.class_name || dots) + '</b>';
    return '<div class="afc-form" style="position:relative;height:' + Z.h + 'mm;font-size:' + Z.font + 'pt;line-height:1.5;box-sizing:border-box;padding:' + (dense ? '1mm 3mm' : '2mm 4mm') + ';overflow:hidden">' +
      '<img class="wm" src="' + REPORT.logo + '" alt="" style="position:absolute;width:' + Z.wm + 'mm">' +
      (full ? letterhead() : '<div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:1.5pt solid var(--gold);padding-bottom:.15em;margin-bottom:.3em"><b style="font-size:1.1em;color:var(--navy)">' + esc(schoolName()) + '</b><span>العام الدراسي ' + esc(year) + '</span></div>') +
      '<div style="text-align:center;font-family:var(--font-head);font-weight:800;font-size:' + (full ? '1.5em' : dense ? '1.15em' : '1.25em') + ';color:var(--navy);margin:.1em 0 ' + (dense ? '.15em' : '.35em') + '">موافقة ولي الأمر</div>' +
      (dense ? pair('السيد ولي أمر الطالب/ة (الاسم رباعي):', '<b>' + esc(x.full_name) + '</b>', 'الصف:', '<b>' + esc(x.class_name || '') + '</b>', 3)
        : pair('السيد ولي أمر الطالب / الطالبة (الاسم رباعي):', '<b>' + esc(x.full_name) + '</b>', 'الصف:', '<b>' + esc(x.class_name || '') + '</b>', 3)) +
      '<p style="margin:' + m + ' 0;line-height:' + (dense ? '1.6' : '1.9') + '">نحيط علم سيادتكم بأنه سيتم ' + topic + ' لطلبة / وطالبات الصف (' + cls + ') بالأكاديمية للعام الدراسي <b>' + esc(year) + '</b>.</p>' +
      '<p style="margin:' + m + ' 0;line-height:' + (dense ? '1.6' : '1.9') + '">' + esc(c.note) + '</p>' +
      (dense
        ? '<div style="display:flex;gap:2em;margin:' + m + ' 0;font-weight:700;align-items:baseline"><span>☐ أوافق</span><span>☐ لا أوافق</span></div>' + pair('اسم ولي الأمر:', '', 'رقم الموبايل:', '') + row('توقيع ولي الأمر:', '')
        : '<div style="display:flex;gap:3em;margin:.5em 0;font-weight:700"><span>☐ أوافق</span><span>☐ لا أوافق</span></div>' + row('اسم ولي الأمر:', '') + row('رقم الموبايل:', '') + row('توقيع ولي الأمر:', '')) +
      '</div>';
  }

  function buildConsentSheet(list) {
    var c = afConsent(), per = Math.max(1, Math.min(4, Number(c.per) || 2)), pages = '';
    for (var i = 0; i < list.length; i += per) {
      var chunk = list.slice(i, i + per), last = i + per >= list.length;
      pages += '<section style="' + (last ? '' : 'break-after:page;page-break-after:always;') + '">' +
        chunk.map(function (x, k) { return (k ? '<div class="rc-cut">✂</div>' : '') + afConsentForm(x, c, per); }).join('') + '</section>';
    }
    sheet.className = 'ps';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.innerHTML = pages || '<p>لا طلاب.</p>';
  }

  document.addEventListener('input', function (e) {
    if (!/^#\/affairs/.test(location.hash)) return;
    var k = { 'afc-topic': 'topic', 'afc-note': 'note' }[e.target.id];
    if (k) afConsent()[k] = e.target.value;
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'afc-per' && /^#\/affairs/.test(location.hash)) afConsent().per = e.target.value;
  });
  document.addEventListener('click', function (e) {
    if (!/^#\/affairs/.test(location.hash) || !canAttView()) return;
    var el;
    if (e.target.closest('[data-afcbatch]')) { var list = afFiltered(afAgg()); if (!list.length) return; pendingConsent = list; return printNow(); }
    if (e.target.closest('[data-afcblank]')) { var per = Math.max(1, Math.min(4, Number(afConsent().per) || 2)), blank = []; for (var b = 0; b < per; b++) blank.push({ full_name: '', class_name: '' }); pendingConsent = blank; return printNow(); }
    if ((el = e.target.closest('[data-afcprint]'))) { var x = findStudent(el.getAttribute('data-afcprint')); if (x) { pendingConsent = [x]; return printNow(); } }
  });

  // العمر بالسنوات الكاملة اليوم من تاريخ الميلاد (null إن لم يُسجَّل)
  function afAge(x) {
    var b = String(stVal(x, 'birth_date') || x.birth_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
    var t = todayISO(), age = Number(t.slice(0, 4)) - Number(b.slice(0, 4));
    if (t.slice(5) < b.slice(5)) age--;
    return age >= 0 ? age : null;
  }
  function afAgeText(x) { var a = afAge(x); return a == null ? '—' : a + (a >= 3 && a <= 10 ? ' سنوات' : ' سنة'); }
  function afHas(v) { return v !== '' && v != null; }
  function afShown() { var u = afUi(); return !!(u.cls || u.q.trim() || afHas(u.ageFrom) || afHas(u.ageTo)); }

  function afFiltered(per) {
    var u = afUi(), q = norm(u.q), digits = latinDigits(u.q).replace(/\D/g, ''), groupOf = u.ride ? transportGroupOf() : null;
    return S.students.filter(function (x) {
      var st = stStatus(x);
      if (st !== 'final' && st !== 'reserve') return false;
      if (u.cls && x.class_name !== u.cls) return false;
      if (u.reg && st !== u.reg) return false;
      if (afHas(u.ageFrom) || afHas(u.ageTo)) {
        var ag = afAge(x);
        if (ag == null) return false;
        if (afHas(u.ageFrom) && ag < Number(u.ageFrom)) return false;
        if (afHas(u.ageTo) && ag > Number(u.ageTo)) return false;
      }
      if (u.ride === 'yes' && !groupOf[x.id]) return false;
      if (u.ride === 'no' && groupOf[x.id]) return false;
      if (u.abs !== '') {
        var n = (per[x.id] || {}).absent || 0;
        if (u.abs === '0' ? n > 0 : n < Number(u.abs)) return false;
      }
      if (!q) return true;
      return norm(x.full_name).indexOf(q) > -1 || (digits && (String(x.national_id || '').indexOf(digits) > -1 || String(x.phone || '').indexOf(digits) > -1 || String(x.whatsapp || '').indexOf(digits) > -1));
    }).sort(function (a, b) { return classRank(a.class_name) - classRank(b.class_name) || a.full_name.localeCompare(b.full_name, 'ar'); });
  }

  function afOpts(list, cur) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }

  function afExportBtns(on) {
    return '<b style="font-size:.95rem">تصدير النتائج:</b> <button type="button" class="btn" data-afexp="pdf" data-ro-ok' + (on ? '' : ' disabled') + '>طباعة / PDF</button> <button type="button" class="btn" data-afexp="xlsx" data-ro-ok' + (on ? '' : ' disabled') + '>Excel</button>';
  }

  function afFilterInfo() {
    var u = afUi(), info = [];
    if (afHas(u.ageFrom) || afHas(u.ageTo)) info.push(['العمر', (afHas(u.ageFrom) ? 'من ' + u.ageFrom : '') + (afHas(u.ageTo) ? ' إلى ' + u.ageTo : '') + ' سنة']);
    if (u.cls) info.push(['الشعبة', u.cls]);
    if (u.reg) info.push(['الحالة', u.reg === 'reserve' ? 'احتياط' : 'تسجيل نهائي']);
    if (u.q.trim()) info.push(['بحث', u.q.trim()]);
    return info;
  }

  // إحصاء القائمة المعروضة: الإجمالي، والذكور والإناث، وحسب العمر، وحسب الشعبة
  function afStats(list) {
    var st = { n: list.length, m: 0, f: 0, byAge: {}, byCls: {}, noAge: 0 };
    list.forEach(function (x) {
      var g = String(stVal(x, 'gender') || ''), a = afAge(x), c = x.class_name || 'بدون شعبة';
      var isM = g === 'ذكر', isF = g === 'أنثى';
      if (isM) st.m++; else if (isF) st.f++;
      var ca = st.byCls[c] || (st.byCls[c] = { n: 0, m: 0, f: 0 });
      ca.n++; if (isM) ca.m++; if (isF) ca.f++;
      if (a == null) { st.noAge++; return; }
      var ba = st.byAge[a] || (st.byAge[a] = { n: 0, m: 0, f: 0 });
      ba.n++; if (isM) ba.m++; if (isF) ba.f++;
    });
    return st;
  }

  // نص نطاق العمر: «من سن 5 إلى سن 10 سنوات»
  function afAgeRangeText() {
    var u = afUi();
    if (afHas(u.ageFrom) && afHas(u.ageTo)) return 'من سن ' + u.ageFrom + ' إلى سن ' + u.ageTo + ' سنوات';
    if (afHas(u.ageFrom)) return 'من سن ' + u.ageFrom + ' سنوات فأكثر';
    if (afHas(u.ageTo)) return 'حتى سن ' + u.ageTo + ' سنوات';
    return '';
  }

  // صفحة الغلاف: بيان بعدد الأطفال بحسب البحث، وتوزيعهم حسب العمر والشعبة، وتشغل صفحة كاملة
  function afCoverHtml(list) {
    var st = afStats(list), range = afAgeRangeText(), info = afFilterInfo().filter(function (p) { return p[0] !== 'العمر'; });
    var hasG = st.m + st.f > 0;
    var th = function (a) { return a.map(function (t) { return '<th>' + t + '</th>'; }).join(''); };
    var tr = function (k, o) { return '<tr><td class="c"><b>' + k + '</b></td><td class="c"><b>' + o.n + '</b></td>' + (hasG ? '<td class="c">' + o.m + '</td><td class="c">' + o.f + '</td>' : '') + '</tr>'; };
    var ages = Object.keys(st.byAge).map(Number).sort(function (a, b) { return a - b; });
    var clsNames = Object.keys(st.byCls).sort(function (a, b) { return classRank(a) - classRank(b) || a.localeCompare(b, 'ar'); });
    var statement = range
      ? 'عدد الأطفال ' + range
      : 'عدد الأطفال بحسب شروط البحث';
    var cond = info.map(function (p) { return p[0] + ': ' + p[1]; }).join(' · ');
    return '<div class="af-cover" style="min-height:262mm;break-after:page;page-break-after:always;padding-top:12mm">' +
      letterhead() +
      '<div class="rt" style="margin-top:14mm"><h1>بيان بأعداد الأطفال</h1><div class="rt-info"><span><b>تاريخ الإصدار:</b> ' + dmy(todayISO()) + '</span></div></div>' +
      '<div class="rbox" style="margin:10mm 0;text-align:center;padding:8mm 6mm">' +
        '<div style="font-size:1.25em;margin-bottom:4mm">' + esc(statement) + '</div>' +
        '<div style="font-family:var(--font-head);font-size:3.2em;font-weight:800;color:var(--navy-dark);line-height:1.2">' + st.n + ' <span style="font-size:.4em;font-weight:700">' + (st.n === 1 ? 'طفل' : 'طفلًا') + '</span></div>' +
        (hasG ? '<div style="margin-top:3mm">ذكور: <b>' + st.m + '</b> · إناث: <b>' + st.f + '</b></div>' : '') +
        (cond ? '<div style="margin-top:3mm;color:#5e6b80">' + esc(cond) + '</div>' : '') +
      '</div>' +
      (ages.length ? '<div class="rsec">التوزيع حسب العمر</div><table class="rz"><thead><tr>' + th(['العمر (سنة)', 'العدد'].concat(hasG ? ['ذكور', 'إناث'] : [])) + '</tr></thead><tbody>' +
        ages.map(function (a) { return tr(a, st.byAge[a]); }).join('') + (st.noAge ? '<tr><td class="c">بلا تاريخ ميلاد</td><td class="c"><b>' + st.noAge + '</b></td>' + (hasG ? '<td></td><td></td>' : '') + '</tr>' : '') + '</tbody></table>' : '') +
      '<div class="rsec">التوزيع حسب الشعبة</div><table class="rz"><thead><tr>' + th(['الشعبة', 'العدد'].concat(hasG ? ['ذكور', 'إناث'] : [])) + '</tr></thead><tbody>' +
        clsNames.map(function (c) { return tr(esc(c), st.byCls[c]); }).join('') + '</tbody></table>' +
      '</div>';
  }

  var pendingAfList = false;
  function buildAffairsListSheet() {
    var list = afFiltered(afAgg()), n = 7;
    var head = reportHead('قائمة الطلاب', afFilterInfo().concat([['عدد الطلاب', list.length]])).replace(/^<img class="wm"[^>]*>/, '');
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' + afCoverHtml(list) +
      '<table class="rz"><thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>' +
      '<tr><th>م</th><th>الطالب</th><th>الشعبة</th><th>تاريخ الميلاد</th><th>العمر</th><th>ولي الأمر</th><th>الجوال / الواتساب</th></tr></thead><tbody>' +
      list.map(function (x, i) {
        var b = stVal(x, 'birth_date');
        return '<tr><td class="c">' + (i + 1) + '</td><td style="white-space:nowrap"><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '</td><td class="c">' + esc(x.class_name || '') + '</td>' +
          '<td class="c">' + (b ? dmy(b) : '') + '</td><td class="c">' + afAgeText(x) + '</td><td>' + esc(stVal(x, 'guardian_name') || '') + '</td><td class="c" dir="ltr">' + esc(plainPhone(x.phone) || '') + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>';
  }

  async function afExportXlsx() {
    var list = afFiltered(afAgg()), info = afFilterInfo();
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new(), used = {};
      wb.Workbook = { Views: [{ RTL: true }] };
      var st = afStats(list), range = afAgeRangeText(), hasG = st.m + st.f > 0;
      var ages = Object.keys(st.byAge).map(Number).sort(function (a, b) { return a - b; });
      var clsNames = Object.keys(st.byCls).sort(function (a, b) { return classRank(a) - classRank(b) || a.localeCompare(b, 'ar'); });
      var row = function (k, o) { return hasG ? [k, o.n, o.m, o.f] : [k, o.n]; };
      xlsxSheet(wb, used, 'بيان', [[schoolName()], ['بيان بأعداد الأطفال'], [range ? 'عدد الأطفال ' + range : 'عدد الأطفال بحسب شروط البحث', st.n], hasG ? ['ذكور', st.m, 'إناث', st.f] : [], [],
        ['العمر (سنة)', 'العدد'].concat(hasG ? ['ذكور', 'إناث'] : [])].concat(ages.map(function (a) { return row(a, st.byAge[a]); }), st.noAge ? [['بلا تاريخ ميلاد', st.noAge]] : [], [[], ['الشعبة', 'العدد'].concat(hasG ? ['ذكور', 'إناث'] : [])],
        clsNames.map(function (c) { return row(c, st.byCls[c]); })), [24, 12, 10, 10]);
      xlsxSheet(wb, used, 'الطلاب', [[schoolName()], ['قائمة الطلاب' + (info.length ? ' — ' + info.map(function (p) { return p[0] + ': ' + p[1]; }).join(' · ') : '')], ['عدد الطلاب: ' + list.length], [],
        ['م', 'الطالب', 'الشعبة', 'تاريخ الميلاد', 'العمر', 'ولي الأمر', 'الجوال', 'الواتساب']].concat(list.map(function (x, i) {
        var b = stVal(x, 'birth_date');
        return [i + 1, x.full_name + rsvText(x), x.class_name || '', b ? dmy(b) : '', afAge(x) == null ? '' : afAge(x), stVal(x, 'guardian_name') || '', plainPhone(x.phone), plainPhone(x.whatsapp)];
      })), [5, 32, 12, 14, 8, 28, 15, 15]);
      XLSX.writeFile(wb, 'قائمة-الطلاب-' + todayISO() + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  function afResultsHtml(per) {
    var u = afUi();
    if (!afShown()) return '<div class="empty">اختر الشعبة، أو اكتب اسم الطالب أو رقم هويته، أو حدّد الفئة العمرية، لتظهر النتائج.</div>';
    return afRowsHtml(afFiltered(per), per);
  }

  function afRowsHtml(list, per) {
    var LIMIT = 150;
    var body = list.slice(0, LIMIT).map(function (x, i) {
      var p = per[x.id] || { present: 0, absent: 0, excused: 0, suspended: 0 };
      return '<tr><td>' + (i + 1) + '</td><td class="who"><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '<br><span style="font-size:.88rem"><a href="#/affairs/' + x.id + '/absence" data-afhover="' + x.id + '">سجل الغياب</a> · <a href="#/affairs/' + x.id + '/file">ملف الطالب</a> · <a href="#/affairs/' + x.id + '/warning">إنذار</a> · <a href="#/affairs/' + x.id + '/consent">موافقة ولي الأمر</a></span></td><td>' + esc(x.class_name || '—') + '</td>' +
        '<td>' + afAgeText(x) + '</td><td>' + (p.absent ? '<b style="color:var(--red)">' + p.absent + '</b>' : 0) + '</td><td>' + (p.excused || 0) + '</td><td>' + (p.suspended ? '<b style="color:var(--red)">' + p.suspended + '</b>' : 0) + '</td><td>' + attPct(p) + '</td>' +
        '<td dir="ltr" style="text-align:right;white-space:nowrap">' + esc(plainPhone(x.phone) || '—') + '</td></tr>';
    }).join('');
    return (body ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الطالب</th><th>الشعبة</th><th>العمر</th><th>أيام الغياب</th><th>مأذون</th><th>مفصول</th><th>نسبة الحضور</th><th>واتساب ولي الأمر</th></tr></thead><tbody>' + body + '</tbody></table></div>'
      : '<div class="empty">لا يوجد طلاب مطابقون.</div>') + (list.length > LIMIT ? '<p class="st-count" style="margin-top:8px">يُعرض أول ' + LIMIT + ' من ' + list.length + '؛ ضيّق البحث أو اختر شعبة.</p>' : '');
  }

  function afListHtml() {
    var u = afUi(), per = afAgg(), shown = afShown(), list = shown ? afFiltered(per) : [], rideOn = S.tMembers.length > 0;
    return '<div class="card"><div class="toolbar" style="align-items:center;margin:0">' +
      '<input type="search" id="af-q" placeholder="ابحث بالاسم أو رقم الهوية أو الجوال" aria-label="بحث" style="flex:1;min-width:220px" value="' + esc(u.q) + '">' +
      '<select id="af-cls" aria-label="الشعبة" style="width:auto"><option value="">كل الشعب</option>' + attClasses().map(function (n) { return '<option' + (n === u.cls ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>' +
      '<select id="af-reg" aria-label="حالة التسجيل" style="width:auto">' + afOpts([['', 'كل الحالات'], ['final', 'تسجيل نهائي'], ['reserve', 'احتياط']], u.reg) + '</select>' +
      '<select id="af-abs" aria-label="الغياب" style="width:auto">' + afOpts(AF_ABS, u.abs) + '</select>' +
      (rideOn ? '<select id="af-ride" aria-label="المواصلات" style="width:auto">' + afOpts([['', 'المواصلات: الكل'], ['yes', 'مشتركون'], ['no', 'غير مشتركين']], u.ride) + '</select>' : '') + '</div>' +
      '<div class="toolbar" style="align-items:center;margin:8px 0 0"><b style="font-size:.95rem">العمر:</b>' +
        '<label class="field" for="af-a1" style="margin:0">من</label><input type="number" id="af-a1" min="0" max="30" step="1" placeholder="سنة" style="width:6em" value="' + esc(u.ageFrom == null ? '' : u.ageFrom) + '">' +
        '<label class="field" for="af-a2" style="margin:0">إلى</label><input type="number" id="af-a2" min="0" max="30" step="1" placeholder="سنة" style="width:6em" value="' + esc(u.ageTo == null ? '' : u.ageTo) + '">' +
        '<span style="flex:1"></span><a class="btn" href="#/affairs/suspend" title="فصل تأديبي لفترة: يُسجَّل الطالب «ف» في أيامه ولا يُحتسب غيابًا">الفصل المؤقت' + (spActive() ? ' <b>(' + spActive() + ')</b>' : '') + '</a><a class="btn" href="#/affairs/lists" title="قوائم بعنوان يُختار فيها الطلاب (مثل الموافقين على التطعيم) وتُطبع حسب الشعبة">قوائم الطلاب (موافقات وغيرها)</a><span id="af-exp">' + afExportBtns(shown && list.length) + '</span></div>' +
      '<p class="hint" style="margin:8px 0 0">' + (u.loading ? 'جارٍ جلب سجلات الحضور…' : u.attErr ? 'تعذّر جلب سجلات الحضور.' : 'الغياب من ' + dmy(u.loadedFrom || u.from) + ' إلى اليوم.') +
        ' مرّر الفأرة على «سجل الغياب» لترى ملخصه، واضغط عليه أو على «ملف الطالب» للانتقال إلى شاشته.' + (shown ? ' الطلاب: <b id="af-n">' + list.length + '</b>' : '<span id="af-n"></span>') + '</p></div>' +
      '<div class="card" id="af-list">' + afResultsHtml(per) + '</div>' + afConsentCardHtml(list.length);
  }

  function afStudentData(x) {
    var u = afUi(), from = u.from, to = u.to;
    var rows = (u.rows || []).filter(function (r) { return r.student_id === x.id && r.day >= from && r.day <= to; }).sort(function (p, q) { return p.day.localeCompare(q.day); });
    var n = { present: 0, absent: 0, excused: 0, suspended: 0 };
    rows.forEach(function (r) { n[r.status]++; });
    return { x: x, rows: rows, n: n, from: from, to: to };
  }

  function afFileHtml(x) {
    var secs = [], cur = null;
    ST_FIELDS.forEach(function (f) {
      if (f.sec) { cur = { title: f.sec, items: [] }; secs.push(cur); }
      if (!cur) return;
      var v = stVal(x, f.k);
      if (v === '' || v == null) return;
      cur.items.push('<div><span class="meta" style="font-size:.85rem">' + esc(f.p || f.label) + '</span><br><b>' + esc(f.type === 'date' ? dmy(v) : v) + '</b></div>');
    });
    var ride = findGroup(transportGroupOf()[x.id]);
    return secs.filter(function (s) { return s.items.length; }).map(function (s) {
      return '<h3 style="margin:14px 0 6px">' + esc(s.title) + '</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px 16px">' + s.items.join('') + '</div>';
    }).join('') + (ride ? '<h3 style="margin:14px 0 6px">المواصلات</h3><div><b>' + esc(ride.assembly_point) + '</b>' + (ride.pickup_time ? ' — ' + esc(ride.pickup_time) : '') + '</div>' : '');
  }

  function afHead(x, title) {
    return '<div class="card"><div class="toolbar" style="align-items:center;margin:0"><a class="btn" href="#/affairs">→ إدارة شئون الطلاب</a>' +
      '<h2 style="margin:0;flex:1">' + esc(title) + ': ' + esc(x.full_name) + rsvMark(x) + ' <span class="meta" style="font-weight:400;font-size:.95rem">— ' + esc(x.class_name || 'بدون شعبة') + (isReserve(x) ? ' · احتياط' : '') + '</span></h2>' +
      [['absence', 'سجل الغياب'], ['file', 'ملف الطالب'], ['warning', 'إنذار'], ['consent', 'موافقة ولي الأمر']].filter(function (v) { return v[0] !== afView(); }).map(function (v) { return '<a class="btn" href="#/affairs/' + x.id + '/' + v[0] + '">' + v[1] + '</a>'; }).join('') + '</div></div>';
  }

  /* ----- إنذار الطالب -----
     كتاب إنذار مطبوع لولي الأمر بمخالفة الطالب: التاريخ، وملاحظات المخالفة، والإجراء المطلوب (مثل إحضار ولي الأمر)، وتوقيع المدير وإقرار ولي الأمر بالاستلام.
     لا يُحفظ في البرنامج، يُكتب ويُطبع */
  var AF_ACTIONS = ['إحضار ولي الأمر', 'مراجعة مرشد/ة الأكاديمية', 'توقيع تعهد خطي', 'استدعاء ولي الأمر هاتفيًا'];
  function afWarn() { var u = afUi(); return u.warn || (u.warn = { date: todayISO(), notes: '', action: AF_ACTIONS[0], log: true, saved: '' }); }

  function afWarnScreen(x) {
    var w = afWarn();
    return afHead(x, 'إنذار') + '<div class="card"><h2>بيانات الإنذار</h2><div class="grid2" style="margin-top:10px">' +
      '<div><label class="field" for="afw-date">تاريخ الإنذار</label><input type="date" id="afw-date" data-ro-ok value="' + esc(w.date) + '"></div>' +
      '<div><label class="field" for="afw-action">الإجراء المطلوب</label><input type="text" id="afw-action" data-ro-ok list="afw-actions" autocomplete="off" value="' + esc(w.action) + '"><datalist id="afw-actions">' +
        AF_ACTIONS.map(function (a) { return '<option value="' + esc(a) + '">'; }).join('') + '</datalist></div>' +
      '<div style="grid-column:1/-1"><label class="field" for="afw-notes">ملاحظات المخالفة</label><textarea id="afw-notes" data-ro-ok rows="5" placeholder="اكتب المخالفة وتفاصيلها">' + esc(w.notes) + '</textarea></div></div>' +
      (canEditDisc() ? '<label class="check" style="margin-top:10px"><input type="checkbox" id="afw-log" data-ro-ok' + (w.log ? ' checked' : '') + '> تسجيل هذا الإنذار في سجل المخالفات عند الطباعة</label>' : '') +
      '<div class="actions"><button type="button" class="btn primary" data-afwprint="' + x.id + '" data-ro-ok>طباعة الإنذار / PDF</button></div></div>';
  }

  // يُسجَّل الإنذار في سجل المخالفات مرة واحدة لكل محتوى (طباعته مرة ثانية بلا تعديل لا تكرره)
  async function afLogWarning(x, w) {
    var key = [x.id, w.date, w.notes.trim(), w.action.trim()].join('|');
    if (w.saved === key) return;
    var row = { student_id: x.id, day: w.date, kind: 'warning', violation: w.notes.trim(), action: w.action.trim(), created_by: (S.profile && S.profile.full_name) || displayName(S.email) };
    var r = await sb.from('discipline_records').insert(row).select().single();
    if (r.error && /runnable|fetch|network/i.test(r.error.message || '')) r = await sb.from('discipline_records').insert(row).select().single();
    if (r.error) return toast('طُبع الإنذار لكن تعذّر تسجيله في سجل المخالفات: ' + r.error.message, true);
    w.saved = key;
    if (dcState().loaded) dcState().list.unshift(r.data);
    toast('سُجّل الإنذار في سجل المخالفات');
  }

  function buildWarningSheet(x) {
    var w = afWarn(), guardian = String(stVal(x, 'guardian_name') || '').trim(), dots = '..................................';
    var row = function (a, b) { return '<tr><th style="width:24%">' + a + '</th><td>' + b + '</td></tr>'; };
    sheet.className = 'ps';
    sheet.removeAttribute('data-fit');
    sheet.innerHTML = reportHead('إنذار', [['التاريخ', dmy(w.date)]], { noIssueDate: true }) +
      '<p style="margin:1.1em 0 .4em;font-size:1.1em"><b>السيد/ة ولي أمر الطالب/ة: ' + esc(x.full_name) + '</b>' + (guardian ? ' <span style="font-weight:400">(' + esc(guardian) + ')</span>' : '') + '</p>' +
      '<p style="margin:0 0 .8em">تحية طيبة وبعد،</p>' +
      '<p style="margin:0 0 .8em;line-height:1.9">نفيدكم علمًا بأن ابنكم/ابنتكم المذكور/ة أعلاه من طلاب الشعبة (' + esc(x.class_name || dots) + ') قد صدرت منه/ا المخالفة الآتية، وعليه نوجّه إليكم هذا الإنذار:</p>' +
      '<table class="rk">' + row('اسم الطالب/ة', esc(x.full_name)) + row('الشعبة', esc(x.class_name || '')) + row('تاريخ الإنذار', dmy(w.date)) + '</table>' +
      '<div class="rsec">المخالفة</div><div class="rbox" style="min-height:42mm;white-space:pre-wrap;line-height:2">' + esc(w.notes) + '</div>' +
      '<div class="rsec">الإجراء المطلوب</div><div class="rbox" style="min-height:14mm;line-height:2"><b>' + esc(w.action) + '</b></div>' +
      '<p style="margin:1em 0 0;line-height:1.9">نأمل منكم التعاون معنا لما فيه مصلحة ابنكم/ابنتكم، ونشكر لكم حسن تعاونكم.</p>' +
      reportSigns([['مدير/ة الأكاديمية', principalName()], ['ولي الأمر (إقرار بالاستلام)', guardian]]);
    fitSheet();
  }

  function afFileScreen(x) {
    return afHead(x, 'ملف الطالب') + '<div class="card"><div class="toolbar" style="margin:0 0 4px"><button type="button" class="btn" data-afprofile="' + x.id + '" data-ro-ok>طباعة ملف الطالب</button></div>' + afFileHtml(x) + '</div>';
  }

  function afAbsenceScreen(x) {
    var u = afUi(), D = afStudentData(x);
    var rows = D.rows.map(function (r, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + dmy(r.day) + '</td><td>' + esc(dayName(r.day)) + '</td><td><span class="badge ' + ATT_BADGE[r.status] + '">' + attWord(r.status, r.student_id, r.day) + '</span></td><td>' + esc(r.note || '') + '</td></tr>';
    }).join('');
    return afHead(x, 'سجل الغياب') +
      '<div class="card"><h2>سجل الحضور والغياب</h2><div class="toolbar" style="align-items:center">' +
        '<span class="monthpick"><label class="field" for="af-from">من</label><input type="date" id="af-from" data-ro-ok value="' + u.from + '"></span>' +
        '<span class="monthpick"><label class="field" for="af-to">إلى</label><input type="date" id="af-to" data-ro-ok value="' + u.to + '"></span>' +
        '<button type="button" class="btn" data-afprint="pdf" data-ro-ok>طباعة / PDF</button><button type="button" class="btn" data-afprint="xlsx" data-ro-ok>Excel</button></div>' +
        (u.loading ? '<p class="hint">جارٍ جلب السجلات…</p>' : u.attErr ? '<p class="formhint">تعذّر جلب سجلات الحضور.</p>' :
          '<div class="stats">' + [['حاضر', D.n.present], ['غائب', D.n.absent, D.n.absent ? 'var(--red)' : ''], ['مأذون', D.n.excused]].concat(D.n.suspended ? [['مفصول', D.n.suspended, 'var(--red)']] : [], [['نسبة الحضور', attPct(D.n)]]).map(function (c) {
            return '<div class="card stat"><span class="lbl">' + c[0] + '</span><span class="num"' + (c[2] ? ' style="color:' + c[2] + '"' : '') + '>' + c[1] + '</span></div>';
          }).join('') + '</div>' +
          (rows ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>التاريخ</th><th>اليوم</th><th>الحالة</th><th>ملاحظة</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
            : '<div class="empty">لا يوجد حضور مسجَّل لهذا الطالب في الفترة.</div>')) + '</div>';
  }

  // نافذة ملخص الغياب عند المرور على اسم الطالب
  function afPop() {
    var p = document.getElementById('af-pop');
    if (!p) {
      p = document.createElement('div');
      p.id = 'af-pop';
      p.style.cssText = 'position:fixed;z-index:60;display:none;max-width:290px;background:#fff;color:var(--body,#2B2B2B);border:1px solid var(--line,#d9d9d9);border-radius:12px;box-shadow:0 6px 24px rgba(19,48,107,.18);padding:10px 14px;font-size:.88rem;line-height:1.6;pointer-events:none';
      document.body.appendChild(p);
    }
    return p;
  }
  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest && e.target.closest('[data-afhover]');
    if (!el || !/^#\/affairs/.test(location.hash)) return;
    var x = findStudent(el.getAttribute('data-afhover'));
    if (!x) return;
    var u = afUi(), p = (afAgg()[x.id]) || { present: 0, absent: 0, excused: 0, suspended: 0, abs: [] }, pop = afPop();
    var last = p.abs.slice(-5).reverse();
    pop.innerHTML = '<b>' + esc(x.full_name) + '</b><br>' + (u.rows ? 'منذ ' + dmy(u.loadedFrom || u.from) + ': غائب <b style="color:var(--red)">' + p.absent + '</b> · مأذون ' + p.excused + (p.suspended ? ' · مفصول ' + p.suspended : '') + ' · حاضر ' + p.present + ' · نسبة الحضور <b>' + attPct(p) + '</b>' +
      (last.length ? '<br><span style="color:#5e6b80">آخر غياب:</span><br>' + last.map(function (a) { return dmy(a.day) + (a.note ? ' — ' + esc(a.note) : ''); }).join('<br>') : '<br>لا غياب مسجَّل.') : 'جارٍ جلب السجلات…') +
      '<br><span style="color:#5e6b80;font-size:.8rem">اضغط لفتح الصفحة</span>';
    pop.style.display = 'block';
    var r = el.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    pop.style.top = (r.bottom + h + 12 > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
  });
  document.addEventListener('mouseout', function (e) {
    var el = e.target.closest && e.target.closest('[data-afhover]');
    if (el) afPop().style.display = 'none';
  });
  window.addEventListener('hashchange', function () { var p = document.getElementById('af-pop'); if (p) p.style.display = 'none'; });

  document.addEventListener('click', function (e) {
    if (!/^#\/affairs/.test(location.hash) || !canAttView()) return;
    var el, x = afCurrent();
    if ((el = e.target.closest('[data-afwprint]'))) {
      var wx = findStudent(el.getAttribute('data-afwprint')), ww = afWarn();
      if (!wx) return;
      // يُسجَّل قبل فتح نافذة الطباعة: نافذة الطباعة توقف الصفحة فيفشل الحفظ الجاري معها
      var logged = ww.log && canEditDisc() && ww.notes.trim() ? afLogWarning(wx, ww).catch(function (err) { toast('تعذّر تسجيل الإنذار في سجل المخالفات: ' + err.message, true); }) : Promise.resolve();
      if (ww.log && canEditDisc() && !ww.notes.trim()) toast('لم تُكتب ملاحظات المخالفة، فلن يُسجَّل الإنذار في سجل المخالفات', true);
      return logged.then(function () { pendingWarn = wx; return printNow(); });
    }
    if ((el = e.target.closest('[data-afexp]')) && location.hash === '#/affairs') {
      if (el.getAttribute('data-afexp') === 'xlsx') return afExportXlsx();
      pendingAfList = true;
      return printNow();
    }
    if ((el = e.target.closest('[data-afprofile]'))) { pendingProfile = findStudent(el.getAttribute('data-afprofile')); return printNow(); }
    if ((el = e.target.closest('[data-afprint]')) && x) {
      var u = afUi();
      if (!u.from || u.to < u.from) return toast('اختر فترة صحيحة', true);
      return attStudentOut(afStudentData(x), el.getAttribute('data-afprint'));
    }
  });

  function afRefreshList() {
    var u = afUi(), per = afAgg();
    document.getElementById('af-list').innerHTML = afResultsHtml(per);
    var shown = afShown(), cnt = shown ? afFiltered(per).length : '';
    document.getElementById('af-n').textContent = cnt;
    var ex = document.getElementById('af-exp');
    if (ex) ex.innerHTML = afExportBtns(shown && cnt);
    var cb = document.getElementById('afc-batch');
    if (cb) cb.innerHTML = afConsentBatchBtn(shown ? cnt : 0);
  }
  document.addEventListener('input', function (e) {
    if (location.hash !== '#/affairs') return;
    if (e.target.id === 'af-a1' || e.target.id === 'af-a2') { afUi()[e.target.id === 'af-a1' ? 'ageFrom' : 'ageTo'] = e.target.value; return afRefreshList(); }
    if (e.target.id !== 'af-q') return;
    afUi().q = e.target.value;
    afRefreshList();
  });
  // حقول الإنذار تُحفظ أثناء الكتابة دون إعادة رسم الصفحة
  document.addEventListener('input', function (e) {
    if (e.target.id === 'afw-log') { afWarn().log = e.target.checked; return; }
    var k = { 'afw-date': 'date', 'afw-action': 'action', 'afw-notes': 'notes' }[e.target.id];
    if (k && /\/warning$/.test(location.hash)) afWarn()[k] = e.target.value;
  });
  document.addEventListener('change', function (e) {
    if (!/^#\/affairs/.test(location.hash)) return;
    var u = afUi(), id = e.target.id, map = { 'af-cls': 'cls', 'af-reg': 'reg', 'af-abs': 'abs', 'af-ride': 'ride' };
    if (map[id]) { u[map[id]] = e.target.value; return afRefreshList(); }
    if (id === 'af-from' || id === 'af-to') {
      u[id === 'af-from' ? 'from' : 'to'] = e.target.value;
      if (!u.from || !u.to || u.to < u.from) return render();
      if (!u.loadedFrom || u.from < u.loadedFrom) { u.rows = null; return afLoad(u.from); }
      render();
    }
  });

  /* ---------- العهد ----------
     الأصناف التي في عهدة الأكاديمية: الصنف والعدد والملاحظات. يعدّلها المدير العام ويراها المدير (supabase/custody.sql) */

  function cuState() { return S.cu || (S.cu = { list: [], missing: false, loaded: false, loading: false, edit: '', q: '' }); }

  async function loadCustody() {
    var c = cuState();
    if (c.loading) return;
    c.loading = true;
    var rows = await fetchAll(function () { return sb.from('custody_items').select('*').order('created_at').order('id'); });
    c.loading = false; c.loaded = true; c.missing = !rows; c.list = rows || [];
    render();
  }

  function renderCustody() {
    var c = cuState();
    if (!c.loaded) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; loadCustody(); return; }
    if (c.missing) {
      app.innerHTML = '<div class="card empty">العهد تحتاج جدولًا جديدًا.<br>' + (isAdmin() ? 'شغّل الملف <code dir="ltr">supabase/custody.sql</code> في محرر SQL، ثم حدّث الصفحة.' : 'يشغّل المدير العام الملف <code dir="ltr">supabase/custody.sql</code>.') + '</div>';
      return;
    }
    var edit = isAdmin(), q = norm(c.q);
    var list = c.list.filter(function (x) { return !q || norm(x.item + ' ' + x.notes).indexOf(q) > -1; });
    var rows = list.map(function (x, i) {
      if (edit && c.edit === x.id) {
        return '<tr><td>' + (i + 1) + '</td><td><input type="text" id="cu-e-item" value="' + esc(x.item) + '" aria-label="الصنف"></td><td><input type="number" id="cu-e-qty" min="0" step="1" value="' + esc(x.qty) + '" aria-label="العدد" style="width:6em"></td>' +
          '<td><input type="text" id="cu-e-notes" value="' + esc(x.notes) + '" aria-label="ملاحظات"></td><td style="white-space:nowrap"><button type="button" class="btn primary" data-cusave="' + x.id + '">حفظ</button> <button type="button" class="btn" data-cuedit="">إلغاء</button></td></tr>';
      }
      return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(x.item) + '</b></td><td>' + esc(x.qty) + '</td><td>' + esc(x.notes) + '</td>' +
        (edit ? '<td style="white-space:nowrap"><button type="button" class="btn" data-cuedit="' + x.id + '">تعديل</button> <button type="button" class="btn danger" data-cudel="' + x.id + '">حذف</button></td>' : '<td></td>') + '</tr>';
    }).join('');
    app.innerHTML = '<h1 class="page-title" style="margin:0 0 12px">العهد</h1>' +
      (edit ? '<form class="card" id="cu-form"><h2>إضافة صنف</h2><div class="toolbar" style="align-items:flex-end;margin:10px 0 0">' +
        '<div style="flex:2;min-width:200px"><label class="field" for="cu-item">الصنف <span class="req">*</span></label><input type="text" id="cu-item" required autocomplete="off"></div>' +
        '<div style="width:8em"><label class="field" for="cu-qty">العدد <span class="req">*</span></label><input type="number" id="cu-qty" min="0" step="1" required value="1"></div>' +
        '<div style="flex:3;min-width:220px"><label class="field" for="cu-notes">ملاحظات</label><input type="text" id="cu-notes" autocomplete="off"></div>' +
        '<button type="submit" class="btn primary">إضافة</button></div></form>' : '') +
      '<div class="card"><div class="toolbar" style="align-items:center;margin:0 0 8px"><h2 style="margin:0;flex:1">عدد الأصناف: ' + list.length + '</h2>' +
        '<button type="button" class="btn" data-cuprint data-ro-ok' + (list.length ? '' : ' disabled') + '>طباعة / PDF</button>' +
        '<input type="search" id="cu-q" placeholder="بحث في الأصناف والملاحظات" aria-label="بحث" style="max-width:260px" value="' + esc(c.q) + '"></div>' +
      (rows ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الصنف</th><th>العدد</th><th>ملاحظات</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">' + (c.list.length ? 'لا أصناف مطابقة.' : 'لا توجد أصناف بعد' + (edit ? '؛ أضف صنفًا من الأعلى.' : '.')) + '</div>') + '</div>';
  }

  /* ---------- الطلبيات ----------
     خطابات طلب احتياجات للجهات الداعمة (جمعية ...): المرسَل إليه والموضوع وجدول الأصناف (الصنف، الوحدة، الكمية أو المبلغ)،
     وتُطبع خطابًا رسميًا بالترويسة وتوقيع المدير. يعدّلها المدير العام ويراها المدير (supabase/orders.sql) */
  var OR_STATUS = { draft: 'مسودة', sent: 'أُرسلت', received: 'استُلمت' };
  var OR_UNITS = ['عدد', 'دستة', 'ربطة', 'علبة', 'كرتونة', 'رزمة', 'متر', 'كيلو', 'لتر', '-'];
  function orState() { return S.or || (S.or = { list: [], loaded: false, loading: false, missing: false, edit: null, q: '' }); }
  function orNew(src) {
    var last = src || orState().list[0];
    return {
      id: null, order_date: todayISO(), status: 'draft', notes: '',
      recipient: last ? last.recipient : 'السادة / ', recipient2: last ? last.recipient2 : '',
      subject: 'طلب احتياجات مدرسية',
      intro: last && last.intro ? last.intro : 'تهديكم إدارة ' + schoolName() + ' أطيب التحيات، وتشكر لكم دعمكم المتواصل لمسيرة تعليم أبنائنا الطلاب. ونظراً لحاجة الأكاديمية إلى تقديم خدماتها للطلاب، نرجو من حضراتكم التكرم بتوفير الاحتياجات التالية:',
      closing: last && last.closing ? last.closing : 'شاكرين لكم حسن تعاونكم، وجزاكم الله خيراً.',
      items: src ? JSON.parse(JSON.stringify(src.items || [])) : [{ item: '', unit: 'عدد', qty: '' }]
    };
  }
  async function loadOrders() {
    var c = orState();
    if (c.loading) return;
    c.loading = true;
    var rows = await fetchAll(function () { return sb.from('orders').select('*').order('order_date', { ascending: false }).order('no', { ascending: false }); });
    c.loading = false; c.loaded = true; c.missing = !rows; c.list = rows || [];
    render();
  }
  function orItemsHtml(o) {
    var dl = '<datalist id="or-units">' + OR_UNITS.map(function (u) { return '<option value="' + esc(u) + '">'; }).join('') + '</datalist>';
    return dl + '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الصنف</th><th style="width:9em">الوحدة</th><th style="width:9em">الكمية / المبلغ</th><th></th></tr></thead><tbody>' +
      o.items.map(function (it, i) {
        return '<tr><td>' + (i + 1) + '</td><td><input type="text" data-oi="' + i + '|item" value="' + esc(it.item) + '" aria-label="الصنف"></td>' +
          '<td><input type="text" list="or-units" data-oi="' + i + '|unit" value="' + esc(it.unit) + '" aria-label="الوحدة"></td>' +
          '<td><input type="text" data-oi="' + i + '|qty" value="' + esc(it.qty) + '" aria-label="الكمية" placeholder="10 أو 300 جنيه"></td>' +
          '<td style="white-space:nowrap"><button type="button" class="btn" data-orup="' + i + '" title="لأعلى"' + (i ? '' : ' disabled') + '>↑</button> <button type="button" class="btn danger" data-ordelit="' + i + '" title="حذف السطر">×</button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="toolbar" style="margin-top:8px"><button type="button" class="btn" data-oradd>+ إضافة صنف</button></div>';
  }
  function renderOrders() {
    var c = orState(), edit = isAdmin();
    if (!c.loaded) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; loadOrders(); return; }
    if (c.missing) {
      app.innerHTML = '<div class="card empty">الطلبيات تحتاج جدولًا جديدًا.<br>' + (isAdmin() ? 'شغّل الملف <code dir="ltr">supabase/orders.sql</code> في محرر SQL، ثم حدّث الصفحة.' : 'يشغّل المدير العام الملف <code dir="ltr">supabase/orders.sql</code>.') + '</div>';
      return;
    }
    var o = c.edit, head = '<div class="page-head"><div><h1>الطلبيات</h1><p>خطابات طلب احتياجات للجهات الداعمة، بجدول الأصناف ووحداتها وكمياتها، وتُطبع خطابًا رسميًا بالترويسة وتوقيع المدير.</p></div>' +
      (edit && !o ? '<button type="button" class="btn primary" data-ornew>طلبية جديدة</button>' : '') + '</div>';
    if (o) {
      app.innerHTML = head + '<div class="card"><h2 style="margin-top:0">' + (o.id ? 'تعديل الطلبية رقم ' + esc(o.no) : 'طلبية جديدة') + '</h2>' +
        '<div class="toolbar" style="align-items:flex-end">' +
          '<div style="width:11em"><label class="field" for="or-date">التاريخ</label><input type="date" id="or-date" data-of="order_date" value="' + esc(o.order_date) + '"></div>' +
          '<div style="width:10em"><label class="field" for="or-status">الحالة</label><select id="or-status" data-of="status">' + Object.keys(OR_STATUS).map(function (k) { return '<option value="' + k + '"' + (o.status === k ? ' selected' : '') + '>' + OR_STATUS[k] + '</option>'; }).join('') + '</select></div>' +
          '<div style="flex:1;min-width:220px"><label class="field" for="or-subject">الموضوع</label><input type="text" id="or-subject" data-of="subject" value="' + esc(o.subject) + '"></div></div>' +
        '<div class="toolbar" style="align-items:flex-end">' +
          '<div style="flex:1;min-width:220px"><label class="field" for="or-rec">المرسَل إليه <span class="req">*</span></label><input type="text" id="or-rec" data-of="recipient" value="' + esc(o.recipient) + '" placeholder="السادة / جمعية ..."></div>' +
          '<div style="flex:1;min-width:220px"><label class="field" for="or-rec2">سطر ثانٍ</label><input type="text" id="or-rec2" data-of="recipient2" value="' + esc(o.recipient2) + '" placeholder="للأعمال الخيرية"></div></div>' +
        '<label class="field" for="or-intro">نص المقدمة</label><textarea id="or-intro" data-of="intro" rows="3" style="width:100%">' + esc(o.intro) + '</textarea>' +
        '<h3>الأصناف</h3>' + orItemsHtml(o) +
        '<label class="field" for="or-closing">الخاتمة</label><textarea id="or-closing" data-of="closing" rows="2" style="width:100%">' + esc(o.closing) + '</textarea>' +
        '<label class="field" for="or-notes">ملاحظات داخلية (لا تُطبع)</label><input type="text" id="or-notes" data-of="notes" value="' + esc(o.notes) + '">' +
        '<div class="toolbar" style="margin-top:12px"><button type="button" class="btn primary" data-orsave>حفظ</button><button type="button" class="btn" data-orsaveprint>حفظ وطباعة</button><button type="button" class="btn" data-orcancel>إلغاء</button></div></div>';
      return;
    }
    var q = norm(c.q), list = c.list.filter(function (x) { return !q || norm(x.recipient + ' ' + x.subject + ' ' + (x.items || []).map(function (i) { return i.item; }).join(' ')).indexOf(q) > -1; });
    app.innerHTML = head + '<div class="card"><div class="toolbar" style="align-items:center;margin:0 0 8px"><h2 style="margin:0;flex:1">عدد الطلبيات: ' + list.length + '</h2>' +
      '<input type="search" id="or-q" placeholder="بحث في الجهة والموضوع والأصناف" aria-label="بحث" style="max-width:260px" value="' + esc(c.q) + '"></div>' +
      (list.length ? '<div class="table-wrap"><table class="grid"><thead><tr><th>رقم</th><th>التاريخ</th><th>المرسَل إليه</th><th>الموضوع</th><th>الأصناف</th><th>الحالة</th><th></th></tr></thead><tbody>' +
        list.map(function (x) {
          return '<tr><td>' + esc(x.no) + '</td><td>' + dmy(x.order_date) + '</td><td><b>' + esc(x.recipient) + '</b>' + (x.recipient2 ? ' ' + esc(x.recipient2) : '') + '</td><td>' + esc(x.subject) + '</td><td>' + (x.items || []).length + '</td>' +
            '<td>' + esc(OR_STATUS[x.status] || x.status) + '</td><td style="white-space:nowrap"><button type="button" class="btn" data-orprint="' + x.id + '" data-ro-ok>طباعة / PDF</button>' +
            (edit ? ' <button type="button" class="btn" data-oropen="' + x.id + '">تعديل</button> ' + menuHtml('المزيد', '<button type="button" class="btn" data-orcopy="' + x.id + '">نسخ إلى طلبية جديدة بنفس الأصناف</button><button type="button" class="btn danger" data-ordel="' + x.id + '">حذف</button>', true) : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="empty">' + (c.list.length ? 'لا طلبيات مطابقة.' : 'لا توجد طلبيات بعد' + (edit ? '؛ اضغط «طلبية جديدة».' : '.')) + '</div>') + '</div>';
  }



  /* ---------- الرئيسية للمعلم ----------
     على تصميم صفحة ولي الأمر: شريط باسمه، وبطاقات (شعبي، طلابي، حصص اليوم، حصص الأسبوع)، وجدول اليوم بحصصه وشعبها وأوقاتها */
  var TD_SV = {
    cls: '<path d="M4 5h16v12H4zM8 21h8M12 17v4"/>', users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0112 0M16 5a3 3 0 010 6M17.5 14a5 5 0 013.5 6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>'
  };
  function tdSv(k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + TD_SV[k] + '</svg>'; }
  function renderTeacherHome() {
    if (!S.ttLoaded) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; S.ttLoaded = true; Promise.all([loadTimetable(), TG.loaded ? null : tgLoad()]).then(render); return; }
    var tid = (S.profile && S.profile.teacher_id) || (S.myStaff && S.myStaff.id), t = tid && find(tid);
    var name = (t && t.name) || (S.myStaff && S.myStaff.name) || (S.profile && S.profile.full_name) || displayName(S.email);
    var mine = ttLive().filter(function (x) { return x.teacher_id === tid; });
    var days = ttCfg().days, wd = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][new Date().getDay()], di = days.indexOf(wd);
    var today = di < 0 ? [] : mine.filter(function (x) { return x.day === di; }).sort(function (a, b) { return a.period - b.period; });
    var classes = {}; mine.forEach(function (x) { classes[x.class_name] = 1; });
    var nCls = Object.keys(classes).length, nSt = Array.isArray(TG.students) ? TG.students.length : 0;
    var w = String(name).trim().split(/\s+/).map(function (x) { return x.replace(/^ال(?=..)/, ''); }), ini = (w[0] || '').charAt(0) + ' ' + (w.length > 1 ? w[w.length - 1].charAt(0) : '');
    var nowM = new Date().getHours() * 60 + new Date().getMinutes();
    var card = function (c, ic, v, l, sub, href) { return '<a class="td-st ' + c + '" href="' + href + '"><span class="ico">' + tdSv(ic) + '</span><span class="go">←</span><span class="l">' + l + '</span><span class="n">' + v + '</span><span class="s">' + sub + '</span></a>'; };
    var rows = today.map(function (x) {
      var tm = ttTimeFor(x.class_name, x.period), now = tm && nowM >= ttMins(tm[0]) && nowM < ttMins(tm[1]);
      return '<div class="td-row' + (now ? ' now' : '') + '"><span class="no">' + x.period + '</span><div class="pn"><b>الحصة ' + (TT_ORD[x.period - 1] || x.period) + '</b>' + (tm ? '<small>' + ttRange(tm[0], tm[1]) + '</small>' : '') + '</div>' +
        '<div class="sj">' + esc(x.subject || '—') + '</div><div class="tc">' + esc(x.class_name) + (now ? ' · الآن' : '') + '</div></div>';
    }).join('');
    app.innerHTML = '<div class="td-banner"><span class="av">' + esc(ini) + '</span><div class="who"><small>' + esc((t && t.job_title) || 'المعلم') + '</small><b>' + esc(name) + '</b><span>' + (nCls ? Object.keys(classes).sort().map(esc).join(' · ') : 'لا شعب في جدول الحصص بعد') + '</span></div>' +
        '<div class="yr">العام الدراسي<b>' + esc(academicYear().replace('/', ' / ')) + '</b></div></div>' +
      '<div class="td-hello"><div><h2>مرحبًا بك</h2><p>ملخص يومك وصفوفك</p></div><span class="td-chip">' + esc(new Date().toLocaleDateString('ar-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' })) + '</span></div>' +
      '<div class="td-stats">' +
        card('c3', 'clock', today.length, 'حصص اليوم', today.length ? 'أولها الحصة ' + (TT_ORD[today[0].period - 1] || today[0].period) : 'لا حصص اليوم', '#/timetable') +
        card('c4', 'cal', mine.length, 'حصص الأسبوع', 'في ' + days.length + ' أيام', '#/timetable') +
        card('c2', 'cls', nCls, 'شعبي', 'من جدول الحصص', '#/mystudents') +
        card('c1', 'users', TG.missing ? '—' : nSt, 'طلابي', 'في شعبي', '#/mystudents') + '</div>' +
      '<div class="td-today"><div class="th"><span class="ic">' + tdSv('clock') + '</span><div><b>جدول اليوم' + (di > -1 ? ' — ' + esc(days[di]) : '') + '</b><small>' + (today.length ? today.length + ' حصص' : 'لا حصص اليوم') + '</small></div><a href="#/timetable">عرض الجدول الأسبوعي ←</a></div>' +
        (rows || '<p class="hint" style="margin:0;padding:14px 18px">لا حصص لك اليوم.</p>') + '</div>';
  }

  /* ---------- صفوفي (للمعلم) والدرجات ----------
     طلابي: يرى المعلم بحسابه بيانات طلاب الشعب التي يدرّسها (my_students في supabase/teacher_grades.sql)، ويصدّرها PDF بلا توقيع وعليها اسمه علامة مائية، أو Excel.
     رصد الدرجات: يختار الفصل الدراسي والشعبة والمادة فيرصد درجات الاختبارات التي أعدّتها الإدارة في «إعداد الدرجات»، ويُحسب المجموع */
  var TG = { loaded: false, missing: false, classes: [], students: [], items: null, cfgEdit: null };
  var TG_COLS = [['full_name', 'اسم الطالب'], ['class_name', 'الشعبة'], ['birth_date', 'تاريخ الميلاد'], ['home', 'السكن'], ['student_phone', 'جوال الطالب'], ['phone', 'جوال ولي الأمر'], ['alt_phone', 'جوال بديل']];
  function tgVal(x, k) {
    if (k === 'birth_date') return x.birth_date ? dmy(x.birth_date) : '';
    if (k === 'home') return [x.city, x.neighborhood, x.address].filter(function (v) { return v && String(v).trim(); }).join(' — ');
    return x[k] == null ? '' : String(x[k]);
  }
  function tgUi() { return ui.tg || (ui.tg = { cls: '', q: '', term: '', key: '', draft: {}, grades: null, gkey: '' }); }
  function tgTeacherName() { return (S.myStaff && S.myStaff.name) || (S.profile && S.profile.full_name) || displayName(S.email); }
  async function tgLoad() {
    var c = await sb.rpc('my_classes');
    if (c.error) { TG.missing = true; TG.loaded = true; return render(); }
    TG.classes = c.data || [];
    var st = await sb.rpc('my_students');
    TG.students = st.data || [];
    TG.loaded = true;
    render();
  }
  async function tgLoadItems() {
    var r = await sb.from('grade_items').select('*').order('term').order('sort').order('created_at');
    if (r.error) { TG.missing = true; TG.items = []; } else TG.items = r.data || [];
    render();
  }
  function tgClassList() { var m = {}; TG.classes.forEach(function (c) { m[c.class_name] = 1; }); return Object.keys(m); }
  function tgShown() {
    var u = tgUi(), q = norm(u.q);
    return TG.students.filter(function (x) { return (!u.cls || x.class_name === u.cls) && (!q || norm(x.full_name).indexOf(q) > -1); });
  }

  function renderMyStudents() {
    if (!TG.loaded) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; tgLoad(); return; }
    if (TG.missing) { app.innerHTML = '<div class="card empty">هذه الشاشة تحتاج تجهيز قاعدة البيانات: يشغّل المدير العام الملف <code dir="ltr">supabase/teacher_grades.sql</code>.</div>'; return; }
    var u = tgUi(), list = tgShown(), classes = tgClassList();
    var subj = function (cls) { return TG.classes.filter(function (c) { return c.class_name === cls; }).map(function (c) { return c.subject; }).filter(Boolean).join('، '); };
    app.innerHTML = '<div class="page-head"><div><h1>طلابي</h1><p>طلاب الشعب التي تدرّسها في جدول الحصص: ' + (classes.map(function (c) { return esc(c) + (subj(c) ? ' (' + esc(subj(c)) + ')' : ''); }).join(' · ') || 'لا شعب لك في جدول الحصص بعد') + '</p></div></div>' +
      '<div class="card"><div class="toolbar" style="align-items:center;margin:0">' +
        '<select id="tg-cls" data-ro-ok style="width:auto"><option value="">كل شعبي</option>' + classes.map(function (c) { return '<option' + (u.cls === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
        '<input type="search" id="tg-q" placeholder="ابحث بالاسم" style="flex:1;min-width:180px" value="' + esc(u.q) + '">' +
        '<button type="button" class="btn" data-tgpdf data-ro-ok' + (list.length ? '' : ' disabled') + '>تصدير PDF</button><button type="button" class="btn" data-tgxlsx data-ro-ok' + (list.length ? '' : ' disabled') + '>تصدير Excel</button></div>' +
      (list.length ? '<div class="table-wrap" style="margin-top:8px"><table class="grid"><thead><tr><th>م</th>' + TG_COLS.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
        list.map(function (x, i) { return '<tr><td>' + (i + 1) + '</td>' + TG_COLS.map(function (c) { var v = tgVal(x, c[0]); return '<td' + (/phone/.test(c[0]) ? ' dir="ltr" style="text-align:right;white-space:nowrap"' : '') + '>' + (c[0] === 'full_name' ? '<b>' + esc(v) + '</b>' : esc(v)) + '</td>'; }).join('') + '</tr>'; }).join('') +
        '</tbody></table></div><p class="st-count">' + list.length + ' طالبًا</p>' : '<div class="empty">لا طلاب.</div>') + '</div>';
  }

  var pendingTg = false;
  // كشف طلابي: بلا توقيعات، واسم المعلم علامة مائية مائلة في وسط كل صفحة
  function buildMyStudentsSheet() {
    var u = tgUi(), list = tgShown(), n = TG_COLS.length + 1, name = tgTeacherName();
    var head = reportHead('كشف بيانات الطلاب', [['المعلم', name], ['الشعبة', u.cls || 'كل الشعب'], ['العدد', list.length]]).replace(/^<img class="wm"[^>]*>/, '');
    sheet.className = 'ls';
    sheet.setAttribute('data-nosign', '1');
    sheet.removeAttribute('data-fit');
    sheet.innerHTML = '<div style="position:fixed;top:42%;left:0;right:0;text-align:center;transform:rotate(-28deg);font-size:46pt;font-weight:800;color:rgba(19,48,107,.07);white-space:nowrap;pointer-events:none;z-index:0">' + esc(name) + '</div>' +
      '<table class="rz"><thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>' +
      '<tr><th>م</th>' + TG_COLS.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      list.map(function (x, i) { return '<tr><td class="c">' + (i + 1) + '</td>' + TG_COLS.map(function (c) { var v = tgVal(x, c[0]); return '<td' + (/phone|birth/.test(c[0]) ? ' class="c" dir="ltr"' : '') + '>' + (c[0] === 'full_name' ? '<b>' + esc(v) + '</b>' : esc(v)) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody><tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>';
  }
  async function tgXlsx() {
    try {
      await loadXlsx();
      var u = tgUi(), list = tgShown(), wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      var ws = XLSX.utils.aoa_to_sheet([[schoolName() + ' — كشف بيانات الطلاب'], ['المعلم: ' + tgTeacherName() + ' — ' + (u.cls || 'كل الشعب')], [], ['م'].concat(TG_COLS.map(function (c) { return c[1]; }))].concat(list.map(function (x, i) { return [i + 1].concat(TG_COLS.map(function (c) { return tgVal(x, c[0]); })); })));
      XLSX.utils.book_append_sheet(wb, ws, 'الطلاب');
      XLSX.writeFile(wb, 'طلابي-' + (u.cls || 'كل-الشعب') + '-' + todayISO() + '.xlsx');
    } catch (err) { toast(err.message || String(err), true); }
  }

  // ----- إعداد الدرجات (الإدارة) -----
  function renderGradeCfg() {
    if (TG.items == null) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; tgLoadItems(); return; }
    if (TG.missing) { app.innerHTML = '<div class="card empty">شغّل الملف <code dir="ltr">supabase/teacher_grades.sql</code> في محرر SQL، ثم حدّث الصفحة.</div>'; return; }
    var terms = {}; TG.items.forEach(function (x) { (terms[x.term] = terms[x.term] || []).push(x); });
    var names = Object.keys(terms);
    app.innerHTML = '<div class="page-head"><div><h1>إعداد الدرجات</h1><p>لكل فصل دراسي اختباراته ودرجة كلٍّ منها (مثل: اختبار أكتوبر 10، اختبار نصف الفصل 30). يرصد المعلمون الدرجات عليها، ويُحسب المجموع.</p></div></div>' +
      '<form class="card" id="gc-form"><h2>إضافة اختبار</h2><div class="toolbar" style="align-items:flex-end">' +
        '<div><label class="field" for="gc-term">الفصل الدراسي</label><input type="text" id="gc-term" list="gc-terms" value="' + esc(names[0] || 'الفصل الدراسي الأول') + '"><datalist id="gc-terms"><option value="الفصل الدراسي الأول"><option value="الفصل الدراسي الثاني">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist></div>' +
        '<div style="flex:1;min-width:200px"><label class="field" for="gc-name">اسم الاختبار</label><input type="text" id="gc-name" required placeholder="مثال: اختبار أكتوبر"></div>' +
        '<div style="width:8em"><label class="field" for="gc-max">الدرجة</label><input type="number" id="gc-max" min="0.5" step="0.5" required placeholder="10"></div>' +
        '<button type="submit" class="btn primary">إضافة</button></div></form>' +
      (names.length ? names.map(function (t) {
        var sum = terms[t].reduce(function (a, x) { return a + Number(x.max_score); }, 0);
        return '<div class="card"><h2>' + esc(t) + ' — المجموع ' + sum + '</h2><div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الاختبار</th><th>الدرجة</th><th>الترتيب</th><th></th></tr></thead><tbody>' +
          terms[t].map(function (x, i) {
            return '<tr><td>' + (i + 1) + '</td><td><input type="text" data-gcname="' + x.id + '" value="' + esc(x.name) + '"></td><td><input type="number" min="0.5" step="0.5" style="width:6em" data-gcmax="' + x.id + '" value="' + esc(x.max_score) + '"></td>' +
              '<td><input type="number" style="width:5em" data-gcsort="' + x.id + '" value="' + esc(x.sort) + '"></td><td><button type="button" class="btn danger" data-gcdel="' + x.id + '">حذف</button></td></tr>';
          }).join('') + '</tbody></table></div><p class="hint">التعديل يُحفظ عند الخروج من الخانة.</p></div>';
      }).join('') : '<div class="card empty">لا اختبارات بعد.</div>');
  }
  document.addEventListener('submit', async function (e) {
    if (e.target.id !== 'gc-form' || !isAdmin()) return;
    e.preventDefault();
    var term = document.getElementById('gc-term').value.trim(), name = document.getElementById('gc-name').value.trim(), max = Number(document.getElementById('gc-max').value);
    if (!term || !name || !(max > 0)) return toast('اكتب الفصل واسم الاختبار ودرجته', true);
    var r = await sb.from('grade_items').insert({ term: term, name: name, max_score: max, sort: TG.items.filter(function (x) { return x.term === term; }).length + 1 }).select().single();
    if (r.error) return fail(r.error);
    TG.items.push(r.data); render(); toast('أُضيف «' + name + '»');
  });
  document.addEventListener('change', async function (e) {
    if (location.hash !== '#/gradecfg' || !isAdmin()) return;
    var el = e.target, id, k;
    if ((id = el.getAttribute('data-gcname'))) k = 'name'; else if ((id = el.getAttribute('data-gcmax'))) k = 'max_score'; else if ((id = el.getAttribute('data-gcsort'))) k = 'sort'; else return;
    var v = k === 'name' ? el.value.trim() : Number(el.value);
    if (k === 'name' ? !v : k === 'max_score' ? !(v > 0) : isNaN(v)) return toast('قيمة غير صحيحة', true);
    var p = {}; p[k] = v;
    var r = await sb.from('grade_items').update(p).eq('id', id);
    if (r.error) return fail(r.error);
    TG.items.forEach(function (x) { if (x.id === id) x[k] = v; });
    if (k === 'sort') { TG.items.sort(function (a, b) { return a.term.localeCompare(b.term) || a.sort - b.sort; }); render(); }
    toast('تم الحفظ');
  });
  document.addEventListener('click', async function (e) {
    var el;
    if (location.hash === '#/gradecfg' && isAdmin() && (el = e.target.closest('[data-gcdel]'))) {
      var x = TG.items.filter(function (q) { return q.id === el.getAttribute('data-gcdel'); })[0];
      if (!x || !confirm('حذف «' + x.name + '»؟ ستُحذف كل الدرجات المرصودة عليه.')) return;
      var d = await sb.from('grade_items').delete().eq('id', x.id);
      if (d.error) return fail(d.error);
      TG.items = TG.items.filter(function (q) { return q.id !== x.id; }); render();
    }
  });

  // ----- رصد الدرجات -----
  // الشعب والمواد: للمعلم من جدوله؛ وللمدير العام والمدير كل ما في جدول الحصص
  async function tgLoadAllClasses() {
    var r = await fetchAll(function () { return sb.from('timetable_sessions').select('class_name, subject').neq('status', 'removed'); });
    var m = {}; (r || []).forEach(function (x) { if (x.class_name && x.subject) m[x.class_name + '\u0001' + x.subject] = { class_name: x.class_name, subject: x.subject }; });
    TG.classes = Object.keys(m).sort().map(function (k) { return m[k]; });
    TG.students = S.students.filter(enrolled).map(function (x) { return { id: x.id, full_name: x.full_name, class_name: x.class_name }; });
    TG.loaded = true; render();
  }
  function renderGrades() {
    var staffView = !isTeacherRole();
    if (!TG.loaded) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; if (staffView) tgLoadAllClasses(); else tgLoad(); return; }
    if (TG.items == null) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; tgLoadItems(); return; }
    if (TG.missing) { app.innerHTML = '<div class="card empty">رصد الدرجات يحتاج تجهيز قاعدة البيانات: الملف <code dir="ltr">supabase/teacher_grades.sql</code>.</div>'; return; }
    var u = tgUi(), terms = []; TG.items.forEach(function (x) { if (terms.indexOf(x.term) < 0) terms.push(x.term); });
    if (!u.term || terms.indexOf(u.term) < 0) u.term = terms[0] || '';
    if (!u.key && TG.classes.length) u.key = TG.classes[0].class_name + '\u0001' + TG.classes[0].subject;
    var parts = u.key.split('\u0001'), cls = parts[0], subj = parts[1] || '';
    var items = TG.items.filter(function (x) { return x.term === u.term; }), maxSum = items.reduce(function (a, x) { return a + Number(x.max_score); }, 0);
    var studs = TG.students.filter(function (x) { return x.class_name === cls; }).sort(function (a, b) { return a.full_name.localeCompare(b.full_name, 'ar'); });
    var gk = u.term + '|' + u.key;
    if (u.gkey !== gk && items.length && studs.length) { u.gkey = gk; u.grades = null; u.draft = {}; tgLoadGrades(items, studs, subj); }
    var canEdit = !isManager() && role() !== 'supervisor';
    var head = '<div class="page-head"><div><h1>رصد الدرجات</h1><p>اختر الفصل الدراسي والشعبة والمادة، ثم اكتب درجات الطلاب. اختبارات كل فصل ودرجاتها تحدّدها الإدارة' + (isAdmin() ? ' من <a href="#/gradecfg">إعداد الدرجات</a>' : '') + '.</p></div></div>';
    var bar = '<div class="card"><div class="toolbar" style="align-items:center;margin:0">' +
      '<label class="field" for="tg-term" style="margin:0">الفصل</label><select id="tg-term" data-ro-ok style="width:auto">' + terms.map(function (t) { return '<option' + (t === u.term ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select>' +
      '<label class="field" for="tg-key" style="margin:0">الشعبة والمادة</label><select id="tg-key" data-ro-ok style="width:auto">' + TG.classes.map(function (c) { var k = c.class_name + '\u0001' + c.subject; return '<option value="' + esc(k) + '"' + (k === u.key ? ' selected' : '') + '>' + esc(c.class_name + ' — ' + (c.subject || 'بلا مادة')) + '</option>'; }).join('') + '</select>' +
      '<span style="flex:1"></span>' + (canEdit ? '<button type="button" class="btn primary" data-tgsave' + (Object.keys(u.draft).length ? '' : ' disabled') + '>حفظ الدرجات</button>' : '') + '<button type="button" class="btn" data-tggx data-ro-ok>تصدير Excel</button></div></div>';
    if (!terms.length) { app.innerHTML = head + '<div class="card empty">لم تُعدّ الإدارة اختبارات بعد' + (isAdmin() ? '؛ أضفها من <a href="#/gradecfg">إعداد الدرجات</a>.' : '.') + '</div>'; return; }
    if (!TG.classes.length) { app.innerHTML = head + '<div class="card empty">لا شعب في جدول الحصص' + (staffView ? '' : ' باسمك') + '.</div>'; return; }
    if (!studs.length) { app.innerHTML = head + bar + '<div class="card empty">لا طلاب في هذه الشعبة.</div>'; return; }
    if (u.grades == null) { app.innerHTML = head + bar + '<div class="card empty">جارٍ تحميل الدرجات…</div>'; return; }
    var val = function (sid, iid) { var k = sid + '|' + iid; return k in u.draft ? u.draft[k] : (u.grades[k] == null ? '' : u.grades[k]); };
    app.innerHTML = head + bar + '<div class="card"><h2 style="margin-top:0">' + esc(cls) + ' — ' + esc(subj) + ' — ' + esc(u.term) + '</h2><div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الطالب</th>' +
      items.map(function (x) { return '<th style="white-space:nowrap">' + esc(x.name) + '<br><span class="meta">(' + x.max_score + ')</span></th>'; }).join('') + '<th>المجموع<br><span class="meta">(' + maxSum + ')</span></th></tr></thead><tbody>' +
      studs.map(function (x, i) {
        var tot = 0, any = false;
        var cells = items.map(function (it) { var v = val(x.id, it.id); if (v !== '' && v != null) { tot += Number(v); any = true; } return '<td><input type="number" min="0" max="' + it.max_score + '" step="0.25" style="width:5.5em" data-tgg="' + x.id + '|' + it.id + '" value="' + esc(v) + '"' + (canEdit ? '' : ' disabled') + '></td>'; }).join('');
        return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(x.full_name) + '</b></td>' + cells + '<td><b data-tgtot="' + x.id + '">' + (any ? Math.round(tot * 100) / 100 : '—') + '</b></td></tr>';
      }).join('') + '</tbody></table></div>' + (canEdit ? '<p class="hint">اكتب الدرجات ثم اضغط «حفظ الدرجات». الخانة الفارغة: لم تُرصد.</p>' : '') + '</div>';
  }
  async function tgLoadGrades(items, studs, subj) {
    var u = tgUi(), ids = studs.map(function (x) { return x.id; }), out = {};
    var r = await sb.from('grades').select('student_id, item_id, score').eq('subject', subj).limit(20000), okI = {}, okS = {};
    items.forEach(function (x) { okI[x.id] = 1; }); ids.forEach(function (id) { okS[id] = 1; });
    if (r.error) { toast('تعذّر جلب الدرجات: ' + r.error.message, true); u.grades = {}; return render(); }
    (r.data || []).forEach(function (g) { if (okI[g.item_id] && okS[g.student_id]) out[g.student_id + '|' + g.item_id] = g.score; });
    u.grades = out; render();
  }
  document.addEventListener('input', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-tgg');
    if (location.hash !== '#/grades' || !k) return;
    var u = tgUi(), it = TG.items.filter(function (x) { return x.id === k.split('|')[1]; })[0], v = e.target.value;
    if (v !== '' && (Number(v) < 0 || Number(v) > Number(it.max_score))) { e.target.style.background = '#fee2e2'; return; }
    e.target.style.background = '#fffbeb';
    u.draft[k] = v;
    var sid = k.split('|')[0], tot = 0, any = false;
    TG.items.filter(function (x) { return x.term === u.term; }).forEach(function (x) { var kk = sid + '|' + x.id, vv = kk in u.draft ? u.draft[kk] : u.grades[kk]; if (vv !== '' && vv != null) { tot += Number(vv); any = true; } });
    var b = document.querySelector('[data-tgtot="' + sid + '"]'); if (b) b.textContent = any ? Math.round(tot * 100) / 100 : '—';
    var sv = document.querySelector('[data-tgsave]'); if (sv) sv.disabled = false;
  });
  async function tgSave() {
    var u = tgUi(), subj = u.key.split('\u0001')[1] || '', who = (S.profile && S.profile.full_name) || displayName(S.email), now = new Date().toISOString();
    var rows = Object.keys(u.draft).map(function (k) { var p = k.split('|'); return { student_id: p[0], item_id: p[1], subject: subj, score: u.draft[k] === '' ? null : Number(u.draft[k]), teacher_id: S.myStaff ? S.myStaff.id : null, updated_by: who, updated_at: now }; });
    if (!rows.length) return;
    var r = await sb.from('grades').upsert(rows, { onConflict: 'student_id,item_id,subject' });
    if (r.error) return fail(r.error);
    rows.forEach(function (x) { u.grades[x.student_id + '|' + x.item_id] = x.score; });
    u.draft = {}; render(); toast('حُفظت ' + rows.length + ' درجة');
  }
  async function tgGradesXlsx() {
    try {
      await loadXlsx();
      var u = tgUi(), parts = u.key.split('\u0001'), items = TG.items.filter(function (x) { return x.term === u.term; });
      var studs = TG.students.filter(function (x) { return x.class_name === parts[0]; }).sort(function (a, b) { return a.full_name.localeCompare(b.full_name, 'ar'); });
      var g = u.grades || {}, wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      var aoa = [[schoolName() + ' — درجات ' + parts[0] + ' — ' + (parts[1] || '') + ' — ' + u.term], [], ['م', 'الطالب'].concat(items.map(function (x) { return x.name + ' (' + x.max_score + ')'; }), ['المجموع (' + items.reduce(function (a, x) { return a + Number(x.max_score); }, 0) + ')'])];
      studs.forEach(function (x, i) { var tot = 0; var row = [i + 1, x.full_name].concat(items.map(function (it) { var v = g[x.id + '|' + it.id]; if (v != null) tot += Number(v); return v == null ? '' : Number(v); })); aoa.push(row.concat([tot])); });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'الدرجات');
      XLSX.writeFile(wb, 'درجات-' + parts[0] + '-' + (parts[1] || '') + '.xlsx');
    } catch (err) { toast(err.message || String(err), true); }
  }
  document.addEventListener('click', function (e) {
    if (location.hash === '#/mystudents') {
      if (e.target.closest('[data-tgpdf]')) { pendingTg = true; return printNow(); }
      if (e.target.closest('[data-tgxlsx]')) return tgXlsx();
    }
    if (location.hash === '#/grades') {
      if (e.target.closest('[data-tgsave]')) return tgSave();
      if (e.target.closest('[data-tggx]')) return tgGradesXlsx();
    }
  });
  document.addEventListener('change', function (e) {
    var u = tgUi(), id = e.target.id;
    if (location.hash === '#/mystudents' && id === 'tg-cls') { u.cls = e.target.value; return render(); }
    if (location.hash === '#/grades' && (id === 'tg-term' || id === 'tg-key')) {
      if (Object.keys(u.draft).length && !confirm('في الدرجات تعديلات لم تُحفظ. تركها؟')) { e.target.value = id === 'tg-term' ? u.term : u.key; return; }
      u[id === 'tg-term' ? 'term' : 'key'] = e.target.value; u.draft = {}; return render();
    }
  });
  document.addEventListener('input', function (e) {
    if (location.hash !== '#/mystudents' || e.target.id !== 'tg-q') return;
    var u = tgUi(), pos = e.target.selectionStart; u.q = e.target.value; render();
    var q = document.getElementById('tg-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} }
  });

  /* ---------- المطالبات المالية ----------
     دفع مبلغ لشخص استُعين به أو اشتُري منه شيء بلا فاتورة: اسمه، وما أنجزه أو الأصناف ومبالغها، والتاريخ،
     وتُطبع سندًا بإقرار المستلم وتوقيعه، وتوقيع مسلِّم المبلغ، واعتماد المدير. يعدّلها المدير العام ويراها المدير (supabase/payment_claims.sql) */
  var CL_KIND = { service: 'خدمة أو عمل منجز', purchase: 'شراء أصناف بدون فاتورة' };
  function clState() { return S.cl || (S.cl = { list: [], loaded: false, loading: false, missing: false, edit: null, q: '' }); }
  function clNew() { return { id: null, claim_date: todayISO(), payee: '', payee_id: '', kind: 'service', description: '', items: [{ item: '', qty: '', amount: '' }], payer: '', status: 'pending', notes: '' }; }
  function clTotal(c) { return (c.items || []).reduce(function (t, i) { return t + (Number(latinDigits(String(i.amount || '')).replace(/[^\d.]/g, '')) || 0); }, 0); }
  function clMoney(n) { return (Math.round(n * 100) / 100).toLocaleString('en-US') + ' جنيه'; }
  async function loadClaims() {
    var c = clState();
    if (c.loading) return;
    c.loading = true;
    var rows = await fetchAll(function () { return sb.from('payment_claims').select('*').order('claim_date', { ascending: false }).order('no', { ascending: false }); });
    c.loading = false; c.loaded = true; c.missing = !rows; c.list = rows || [];
    render();
  }
  function renderClaims() {
    var c = clState(), edit = isAdmin();
    if (!c.loaded) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; loadClaims(); return; }
    if (c.missing) { app.innerHTML = '<div class="card empty">المطالبات المالية تحتاج جدولًا جديدًا.<br>شغّل الملف <code dir="ltr">supabase/payment_claims.sql</code> في محرر SQL، ثم حدّث الصفحة.</div>'; return; }
    var o = c.edit, head = '<div class="page-head"><div><h1>المطالبات المالية</h1><p>دفع مبلغ لشخص استُعين به أو اشتُري منه شيء بلا فاتورة، ويُطبع سندًا بتوقيع المستلم ومسلِّم المبلغ.</p></div>' +
      (edit && !o ? '<button type="button" class="btn primary" data-clnew>مطالبة جديدة</button>' : '') + '</div>';
    if (o) {
      var f = function (id, k, label, extra) { return '<div' + (extra || '') + '><label class="field" for="' + id + '">' + label + '</label><input type="text" id="' + id + '" data-cf="' + k + '" value="' + esc(o[k]) + '"></div>'; };
      app.innerHTML = head + '<div class="card"><h2 style="margin-top:0">' + (o.id ? 'تعديل المطالبة رقم ' + esc(o.no) : 'مطالبة جديدة') + '</h2>' +
        '<div class="toolbar" style="align-items:flex-end">' +
          '<div style="width:11em"><label class="field" for="cl-date">التاريخ</label><input type="date" id="cl-date" data-cf="claim_date" value="' + esc(o.claim_date) + '"></div>' +
          f('cl-payee', 'payee', 'اسم المستفيد <span class="req">*</span>', ' style="flex:2;min-width:220px"') +
          f('cl-pid', 'payee_id', 'رقم الهوية أو الجوال (اختياري)', ' style="flex:1;min-width:160px"') + '</div>' +
        '<div class="toolbar" style="align-items:flex-end">' +
          '<div style="width:15em"><label class="field" for="cl-kind">نوع المطالبة</label><select id="cl-kind" data-cf="kind">' + Object.keys(CL_KIND).map(function (k) { return '<option value="' + k + '"' + (o.kind === k ? ' selected' : '') + '>' + CL_KIND[k] + '</option>'; }).join('') + '</select></div>' +
          f('cl-payer', 'payer', 'مسلِّم المبلغ', ' style="flex:1;min-width:180px"') +
          '<div style="width:9em"><label class="field" for="cl-status">الحالة</label><select id="cl-status" data-cf="status"><option value="pending"' + (o.status === 'pending' ? ' selected' : '') + '>لم يُصرف</option><option value="paid"' + (o.status === 'paid' ? ' selected' : '') + '>صُرف</option></select></div></div>' +
        '<label class="field" for="cl-desc">' + (o.kind === 'purchase' ? 'بيان الشراء' : 'العمل الذي أُنجز') + '</label><textarea id="cl-desc" data-cf="description" rows="2" style="width:100%" placeholder="' + (o.kind === 'purchase' ? 'مثال: أدوات كهرباء لصيانة الفصول' : 'مثال: صيانة مضخة المياه وتغيير المحبس') + '">' + esc(o.description) + '</textarea>' +
        '<h3>' + (o.kind === 'purchase' ? 'الأصناف' : 'البنود') + '</h3><div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>' + (o.kind === 'purchase' ? 'الصنف' : 'البند') + '</th><th style="width:8em">الكمية</th><th style="width:9em">المبلغ (جنيه)</th><th></th></tr></thead><tbody>' +
          o.items.map(function (it, i) {
            return '<tr><td>' + (i + 1) + '</td><td><input type="text" data-ci="' + i + '|item" value="' + esc(it.item) + '" aria-label="البند"></td><td><input type="text" data-ci="' + i + '|qty" value="' + esc(it.qty) + '" aria-label="الكمية"></td>' +
              '<td><input type="text" inputmode="decimal" data-ci="' + i + '|amount" value="' + esc(it.amount) + '" aria-label="المبلغ"></td><td><button type="button" class="btn danger" data-cldelit="' + i + '">×</button></td></tr>';
          }).join('') + '<tr class="total"><td colspan="3"><b>الإجمالي</b></td><td><b id="cl-total">' + clMoney(clTotal(o)) + '</b></td><td></td></tr></tbody></table></div>' +
        '<div class="toolbar" style="margin-top:8px"><button type="button" class="btn" data-cladd>+ إضافة بند</button></div>' +
        '<label class="field" for="cl-notes">ملاحظات داخلية (لا تُطبع)</label><input type="text" id="cl-notes" data-cf="notes" value="' + esc(o.notes) + '">' +
        '<div class="toolbar" style="margin-top:12px"><button type="button" class="btn primary" data-clsave>حفظ</button><button type="button" class="btn" data-clsaveprint>حفظ وطباعة</button><button type="button" class="btn" data-clcancel>إلغاء</button></div></div>';
      return;
    }
    var q = norm(c.q), list = c.list.filter(function (x) { return !q || norm(x.payee + ' ' + x.description + ' ' + (x.items || []).map(function (i) { return i.item; }).join(' ')).indexOf(q) > -1; });
    var sum = list.reduce(function (t, x) { return t + clTotal(x); }, 0);
    app.innerHTML = head + '<div class="card"><div class="toolbar" style="align-items:center;margin:0 0 8px"><h2 style="margin:0;flex:1">عدد المطالبات: ' + list.length + ' — المجموع: ' + clMoney(sum) + '</h2>' +
      (function () { var n = Object.keys(c.sel || {}).filter(function (k) { return c.sel[k]; }).length; return '<button type="button" class="btn" data-clprintblank data-ro-ok>طباعة سندات فارغة</button> <button type="button" class="btn primary" data-clprintsel data-ro-ok' + (n ? '' : ' disabled') + '>طباعة المحدد' + (n ? ' (' + n + ')' : '') + ' — 6 في الصفحة</button>'; })() +
      '<input type="search" id="cl-q" placeholder="بحث بالاسم أو البيان" aria-label="بحث" style="max-width:260px" value="' + esc(c.q) + '"></div>' +
      (list.length ? '<div class="table-wrap"><table class="grid"><thead><tr><th>رقم</th><th>التاريخ</th><th>المستفيد</th><th>النوع</th><th>البيان</th><th>المبلغ</th><th>الحالة</th><th></th></tr></thead><tbody>' +
        list.map(function (x) {
          return '<tr><td><label class="check" style="margin:0"><input type="checkbox" data-clsel="' + x.id + '" data-ro-ok' + (c.sel && c.sel[x.id] ? ' checked' : '') + '> ' + esc(x.no) + '</label></td><td>' + dmy(x.claim_date) + '</td><td><b>' + esc(x.payee) + '</b></td><td>' + esc(CL_KIND[x.kind] || '') + '</td><td>' + esc(x.description || (x.items || []).map(function (i) { return i.item; }).join('، ')) + '</td>' +
            '<td><b>' + clMoney(clTotal(x)) + '</b></td><td>' + (x.status === 'paid' ? '<span class="badge paid">صُرف</span>' : '<span class="badge pending">لم يُصرف</span>') + '</td>' +
            '<td style="white-space:nowrap"><button type="button" class="btn" data-clprint="' + x.id + '" data-ro-ok>طباعة / PDF</button>' +
            (edit ? ' <button type="button" class="btn" data-clopen="' + x.id + '">تعديل</button> <button type="button" class="btn danger" data-cldel="' + x.id + '">حذف</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">' + (c.list.length ? 'لا مطالبات مطابقة.' : 'لا توجد مطالبات بعد' + (edit ? '؛ اضغط «مطالبة جديدة».' : '.')) + '</div>') + '</div>';
  }

  // المبلغ بالحروف: «مائة وخمسون جنيهًا مصريًا» (حتى المليارات، مع القروش)
  function arWords(n) {
    var ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
    var tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
    var hund = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
    function lt1000(x) {
      var h = Math.floor(x / 100), r = x % 100, p = [];
      if (h) p.push(hund[h]);
      if (r) p.push(r < 20 ? ones[r] : (r % 10 ? ones[r % 10] + ' و' : '') + tens[Math.floor(r / 10)]);
      return p.join(' و');
    }
    function scale(x, one, two, few, many) { return x === 1 ? one : x === 2 ? two : x <= 10 ? lt1000(x) + ' ' + few : lt1000(x) + ' ' + many; }
    if (!n) return 'صفر';
    var b = Math.floor(n / 1e9), m = Math.floor(n / 1e6) % 1000, t = Math.floor(n / 1000) % 1000, r = n % 1000, p = [];
    if (b) p.push(scale(b, 'مليار', 'ملياران', 'مليارات', 'مليار'));
    if (m) p.push(scale(m, 'مليون', 'مليونان', 'ملايين', 'مليون'));
    if (t) p.push(scale(t, 'ألف', 'ألفان', 'آلاف', 'ألف'));
    if (r) p.push(lt1000(r));
    return p.join(' و');
  }
  function arMoneyWords(v) {
    var pounds = Math.floor(v + 1e-9), pt = Math.round((v - pounds) * 100);
    return (pounds ? arWords(pounds) + ' جنيهًا مصريًا' : '') + (pt ? (pounds ? ' و' : '') + arWords(pt) + ' قرشًا' : '') || 'صفر';
  }

  var pendingCl = null;
  // سند المطالبة: البيانات، جدول البنود والإجمالي، إقرار المستلم، ثم التوقيعات (المستلم، مسلِّم المبلغ، المدير)
  // سند الصرف: سند صغير بترويسة سطر واحد، 6 سندات في صفحة A4 (عمودان × 3 صفوف) بخطوط قص.
  // سند واحد ← أصل ونسخة؛ «طباعة المحدد» ← كل سند مرة، 6 في كل صفحة
  // سند فارغ للكتابة باليد: نفس الترويسة الصغيرة، والحقول خطوط منقّطة، بلا رقم
  function clBlankVoucher() {
    var ln = function (lbl, w) { return '<div style="display:flex;gap:2mm;align-items:flex-end;margin-top:2.2mm"><span style="white-space:nowrap">' + lbl + '</span><span style="flex:' + (w || 1) + ';border-bottom:1px dotted #444;height:1.2em"></span></div>'; };
    var sg = function (t) { return '<div style="flex:1;text-align:center"><b style="font-size:8.5pt">' + t + '</b><div style="border-bottom:1px dotted #555;margin:4mm 2mm 0"></div><div style="border-bottom:1px dotted #555;margin:5mm 2mm 0"></div></div>'; };
    return '<div style="box-sizing:border-box;height:100%;padding:3mm 3.5mm;display:flex;flex-direction:column;font-size:9.5pt;line-height:1.5;overflow:hidden">' +
      '<div style="display:flex;align-items:center;gap:2mm;border-bottom:1.5px solid #13306B;padding-bottom:1.5mm">' +
        '<img src="' + REPORT.logo + '" alt="" style="width:10mm;height:10mm;object-fit:contain">' +
        '<div style="flex:1;line-height:1.3"><div style="font-weight:700;color:#13306B;font-size:9.5pt">' + esc(schoolName()) + '</div><div style="font-size:12pt;font-weight:700">سند صرف</div></div>' +
        '<div style="font-size:8.5pt;width:28mm">' + ln('التاريخ:') + '</div></div>' +
      ln('اسم المستفيد:') + ln('رقم الموبايل:') + ln('المبلغ:') + ln('فقط') + ln('وذلك مقابل:') + '<div style="border-bottom:1px dotted #444;height:1.2em;margin-top:2.2mm"></div>' +
      '<div style="font-size:8pt;color:#333;margin-top:1.5mm">أقر بأنني استلمت المبلغ المذكور أعلاه، ولا يحق لي المطالبة بأي مبالغ أخرى عنه.</div>' +
      '<div style="display:flex;gap:2mm;margin-top:auto">' + sg('المستلم') + sg('مسلِّم المبلغ') + sg('المدير/ة') + '</div></div>';
  }
  function clVoucher(o, tag) {
    if (o === 'blank') return clBlankVoucher();
    var items = (o.items || []).filter(function (i) { return String(i.item || '').trim(); }), total = clTotal(o);
    var lines = items.map(function (it) { return esc(it.item) + (it.qty ? ' (' + esc(it.qty) + ')' : '') + (items.length > 1 && it.amount ? ' — ' + clMoney(Number(latinDigits(String(it.amount)).replace(/[^\d.]/g, '')) || 0) : ''); }).join('، ');
    if (o.kind !== 'purchase' && o.description) lines = esc(o.description) + (lines ? ' — ' + lines : '');
    var sg = function (t, n) { return '<div style="flex:1;text-align:center"><b style="font-size:8.5pt">' + t + '</b><div style="font-size:8.5pt;min-height:1.3em">' + esc(n || '') + '</div><div style="border-bottom:1px dotted #555;margin:5mm 2mm 0"></div></div>'; };
    return '<div style="position:relative;box-sizing:border-box;height:100%;padding:3mm 3.5mm;display:flex;flex-direction:column;font-size:9.5pt;line-height:1.55;overflow:hidden">' +
      '<div style="display:flex;align-items:center;gap:2mm;border-bottom:1.5px solid #13306B;padding-bottom:1.5mm">' +
        '<img src="' + REPORT.logo + '" alt="" style="width:10mm;height:10mm;object-fit:contain">' +
        '<div style="flex:1;line-height:1.3"><div style="font-weight:700;color:#13306B;font-size:9.5pt">' + esc(schoolName()) + '</div><div style="font-size:12pt;font-weight:700">سند صرف</div></div>' +
        '<div style="text-align:left;font-size:8.5pt;line-height:1.4"><span style="border:1.2px solid #13306B;color:#13306B;font-weight:700;padding:0 6px;border-radius:3px">' + tag + '</span><div>رقم: <b>' + esc(o.no || '') + '</b></div><div>' + dmy(o.claim_date) + '</div></div></div>' +
      '<div style="margin-top:1.5mm">اسم المستفيد: <b>' + esc(o.payee) + '</b></div>' +
      (o.payee_id ? '<div>رقم الموبايل: <span dir="ltr">' + esc(o.payee_id) + '</span></div>' : '') +
      '<div style="margin:1mm 0;padding:1mm 2mm;background:#F4F1EA;border-radius:2mm">المبلغ: <b style="font-size:11pt">' + clMoney(total) + '</b><div style="font-size:8.5pt">فقط ' + esc(arMoneyWords(total)) + ' لا غير</div></div>' +
      (lines ? '<div style="font-size:8.5pt;max-height:3.2em;overflow:hidden">وذلك مقابل: ' + lines + '</div>' : '') +
      '<div style="font-size:8pt;color:#333;margin-top:1mm">أقر بأنني استلمت المبلغ المذكور أعلاه، ولا يحق لي المطالبة بأي مبالغ أخرى عنه.</div>' +
      '<div style="display:flex;gap:2mm;margin-top:auto">' + sg('المستلم', o.payee) + sg('مسلِّم المبلغ', o.payer) + sg('المدير/ة', principalName()) + '</div></div>';
  }
  function buildClaimSheet(o) {
    var cells = o === 'blank' ? [0, 1, 2, 3, 4, 5].map(function () { return ['blank', '']; }) : Array.isArray(o) ? o.map(function (x) { return [x, 'أصل']; }) : [[o, 'أصل'], [o, 'نسخة']], pages = [];
    for (var k = 0; k < cells.length; k += 6) pages.push(cells.slice(k, k + 6));
    sheet.className = 'ps';
    sheet.removeAttribute('data-fit');
    sheet.setAttribute('data-nosign', '1');
    sheet.innerHTML = pages.map(function (pg, pi) {
      return '<div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(3,86mm);border:1px dashed #999;' + (pi < pages.length - 1 ? 'break-after:page;page-break-after:always;' : '') + '">' +
        [0, 1, 2, 3, 4, 5].map(function (n) {
          var c = pg[n];
          return '<div style="border-' + (n % 2 ? 'right' : 'left') + ':1px dashed #999;' + (n < 4 ? 'border-bottom:1px dashed #999;' : '') + 'overflow:hidden">' + (c ? clVoucher(c[0], c[1]) : '') + '</div>';
        }).join('') + '</div>';
    }).join('');
  }
  function clPick(id) { return clState().list.filter(function (x) { return x.id === id; })[0]; }
  async function clSave(andPrint) {
    var c = clState(), o = c.edit;
    if (!o.payee.trim()) return toast('اكتب اسم المستفيد', true);
    var items = o.items.map(function (i) { return { item: String(i.item || '').trim(), qty: String(i.qty || '').trim(), amount: String(i.amount || '').trim() }; }).filter(function (i) { return i.item || i.amount; });
    if (!items.length) return toast('أضف بندًا واحدًا على الأقل بمبلغه', true);
    if (!clTotal({ items: items })) return toast('اكتب المبلغ', true);
    var row = { claim_date: o.claim_date || todayISO(), payee: o.payee.trim(), payee_id: o.payee_id.trim(), kind: o.kind, description: o.description.trim(), items: items, payer: o.payer.trim(), status: o.status, notes: o.notes, updated_at: new Date().toISOString() };
    var r = o.id ? await sb.from('payment_claims').update(row).eq('id', o.id).select().single()
      : await sb.from('payment_claims').insert(Object.assign(row, { created_by: (S.profile && S.profile.full_name) || displayName(S.email) })).select().single();
    if (r.error) return fail(r.error);
    c.list = [r.data].concat(c.list.filter(function (x) { return x.id !== r.data.id; }));
    c.edit = null;
    render();
    toast('حُفظت المطالبة رقم ' + r.data.no);
    if (andPrint) { pendingCl = r.data; printNow(); }
  }
  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/claims' || !canView()) return;
    var el, c = clState(), o = c.edit;
    if (e.target.closest('[data-clprintblank]')) { pendingCl = 'blank'; printNow(); return; }
    if (e.target.closest('[data-clprintsel]')) { var ps = c.list.filter(function (x) { return c.sel && c.sel[x.id]; }); if (ps.length) { pendingCl = ps; printNow(); } return; }
    if ((el = e.target.closest('[data-clprint]'))) { var p = clPick(el.getAttribute('data-clprint')); if (p) { pendingCl = p; printNow(); } return; }
    if (!isAdmin()) return;
    if (e.target.closest('[data-clnew]')) { c.edit = clNew(); scrollTo(0, 0); return render(); }
    if ((el = e.target.closest('[data-clopen]'))) { var x = clPick(el.getAttribute('data-clopen')); if (x) { c.edit = JSON.parse(JSON.stringify(x)); if (!c.edit.items.length) c.edit.items.push({ item: '', qty: '', amount: '' }); scrollTo(0, 0); render(); } return; }
    if ((el = e.target.closest('[data-cldel]'))) {
      var z = clPick(el.getAttribute('data-cldel'));
      if (!z || !confirm('حذف المطالبة رقم ' + z.no + '؟')) return;
      var d = await sb.from('payment_claims').delete().eq('id', z.id);
      if (d.error) return fail(d.error);
      c.list = c.list.filter(function (q) { return q.id !== z.id; });
      return render();
    }
    if (!o) return;
    if (e.target.closest('[data-cladd]')) { o.items.push({ item: '', qty: '', amount: '' }); render(); var ins = document.querySelectorAll('[data-ci$="|item"]'); if (ins.length) ins[ins.length - 1].focus(); return; }
    if ((el = e.target.closest('[data-cldelit]'))) { o.items.splice(Number(el.getAttribute('data-cldelit')), 1); if (!o.items.length) o.items.push({ item: '', qty: '', amount: '' }); return render(); }
    if (e.target.closest('[data-clcancel]')) { c.edit = null; return render(); }
    if (e.target.closest('[data-clsave]')) return clSave(false);
    if (e.target.closest('[data-clsaveprint]')) return clSave(true);
  });
  function clInput(e) {
    if (location.hash !== '#/claims') return;
    if (e.target.matches && e.target.matches('[data-clsel]')) { var cs = clState(); cs.sel = cs.sel || {}; cs.sel[e.target.getAttribute('data-clsel')] = e.target.checked; return render(); }
    var c = clState(), o = c.edit, el = e.target, a;
    if (el.id === 'cl-q') { var pos = el.selectionStart; c.q = el.value; render(); var q = document.getElementById('cl-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} } return; }
    if (!o) return;
    if ((a = el.getAttribute('data-cf'))) { o[a] = el.value; if (a === 'kind' && e.type === 'change') render(); }
    else if ((a = el.getAttribute('data-ci'))) { var p = a.split('|'); o.items[Number(p[0])][p[1]] = el.value; var t = document.getElementById('cl-total'); if (t) t.textContent = clMoney(clTotal(o)); }
  }
  document.addEventListener('input', clInput);
  document.addEventListener('change', clInput);

  var pendingOr = null;
  // خطاب الطلبية: الترويسة، التاريخ، المرسَل إليه، الموضوع، المقدمة، جدول الأصناف، الخاتمة، ثم توقيع المدير
  function buildOrderSheet(o) {
    var items = (o.items || []).filter(function (i) { return String(i.item || '').trim(); });
    var d = String(o.order_date || '').split('-'), months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    var date = d.length === 3 ? Number(d[2]) + ' ' + months[Number(d[1]) - 1] + ' ' + d[0] : '';
    sheet.className = 'ps';
    sheet.removeAttribute('data-fit');
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' + letterhead() +
      '<div style="display:flex;justify-content:space-between;margin:.8em 0 1em"><span><b>التاريخ:</b> ' + esc(date) + '</span><span><b>رقم الطلبية:</b> ' + esc(o.no || '') + '</span></div>' +
      '<p style="margin:0;font-size:1.12em"><b>' + esc(o.recipient) + '</b></p>' +
      '<p style="margin:0 0 .9em;font-size:1.12em;display:flex;justify-content:space-between"><b>' + esc(o.recipient2 || '') + '</b><b>المحترمين</b></p>' +
      '<p style="margin:0 0 .7em">السلام عليكم ورحمة الله وبركاته، وبعد،</p>' +
      '<p style="margin:0 0 .8em;text-align:center;font-size:1.12em"><b><u>الموضوع: ' + esc(o.subject) + '</u></b></p>' +
      '<p style="margin:0 0 .8em;line-height:1.9;white-space:pre-wrap">' + esc(o.intro) + '</p>' +
      '<table class="rz" style="margin:.4em 0 .9em"><thead><tr><th style="width:3em">م</th><th>الصنف</th><th style="width:7em">الوحدة</th><th style="width:7em">الكمية</th></tr></thead><tbody>' +
        items.map(function (it, i) { return '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(it.item) + '</td><td class="c">' + esc(it.unit || '-') + '</td><td class="c">' + esc(it.qty) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<p style="margin:0 0 .4em;line-height:1.9;white-space:pre-wrap">' + esc(o.closing) + '</p>' +
      '<p style="margin:0 0 .4em;text-align:center">وتفضلوا بقبول فائق الاحترام والتقدير،،،</p>' +
      reportSigns([['مدير ' + schoolName(), principalName()]]).replace('<div class="rs">', '<div class="rs or-signs">');
    fitSheet();
  }
  function orPick(id) { return orState().list.filter(function (x) { return x.id === id; })[0]; }
  async function orSave(andPrint) {
    var c = orState(), o = c.edit;
    if (!o.recipient.trim() || o.recipient.trim() === 'السادة /') return toast('اكتب المرسَل إليه', true);
    var items = o.items.map(function (i) { return { item: String(i.item || '').trim(), unit: String(i.unit || '').trim(), qty: String(i.qty || '').trim() }; }).filter(function (i) { return i.item; });
    if (!items.length) return toast('أضف صنفًا واحدًا على الأقل', true);
    var row = { order_date: o.order_date || todayISO(), recipient: o.recipient.trim(), recipient2: o.recipient2.trim(), subject: o.subject.trim(), intro: o.intro, items: items, closing: o.closing, status: o.status, notes: o.notes, updated_at: new Date().toISOString() };
    var r = o.id ? await sb.from('orders').update(row).eq('id', o.id).select().single()
      : await sb.from('orders').insert(Object.assign(row, { created_by: (S.profile && S.profile.full_name) || displayName(S.email) })).select().single();
    if (r.error) return fail(r.error);
    c.list = [r.data].concat(c.list.filter(function (x) { return x.id !== r.data.id; }));
    c.edit = null;
    render();
    toast('حُفظت الطلبية رقم ' + r.data.no);
    if (andPrint) { pendingOr = r.data; printNow(); }
  }
  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/orders' || !canView()) return;
    var el, c = orState(), o = c.edit;
    if ((el = e.target.closest('[data-orprint]'))) { var p = orPick(el.getAttribute('data-orprint')); if (p) { pendingOr = p; printNow(); } return; }
    if (!isAdmin()) return;
    if (e.target.closest('[data-ornew]')) { c.edit = orNew(); scrollTo(0, 0); return render(); }
    if ((el = e.target.closest('[data-oropen]'))) { var x = orPick(el.getAttribute('data-oropen')); if (x) { c.edit = JSON.parse(JSON.stringify(x)); if (!c.edit.items.length) c.edit.items.push({ item: '', unit: 'عدد', qty: '' }); scrollTo(0, 0); render(); } return; }
    if ((el = e.target.closest('[data-orcopy]'))) { var y = orPick(el.getAttribute('data-orcopy')); if (y) { c.edit = Object.assign(orNew(y), { recipient: y.recipient, recipient2: y.recipient2, subject: y.subject }); scrollTo(0, 0); render(); toast('طلبية جديدة بنفس الأصناف — عدّلها ثم احفظ'); } return; }
    if ((el = e.target.closest('[data-ordel]'))) {
      var z = orPick(el.getAttribute('data-ordel'));
      if (!z || !confirm('حذف الطلبية رقم ' + z.no + '؟')) return;
      var d = await sb.from('orders').delete().eq('id', z.id);
      if (d.error) return fail(d.error);
      c.list = c.list.filter(function (q) { return q.id !== z.id; });
      return render();
    }
    if (!o) return;
    if (e.target.closest('[data-oradd]')) { o.items.push({ item: '', unit: 'عدد', qty: '' }); render(); var ins = document.querySelectorAll('[data-oi$="|item"]'); if (ins.length) ins[ins.length - 1].focus(); return; }
    if ((el = e.target.closest('[data-ordelit]'))) { o.items.splice(Number(el.getAttribute('data-ordelit')), 1); if (!o.items.length) o.items.push({ item: '', unit: 'عدد', qty: '' }); return render(); }
    if ((el = e.target.closest('[data-orup]'))) { var k = Number(el.getAttribute('data-orup')); var t = o.items[k]; o.items[k] = o.items[k - 1]; o.items[k - 1] = t; return render(); }
    if (e.target.closest('[data-orcancel]')) { c.edit = null; return render(); }
    if (e.target.closest('[data-orsave]')) return orSave(false);
    if (e.target.closest('[data-orsaveprint]')) return orSave(true);
  });
  function orInput(e) {
    if (location.hash !== '#/orders') return;
    var c = orState(), o = c.edit, el = e.target, a;
    if (el.id === 'or-q') { var pos = el.selectionStart; c.q = el.value; render(); var q = document.getElementById('or-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} } return; }
    if (!o) return;
    if ((a = el.getAttribute('data-of'))) o[a] = el.value;
    else if ((a = el.getAttribute('data-oi'))) { var p = a.split('|'); o.items[Number(p[0])][p[1]] = el.value; }
  }
  document.addEventListener('input', orInput);
  document.addEventListener('change', orInput);

  var pendingCu = false;
  // كشف العهد المطبوع: الأصناف المعروضة (بحسب البحث) بأعدادها وملاحظاتها
  function buildCustodySheet() {
    var c = cuState(), q = norm(c.q), n = 4;
    var list = c.list.filter(function (x) { return !q || norm(x.item + ' ' + x.notes).indexOf(q) > -1; });
    var head = reportHead('كشف العهد', [['عدد الأصناف', list.length]].concat(c.q.trim() ? [['بحث', c.q.trim()]] : [])).replace(/^<img class="wm"[^>]*>/, '');
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
      '<table class="rz"><thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>' +
      '<tr><th>م</th><th>الصنف</th><th>العدد</th><th>ملاحظات</th></tr></thead><tbody>' +
      list.map(function (x, i) { return '<tr><td class="c">' + (i + 1) + '</td><td><b>' + esc(x.item) + '</b></td><td class="c">' + esc(x.qty) + '</td><td>' + esc(x.notes) + '</td></tr>'; }).join('') +
      '<tr class="total"><td colspan="2">عدد الأصناف</td><td class="c"><b>' + list.length + '</b></td><td></td></tr></tbody>' +
      '<tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>' + reportSigns([['أمين العهد', ''], ['مدير/ة الأكاديمية', principalName()]]);
  }

  document.addEventListener('click', function (e) {
    if (location.hash !== '#/custody' || !e.target.closest('[data-cuprint]')) return;
    pendingCu = true;
    printNow();
  });

  document.addEventListener('submit', async function (e) {
    if (e.target.id !== 'cu-form' || !isAdmin()) return;
    e.preventDefault();
    var item = document.getElementById('cu-item').value.trim(), qty = parseInt(document.getElementById('cu-qty').value, 10), notes = document.getElementById('cu-notes').value.trim();
    if (!item || !(qty >= 0)) return toast('اكتب الصنف وعددًا صحيحًا', true);
    var r = await sb.from('custody_items').insert({ item: item, qty: qty, notes: notes, created_by: (S.profile && S.profile.full_name) || displayName(S.email) }).select().single();
    if (r.error) return fail(r.error);
    cuState().list.push(r.data);
    render();
    toast('أُضيف «' + item + '»');
    var f = document.getElementById('cu-item');
    if (f) f.focus();
  });

  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/custody' || !isAdmin()) return;
    var el, c = cuState();
    if ((el = e.target.closest('[data-cuedit]'))) { c.edit = el.getAttribute('data-cuedit'); return render(); }
    if ((el = e.target.closest('[data-cusave]'))) {
      var id = el.getAttribute('data-cusave'), item = document.getElementById('cu-e-item').value.trim(), qty = parseInt(document.getElementById('cu-e-qty').value, 10);
      if (!item || !(qty >= 0)) return toast('اكتب الصنف وعددًا صحيحًا', true);
      var patch = { item: item, qty: qty, notes: document.getElementById('cu-e-notes').value.trim(), updated_at: new Date().toISOString() };
      var r = await sb.from('custody_items').update(patch).eq('id', id);
      if (r.error) return fail(r.error);
      c.list.forEach(function (x) { if (x.id === id) Object.assign(x, patch); });
      c.edit = '';
      return render();
    }
    if ((el = e.target.closest('[data-cudel]'))) {
      var did = el.getAttribute('data-cudel'), it = c.list.filter(function (x) { return x.id === did; })[0];
      if (!it || !confirm('حذف «' + it.item + '» من العهد؟')) return;
      var d = await sb.from('custody_items').delete().eq('id', did);
      if (d.error) return fail(d.error);
      c.list = c.list.filter(function (x) { return x.id !== did; });
      render();
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id !== 'cu-q' || location.hash !== '#/custody') return;
    var c = cuState(), pos = e.target.selectionStart;
    c.q = e.target.value;
    render();
    var q = document.getElementById('cu-q');
    if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} }
  });

  /* ---------- سجل المخالفات (سجل الضبط) ----------
     كل مخالفة أو إنذار: الطالب، والتاريخ، والمخالفة، والإجراء. يُطبع بنموذج «سجل الضبط للطلبة»: صف لكل طالب،
     وله حتى ثلاث مخالفات في الصف (تاريخ، مخالفة، إجراء)، وما زاد يُكمل في صف تالٍ، وتوقيع المدير. الإنذار المطبوع من شاشة الطالب يُسجَّل هنا.
     يسجّل المدير العام والمسجِّل، ويراه المدير والمشرف (supabase/discipline.sql) */

  var DC_KINDS = { violation: 'مخالفة', warning: 'إنذار' };
  function canDisc() { return canAttView(); }
  function canEditDisc() { return isAdmin() || isRegistrar(); }
  function dcState() { return S.dc || (S.dc = { list: [], missing: false, loaded: false, loading: false, cls: '', q: '', kind: '', year: '' }); }

  async function loadDiscipline() {
    var c = dcState();
    if (c.loading) return;
    c.loading = true;
    var rows = await fetchAll(function () { return sb.from('discipline_records').select('*').order('day', { ascending: false }).order('created_at', { ascending: false }).order('id'); });
    c.loading = false; c.loaded = true; c.missing = !rows; c.list = rows || [];
    render();
  }

  // السنة الدراسية: من أول أغسطس إلى آخر يوليو؛ تُعرف ببدايتها
  function dcYearOf(day) { var y = Number(String(day).slice(0, 4)), m = Number(String(day).slice(5, 7)); return m >= 8 ? y : y - 1; }
  function dcYearStart() { return Number(afYearStart().slice(0, 4)); }

  function dcFiltered() {
    var c = dcState(), q = norm(c.q), yr = c.year === '' ? dcYearStart() : Number(c.year);
    return c.list.filter(function (r) {
      var x = findStudent(r.student_id);
      if (!x) return false;
      if (dcYearOf(r.day) !== yr) return false;
      if (c.cls && x.class_name !== c.cls) return false;
      if (c.kind && r.kind !== c.kind) return false;
      return !q || norm(x.full_name + ' ' + r.violation + ' ' + r.action).indexOf(q) > -1;
    });
  }

  function renderDiscipline() {
    var c = dcState();
    if (!c.loaded) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; loadDiscipline(); return; }
    if (c.missing) {
      app.innerHTML = '<div class="card empty">سجل المخالفات يحتاج جدولًا جديدًا.<br>' + (isAdmin() ? 'شغّل الملف <code dir="ltr">supabase/discipline.sql</code> في محرر SQL، ثم حدّث الصفحة.' : 'يشغّل المدير العام الملف <code dir="ltr">supabase/discipline.sql</code>.') + '</div>';
      return;
    }
    var edit = canEditDisc(), list = dcFiltered(), f = c.form || (c.form = { day: todayISO(), kind: 'violation', student: '', violation: '', action: '' });
    var students = S.students.filter(enrolled).sort(function (a, b) { return classRank(a.class_name) - classRank(b.class_name) || a.full_name.localeCompare(b.full_name, 'ar'); });
    var years = {};
    c.list.forEach(function (r) { years[dcYearOf(r.day)] = 1; });
    years[dcYearStart()] = 1;
    var yr = c.year === '' ? dcYearStart() : Number(c.year);
    var rows = list.map(function (r, i) {
      var x = findStudent(r.student_id);
      return '<tr><td>' + (i + 1) + '</td><td>' + dmy(r.day) + '</td><td><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '</td><td>' + esc(x.class_name || '') + '</td>' +
        '<td><span class="badge ' + (r.kind === 'warning' ? 'unpaid' : 'part') + '">' + DC_KINDS[r.kind] + '</span></td><td style="white-space:pre-wrap">' + esc(r.violation) + '</td><td>' + esc(r.action) + '</td>' +
        (edit ? '<td><button type="button" class="btn danger" data-dcdel="' + r.id + '">حذف</button></td>' : '') + '</tr>';
    }).join('');
    app.innerHTML = '<h1 class="page-title" style="margin:0 0 12px">سجل المخالفات</h1>' +
      (edit ? '<form class="card" id="dc-form"><h2>تسجيل مخالفة</h2><div class="grid2" style="margin-top:10px">' +
        '<div><label class="field" for="dc-student">الطالب <span class="req">*</span></label><input type="text" id="dc-student" required list="dc-students" autocomplete="off" placeholder="اكتب الاسم واختره من القائمة" value="' + esc(f.student) + '"><datalist id="dc-students">' +
          students.map(function (x) { return '<option value="' + esc(x.full_name + ' — ' + (x.class_name || '')) + '">'; }).join('') + '</datalist></div>' +
        '<div><label class="field" for="dc-day">التاريخ</label><input type="date" id="dc-day" required value="' + esc(f.day) + '"></div>' +
        '<div><label class="field" for="dc-kind">النوع</label><select id="dc-kind">' + Object.keys(DC_KINDS).map(function (k) { return '<option value="' + k + '"' + (f.kind === k ? ' selected' : '') + '>' + DC_KINDS[k] + '</option>'; }).join('') + '</select></div>' +
        '<div><label class="field" for="dc-action">الإجراء</label><input type="text" id="dc-action" list="afw-actions" autocomplete="off" placeholder="مثال: إحضار ولي الأمر" value="' + esc(f.action) + '"><datalist id="afw-actions">' + AF_ACTIONS.map(function (a) { return '<option value="' + esc(a) + '">'; }).join('') + '</datalist></div>' +
        '<div style="grid-column:1/-1"><label class="field" for="dc-violation">المخالفة <span class="req">*</span></label><textarea id="dc-violation" required rows="3">' + esc(f.violation) + '</textarea></div></div>' +
        '<div class="actions"><button type="submit" class="btn primary">تسجيل</button></div></form>' : '') +
      '<div class="card"><div class="toolbar" style="align-items:center;margin:0 0 8px">' +
        '<input type="search" id="dc-q" placeholder="ابحث باسم الطالب أو المخالفة" aria-label="بحث" style="flex:1;min-width:200px" value="' + esc(c.q) + '">' +
        '<select id="dc-cls" aria-label="الشعبة" style="width:auto"><option value="">كل الشعب</option>' + attClasses().map(function (n) { return '<option' + (n === c.cls ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>' +
        '<select id="dc-fkind" aria-label="النوع" style="width:auto"><option value="">مخالفات وإنذارات</option>' + Object.keys(DC_KINDS).map(function (k) { return '<option value="' + k + '"' + (c.kind === k ? ' selected' : '') + '>' + DC_KINDS[k] + '</option>'; }).join('') + '</select>' +
        '<select id="dc-year" aria-label="العام الدراسي" style="width:auto">' + Object.keys(years).sort().reverse().map(function (y) { return '<option value="' + y + '"' + (Number(y) === yr ? ' selected' : '') + '>العام ' + y + '/' + (Number(y) + 1) + '</option>'; }).join('') + '</select>' +
        '<button type="button" class="btn" data-dcprint data-ro-ok' + (list.length ? '' : ' disabled') + '>طباعة سجل الضبط / PDF</button></div>' +
      (rows ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>التاريخ</th><th>الطالب</th><th>الشعبة</th><th>النوع</th><th>المخالفة</th><th>الإجراء</th>' + (edit ? '<th></th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">لا توجد مخالفات مسجَّلة بهذه الشروط.</div>') + '</div>';
  }

  var pendingDc = false;
  // نموذج «سجل الضبط للطلبة»: أفقي، صف لكل طالب بثلاث مخالفات (تاريخ، مخالفة، إجراء)، وما زاد في صف تالٍ
  function buildDisciplineSheet() {
    var c = dcState(), list = dcFiltered().slice().sort(function (a, b) { return a.day.localeCompare(b.day) || String(a.created_at).localeCompare(String(b.created_at)); }), by = {}, order = [];
    list.forEach(function (r) { if (!by[r.student_id]) { by[r.student_id] = []; order.push(r.student_id); } by[r.student_id].push(r); });
    order.sort(function (a, b) { var x = findStudent(a), y = findStudent(b); return classRank(x.class_name) - classRank(y.class_name) || x.full_name.localeCompare(y.full_name, 'ar'); });
    var yr = c.year === '' ? dcYearStart() : Number(c.year), n = 12, rows = '', k = 0;
    order.forEach(function (sid) {
      var x = findStudent(sid), recs = by[sid];
      for (var i = 0; i < recs.length; i += 3) {
        k++;
        var cells = '';
        for (var j = 0; j < 3; j++) {
          var r = recs[i + j];
          cells += r ? '<td class="c" style="white-space:nowrap">' + dmy(r.day) + '</td><td style="font-size:.92em">' + (r.kind === 'warning' ? '<b>[إنذار]</b> ' : '') + esc(r.violation) + '</td><td style="font-size:.92em">' + esc(r.action) + '</td>' : '<td></td><td></td><td></td>';
        }
        rows += '<tr><td class="c">' + k + '</td><td style="white-space:nowrap"><b>' + esc(x.full_name) + '</b>' + (i ? ' <small>(تابع)</small>' : '') + '</td><td class="c" style="white-space:nowrap">' + esc(x.class_name || '') + '</td>' + cells + '</tr>';
      }
    });
    var head = reportHead('سجل الضبط للطلبة للعام الدراسي ' + yr + '/' + (yr + 1), [['عدد الطلاب', order.length], ['عدد المخالفات', list.length]].concat(c.cls ? [['الشعبة', c.cls]] : [], c.kind ? [['النوع', DC_KINDS[c.kind]]] : [])).replace(/^<img class="wm"[^>]*>/, '');
    printLandscape = true;
    sheet.style.width = '267mm';
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    var th = '';
    for (var t = 1; t <= 3; t++) th += '<th>تاريخ المخالفة ' + t + '</th><th>المخالفة</th><th>الإجراء</th>';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
      '<table class="rz"><colgroup><col style="width:3%"><col style="width:13%"><col style="width:6%">' + [1, 2, 3].map(function () { return '<col style="width:7.5%"><col style="width:10.5%"><col style="width:8%">'; }).join('') + '</colgroup>' +
      '<thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>' +
      '<tr><th>م</th><th>اسم الطالب</th><th>الصف</th>' + th + '</tr></thead><tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>' + reportSigns([['توقيع المدير', principalName()]]);
  }

  document.addEventListener('submit', async function (e) {
    if (e.target.id !== 'dc-form' || !canEditDisc()) return;
    e.preventDefault();
    var c = dcState(), f = c.form, label = document.getElementById('dc-student').value.trim();
    var x = S.students.filter(function (s) { return enrolled(s) && (s.full_name + ' — ' + (s.class_name || '')) === label; })[0];
    if (!x) return toast('اختر الطالب من القائمة المقترحة', true);
    var rec = { student_id: x.id, day: f.day, kind: f.kind, violation: f.violation.trim(), action: f.action.trim(), created_by: (S.profile && S.profile.full_name) || displayName(S.email) };
    if (!rec.violation) return toast('اكتب المخالفة', true);
    var r = await sb.from('discipline_records').insert(rec).select().single();
    if (r.error) return fail(r.error);
    c.list.unshift(r.data);
    c.form = { day: f.day, kind: f.kind, student: '', violation: '', action: '' };
    render();
    toast('سُجّلت على «' + x.full_name + '»');
  });

  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/discipline' || !canDisc()) return;
    var el, c = dcState();
    if (e.target.closest('[data-dcprint]')) { pendingDc = true; return printNow(); }
    if ((el = e.target.closest('[data-dcdel]')) && canEditDisc()) {
      var id = el.getAttribute('data-dcdel'), r = c.list.filter(function (x) { return x.id === id; })[0];
      if (!r || !confirm('حذف هذا السجل من سجل المخالفات؟')) return;
      var d = await sb.from('discipline_records').delete().eq('id', id);
      if (d.error) return fail(d.error);
      c.list = c.list.filter(function (x) { return x.id !== id; });
      render();
    }
  });

  document.addEventListener('input', function (e) {
    if (location.hash !== '#/discipline') return;
    var c = dcState(), id = e.target.id, fk = { 'dc-student': 'student', 'dc-day': 'day', 'dc-violation': 'violation', 'dc-action': 'action' }[id];
    if (fk && c.form) { c.form[fk] = e.target.value; return; }
    if (id === 'dc-q') {
      var pos = e.target.selectionStart;
      c.q = e.target.value;
      render();
      var q = document.getElementById('dc-q');
      if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} }
    }
  });

  document.addEventListener('change', function (e) {
    if (location.hash !== '#/discipline') return;
    var c = dcState(), id = e.target.id;
    if (id === 'dc-kind' && c.form) c.form.kind = e.target.value;
    else if (id === 'dc-cls') { c.cls = e.target.value; render(); }
    else if (id === 'dc-fkind') { c.kind = e.target.value; render(); }
    else if (id === 'dc-year') { c.year = e.target.value; render(); }
  });

  /* ---------- إذن خروج الطلاب ----------
     يُسجَّل يوميًا خروج طالب أو أكثر أثناء الدوام: اليوم وساعة الخروج وسبب الخروج، ويُطبع تقرير يومي وتقرير شهري.
     يسجّل المدير العام والمسجِّل، ويراه المدير والمشرف (supabase/student_exits.sql) */

  var EX_REASONS = ['موعد طبي', 'ظرف عائلي', 'حضور ولي الأمر لاستلامه', 'مرض', 'استدعاء من ولي الأمر'];
  function exState() { return S.ex || (S.ex = { list: [], missing: false, loaded: false, loading: false, day: todayISO(), month: todayISO().slice(0, 7), time: '', reason: '', q: '', cls: '', sel: {} }); }
  var pendingEx = null;

  async function loadExits() {
    var c = exState();
    if (c.loading) return;
    c.loading = true;
    var rows = await fetchAll(function () { return sb.from('student_exits').select('*').order('day', { ascending: false }).order('exit_time').order('id'); });
    c.loading = false; c.loaded = true; c.missing = !rows; c.list = rows || [];
    render();
  }

  function exNow() { var d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function exHm(t) { return String(t || '').slice(0, 5); }
  function exSorted(list) { return list.slice().sort(function (a, b) { return a.day.localeCompare(b.day) || exHm(a.exit_time).localeCompare(exHm(b.exit_time)); }); }

  function exCands() {
    var c = exState(), q = norm(c.q), LIMIT = 40;
    var list = S.students.filter(function (x) {
      if (!enrolled(x)) return false;
      if (c.cls && x.class_name !== c.cls) return false;
      return !q || norm(x.full_name).indexOf(q) > -1 || String(x.national_id || '').indexOf(latinDigits(c.q)) > -1;
    }).sort(function (a, b) { return classRank(a.class_name) - classRank(b.class_name) || a.full_name.localeCompare(b.full_name, 'ar'); });
    return list.slice(0, LIMIT).map(function (x) {
      return '<label class="cand" style="cursor:pointer"><span><input type="checkbox" data-exsel="' + x.id + '"' + (c.sel[x.id] ? ' checked' : '') + '> <b>' + esc(x.full_name) + '</b>' + rsvMark(x) + ' <span class="meta">— ' + esc(x.class_name || 'بدون شعبة') + '</span></span></label>';
    }).join('') + (list.length > LIMIT ? '<p class="st-count" style="margin-top:8px">يُعرض أول ' + LIMIT + ' من ' + list.length + '؛ اكتب في البحث أو اختر شعبة.</p>' : '') ||
      '<div class="empty">لا يوجد طلاب مطابقون.</div>';
  }
  function exSelBtn() {
    var n = Object.keys(exState().sel).filter(function (k) { return exState().sel[k]; }).length;
    return '<button type="submit" class="btn primary"' + (n ? '' : ' disabled') + '>تسجيل الخروج' + (n ? ' (' + n + ')' : '') + '</button>';
  }

  function renderExits() {
    var c = exState();
    if (!c.loaded) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; loadExits(); return; }
    if (c.missing) {
      app.innerHTML = '<div class="card empty">إذن الخروج يحتاج جدولًا جديدًا.<br>' + (isAdmin() ? 'شغّل الملف <code dir="ltr">supabase/student_exits.sql</code> في محرر SQL، ثم حدّث الصفحة.' : 'يشغّل المدير العام الملف <code dir="ltr">supabase/student_exits.sql</code>.') + '</div>';
      return;
    }
    var edit = canEditDisc();
    if (!c.time) c.time = exNow();
    var dayList = exSorted(c.list.filter(function (r) { return r.day === c.day; })), monthN = c.list.filter(function (r) { return r.day.slice(0, 7) === c.month; }).length;
    var rows = dayList.map(function (r, i) {
      var x = findStudent(r.student_id);
      return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(x ? x.full_name : '(طالب محذوف)') + '</b></td><td>' + esc(x ? x.class_name || '' : '') + '</td><td>' + esc(exHm(r.exit_time)) + '</td><td>' + esc(r.reason) + '</td>' +
        (edit ? '<td><button type="button" class="btn danger" data-exdel="' + r.id + '">حذف</button></td>' : '') + '</tr>';
    }).join('');
    var exTab = edit ? vtab('ex', 'new') : 'log';
    app.innerHTML = '<h1 class="page-title" style="margin:0 0 12px">إذن خروج الطلاب</h1>' +
      (edit ? vtabsHtml('ex', 'new', [['new', 'تسجيل خروج'], ['log', 'السجل والتقارير', dayList.length || '']]) : '') +
      (edit && exTab === 'new' ? '<form class="card" id="ex-form"><h2>تسجيل خروج</h2><div class="toolbar" style="align-items:flex-end;margin:10px 0 0">' +
        '<div><label class="field" for="ex-day">اليوم</label><input type="date" id="ex-day-new" value="' + esc(c.day) + '"></div>' +
        '<div><label class="field" for="ex-time">ساعة الخروج</label><input type="time" id="ex-time" required value="' + esc(c.time) + '"></div>' +
        '<div style="flex:1;min-width:220px"><label class="field" for="ex-reason">سبب الخروج <span class="req">*</span></label><input type="text" id="ex-reason" required list="ex-reasons" autocomplete="off" value="' + esc(c.reason) + '"><datalist id="ex-reasons">' +
          EX_REASONS.map(function (r) { return '<option value="' + esc(r) + '">'; }).join('') + '</datalist></div></div>' +
        '<h3 style="margin:14px 0 6px">اختر الطالب أو الطلاب</h3><div class="toolbar" style="align-items:center;margin:0 0 8px"><input type="search" id="ex-q" placeholder="ابحث بالاسم أو رقم الهوية" aria-label="بحث" style="flex:1;min-width:200px" value="' + esc(c.q) + '">' +
        '<select id="ex-cls" aria-label="الشعبة" style="width:auto"><option value="">كل الشعب</option>' + attClasses().map(function (n) { return '<option' + (n === c.cls ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></div>' +
        '<div id="ex-cands" style="max-height:280px;overflow:auto">' + exCands() + '</div><div class="actions" id="ex-submit">' + exSelBtn() + '</div></form>' : '') +
      (exTab !== 'log' ? '' : '<div class="card"><div class="toolbar" style="align-items:center;margin:0 0 8px"><h2 style="margin:0;flex:1">خروج يوم ' + esc(dayName(c.day)) + ' ' + dmy(c.day) + ' (' + dayList.length + ')</h2>' +
        '<input type="date" id="ex-day" aria-label="اليوم المعروض" data-ro-ok value="' + esc(c.day) + '">' +
        '<button type="button" class="btn" data-exprint="day" data-ro-ok' + (dayList.length ? '' : ' disabled') + '>طباعة التقرير اليومي</button></div>' +
        (rows ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الطالب</th><th>الشعبة</th><th>ساعة الخروج</th><th>السبب</th>' + (edit ? '<th></th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
          : '<div class="empty">لم يخرج أحد في هذا اليوم.</div>') + '</div>' +
      '<div class="card"><div class="toolbar" style="align-items:center;margin:0"><h2 style="margin:0;flex:1">التقرير الشهري</h2>' +
        '<input type="month" id="ex-month" aria-label="الشهر" data-ro-ok value="' + esc(c.month) + '"><span class="hint" style="margin:0">' + monthN + ' إذن خروج</span>' +
        '<button type="button" class="btn" data-exprint="month" data-ro-ok' + (monthN ? '' : ' disabled') + '>طباعة التقرير الشهري</button></div></div>');
  }

  function buildExitSheet(q) {
    var c = exState(), x, rows, head, n;
    var info = function (r) { return findStudent(r.student_id) || { full_name: '(طالب محذوف)', class_name: '' }; };
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    if (q === 'day') {
      rows = exSorted(c.list.filter(function (r) { return r.day === c.day; }));
      n = 5;
      head = reportHead('تقرير إذن خروج الطلاب اليومي', [['اليوم', dayName(c.day)], ['التاريخ', dmy(c.day)], ['عدد الخارجين', rows.length]]).replace(/^<img class="wm"[^>]*>/, '');
      sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
        '<table class="rz"><thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>' +
        '<tr><th>م</th><th>الطالب</th><th>الشعبة</th><th>ساعة الخروج</th><th>السبب</th></tr></thead><tbody>' +
        rows.map(function (r, i) { x = info(r); return '<tr><td class="c">' + (i + 1) + '</td><td style="white-space:nowrap"><b>' + esc(x.full_name) + '</b></td><td class="c">' + esc(x.class_name || '') + '</td><td class="c">' + esc(exHm(r.exit_time)) + '</td><td>' + esc(r.reason) + '</td></tr>'; }).join('') +
        '</tbody><tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>' + reportSigns([['مسؤول شؤون الطلاب', ''], ['مدير/ة الأكاديمية', principalName()]]);
      return;
    }
    rows = exSorted(c.list.filter(function (r) { return r.day.slice(0, 7) === c.month; }));
    n = 6;
    var per = {}, order = [];
    rows.forEach(function (r) { if (!per[r.student_id]) { per[r.student_id] = 0; order.push(r.student_id); } per[r.student_id]++; });
    order.sort(function (a, b) { return per[b] - per[a] || info({ student_id: a }).full_name.localeCompare(info({ student_id: b }).full_name, 'ar'); });
    head = reportHead('تقرير إذن خروج الطلاب الشهري', [['الشهر', monthLabel(c.month)], ['عدد أذونات الخروج', rows.length], ['عدد الطلاب', order.length]]).replace(/^<img class="wm"[^>]*>/, '');
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
      '<table class="rz"><thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>' +
      '<tr><th>م</th><th>التاريخ</th><th>الطالب</th><th>الشعبة</th><th>ساعة الخروج</th><th>السبب</th></tr></thead><tbody>' +
      rows.map(function (r, i) { x = info(r); return '<tr><td class="c">' + (i + 1) + '</td><td class="c" style="white-space:nowrap">' + dmy(r.day) + '</td><td style="white-space:nowrap"><b>' + esc(x.full_name) + '</b></td><td class="c">' + esc(x.class_name || '') + '</td><td class="c">' + esc(exHm(r.exit_time)) + '</td><td>' + esc(r.reason) + '</td></tr>'; }).join('') +
      '<tr><td class="bf-sec" style="background:var(--navy);color:#fff" colspan="' + n + '">ملخص الطلاب (عدد مرات الخروج)</td></tr>' +
      order.map(function (sid, i) { x = info({ student_id: sid }); return '<tr><td class="c">' + (i + 1) + '</td><td colspan="2" style="white-space:nowrap"><b>' + esc(x.full_name) + '</b></td><td class="c">' + esc(x.class_name || '') + '</td><td class="c"><b>' + per[sid] + (per[sid] === 1 ? ' مرة' : ' مرات') + '</b></td><td></td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>' + reportSigns([['مسؤول شؤون الطلاب', ''], ['مدير/ة الأكاديمية', principalName()]]);
  }

  document.addEventListener('submit', async function (e) {
    if (e.target.id !== 'ex-form' || !canEditDisc()) return;
    e.preventDefault();
    var c = exState(), ids = Object.keys(c.sel).filter(function (k) { return c.sel[k]; });
    if (!ids.length) return toast('اختر طالبًا واحدًا على الأقل', true);
    var day = document.getElementById('ex-day-new').value, time = document.getElementById('ex-time').value, reason = document.getElementById('ex-reason').value.trim();
    if (!day || !time || !reason) return toast('اكتب اليوم والساعة والسبب', true);
    var who = (S.profile && S.profile.full_name) || displayName(S.email);
    var r = await sb.from('student_exits').insert(ids.map(function (id) { return { student_id: id, day: day, exit_time: time, reason: reason, created_by: who }; })).select();
    if (r.error) return fail(r.error);
    c.list = (r.data || []).concat(c.list);
    c.sel = {}; c.day = day; c.month = day.slice(0, 7); c.reason = reason; c.time = exNow();
    render();
    toast('سُجّل خروج ' + ids.length + (ids.length === 1 ? ' طالب' : ' طلاب'));
  });

  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/exits' || !canAttView()) return;
    var el, c = exState();
    if ((el = e.target.closest('[data-exprint]'))) { pendingEx = el.getAttribute('data-exprint'); return printNow(); }
    if ((el = e.target.closest('[data-exdel]')) && canEditDisc()) {
      var id = el.getAttribute('data-exdel');
      if (!confirm('حذف إذن الخروج هذا؟')) return;
      var d = await sb.from('student_exits').delete().eq('id', id);
      if (d.error) return fail(d.error);
      c.list = c.list.filter(function (x) { return x.id !== id; });
      render();
    }
  });

  document.addEventListener('input', function (e) {
    if (location.hash !== '#/exits') return;
    var c = exState(), id = e.target.id;
    if (id === 'ex-time') c.time = e.target.value;
    else if (id === 'ex-reason') c.reason = e.target.value;
    else if (id === 'ex-q') { c.q = e.target.value; document.getElementById('ex-cands').innerHTML = exCands(); }
  });

  document.addEventListener('change', function (e) {
    if (location.hash !== '#/exits') return;
    var c = exState(), el = e.target, id = el.id;
    if (el.hasAttribute && el.hasAttribute('data-exsel')) { c.sel[el.getAttribute('data-exsel')] = el.checked; document.getElementById('ex-submit').innerHTML = exSelBtn(); }
    else if (id === 'ex-cls') { c.cls = el.value; document.getElementById('ex-cands').innerHTML = exCands(); }
    else if (id === 'ex-day' && el.value) { c.day = el.value; c.month = el.value.slice(0, 7); render(); }
    else if (id === 'ex-month' && el.value) { c.month = el.value; render(); }
    else if (id === 'ex-day-new') c.day = el.value || c.day;
  });

  /* ----- كتاب لفت نظر بسبب التأخير -----
     في «دوام الموظفين»: يُعرض المتأخرون في الشهر المختار بأيام تأخرهم ومجموعه، ويُختار أحدهم فيُكتب له كتاب لفت نظر يذكر أيام التأخير
     ومجموع ساعاته ورسالة بضرورة الالتزام، ويُطبع بتوقيع المدير وإقرار الموظف بالاستلام. يُحسب التأخير عن دوام مجموعة الموظف (saLate) */
  var LT_MSG = 'نؤكد على ضرورة الالتزام بمواعيد الدوام الرسمي حرصًا على انتظام العملية التعليمية وحسن سير العمل، ونأمل ألا يتكرر ذلك مستقبلًا، وإلا اضطررنا إلى اتخاذ الإجراءات اللازمة وفق نظام العمل المعتمد.';
  var pendingLt = null;
  // نص الكتاب بعد «تحية طيبة وبعد»؛ {الأيام} {الشهر} {الموعد} {المجموع} تُستبدل عند الطباعة
  var LT_REASON = 'نحيطكم علمًا بأنه قد تقرر توجيه لفت نظر إليكم بسبب التأخر عن موعد الحضور الرسمي ({الموعد}) مدة {الأيام} خلال شهر {الشهر}، بمجموع تأخير {المجموع}، وذلك لعدم الالتزام بسياسة الحضور والانصراف المعتمدة لدى الأكاديمية، ويُعد ذلك مخالفة تستوجب اتخاذ الإجراءات الإدارية وفقًا للسياسات واللوائح المعمول بها بالأكاديمية.';
  function ltUi() { return ui.lt || (ui.lt = { month: '', data: null, loading: false, sid: '', date: todayISO(), msg: LT_MSG, reason: LT_REASON, days: true }); }
  function ltHours(mins) {
    mins = Math.round(mins);
    var h = Math.floor(mins / 60), m = mins % 60;
    return (h ? h + (h === 1 ? ' ساعة' : ' ساعات') : '') + (h && m ? ' و' : '') + (m || !h ? m + ' دقيقة' : '');
  }
  // أيام تأخر الموظف في الشهر: [{ day, in, official, mins }]
  function ltLateDays(s) {
    var T = shiftOf(s.t);
    return Object.keys(s.days).sort().map(function (k) { var r = s.days[k], l = saLate(r, T); return l ? { day: k, in: r.time_in, official: T.time_in, mins: l } : null; }).filter(Boolean);
  }
  async function ltLoad(month) {
    var u = ltUi();
    u.loading = true; u.month = month; u.data = null;
    render();
    var D = await saMonthData(month);
    u.loading = false;
    u.data = D;
    if (!D) toast('تعذر جلب دوام الشهر', true);
    render();
  }
  function ltCardHtml() {
    var u = ltUi(), month = saState().month, D = u.data && u.month === month ? u.data : null;
    var head = '<div class="card"><h2>كتب لفت النظر (التأخير)</h2><div class="toolbar" style="align-items:center;margin:8px 0 0">' +
      '<span class="hint" style="margin:0">الشهر: <b>' + esc(monthLabel(month)) + '</b> (يُغيَّر من «الشهر» في الكشف الشهري أعلاه)</span>' +
      '<button type="button" class="btn primary" data-ltload data-ro-ok' + (u.loading ? ' disabled' : '') + '>' + (u.loading ? 'جارٍ الجلب…' : 'عرض المتأخرين') + '</button></div>';
    if (!D) return head + '<p class="hint" style="margin:8px 0 0">اضغط «عرض المتأخرين» لتظهر قائمة من تأخروا عن دوامهم في هذا الشهر.</p></div>';
    var late = D.staff.filter(function (s) { return s.lateDays > 0; }).sort(function (a, b) { return b.late - a.late; });
    var rows = late.map(function (s, i) {
      return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(s.t.name) + '</b><br><span class="meta" style="font-size:.85rem">' + esc(s.t.job_title || staffCat(s.t)) + '</span></td><td>' + s.lateDays + '</td><td><b>' + esc(ltHours(s.late)) + '</b> <span class="meta">(' + s.late + ' د)</span></td>' +
        '<td><button type="button" class="btn' + (u.sid === s.t.id ? ' primary' : '') + '" data-ltpick="' + s.t.id + '" data-ro-ok>كتاب لفت نظر</button></td></tr>';
    }).join('');
    var form = '';
    var cur = late.filter(function (s) { return s.t.id === u.sid; })[0];
    if (cur) {
      var days = ltLateDays(cur);
      form = '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)"><h3 style="margin:0 0 8px">كتاب لفت نظر: ' + esc(cur.t.name) + '</h3>' +
        '<p class="hint" style="margin:0 0 8px">أيام التأخر: <b>' + days.length + '</b> · مجموع التأخير: <b>' + esc(ltHours(cur.late)) + '</b>. يُدرج في الكتاب جدول بأيام التأخر وساعاتها.</p>' +
        '<div class="grid2"><div><label class="field" for="lt-date">تاريخ الكتاب</label><input type="date" id="lt-date" data-ro-ok value="' + esc(u.date) + '"></div>' +
        '<div style="align-self:end"><label class="check"><input type="checkbox" id="lt-days" data-ro-ok' + (u.days ? ' checked' : '') + '> إدراج جدول أيام التأخر في الكتاب</label></div>' +
        '<div style="grid-column:1/-1"><label class="field" for="lt-reason">نص لفت النظر وسببه ({الأيام} {الشهر} {الموعد} {المجموع} تُستبدل تلقائيًا)</label><textarea id="lt-reason" data-ro-ok rows="3">' + esc(u.reason) + '</textarea></div>' +
        '<div style="grid-column:1/-1"><label class="field" for="lt-msg">رسالة الالتزام</label><textarea id="lt-msg" data-ro-ok rows="4">' + esc(u.msg) + '</textarea></div></div>' +
        '<div class="actions"><button type="button" class="btn primary" data-ltprint="' + cur.t.id + '" data-ro-ok>طباعة كتاب لفت النظر / PDF</button></div></div>';
    }
    return head + (rows ? '<div class="table-wrap"><table class="grid" style="margin-top:8px"><thead><tr><th>م</th><th>الموظف</th><th>أيام التأخر</th><th>مجموع التأخير</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="empty" style="margin-top:8px">لا متأخرون في هذا الشهر.</div>') + form + '</div>';
  }

  function buildLateLetterSheet(sid) {
    var u = ltUi(), D = u.data, s = D && D.staff.filter(function (x) { return x.t.id === sid; })[0];
    if (!s) { sheet.className = 'ps'; sheet.innerHTML = '<p>لا بيانات.</p>'; return; }
    var days = ltLateDays(s), t = s.t, T = shiftOf(t);
    var dotted = '..............................';
    var table = u.days && days.length ? '<table class="rz" style="margin:.6em 0"><thead><tr><th>م</th><th>التاريخ</th><th>اليوم</th><th>وقت الحضور الرسمي</th><th>وقت الحضور الفعلي</th><th>مدة التأخير</th></tr></thead><tbody>' +
      days.map(function (d, i) { return '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + dmy(d.day) + '</td><td class="c">' + esc(dayName(d.day)) + '</td><td class="c">' + esc(d.official) + '</td><td class="c">' + esc(d.in) + '</td><td class="c">' + esc(ltHours(d.mins)) + '</td></tr>'; }).join('') +
      '<tr class="total"><td colspan="5">المجموع</td><td class="c"><b>' + esc(ltHours(s.late)) + '</b></td></tr></tbody></table>' : '';
    sheet.className = 'ps';
    sheet.removeAttribute('data-fit');
    sheet.innerHTML = reportHead('كتاب لفت نظر', [['التاريخ', dmy(u.date)], ['الموضوع', 'التأخر المتكرر عن الدوام']], { noIssueDate: true }) +
      '<p style="margin:1.1em 0 .2em;font-size:1.1em"><b>السيد/ة ' + esc(t.name) + '</b>' + (t.job_title ? ' — ' + esc(t.job_title) : '') + '</p>' +
      '<p style="margin:0 0 .8em">المحترم/ة،</p><p style="margin:0 0 .8em">تحية طيبة وبعد،</p>' +
      '<p style="margin:0 0 .6em;line-height:1.9;white-space:pre-wrap">' + esc(u.reason.trim().replace(/\{الأيام\}/g, days.length === 1 ? 'يوم واحد' : days.length === 2 ? 'يومين' : days.length + (days.length <= 10 ? ' أيام' : ' يومًا'))
        .replace(/\{الشهر\}/g, monthLabel(D.month)).replace(/\{الموعد\}/g, T.time_in || '').replace(/\{المجموع\}/g, ltHours(s.late))) + '</p>' +
      table +
      '<p style="margin:.6em 0 0;line-height:1.9;white-space:pre-wrap">' + esc(u.msg) + '</p>' +
      '<p style="margin:.8em 0 0">وتفضلوا بقبول فائق الاحترام والتقدير،،،</p>' +
      reportSigns([['مدير/ة الأكاديمية', principalName()], ['الموظف (إقرار بالاستلام)', t.name]]);
    fitSheet();
  }

  document.addEventListener('click', function (e) {
    if (location.hash !== '#/staffatt' || !canView()) return;
    var el, u = ltUi();
    if (e.target.closest('[data-ltload]')) return ltLoad(saState().month);
    if ((el = e.target.closest('[data-ltpick]'))) { u.sid = el.getAttribute('data-ltpick'); return render(); }
    if ((el = e.target.closest('[data-ltprint]'))) { pendingLt = el.getAttribute('data-ltprint'); return printNow(); }
  });
  document.addEventListener('input', function (e) {
    if (location.hash !== '#/staffatt') return;
    var u = ltUi();
    if (e.target.id === 'lt-msg') u.msg = e.target.value;
    else if (e.target.id === 'lt-reason') u.reason = e.target.value;
    else if (e.target.id === 'lt-date' && e.target.value) u.date = e.target.value;
    else if (e.target.id === 'lt-days') u.days = e.target.checked;
  });

  /* ----- كتاب لفت نظر بسبب الغياب -----
     مثل كتاب التأخير، على دوام الشهر نفسه (ltUi().data): يُعرض الغائبون بأيام غيابهم (بدون إجازة)، ويُختار أحدهم فيُكتب له كتاب
     يذكر عدد أيام الغياب وجدولها، ورسالة الالتزام، ويُطبع بتوقيع المدير وإقرار الموظف بالاستلام */
  var LA_MSG = 'نؤكد على ضرورة الالتزام بالحضور وعدم التغيب عن العمل إلا بعذر مقبول أو إجازة معتمدة مسبقًا من الإدارة، حرصًا على انتظام العملية التعليمية وحسن سير العمل، ونأمل ألا يتكرر ذلك مستقبلًا، وإلا اضطررنا إلى اتخاذ الإجراءات اللازمة وفق نظام العمل المعتمد.';
  var pendingLa = null;
  // نص الكتاب بعد «تحية طيبة وبعد»: يُعدَّل لكل كتاب؛ {الأيام} و{الشهر} تُستبدل بعدد أيام الغياب واسم الشهر
  var LA_REASON = 'نحيطكم علمًا بأنه قد تقرر توجيه لفت نظر إليكم بسبب الغياب عن العمل مدة {الأيام} خلال شهر {الشهر}، وذلك لعدم الالتزام بسياسة الحضور والغياب المعتمدة لدى الأكاديمية، والتي تحظر التغيب عن العمل لمدة يومين متتاليين أو أكثر، ويُعد ذلك مخالفة تستوجب اتخاذ الإجراءات الإدارية وفقًا للسياسات واللوائح المعمول بها بالأكاديمية.';
  function laUi() { return ui.la || (ui.la = { sid: '', date: todayISO(), msg: LA_MSG, reason: LA_REASON, days: true }); }
  function laCardHtml() {
    var lu = ltUi(), u = laUi(), month = saState().month, D = lu.data && lu.month === month ? lu.data : null;
    var head = '<div class="card"><h2>كتب لفت النظر (الغياب)</h2>';
    if (!D) return head + '<div class="toolbar" style="align-items:center;margin:8px 0 0"><span class="hint" style="margin:0">الشهر: <b>' + esc(monthLabel(month)) + '</b></span>' +
      '<button type="button" class="btn primary" data-ltload data-ro-ok' + (lu.loading ? ' disabled' : '') + '>' + (lu.loading ? 'جارٍ الجلب…' : 'عرض الغائبين') + '</button></div>' +
      '<p class="hint" style="margin:8px 0 0">اضغط «عرض الغائبين» لتظهر قائمة من غابوا بدون إجازة في هذا الشهر.</p></div>';
    var list = D.staff.filter(function (s) { return s.absent > 0; }).sort(function (a, b) { return b.absent - a.absent; });
    var rows = list.map(function (s, i) {
      return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(s.t.name) + '</b><br><span class="meta" style="font-size:.85rem">' + esc(s.t.job_title || staffCat(s.t)) + '</span></td><td><b>' + s.absent + '</b></td>' +
        '<td>' + dmAbsDays(s).map(function (k) { return dmy(k).slice(0, 5); }).join('، ') + '</td>' +
        '<td><button type="button" class="btn' + (u.sid === s.t.id ? ' primary' : '') + '" data-lapick="' + s.t.id + '" data-ro-ok>كتاب لفت نظر</button></td></tr>';
    }).join('');
    var form = '', cur = list.filter(function (s) { return s.t.id === u.sid; })[0];
    if (cur) {
      form = '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)"><h3 style="margin:0 0 8px">كتاب لفت نظر (غياب): ' + esc(cur.t.name) + '</h3>' +
        '<p class="hint" style="margin:0 0 8px">أيام الغياب: <b>' + cur.absent + '</b>.</p>' +
        '<div class="grid2"><div><label class="field" for="la-date">تاريخ الكتاب</label><input type="date" id="la-date" data-ro-ok value="' + esc(u.date) + '"></div>' +
        '<div style="align-self:end"><label class="check"><input type="checkbox" id="la-days" data-ro-ok' + (u.days ? ' checked' : '') + '> إدراج جدول أيام الغياب في الكتاب</label></div>' +
        '<div style="grid-column:1/-1"><label class="field" for="la-reason">نص لفت النظر وسببه ({الأيام} و{الشهر} تُستبدل تلقائيًا)</label><textarea id="la-reason" data-ro-ok rows="3">' + esc(u.reason) + '</textarea></div>' +
        '<div style="grid-column:1/-1"><label class="field" for="la-msg">رسالة الالتزام</label><textarea id="la-msg" data-ro-ok rows="4">' + esc(u.msg) + '</textarea></div></div>' +
        '<div class="actions"><button type="button" class="btn primary" data-laprint="' + cur.t.id + '" data-ro-ok>طباعة كتاب لفت النظر / PDF</button></div></div>';
    }
    return head + (rows ? '<div class="table-wrap"><table class="grid" style="margin-top:8px"><thead><tr><th>م</th><th>الموظف</th><th>أيام الغياب</th><th>التواريخ</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="empty" style="margin-top:8px">لا غياب بدون إجازة في هذا الشهر.</div>') + form + '</div>';
  }
  function buildAbsLetterSheet(sid) {
    var u = laUi(), D = ltUi().data, s = D && D.staff.filter(function (x) { return x.t.id === sid; })[0];
    if (!s) { sheet.className = 'ps'; sheet.innerHTML = '<p>لا بيانات.</p>'; return; }
    var days = dmAbsDays(s), t = s.t;
    var table = u.days && days.length ? '<table class="rz" style="margin:.6em 0"><thead><tr><th style="width:3em">م</th><th>التاريخ</th><th>اليوم</th></tr></thead><tbody>' +
      days.map(function (d, i) { return '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + dmy(d) + '</td><td class="c">' + esc(dayName(d)) + '</td></tr>'; }).join('') +
      '<tr class="total"><td colspan="2">المجموع</td><td class="c"><b>' + esc(dmDaysTxt(days.length)) + '</b></td></tr></tbody></table>' : '';
    sheet.className = 'ps';
    sheet.removeAttribute('data-fit');
    sheet.innerHTML = reportHead('كتاب لفت نظر', [['التاريخ', dmy(u.date)], ['الموضوع', 'الغياب عن العمل']], { noIssueDate: true }) +
      '<p style="margin:1.1em 0 .2em;font-size:1.1em"><b>السيد/ة ' + esc(t.name) + '</b>' + (t.job_title ? ' — ' + esc(t.job_title) : '') + '</p>' +
      '<p style="margin:0 0 .8em">المحترم/ة،</p><p style="margin:0 0 .8em">تحية طيبة وبعد،</p>' +
      '<p style="margin:0 0 .6em;line-height:1.9;white-space:pre-wrap">' + esc(u.reason.trim().replace(/\{الأيام\}/g, days.length === 2 ? 'يومين' : dmDaysTxt(days.length)).replace(/\{الشهر\}/g, monthLabel(D.month))) + '</p>' +
      table +
      '<p style="margin:.6em 0 0;line-height:1.9;white-space:pre-wrap">' + esc(u.msg) + '</p>' +
      '<p style="margin:.8em 0 0">وتفضلوا بقبول فائق الاحترام والتقدير،،،</p>' +
      reportSigns([['مدير/ة الأكاديمية', principalName()], ['الموظف (إقرار بالاستلام)', t.name]]);
    fitSheet();
  }
  document.addEventListener('click', function (e) {
    if (location.hash !== '#/staffatt' || !canView()) return;
    var el, u = laUi();
    if ((el = e.target.closest('[data-lapick]'))) { u.sid = el.getAttribute('data-lapick'); return render(); }
    if ((el = e.target.closest('[data-laprint]'))) { pendingLa = el.getAttribute('data-laprint'); return printNow(); }
  });
  document.addEventListener('input', function (e) {
    if (location.hash !== '#/staffatt') return;
    var u = laUi();
    if (e.target.id === 'la-msg') u.msg = e.target.value;
    else if (e.target.id === 'la-reason') u.reason = e.target.value;
    else if (e.target.id === 'la-date' && e.target.value) u.date = e.target.value;
    else if (e.target.id === 'la-days') u.days = e.target.checked;
  });

  /* ----- كتاب الاستغناء عن خدمات موظف -----
     تحت «كتب لفت النظر (التأخير)» ويعتمد على دوام الشهر نفسه (ltUi().data): يُعرض المتأخرون والغائبون، ويُختار أحدهم وسبب أو أكثر للاستغناء.
     إن كان التأخير المتكرر أو الغياب المتكرر أو كثرة الإجازات من الأسباب كُتب في الكتاب مجموع كلٍّ منها (مع جدول أيامها اختياريًّا) */
  var DM_REASONS = [
    ['late', 'التأخير المتكرر عن الدوام الرسمي'],
    ['absent', 'الغياب المتكرر عن العمل'],
    ['leave', 'كثرة الإجازات'],
    ['perf', 'ضعف الأداء الوظيفي'],
    ['rules', 'مخالفة الأنظمة والتعليمات المعمول بها'],
    ['admin', 'عدم الالتزام بتوجيهات الإدارة'],
    ['need', 'انتفاء الحاجة إلى الخدمات']
  ];
  var DM_MSG = 'وعليه، تقرر الاستغناء عن خدماتكم اعتبارًا من التاريخ المذكور أعلاه، على أن تُسلَّم جميع العهد والمستندات التي بحوزتكم، وتُسوّى مستحقاتكم وفق نظام العمل المعتمد. شاكرين لكم ما قدمتموه خلال فترة عملكم، ومتمنين لكم التوفيق.';
  var pendingDm = null;
  function dmUi() { return ui.dm || (ui.dm = { sid: '', date: todayISO(), from: todayISO(), r: { late: true }, other: '', msg: DM_MSG, days: true }); }
  function dmAbsDays(s, st) { return Object.keys(s.days).sort().filter(function (k) { return s.days[k].status === (st || 'absent'); }); }
  function dmDaysTxt(n) { return n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : n + (n <= 10 ? ' أيام' : ' يومًا'); }
  function dmReasons() {
    var u = dmUi(), list = DM_REASONS.filter(function (r) { return u.r[r[0]]; }).map(function (r) { return r[1]; });
    if (u.r.other && u.other.trim()) list.push(u.other.trim());
    return list;
  }
  function dmCardHtml() {
    var lu = ltUi(), u = dmUi(), month = saState().month, D = lu.data && lu.month === month ? lu.data : null;
    var head = '<div class="card"><h2>كتب الاستغناء عن خدمات موظف</h2>';
    if (!D) return head + '<div class="toolbar" style="align-items:center;margin:8px 0 0"><span class="hint" style="margin:0">الشهر: <b>' + esc(monthLabel(month)) + '</b></span>' +
      '<button type="button" class="btn primary" data-ltload data-ro-ok' + (lu.loading ? ' disabled' : '') + '>' + (lu.loading ? 'جارٍ الجلب…' : 'عرض المتأخرين') + '</button></div>' +
      '<p class="hint" style="margin:8px 0 0">اضغط «عرض المتأخرين» لتظهر قائمة المتأخرين والغائبين والمجازين في هذا الشهر، ثم اختر الموظف وأسباب الاستغناء.</p></div>';
    var list = D.staff.filter(function (s) { return s.lateDays > 0 || s.absent > 0 || s.leave > 0; }).sort(function (a, b) { return b.late - a.late || b.absent - a.absent || b.leave - a.leave; });
    var rows = list.map(function (s, i) {
      return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(s.t.name) + '</b><br><span class="meta" style="font-size:.85rem">' + esc(s.t.job_title || staffCat(s.t)) + '</span></td><td>' + s.lateDays + '</td>' +
        '<td>' + (s.late ? '<b>' + esc(ltHours(s.late)) + '</b> <span class="meta">(' + s.late + ' د)</span>' : '—') + '</td><td>' + (s.absent || '—') + '</td><td>' + (s.leave || '—') + '</td>' +
        '<td><button type="button" class="btn' + (u.sid === s.t.id ? ' primary' : '') + '" data-dmpick="' + s.t.id + '" data-ro-ok>كتاب استغناء</button></td></tr>';
    }).join('');
    var form = '', cur = list.filter(function (s) { return s.t.id === u.sid; })[0];
    if (cur) {
      var chk = function (k, label) { return '<label class="check" style="margin:0"><input type="checkbox" data-dmr="' + k + '" data-ro-ok' + (u.r[k] ? ' checked' : '') + '> ' + esc(label) + '</label>'; };
      var sums = [];
      if (u.r.late) sums.push('مجموع التأخير: <b>' + esc(ltHours(cur.late)) + '</b> في ' + cur.lateDays + ' يوم');
      if (u.r.absent) sums.push('مجموع الغياب: <b>' + dmDaysTxt(cur.absent) + '</b>');
      if (u.r.leave) sums.push('مجموع الإجازات: <b>' + dmDaysTxt(cur.leave) + '</b>');
      form = '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)"><h3 style="margin:0 0 8px">كتاب استغناء عن خدمات: ' + esc(cur.t.name) + '</h3>' +
        '<label class="field">أسباب الاستغناء (اختر سببًا أو أكثر)</label><div style="display:flex;flex-wrap:wrap;gap:6px 16px;margin:4px 0 8px">' +
        DM_REASONS.map(function (r) { return chk(r[0], r[1]); }).join('') + chk('other', 'سبب آخر') + '</div>' +
        (u.r.other ? '<div style="margin:0 0 8px"><input type="text" id="dm-other" data-ro-ok placeholder="اكتب السبب الآخر" value="' + esc(u.other) + '"></div>' : '') +
        (sums.length ? '<p class="hint" style="margin:0 0 8px">' + sums.join(' · ') + ' (عن شهر ' + esc(monthLabel(D.month)) + ')</p>' : '') +
        '<div class="grid2"><div><label class="field" for="dm-date">تاريخ الكتاب</label><input type="date" id="dm-date" data-ro-ok value="' + esc(u.date) + '"></div>' +
        '<div><label class="field" for="dm-from">الاستغناء اعتبارًا من</label><input type="date" id="dm-from" data-ro-ok value="' + esc(u.from) + '"></div>' +
        (u.r.late || u.r.absent || u.r.leave ? '<div style="grid-column:1/-1"><label class="check"><input type="checkbox" id="dm-days" data-ro-ok' + (u.days ? ' checked' : '') + '> إدراج جدول أيام التأخر والغياب والإجازات في الكتاب</label></div>' : '') +
        '<div style="grid-column:1/-1"><label class="field" for="dm-msg">نص القرار</label><textarea id="dm-msg" data-ro-ok rows="4">' + esc(u.msg) + '</textarea></div></div>' +
        '<div class="actions"><button type="button" class="btn primary" data-dmprint="' + cur.t.id + '" data-ro-ok>طباعة كتاب الاستغناء / PDF</button></div></div>';
    }
    return head + '<p class="hint" style="margin:0">الشهر: <b>' + esc(monthLabel(month)) + '</b> — المتأخرون والغائبون والمجازون فيه.</p>' +
      (rows ? '<div class="table-wrap"><table class="grid" style="margin-top:8px"><thead><tr><th>م</th><th>الموظف</th><th>أيام التأخر</th><th>مجموع التأخير</th><th>أيام الغياب</th><th>أيام الإجازة</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty" style="margin-top:8px">لا متأخرون ولا غائبون ولا مجازون في هذا الشهر.</div>') + form + '</div>';
  }

  function buildDismissSheet(sid) {
    var lu = ltUi(), u = dmUi(), D = lu.data, s = D && D.staff.filter(function (x) { return x.t.id === sid; })[0];
    if (!s) { sheet.className = 'ps'; sheet.innerHTML = '<p>لا بيانات.</p>'; return; }
    var t = s.t, T = shiftOf(t), reasons = dmReasons(), late = ltLateDays(s), abs = dmAbsDays(s), lv = dmAbsDays(s, 'leave'), facts = [], tables = '';
    if (u.r.late && late.length) facts.push('تأخركم عن الحضور في الموعد الرسمي (<b>' + esc(T.time_in) + '</b>) خلال <b>' + dmDaysTxt(late.length) + '</b>، وبلغ مجموع التأخير <b>' + esc(ltHours(s.late)) + '</b>');
    if (u.r.absent && abs.length) facts.push('غيابكم عن العمل، وبلغ مجموع الغياب <b>' + dmDaysTxt(abs.length) + '</b>');
    if (u.r.leave && lv.length) facts.push('كثرة إجازاتكم، وبلغ مجموع الإجازات <b>' + dmDaysTxt(lv.length) + '</b>');
    if (u.days && u.r.late && late.length) tables += '<p style="margin:.6em 0 .2em"><b>أيام التأخر:</b></p><table class="rz" style="margin:0 0 .6em"><thead><tr><th>م</th><th>التاريخ</th><th>اليوم</th><th>وقت الحضور الرسمي</th><th>وقت الحضور الفعلي</th><th>مدة التأخير</th></tr></thead><tbody>' +
      late.map(function (d, i) { return '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + dmy(d.day) + '</td><td class="c">' + esc(dayName(d.day)) + '</td><td class="c">' + esc(d.official) + '</td><td class="c">' + esc(d.in) + '</td><td class="c">' + esc(ltHours(d.mins)) + '</td></tr>'; }).join('') +
      '<tr class="total"><td colspan="5">مجموع التأخير</td><td class="c"><b>' + esc(ltHours(s.late)) + '</b></td></tr></tbody></table>';
    if (u.days && u.r.absent && abs.length) tables += '<p style="margin:.6em 0 .2em"><b>أيام الغياب:</b></p><table class="rz" style="margin:0 0 .6em"><thead><tr><th>م</th><th>التاريخ</th><th>اليوم</th></tr></thead><tbody>' +
      abs.map(function (d, i) { return '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + dmy(d) + '</td><td class="c">' + esc(dayName(d)) + '</td></tr>'; }).join('') +
      '<tr class="total"><td colspan="2">مجموع الغياب</td><td class="c"><b>' + dmDaysTxt(abs.length) + '</b></td></tr></tbody></table>';
    if (u.days && u.r.leave && lv.length) tables += '<p style="margin:.6em 0 .2em"><b>أيام الإجازات:</b></p><table class="rz" style="margin:0 0 .6em"><thead><tr><th>م</th><th>التاريخ</th><th>اليوم</th></tr></thead><tbody>' +
      lv.map(function (d, i) { return '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + dmy(d) + '</td><td class="c">' + esc(dayName(d)) + '</td></tr>'; }).join('') +
      '<tr class="total"><td colspan="2">مجموع الإجازات</td><td class="c"><b>' + dmDaysTxt(lv.length) + '</b></td></tr></tbody></table>';
    sheet.className = 'ps';
    sheet.removeAttribute('data-fit');
    sheet.innerHTML = reportHead('كتاب استغناء عن خدمات', [['التاريخ', dmy(u.date)], ['الموضوع', 'الاستغناء عن الخدمات']], { noIssueDate: true }) +
      '<p style="margin:1.1em 0 .2em;font-size:1.1em"><b>السيد/ة ' + esc(t.name) + '</b>' + (t.job_title ? ' — ' + esc(t.job_title) : '') + '</p>' +
      '<p style="margin:0 0 .8em">المحترم/ة،</p><p style="margin:0 0 .8em">تحية طيبة وبعد،</p>' +
      (facts.length ? '<p style="margin:0 0 .6em;line-height:1.9">بالإشارة إلى سجلات الدوام عن شهر <b>' + esc(monthLabel(D.month)) + '</b>، تبيّن ' + facts.join('، كما تبيّن ') + '.</p>' : '') +
      tables +
      (reasons.length ? '<p style="margin:.4em 0 .2em;line-height:1.9">ونظرًا ' + (reasons.length === 1 ? 'لما يلي' : 'للأسباب الآتية') + ':</p><ol style="margin:0 0 .6em;padding-inline-start:1.6em;line-height:1.9">' +
        reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ol>' : '') +
      '<p style="margin:.6em 0 0;line-height:1.9">نُعلمكم بالاستغناء عن خدماتكم اعتبارًا من تاريخ <b>' + dmy(u.from) + '</b>.</p>' +
      '<p style="margin:.4em 0 0;line-height:1.9;white-space:pre-wrap">' + esc(u.msg) + '</p>' +
      '<p style="margin:.8em 0 0">وتفضلوا بقبول فائق الاحترام والتقدير،،،</p>' +
      reportSigns([['مدير/ة الأكاديمية', principalName()], ['الموظف (إقرار بالاستلام)', t.name]]);
    fitSheet();
  }

  document.addEventListener('click', function (e) {
    if (location.hash !== '#/staffatt' || !canView()) return;
    var el, u = dmUi();
    if ((el = e.target.closest('[data-dmpick]'))) { u.sid = el.getAttribute('data-dmpick'); return render(); }
    if ((el = e.target.closest('[data-dmprint]'))) {
      if (!dmReasons().length) return toast('اختر سببًا واحدًا على الأقل للاستغناء', true);
      pendingDm = el.getAttribute('data-dmprint'); return printNow();
    }
  });
  document.addEventListener('input', function (e) {
    if (location.hash !== '#/staffatt') return;
    var u = dmUi(), id = e.target.id;
    if (id === 'dm-msg') u.msg = e.target.value;
    else if (id === 'dm-other') u.other = e.target.value;
    else if (id === 'dm-date' && e.target.value) u.date = e.target.value;
    else if (id === 'dm-from' && e.target.value) u.from = e.target.value;
  });
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/staffatt') return;
    var u = dmUi(), el = e.target;
    if (el.hasAttribute && el.hasAttribute('data-dmr')) { u.r[el.getAttribute('data-dmr')] = el.checked; render(); }
    else if (el.id === 'dm-days') u.days = el.checked;
  });

  /* ---------- اللجان المدرسية ----------
     لجنة بأعضاء من العاملين وطلاب، تُضاف كما يُضاف الباص: يُختار عامل أو أكثر ثم طالب أو أكثر.
     يعدّلها المدير العام، ويراها المدير والمشرف التربوي. الجدولان committees و committee_members من supabase/committees.sql */

  var CM_NAMES = ['لجنة النظام والانضباط', 'لجنة الإرشاد والدعم النفسي', 'لجنة الأنشطة والمواهب', 'لجنة الصحة والنظافة', 'لجنة الإعلام', 'لجنة القرآن الكريم', 'لجنة النقل المدرسي'];
  var pendingCm = null;

  function canCm() { return canView() || isSup(); }
  function cmState() { return S.cm || (S.cm = { list: [], members: [], missing: false, loaded: false, loading: false }); }
  function cmUi() { return ui.cm || (ui.cm = { id: '', s: {}, t: {}, sq: '', tq: '', tcls: '' }); }
  function cmCurrent() {
    var m = location.hash.match(/^#\/committees\/(.+)$/), c = cmState();
    return m ? c.list.filter(function (x) { return x.id === m[1]; })[0] || null : null;
  }
  function cmMembers(id, kind) { return cmState().members.filter(function (m) { return m.committee_id === id && m.kind === kind; }); }

  async function loadCommittees() {
    var c = cmState();
    if (c.loading) return;
    c.loading = true;
    var a = await fetchAll(function () { return sb.from('committees').select('*').order('created_at').order('id'); });
    var m = a ? await fetchAll(function () { return sb.from('committee_members').select('*').order('created_at').order('id'); }) : null;
    c.loading = false; c.loaded = true; c.missing = !a || !m;
    c.list = a || []; c.members = m || [];
    render();
  }

  function renderCommittees() {
    var c = cmState();
    if (!c.loaded) {
      app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>';
      loadCommittees();
      return;
    }
    if (c.missing) {
      app.innerHTML = '<div class="card empty">اللجان تحتاج جداول جديدة.<br>' + (isAdmin() ? 'شغّل الملف <code dir="ltr">supabase/committees.sql</code> في محرر SQL، ثم حدّث الصفحة.' : 'يشغّل المدير العام الملف <code dir="ltr">supabase/committees.sql</code>.') + '</div>';
      return;
    }
    var cur = cmCurrent();
    if (location.hash !== '#/committees' && !cur) return go('#/committees');
    app.innerHTML = cur ? cmDetailHtml(cur) : cmListHtml();
  }

  function cmListHtml() {
    var c = cmState(), edit = isAdmin();
    var rows = c.list.map(function (x, i) {
      return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(x.name) + '</b></td><td>' + cmMembers(x.id, 'staff').length + '</td><td>' + cmMembers(x.id, 'student').length + '</td>' +
        '<td style="white-space:nowrap"><button type="button" class="btn" data-cmopen="' + x.id + '" data-ro-ok>' + (edit ? 'فتح وتعديل' : 'عرض') + '</button> ' +
        '<button type="button" class="btn" data-cmprint="' + x.id + '" data-ro-ok>طباعة</button></td></tr>';
    }).join('');
    return '<div class="card"><h2>اللجان المدرسية</h2>' +
      (edit ? '<form id="cm-form" class="toolbar" style="align-items:flex-end;margin:10px 0 0"><div style="flex:1;min-width:240px"><label class="field" for="cm-name">لجنة جديدة <span class="req">*</span></label>' +
        '<input type="text" id="cm-name" required list="cm-names" placeholder="اختر من القائمة أو اكتب اسم لجنة" autocomplete="off"><datalist id="cm-names">' +
        CM_NAMES.filter(function (n) { return !c.list.some(function (x) { return x.name === n; }); }).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist></div>' +
        '<button type="submit" class="btn primary">إضافة اللجنة</button></form>' : '') + '</div>' +
      '<div class="card">' + (rows ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>اللجنة</th><th>العاملون</th><th>الطلاب</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">لا توجد لجان بعد' + (edit ? '؛ أضف لجنة من الأعلى.' : '.') + '</div>') + '</div>';
  }

  // مرشحو الإضافة: عاملون على رأس عملهم، أو طلاب مسجَّلون نهائيًا، ليسوا في اللجنة، مع البحث
  function cmStaffCands(com) {
    var u = cmUi(), q = norm(u.sq), inC = {};
    cmMembers(com.id, 'staff').forEach(function (m) { inC[m.staff_id] = 1; });
    var list = saStaff('', todayISO()).filter(function (t) { return !inC[t.id] && (!q || norm(t.name + ' ' + (t.job_title || '')).indexOf(q) > -1); });
    return list.map(function (t) {
      return '<label class="cand" style="cursor:pointer"><span><input type="checkbox" data-cmsel="s|' + t.id + '"' + (u.s[t.id] ? ' checked' : '') + '> <b>' + esc(t.name) + '</b><br><span class="meta">' + esc(t.job_title || staffCat(t)) + '</span></span></label>';
    }).join('') || '<div class="empty">لا يوجد عاملون مطابقون.</div>';
  }
  function cmStudentCands(com) {
    var u = cmUi(), q = norm(u.tq), inC = {}, LIMIT = 40;
    cmMembers(com.id, 'student').forEach(function (m) { inC[m.student_id] = 1; });
    var list = S.students.filter(function (x) {
      if (inC[x.id] || !enrolled(x)) return false;
      if (u.tcls && x.class_name !== u.tcls) return false;
      return !q || norm(x.full_name + ' ' + x.class_name).indexOf(q) > -1 || String(x.national_id || '').indexOf(latinDigits(u.tq)) > -1;
    }).sort(function (a, b) { return classRank(a.class_name) - classRank(b.class_name) || a.full_name.localeCompare(b.full_name, 'ar'); });
    return list.slice(0, LIMIT).map(function (x) {
      return '<label class="cand" style="cursor:pointer"><span><input type="checkbox" data-cmsel="t|' + x.id + '"' + (u.t[x.id] ? ' checked' : '') + '> <b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '<br><span class="meta">' + esc(x.class_name || 'بدون صف') + '</span></span></label>';
    }).join('') + (list.length > LIMIT ? '<p class="st-count" style="margin-top:8px">يُعرض أول ' + LIMIT + ' من ' + list.length + '؛ اكتب في البحث أو اختر شعبة لتضييق القائمة.</p>' : '') ||
      '<div class="empty">' + (S.students.length ? 'لا يوجد طلاب مطابقون.' : 'سجّل الطلاب أولًا.') + '</div>';
  }
  function cmSelCount(kind) { return Object.keys(cmUi()[kind]).filter(function (k) { return cmUi()[kind][k]; }).length; }
  function cmAddBtn(kind) {
    var n = cmSelCount(kind);
    return '<button type="button" class="btn primary" data-cmaddsel="' + kind + '"' + (n ? '' : ' disabled') + '>إضافة المحدَّدين' + (n ? ' (' + n + ')' : '') + '</button>';
  }

  function cmDetailHtml(com) {
    var edit = isAdmin(), u = cmUi();
    if (u.id !== com.id) { u.id = com.id; u.s = {}; u.t = {}; u.sq = ''; u.tq = ''; u.tcls = ''; }
    var staff = cmMembers(com.id, 'staff').map(function (m) { return { m: m, t: find(m.staff_id) }; }).filter(function (p) { return p.t; })
      .sort(function (a, b) { return a.t.name.localeCompare(b.t.name, 'ar'); });
    var studs = cmMembers(com.id, 'student').map(function (m) { return { m: m, x: findStudent(m.student_id) }; }).filter(function (p) { return p.x; })
      .sort(function (a, b) { return classRank(a.x.class_name) - classRank(b.x.class_name) || a.x.full_name.localeCompare(b.x.full_name, 'ar'); });
    var rm = function (id) { return edit ? '<td class="no-print"><button type="button" class="btn" data-cmrm="' + id + '">إزالة</button></td>' : ''; };
    var th = edit ? '<th></th>' : '';
    return '<div class="card"><div class="toolbar" style="align-items:center;margin:0"><button type="button" class="btn" data-cmback data-ro-ok>→ كل اللجان</button><h2 style="margin:0;flex:1">' + esc(com.name) + '</h2>' +
        '<button type="button" class="btn" data-cmprint="' + com.id + '" data-ro-ok>طباعة / PDF</button>' +
        (edit ? '<button type="button" class="btn danger" data-cmdel="' + com.id + '">حذف اللجنة</button>' : '') + '</div></div>' +
      '<div class="card"><h2>أعضاء اللجنة من العاملين (' + staff.length + ')</h2>' + (staff.length
        ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الاسم</th><th>الوظيفة</th>' + th + '</tr></thead><tbody>' + staff.map(function (p, i) {
            return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(p.t.name) + '</b></td><td>' + esc(p.t.job_title || staffCat(p.t)) + '</td>' + rm(p.m.id) + '</tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">لم يُضف عاملون بعد.</div>') +
        (edit ? '<h3 style="margin:16px 0 6px">إضافة عاملين</h3><input type="search" id="cm-sq" placeholder="ابحث بالاسم أو الوظيفة" aria-label="بحث عن عامل" style="margin:0 0 8px" value="' + esc(u.sq) + '">' +
          '<div id="cm-scands" style="max-height:260px;overflow:auto">' + cmStaffCands(com) + '</div><div class="actions" id="cm-sadd">' + cmAddBtn('s') + '</div>' : '') + '</div>' +
      '<div class="card"><h2>الطلاب (' + studs.length + ')</h2>' + (studs.length
        ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الطالب</th><th>الشعبة</th>' + th + '</tr></thead><tbody>' + studs.map(function (p, i) {
            return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(p.x.full_name) + '</b>' + rsvMark(p.x) + '</td><td>' + esc(p.x.class_name || '—') + '</td>' + rm(p.m.id) + '</tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">لم يُضف طلاب بعد.</div>') +
        (edit ? '<h3 style="margin:16px 0 6px">إضافة طلاب</h3><div class="toolbar" style="align-items:center;margin:0 0 8px"><input type="search" id="cm-tq" placeholder="ابحث بالاسم أو رقم الهوية" aria-label="بحث عن طالب" style="flex:1;min-width:200px" value="' + esc(u.tq) + '">' +
          '<select id="cm-tcls" aria-label="الشعبة" style="width:auto"><option value="">كل الشعب</option>' + attClasses().map(function (n) { return '<option' + (n === u.tcls ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></div>' +
          '<div id="cm-tcands" style="max-height:300px;overflow:auto">' + cmStudentCands(com) + '</div><div class="actions" id="cm-tadd">' + cmAddBtn('t') + '</div>' : '') + '</div>';
  }

  async function cmAddSelected(kind) {
    var com = cmCurrent(), u = cmUi();
    if (!com || !isAdmin()) return;
    var ids = Object.keys(u[kind]).filter(function (k) { return u[kind][k]; });
    if (!ids.length) return;
    var who = (S.profile && S.profile.full_name) || displayName(S.email);
    var rows = ids.map(function (id) { return { committee_id: com.id, kind: kind === 's' ? 'staff' : 'student', staff_id: kind === 's' ? id : null, student_id: kind === 't' ? id : null, created_by: who }; });
    var r = await sb.from('committee_members').insert(rows).select();
    if (r.error) return fail(r.error);
    cmState().members = cmState().members.concat(r.data || []);
    u[kind] = {};
    render();
    toast('أُضيف ' + ids.length + (kind === 's' ? ' من العاملين' : ' من الطلاب') + ' إلى ' + com.name);
  }

  function buildCommitteeSheet(id) {
    var com = cmState().list.filter(function (x) { return x.id === id; })[0];
    if (!com) { sheet.className = 'ps'; sheet.innerHTML = '<p>لا توجد لجنة.</p>'; return; }
    var staff = cmMembers(id, 'staff').map(function (m) { return find(m.staff_id); }).filter(Boolean).sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); });
    var studs = cmMembers(id, 'student').map(function (m) { return findStudent(m.student_id); }).filter(Boolean)
      .sort(function (a, b) { return classRank(a.class_name) - classRank(b.class_name) || a.full_name.localeCompare(b.full_name, 'ar'); });
    var head = reportHead(com.name, [['عدد العاملين', staff.length], ['عدد الطلاب', studs.length]]).replace(/^<img class="wm"[^>]*>/, '');
    var sec = function (t) { return '<tr><td class="bf-sec" style="background:var(--navy);color:#fff" colspan="3">' + t + '</td></tr>'; };
    var body = sec('أعضاء اللجنة من العاملين (' + staff.length + ')') + (staff.length ? staff.map(function (t, i) {
        return '<tr><td class="c">' + (i + 1) + '</td><td style="white-space:nowrap"><b>' + esc(t.name) + '</b></td><td>' + esc(t.job_title || staffCat(t)) + '</td></tr>';
      }).join('') : '<tr><td colspan="3" class="c">—</td></tr>') +
      sec('الطلاب (' + studs.length + ')') + (studs.length ? studs.map(function (x, i) {
        return '<tr><td class="c">' + (i + 1) + '</td><td style="white-space:nowrap"><b>' + esc(x.full_name) + '</b></td><td>' + esc(x.class_name || '') + '</td></tr>';
      }).join('') : '<tr><td colspan="3" class="c">—</td></tr>');
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
      '<table class="rz"><thead><tr><td class="pg-space" colspan="3"></td></tr><tr><td class="ls-head" colspan="3">' + head + '</td></tr>' +
      '<tr><th>الرقم</th><th>الاسم</th><th>الوظيفة / الشعبة</th></tr></thead><tbody>' + body + '</tbody>' +
      '<tfoot><tr><td class="pg-space" colspan="3"></td></tr></tfoot></table>' + reportSigns([['رئيس اللجنة', ''], ['مدير/ة الأكاديمية', principalName()]]);
  }

  document.addEventListener('click', async function (e) {
    if (!/^#\/committees/.test(location.hash) || !canCm()) return;
    var el;
    if ((el = e.target.closest('[data-cmopen]'))) return go('#/committees/' + el.getAttribute('data-cmopen'));
    if (e.target.closest('[data-cmback]')) return go('#/committees');
    if ((el = e.target.closest('[data-cmprint]'))) { pendingCm = el.getAttribute('data-cmprint'); return printNow(); }
    if (!isAdmin()) return;
    if ((el = e.target.closest('[data-cmaddsel]'))) return cmAddSelected(el.getAttribute('data-cmaddsel'));
    if ((el = e.target.closest('[data-cmrm]'))) {
      var id = el.getAttribute('data-cmrm'), r = await sb.from('committee_members').delete().eq('id', id);
      if (r.error) return fail(r.error);
      cmState().members = cmState().members.filter(function (m) { return m.id !== id; });
      return render();
    }
    if ((el = e.target.closest('[data-cmdel]'))) {
      var com = cmCurrent();
      if (!com || !confirm('حذف «' + com.name + '» وكل أعضائها؟ (لا يُحذف أي عامل ولا طالب)')) return;
      var d = await sb.from('committees').delete().eq('id', com.id);
      if (d.error) return fail(d.error);
      var c = cmState();
      c.list = c.list.filter(function (x) { return x.id !== com.id; });
      c.members = c.members.filter(function (m) { return m.committee_id !== com.id; });
      toast('حُذفت اللجنة');
      return go('#/committees');
    }
  });

  document.addEventListener('submit', async function (e) {
    if (e.target.id !== 'cm-form' || !isAdmin()) return;
    e.preventDefault();
    var name = document.getElementById('cm-name').value.trim().replace(/\s+/g, ' '), c = cmState();
    if (!name) return;
    if (c.list.some(function (x) { return norm(x.name) === norm(name); })) return toast('هذه اللجنة موجودة', true);
    var r = await sb.from('committees').insert({ name: name, created_by: (S.profile && S.profile.full_name) || displayName(S.email) }).select().single();
    if (r.error) return fail(r.error);
    c.list.push(r.data);
    go('#/committees/' + r.data.id);
    toast('أُضيفت ' + name + '؛ اختر أعضاءها');
  });

  document.addEventListener('change', function (e) {
    if (!/^#\/committees\//.test(location.hash) || !isAdmin()) return;
    var el = e.target, u = cmUi();
    if (el.hasAttribute && el.hasAttribute('data-cmsel')) {
      var p = el.getAttribute('data-cmsel').split('|');
      u[p[0]][p[1]] = el.checked;
      var box = document.getElementById(p[0] === 's' ? 'cm-sadd' : 'cm-tadd');
      if (box) box.innerHTML = cmAddBtn(p[0]);
    } else if (el.id === 'cm-tcls') {
      u.tcls = el.value;
      var com = cmCurrent();
      if (com) document.getElementById('cm-tcands').innerHTML = cmStudentCands(com);
    }
  });

  document.addEventListener('input', function (e) {
    if (!/^#\/committees\//.test(location.hash) || !isAdmin()) return;
    var com = cmCurrent(), u = cmUi();
    if (!com) return;
    if (e.target.id === 'cm-sq') { u.sq = e.target.value; document.getElementById('cm-scands').innerHTML = cmStaffCands(com); }
    else if (e.target.id === 'cm-tq') { u.tq = e.target.value; document.getElementById('cm-tcands').innerHTML = cmStudentCands(com); }
  });

  /* تشكيل المعلمين: لكل معلم موادّه والصفوف التي يدرّسها وعدد حصصه الأسبوعية، من جدول الحصص الحالي (ومحفّظو القرآن في النهاية) */
  function buildTeacherFormationSheet() {
    var by = {}, clsOrder = ttClasses();
    ttLive().forEach(function (s) {
      if (!s.teacher_id) return;
      var t = by[s.teacher_id] || (by[s.teacher_id] = { subs: {}, n: 0 }), sub = ttFixSubject(s.subject) || '—';
      var o = t.subs[sub] || (t.subs[sub] = { cls: {}, n: 0 });
      o.cls[s.class_name] = 1; o.n++; t.n++;
    });
    var rows = '', i = 0, total = 0, quranN = 0;
    ttTeachers().forEach(function (t) {
      var d = by[t.id];
      if (!d) return;
      if (ttIsQuranT(t)) quranN++;
      var subs = Object.keys(d.subs).sort(function (a, b) { return d.subs[b].n - d.subs[a].n || a.localeCompare(b, 'ar'); });
      i++; total += d.n;
      subs.forEach(function (sub, j) {
        var o = d.subs[sub], cls = Object.keys(o.cls).sort(function (a, b) { return clsOrder.indexOf(a) - clsOrder.indexOf(b); });
        rows += '<tr>' + (j ? '' : '<td class="c" rowspan="' + subs.length + '">' + i + '</td><td rowspan="' + subs.length + '" style="white-space:nowrap"><b>' + esc(ttName(t)) + '</b></td>') +
          '<td>' + esc(sub) + '</td><td>' + esc(cls.join('، ')) + '</td><td class="c">' + o.n + '</td>' +
          (j ? '' : '<td class="c" rowspan="' + subs.length + '"><b>' + d.n + '</b></td>') + '</tr>';
      });
    });
    var head = reportHead('تشكيل المعلمين', [['عدد المعلمين', i - quranN]].concat(quranN ? [['عدد المحفظين', quranN]] : [], [['مجموع الحصص الأسبوعية', total]])).replace(/^<img class="wm"[^>]*>/, '');
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
      '<table class="rz"><thead><tr><td class="pg-space" colspan="6"></td></tr><tr><td class="ls-head" colspan="6">' + head + '</td></tr>' +
      '<tr><th>م</th><th>المعلم / ة</th><th>المادة</th><th>الصفوف التي يدرّسها</th><th>حصص المادة</th><th>نصاب الحصص</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="c">لا توجد حصص في جدول الحصص.</td></tr>') + '</tbody>' +
      '<tfoot><tr><td class="pg-space" colspan="6"></td></tr></tfoot></table>';
  }

