'use strict';
  /* ---------- دوام الموظفين ----------
     حضور كل العاملين وانصرافهم بالوقت، يومًا بيوم (supabase/staff_attendance.sql). يسجّله المدير العام والمدير.
     الوقت الرسمي واحد للجميع، و«الحضور الموحد» و«الانصراف الموحد» يملآن الوقت لكل الحاضرين بضغطة، ثم يُعدَّل موظف موظف.
     التأخير والانصراف المبكر يُحسبان من الوقت الرسمي. المعلم الغائب يُقترح تسجيل غيابه في الاحتياط */
  var SA_STATUS = { present: 'حاضر', absent: 'غائب', leave: 'إجازة', mission: 'مأمورية' };
  var SA_CODE = { present: 'ح', absent: 'غ', leave: 'إ', mission: 'م' };

  function saState() {
    if (!ui.sa) ui.sa = { day: todayISO(), cat: '', draft: {}, month: todayISO().slice(0, 7), busy: false };
    return ui.sa;
  }
  function hm5(t) { return t ? String(t).slice(0, 5) : ''; }
  function minsOf(t) { var m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  // دقائق التأخير والانصراف المبكر عن الوقت الرسمي
  /* ----- مجموعات الدوام -----
     لكل مجموعة اسم ووقت حضور وانصراف (8:00–12:30، 8:00–10:00…)، ولكل موظف مجموعته؛ من لا مجموعة له فدوامه الوقت الرسمي.
     بها يُحسب التأخير والانصراف المبكر، ويُملأ الحضور والانصراف الموحدان، ويُحسب أجر الساعة في الرواتب */
  function saParseHours(row) {
    row = row || {};
    return { time_in: hm5(row.time_in) || '07:30', time_out: hm5(row.time_out) || '13:30',
      groups: Array.isArray(row.groups) ? row.groups : [], assign: row.assign && typeof row.assign === 'object' ? row.assign : {}, shiftsMissing: !('groups' in row) };
  }
  function shiftGroup(id) { return ((S.saHours || {}).groups || []).filter(function (g) { return g.id === id; })[0] || null; }
  // دوام الموظف: مجموعته، وإلا الوقت الرسمي
  function shiftOf(t) {
    var H = S.saHours || { time_in: '07:30', time_out: '13:30', assign: {} }, g = t && H.assign ? shiftGroup(H.assign[t.id]) : null;
    return g ? { time_in: g.time_in, time_out: g.time_out, name: g.name, id: g.id } : { time_in: H.time_in, time_out: H.time_out, name: 'الوقت الرسمي', id: '' };
  }
  async function saveShifts(groups, assign, msg) {
    var r = await sb.from('staff_hours').update({ groups: groups, assign: assign, updated_by: (S.profile && S.profile.full_name) || displayName(S.email), updated_at: new Date().toISOString() }).eq('id', 1);
    if (r.error) { render(); return fail(r.error); }
    S.saHours.groups = groups; S.saHours.assign = assign;
    render();
    toast(msg || 'تم الحفظ');
  }
  function shiftsHtml() {
    var H = S.saHours, staff = saStaff(''), cnt = {};
    if (H.shiftsMissing) return '<div class="card"><h2>مجموعات الدوام</h2><p class="formhint" style="margin:0">لتعريف مجموعات دوام بأوقات مختلفة شغّل الملف <code dir="ltr">supabase/staff_shifts.sql</code> في محرر SQL ثم حدّث الصفحة.</p></div>';
    staff.forEach(function (t) { var g = shiftOf(t).id; cnt[g] = (cnt[g] || 0) + 1; });
    var open = ui.shiftsOpen ? ' open' : '';
    return '<details class="card"' + open + ' data-shiftsbox><summary><b>مجموعات الدوام</b> <span class="hint" style="margin:0">— ' + (H.groups.length ? H.groups.map(function (g) { return esc(g.name) + ' ' + g.time_in + '–' + g.time_out + ' (' + (cnt[g.id] || 0) + ')'; }).join('، ') + '، والوقت الرسمي (' + (cnt[''] || 0) + ')' : 'الجميع على الوقت الرسمي') + '</span></summary>' +
      '<p class="hint">لكل مجموعة وقت حضور وانصراف، وبه يُحسب تأخير أفرادها وانصرافهم المبكر، والحضور والانصراف الموحدان، وأجر الساعة في الرواتب. من لا مجموعة له فدوامه الوقت الرسمي (' + H.time_in + '–' + H.time_out + ').</p>' +
      '<div class="table-wrap"><table class="grid"><thead><tr><th>المجموعة</th><th>الحضور</th><th>الانصراف</th><th>الموظفون</th><th></th></tr></thead><tbody>' +
        H.groups.map(function (g) {
          return '<tr><td><input type="text" data-shname="' + g.id + '" data-ro-mgr value="' + esc(g.name) + '" style="min-width:140px"></td>' +
            '<td><input type="time" data-shin="' + g.id + '" data-ro-mgr value="' + g.time_in + '" style="width:auto"></td><td><input type="time" data-shout="' + g.id + '" data-ro-mgr value="' + g.time_out + '" style="width:auto"></td>' +
            '<td class="c">' + (cnt[g.id] || 0) + '</td><td><button type="button" class="btn danger" data-shdel="' + g.id + '" data-ro-mgr>حذف</button></td></tr>';
        }).join('') +
        '<tr><td><input type="text" id="sh-new-name" data-ro-mgr placeholder="اسم مجموعة جديدة (مثل: المحفظون)" style="min-width:140px"></td><td><input type="time" id="sh-new-in" data-ro-mgr value="' + H.time_in + '" style="width:auto"></td>' +
          '<td><input type="time" id="sh-new-out" data-ro-mgr style="width:auto"></td><td></td><td><button type="button" class="btn primary" data-shadd data-ro-mgr>إضافة</button></td></tr>' +
      '</tbody></table></div>' +
      (H.groups.length ? '<h3 style="margin:14px 0 6px">مجموعة كل موظف</h3><div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الموظف</th><th>المجموعة</th></tr></thead><tbody>' +
        staff.map(function (t, i) {
          var cur = shiftOf(t).id;
          return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(t.name) + '</b> <span class="hint" style="margin:0">' + esc(staffCat(t)) + '</span></td><td><select data-shset="' + t.id + '" data-ro-mgr style="width:auto">' +
            '<option value="">الوقت الرسمي (' + H.time_in + '–' + H.time_out + ')</option>' +
            H.groups.map(function (g) { return '<option value="' + g.id + '"' + (cur === g.id ? ' selected' : '') + '>' + esc(g.name) + ' (' + g.time_in + '–' + g.time_out + ')</option>'; }).join('') + '</select></td></tr>';
        }).join('') + '</tbody></table></div>' : '') + '</details>';
  }
  document.addEventListener('toggle', function (e) { if (e.target.hasAttribute && e.target.hasAttribute('data-shiftsbox')) ui.shiftsOpen = e.target.open; }, true);
  document.addEventListener('click', function (e) {
    if (location.hash !== '#/staffatt' || !canView() || isReadOnly() || !S.saHours) return;
    var H = S.saHours, el;
    if (e.target.closest('[data-shadd]')) {
      var nm = document.getElementById('sh-new-name').value.trim(), a = document.getElementById('sh-new-in').value, b = document.getElementById('sh-new-out').value;
      if (!nm) return toast('اكتب اسم المجموعة', true);
      if (!a || !b || a >= b) return toast('وقت الحضور يجب أن يكون قبل وقت الانصراف', true);
      return saveShifts(H.groups.concat([{ id: 'g' + Date.now().toString(36), name: nm, time_in: a, time_out: b }]), H.assign, 'أُضيفت المجموعة؛ اختر أفرادها في «مجموعة كل موظف»');
    }
    if ((el = e.target.closest('[data-shdel]'))) {
      var gid = el.getAttribute('data-shdel'), g = shiftGroup(gid);
      if (!g || !confirm('حذف مجموعة «' + g.name + '»؟ يعود أفرادها إلى الوقت الرسمي.')) return;
      var asg = {};
      Object.keys(H.assign).forEach(function (k) { if (H.assign[k] !== gid) asg[k] = H.assign[k]; });
      return saveShifts(H.groups.filter(function (x) { return x.id !== gid; }), asg, 'حُذفت المجموعة');
    }
  });
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/staffatt' || !canView() || isReadOnly() || !S.saHours) return;
    var H = S.saHours, el = e.target, id;
    if ((id = el.getAttribute('data-shset')) != null) {
      var asg = Object.assign({}, H.assign);
      if (el.value) asg[id] = el.value; else delete asg[id];
      return saveShifts(H.groups, asg, 'حُفظت مجموعة الموظف');
    }
    var gid = el.getAttribute('data-shname') || el.getAttribute('data-shin') || el.getAttribute('data-shout');
    if (gid) {
      var groups = H.groups.map(function (g) {
        if (g.id !== gid) return g;
        var n = Object.assign({}, g);
        if (el.hasAttribute('data-shname')) n.name = el.value.trim() || g.name;
        if (el.hasAttribute('data-shin')) n.time_in = el.value;
        if (el.hasAttribute('data-shout')) n.time_out = el.value;
        return n;
      }), c = groups.filter(function (g) { return g.id === gid; })[0];
      if (!c.time_in || !c.time_out || c.time_in >= c.time_out) { render(); return toast('وقت الحضور يجب أن يكون قبل وقت الانصراف', true); }
      return saveShifts(groups, H.assign, 'حُفظت المجموعة');
    }
  });

  function saLate(r, H) { var a = minsOf(r.time_in), b = minsOf(H.time_in); return r.status === 'present' && a != null && b != null && a > b ? a - b : 0; }
  function saEarly(r, H) { var a = minsOf(r.time_out), b = minsOf(H.time_out); return r.status === 'present' && a != null && b != null && a < b ? b - a : 0; }

  var loadingSa = false;
  async function loadSa(day) {
    if (loadingSa) return;
    loadingSa = true;
    var rows = await fetchAll(function () { return sb.from('staff_attendance').select('*').eq('day', day).order('teacher_id'); });
    var h = rows ? await sb.from('staff_hours').select('*').eq('id', 1).maybeSingle() : { data: null };
    // المعلمون المسجَّل غيابهم في الاحتياط هذا اليوم (لاقتراح تسجيل الباقين)
    var ab = rows && canEditTT() ? await sb.from('teacher_absences').select('teacher_id').eq('day', day) : { data: [] };
    // قراءات واردة من واتساب بانتظار المراجعة، والأرقام المسموح لها بالإرسال (supabase/staff_bot.sql)
    var inbox = rows ? await sb.from('staff_sheet_inbox').select('*').eq('status', 'pending').order('created_at') : { data: [] };
    var phones = rows && isAdmin() ? await sb.from('staff_bot_phones').select('*').order('created_at') : { data: [] };
    loadingSa = false;
    var map = {};
    (rows || []).forEach(function (r) { map[r.teacher_id] = r; });
    S.sa = { day: day, missing: !rows, rows: map, subsAbs: (ab.data || []).map(function (a) { return a.teacher_id; }), subsMissing: !!ab.error,
      inbox: inbox.data || [], botMissing: !!inbox.error, phones: phones.data || [] };
    // قراءة فُتحت من صندوق الوارد: تُطبَّق على يومها بعد تحميله
    var st0 = saState();
    if (st0.openInbox && st0.openInbox.day === day) { var it = st0.openInbox; st0.openInbox = null; saApplyInbox(it); }
    S.saHours = saParseHours(h.data);
    render();
  }

  // على رأس عمله في اليوم: من تاريخ التعيين إلى تاريخ انتهاء العقد (آخر يوم عمل)، إن وُجدا
  function employedOn(t, day) {
    var from = String(t.hire_date || '').slice(0, 10), to = String(t.contract_end || '').slice(0, 10);
    return (!from || from <= day) && (!to || day <= to);
  }
  // العاملون (في يوم بعينه إن مُرّر) بترتيب الفئات ثم الاسم
  function saStaff(cat, day) {
    return staffList().filter(function (t) { return (!cat || staffCat(t) === cat) && (!day || employedOn(t, day)); }).sort(function (a, b) {
      return STAFF_CATS.indexOf(staffCat(a)) - STAFF_CATS.indexOf(staffCat(b)) || a.name.localeCompare(b.name, 'ar');
    });
  }
  // حالة الموظف المعروضة: ما عُدِّل ولم يُحفظ، ثم المحفوظ، وإلا غير مسجَّل
  function saRow(id) {
    var st = saState(), d = st.draft[id], s = S.sa.rows[id];
    return d || (s ? { status: s.status, time_in: hm5(s.time_in), time_out: hm5(s.time_out), note: s.note || '' } : null);
  }
  function saEdit(id, patch) {
    var st = saState(), cur = saRow(id) || { status: 'present', time_in: '', time_out: '', note: '' };
    st.draft[id] = Object.assign({}, cur, patch);
    if (st.draft[id].status !== 'present') { st.draft[id].time_in = ''; st.draft[id].time_out = ''; }
  }

  // قائمة منسدلة تجمع الأزرار قليلة الاستعمال؛ تُغلق عند اختيار زر منها أو النقر خارجها
  function menuHtml(label, inner, row) { return '<details class="menu no-print' + (row ? ' row' : '') + '"><summary class="btn" data-ro-ok>' + label + '</summary><div class="menu-pop">' + inner + '</div></details>'; }
  // قائمة داخل صف جدول: تُعرض فوق الجدول (موضع ثابت) حتى لا يقصّها إطار التمرير، وتُغلق عند التمرير
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (!d.matches || !d.matches('details.menu.row') || !d.open) return;
    var r = d.querySelector('summary').getBoundingClientRect(), p = d.querySelector('.menu-pop');
    p.style.position = 'fixed';
    var w = p.offsetWidth, h = p.offsetHeight;
    p.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    p.style.right = 'auto';
    p.style.top = (r.bottom + 6 + h > window.innerHeight && r.top - h - 6 > 0 ? r.top - h - 6 : r.bottom + 6) + 'px';
  }, true);
  document.addEventListener('scroll', function () {
    Array.prototype.forEach.call(document.querySelectorAll('details.menu.row[open]'), function (d) { d.removeAttribute('open'); });
  }, true);
  document.addEventListener('click', function (e) {
    Array.prototype.forEach.call(document.querySelectorAll('details.menu[open]'), function (d) {
      if (!d.contains(e.target) || e.target.closest('.menu-pop button')) d.removeAttribute('open');
    });
  });

  // تبويبات داخل الشاشة: يظهر قسم واحد في كل مرة
  function vtab(key, def) { return (ui.vtab && ui.vtab[key]) || def; }
  function vtabsHtml(key, def, items) {
    var cur = vtab(key, def);
    return '<div class="tabbar no-print"><nav class="tabs" aria-label="أقسام الشاشة">' + items.map(function (it) {
      return '<button type="button" data-ro-ok data-vtab="' + key + ':' + it[0] + '"' + (cur === it[0] ? ' class="on" aria-current="true"' : '') + '>' + it[1] + (it[2] ? ' <b>' + it[2] + '</b>' : '') + '</button>';
    }).join('') + '</nav></div>';
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-vtab]');
    if (!el) return;
    var p = el.getAttribute('data-vtab').split(':');
    (ui.vtab = ui.vtab || {})[p[0]] = p[1];
    render();
  });

  function renderStaffAtt() {
    var st = saState(), H = S.saHours;
    if (!S.sa || S.sa.day !== st.day) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; loadSa(st.day); return; }
    var head = '<div class="page-head"><div><h1>دوام الموظفين</h1><p>حضور العاملين وانصرافهم بالوقت. «الحضور الموحد» و«الانصراف الموحد» يملآن الوقت الرسمي لكل الحاضرين، ثم تعدّل من يختلف.</p></div></div>';
    if (S.sa.missing) {
      app.innerHTML = head + '<div class="card empty">دوام الموظفين يحتاج إلى جدول جديد في قاعدة البيانات.<br>شغّل الملف <code dir="ltr">supabase/staff_attendance.sql</code> في محرر SQL ثم حدّث الصفحة.</div>';
      return;
    }
    var list = saStaff(st.cat, st.day), off = attOff(st.day), di = subDayIdx(st.day), dirty = Object.keys(st.draft).length;
    // ما قُرئ من الكشف المصوَّر ولم يُحفظ: اسم السطر في الكشف، والخانات غير المؤكدة بإطار برتقالي
    var sheet = (st.scan && st.scan.fromSheet) || {}, unsureMap = (st.scan && st.scan.unsure) || {};
    var uns = function (id, k) { return !!st.draft[id] && (unsureMap[id] || []).indexOf(k) > -1; };
    var UNSURE = 'outline:2px solid #f79009;outline-offset:1px';
    var n = { present: 0, absent: 0, leave: 0, mission: 0, none: 0 }, lateN = 0;
    var rows = list.map(function (t, i) {
      var r = saRow(t.id), status = r ? r.status : '', T = shiftOf(t), late = r ? saLate(r, T) : 0, early = r ? saEarly(r, T) : 0;
      n[status || 'none']++;
      if (late) lateN++;
      var opt = function (v, l) { return '<option value="' + v + '"' + (status === v ? ' selected' : '') + '>' + l + '</option>'; };
      // معلم غائب له حصص هذا اليوم ولم يُسجَّل في الاحتياط
      var teaches = di > -1 && ttLive().some(function (x) { return x.teacher_id === t.id && x.day === di; });
      var toSubs = status && status !== 'present' && teaches && canEditTT() && !S.sa.subsMissing && S.sa.subsAbs.indexOf(t.id) < 0 && S.sa.rows[t.id] && !st.draft[t.id];
      return '<tr' + (st.draft[t.id] ? ' style="background:#fffbeb"' : '') + '><td>' + (i + 1) + '</td>' +
        '<td><b>' + esc(t.name) + '</b><div class="hint" style="margin:0">' + esc(staffCat(t)) + (t.job_title ? ' · ' + esc(t.job_title) : '') + '</div>' +
          (sheet[t.id] != null && st.draft[t.id] ? '<div class="hint" style="margin:0">من الكشف: «' + esc(sheet[t.id]) + '»' + (uns(t.id, 'key') ? ' <span class="badge part">تحقّق أنه هو</span>' : '') + '</div>' : '') + '</td>' +
        '<td><select data-sast="' + t.id + '" data-ro-mgr style="width:auto' + (uns(t.id, 'status') ? ';' + UNSURE : '') + '">' + (status ? '' : '<option value="">— غير مسجَّل —</option>') +
          opt('present', 'حاضر') + opt('absent', 'غائب') + opt('leave', 'إجازة') + opt('mission', 'مأمورية') + '</select></td>' +
        '<td><input type="time" data-sain="' + t.id + '" data-ro-mgr value="' + (r ? r.time_in : '') + '"' + (status === 'present' || !status ? '' : ' disabled') + ' style="width:auto' + (uns(t.id, 'in') ? ';' + UNSURE : '') + '"></td>' +
        '<td><input type="time" data-saout="' + t.id + '" data-ro-mgr value="' + (r ? r.time_out : '') + '"' + (status === 'present' || !status ? '' : ' disabled') + ' style="width:auto' + (uns(t.id, 'out') ? ';' + UNSURE : '') + '"></td>' +
        '<td class="c">' + (late ? '<b style="color:var(--red)">' + late + ' د</b>' : '') + '</td><td class="c">' + (early ? '<b style="color:var(--red)">' + early + ' د</b>' : '') + '</td>' +
        '<td><input type="text" data-sanote="' + t.id + '" data-ro-mgr value="' + esc(r ? r.note : '') + '" placeholder="ملاحظة" style="min-width:120px">' +
          (toSubs ? '<button type="button" class="btn link" data-satosubs="' + t.id + '" data-ro-mgr>تسجيل غيابه في الاحتياط</button>' : '') + '</td></tr>';
    }).join('');
    var card = function (lbl, num, sub, color) { return '<div class="card stat"><span class="lbl">' + lbl + '</span><span class="num"' + (color ? ' style="color:' + color + '"' : '') + '>' + num + '</span><span class="sub">' + sub + '</span></div>'; };
    var copt = function (v, l) { return '<option value="' + esc(v) + '"' + (st.cat === v ? ' selected' : '') + '>' + l + '</option>'; };
    var inboxN = ((S.sa && S.sa.inbox) || []).length, tab = vtab('sa', 'day');
    head += vtabsHtml('sa', 'day', [['day', 'تسجيل اليوم', inboxN || ''], ['sheets', 'الكشوف'], ['letters', 'الكتب'], ['setup', 'إعدادات الدوام']]);
    var hoursCard = '<div class="card"><h2>الوقت الرسمي</h2><div class="toolbar" style="align-items:center;margin:8px 0 0">' +
        '<label class="field" for="sa-hin" style="margin:0">الحضور</label><input type="time" id="sa-hin" data-ro-mgr value="' + H.time_in + '" style="width:auto">' +
        '<label class="field" for="sa-hout" style="margin:0">الانصراف</label><input type="time" id="sa-hout" data-ro-mgr value="' + H.time_out + '" style="width:auto"></div>' +
        '<p class="hint" style="margin:6px 0 0">دوام من لا مجموعة له، وبه يُحسب التأخير والانصراف المبكر.</p></div>';
    if (tab === 'setup') { app.innerHTML = head + hoursCard + shiftsHtml() + saPhonesHtml(); return; }
    if (tab === 'letters') { app.innerHTML = head + ltCardHtml() + laCardHtml() + dmCardHtml(); return; }
    if (tab === 'sheets') { app.innerHTML = head + sheetsCard(); return; }
    app.innerHTML = head +
      '<div class="card"><div class="toolbar" style="align-items:center;margin:0">' +
        '<span class="monthpick"><label class="field" for="sa-day">اليوم</label><input type="date" id="sa-day" data-ro-ok value="' + st.day + '"></span>' +
        '<b>' + dayName(st.day) + '</b>' + (off ? ' <span class="badge pending">' + (attHoliday(st.day) ? 'عطلة' : 'نهاية الأسبوع') + '</span>' : '') +
        '<select id="sa-cat" data-ro-ok style="width:auto">' + copt('', 'كل الفئات') + STAFF_CATS.map(function (c) { return copt(c, c); }).join('') + '</select>' +
        '<span class="st-count" style="margin:0">الوقت الرسمي: ' + H.time_in + ' – ' + H.time_out + '</span>' +
      '</div></div>' +
      '<div class="stats">' + card('حاضرون', n.present, lateN ? 'منهم ' + lateN + ' متأخرون' : 'بلا تأخير') + card('غائبون', n.absent, 'هذا اليوم', n.absent ? 'var(--red)' : '') +
        card('إجازة ومأمورية', n.leave + n.mission, 'إجازة ' + n.leave + ' · مأمورية ' + n.mission) + card('غير مسجَّلين', n.none, 'من ' + list.length + ' موظفًا', n.none ? 'var(--muted)' : '') + '</div>' +
      saInboxHtml() + saScanHtml() +
      '<div class="toolbar" style="align-items:center">' +
        '<button type="button" class="btn" data-saallin data-ro-mgr>الحضور الموحد للجميع' + (H.groups && H.groups.length ? ' (كلٌّ بمجموعته)' : ' (' + H.time_in + ')') + '</button>' +
        '<button type="button" class="btn" data-saallout data-ro-mgr>الانصراف الموحد للجميع' + (H.groups && H.groups.length ? ' (كلٌّ بمجموعته)' : ' (' + H.time_out + ')') + '</button>' +
        '<button type="button" class="btn primary" data-sasave data-ro-mgr' + (dirty && !st.busy ? '' : ' disabled') + '>' + (st.busy ? 'جارٍ الحفظ…' : 'حفظ' + (dirty ? ' (' + dirty + ')' : '')) + '</button>' +
        (dirty ? '<button type="button" class="btn link" data-sacancel data-ro-mgr>تراجع عن غير المحفوظ</button>' : '') + '</div>' +
      '<p class="hint">الحضور والانصراف الموحدان يُطبَّقان على الحاضرين وغير المسجَّلين' + (st.cat ? ' من فئة «' + esc(st.cat) + '»' : '') + ' فقط؛ الغائب والإجازة والمأمورية لا تتغير. ما تعدّله يظهر بخلفية صفراء حتى تحفظ.</p>' +
      '<div class="card">' + (list.length
        ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الموظف</th><th>الحالة</th><th>الحضور</th><th>الانصراف</th><th>تأخير</th><th>انصراف مبكر</th><th>ملاحظة</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">لا يوجد عاملون في «بيانات العاملين».</div>') + '</div>';
    function sheetsCard() { return '<div class="card"><h2>الكشف الشهري</h2><div class="toolbar" style="align-items:center;margin:8px 0 0">' +
        '<span class="monthpick"><label class="field" for="sa-month">الشهر</label><input type="month" id="sa-month" data-ro-ok value="' + st.month + '"></span>' +
        '<b style="margin-inline-start:8px">كشف الحضور:</b><button type="button" class="btn primary" data-sarep="regx" data-ro-ok>Excel</button><button type="button" class="btn primary" data-sarep="regp" data-ro-ok>PDF / طباعة</button>' +
        '<b style="margin-inline-start:8px">الملخص:</b><button type="button" class="btn" data-sarep="xlsx" data-ro-ok>Excel</button><button type="button" class="btn" data-sarep="pdf" data-ro-ok>PDF / طباعة</button></div>' +
        '<h3 style="margin:14px 0 6px">كشف التوقيع اليومي (للتوقيع باليد)</h3><div class="toolbar" style="align-items:center;margin:0">' +
          '<span class="monthpick"><label class="field" for="sg-from">من يوم</label><input type="date" id="sg-from" data-ro-ok value="' + (st.sgFrom || st.day) + '"></span>' +
          '<span class="monthpick"><label class="field" for="sg-to">إلى يوم</label><input type="date" id="sg-to" data-ro-ok value="' + (st.sgTo || st.sgFrom || st.day) + '"></span>' +
          '<label class="check" style="margin:0"><input type="checkbox" id="sg-nomgr" data-ro-ok' + (st.sgNoMgr ? ' checked' : '') + '> بدون المدير</label>' +
          '<label class="check" style="margin:0"><input type="checkbox" id="sg-nosup" data-ro-ok' + (st.sgNoSup ? ' checked' : '') + '> بدون المشرف التربوي</label>' +
          '<label class="check" style="margin:0" title="الكشف نفسه مرقمًا وخانة الاسم فارغة ليكتب الموظفون أسماءهم"><input type="checkbox" id="sg-blank" data-ro-ok' + (st.sgBlank ? ' checked' : '') + '> بدون أسماء (مرقم)</label>' +
          '<input type="number" id="sg-n" min="1" max="200" data-ro-ok placeholder="عدد الصفوف" aria-label="عدد صفوف الكشف المرقم" style="width:8.5em" value="' + esc(st.sgN || '') + '">' +
          '<button type="button" class="btn primary" data-sasign data-ro-ok>طباعة</button></div>' +
        '<p class="hint" style="margin:6px 0 0">ورقة لكل يوم عمل في الفترة (تُتخطى الجمعة والسبت والعطل)، بترتيب الموظفين في هذه الصفحة: الرقم، الاسم، وقت الحضور والتوقيع، وقت الانصراف والتوقيع. «بدون أسماء (مرقم)»: الكشف نفسه وخانة الاسم فارغة، بعدد الموظفين أو بالعدد الذي تكتبه. بلا علامة مائية ولا توقيعات في آخرها.</p>' +
        '<p class="hint" style="margin:8px 0 0"><b>كشف الحضور</b> مثل كشف الطلاب: اسم كل موظف وعمود لكل يوم من الشهر؛ + حاضر، L إجازة، غ غائب، م مأمورية، وتظليل الجمعة والسبت والعطل والإجازات. ' +
          '<b>الملخص</b>: لكل موظف أيام الحضور والغياب والإجازة والمأمورية، والتأخير والانصراف المبكر بالدقائق.</p></div>'; }
  }

  /* ----- كشف التوقيع اليومي، وكشفا العاملين -----
     المدير والمشرف التربوي يُعرفان من المسمى الوظيفي (مدير / مشرف) */
  function isMgrJob(t) { return /مدير/.test(norm(t.job_title || '')); }
  function isSupJob(t) { return /مشرف|اشراف/.test(norm(t.job_title || '')); }
  var pendingSign = null, pendingStList = null;
  app.addEventListener('input', function (e) {
    if (e.target.id !== 'st-q' || location.hash !== '#/staff') return;
    var pos = e.target.selectionStart;
    ui.staffQ = e.target.value;
    render();
    var q = document.getElementById('st-q');
    if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} }
  });

  function buildSignSheet(q) {
    sheet.className = 'ps sign-sheet';
    sheet.removeAttribute('data-fit');
    sheet.innerHTML = q.days.map(function (day, i) {
      var list = saStaff('', day).filter(function (t) { return !(q.noMgr && isMgrJob(t)) && !(q.noSup && isSupJob(t)); });
      var blankN = q.blank ? Math.max(1, Math.min(200, parseInt(q.rows, 10) || list.length || 1)) : 0;
      var h = Math.max(6, Math.min(12, Math.floor(212 / ((q.blank ? blankN : list.length) + 1))));
      return '<section style="' + (i < q.days.length - 1 ? 'break-after:page;page-break-after:always;' : '') + (i ? 'padding-top:var(--pad-y, 12mm);' : '') + '">' + letterhead() +
        '<div class="rt"><h1>كشف حضور وانصراف الموظفين</h1><div class="rt-info"><span><b>اليوم:</b> ' + esc(dayName(day)) + '</span><span><b>التاريخ:</b> ' + dmy(day) + '</span></div></div>' +
        '<table class="rk sg-table"><thead><tr><th style="width:6%">الرقم</th><th style="width:36%">اسم الموظف</th><th style="width:12%">وقت الحضور</th><th style="width:17%">التوقيع</th><th style="width:12%">وقت الانصراف</th><th style="width:17%">التوقيع</th></tr></thead><tbody>' +
        (q.blank ? new Array(blankN).join(',').split(',').map(function (x, j) { return '<tr style="height:' + h + 'mm"><td class="c">' + (j + 1) + '</td><td></td><td></td><td></td><td></td><td></td></tr>'; })
          : list.map(function (t, j) { return '<tr style="height:' + h + 'mm"><td class="c">' + (j + 1) + '</td><td style="white-space:nowrap"><b>' + esc(t.name) + '</b></td><td></td><td></td><td></td><td></td></tr>'; })).join('') +
        '</tbody></table></section>';
    }).join('');
  }
  function buildStaffListSheet(q) {
    // من انتهى عقده (استقال أو غادر) لا يُطبع في كشف العاملين الحاليين؛ يبقى في شاشة بيانات العاملين بتاريخ انتهاء عقده
    var list = saStaff('', todayISO()).filter(function (t) { return (!q.cat || staffCat(t) === q.cat) && !(q.noMgr && isMgrJob(t)) && !(q.noSup && isSupJob(t)); }).sort(function (a, b) {
      return STAFF_CATS.indexOf(staffCat(a)) - STAFF_CATS.indexOf(staffCat(b)) || a.name.localeCompare(b.name, 'ar');
    });
    var teach = q.kind === 'teach', n = teach ? 5 : 4;
    var head = reportHead(teach ? 'بيانات العاملين' : 'كشف العاملين', [['الفئة', q.cat || 'كل العاملين'], ['العدد', list.length]]).replace(/^<img class="wm"[^>]*>/, '');
    var body = list.map(function (t, i) {
      var subj = splitList(t.subject).join(' و');
      return '<tr><td class="c">' + (i + 1) + '</td><td style="white-space:nowrap"><b>' + esc(t.name) + '</b></td>' +
        (teach ? '<td>' + esc(subj || t.job_title || '') + '</td><td class="c" dir="ltr">' + esc(t.phone || '') + '</td><td class="c" dir="ltr">' + esc(t.whatsapp || t.phone || '') + '</td>'
          : '<td>' + esc(t.job_title || staffCat(t)) + '</td><td class="c" dir="ltr">' + esc(t.phone || t.whatsapp || '') + '</td>') + '</tr>';
    }).join('');
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
      '<table class="rz"><thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>' +
      '<tr><th>الرقم</th><th>الاسم</th>' + (teach ? '<th>المبحث / المباحث</th><th>رقم الجوال</th><th>رقم الواتساب</th>' : '<th>الوظيفة</th><th>رقم الاتصال</th>') + '</tr></thead>' +
      '<tbody>' + body + '</tbody><tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>';
  }
  document.addEventListener('click', function (e) {
    var el;
    if (location.hash === '#/staffatt' && canView() && e.target.closest('[data-sasign]')) {
      var st = saState(), from = document.getElementById('sg-from').value, to = document.getElementById('sg-to').value || from;
      st.sgFrom = from; st.sgTo = to; st.sgNoMgr = document.getElementById('sg-nomgr').checked; st.sgNoSup = document.getElementById('sg-nosup').checked;
      st.sgBlank = document.getElementById('sg-blank').checked; st.sgN = document.getElementById('sg-n').value;
      if (!from || to < from) return toast('اختر فترة صحيحة', true);
      var days = [];
      for (var d = from; d <= to && days.length < 62; d = addDays(d, 1)) if (!attOff(d)) days.push(d);
      if (!days.length) return toast('لا أيام عمل في هذه الفترة', true);
      pendingSign = { days: days, noMgr: st.sgNoMgr, noSup: st.sgNoSup, blank: st.sgBlank, rows: st.sgN };
      return printNow();
    }
    if (location.hash === '#/staff' && (canView() || isSup()) && (el = e.target.closest('[data-stlist]'))) {
      ui.stlNoMgr = !document.getElementById('stl-mgr').checked; ui.stlNoSup = !document.getElementById('stl-sup').checked;
      pendingStList = { kind: el.getAttribute('data-stlist'), cat: ui.staffCat || '', noMgr: ui.stlNoMgr, noSup: ui.stlNoSup };
      return printNow();
    }
  });

