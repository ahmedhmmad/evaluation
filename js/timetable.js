'use strict';
  /* ---------- حصص الاحتياط ----------
     يُسجَّل غياب المعلم ليوم (كله أو حصص منه)، فتظهر حصصه في ذلك اليوم من الجدول، ولكل حصة يُقترح بديل:
     معلم ليس عنده حصة في الوقت نفسه ولا احتياط آخر، والأولوية لمن هو في المدرسة ذلك اليوم، ثم الأقل احتياطًا اليوم وفي الشهر،
     ثم من يدرّس الشعبة نفسها أو المادة نفسها، ثم الأخف يومًا. «توزيع تلقائي» يملأ الحصص الفارغة بالترتيب نفسه (supabase/substitutes.sql) */
  var WEEK_FULL = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  function subState() {
    if (!ui.sub) {
      // اليوم، وإن لم يكن يوم دراسة فأول يوم دراسة بعده
      var d = new Date(), days = ttCfg().days;
      for (var i = 0; i < 7 && days.indexOf(WEEK_FULL[d.getDay()]) < 0; i++) d.setDate(d.getDate() + 1);
      ui.sub = { day: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), add: '', periods: {}, reason: '' };
    }
    return ui.sub;
  }
  function subDayIdx(day) { return ttCfg().days.indexOf(WEEK_FULL[new Date(day + 'T00:00').getDay()]); }

  // غياب المعلمين واحتياط شهر اليوم المختار
  var loadingSubs = false;
  async function loadSubs(month) {
    if (loadingSubs) return;
    loadingSubs = true;
    var from = month + '-01', to = addDays(shiftMonth(month, 1) + '-01', -1);
    var a = await fetchAll(function () { return sb.from('teacher_absences').select('*').gte('day', from).lte('day', to).order('day').order('teacher_id'); });
    var s = a ? await fetchAll(function () { return sb.from('substitutions').select('*').gte('day', from).lte('day', to).order('day').order('period'); }) : null;
    // من سُجّل في «دوام الموظفين» غائبًا أو في إجازة أو مأمورية (إن وُجد جدوله): يُقترح تسجيله هنا
    var off = a ? await fetchAll(function () { return sb.from('staff_attendance').select('teacher_id, day, status, note').gte('day', from).lte('day', to).neq('status', 'present').order('day').order('teacher_id'); }) : null;
    loadingSubs = false;
    S.subs = { month: month, missing: !a || !s, abs: a || [], subs: s || [], staffOff: off || [] };
    render();
  }

  // حصص المعلم الغائب في اليوم المختار (بحسب الحصص التي يغيبها)
  function subLessons(day) {
    var di = subDayIdx(day), out = [];
    if (di < 0) return out;
    S.subs.abs.filter(function (a) { return a.day === day; }).forEach(function (a) {
      ttLive().forEach(function (s) {
        if (s.teacher_id !== a.teacher_id || s.day !== di) return;
        if (a.periods && a.periods.length && a.periods.indexOf(s.period) < 0) return;
        out.push({ s: s, a: a, rec: S.subs.subs.filter(function (r) { return r.day === day && r.class_name === s.class_name && r.period === s.period; })[0] || null });
      });
    });
    return out.sort(function (x, y) { return x.s.period - y.s.period || classRank(x.s.class_name) - classRank(y.s.class_name); });
  }

  // البدلاء المحتملون لحصة، مرتبين. taken: { 'teacherId|period': 1 } لما وُزّع ولم يُحفظ بعد (التوزيع التلقائي)
  function subCandidates(day, s, taken, extra) {
    var di = subDayIdx(day), month = day.slice(0, 7);
    var absent = {};
    S.subs.abs.forEach(function (a) { if (a.day === day) absent[a.teacher_id] = a.periods && a.periods.length ? a.periods : true; });
    var busySub = {}, today = {}, inMonth = {};
    S.subs.subs.forEach(function (r) {
      if (!r.sub_teacher_id) return;
      if (r.day === day) { busySub[r.sub_teacher_id + '|' + r.period] = r; today[r.sub_teacher_id] = (today[r.sub_teacher_id] || 0) + 1; }
      if (r.day.slice(0, 7) === month) inMonth[r.sub_teacher_id] = (inMonth[r.sub_teacher_id] || 0) + 1;
    });
    Object.keys(extra || {}).forEach(function (id) { today[id] = (today[id] || 0) + extra[id]; inMonth[id] = (inMonth[id] || 0) + extra[id]; });
    var live = ttLive();
    return S.teachers.map(function (t) {
      if (t.id === s.teacher_id || !realStaff(t)) return null;
      var ab = absent[t.id];
      if (ab === true || (ab && ab.indexOf(s.period) > -1)) return null;
      var mine = live.filter(function (x) { return x.teacher_id === t.id && x.day === di; });
      if (mine.some(function (x) { return x.period === s.period; })) return null;
      var other = busySub[t.id + '|' + s.period];
      if (other && !(other.class_name === s.class_name && other.period === s.period)) return null;
      if (taken && taken[t.id + '|' + s.period]) return null;
      var everyLesson = live.filter(function (x) { return x.teacher_id === t.id; });
      if (!everyLesson.length) return null; // ليس من معلمي الجدول
      return { t: t, onSite: mine.length > 0, quran: ttIsQuranT(t), today: today[t.id] || 0, month: inMonth[t.id] || 0,
        cls: everyLesson.some(function (x) { return x.class_name === s.class_name; }), subj: everyLesson.some(function (x) { return norm(ttFixSubject(x.subject)) === norm(ttFixSubject(s.subject)); }),
        load: mine.length };
    }).filter(Boolean).sort(function (a, b) {
      return (b.onSite - a.onSite) || (a.quran - b.quran) || (a.today - b.today) || (a.month - b.month) || (b.cls - a.cls) || (b.subj - a.subj) || (a.load - b.load) || a.t.name.localeCompare(b.t.name, 'ar');
    });
  }

  function subWhy(c) {
    var w = [];
    if (!c.onSite) w.push('ليس عنده حصص هذا اليوم');
    if (c.cls) w.push('يدرّس الشعبة');
    if (c.subj) w.push('نفس المادة');
    w.push('احتياط اليوم ' + c.today + ' · الشهر ' + c.month);
    return w.join(' · ');
  }

  function ttSubsHtml() {
    var st = subState(), month = st.day.slice(0, 7), edit = canEditTT();
    if (!S.subs || S.subs.month !== month) { loadSubs(month); return '<div class="card empty">جارٍ التحميل…</div>'; }
    if (S.subs.missing) return '<div class="card empty">حصص الاحتياط تحتاج إلى جدولين جديدين في قاعدة البيانات.<br>شغّل الملف <code dir="ltr">supabase/substitutes.sql</code> في محرر SQL ثم حدّث الصفحة.</div>';
    var di = subDayIdx(st.day), absToday = S.subs.abs.filter(function (a) { return a.day === st.day; });
    var head = '<div class="card"><div class="toolbar" style="align-items:center;margin:0">' +
      '<span class="monthpick"><label class="field" for="sub-day">اليوم</label><input type="date" id="sub-day" data-ro-ok value="' + st.day + '"></span>' +
      '<b>' + dayName(st.day) + '</b>' + (di < 0 ? ' <span class="badge pending">ليس يوم دراسة في الجدول</span>' : '') + '</div></div>';
    if (di < 0) return head;

    // تسجيل غياب معلم
    var absentIds = absToday.map(function (a) { return a.teacher_id; });
    var addCard = '';
    if (edit) {
      var tOpts = ttTeachers().filter(function (t) { return absentIds.indexOf(t.id) < 0; });
      var mine = st.add ? ttLive().filter(function (x) { return x.teacher_id === st.add && x.day === di; }).sort(function (a, b) { return a.period - b.period; }) : [];
      addCard = '<div class="card"><h2>تسجيل غياب معلم</h2><div class="toolbar" style="align-items:center">' +
        '<select id="sub-add" style="width:auto;min-width:220px"><option value="">— اختر المعلم —</option>' + tOpts.map(function (t) { return '<option value="' + t.id + '"' + (st.add === t.id ? ' selected' : '') + '>' + esc(ttName(t)) + '</option>'; }).join('') + '</select>' +
        '<input type="text" id="sub-reason" placeholder="السبب (اختياري)" value="' + esc(st.reason) + '" style="max-width:220px">' +
        '<button type="button" class="btn primary" data-subadd' + (st.add ? '' : ' disabled') + '>تسجيل الغياب</button></div>' +
        (st.add ? (mine.length
          ? '<div class="toolbar" style="align-items:center;margin-top:8px"><span class="hint" style="margin:0">يغيب عن:</span>' +
              '<label class="check"><input type="checkbox" id="sub-all"' + (Object.keys(st.periods).length ? '' : ' checked') + '>اليوم كله</label>' +
              mine.map(function (x) { return '<label class="check"><input type="checkbox" data-subp="' + x.period + '"' + (st.periods[x.period] ? ' checked' : '') + '>الحصة ' + x.period + ' (' + esc(x.class_name) + ')</label>'; }).join('') + '</div>'
          : '<p class="hint" style="margin:8px 0 0">ليس لهذا المعلم حصص في هذا اليوم.</p>') : '') + '</div>';
    }

    var absCard = '<div class="card"><h2>المعلمون الغائبون — ' + dayName(st.day) + ' ' + dmy(st.day) + '</h2>' + (absToday.length
      ? '<ul style="margin:0;padding-inline-start:18px">' + absToday.map(function (a) {
          var t = find(a.teacher_id);
          return '<li style="margin:4px 0"><b>' + esc(t ? ttName(t) : 'معلم محذوف') + '</b> — ' + (a.periods && a.periods.length ? 'الحصص ' + a.periods.join('، ') : 'اليوم كله') +
            (a.reason ? ' · ' + esc(a.reason) : '') + (edit ? ' <button type="button" class="btn link" data-subdel="' + a.id + '">إلغاء الغياب</button>' : '') + '</li>';
        }).join('') + '</ul>'
      : '<p class="hint" style="margin:0">لم يُسجَّل غياب معلم في هذا اليوم.</p>') +
      // مقترحات من «دوام الموظفين»: معلم غائب أو في إجازة أو مأمورية وله حصص هذا اليوم ولم يُسجَّل هنا
      (function () {
        var sug = (S.subs.staffOff || []).filter(function (r) {
          return r.day === st.day && absentIds.indexOf(r.teacher_id) < 0 && ttLive().some(function (x) { return x.teacher_id === r.teacher_id && x.day === di; });
        });
        if (!sug.length) return '';
        return '<div class="formhint" style="margin-top:10px"><b>غائبون في «دوام الموظفين» ولم يُسجَّلوا هنا:</b><ul style="margin:6px 0 0;padding-inline-start:18px">' + sug.map(function (r) {
          var t = find(r.teacher_id);
          return '<li style="margin:4px 0">' + esc(t ? ttName(t) : 'معلم') + ' — ' + SA_STATUS[r.status] + (r.note ? ' · ' + esc(r.note) : '') +
            (edit ? ' <button type="button" class="btn link" data-subfromsa="' + r.teacher_id + '">تسجيل غيابه هنا</button>' : '') + '</li>';
        }).join('') + '</ul></div>';
      })() + '</div>';

    var ls = subLessons(st.day), open = ls.filter(function (l) { return !(l.rec && l.rec.sub_teacher_id); }).length;
    var rows = ls.map(function (l) {
      var s = l.s, t = ttTimeFor(s.class_name, s.period), cur = l.rec && l.rec.sub_teacher_id, cands = subCandidates(st.day, s);
      if (cur && !cands.some(function (c) { return c.t.id === cur; })) { var ct = find(cur); if (ct) cands.unshift({ t: ct, onSite: true, today: 0, month: 0, cls: false, subj: false, load: 0, forced: true }); }
      var sel = edit
        ? '<select data-subpick="' + esc(s.class_name) + '|' + s.period + '" style="width:auto;max-width:260px"><option value="">— بلا بديل بعد —</option>' +
            cands.map(function (c, i) { return '<option value="' + c.t.id + '"' + (cur === c.t.id ? ' selected' : '') + '>' + (i === 0 && !cur ? '★ ' : '') + esc(ttName(c.t)) + (c.forced ? '' : ' (' + c.month + ')') + '</option>'; }).join('') + '</select>' +
            (cands[0] && !cur ? '<div class="hint" style="margin:2px 0 0">المقترح: ' + esc(ttName(cands[0].t)) + ' — ' + esc(subWhy(cands[0])) + '</div>' : '')
        : esc(cur ? ttTName(cur) : '—');
      return '<tr><td style="white-space:nowrap"><b>' + (TT_ORD[s.period - 1] || s.period) + '</b>' + (t ? '<div class="hint" style="margin:0">' + ttRange(t[0], t[1]) + '</div>' : '') + '</td>' +
        '<td>' + esc(s.class_name) + '</td><td>' + esc(ttFixSubject(s.subject) || '—') + '</td><td>' + esc(ttTName(s.teacher_id)) + '</td>' +
        '<td>' + sel + '</td></tr>';
    }).join('');
    var lessonsCard = '<div class="card"><div class="toolbar" style="align-items:center;margin:0 0 8px"><h2 style="margin:0;flex:1">حصص تحتاج احتياطًا (' + ls.length + ')' + (open ? ' — بلا بديل: ' + open : '') + '</h2>' +
      (edit && open ? '<button type="button" class="btn primary" data-subauto>توزيع تلقائي (' + open + ')</button>' : '') +
      (ls.length ? '<button type="button" class="btn" data-subprint data-ro-ok>طباعة ورقة الاحتياط</button>' : '') + '</div>' +
      (ls.length
        ? '<div class="table-wrap"><table class="grid"><thead><tr><th>الحصة</th><th>الشعبة</th><th>المادة</th><th>المعلم الغائب</th><th>معلم الاحتياط <span class="hint" style="margin:0">(احتياطه هذا الشهر)</span></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<p class="hint" style="margin:0">' + (absToday.length ? 'لا حصص في الجدول للمعلمين الغائبين في هذا اليوم.' : 'سجّل غياب المعلم أولًا لتظهر حصصه هنا.') + '</p>') + '</div>';

    // إحصاء الشهر: من غطّى كم حصة، ومن غاب كم يومًا
    var cnt = {}, absCnt = {};
    S.subs.subs.forEach(function (r) { if (r.sub_teacher_id) cnt[r.sub_teacher_id] = (cnt[r.sub_teacher_id] || 0) + 1; });
    S.subs.abs.forEach(function (a) { absCnt[a.teacher_id] = (absCnt[a.teacher_id] || 0) + 1; });
    var ids = Object.keys(cnt).concat(Object.keys(absCnt).filter(function (k) { return !cnt[k]; }));
    var statCard = '<div class="card"><h2>إحصاء ' + monthLabel(month) + '</h2>' + (ids.length
      ? '<div class="table-wrap"><table class="grid"><thead><tr><th>المعلم</th><th>حصص احتياط غطّاها</th><th>أيام غياب</th></tr></thead><tbody>' +
          ids.map(function (k) { return { id: k, n: cnt[k] || 0 }; }).sort(function (a, b) { return b.n - a.n; }).map(function (r) {
            return '<tr><td>' + esc(ttTName(r.id)) + '</td><td class="c"><b>' + r.n + '</b></td><td class="c">' + (absCnt[r.id] || 0) + '</td></tr>';
          }).join('') + '</tbody></table></div>'
      : '<p class="hint" style="margin:0">لا احتياط ولا غياب مسجّل هذا الشهر.</p>') + '</div>';

    return head + addCard + absCard + lessonsCard + statCard;
  }

  async function subSave(day, s, teacherId) {
    var rec = { day: day, period: s.period, class_name: s.class_name, subject: ttFixSubject(s.subject) || '', absent_teacher_id: s.teacher_id,
      sub_teacher_id: teacherId || null, created_by: (S.profile && S.profile.full_name) || displayName(S.email) };
    return sb.from('substitutions').upsert(rec, { onConflict: 'day,class_name,period' });
  }

  async function subAddAbsence() {
    var st = subState();
    if (!st.add) return;
    var periods = Object.keys(st.periods).map(Number).sort(function (a, b) { return a - b; });
    var r = await sb.from('teacher_absences').insert({ day: st.day, teacher_id: st.add, periods: periods.length ? periods : null, reason: st.reason.trim(),
      created_by: (S.profile && S.profile.full_name) || displayName(S.email) });
    if (r.error) return fail(r.error);
    st.add = ''; st.periods = {}; st.reason = '';
    S.subs = null;
    render();
    toast('سُجّل الغياب؛ اختر البدلاء أو اضغط «توزيع تلقائي»');
  }

  async function subDelAbsence(id) {
    var a = S.subs.abs.filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    var t = find(a.teacher_id);
    var mineSubs = S.subs.subs.filter(function (r) { return r.day === a.day && r.absent_teacher_id === a.teacher_id; });
    if (!confirm('إلغاء غياب ' + (t ? ttName(t) : 'المعلم') + ' في ' + dmy(a.day) + '؟' + (mineSubs.length ? '\nتُحذف معه حصص الاحتياط الموزعة عنه (' + mineSubs.length + ').' : ''))) return;
    if (mineSubs.length) {
      var d = await sb.from('substitutions').delete().eq('day', a.day).eq('absent_teacher_id', a.teacher_id);
      if (d.error) return fail(d.error);
    }
    var r = await sb.from('teacher_absences').delete().eq('id', id);
    if (r.error) return fail(r.error);
    S.subs = null;
    render();
  }

  async function subAuto() {
    var st = subState(), ls = subLessons(st.day).filter(function (l) { return !(l.rec && l.rec.sub_teacher_id); });
    var taken = {}, extra = {}, plan = [];
    ls.forEach(function (l) {
      var c = subCandidates(st.day, l.s, taken, extra)[0];
      if (!c) return;
      taken[c.t.id + '|' + l.s.period] = 1;
      extra[c.t.id] = (extra[c.t.id] || 0) + 1;
      plan.push({ s: l.s, t: c.t });
    });
    if (!plan.length) return toast('لا يوجد معلم متاح لهذه الحصص', true);
    var nLessons = function (n) { return n + (n > 2 && n <= 10 ? ' حصص' : ' حصة'); };
    if (!confirm('توزيع ' + nLessons(plan.length) + ' احتياط:\n\n' + plan.map(function (p) { return 'الحصة ' + p.s.period + ' · ' + p.s.class_name + ' ← ' + ttName(p.t); }).join('\n') +
      (plan.length < ls.length ? '\n\nتبقى ' + (ls.length - plan.length) + ' بلا بديل متاح.' : ''))) return;
    for (var i = 0; i < plan.length; i++) {
      var r = await subSave(st.day, plan[i].s, plan[i].t.id);
      if (r.error) { S.subs = null; render(); return fail(r.error); }
    }
    S.subs = null;
    render();
    toast('وُزّعت ' + nLessons(plan.length) + ' احتياط');
  }

  // ورقة الاحتياط اليومية: صفحة واحدة، وخانة توقيع لكل معلم بديل
  var pendingSubs = null;
  function buildSubsSheet(day) {
    var ls = subLessons(day), n = 7;
    var head = reportHead('حصص الاحتياط', [['اليوم', dayName(day) + ' ' + dmy(day)], ['عدد الحصص', ls.length]]).replace(/^<img class="wm"[^>]*>/, '');
    var absList = S.subs.abs.filter(function (a) { return a.day === day; }).map(function (a) {
      return ttTName(a.teacher_id) + (a.periods && a.periods.length ? ' (الحصص ' + a.periods.join('، ') + ')' : '');
    });
    var c = function (v, b) { return '<td class="c" style="white-space:nowrap">' + (b ? '<b>' + v + '</b>' : v) + '</td>'; };
    var body = ls.map(function (l, i) {
      var s = l.s, t = ttTimeFor(s.class_name, s.period), sub = l.rec && l.rec.sub_teacher_id;
      return '<tr>' + c(i + 1) + c((TT_ORD[s.period - 1] || s.period) + (t ? '<br><small>' + ttRange(t[0], t[1]) + '</small>' : ''), true) + c(esc(s.class_name)) +
        '<td>' + esc(ttFixSubject(s.subject) || '—') + '</td><td>' + esc(ttTName(s.teacher_id)) + '</td><td><b>' + esc(sub ? ttTName(sub) : '') + '</b></td><td style="min-width:7em"></td></tr>';
    }).join('');
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
      '<table class="rz"><thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>' +
      '<tr><th>م</th><th>الحصة</th><th>الشعبة</th><th>المادة</th><th>المعلم الغائب</th><th>معلم الاحتياط</th><th>توقيع المعلم</th></tr></thead>' +
      '<tbody>' + body + '</tbody><tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>' +
      (absList.length ? '<p style="font-size:.9em;margin:.6em 0 0"><b>المعلمون الغائبون:</b> ' + esc(absList.join('، ')) + '</p>' : '') +
      reportSigns([['المشرف التربوي', ''], ['مدير الأكاديمية', principalName()]]);
  }

  document.addEventListener('click', function (e) {
    if (location.hash !== '#/timetable/subs') return;
    var el;
    if (e.target.closest('[data-subprint]')) { pendingSubs = subState().day; return printNow(); }
    if (!canEditTT()) return;
    if ((el = e.target.closest('[data-subfromsa]'))) {
      var sr = (S.subs.staffOff || []).filter(function (r) { return r.teacher_id === el.getAttribute('data-subfromsa') && r.day === subState().day; })[0];
      if (!sr) return;
      return sb.from('teacher_absences').insert({ day: sr.day, teacher_id: sr.teacher_id, periods: null, reason: SA_STATUS[sr.status] + (sr.note ? ' — ' + sr.note : ''),
        created_by: (S.profile && S.profile.full_name) || displayName(S.email) }).then(function (r) {
        if (r.error) return fail(r.error);
        S.subs = null;
        render();
        toast('سُجّل الغياب؛ اختر البدلاء أو اضغط «توزيع تلقائي»');
      });
    }
    if (e.target.closest('[data-subadd]')) subAddAbsence();
    else if ((el = e.target.closest('[data-subdel]'))) subDelAbsence(el.getAttribute('data-subdel'));
    else if (e.target.closest('[data-subauto]')) subAuto();
  });
  document.addEventListener('change', async function (e) {
    if (location.hash !== '#/timetable/subs') return;
    var st = subState(), el = e.target;
    if (el.id === 'sub-day') { if (el.value) { st.day = el.value; st.add = ''; st.periods = {}; render(); } return; }
    if (!canEditTT()) return;
    if (el.id === 'sub-add') { st.add = el.value; st.periods = {}; render(); }
    else if (el.id === 'sub-reason') st.reason = el.value;
    else if (el.id === 'sub-all') { st.periods = {}; render(); }
    else if (el.hasAttribute('data-subp')) { var p = el.getAttribute('data-subp'); if (el.checked) st.periods[p] = 1; else delete st.periods[p]; render(); }
    else if (el.hasAttribute('data-subpick')) {
      var q = el.getAttribute('data-subpick').split('|'), per = +q.pop(), cls = q.join('|');
      var l = subLessons(st.day).filter(function (x) { return x.s.class_name === cls && x.s.period === per; })[0];
      if (!l) return;
      var r = await subSave(st.day, l.s, el.value);
      if (r.error) return fail(r.error);
      S.subs = null;
      render();
    }
  });

  function renderTimetable() {
    if (S.ttMissing) {
      app.innerHTML = tabs('timetable') + '<div class="card empty">لم تُجهَّز قاعدة البيانات لجدول الحصص بعد.<br>' +
        'شغّل الملف <code dir="ltr">supabase/timetable.sql</code> في محرر SQL ثم حدّث الصفحة.</div>';
      return;
    }
    var view = ttView(), cf = ttConflicts(), body;
    if (view === 'import' && !canEditTT()) return go('#/timetable');
    if (view === 'mine') body = ttMineHtml(cf);
    else if (view === 'import') body = ttImportHtml();
    else if (view === 'bells') body = ttBellsHtml();
    else if (view === 'breaks') body = ttBreakHtml();
    else if (view === 'quota') body = ttQuotaHtml();
    else if (view === 'improve') body = ttImproveHtml();
    else if (view === 'subs') body = ttSubsHtml();
    else if (view === 'review') body = ttReviewHtml(cf);
    else if (view === 'teachers') body = ttTeacherHtml(cf);
    else body = ttClassHtml(cf);
    var empty = !S.ttSessions.length && !/^(import|bells|quota)$/.test(view)
      ? '<div class="card empty">لا توجد حصص بعد.' + (canEditTT() ? ' استوردها من ملف الجدول من «استيراد من ملف»، أو أضفها بالضغط على خانات الجدول.' : '') + '</div>' : '';
    app.innerHTML = tabs('timetable') + (view === 'mine' ? '' : ttNav(view, cf)) + empty + ttEditorHtml() + body +
      (/^(import|review|quota|improve|subs)$/.test(view) ? '' : ttPrintBar(view));
  }

  /* ----- الشبكة ----- */
  function ttPicker(kind, items, cur, cf) {
    return '<div class="tt-picker" role="group" aria-label="' + (kind === 't' ? 'المعلمون' : 'الصفوف') + '">' + items.map(function (x) {
      var id = kind === 't' ? x.id : x, label = kind === 't' ? ttName(x) : x;
      var bad = S.ttSessions.some(function (s) {
        return s.status !== 'removed' && (kind === 't' ? s.teacher_id === id : s.class_name === id) && (cf.ids[s.id] || s.status === 'review');
      });
      return '<button type="button" data-ttpick="' + kind + '" data-id="' + esc(id) + '" data-ro-ok aria-pressed="' + (id === cur) + '"' + (id === cur ? ' class="on"' : '') + '>' +
        esc(label) + (bad ? '<span class="warn" title="فيه ما يحتاج مراجعة">•</span>' : '') + '</button>';
    }).join('') + '</div>';
  }

  // شبكة أيام × حصص. mode: 'c' جدول شعبة (المادة والمعلم)، 't' جدول معلم (الشعبة والمادة)، 'mine' جدول المعلم صاحب الحساب
  function ttGridHtml(mine, mode, cls, cf) {
    var cfg = ttCfg(), NP = ttPeriods(), edit = canEditTT() && mode !== 'mine';
    var h = '<div class="table-wrap"><table class="tt-grid"><thead><tr><th class="corner">اليوم</th>';
    for (var p = 1; p <= NP; p++) h += '<th>الحصة ' + p + '<small>' + esc(ttHeadTime(cls, p)) + '</small></th>';
    h += '</tr></thead><tbody>';
    cfg.days.forEach(function (dn, d) {
      h += '<tr><th>' + esc(dn) + '</th>';
      for (var q = 1; q <= NP; q++) {
        var list = mine.filter(function (s) { return s.day === d && s.period === q; });
        h += '<td>' + ttCellHtml(list, d, q, mode, cf, edit) + '</td>';
      }
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  function ttCellHtml(list, d, p, mode, cf, edit) {
    if (!list.length) {
      return edit ? '<button type="button" class="tt-cell empty" data-ttnew="' + d + '|' + p + '" aria-label="إضافة حصة: ' + esc(ttCfg().days[d]) + '، الحصة ' + p + '">+</button>' : '<div class="tt-cell empty"></div>';
    }
    var isC = list.some(function (s) { return cf.ids[s.id] || ttLessonHard(s); }), isR = list.some(function (s) { return s.status === 'review'; });
    var inner = list.map(function (s) {
      if (mode === 'c') return '<span class="m">' + esc(s.subject) + '</span><span class="s">' + esc(ttShortTName(s.teacher_id)) + '</span>';
      var pt = !ttCommonTime(p) && ttTimeFor(s.class_name, p);
      return '<span class="m">' + esc(s.class_name) + '</span><span class="s">' + esc(s.subject) + '</span>' + (pt ? '<span class="s" style="white-space:nowrap">' + ttRange(pt[0], pt[1]) + '</span>' : '');
    }).join('<hr>');
    var cls = 'tt-cell' + (isC ? ' conflict' : isR ? ' review' : '') + (list.length > 1 ? ' multi' : '');
    var flag = isC ? '<span class="flag">' + (list.some(function (s) { return cf.ids[s.id]; }) ? 'تعارض' : 'يخالف قاعدة') + '</span>' : isR ? '<span class="flag">للتأكيد</span>' : '';
    var note = list.map(function (s) { return s.note; }).filter(Boolean).join(' · ');
    var title = note ? ' title="' + esc(note) + '"' : '';
    return edit ? '<button type="button" class="' + cls + '" data-ttopen="' + list[0].id + '"' + title + '>' + flag + inner + '</button>' : '<div class="' + cls + '"' + title + '>' + flag + inner + '</div>';
  }

  function ttStat(n, label) { return '<div><b>' + n + '</b><span>' + label + '</span></div>'; }

  function ttSubjects(mine) {
    var c = {};
    mine.forEach(function (s) { c[s.subject] = (c[s.subject] || 0) + 1; });
    var keys = Object.keys(c).sort(function (a, b) { return c[b] - c[a] || a.localeCompare(b, 'ar'); });
    return keys.length ? '<div class="tt-subjects">' + keys.map(function (k) { return '<span>' + esc(k) + ': ' + c[k] + '</span>'; }).join('') + '</div>' : '';
  }

  function ttLegend() {
    return '<div class="tt-legend"><span><i class="r"></i>حصة تحتاج تأكيدًا</span><span><i class="c"></i>تعارض: الصف أو المعلم في حصتين بنفس الوقت</span>' +
      (canEditTT() ? '<span>اضغط أي خانة للتعديل، أو خانة فارغة للإضافة</span>' : '') + '</div>';
  }

  function ttTeacherStats(mine) {
    var NP = ttPeriods(), days = {}, first = 0, last = 0;
    mine.forEach(function (s) { days[s.day] = 1; if (s.period === 1) first++; if (s.period === NP) last++; });
    return '<div class="tt-stats">' + ttStat(mine.length, 'حصة أسبوعيًا') + ttStat(Object.keys(days).length, 'أيام دوام') + ttStat(first, 'حصة أولى') + ttStat(last, 'حصة أخيرة') + '</div>';
  }

  function ttClassHtml(cf) {
    var list = ttClasses();
    if (!list.length) return '<div class="card empty">لا توجد شعب في «إعداد الفصول».</div>';
    if (list.indexOf(ui.ttClass) < 0) ui.ttClass = list[0];
    var c = ui.ttClass, mine = ttLive().filter(function (s) { return s.class_name === c; }), st = ttStageOf(c);
    var used = {};
    mine.forEach(function (s) { used[s.day + '|' + s.period] = 1; });
    var free = ttCfg().days.length * ttPeriods() - Object.keys(used).length;
    return '<div class="card">' + ttPicker('c', list, c, cf) +
      '<div class="tt-head"><div><h2>الصف ' + esc(c) + '</h2><p class="hint" style="margin:0">' + (classTeacher(c) ? 'مربي الصف: ' + esc(classTeacher(c)) + ' · ' : '') +
        (st ? 'المواعيد حسب «' + esc(st.name) + '»' : 'لم تُحدَّد مواعيد الدوام بعد') + (classConfig().names.indexOf(c) < 0 ? ' · <b style="color:var(--red)">ليست في «إعداد الفصول»</b>' : '') + '</p></div>' +
        '<div class="tt-stats">' + ttStat(mine.length, 'حصة أسبوعيًا') + ttStat(Math.max(0, free), 'حصة فارغة') + '</div></div>' +
      ttGridHtml(mine, 'c', c, cf) + ttSubjects(mine) + ttLegend() + '</div>';
  }

  function ttTeacherHtml(cf) {
    var list = ttTeachers();
    if (ui.ttTeacher && !list.some(function (t) { return t.id === ui.ttTeacher; }) && find(ui.ttTeacher)) list.push(find(ui.ttTeacher));
    // معلم ليست له حصص بعد: يُختار من القائمة لتُضاف له حصص
    var others = canEditTT() ? ttTeacherChoices().filter(function (t) { return list.indexOf(t) < 0; }) : [];
    var add = others.length ? '<label class="field" for="tt-addteacher" style="margin:8px 0 0">معلم ليست له حصص بعد</label><select id="tt-addteacher" style="width:auto;max-width:320px">' +
      '<option value="">— اختر لعرض جدوله وإضافة حصص —</option>' + others.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('') + '</select>' : '';
    if (!list.length) return '<div class="card">' + (add || '<div class="empty">لا يوجد معلمون في الجدول بعد.</div>') + '</div>';
    if (!list.some(function (t) { return t.id === ui.ttTeacher; })) ui.ttTeacher = list[0].id;
    var t = find(ui.ttTeacher), mine = ttLive().filter(function (s) { return s.teacher_id === t.id; });
    var sub = [t.job_title || t.subject, t.category].filter(Boolean).map(esc).join(' · ');
    var move = canEditTT() && mine.length ? '<details class="bank" style="margin-top:12px"><summary>نقل حصص هذا المعلم إلى سجل آخر في بيانات العاملين</summary>' +
      '<p class="hint" style="margin:8px 0">لمعلم سُجّل مرتين باسمين مختلفين: تنتقل كل حصصه إلى السجل المختار' + (ttDeletable(t) ? '، ويُحذف هذا السجل لأنه بلا حساب ولا تقييم' : '') + '.</p>' +
      '<select id="tt-moveto" style="width:auto;max-width:340px"><option value="">— اختر السجل —</option>' + S.teachers.filter(function (x) { return x.id !== t.id; }).sort(function (a, b) {
        return (ttSameName(b.name, t.name) ? 1 : 0) - (ttSameName(a.name, t.name) ? 1 : 0) || a.name.localeCompare(b.name, 'ar');
      }).map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + (x.category ? ' — ' + esc(x.category) : '') + '</option>'; }).join('') + '</select> ' +
      '<button type="button" class="btn" data-ttmoveto="' + t.id + '">نقل الحصص</button></details>' : '';
    return '<div class="card">' + ttPicker('t', list, t.id, cf) + add +
      '<div class="tt-head" style="margin-top:10px"><div><h2>' + esc(ttName(t)) + '</h2>' + (sub ? '<p class="hint" style="margin:0">' + sub + '</p>' : '') + '</div>' + ttTeacherStats(mine) + '</div>' +
      (function () {
        var sc = ttEvalT(t.id, mine, ttRuleSet(), ttPeriods());
        return sc.notes.length ? '<p class="formhint" style="margin:0 0 10px">حسب قواعد الجدول: ' + sc.notes.map(esc).join('، ') +
          (canEditTT() && !S.ttPlanMissing ? ' — <a href="#/timetable/improve" data-ttimprove="' + t.id + '">ابحث عن تحسين</a>' : '') + '</p>' : '';
      })() +
      ttGridHtml(mine, 't', null, cf) + ttSubjects(mine) + ttLegend() + move + '</div>';
  }

  // «جدولي»: المعلم صاحب الحساب يرى جدوله فقط
  function ttMineHtml(cf) {
    var t = S.profile && S.profile.teacher_id && find(S.profile.teacher_id);
    if (!t) return '<div class="card empty">حسابك غير مربوط بسجل معلم. راجع إدارة الأكاديمية.</div>';
    var mine = ttLive().filter(function (s) { return s.teacher_id === t.id; });
    if (!mine.length) return '<div class="card empty">لا توجد حصص مسجلة لك في جدول الحصص.</div>';
    return '<div class="card"><div class="tt-head"><div><h2>' + esc(ttName(t)) + '</h2></div>' + ttTeacherStats(mine) + '</div>' +
      ttGridHtml(mine, 'mine', null, cf) + ttSubjects(mine) + '</div>' +
      '<div class="card no-print"><div class="toolbar" style="margin:0"><button type="button" class="btn" data-ttprint="t|' + t.id + '" data-ro-ok>طباعة جدولي / PDF</button></div></div>';
  }

  /* ----- تحرير حصة ----- */
  function ttGuessSubject(tid) {
    var c = {}, best = '', n = 0;
    ttLive().forEach(function (s) { if (s.teacher_id === tid) c[s.subject] = (c[s.subject] || 0) + 1; });
    Object.keys(c).forEach(function (k) { if (c[k] > n) { n = c[k]; best = k; } });
    var t = tid && find(tid);
    return best || (t && t.subject && ttCfg().subjects.indexOf(t.subject) > -1 ? t.subject : '') || ttCfg().subjects[0] || '';
  }

  function ttOpenEditor(opts) {
    var s = opts.id ? ttById(opts.id) : null, v = ttView();
    ui.ttEdit = s ? { id: s.id, day: s.day, period: s.period, class_name: s.class_name, teacher_id: s.teacher_id || '', subject: s.subject, status: s.status === 'review' ? 'review' : 'ok', note: s.note || '' }
      : { id: null, day: opts.day, period: opts.period, class_name: v === 'classes' ? ui.ttClass : '', teacher_id: v === 'teachers' ? ui.ttTeacher || '' : '', subject: '', status: 'ok', note: '' };
    if (!ui.ttEdit.subject) ui.ttEdit.subject = ttGuessSubject(ui.ttEdit.teacher_id);
    render();
    var box = document.getElementById('tt-editor');
    if (box) { box.scrollIntoView({ block: 'start', behavior: 'smooth' }); var f = document.getElementById('tte-subject'); if (f) f.focus({ preventScroll: true }); }
  }

  function ttReadEditor() {
    var e = ui.ttEdit, v = function (id) { var el = document.getElementById(id); return el ? el.value : null; };
    if (!e || !document.getElementById('tte-day')) return;
    e.day = Number(v('tte-day'));
    e.period = Number(v('tte-period'));
    e.class_name = v('tte-class');
    e.teacher_id = v('tte-teacher');
    var sub = v('tte-subject');
    if (sub === '__new') { e.newSubject = true; sub = (v('tte-subnew') || '').trim(); } else e.newSubject = false;
    e.subject = sub;
    e.note = (v('tte-note') || '').trim();
    e.status = document.getElementById('tte-review').checked ? 'review' : 'ok';
  }

  function ttClashes(e) {
    var out = ttLessonIssues(e).map(function (x) { return (x.hard ? 'قاعدة ملزمة: ' : 'قاعدة: ') + x.text; });
    ttLive().forEach(function (x) {
      if (x.id === e.id || x.day !== e.day || x.period !== e.period) return;
      if (x.class_name === e.class_name) out.push('الصف ' + x.class_name + ' عنده ' + x.subject + ' مع ' + ttTName(x.teacher_id) + ' في الوقت نفسه');
      else if (e.teacher_id && x.teacher_id === e.teacher_id) out.push(ttTName(x.teacher_id) + ' عنده حصة مع ' + x.class_name + ' في الوقت نفسه');
    });
    return out;
  }

  function ttEditorHtml() {
    var e = ui.ttEdit;
    if (!e || !canEditTT()) return '';
    var cfg = ttCfg(), NP = ttPeriods();
    var opt = function (v, l, cur) { return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(l) + '</option>'; };
    var field = function (id, label, inner) { return '<div><label class="field" for="' + id + '">' + label + '</label>' + inner + '</div>'; };
    var subs = cfg.subjects.slice();
    ttLive().forEach(function (s) { if (s.subject && subs.indexOf(s.subject) < 0) subs.push(s.subject); });
    if (e.subject && !e.newSubject && subs.indexOf(e.subject) < 0) subs.push(e.subject);
    var periods = [];
    for (var p = 1; p <= NP + 1; p++) periods.push(p);
    var t = e.class_name && ttTimeFor(e.class_name, e.period), cl = ttClashes(e);
    // حصص أخرى في الخانة نفسها (تعارض): يُنتقل بينها
    var sib = e.id ? ttLive().filter(function (x) {
      return x.day === e.day && x.period === e.period && (ttView() === 'teachers' ? x.teacher_id === ui.ttTeacher : x.class_name === ui.ttClass);
    }) : [];
    return '<div class="card" id="tt-editor" style="border:2px solid var(--primary)"><h2>' + (e.id ? 'تعديل الحصة' : 'إضافة حصة') + '</h2>' +
      '<p class="hint">' + esc(cfg.days[e.day] || '') + ' · الحصة ' + e.period + (t ? ' · ' + ttRange(t[0], t[1]) : '') + '</p>' +
      (sib.length > 1 ? '<div class="tt-picker">' + sib.map(function (x) { return '<button type="button" data-ttopen="' + x.id + '"' + (x.id === e.id ? ' class="on"' : '') + '>' + esc(x.class_name) + ' · ' + esc(ttTName(x.teacher_id)) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="tt-form">' +
        field('tte-day', 'اليوم', '<select id="tte-day">' + cfg.days.map(function (n, i) { return opt(i, n, e.day); }).join('') + '</select>') +
        field('tte-period', 'الحصة', '<select id="tte-period">' + periods.map(function (q) { var tm = e.class_name && ttTimeFor(e.class_name, q); return opt(q, 'الحصة ' + q + (tm ? ' (' + tm[0] + ')' : ''), e.period); }).join('') + '</select>') +
        field('tte-class', 'الصف', '<select id="tte-class">' + (e.class_name ? '' : opt('', '— اختر —', '')) + ttClasses().map(function (c) { return opt(c, c, e.class_name); }).join('') + '</select>') +
        field('tte-subject', 'المادة', '<select id="tte-subject">' + (e.subject || e.newSubject ? '' : opt('', '— اختر —', '')) + subs.map(function (x) { return opt(x, x, e.newSubject ? '' : e.subject); }).join('') + opt('__new', 'مادة أخرى…', e.newSubject ? '__new' : '') + '</select>' +
          (e.newSubject ? '<input type="text" id="tte-subnew" placeholder="اسم المادة" value="' + esc(e.subject) + '" style="margin-top:6px">' : '')) +
        field('tte-teacher', 'المعلم', '<select id="tte-teacher">' + opt('', 'بدون معلم', e.teacher_id) + ttTeacherChoices(e.teacher_id).map(function (x) { return opt(x.id, ttName(x), e.teacher_id); }).join('') + '</select>') +
        field('tte-note', 'ملاحظة', '<input type="text" id="tte-note" placeholder="اختياري" value="' + esc(e.note) + '">') +
      '</div>' +
      '<label class="check"><input type="checkbox" id="tte-review"' + (e.status === 'review' ? ' checked' : '') + '> تحتاج تأكيدًا</label>' +
      (cl.length ? '<p class="formhint" style="margin-top:6px">' + cl.map(esc).join('<br>') + ' — يمكنك الحفظ، وتظهر في المراجعة.</p>' : '') +
      '<div class="toolbar" style="margin:12px 0 0"><button type="button" class="btn primary" data-ttsave>' + (e.id ? 'حفظ التعديل' : 'إضافة') + '</button><button type="button" class="btn" data-ttcancel>إلغاء</button>' +
        (e.id ? '<span style="flex:1"></span><button type="button" class="btn danger" data-ttremove="' + e.id + '">حذف الحصة</button>' : '') + '</div></div>';
  }

  function ttPut(id, data) {
    for (var i = 0; i < S.ttSessions.length; i++) if (S.ttSessions[i].id === id) { S.ttSessions[i] = Object.assign({}, S.ttSessions[i], data); return; }
    S.ttSessions.push(data);
  }

  async function ttSaveConfig(patch) {
    patch.updated_by = ttWho();
    patch.updated_at = new Date().toISOString();
    var r = await sb.from('timetable_config').update(patch).eq('id', 1);
    if (r.error) { fail(r.error); return false; }
    S.ttConfig = Object.assign({ id: 1 }, S.ttConfig || {}, patch);
    return true;
  }

  async function ttSaveEditor() {
    ttReadEditor();
    var e = ui.ttEdit;
    if (!e.class_name) return toast('اختر الصف', true);
    if (!e.subject) return toast('اختر المادة أو اكتب اسمها', true);
    var row = { day: e.day, period: e.period, class_name: e.class_name, teacher_id: e.teacher_id || null, subject: e.subject, status: e.status, note: e.note,
      updated_by: ttWho(), updated_at: new Date().toISOString() };
    var r = e.id ? await sb.from('timetable_sessions').update(row).eq('id', e.id).select().maybeSingle()
      : await sb.from('timetable_sessions').insert(row).select().single();
    if (r.error) return fail(r.error);
    var added = !e.id;
    if (added) S.ttSessions.push(r.data || row); else ttPut(e.id, r.data || row);
    if (ttCfg().subjects.indexOf(e.subject) < 0) await ttSaveConfig({ subjects: ttCfg().subjects.concat([e.subject]) });
    ui.ttEdit = null;
    render();
    toast(added ? 'أُضيفت الحصة' : 'حُفظ التعديل');
  }

  // تأكيد الحصة، أو حذفها (تبقى «محذوفة» تُستعاد)، أو استعادتها (تعود «تحتاج تأكيدًا» لتُراجع)
  async function ttSetStatus(id, status) {
    var s = ttById(id);
    if (!s) return;
    var patch = { status: status, updated_by: ttWho(), updated_at: new Date().toISOString() };
    var r = await sb.from('timetable_sessions').update(patch).eq('id', id);
    if (r.error) return fail(r.error);
    Object.assign(s, patch);
    if (ui.ttEdit && ui.ttEdit.id === id) ui.ttEdit = null;
    render();
    toast(status === 'removed' ? 'حُذفت الحصة — تُستعاد من «المراجعة»' : status === 'ok' ? 'تم التأكيد' : 'استُعيدت الحصة، وهي تحتاج تأكيدًا');
  }

  /* ----- سجلات معلمين مكررة -----
     الاستيراد قد يضيف سجلًا جديدًا لمعلم له سجل في «بيانات العاملين» باسم مكتوب بشكل آخر. يُقترح هنا كل سجل له حصص
     يشبه اسمه سجلًا واحدًا بلا حصص؛ الدمج ينقل الحصص إلى السجل الأصلي ثم يحذف المكرر إن لم يكن له حساب ولا تقييم ولا زيارات */
  function ttLessonCounts() {
    var n = {};
    S.ttSessions.forEach(function (x) { if (x.teacher_id) n[x.teacher_id] = (n[x.teacher_id] || 0) + 1; });
    return n;
  }
  function ttDupPairs() {
    var n = ttLessonCounts(), pairs = [];
    S.teachers.forEach(function (a) {
      if (!n[a.id]) return;
      var to = S.teachers.filter(function (b) { return b.id !== a.id && !n[b.id] && (norm(b.name) === norm(a.name) || ttSameName(a.name, b.name)); });
      if (to.length === 1) pairs.push({ from: a, to: to[0], n: n[a.id] });
    });
    return pairs;
  }
  // يُحذف السجل بعد نقل حصصه إن كان فارغًا: لا حساب دخول، ولا تقييم بدأ، ولا زيارات
  function ttDeletable(t) {
    return isAdmin() && !t.user_id && !t.login && (!t.status || t.status === 'new') && !(t.ratings && Object.keys(t.ratings).length) &&
      !S.visits.some(function (v) { return v.teacher_id === t.id; });
  }
  async function ttMergeTeacher(fromId, toId) {
    var from = find(fromId), to = find(toId), n = ttLessonCounts()[fromId] || 0;
    if (!from || !to || from === to) return;
    var del = ttDeletable(from);
    if (!confirm('نقل ' + n + ' حصة من «' + from.name + '» إلى سجل «' + to.name + '»' + (del ? '، ثم حذف السجل «' + from.name + '» من بيانات العاملين' : '') + '؟')) return;
    var r = await sb.from('timetable_sessions').update({ teacher_id: toId, updated_by: ttWho(), updated_at: new Date().toISOString() }).eq('teacher_id', fromId);
    if (r.error) return fail(r.error);
    S.ttSessions.forEach(function (x) { if (x.teacher_id === fromId) x.teacher_id = toId; });
    // مسمى الوظيفة والمادة من السجل المكرر يُكملان السجل الأصلي إن كانا فارغين فيه
    var fill = {};
    if (!to.job_title && from.job_title) fill.job_title = from.job_title;
    if (!to.subject && from.subject) fill.subject = from.subject;
    if (Object.keys(fill).length && !(await sb.from('teachers').update(fill).eq('id', toId)).error) Object.assign(to, fill);
    var gone = false;
    if (del) {
      var d = await sb.from('teachers').delete().eq('id', fromId);
      if (!d.error) { S.teachers = S.teachers.filter(function (t) { return t.id !== fromId; }); gone = true; }
    }
    if (ui.ttTeacher === fromId) ui.ttTeacher = toId;
    render();
    toast('نُقلت ' + n + ' حصة إلى «' + to.name + '»' + (gone ? ' وحُذف السجل المكرر' : ' — السجل «' + from.name + '» بقي في بيانات العاملين؛ احذفه منها إن لم يعد له لزوم'));
  }

  /* ----- المراجعة ----- */
  function ttReviewHtml(cf) {
    var days = ttCfg().days, editor = canEditTT();
    var item = function (s, kind) {
      var acts = !editor ? '' : kind === 'review' ? '<button type="button" class="btn" data-ttact="ok" data-id="' + s.id + '">تأكيد</button><button type="button" class="btn" data-ttopen="' + s.id + '">تعديل</button><button type="button" class="btn danger" data-ttact="removed" data-id="' + s.id + '">حذف</button>'
        : kind === 'gone' ? '<button type="button" class="btn" data-ttact="review" data-id="' + s.id + '">استعادة</button>'
        : '<button type="button" class="btn" data-ttopen="' + s.id + '">تعديل</button><button type="button" class="btn danger" data-ttact="removed" data-id="' + s.id + '">حذف هذه</button>';
      return '<div class="tt-item' + (kind === 'bad' ? ' bad' : kind === 'gone' ? ' gone' : '') + '"><span class="when">' + esc(days[s.day] || '') + ' — الحصة ' + s.period + '</span>' +
        '<span class="what"><b>' + esc(s.class_name) + '</b> · ' + esc(s.subject) + ' · ' + esc(ttTName(s.teacher_id)) + (s.note ? '<span class="note">' + esc(s.note) + '</span>' : '') +
          (kind === 'bad' && ttLessonIssues(s).length ? '<span class="note" style="color:var(--red)">' + ttLessonIssues(s).map(function (x) { return esc(x.text); }).join('، ') + '</span>' : '') + '</span>' +
        (acts ? '<span class="acts">' + acts + '</span>' : '') + '</div>';
    };
    var section = function (title, list, kind, emptyText, hint) {
      return '<div class="card"><h2>' + title + ' (' + list.length + ')</h2>' + (hint ? '<p class="hint">' + hint + '</p>' : '') +
        (list.length ? '<div class="tt-items">' + list.map(function (s) { return item(s, kind); }).join('') + '</div>' : '<p class="hint" style="margin:0">' + emptyText + '</p>') + '</div>';
    };
    var bad = [];
    cf.groups.forEach(function (g) { g.list.forEach(function (s) { if (bad.indexOf(s) < 0) bad.push(s); }); });
    var known = classConfig().names, live = ttLive(), pairs = ttDupPairs();
    var dups = !editor || !pairs.length ? '' : '<div class="card" style="border:2px solid var(--amber)"><h2>سجلات معلمين مكررة (' + pairs.length + ')</h2>' +
      '<p class="hint">معلم له حصص يشبه اسمه سجلًا في «بيانات العاملين» ليست له حصص. غالبًا الشخص نفسه مكتوبًا بشكل آخر. الدمج ينقل الحصص إلى سجله في بيانات العاملين' + (isAdmin() ? ' ويحذف المكرر إن لم يكن له حساب ولا تقييم.' : '.') + '</p><div class="tt-items">' +
      pairs.map(function (p) {
        return '<div class="tt-item"><span class="what"><b>' + esc(p.from.name) + '</b> (' + p.n + ' حصة' + (p.from.category ? ' · ' + esc(p.from.category) : '') + ') ← هو نفسه <b>' + esc(p.to.name) + '</b>' + (p.to.category ? ' (' + esc(p.to.category) + ')' : '') + '؟</span>' +
          '<span class="acts"><button type="button" class="btn primary" data-ttmerge="' + p.from.id + '|' + p.to.id + '">دمج</button></span></div>';
      }).join('') + '</div></div>';
    var qd = ttQuotaDiff(), evr = ttEvalAll();
    var pins = live.filter(function (s) { return (evr.bad[s.id] || []).some(function (x) { return x.hard; }); });
    // مخالفات القواعد الملزمة على مستوى المعلم (أيام الدوام، الحصص الأولى والأخيرة) لا ترتبط بحصة واحدة
    var tHard = Object.keys(evr.t).filter(function (t) { return evr.t[t].hard; }).map(function (t) {
      return '<li><b>' + esc(ttTName(t)) + '</b>: ' + evr.t[t].notes.filter(function (n) { return /ملزمة/.test(n); }).map(esc).join('، ') + '</li>';
    }).join('');
    var quota = !qd.length ? '' : '<div class="card"><h2>اختلاف عن النصاب (' + qd.length + ')</h2><p class="hint">عدد حصص المادة في الشعبة في الجدول غير ما في «النصاب والقواعد». عدّل الجدول أو النصاب.</p>' +
      '<div class="table-wrap"><table class="grid"><thead><tr><th>الشعبة</th><th>المادة</th><th>المعلم</th><th>النصاب</th><th>في الجدول</th></tr></thead><tbody>' +
      qd.map(function (x) { return '<tr><td>' + esc(x.class_name) + '</td><td>' + esc(x.subject) + '</td><td>' + esc(ttTName(x.teacher_id)) + '</td><td>' + x.need + '</td><td><b style="color:var(--red)">' + x.got + '</b></td></tr>'; }).join('') +
      '</tbody></table></div></div>';
    return dups + quota + (pins.length ? section('حصص تخالف قاعدة ملزمة', pins, 'bad', '', 'انقلها إلى حيث تسمح القاعدة، أو عدّل القاعدة في «النصاب والقواعد».') : '') +
      (tHard ? '<div class="card"><h2>معلمون يخالفون قاعدة ملزمة</h2><ul class="tt-checks">' + tHard + '</ul></div>' : '') + section('التعارضات', bad, 'bad', 'لا توجد تعارضات.', 'الصف أو المعلم في حصتين بنفس اليوم والحصة. عدّل إحداهما أو احذفها.') +
      section('حصص تحتاج تأكيدًا', live.filter(function (s) { return s.status === 'review'; }), 'review', 'تم تأكيد كل الحصص.') +
      section('حصص لشعبة ليست في «إعداد الفصول»', live.filter(function (s) { return known.indexOf(s.class_name) < 0; }), 'bad', 'كل الحصص لشعب موجودة.', 'غُيّر اسم الشعبة أو حُذفت من «إعداد الفصول». عدّل الحصة إلى الشعبة الصحيحة.') +
      section('حصص بلا معلم', live.filter(function (s) { return !s.teacher_id || !find(s.teacher_id); }), 'bad', 'لكل حصة معلم.') +
      section('الحصص المحذوفة', S.ttSessions.filter(function (s) { return s.status === 'removed'; }), 'gone', 'لا توجد حصص محذوفة.', 'المحذوفة لا تظهر في الجداول، وتُستعاد من هنا.');
  }

  /* ----- مواعيد الدوام ----- */
  // حال المرحلة الآن: قبل الدوام، في بند، بين بندين، بعد الدوام، أو عطلة نهاية الأسبوع
  function ttNowInfo(st, d) {
    d = d || new Date();
    var wd = d.getDay(), R = st.rows;
    if (wd === 5 || wd === 6) return { state: 'off', text: 'عطلة نهاية الأسبوع' };
    if (!R.length) return { state: 'off', text: '' };
    var m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    if (m < ttMins(R[0].f)) return { state: 'before', next: 0, text: 'يبدأ الدوام الساعة ' + R[0].f };
    for (var i = 0; i < R.length; i++) {
      var a = ttMins(R[i].f), b = ttMins(R[i].t);
      if (m >= a && m < b) {
        var left = Math.ceil(b - m);
        return { state: 'in', cur: i, pct: (m - a) / (b - a), left: left, text: ttRowLabel(st, i) + ' — متبقٍ ' + left + ' دقيقة',
          sub: i + 1 < R.length ? 'بعدها: ' + ttRowLabel(st, i + 1) + ' الساعة ' + R[i + 1].f : 'آخر الدوام' };
      }
      if (i + 1 < R.length && m >= b && m < ttMins(R[i + 1].f)) return { state: 'gap', next: i + 1, text: 'بين الحصص — ' + ttRowLabel(st, i + 1) + ' تبدأ الساعة ' + R[i + 1].f };
    }
    return { state: 'after', text: 'انتهى الدوام' };
  }
  function ttIsPast(ni, i) { return ni.state === 'after' || (ni.state === 'in' && i < ni.cur) || (ni.state === 'gap' && i < ni.next); }

  function ttStageErr(st) {
    for (var i = 0; i < st.rows.length; i++) {
      var r = st.rows[i], a = ttMins(r.f), b = ttMins(r.t);
      if (isNaN(a) || isNaN(b)) return 'أكمل وقت «' + ttRowLabel(st, i) + '» في «' + st.name + '»';
      if (b <= a) return 'نهاية «' + ttRowLabel(st, i) + '» قبل بدايتها في «' + st.name + '»';
      if (i && a < ttMins(st.rows[i - 1].t)) return '«' + ttRowLabel(st, i) + '» تبدأ قبل انتهاء «' + ttRowLabel(st, i - 1) + '» في «' + st.name + '»';
    }
    return '';
  }

  // آخر رقم حصة له دروس في شعب المرحلة: لا يُحذف بند حصة إن صارت الحصص أقل منه
  function ttStageMaxUsed(st, bells) {
    var m = 0;
    ttLive().forEach(function (s) { if (ttStageOf(s.class_name, bells) === st && s.period > m) m = s.period; });
    return m;
  }

  function ttNowbarHtml(bells, now) {
    var h = '<div class="clock" dir="ltr">' + ttHm(now.getHours() * 60 + now.getMinutes()) + '</div><div class="date">' +
      esc(now.toLocaleDateString('ar-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' })) + '</div>';
    bells.stages.forEach(function (st) {
      var ni = ttNowInfo(st, now);
      h += '<div class="st"><b>' + esc(st.name) + '</b><span>' + esc(ni.text) + '</span>' + (ni.sub ? '<small>' + esc(ni.sub) + '</small>' : '') + '</div>';
    });
    return h;
  }

  function ttStageHtml(st, si, now, E) {
    var ni = ttNowInfo(st, now), classes = ttClasses();
    var h = '<div class="card tt-stage"><header><h3>' + (E ? '<input type="text" data-tbst="' + si + '" data-tbf="name" value="' + esc(st.name) + '" aria-label="اسم المرحلة">' : esc(st.name)) + '</h3>';
    h += E ? '<div class="tt-chips" role="group" aria-label="الصفوف التابعة">' + classes.map(function (c) {
      return '<button type="button" data-tbcls="' + esc(c) + '" data-tbst="' + si + '" aria-pressed="' + (st.classes.indexOf(c) > -1) + '"' + (st.classes.indexOf(c) > -1 ? ' class="on"' : '') + '>' + esc(c) + '</button>';
    }).join('') + '</div>' : '<span class="cls">الصفوف: ' + (st.classes.length ? st.classes.map(esc).join('، ') : 'لا يوجد') + '</span>';
    h += '</header><div class="table-wrap"><table class="tt-bt"><thead><tr><th>البند</th><th>من</th><th>إلى</th><th>المدة</th>' + (E ? '<th><span class="sr-only">إجراء</span></th>' : '') + '</tr></thead><tbody>';
    st.rows.forEach(function (r, i) {
      var cls = 'k-' + r.k + (!E && ni.state === 'in' && ni.cur === i ? ' now' : '') + (!E && ttIsPast(ni, i) ? ' past' : '');
      var dur = ttMins(r.t) - ttMins(r.f), lbl = ttRowLabel(st, i);
      var tin = function (f) { return E ? '<input type="text" class="tin" inputmode="numeric" maxlength="5" dir="ltr" data-tbst="' + si + '" data-tbr="' + i + '" data-tbf="' + f + '" value="' + esc(r[f]) + '" aria-label="' + (f === 'f' ? 'بداية ' : 'نهاية ') + esc(lbl) + '">' : esc(r[f]); };
      h += '<tr class="' + cls + '"><td>' + (E && r.k !== 'p' ? '<input type="text" data-tbst="' + si + '" data-tbr="' + i + '" data-tbf="l" value="' + esc(r.l || '') + '" aria-label="اسم البند">' : esc(lbl)) + '</td>' +
        '<td class="t">' + tin('f') + '</td><td class="t">' + tin('t') + '</td><td class="t">' + (dur > 0 ? dur + ' د' : '—') + '</td>' +
        (E ? '<td><select data-tbst="' + si + '" data-tbr="' + i + '" data-tbact="1" aria-label="إجراء على ' + esc(lbl) + '"><option value="">إجراء…</option><option value="ip">إدراج حصة بعدها</option><option value="ib">إدراج استراحة بعدها</option><option value="del">حذف</option></select></td>' : '') + '</tr>';
    });
    h += '</tbody></table></div>';
    var err = ttStageErr(st);
    if (err) h += '<p class="formhint" style="margin:8px 16px">' + esc(err) + '</p>';
    if (E) h += '<div class="toolbar" style="padding:0 16px;margin:10px 0"><button type="button" class="btn" data-tbadd="p" data-tbst="' + si + '">+ حصة في النهاية</button><button type="button" class="btn" data-tbadd="b" data-tbst="' + si + '">+ استراحة في النهاية</button>' +
      ('<span style="flex:1"></span><button type="button" class="btn danger" data-tbdelstage="' + si + '">حذف المرحلة</button>') + '</div>';
    var R = st.rows;
    h += '<footer><span>بداية الدوام <b>' + esc(R.length ? R[0].f : '—') + '</b></span><span>نهاية الدوام <b>' + esc(R.length ? R[R.length - 1].t : '—') + '</b></span><span><b>' + ttPTimes(st).length + '</b> حصص</span></footer></div>';
    return h;
  }

  /* ----- مقترح الاستراحة: ضم صفوف إلى مرحلة أخرى (استراحتها) وفحص تعارض حصص المعلمين. عرض وطباعة فقط؛ لا يغيّر المواعيد ----- */
  function ttBrkState() {
    var st = ttCfg().bells.stages;
    if (!ui.ttBrk) ui.ttBrk = { target: '', pick: {} };
    if (!st.some(function (x) { return x.id === ui.ttBrk.target; })) ui.ttBrk.target = st.length ? st[0].id : '';
    return ui.ttBrk;
  }
  // استراحات المرحلة: «بعد الحصة الثانية 9:20–9:45»
  function ttBrkBreaks(st) {
    var n = 0, out = [];
    st.rows.forEach(function (r) {
      if (r.k === 'p') n++;
      else if (r.k === 'b') out.push((n ? 'بعد الحصة ' + (TT_ORD[n - 1] || n) : 'قبل الحصة الأولى') + ' ' + r.f + '–' + r.t);
    });
    return out.join('، ') || 'بلا استراحة';
  }
  function ttBrkPlan() {
    var b = ttBrkState(), bells = ttCfg().bells, target = bells.stages.filter(function (x) { return x.id === b.target; })[0];
    var plan = { target: target, classes: [], conflicts: [], teachers: [], changed: 0 };
    if (!target) return plan;
    var known = ttClasses();
    var picked = Object.keys(b.pick).filter(function (c) { return b.pick[c] && known.indexOf(c) > -1 && ttStageOf(c, bells) !== target; });
    picked.sort(function (x, y) { return known.indexOf(x) - known.indexOf(y); });
    var newStage = function (c) { return picked.indexOf(c) > -1 ? target : ttStageOf(c, bells); };
    var span = function (st, p) { var t = st && ttPTimes(st)[p - 1]; return t ? { f: ttMins(t[0]), t: ttMins(t[1]), s: t[0] + '–' + t[1] } : null; };
    var days = ttCfg().days;
    picked.forEach(function (c) {
      var old = ttStageOf(c, bells), diff = [], np = Math.max(ttPTimes(old).length, ttPTimes(target).length);
      for (var p = 1; p <= np; p++) {
        var a = span(old, p), z = span(target, p);
        if ((a && a.s) !== (z && z.s)) diff.push({ p: p, from: a ? a.s : '—', to: z ? z.s : 'لا حصة بهذا الرقم' });
      }
      plan.classes.push({ name: c, old: old, diff: diff });
    });
    // حصص كل معلم بأوقاتها قبل المقترح وبعده
    var byT = {};
    ttLive().forEach(function (x) {
      if (!x.teacher_id) return;
      var a = span(ttStageOf(x.class_name, bells), x.period), z = span(newStage(x.class_name), x.period);
      (byT[x.teacher_id + '|' + x.day] || (byT[x.teacher_id + '|' + x.day] = [])).push({ s: x, a: a, z: z });
    });
    var hit = function (p, q) { return p && q && p.f < q.t && q.f < p.t; }, chg = {};
    Object.keys(byT).forEach(function (k) {
      var L = byT[k], tid = k.split('|')[0], day = +k.split('|')[1];
      for (var i = 0; i < L.length; i++) {
        if (L[i].z && L[i].a && L[i].z.s !== L[i].a.s) { (chg[tid] || (chg[tid] = [])).push({ day: day, s: L[i].s, from: L[i].a.s, to: L[i].z.s }); plan.changed++; }
        for (var j = i + 1; j < L.length; j++) {
          // تعارض يسببه المقترح: الحصتان تتداخلان بعده ولم تكونا متداخلتين قبله
          if (hit(L[i].z, L[j].z) && !hit(L[i].a, L[j].a)) plan.conflicts.push({ tid: tid, day: day, x: L[i], y: L[j] });
        }
      }
    });
    plan.conflicts.sort(function (p, q) { return p.day - q.day || p.x.z.f - q.x.z.f; });
    plan.teachers = Object.keys(chg).map(function (tid) { return { tid: tid, list: chg[tid].sort(function (p, q) { return p.day - q.day || p.s.period - q.s.period; }) }; })
      .sort(function (p, q) { return ttTName(p.tid).localeCompare(ttTName(q.tid), 'ar'); });
    plan.days = days;
    return plan;
  }
  function ttBrkLesson(x, days) { return esc(x.s.class_name) + ' · الحصة ' + (TT_ORD[x.s.period - 1] || x.s.period) + ' · <span dir="ltr">' + esc(x.z.s) + '</span>'; }
  function ttBrkTables(plan, cls) {
    var days = plan.days || ttCfg().days, T = function (head, rows) { return '<table class="' + cls + '"><thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>'; };
    var classes = T(['الصف', 'الاستراحة الآن', 'الاستراحة بعد الضم', 'الحصص التي يتغير وقتها'], plan.classes.map(function (c) {
      return '<tr><td><b>' + esc(c.name) + '</b></td><td>' + esc(ttBrkBreaks(c.old)) + '</td><td>' + esc(ttBrkBreaks(plan.target)) + '</td><td>' +
        (c.diff.length ? c.diff.map(function (d) { return 'الحصة ' + (TT_ORD[d.p - 1] || d.p) + ': <span dir="ltr">' + esc(d.from) + '</span> ← <span dir="ltr">' + esc(d.to) + '</span>'; }).join('<br>') : 'لا يتغير وقت أي حصة') + '</td></tr>';
    }));
    var conflicts = plan.conflicts.length ? T(['المعلم', 'اليوم', 'الحصة الأولى', 'تتداخل مع'], plan.conflicts.map(function (c) {
      return '<tr><td><b>' + esc(ttTName(c.tid)) + '</b></td><td>' + esc(days[c.day] || '') + '</td><td>' + ttBrkLesson(c.x) + '</td><td>' + ttBrkLesson(c.y) + '</td></tr>';
    })) : '';
    var teachers = plan.teachers.length ? T(['المعلم', 'حصص يتغير وقتها', 'التفاصيل'], plan.teachers.map(function (t) {
      return '<tr><td><b>' + esc(ttTName(t.tid)) + '</b></td><td>' + t.list.length + '</td><td>' + t.list.map(function (x) {
        return esc(days[x.day] || '') + ': ' + esc(x.s.class_name) + ' (الحصة ' + (TT_ORD[x.s.period - 1] || x.s.period) + ')';
      }).join('، ') + '</td></tr>';
    })) : '';
    return { classes: classes, conflicts: conflicts, teachers: teachers };
  }
  function ttBrkVerdict(plan) {
    return plan.conflicts.length
      ? 'يوجد تعارض: ' + arCount(plan.conflicts.length, ['حالة واحدة', 'حالتان', 'حالات', 'حالة']) + ' يصير فيها للمعلم حصتان في وقت واحد.'
      : 'لا يوجد تعارض: لا يصير لأي معلم حصتان في وقت واحد.';
  }
  function ttBreakHtml() {
    var b = ttBrkState(), bells = ttCfg().bells, plan = ttBrkPlan(), target = plan.target;
    if (!bells.stages.length) return '<div class="card empty">حدّد مواعيد الدوام ومراحلها أولًا من «مواعيد الدوام».</div>';
    if (bells.stages.length < 2) return '<div class="card empty">المقترح يحتاج مرحلتين على الأقل بمواعيد مختلفة في «مواعيد الدوام».</div>';
    var others = ttClasses().filter(function (c) { return ttStageOf(c, bells) !== target; });
    var tb = plan.classes.length ? ttBrkTables(plan, 'grid') : null;
    var wrap = function (t) { return '<div class="table-wrap">' + t + '</div>'; };
    return '<div class="card no-print"><h2>مقترح ضم صفوف إلى استراحة أخرى</h2>' +
        '<p class="hint">اختر الاستراحة ثم الصفوف التي تُضم إليها؛ يظهر أثر ذلك على الأوقات، وهل يتعارض مع حصص المعلمين. لا تتغير المواعيد إلا بالضغط على «اعتماد المقترح».</p>' +
        '<div class="toolbar" style="align-items:center"><label class="field" for="brk-target" style="margin:0">الاستراحة المستهدفة</label>' +
        '<select id="brk-target" data-ro-ok style="width:auto;max-width:100%">' + bells.stages.map(function (st) {
          return '<option value="' + esc(st.id) + '"' + (st.id === b.target ? ' selected' : '') + '>' + esc(ttBrkBreaks(st)) + ' — ' + esc(st.name) + '</option>';
        }).join('') + '</select></div>' +
        '<label class="field" style="margin-top:10px">الصفوف التي تُضم (' + plan.classes.length + ')</label>' +
        (others.length ? '<div class="tt-chips brk-chips" role="group" aria-label="الصفوف التي تُضم">' + others.map(function (c) {
          var on = !!b.pick[c];
          return '<button type="button" data-ro-ok data-brkcls="' + esc(c) + '" aria-pressed="' + on + '"' + (on ? ' class="on"' : '') + '>' + esc(c) + '</button>';
        }).join('') + '</div>' : '<p class="hint" style="margin:0">كل الصفوف في هذه المرحلة أصلًا.</p>') +
        '<div class="toolbar" style="margin:14px 0 0;align-items:center"><button type="button" class="btn primary" data-ttprint="brk|" data-ro-ok' + (plan.classes.length ? '' : ' disabled') + '>طباعة المقترح / PDF</button>' +
        (plan.classes.length && canEditTT() ? '<button type="button" class="btn" data-brkapply>اعتماد المقترح</button>' : '') +
        (plan.classes.length ? '<button type="button" class="btn link" data-brkclear data-ro-ok>إلغاء الاختيار</button>' : '') + '</div></div>' +
      (!tb ? '<div class="card empty">اختر صفًا واحدًا على الأقل ليظهر المقترح وفحص التعارض.</div>' :
        '<div class="card"><h2>هل يتعارض مع حصص المعلمين؟</h2><div class="brk-verdict ' + (plan.conflicts.length ? 'bad' : 'ok') + '"><b>' + (plan.conflicts.length ? '✕' : '✓') + '</b><span>' + esc(ttBrkVerdict(plan)) + '</span></div>' +
          (tb.conflicts ? '<div style="margin-top:12px">' + wrap(tb.conflicts) + '</div>' : '') +
          '<p class="hint" style="margin:10px 0 0">الفحص على الجدول الحالي: ' + ttLive().length + ' حصة. يُحسب تعارضًا كل حصتين لمعلم واحد في يوم واحد يتداخل وقتاهما بعد الضم ولم يكونا متداخلين قبله.</p></div>' +
        '<div class="card"><h2>ما يتغير للصفوف</h2>' + wrap(tb.classes) + '</div>' +
        '<div class="card"><h2>المعلمون الذين يتغير وقت حصصهم (' + plan.teachers.length + ')</h2>' +
          (tb.teachers ? wrap(tb.teachers) + '<p class="hint" style="margin:10px 0 0">تتغير أوقات هذه الحصص فقط (' + plan.changed + ' حصة في الأسبوع)، ومعها وقت استراحة المعلم في تلك الأيام.</p>'
            : '<div class="empty">لا يتغير وقت أي حصة.</div>') + '</div>');
  }
  // ورقة المقترح المطبوعة
  function ttBreakPage() {
    var plan = ttBrkPlan();
    if (!plan.target || !plan.classes.length) return '<p>لم تُختر صفوف.</p>';
    var tb = ttBrkTables(plan, 'tt-brk');
    return '<section class="tt-page" data-base="13">' + ttTop() + '<div class="tt-ptitle">مقترح تعديل استراحة الصفوف</div>' +
      '<div class="tt-pmeta">' + dmy(todayISO()) + ' · العام الدراسي ' + esc(academicYear()) + '</div>' +
      '<p style="margin:.6em 0">يُقترح ضم ' + (plan.classes.length === 1 ? 'الصف' : 'الصفوف') + ' <b>' + plan.classes.map(function (c) { return esc(c.name); }).join('، ') + '</b> إلى استراحة <b>' + esc(ttBrkBreaks(plan.target)) + '</b> (مواعيد «' + esc(plan.target.name) + '»).</p>' +
      '<div class="tt-brk-h">أثر المقترح على الصفوف</div>' + tb.classes +
      '<div class="tt-brk-h">التعارض مع حصص المعلمين</div><div class="' + (plan.conflicts.length ? 'tt-brk-bad' : 'tt-brk-ok') + '">' + esc(ttBrkVerdict(plan)) + '</div>' + tb.conflicts +
      (tb.teachers ? '<div class="tt-brk-h">المعلمون الذين يتغير وقت حصصهم</div>' + tb.teachers : '') +
      '</section>';
  }
  document.addEventListener('click', function (e) {
    if (location.hash !== '#/timetable/breaks') return;
    var el = e.target.closest('[data-brkcls]');
    if (el) { var b = ttBrkState(), c = el.getAttribute('data-brkcls'); if (b.pick[c]) delete b.pick[c]; else b.pick[c] = true; return render(); }
    if (e.target.closest('[data-brkclear]')) { ttBrkState().pick = {}; return render(); }
    if (e.target.closest('[data-brkapply]')) return ttBrkApply();
  });
  // اعتماد المقترح: تنتقل الصفوف المختارة إلى مرحلة الاستراحة المستهدفة في «مواعيد الدوام»
  async function ttBrkApply() {
    if (!canEditTT()) return;
    var plan = ttBrkPlan(), names = plan.classes.map(function (c) { return c.name; });
    if (!plan.target || !names.length) return;
    if (ui.ttBell) return toast('في «مواعيد الدوام» تعديل لم يُحفظ؛ احفظه أو ألغه أولًا', true);
    if (!confirm((plan.conflicts.length ? 'تنبيه: في المقترح ' + plan.conflicts.length + ' تعارض في حصص المعلمين.\n\n' : '') +
      'اعتماد المقترح؟\nتنتقل ' + names.join('، ') + ' إلى مواعيد «' + plan.target.name + '» (الاستراحة ' + ttBrkBreaks(plan.target) + ')، وتتغير أوقات حصصها في كل الجداول المطبوعة وشاشة الممر.')) return;
    var bells = JSON.parse(JSON.stringify(ttCfg().bells)), tid = ttBrkState().target, ti = bells.stages.findIndex(function (x) { return x.id === tid; }), order = ttClasses();
    if (ti < 0) return;
    bells.stages.forEach(function (st, i) { if (i !== ti) st.classes = st.classes.filter(function (c) { return names.indexOf(c) < 0; }); });
    names.forEach(function (c) { if (bells.stages[ti].classes.indexOf(c) < 0) bells.stages[ti].classes.push(c); });
    bells.stages[ti].classes.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    if (await ttSaveConfig({ bells: bells })) {
      ttBrkState().pick = {};
      render();
      toast('اعتُمد المقترح: ' + names.join('، ') + ' على مواعيد «' + plan.target.name + '». عدّل اسمي المرحلتين من «مواعيد الدوام» إن لزم.');
    }
  }
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/timetable/breaks' || e.target.id !== 'brk-target') return;
    var b = ttBrkState();
    b.target = e.target.value; b.pick = {};
    render();
  });

  function ttBellsLink() { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'bells.html'; }

  function ttBellsHtml() {
    var draft = ui.ttBell, bells = draft || ttCfg().bells, now = new Date(), E = !!draft;
    if (!bells.stages.length && !E) {
      return '<div class="card empty">لم تُحدَّد مواعيد الدوام بعد.' + (canEditTT() ? '<br><button type="button" class="btn primary" data-tbstart style="margin-top:10px">إنشاء مواعيد الدوام</button>' : '') + '</div>';
    }
    var bar = E
      ? '<button type="button" class="btn primary" data-tbsave>حفظ المواعيد</button><button type="button" class="btn" data-tbcancel>إلغاء</button>' +
        '<label class="check" style="padding:0"><input type="checkbox" id="tb-auto"' + (bells.auto ? ' checked' : '') + '> ترحيل ما بعد البند تلقائيًا عند تغيير وقته</label>' +
        '<span style="flex:1"></span><button type="button" class="btn" data-tbaddstage>+ مرحلة</button>'
      : (canEditTT() ? '<button type="button" class="btn" data-tbedit>تعديل المواعيد</button>' : '') +
        '<span style="flex:1"></span><button type="button" class="btn primary" data-tbshow data-ro-ok>عرض على الشاشة</button>' +
        '<button type="button" class="btn" data-tbcopy data-ro-ok title="صفحة مشاهدة فقط بلا تسجيل دخول، لشاشة الممر">نسخ رابط شاشة الممر</button>';
    return '<div class="card no-print"><div class="toolbar" style="align-items:center;margin:0">' + bar + '</div></div>' +
      (E ? '' : '<div class="card tt-now" id="tt-nowbar" aria-live="polite">' + ttNowbarHtml(bells, now) + '</div>') +
      '<div class="tt-stages">' + bells.stages.map(function (st, si) { return ttStageHtml(st, si, now, E); }).join('') + '</div>';
  }

  function ttDefaultStage(name, classes) {
    var A = function (f, t) { return { k: 'a', l: 'الطابور', f: f, t: t }; }, P = function (f, t) { return { k: 'p', f: f, t: t }; }, B = function (f, t) { return { k: 'b', l: 'الاستراحة', f: f, t: t }; };
    return { id: 'st' + Date.now().toString(36), name: name, classes: classes,
      rows: [A('7:45', '8:00'), P('8:00', '8:40'), P('8:40', '9:20'), P('9:20', '10:00'), B('10:00', '10:25'), P('10:25', '11:05'), P('11:05', '11:45'), P('11:45', '12:25')] };
  }

  function ttShiftAfter(st, i, delta) {
    for (var j = i + 1; j < st.rows.length; j++) { st.rows[j].f = ttHm(ttMins(st.rows[j].f) + delta); st.rows[j].t = ttHm(ttMins(st.rows[j].t) + delta); }
  }

  // تعديل وقت أو اسم في مسودة المواعيد
  function ttBellInput(el) {
    var b = ui.ttBell, st = b.stages[+el.getAttribute('data-tbst')], f = el.getAttribute('data-tbf');
    if (f === 'name') { st.name = el.value.trim() || st.name; return; }
    var r = st.rows[+el.getAttribute('data-tbr')], i = +el.getAttribute('data-tbr');
    if (f === 'l') { r.l = el.value.trim(); return; }
    var v = latinDigits(el.value).replace(/[.٫،]/g, ':');
    if (/^\d{3,4}$/.test(v)) v = v.slice(0, -2) + ':' + v.slice(-2);
    v = v.replace(/^0(\d)/, '$1');
    if (!/^\d{1,2}:\d{2}$/.test(v) || +v.split(':')[0] > 23 || +v.split(':')[1] > 59) { toast('اكتب الوقت بالشكل 8:40', true); return render(); }
    var delta = ttMins(v) - ttMins(r[f]);
    if (!delta) return;
    if (f === 'f') { r.f = v; if (b.auto) { r.t = ttHm(ttMins(r.t) + delta); ttShiftAfter(st, i, delta); } }
    else { r.t = v; if (b.auto) ttShiftAfter(st, i, delta); }
    render();
  }

  function ttBellAction(si, i, act) {
    var b = ui.ttBell, st = b.stages[si], r = st.rows[i];
    if (act === 'del') {
      if (r.k === 'p' && ttPTimes(st).length <= ttStageMaxUsed(st, b)) return toast('صفوف هذه المرحلة لها دروس في الحصة ' + ttPTimes(st).length + ' — انقلها أو احذفها أولًا', true);
      var gap = i + 1 < st.rows.length ? ttMins(st.rows[i + 1].f) - ttMins(r.f) : 0;
      st.rows.splice(i, 1);
      if (b.auto && gap > 0) ttShiftAfter(st, i - 1, -gap);
    } else {
      var k = act === 'ip' ? 'p' : 'b', len = k === 'p' ? 40 : 15, start = ttMins(r.t), nr = { k: k, f: ttHm(start), t: ttHm(start + len) };
      if (k === 'b') nr.l = 'الاستراحة';
      st.rows.splice(i + 1, 0, nr);
      if (b.auto) ttShiftAfter(st, i + 1, len);
    }
    render();
  }

  // نقل شعبة إلى مرحلة: تخرج من غيرها. إزالتها من مرحلتها تنقلها إلى مرحلة أخرى (كل شعبة في مرحلة)
  function ttToggleStageClass(si, cls) {
    var stages = ui.ttBell.stages, st = stages[si], on = st.classes.indexOf(cls) > -1;
    if (on) {
      if (stages.length < 2) return toast('كل شعبة تتبع مرحلة؛ أضف مرحلة أخرى أولًا', true);
      st.classes.splice(st.classes.indexOf(cls), 1);
      var other = stages[si === 0 ? 1 : 0];
      other.classes.push(cls);
      toast('نُقل ' + cls + ' إلى «' + other.name + '»');
    } else {
      stages.forEach(function (s) { var k = s.classes.indexOf(cls); if (k > -1) s.classes.splice(k, 1); });
      st.classes.push(cls);
    }
    var order = ttClasses();
    stages.forEach(function (s) { s.classes.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); }); });
    render();
  }

  async function ttSaveBells() {
    var b = ui.ttBell;
    for (var i = 0; i < b.stages.length; i++) { var err = ttStageErr(b.stages[i]); if (err) return toast(err, true); }
    if (await ttSaveConfig({ bells: b })) { ui.ttBell = null; render(); toast('حُفظت مواعيد الدوام'); }
  }

  /* ----- شاشة العرض (ملء الشاشة) ----- */
  function ttDisplayHtml(bells, now) {
    var h = '<div class="dtop"><img src="' + REPORT.logo + '" alt=""><div><h2>' + esc(schoolName()) + '</h2><p>مواعيد الدوام المدرسي</p></div>' +
      '<button type="button" class="dx" data-tbclose>إغلاق</button><div class="dclock"><b dir="ltr">' + ttHm(now.getHours() * 60 + now.getMinutes()) + '</b><span>' +
      esc(now.toLocaleDateString('ar-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' })) + '</span></div></div><div class="dgrid">';
    bells.stages.forEach(function (st) {
      var ni = ttNowInfo(st, now);
      h += '<section class="dst"><h3>' + esc(st.name) + '</h3><div class="dnow">' + (ni.state === 'in' ? 'الآن: <em>' + esc(ttRowLabel(st, ni.cur)) + '</em> · متبقٍ ' + ni.left + ' دقيقة' : esc(ni.text)) + '</div>' +
        (ni.state === 'in' ? '<div class="dbar"><i style="width:' + Math.round(ni.pct * 100) + '%"></i></div>' : '') + '<div class="drows">' +
        st.rows.map(function (r, i) {
          return '<div class="drow k-' + r.k + (ni.state === 'in' && ni.cur === i ? ' now' : '') + (ttIsPast(ni, i) ? ' past' : '') + '"><span>' + esc(ttRowLabel(st, i)) + '</span><span>' + esc(ttRange(r.f, r.t)) + '</span></div>';
        }).join('') + '</div></section>';
    });
    return h + '</div>';
  }
  function ttOpenDisplay() {
    if (document.getElementById('tt-disp')) return;
    document.body.insertAdjacentHTML('beforeend', '<div class="tt-disp" id="tt-disp" role="dialog" aria-label="مواعيد الدوام">' + ttDisplayHtml(ttCfg().bells, new Date()) + '</div>');
    var el = document.getElementById('tt-disp');
    try { var p = el.requestFullscreen && el.requestFullscreen(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }
  function ttCloseDisplay() {
    var el = document.getElementById('tt-disp');
    if (el) el.remove();
    try { if (document.fullscreenElement) document.exitFullscreen().catch(function () {}); } catch (e) {}
  }
  document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement) { var el = document.getElementById('tt-disp'); if (el) el.remove(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') ttCloseDisplay(); });
  // كل 20 ثانية: تتحدث شاشة العرض والحصة الجارية في صفحة المواعيد (إن لم يكن المستخدم يكتب أو يعدّل)
  setInterval(function () {
    var disp = document.getElementById('tt-disp');
    if (disp) disp.innerHTML = ttDisplayHtml(ttCfg().bells, new Date());
    var nb = document.getElementById('tt-nowbar');
    if (nb && location.hash === '#/timetable/bells' && !ui.ttBell && !ui.ttEdit) {
      var a = document.activeElement;
      if (!a || !/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) { var y = window.scrollY; render(); window.scrollTo(0, y); }
    }
  }, 20000);

  /* ----- الاستيراد من ملف الجدول (timetable-data.json) -----
     يُطابق كل معلم في الملف بسجله في «بيانات العاملين» وكل صف بشعبته في «إعداد الفصول»، ويعرض الأعداد والتعارضات
     قبل الحفظ. الحصص تُحفظ بمعرّفها في الملف، فإعادة الاستيراد تحدّثها ولا تكررها. «قرأن» تُصحَّح إلى «قرآن» */
  function ttFixSubject(s) { return String(s || '').trim() === 'قرأن' ? 'قرآن' : String(s || '').trim(); }

  function ttImpPrepare(data, fileName) {
    if (!data || !Array.isArray(data.sessions) || !Array.isArray(data.teachers) || !Array.isArray(data.classes)) throw new Error('الملف ليس ملف جدول حصص (ينقصه المعلمون أو الصفوف أو الحصص)');
    var names = classConfig().names, classMap = {}, teacherMap = {};
    data.classes.forEach(function (c) { classMap[c.id] = names.filter(function (n) { return norm(n) === norm(c.name); })[0] || ''; });
    // المطابقة بالاسم كما هو، وإلا بالاسم نفسه مكتوبًا بشكل آخر (ttSameName) إن دلّ على سجل واحد.
    // «prev» اسم من حلّ المعلم محله فلا يُطابق به
    data.teachers.forEach(function (t) {
      var hit = S.teachers.filter(function (x) { return norm(x.name) === norm(t.name); });
      if (!hit.length) hit = S.teachers.filter(function (x) { return ttSameName(x.name, t.name); });
      teacherMap[t.id] = hit.length === 1 ? hit[0].id : '__new';
    });
    ui.ttImp = { data: data, fileName: fileName, classMap: classMap, teacherMap: teacherMap };
  }

  // صفوف الحصص كما ستُحفظ (teacher_id للمعلم الجديد «new:معرّفه في الملف» إلى أن يُنشأ)
  function ttImpRows() {
    var imp = ui.ttImp;
    return imp.data.sessions.filter(function (s) { return imp.classMap[s.c] && imp.classMap[s.c] !== '__skip'; }).map(function (s) {
      var tm = s.t ? imp.teacherMap[s.t] : '';
      return { id: s.id, legacy_id: s.id, day: Number(s.d), period: Number(s.p), class_name: imp.classMap[s.c],
        teacher_id: !tm ? null : tm === '__new' ? 'new:' + s.t : tm, subject: ttFixSubject(s.s),
        status: s.st === 'removed' || s.st === 'review' ? s.st : 'ok', note: String(s.n || '') };
    });
  }

  function ttImportHtml() {
    var imp = ui.ttImp;
    var intro = '<div class="card"><h2>استيراد جدول الحصص من ملف</h2><p class="hint">اختر ملف الجدول (<span dir="ltr">timetable-data.json</span>). لا يُحفظ شيء قبل أن تراجع المطابقة وتضغط «استيراد».' +
      (S.ttSessions.length ? ' في الجدول الآن ' + S.ttSessions.length + ' حصة؛ ما استُورد سابقًا من الملف نفسه يُستبدل بما في الملف، وما أضفته يدويًا يبقى.' : '') + '</p>' +
      '<input type="file" id="tt-file" accept=".json,application/json">' + (imp ? '<p class="hint" style="margin:8px 0 0">الملف: ' + esc(imp.fileName) + (imp.data.saved ? ' · آخر حفظ فيه: <span dir="ltr">' + esc(imp.data.saved) + '</span>' : '') + '</p>' : '') + '</div>';
    if (!imp) return intro;
    var d = imp.data, names = classConfig().names, opt = function (v, l, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>'; };
    var uses = {};
    d.sessions.forEach(function (s) { if (s.st !== 'removed') { uses['c' + s.c] = (uses['c' + s.c] || 0) + 1; if (s.t) uses['t' + s.t] = (uses['t' + s.t] || 0) + 1; } });
    var classRows = d.classes.map(function (c) {
      var v = imp.classMap[c.id];
      return '<tr><td>' + esc(c.name) + '</td><td>' + (uses['c' + c.id] || 0) + '</td><td><select data-ttimpc="' + esc(c.id) + '">' + opt('', '— اختر الشعبة —', v) + names.map(function (n) { return opt(n, n, v); }).join('') + opt('__skip', 'لا تُستورد حصصه', v) + '</select>' +
        (v ? '' : ' <span class="badge unpaid">غير مطابق</span>') + '</td></tr>';
    }).join('');
    var staff = S.teachers.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); });
    var teacherRows = d.teachers.map(function (t) {
      var v = imp.teacherMap[t.id];
      return '<tr><td><b>' + esc(t.name) + '</b>' + (t.prev ? '<br><small class="hint">بدلًا من: ' + esc(t.prev) + '</small>' : '') + '</td><td>' + esc(t.role || '') + '</td><td>' + (uses['t' + t.id] || 0) + '</td><td><select data-ttimpt="' + esc(t.id) + '">' +
        opt('__new', '+ إضافته إلى بيانات العاملين', v) + opt('', 'بدون معلم', v) + staff.map(function (x) { return opt(x.id, x.name + (x.category ? ' — ' + x.category : ''), v); }).join('') + '</select>' +
        (v === '__new' ? ' <span class="badge edit">جديد</span>' : '') + '</td></tr>';
    }).join('');
    var rows = ttImpRows(), live = rows.filter(function (s) { return s.status !== 'removed'; }), cf = ttConflicts(live);
    var unmapped = d.classes.filter(function (c) { return !imp.classMap[c.id]; });
    var newT = d.teachers.filter(function (t) { return imp.teacherMap[t.id] === '__new'; });
    var subjects = [];
    (d.subjects || []).concat(rows.map(function (s) { return s.subject; })).forEach(function (s) { s = ttFixSubject(s); if (s && subjects.indexOf(s) < 0) subjects.push(s); });
    var days = Array.isArray(d.days) && d.days.length ? d.days : TT_DAYS;
    var conflictList = cf.groups.slice(0, 8).map(function (g) {
      var s = g.list[0];
      return '<li>' + esc(days[s.day] || '') + ' — الحصة ' + s.period + ': ' + (g.kind === 'class' ? 'الصف ' + esc(s.class_name) : 'المعلم ' + esc(ttImpTName(s.teacher_id))) + ' في ' + g.list.length + ' حصص</li>';
    }).join('');
    var check = function (ok, text) { return '<li style="color:' + (ok ? 'var(--green)' : 'var(--red)') + '">' + (ok ? '✓ ' : '✗ ') + text + '</li>'; };
    return intro +
      '<div class="card"><h2>الصفوف (' + d.classes.length + ')</h2><p class="hint">يُطابق كل صف في الملف بشعبته في «إعداد الفصول».</p><div class="table-wrap"><table class="grid"><thead><tr><th>في الملف</th><th>حصصه</th><th>الشعبة في البرنامج</th></tr></thead><tbody>' + classRows + '</tbody></table></div></div>' +
      '<div class="card"><h2>المعلمون (' + d.teachers.length + ')</h2><p class="hint">يُطابق كل معلم بسجله في «بيانات العاملين». من لا سجل له يُضاف إليها (المحفظون بفئة «محفظون»، والباقون «هيئة تدريس»)، ويمكنك اختيار سجله إن كان مكتوبًا باسم آخر.</p>' +
        '<div class="table-wrap"><table class="grid"><thead><tr><th>في الملف</th><th>التخصص</th><th>حصصه</th><th>السجل في البرنامج</th></tr></thead><tbody>' + teacherRows + '</tbody></table></div></div>' +
      '<div class="card"><h2>قبل الاستيراد</h2><ul class="tt-checks">' +
        check(!unmapped.length, unmapped.length ? 'صفوف غير مطابقة: ' + unmapped.map(function (c) { return esc(c.name); }).join('، ') + ' — اختر شعبتها أو «لا تُستورد حصصه»' : 'كل الصفوف مطابقة') +
        check(true, 'الحصص الفعّالة: <b>' + live.length + '</b>' + (live.filter(function (s) { return s.status === 'review'; }).length ? ' (منها ' + live.filter(function (s) { return s.status === 'review'; }).length + ' تحتاج تأكيدًا)' : '') + ' · المحذوفة: ' + (rows.length - live.length) + ' (تُحفظ لتُستعاد عند الحاجة)') +
        check(!cf.groups.length, cf.groups.length ? 'تعارضات: ' + cf.groups.length + '<ul>' + conflictList + '</ul>' : 'لا توجد تعارضات') +
        check(true, newT.length ? 'يُضاف إلى بيانات العاملين ' + newT.length + ': ' + newT.map(function (t) { return esc(t.name); }).join('، ') : 'كل المعلمين لهم سجلات') +
        check(true, 'المواد (' + subjects.length + '): ' + subjects.map(esc).join('، ') + ((d.subjects || []).indexOf('قرأن') > -1 ? ' — صُحّحت «قرأن» إلى «قرآن»' : '')) +
        check(!!(d.bells && d.bells.stages && d.bells.stages.length), d.bells && d.bells.stages ? 'مواعيد الدوام: ' + d.bells.stages.map(function (st) { return esc(st.name); }).join('، ') : 'لا توجد مواعيد دوام في الملف') +
      '</ul><div class="toolbar" style="margin:12px 0 0"><button type="button" class="btn primary" data-ttimprun' + (unmapped.length ? ' disabled' : '') + '>استيراد ' + rows.length + ' حصة</button><button type="button" class="btn" data-ttimpcancel>إلغاء</button></div></div>';
  }

  function ttImpTName(tid) {
    if (tid && /^new:/.test(tid)) { var id = tid.slice(4), t = ui.ttImp.data.teachers.filter(function (x) { return x.id === id; })[0]; return t ? t.name : ''; }
    return ttTName(tid);
  }

  async function ttRunImport(btn) {
    var imp = ui.ttImp, d = imp.data;
    btn.disabled = true;
    btn.textContent = 'جارٍ الاستيراد…';
    try {
      // 1) المعلمون الجدد إلى بيانات العاملين
      var created = {};
      for (var i = 0; i < d.teachers.length; i++) {
        var t = d.teachers[i];
        if (imp.teacherMap[t.id] !== '__new') continue;
        var quran = /قرآن|قران|تحفيظ/.test(t.role || '');
        var data = { name: String(t.name || '').trim(), subject: quran ? 'قرآن' : String(t.role || '') };
        if (!S.staffMissing) { data.category = quran ? 'محفظون' : 'هيئة تدريس'; data.job_title = String(t.role || ''); }
        var ins = await sb.from('teachers').insert(data).select().single();
        if (ins.error) throw new Error('تعذرت إضافة ' + data.name + ': ' + ins.error.message);
        S.teachers.push(ins.data);
        created[t.id] = ins.data.id;
        imp.teacherMap[t.id] = ins.data.id;
      }
      // 2) الحصص على دفعات، بمعرّفها في الملف
      var who = ttWho(), now = new Date().toISOString();
      var rows = ttImpRows().map(function (s) {
        return { legacy_id: s.legacy_id, day: s.day, period: s.period, class_name: s.class_name, teacher_id: s.teacher_id, subject: s.subject, status: s.status, note: s.note, updated_by: who, updated_at: now };
      });
      for (var k = 0; k < rows.length; k += 200) {
        var up = await sb.from('timetable_sessions').upsert(rows.slice(k, k + 200), { onConflict: 'legacy_id' });
        if (up.error) throw new Error(up.error.message);
      }
      // 3) الأيام والمواد ومواعيد الدوام (شعب كل مرحلة بأسمائها في البرنامج)
      var subjects = [];
      (d.subjects || []).concat(rows.map(function (s) { return s.subject; })).forEach(function (s) { s = ttFixSubject(s); if (s && subjects.indexOf(s) < 0) subjects.push(s); });
      var patch = { subjects: subjects };
      if (Array.isArray(d.days) && d.days.length) patch.days = d.days;
      if (d.bells && Array.isArray(d.bells.stages)) {
        patch.bells = { auto: d.bells.auto !== false, stages: d.bells.stages.map(function (st) {
          return { id: st.id, name: st.name, rows: st.rows, classes: (st.classes || []).map(function (c) { return imp.classMap[c]; }).filter(function (c) { return c && c !== '__skip'; }) };
        }) };
      }
      if (!(await ttSaveConfig(patch))) throw new Error('تعذر حفظ المواعيد');
      await loadTimetable();
      ui.ttImp = null;
      go('#/timetable/review');
      toast('تم الاستيراد: ' + rows.length + ' حصة' + (Object.keys(created).length ? ' · أُضيف ' + Object.keys(created).length + ' إلى بيانات العاملين' : ''));
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'استيراد';
      toast(err.message, true);
    }
  }

  /* ----- النصاب والقواعد وتحسين الجدول -----
     النصاب: لكل شعبة ومادة عدد حصصها الأسبوعية ومعلمها؛ يُدخل في الإعدادات وينبَّه إلى كل اختلاف عنه في الجدول.
     القواعد: الأساسية (حصص متتالية، حمل اليوم، تكتل الحصص أول اليوم أو آخره، الفراغات) و«قواعدي» من النماذج،
     لكل منها مستوى: ملزمة أو أولوية عالية/متوسطة/منخفضة، ونسبة التزام تُعرض.
     التحسين: بحث عن تبديل حصتين في الشعبة نفسها (فلا يتغير نصاب شعبة ولا معلم) يحسّن جدول معلم ولا يسيء
     إلى جدول أي معلم آخر ولا يصنع تعارضًا. النتيجة اقتراح يُحفظ، ولا يتغير الجدول إلا إذا اعتُمد.
     الجداول من supabase/timetable_plan.sql */

  // القواعد الأساسية: تقيس جودة جدول المعلم، ولكل منها وزن في درجته
  var TT_RULES = {
    run: { on: true, v: 3, label: 'أقصى عدد حصص متتالية للمعلم', unit: 'حصص' },
    day: { on: true, v: 5, label: 'أقصى عدد حصص للمعلم في اليوم', unit: 'حصص' },
    side: { on: true, v: 65, label: 'أقصى نسبة من حصص المعلم في نصف واحد من اليوم (أوله أو آخره)', unit: '%' },
    gaps: { on: true, v: 2, label: 'أقصى عدد حصص فراغ بين حصص المعلم في اليوم', unit: 'حصص' }
  };
  var TT_WEIGHT = { run: 3, day: 3, side: 2, gaps: 1 };

  // مستوى القاعدة: الملزمة لا يقترح التحسين ما يزيد مخالفتها ولا يُعتمد اقتراح يزيدها؛ وغيرها تُحسب مخالفتها في الدرجة بوزنها،
  // فيبدأ التحسين بالأهم ويصل إلى أفضل ما يمكن. نسبة الالتزام تُعرض لكل قاعدة وللجدول كله
  var TT_LEVELS = { hard: { label: 'ملزمة', w: 0 }, high: { label: 'أولوية عالية', w: 5 }, mid: { label: 'أولوية متوسطة', w: 2 }, low: { label: 'أولوية منخفضة', w: 1 } };

  // نماذج «قواعدي»: scope «class» تُقيَّم على حصص الشعبة، و«teacher» على حصص المعلم
  var TT_RTYPES = {
    subjOnly: { label: 'مادة في حصص معيّنة فقط', scope: 'class', f: ['subjects', 'periods'], hint: 'مثل: القرآن في الحصة 1 أو 2 فقط' },
    subjNot: { label: 'مادة لا تكون في حصص معيّنة', scope: 'class', f: ['subjects', 'periods'], hint: 'مثل: الرياضة ليست في الحصة الأولى' },
    subjDayMax: { label: 'حد لتكرار المادة في الشعبة في اليوم', scope: 'class', f: ['subjects', 'n'], hint: 'مثل: الرياضيات لا تزيد عن حصة في اليوم' },
    subjDouble: { label: 'حصتان متتاليتان للمادة في اليوم نفسه', scope: 'class', f: ['subjects'], hint: 'مثل: الفن حصتان متتاليتان؛ إن كان عدد حصصها فرديًا تبقى واحدة منفردة' },
    teacherOff: { label: 'معلم غير متاح في أيام أو حصص', scope: 'teacher', f: ['teacher', 'days', 'periods'], hint: 'إن لم تختر حصصًا فاليوم كله غير متاح' },
    tDaysMin: { label: 'أقل عدد أيام دوام للمعلم', scope: 'teacher', f: ['teacherAll', 'n'] },
    tDaysMax: { label: 'أكثر عدد أيام دوام للمعلم', scope: 'teacher', f: ['teacherAll', 'n'] },
    tLastMax: { label: 'أقصى عدد حصص أخيرة للمعلم في الأسبوع', scope: 'teacher', f: ['teacherAll', 'n'], hint: 'الحصة الأخيرة في مرحلة الشعبة' },
    tFirstMin: { label: 'أقل عدد حصص أولى للمعلم في الأسبوع', scope: 'teacher', f: ['teacherAll', 'n'] }
  };

  function ttRules() {
    var r = (S.ttConfig && S.ttConfig.rules) || {}, out = {};
    Object.keys(TT_RULES).forEach(function (k) {
      var x = r[k] || {};
      out[k] = { on: x.on == null ? TT_RULES[k].on : !!x.on, v: x.v == null || isNaN(Number(x.v)) ? TT_RULES[k].v : Number(x.v) };
    });
    return out;
  }

  // «1,2» أو «1-3» أو قائمة ← أرقام
  function ttNums(x) {
    if (Array.isArray(x)) return x.map(Number).filter(function (n) { return n >= 0; });
    var out = [];
    splitList(latinDigits(String(x || '')).replace(/[-–]/g, '-')).forEach(function (p) {
      var m = p.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) for (var i = +m[1]; i <= +m[2]; i++) out.push(i); else if (/^\d+$/.test(p)) out.push(+p);
    });
    return out;
  }

  // «قواعدي». قبل وجودها كان شرط القرآن قاعدة ثابتة (rules.first)، فيصير أول قاعدة فيها
  function ttCustomRules() {
    var r = (S.ttConfig && S.ttConfig.rules) || {};
    if (Array.isArray(r.custom)) return r.custom;
    var f = r.first || {}, n = Number(f.v) || 2, p = [];
    for (var i = 1; i <= n; i++) p.push(i);
    return [{ id: 'quran', type: 'subjOnly', on: f.on !== false, level: 'hard', subjects: f.subjects || 'قرآن', periods: p }];
  }

  function ttSubjKey(s) { return norm(ttFixSubject(s)); }

  // القواعد مهيأة للتقييم السريع (تُحسب مرة لكل نسخة من الإعدادات)
  var ttRSCache = { src: null, val: null };
  function ttRuleSet(list) {
    if (!list && ttRSCache.src === S.ttConfig && ttRSCache.val) return ttRSCache.val;
    var set = function (arr) { var o = {}; arr.forEach(function (v) { o[v] = 1; }); return o; };
    var c = (list || ttCustomRules()).filter(function (r) { return r.on !== false && TT_RTYPES[r.type]; }).map(function (r) {
      var lv = TT_LEVELS[r.level] ? r.level : 'mid', subj = {}, periods = ttNums(r.periods), days = ttNums(r.days);
      splitList(r.subjects).forEach(function (x) { subj[ttSubjKey(x)] = 1; });
      return { id: r.id, type: r.type, raw: r, hard: lv === 'hard', w: TT_LEVELS[lv].w, subj: subj, periods: set(periods), np: periods.length, days: set(days), nd: days.length,
        teacher_id: r.teacher_id || '', n: Math.max(0, Number(r.n) || 0) };
    });
    // مواد مقيدة بقاعدة ملزمة «في حصص معيّنة فقط»: لا يُحسب وجودها أول اليوم تكتلًا
    var pin = {}, dbl = {};
    c.forEach(function (r) {
      if (r.type === 'subjOnly' && r.hard) Object.keys(r.subj).forEach(function (k) { pin[k] = 1; });
      if (r.type === 'subjDouble') Object.keys(r.subj).forEach(function (k) { dbl[k] = 1; });
    });
    var last = {};
    var R = { b: ttRules(), c: c, pin: pin, dbl: dbl,
      lastP: function (cls) { if (!(cls in last)) { var st = ttStageOf(cls); last[cls] = st ? ttPTimes(st).length : ttPeriods(); } return last[cls]; } };
    if (!list) ttRSCache = { src: S.ttConfig, val: R };
    return R;
  }

  function ttPeriodsText(ps) {
    ps = ttNums(ps);
    return ps.length === 1 ? 'الحصة ' + ps[0] : 'الحصص ' + ps.join(' و');
  }

  // القاعدة بكلام مفهوم
  function ttRuleText(r) {
    var days = ttCfg().days, sub = splitList(r.subjects).join(' أو '), who = r.teacher_id ? ttTName(r.teacher_id) : 'كل معلم';
    var dn = ttNums(r.days).map(function (d) { return days[d]; }).filter(Boolean);
    switch (r.type) {
      case 'subjOnly': return 'حصص ' + sub + ' في ' + ttPeriodsText(r.periods) + ' فقط';
      case 'subjNot': return 'حصص ' + sub + ' ليست في ' + ttPeriodsText(r.periods);
      case 'subjDayMax': return sub + ' لا تزيد في الشعبة عن ' + (Number(r.n) || 0) + ' في اليوم';
      case 'subjDouble': return 'حصص ' + sub + ' حصتان متتاليتان في اليوم نفسه';
      case 'teacherOff': return ttTName(r.teacher_id) + ' غير متاح ' + (dn.length ? 'يوم ' + dn.join(' و') : 'كل الأيام') + (ttNums(r.periods).length ? ' في ' + ttPeriodsText(r.periods) : '');
      case 'tDaysMin': return who + ': أيام الدوام لا تقل عن ' + (Number(r.n) || 0);
      case 'tDaysMax': return who + ': أيام الدوام لا تزيد عن ' + (Number(r.n) || 0);
      case 'tLastMax': return who + ': الحصص الأخيرة في الأسبوع لا تزيد عن ' + (Number(r.n) || 0);
      case 'tFirstMin': return who + ': الحصص الأولى في الأسبوع لا تقل عن ' + (Number(r.n) || 0);
    }
    return '';
  }

  // تقييم جدول معلم: القواعد الأساسية وقواعد المعلم من «قواعدي».
  // soft: الدرجة (مجموع المخالفات بأوزانها)، hard: مخالفات القواعد الملزمة، checks: الفحوص لكل قاعدة [المستوفى، الكل]
  // lean: بلا نصوص (للبحث، حيث يُقيَّم آلاف المرات)
  function ttEvalT(tid, list, R, NP, lean) {
    var b = R.b, days = {}, parts = { run: 0, day: 0, side: 0, gaps: 0 }, out = { soft: 0, hard: 0, notes: [], checks: {}, bad: {} }, dn = lean ? null : ttCfg().days;
    var chk = function (id, ok) { var c = out.checks[id] || (out.checks[id] = [0, 0]); c[1]++; if (ok) c[0]++; };
    list.forEach(function (s) { (days[s.day] || (days[s.day] = {}))[s.period] = 1; });
    Object.keys(days).forEach(function (d) {
      var ps = Object.keys(days[d]).map(Number).sort(function (a, c) { return a - c; }), run = 1, best = 1;
      for (var i = 1; i < ps.length; i++) { run = ps[i] === ps[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); }
      if (b.run.on && best > b.run.v) { parts.run += best - b.run.v; lean || out.notes.push(best + ' حصص متتالية يوم ' + dn[d]); }
      if (b.day.on && ps.length > b.day.v) { parts.day += ps.length - b.day.v; lean || out.notes.push(ps.length + ' حصص يوم ' + dn[d]); }
      var gaps = ps.length ? ps[ps.length - 1] - ps[0] + 1 - ps.length : 0;
      if (b.gaps.on && gaps > b.gaps.v) { parts.gaps += gaps - b.gaps.v; lean || out.notes.push(gaps + ' حصص فراغ يوم ' + dn[d]); }
    });
    // التكتل يُقاس على غير المواد المقيدة بحصص معيّنة (القرآن أول اليوم بالشرط لا بسوء التوزيع)
    var free = list.filter(function (s) { return !R.pin[ttSubjKey(s.subject)]; });
    if (b.side.on && free.length >= 4) {
      var half = NP / 2, early = free.filter(function (s) { return s.period <= half; }).length, late = free.length - early;
      var cap = Math.ceil(free.length * b.side.v / 100), more = Math.max(early, late);
      if (more > cap) { parts.side = more - cap; lean || out.notes.push(more + ' من ' + free.length + ' حصة في ' + (late > early ? 'آخر اليوم' : 'أول اليوم')); }
    }
    Object.keys(parts).forEach(function (k) { out.soft += parts[k] * TT_WEIGHT[k]; if (list.length && b[k].on) chk(k, !parts[k]); });
    R.c.forEach(function (r) {
      if (TT_RTYPES[r.type].scope !== 'teacher') return;
      if (r.type === 'teacherOff' ? r.teacher_id !== tid : r.teacher_id && r.teacher_id !== tid) return;
      if (!list.length) return;
      var v = 0, txt = '', nd = Object.keys(days).length;
      if (r.type === 'teacherOff') {
        list.forEach(function (s) {
          if ((!r.nd || r.days[s.day]) && (!r.np || r.periods[s.period])) { v++; if (!lean) (out.bad[s.id] || (out.bad[s.id] = [])).push({ hard: r.hard, text: ttRuleText(r.raw) }); }
        });
        txt = ttCount(v) + ' في وقت غير متاح';
      } else if (r.type === 'tDaysMin') { v = Math.max(0, Math.min(r.n, list.length) - nd); txt = 'أيام الدوام ' + nd + ' والأقل ' + r.n; }
      else if (r.type === 'tDaysMax') { v = Math.max(0, nd - r.n); txt = 'أيام الدوام ' + nd + ' والأكثر ' + r.n; }
      else if (r.type === 'tLastMax') { var l = list.filter(function (s) { return s.period === R.lastP(s.class_name); }).length; v = Math.max(0, l - r.n); txt = l + ' حصص أخيرة في الأسبوع والأقصى ' + r.n; }
      else { var f1 = list.filter(function (s) { return s.period === 1; }).length; v = Math.max(0, Math.min(r.n, list.length) - f1); txt = f1 + ' حصص أولى في الأسبوع والأقل ' + r.n; }
      chk(r.id, !v);
      if (!v) return;
      if (r.hard) out.hard += v; else out.soft += v * r.w;
      lean || out.notes.push((r.hard ? 'قاعدة ملزمة: ' : '') + txt);
    });
    out.score = out.soft;
    return out;
  }

  // تقييم جدول شعبة بقواعد المواد من «قواعدي»؛ bad: الحصص المخالفة لكل منها
  function ttEvalC(cls, list, R, lean) {
    var out = { soft: 0, hard: 0, notes: [], checks: {}, bad: {} };
    var chk = function (id, ok) { var c = out.checks[id] || (out.checks[id] = [0, 0]); c[1]++; if (ok) c[0]++; };
    R.c.forEach(function (r) {
      if (TT_RTYPES[r.type].scope !== 'class') return;
      var mine = list.filter(function (s) { return r.subj[ttSubjKey(s.subject)]; }), v = 0, txt = '';
      if (!mine.length) return;
      if (r.type === 'subjOnly' || r.type === 'subjNot') {
        mine.forEach(function (s) {
          var badL = r.type === 'subjOnly' ? !r.periods[s.period] : !!r.periods[s.period];
          chk(r.id, !badL);
          if (badL) { v++; if (!lean) (out.bad[s.id] || (out.bad[s.id] = [])).push({ hard: r.hard, text: ttRuleText(r.raw) }); }
        });
        txt = ttCount(v) + ' تخالف: ' + (lean ? '' : ttRuleText(r.raw));
      } else if (r.type === 'subjDayMax') {
        var cnt = {};
        mine.forEach(function (s) { cnt[s.day] = (cnt[s.day] || 0) + 1; });
        Object.keys(cnt).forEach(function (d) { v += Math.max(0, cnt[d] - r.n); });
        chk(r.id, !v);
        txt = ttCount(v) + ' زائدة: ' + (lean ? '' : ttRuleText(r.raw));
      } else {
        // حصص المادة غير المجاورة لحصة منها في اليوم نفسه؛ واحدة منفردة مقبولة إن كان عددها فرديًا
        var bySub = {};
        mine.forEach(function (s) { var k = ttSubjKey(s.subject); (bySub[k] || (bySub[k] = [])).push(s); });
        Object.keys(bySub).forEach(function (k) {
          var ls = bySub[k], single = ls.filter(function (s) { return !ls.some(function (x) { return x !== s && x.day === s.day && Math.abs(x.period - s.period) === 1; }); }).length;
          var e = Math.max(0, single - ls.length % 2);
          v += e;
          chk(r.id, !e);
        });
        txt = ttCount(v) + ' منفردة: ' + (lean ? '' : ttRuleText(r.raw));
      }
      if (!v) return;
      if (r.hard) out.hard += v; else out.soft += v * r.w;
      lean || out.notes.push((r.hard ? 'قاعدة ملزمة — ' : '') + 'الصف ' + cls + ': ' + txt);
    });
    return out;
  }

  // تقييم الجدول كله (أو نسخة منه): لكل معلم وشعبة، والمجاميع، ونسبة الالتزام، والحصص المخالفة
  function ttEvalAll(list, R) {
    list = list || ttLive(); R = R || ttRuleSet();
    var NP = ttPeriods(), byT = {}, byC = {}, res = { t: {}, c: {}, hard: 0, soft: 0, ok: 0, total: 0, per: {}, bad: {} };
    list.forEach(function (s) {
      if (s.teacher_id) (byT[s.teacher_id] || (byT[s.teacher_id] = [])).push(s);
      (byC[s.class_name] || (byC[s.class_name] = [])).push(s);
    });
    var add = function (e) {
      res.hard += e.hard; res.soft += e.soft;
      Object.keys(e.checks).forEach(function (k) { var p = res.per[k] || (res.per[k] = [0, 0]); p[0] += e.checks[k][0]; p[1] += e.checks[k][1]; res.ok += e.checks[k][0]; res.total += e.checks[k][1]; });
      Object.keys(e.bad).forEach(function (id) { res.bad[id] = (res.bad[id] || []).concat(e.bad[id]); });
    };
    Object.keys(byT).forEach(function (t) { add(res.t[t] = ttEvalT(t, byT[t], R, NP)); });
    Object.keys(byC).forEach(function (c) { add(res.c[c] = ttEvalC(c, byC[c], R)); });
    // قواعد الأيام والحصص الأولى/الأخيرة لمعلم بعينه ليست له حصص بعد: لا تُفحص
    return res;
  }
  // «حصة واحدة»، «حصتان»، «3 حصص»، «11 حصة»
  function ttCount(n) { return n === 1 ? 'حصة واحدة' : n === 2 ? 'حصتان' : n <= 10 ? n + ' حصص' : n + ' حصة'; }
  function ttPct(ok, total) { return total ? Math.round(ok / total * 1000) / 10 : 100; }

  // مخالفات حصة واحدة (للتحذير عند التعديل وتعليم الخانة): قواعد المادة والحصة، وعدم إتاحة المعلم
  function ttLessonIssues(s) {
    var R = ttRuleSet(), out = [];
    R.c.forEach(function (r) {
      if ((r.type === 'subjOnly' || r.type === 'subjNot') && r.subj[ttSubjKey(s.subject)] && (r.type === 'subjOnly' ? !r.periods[s.period] : !!r.periods[s.period])) out.push({ hard: r.hard, text: ttRuleText(r.raw) });
      if (r.type === 'teacherOff' && s.teacher_id && r.teacher_id === s.teacher_id && (!r.nd || r.days[s.day]) && (!r.np || r.periods[s.period])) out.push({ hard: r.hard, text: ttRuleText(r.raw) });
    });
    return out;
  }
  function ttLessonHard(s) { return ttLessonIssues(s).some(function (x) { return x.hard; }); }

  function ttQuota() { return S.ttConfig && Array.isArray(S.ttConfig.quota) ? S.ttConfig.quota : []; }

  // تكرار المادة في الشعبة في اليوم نفسه: لا يُقبل تبديل يزيده (إلا مواد «حصتان متتاليتان»)
  function ttRepeats(list, R) {
    var c = {}, n = 0;
    list.forEach(function (s) { var k = ttSubjKey(s.subject); if (R && R.dbl[k]) return; k = s.day + '|' + k; c[k] = (c[k] || 0) + 1; });
    Object.keys(c).forEach(function (k) { if (c[k] > 1) n += c[k] - 1; });
    return n;
  }

  /* --- النصاب --- */
  function ttQKey(c, s, t) { return c + '\u0001' + s + '\u0001' + (t || ''); }
  function ttActualLoad() {
    var a = {};
    ttLive().forEach(function (s) { var k = ttQKey(s.class_name, s.subject, s.teacher_id); a[k] = (a[k] || 0) + 1; });
    return a;
  }
  // الاختلافات عن النصاب: [{ class_name, subject, teacher_id, need, got }]
  function ttQuotaDiff() {
    var q = ttQuota();
    if (!q.length) return [];
    var a = ttActualLoad(), seen = {}, out = [];
    q.forEach(function (r) {
      var k = ttQKey(r.class_name, r.subject, r.teacher_id);
      seen[k] = (seen[k] || 0) + Number(r.count || 0);
    });
    Object.keys(seen).forEach(function (k) { if ((a[k] || 0) !== seen[k]) out.push(k); });
    Object.keys(a).forEach(function (k) { if (seen[k] == null) out.push(k); });
    return out.map(function (k) { var p = k.split('\u0001'); return { class_name: p[0], subject: p[1], teacher_id: p[2], need: seen[k] || 0, got: a[k] || 0 }; })
      .sort(function (x, y) { var c = ttClasses(); return c.indexOf(x.class_name) - c.indexOf(y.class_name) || x.subject.localeCompare(y.subject, 'ar'); });
  }

  function ttQuotaHtml() {
    if (S.ttPlanMissing) return ttPlanMissingHtml();
    var draft = ui.ttQuota || (ui.ttQuota = JSON.parse(JSON.stringify(ttQuota())));
    var classes = ttClasses();
    if (classes.indexOf(ui.ttQClass) < 0) ui.ttQClass = classes[0];
    var c = ui.ttQClass, edit = canEditTT(), a = ttActualLoad(), cfg = ttCfg();
    var subs = cfg.subjects.slice();
    ttLive().forEach(function (s) { if (subs.indexOf(s.subject) < 0) subs.push(s.subject); });
    var opt = function (v, l, cur) { return '<option value="' + esc(v) + '"' + (String(v) === String(cur || '') ? ' selected' : '') + '>' + esc(l) + '</option>'; };
    var need = {};
    draft.forEach(function (r) { var k = ttQKey(r.class_name, r.subject, r.teacher_id); need[k] = (need[k] || 0) + Number(r.count || 0); });
    var rows = draft.map(function (r, i) { return { r: r, i: i }; }).filter(function (x) { return x.r.class_name === c; }).map(function (x) {
      var r = x.r, got = a[ttQKey(r.class_name, r.subject, r.teacher_id)] || 0, ok = got === need[ttQKey(r.class_name, r.subject, r.teacher_id)];
      var s2 = subs.slice();
      if (r.subject && s2.indexOf(r.subject) < 0) s2.push(r.subject);
      return '<tr><td>' + (edit ? '<select data-tq="' + x.i + '" data-f="subject">' + opt('', '— المادة —', r.subject) + s2.map(function (s) { return opt(s, s, r.subject); }).join('') + '</select>' : esc(r.subject)) + '</td>' +
        '<td>' + (edit ? '<select data-tq="' + x.i + '" data-f="teacher_id">' + opt('', 'بدون معلم', r.teacher_id) + ttTeacherChoices(r.teacher_id).map(function (t) { return opt(t.id, ttName(t), r.teacher_id); }).join('') + '</select>' : esc(ttTName(r.teacher_id))) + '</td>' +
        '<td>' + (edit ? '<input type="number" min="0" max="30" step="1" data-tq="' + x.i + '" data-f="count" value="' + esc(r.count) + '" style="width:5em">' : esc(r.count)) + '</td>' +
        '<td style="white-space:nowrap">' + got + '</td><td>' + (ok ? '<span class="badge approved">مطابق</span>' : '<span class="badge unpaid">في الجدول ' + got + '</span>') + '</td>' +
        (edit ? '<td><button type="button" class="btn danger" data-tqdel="' + x.i + '" title="حذف السطر">×</button></td>' : '') + '</tr>';
    }).join('');
    // ما في الجدول لهذه الشعبة وليس في النصاب
    var extra = Object.keys(a).filter(function (k) { return k.split('\u0001')[0] === c && need[k] == null; }).map(function (k) {
      var p = k.split('\u0001');
      return '<tr style="background:var(--amber-soft)"><td>' + esc(p[1]) + '</td><td>' + esc(ttTName(p[2])) + '</td><td>—</td><td>' + a[k] + '</td><td><span class="badge edit">ليست في النصاب</span></td>' + (edit ? '<td></td>' : '') + '</tr>';
    }).join('');
    var sumNeed = draft.filter(function (r) { return r.class_name === c; }).reduce(function (t, r) { return t + Number(r.count || 0); }, 0);
    var sumGot = ttLive().filter(function (s) { return s.class_name === c; }).length;
    // نصاب كل معلم: مجموع حصصه في النصاب وفي الجدول
    var tl = {};
    draft.forEach(function (r) { if (r.teacher_id) (tl[r.teacher_id] || (tl[r.teacher_id] = { need: 0, got: 0 })).need += Number(r.count || 0); });
    ttLive().forEach(function (s) { if (s.teacher_id) (tl[s.teacher_id] || (tl[s.teacher_id] = { need: 0, got: 0 })).got++; });
    var tRows = Object.keys(tl).map(function (id) { return { id: id, x: tl[id] }; }).sort(function (p, q) { var a = find(p.id), b = find(q.id); return a && b ? ttTeacherCmp(a, b) : ttTName(p.id).localeCompare(ttTName(q.id), 'ar'); }).map(function (p) {
      return '<tr><td>' + esc(ttTName(p.id)) + '</td><td>' + p.x.need + '</td><td>' + p.x.got + '</td><td>' + (p.x.need === p.x.got ? '<span class="badge approved">مطابق</span>' : '<span class="badge unpaid">فرق ' + (p.x.got - p.x.need > 0 ? '+' : '') + (p.x.got - p.x.need) + '</span>') + '</td></tr>';
    }).join('');
    var diff = ttQuotaDiff().length, dirty = JSON.stringify(draft) !== JSON.stringify(ttQuota());
    return '<div class="card"><h2>توزيع النصاب</h2><p class="hint">لكل شعبة: المواد، وعدد حصص كل مادة في الأسبوع، ومعلمها. يُقارن الجدول بالنصاب، وكل اختلاف يظهر هنا وفي «المراجعة».' +
        (draft.length ? (diff ? ' <b style="color:var(--red)">اختلافات في الجدول: ' + diff + '</b>' : ' <b style="color:var(--green)">الجدول مطابق للنصاب.</b>') : ' لم يُدخل النصاب بعد.') + '</p>' +
        (edit ? '<div class="toolbar" style="margin:0 0 10px"><button type="button" class="btn primary" data-tqsave' + (dirty ? '' : ' disabled') + '>حفظ النصاب</button>' +
          (dirty ? '<button type="button" class="btn" data-tqreset>تراجع عن التعديلات</button>' : '') +
          '<button type="button" class="btn" data-tqfill>تعبئة من الجدول الحالي</button></div>' : '') +
        ttPicker('c', classes, c, { ids: {} }).replace(/data-ttpick="c"/g, 'data-tqpick="c"') +
        '<div class="table-wrap"><table class="grid"><thead><tr><th>المادة</th><th>المعلم</th><th>النصاب الأسبوعي</th><th>في الجدول</th><th>الحالة</th>' + (edit ? '<th></th>' : '') + '</tr></thead><tbody>' +
        (rows + extra || '<tr><td colspan="6" class="hint">لا يوجد نصاب لهذه الشعبة.</td></tr>') +
        '</tbody><tfoot><tr><td colspan="2"><b>المجموع</b></td><td><b>' + sumNeed + '</b></td><td><b>' + sumGot + '</b></td><td colspan="2"></td></tr></tfoot></table></div>' +
        (edit ? '<button type="button" class="btn" data-tqadd style="margin-top:8px">+ مادة لهذه الشعبة</button>' : '') + '</div>' +
      (tRows ? '<div class="card"><h2>نصاب المعلمين</h2><div class="table-wrap"><table class="grid"><thead><tr><th>المعلم</th><th>في النصاب</th><th>في الجدول</th><th>الحالة</th></tr></thead><tbody>' + tRows + '</tbody></table></div></div>' : '') +
      qzHtml() + ttRulesHtml();
  }

  /* ----- توزيع حصص القرآن الكريم تلقائيًا -----
     تُدخل: المعلم والصف وعدد الحصص الأسبوعية. يضع البرنامج الحصص في «أول حصتين» من اليوم فقط، بلا تعارض لمعلم ولا لصف،
     وإن كانت الخانة مشغولة بمادة أخرى فيُنقل درسها إلى خانة فارغة من الصف نفسه يكون معلمه فيها متفرغًا.
     لا يُحفظ شيء قبل المعاينة والاعتماد. تُستبدل كل حصص القرآن للصفوف المُدخلة، فيجب أن تكون كل حصصها في الإدخال */
  function qzUi() { return ui.qz || (ui.qz = { rows: null, plan: null, busy: false }); }
  function qzIsQuran(subject) { return norm(ttFixSubject(subject)) === norm('قرآن'); }
  function qzRows() {
    var u = qzUi();
    if (u.rows) return u.rows;
    var by = {};
    ttQuota().forEach(function (r) { if (qzIsQuran(r.subject) && r.teacher_id) { var k = r.teacher_id + '|' + r.class_name; by[k] = (by[k] || 0) + Number(r.count || 0); } });
    if (!Object.keys(by).length) ttLive().forEach(function (x) { if (qzIsQuran(x.subject) && x.teacher_id) { var k = x.teacher_id + '|' + x.class_name; by[k] = (by[k] || 0) + 1; } });
    u.rows = Object.keys(by).map(function (k) { var p = k.split('|'); return { tid: p[0], cls: p[1], count: by[k] }; });
    return u.rows;
  }
  function qzLastPeriod(cls) { var st = ttStageOf(cls); return st ? ttPTimes(st).length : ttPeriods(); }

  // يبني الخطة: { placements, moves, failed, note }
  function qzSolve(rows) {
    var days = ttCfg().days.length, classes = {}, ok = rows.filter(function (r) { return r.tid && r.cls && Number(r.count) > 0; });
    ok.forEach(function (r) { classes[r.cls] = 1; });
    var kept = ttLive().filter(function (x) { return !(classes[x.class_name] && qzIsQuran(x.subject)); });
    var oldQ = ttLive().filter(function (x) { return classes[x.class_name] && qzIsQuran(x.subject); });
    var slot = function (d, p) { return d * 100 + p; };
    var cls = {}, teach = {};     // الصف: { slot: حصة }، المعلم: { slot: true }
    kept.forEach(function (x) {
      (cls[x.class_name] || (cls[x.class_name] = {}))[slot(x.day, x.period)] = x;
      if (x.teacher_id) (teach[x.teacher_id] || (teach[x.teacher_id] = {}))[slot(x.day, x.period)] = true;
    });
    Object.keys(classes).forEach(function (c) { cls[c] = cls[c] || {}; });
    // حصص القرآن المطلوبة، الأشد ازدحامًا أولًا (معلم له صفوف كثيرة)
    var load = {};
    ok.forEach(function (r) { load[r.tid] = (load[r.tid] || 0) + Number(r.count); });
    var lessons = [];
    ok.forEach(function (r) { for (var i = 0; i < Number(r.count); i++) lessons.push({ cls: r.cls, tid: r.tid }); });
    lessons.sort(function (a, b) { return load[b.tid] - load[a.tid] || (a.tid < b.tid ? -1 : 1); });
    // تحقق مسبق: لا يتسع لمعلم أكثر من (الأيام × 2) ولا لصف
    var bad = [];
    Object.keys(load).forEach(function (t) { if (load[t] > days * 2) bad.push(ttTName(t) + ': ' + load[t] + ' حصة، والمتاح ' + (days * 2) + ' (أول حصتين في ' + days + ' أيام)'); });
    var perCls = {};
    ok.forEach(function (r) { perCls[r.cls] = (perCls[r.cls] || 0) + Number(r.count); });
    Object.keys(perCls).forEach(function (c) { if (perCls[c] > days) bad.push('الصف ' + c + ': ' + perCls[c] + ' حصص قرآن في الأسبوع، والمسموح حصة واحدة في اليوم فقط (' + days + ' حصص كحد أقصى)'); });
    if (bad.length) return { failed: bad };
    var placed = [], moves = [], qdayCount = {}, nodes = 0, LIMIT = 300000;
    var teacherFree = function (t, sl) { return !t || !(teach[t] && teach[t][sl]); };
    // نقل درس شاغل إلى خانة فارغة في صفه (بأي حصة)، يفضَّل ألا تتكرر مادته في اليوم نفسه
    function relocate(x, from) {
      var maxP = qzLastPeriod(x.class_name), best = null, bestScore = 1e9;
      for (var d = 0; d < days; d++) for (var p = 1; p <= maxP; p++) {
        var sl = slot(d, p);
        if (sl === from || cls[x.class_name][sl]) continue;
        if (!teacherFree(x.teacher_id, sl)) continue;
        if (p <= 2 && d !== undefined && qzWanted[x.class_name + '|' + sl]) continue;
        var same = 0;
        for (var q = 1; q <= maxP; q++) { var o = cls[x.class_name][slot(d, q)]; if (o && ttSubjKey(o.subject) === ttSubjKey(x.subject)) same++; }
        var score = same * 10 + (p <= 2 ? 5 : 0) + Math.abs(p - x.period) + Math.abs(d - x.day) * .1;
        if (score < bestScore) { bestScore = score; best = sl; }
      }
      return best;
    }
    var qzWanted = {};
    function dfs(i) {
      if (i === lessons.length) return true;
      if (++nodes > LIMIT) return false;
      var L = lessons[i], cands = [];
      for (var d = 0; d < days; d++) for (var p = 1; p <= 2; p++) {
        var sl = slot(d, p);
        if (!teacherFree(L.tid, sl)) continue;
        var occ = cls[L.cls][sl];
        if (occ && qzIsQuran(occ.subject) && occ.__new) continue;
        var dayHas = qdayCount[L.cls + '|' + d] || 0;
        if (dayHas > 0) continue; // حصة قرآن واحدة للصف في اليوم، ولا تتكرر أبدًا
        cands.push({ d: d, p: p, sl: sl, occ: occ && !occ.__new ? occ : null, score: dayHas * 20 + (occ ? 6 : 0) + p });
      }
      cands.sort(function (a, b) { return a.score - b.score; });
      for (var c = 0; c < cands.length; c++) {
        var cd = cands[c], moved = null, to = null;
        if (cd.occ) {
          qzWanted[L.cls + '|' + cd.sl] = 1;
          to = relocate(cd.occ, cd.sl);
          if (to == null) { delete qzWanted[L.cls + '|' + cd.sl]; continue; }
          moved = cd.occ;
          delete cls[L.cls][cd.sl];
          if (moved.teacher_id && teach[moved.teacher_id]) delete teach[moved.teacher_id][cd.sl];
          cls[L.cls][to] = Object.assign({}, moved, { __moved: true });
          if (moved.teacher_id) (teach[moved.teacher_id] || (teach[moved.teacher_id] = {}))[to] = true;
        } else qzWanted[L.cls + '|' + cd.sl] = 1;
        var q = { id: 'new', class_name: L.cls, subject: 'قرآن', teacher_id: L.tid, day: cd.d, period: cd.p, __new: true };
        cls[L.cls][cd.sl] = q;
        (teach[L.tid] || (teach[L.tid] = {}))[cd.sl] = true;
        qdayCount[L.cls + '|' + cd.d] = (qdayCount[L.cls + '|' + cd.d] || 0) + 1;
        placed.push({ cls: L.cls, tid: L.tid, day: cd.d, period: cd.p });
        if (moved) moves.push({ s: moved, to: to });
        if (dfs(i + 1)) return true;
        if (moved) moves.pop();
        placed.pop();
        qdayCount[L.cls + '|' + cd.d]--;
        delete teach[L.tid][cd.sl];
        delete cls[L.cls][cd.sl];
        delete qzWanted[L.cls + '|' + cd.sl];
        if (moved) {
          delete cls[L.cls][to];
          if (moved.teacher_id) delete teach[moved.teacher_id][to];
          cls[L.cls][cd.sl] = moved;
          if (moved.teacher_id) teach[moved.teacher_id][cd.sl] = true;
        }
      }
      return false;
    }
    var solved = dfs(0);
    if (!solved) return { failed: ['تعذّر إيجاد توزيع بلا تعارض ضمن أول حصتين' + (nodes > LIMIT ? ' (بعد بحث طويل)' : '') + '. قلّل حصص أحد المعلمين أو وزّع صفوفهم على معلمين آخرين.'] };
    return { placements: placed.slice(), moves: moves.map(function (m) { return { s: m.s, to: m.to }; }), old: oldQ, classes: Object.keys(classes) };
  }

  function qzSlotText(sl) { var d = Math.floor(sl / 100), p = sl % 100; return ttCfg().days[d] + ' · الحصة ' + (TT_ORD[p - 1] || p); }

  function qzHtml() {
    if (S.ttPlanMissing && S.ttMissing) return '';
    var u = qzUi(), edit = canEditTT(), rows = qzRows(), cl = ttClasses();
    var opt = function (v, l, cur) { return '<option value="' + esc(v) + '"' + (String(v) === String(cur || '') ? ' selected' : '') + '>' + esc(l) + '</option>'; };
    var teachers = ttTeacherChoices('').filter(function (t) { return ttIsQuranT(t) || t.category === 'محفظون'; });
    var all = ttTeacherChoices('');
    var body = rows.map(function (r, i) {
      return '<tr><td>' + (edit ? '<select data-qz="' + i + '" data-f="tid">' + opt('', '— المعلم —', r.tid) + (teachers.length ? teachers : all).concat(all.filter(function (t) { return teachers.indexOf(t) < 0 && t.id === r.tid; })).map(function (t) { return opt(t.id, ttName(t), r.tid); }).join('') + '</select>' : esc(ttTName(r.tid))) + '</td>' +
        '<td>' + (edit ? '<select data-qz="' + i + '" data-f="cls">' + opt('', '— الصف —', r.cls) + cl.map(function (c) { return opt(c, c, r.cls); }).join('') + '</select>' : esc(r.cls)) + '</td>' +
        '<td>' + (edit ? '<input type="number" min="1" max="10" step="1" data-qz="' + i + '" data-f="count" value="' + esc(r.count) + '" style="width:5em">' : esc(r.count)) + '</td>' +
        (edit ? '<td><button type="button" class="btn danger" data-qzdel="' + i + '">×</button></td>' : '') + '</tr>';
    }).join('');
    var plan = u.plan, out = '';
    if (plan && plan.failed) out = '<div class="formhint" style="margin-top:10px"><b>لا يمكن التوزيع:</b><br>' + plan.failed.map(esc).join('<br>') + '</div>';
    else if (plan) {
      var byCls = {};
      plan.placements.forEach(function (p) { (byCls[p.cls] || (byCls[p.cls] = [])).push(p); });
      out = '<div style="margin-top:12px"><h3 style="margin:0 0 6px">المعاينة: ' + plan.placements.length + ' حصة قرآن' + (plan.moves.length ? '، وتُنقل ' + plan.moves.length + ' حصة من مواد أخرى' : '') + '</h3>' +
        '<div class="table-wrap"><table class="grid"><thead><tr><th>الصف</th><th>حصص القرآن (اليوم · الحصة · المعلم)</th></tr></thead><tbody>' +
        Object.keys(byCls).sort(function (a, b) { return cl.indexOf(a) - cl.indexOf(b); }).map(function (c) {
          return '<tr><td><b>' + esc(c) + '</b></td><td>' + byCls[c].sort(function (a, b) { return a.day - b.day || a.period - b.period; }).map(function (p) { return esc(ttCfg().days[p.day] + ' ' + (TT_ORD[p.period - 1] || p.period) + ' — ' + ttTName(p.tid)); }).join('<br>') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        (plan.moves.length ? '<h3 style="margin:12px 0 6px">دروس تُنقل من مكانها</h3><div class="table-wrap"><table class="grid"><thead><tr><th>الصف</th><th>المادة · المعلم</th><th>من</th><th>إلى</th></tr></thead><tbody>' +
          plan.moves.map(function (m) { return '<tr><td>' + esc(m.s.class_name) + '</td><td>' + esc(m.s.subject) + ' · ' + esc(ttTName(m.s.teacher_id)) + '</td><td>' + esc(qzSlotText(m.s.day * 100 + m.s.period)) + '</td><td>' + esc(qzSlotText(m.to)) + '</td></tr>'; }).join('') +
          '</tbody></table></div>' : '') +
        (edit ? '<div class="actions" style="align-items:center"><button type="button" class="btn primary" data-qzapply' + (u.busy ? ' disabled' : '') + '>' + (u.busy ? 'جارٍ الإعداد…' : 'تحويله إلى مقترح للاعتماد') + '</button>' +
          '<label class="check" style="margin:0"><input type="checkbox" data-qzimp' + (u.improve === false ? '' : ' checked') + '> محاولة تحسين المقترح (تبديلات إضافية لا تُسيء لجدول أحد)</label></div>' +
          '<p class="hint" style="margin:6px 0 0">لا يتغير الجدول الآن: يُحفظ مقترحًا في «تحسين الجدول» تراجعه وتعتمده أو ترفضه.</p>' : '') + '</div>';
    }
    return '<div class="card"><h2>توزيع حصص القرآن الكريم</h2><p class="hint">أدخل لكل معلم الصفوف التي يدرّسها وعدد حصصه الأسبوعية، فيضع البرنامج حصص القرآن في <b>أول حصتين</b> فقط من اليوم بلا تعارض. ' +
      'ما شغل خانةً من مادة أخرى يُنقل درسه إلى خانة فارغة في الصف نفسه. تُستبدل كل حصص القرآن للصفوف المُدخلة، فأدخل كل معلميها. لا يتغير الجدول مباشرة: يُحفظ مقترحًا في «تحسين الجدول» يُعتمد منه.</p>' +
      '<div class="table-wrap"><table class="grid"><thead><tr><th>المعلم</th><th>الصف</th><th>حصص الأسبوع</th>' + (edit ? '<th></th>' : '') + '</tr></thead><tbody>' + (body || '<tr><td colspan="4" class="hint">لا توجد صفوف بعد.</td></tr>') + '</tbody></table></div>' +
      (edit ? '<div class="toolbar" style="margin-top:8px"><button type="button" class="btn" data-qzadd>+ سطر (معلم وصف)</button><button type="button" class="btn primary" data-qzsolve>معاينة التوزيع</button></div>' : '') + out + '</div>';
  }

  // يحوّل الخطة إلى تغييرات اقتراح: حصص القرآن القائمة تُنقل (لكل صف ومعلم)، والناقص يُضاف، والزائد يُحذف، والدروس المزاحة تُنقل
  function qzChanges(plan) {
    var pool = {}, changes = [], n = 0;
    plan.old.forEach(function (x) { (pool[x.class_name + '|' + x.teacher_id] || (pool[x.class_name + '|' + x.teacher_id] = [])).push(x); });
    plan.placements.forEach(function (p) {
      var list = pool[p.cls + '|' + p.tid], ex = list && list.shift();
      if (ex) { if (ex.day !== p.day || ex.period !== p.period) changes.push({ id: ex.id, from: { d: ex.day, p: ex.period }, to: { d: p.day, p: p.period } }); }
      else changes.push({ id: 'add' + (++n), add: { class_name: p.cls, teacher_id: p.tid, subject: 'قرآن' }, to: { d: p.day, p: p.period } });
    });
    Object.keys(pool).forEach(function (k) { pool[k].forEach(function (x) { changes.push({ id: x.id, from: { d: x.day, p: x.period }, rm: true }); }); });
    plan.moves.forEach(function (m) { changes.push({ id: m.s.id, from: { d: m.s.day, p: m.s.period }, to: { d: Math.floor(m.to / 100), p: m.to % 100 } }); });
    // حصتان تتبادلان المكان بين نقلتين: لا يلزم بقاء الأولى في الخانة التي صارت للثانية، فتُحسب الخانات النهائية فقط
    return changes;
  }

  // محاولة تحسين المقترح: يُشغَّل مُحسِّن الجدول على الجدول كما سيصير بعد التوزيع، ثم تُجمع تغييراته مع التوزيع نسبةً إلى الجدول الحالي
  function qzImprove(changes) {
    var orig = ttLive().map(function (x) { return Object.assign({}, x); }), saved = S.ttSessions;
    var after = ttWithChanges(changes).map(function (x) { return Object.assign({}, x); });
    var extra = [];
    try {
      S.ttSessions = after.concat(saved.filter(function (x) { return x.status === 'removed'; }));
      var res = ttOptimize('', 0);
      extra = res.changes;
      var pos = {};
      after.forEach(function (x) { pos[x.id] = { d: x.day, p: x.period }; });
      extra.forEach(function (c) { pos[c.id] = c.to; });
      var out = [];
      changes.forEach(function (c) {
        if (c.rm) { out.push(c); return; }
        if (c.add) { out.push({ id: c.id, add: c.add, to: pos[c.id] || c.to }); return; }
        out.push({ id: c.id, from: c.from, to: pos[c.id] || c.to });
      });
      var have = {};
      out.forEach(function (c) { have[c.id] = 1; });
      orig.forEach(function (x) { var q = pos[x.id]; if (!have[x.id] && q && (q.d !== x.day || q.p !== x.period)) out.push({ id: x.id, from: { d: x.day, p: x.period }, to: q }); });
      out = out.filter(function (c) { return c.add || c.rm || c.from.d !== c.to.d || c.from.p !== c.to.p; });
      return { changes: out, improved: extra.length };
    } finally { S.ttSessions = saved; }
  }

  async function qzMakeProposal() {
    var u = qzUi(), plan = u.plan;
    if (!plan || plan.failed || !canEditTT() || u.busy) return;
    var changes = qzChanges(plan), improved = 0;
    if (u.improve !== false) { try { var r = qzImprove(changes); changes = r.changes; improved = r.improved; } catch (err) { toast('تعذّر تحسين المقترح، حُفظ التوزيع كما هو', true); } }
    if (!changes.length) return toast('لا تغيير: حصص القرآن في مكانها المطلوب', true);
    if (ttConflicts(ttWithChanges(changes)).groups.length > ttConflicts().groups.length) return toast('تعذّر: التوزيع يصنع تعارضًا. أعد المعاينة.', true);
    var R = ttRuleSet(), ev0 = ttEvalAll(ttLive(), R), ev1 = ttEvalAll(ttWithChanges(changes), R), summary = {}, val = function (e) { return e ? e.hard * 1000 + e.soft : 0; };
    changes.forEach(function (c) { var s = ttChSession(c); if (s && s.teacher_id) summary[s.teacher_id] = { before: val(ev0.t[s.teacher_id]), after: val(ev1.t[s.teacher_id]) }; });
    u.busy = true; render();
    var row = { title: 'توزيع حصص القرآن في أول حصتين' + (improved ? ' (مُحسَّن)' : ''),
      goal: 'توزيع حصص القرآن في أول حصتين من اليوم بلا تعارض، مع نقل ما يلزم من حصص المواد الأخرى' + (improved ? '، ثم تحسين الجدول بعده (' + improved + ' تبديلًا إضافيًا) دون أن يسوء جدول أحد' : '') + '.',
      teacher_id: null, changes: changes, summary: summary, status: 'pending', created_by: ttWho() };
    var ins = await sb.from('timetable_proposals').insert(row).select().single();
    u.busy = false;
    if (ins.error) { render(); return fail(ins.error); }
    (S.ttProposals || (S.ttProposals = [])).unshift(ins.data || row);
    u.plan = null; u.rows = null;
    toast('حُفظ مقترحًا بانتظار الاعتماد: ' + changes.length + ' تغيير');
    go('#/timetable/improve');
  }

  document.addEventListener('click', function (e) {
    if (location.hash !== '#/timetable/quota' || !canEditTT()) return;
    var u = qzUi(), el;
    if (e.target.closest('[data-qzadd]')) { qzRows().push({ tid: '', cls: '', count: 5 }); u.plan = null; return render(); }
    if ((el = e.target.closest('[data-qzdel]'))) { qzRows().splice(+el.getAttribute('data-qzdel'), 1); u.plan = null; return render(); }
    if (e.target.closest('[data-qzsolve]')) {
      var rows = qzRows();
      if (!rows.some(function (r) { return r.tid && r.cls && Number(r.count) > 0; })) return toast('أدخل معلمًا وصفًا وعدد حصص', true);
      u.plan = qzSolve(rows);
      return render();
    }
    if (e.target.closest('[data-qzapply]')) return qzMakeProposal();
    if ((el = e.target.closest('[data-qzimp]'))) { u.improve = el.checked; return; }
  });
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/timetable/quota' || !e.target.hasAttribute || !e.target.hasAttribute('data-qz')) return;
    var r = qzRows()[+e.target.getAttribute('data-qz')], f = e.target.getAttribute('data-f');
    if (!r) return;
    r[f] = f === 'count' ? Number(e.target.value) || 0 : e.target.value;
    qzUi().plan = null;
    render();
  });

  // مسودة القواعد أثناء التعديل: { b: القواعد الأساسية، c: قواعدي }؛ لا يتغير شيء قبل «حفظ القواعد»
  function ttRuleDraft() {
    return ui.ttRuleDraft || (ui.ttRuleDraft = { b: JSON.parse(JSON.stringify(ttRules())), c: JSON.parse(JSON.stringify(ttCustomRules())) });
  }

  function ttRulesHtml() {
    var d = ttRuleDraft(), edit = canEditTT(), ev = ttEvalAll(), cfg = ttCfg(), NP = ttPeriods();
    var saved = {};
    ttCustomRules().forEach(function (r) { saved[r.id] = JSON.stringify(r); });
    var dirty = JSON.stringify(d) !== JSON.stringify({ b: ttRules(), c: ttCustomRules() });
    var dis = edit ? '' : ' disabled';
    var comp = function (id) {
      var p = ev.per[id];
      return p && p[1] ? '<span class="badge ' + (p[0] === p[1] ? 'approved' : 'edit') + '" title="الفحوص المستوفاة من كل الفحوص">' + ttPct(p[0], p[1]) + '% · ' + p[0] + ' من ' + p[1] + '</span>' : '';
    };
    var builtins = Object.keys(TT_RULES).map(function (k) {
      return '<div class="toolbar" style="align-items:center;margin:6px 0"><label class="check" style="padding:0;min-width:min(100%,460px)"><input type="checkbox" data-trb="' + k + '|on"' + (d.b[k].on ? ' checked' : '') + dis + '> ' + TT_RULES[k].label + '</label>' +
        '<input type="number" min="0" max="' + (k === 'side' ? 100 : 12) + '" data-trb="' + k + '|v" value="' + d.b[k].v + '" style="width:5em"' + dis + '> ' + TT_RULES[k].unit + ' ' + comp(k) + '</div>';
    }).join('');
    var subs = cfg.subjects.slice();
    ttLive().forEach(function (s) { if (subs.indexOf(s.subject) < 0) subs.push(s.subject); });
    var opt = function (v, l, cur) { return '<option value="' + esc(v) + '"' + (String(v) === String(cur == null ? '' : cur) ? ' selected' : '') + '>' + esc(l) + '</option>'; };
    var chips = function (i, f, n, label, list) {
      var on = ttNums(list);
      var items = [];
      for (var k = 0; k < n; k++) items.push(k);
      return '<span class="tt-chips" style="display:inline-flex">' + items.map(function (k) {
        var v = f === 'periods' ? k + 1 : k;
        return '<button type="button" data-trcx="' + i + '|' + f + '|' + v + '"' + (on.indexOf(v) > -1 ? ' class="on"' : '') + dis + '>' + esc(label(v)) + '</button>';
      }).join('') + '</span>';
    };
    var custom = d.c.map(function (r, i) {
      var T = TT_RTYPES[r.type] || {}, f = T.f || [];
      var field = function (label, html) { return '<span class="tt-rf"><span>' + label + '</span>' + html + '</span>'; };
      var body = f.map(function (k) {
        if (k === 'subjects') return field('المادة', '<input type="text" list="tt-subjlist" data-trc="' + i + '|subjects" value="' + esc(r.subjects || '') + '" placeholder="مثال: قرآن" style="width:13em"' + dis + ' title="أكثر من مادة: افصل بفاصلة">');
        if (k === 'periods') return field('الحصص', chips(i, 'periods', NP, function (v) { return v; }, r.periods));
        if (k === 'days') return field('الأيام', chips(i, 'days', cfg.days.length, function (v) { return cfg.days[v]; }, r.days));
        if (k === 'teacher') return field('المعلم', '<select data-trc="' + i + '|teacher_id"' + dis + '>' + opt('', '— اختر —', r.teacher_id) + ttTeacherChoices(r.teacher_id).map(function (t) { return opt(t.id, ttName(t), r.teacher_id); }).join('') + '</select>');
        if (k === 'teacherAll') return field('المعلم', '<select data-trc="' + i + '|teacher_id"' + dis + '>' + opt('', 'كل المعلمين', r.teacher_id) + ttTeacherChoices(r.teacher_id).map(function (t) { return opt(t.id, ttName(t), r.teacher_id); }).join('') + '</select>');
        if (k === 'n') return field('العدد', '<input type="number" min="0" max="30" data-trc="' + i + '|n" value="' + esc(r.n == null ? '' : r.n) + '" style="width:5em"' + dis + '>');
        return '';
      }).join('');
      return '<div class="tt-rule' + (r.on === false ? ' off' : '') + (r.level === 'hard' ? ' hard' : '') + '">' +
        '<div class="toolbar" style="align-items:center;margin:0 0 6px"><label class="check" style="padding:0"><input type="checkbox" data-trc="' + i + '|on"' + (r.on !== false ? ' checked' : '') + dis + '> <b>' + esc(T.label || r.type) + '</b></label>' +
          '<select data-trc="' + i + '|level" style="width:auto"' + dis + '>' + Object.keys(TT_LEVELS).map(function (k) { return opt(k, TT_LEVELS[k].label, r.level || 'mid'); }).join('') + '</select>' +
          (saved[r.id] === JSON.stringify(r) ? comp(r.id) : '<span class="badge new">لم تُحفظ</span>') +
          '<span style="flex:1"></span>' + (edit ? '<button type="button" class="btn danger" data-trdel="' + i + '" title="حذف القاعدة">×</button>' : '') + '</div>' +
        '<div class="toolbar" style="align-items:center;margin:0;gap:8px 14px">' + body + '</div>' +
        '<p class="hint" style="margin:6px 0 0">' + esc(ttRuleText(r)) + (T.hint ? ' · ' + esc(T.hint) : '') + '</p></div>';
    }).join('');
    return '<div class="card"><h2>قواعد الجدول الجيد</h2>' +
      '<div class="tt-comp"><b>نسبة الالتزام بالقواعد الآن: ' + ttPct(ev.ok, ev.total) + '%</b><span>' + ev.ok + ' من ' + ev.total + ' فحصًا مستوفى' + (ev.hard ? ' · <b style="color:var(--red)">مخالفات ملزمة: ' + ev.hard + '</b>' : ' · لا مخالفات ملزمة') + '</span></div>' +
      '<h3 style="margin:14px 0 4px">القواعد الأساسية</h3><p class="hint" style="margin:0 0 6px">تقيس جودة جدول كل معلم. «النصف الأول من اليوم» هو الحصص حتى منتصف الدوام.</p>' + builtins +
      '<h3 style="margin:18px 0 4px">قواعدي</h3><p class="hint" style="margin:0 0 8px">قواعد تضيفها من النماذج. <b>الملزمة</b> لا يقترح التحسين ما يزيد مخالفتها ولا يُعتمد؛ وغيرها يسعى التحسين لتقليل مخالفتها بقدر أولويتها، فيصل إلى أفضل ما يمكن. نسبة الالتزام لكل قاعدة بجانبها.</p>' +
      (custom || '<p class="hint">لا قواعد بعد.</p>') +
      '<datalist id="tt-subjlist">' + subs.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>' +
      (edit ? '<div class="toolbar" style="align-items:center;margin:10px 0 0"><select id="tt-newrule" style="width:auto;max-width:340px">' + Object.keys(TT_RTYPES).map(function (k) { return opt(k, TT_RTYPES[k].label, ''); }).join('') + '</select>' +
        '<button type="button" class="btn" data-traddrule>+ إضافة القاعدة</button><span style="flex:1"></span>' +
        (dirty ? '<button type="button" class="btn" data-trreset>تراجع عن التعديلات</button>' : '') +
        '<button type="button" class="btn primary" data-trulesave' + (dirty ? '' : ' disabled') + '>حفظ القواعد</button></div>' : '') + '</div>';
  }

  // التحقق قبل الحفظ: كل قاعدة مكتملة الخانات
  function ttRuleProblem(r) {
    var f = (TT_RTYPES[r.type] || {}).f || [];
    if (f.indexOf('subjects') > -1 && !splitList(r.subjects).length) return 'اكتب المادة في قاعدة «' + TT_RTYPES[r.type].label + '»';
    if (r.type === 'subjOnly' || r.type === 'subjNot') { if (!ttNums(r.periods).length) return 'اختر الحصص في قاعدة «' + TT_RTYPES[r.type].label + '»'; }
    if (f.indexOf('teacher') > -1 && !r.teacher_id) return 'اختر المعلم في قاعدة «' + TT_RTYPES[r.type].label + '»';
    if (r.type === 'teacherOff' && !ttNums(r.days).length && !ttNums(r.periods).length) return 'اختر الأيام أو الحصص في قاعدة «' + TT_RTYPES[r.type].label + '»';
    if (f.indexOf('n') > -1 && !(Number(r.n) >= 0 && String(r.n) !== '')) return 'اكتب العدد في قاعدة «' + TT_RTYPES[r.type].label + '»';
    return '';
  }

  function ttPlanMissingHtml() {
    return '<div class="card empty">هذا الجزء يحتاج تجهيز قاعدة البيانات أولًا.<br>شغّل الملف <code dir="ltr">supabase/timetable_plan.sql</code> في محرر SQL ثم حدّث الصفحة.</div>';
  }

  /* --- البحث عن تحسين --- */
  // tid: المعلم المراد تحسين جدوله، أو '' لكل المعلمين والشعب (يقلّ المجموع ولا يسوء جدول أحد).
  // القيمة: المخالفات الملزمة أولًا (×1000) ثم الدرجة. لا تزيد المخالفات الملزمة في أي جدول، ولا تسوء درجة غير الهدف عن بدايتها
  // tol: عند إصلاح مخالفة ملزمة يُقبل تراجع درجة كل معلم آخر حتى tol نقاط عن بدايتها (0: لا يسوء جدول أحد)
  function ttOptimize(tid, tol) {
    tol = Number(tol) || 0;
    var R = ttRuleSet(), NP = ttPeriods(), started = Date.now();
    var S0 = ttLive().map(function (s) { return { id: s.id, day: s.day, period: s.period, class_name: s.class_name, teacher_id: s.teacher_id || '', subject: s.subject, d0: s.day, p0: s.period }; });
    var byT = {}, byC = {}, tBusy = {}, cBusy = {};
    S0.forEach(function (s) {
      if (s.teacher_id) (byT[s.teacher_id] || (byT[s.teacher_id] = [])).push(s);
      (byC[s.class_name] || (byC[s.class_name] = [])).push(s);
      if (s.teacher_id) tBusy[s.teacher_id + '|' + s.day + '|' + s.period] = (tBusy[s.teacher_id + '|' + s.day + '|' + s.period] || 0) + 1;
      cBusy[s.class_name + '|' + s.day + '|' + s.period] = (cBusy[s.class_name + '|' + s.day + '|' + s.period] || 0) + 1;
    });
    var evT = function (t) { return ttEvalT(t, byT[t] || [], R, NP, true); }, evC = function (c) { return ttEvalC(c, byC[c], R, true); };
    var val = function (e) { return e.hard * 1000 + e.soft; };
    var baseT = {}, curT = {}, baseC = {}, curC = {}, baseRep = {};
    Object.keys(byT).forEach(function (t) { baseT[t] = curT[t] = evT(t); });
    Object.keys(byC).forEach(function (c) { baseC[c] = curC[c] = evC(c); baseRep[c] = ttRepeats(byC[c], R); });
    var days = ttCfg().days.length;
    var setSlot = function (s, d, p) {
      if (s.teacher_id) { tBusy[s.teacher_id + '|' + s.day + '|' + s.period]--; tBusy[s.teacher_id + '|' + d + '|' + p] = (tBusy[s.teacher_id + '|' + d + '|' + p] || 0) + 1; }
      cBusy[s.class_name + '|' + s.day + '|' + s.period]--; cBusy[s.class_name + '|' + d + '|' + p] = (cBusy[s.class_name + '|' + d + '|' + p] || 0) + 1;
      s.day = d; s.period = p;
    };
    // تبديل a مع b (أو نقل a إلى خانة فارغة في شعبته إن كان b خانة {day, period})
    var doMove = function (a, b) {
      var ad = a.day, ap = a.period;
      if (b.id) { var bd = b.day, bp = b.period; setSlot(a, bd, bp); setSlot(b, ad, ap); } else setSlot(a, b.day, b.period);
      return function undo() { if (b.id) { var x = a.day, y = a.period; setSlot(a, b.day, b.period); setSlot(b, x, y); } else setSlot(a, ad, ap); };
    };
    var valid = function (a, b) {
      // المعلم في الخانة الجديدة غير مشغول بغير الحصة المتبادلة
      if (a.teacher_id && (tBusy[a.teacher_id + '|' + b.day + '|' + b.period] || 0) - (b.id && b.teacher_id === a.teacher_id ? 1 : 0) > 0) return false;
      if (b.id && b.teacher_id && (tBusy[b.teacher_id + '|' + a.day + '|' + a.period] || 0) - (b.teacher_id === a.teacher_id ? 1 : 0) > 0) return false;
      return true;
    };
    var judge = function (a, b) {
      var out = { ok: true, gain: 0, t: {}, c: {} }, cls = a.class_name;
      [a.teacher_id, b.id ? b.teacher_id : ''].forEach(function (t) { if (t && !out.t[t]) out.t[t] = evT(t); });
      out.c[cls] = evC(cls);
      // حركة تقلّل مخالفة ملزمة: يُقبل معها تراجع درجة الآخرين حتى tol عن بدايتها (إن اختير ذلك)
      var hardBefore = curC[cls].hard, hardAfter = out.c[cls].hard;
      Object.keys(out.t).forEach(function (t) { hardBefore += curT[t].hard; hardAfter += out.t[t].hard; });
      var allow = hardAfter < hardBefore ? tol : 0;
      if (ttRepeats(byC[cls], R) > baseRep[cls]) out.ok = false;
      if (out.c[cls].hard > curC[cls].hard || out.c[cls].soft > baseC[cls].soft + allow) out.ok = false;
      Object.keys(out.t).forEach(function (t) {
        if (out.t[t].hard > curT[t].hard) out.ok = false;
        if (!(tid && t === tid) && out.t[t].soft > baseT[t].soft + allow) out.ok = false;
      });
      if (tid) out.gain = out.t[tid] ? val(curT[tid]) - val(out.t[tid]) : 0;
      else {
        Object.keys(out.t).forEach(function (t) { out.gain += val(curT[t]) - val(out.t[t]); });
        out.gain += val(curC[cls]) - val(out.c[cls]);
      }
      return out;
    };
    var candidates = function (s) {
      var list = byC[s.class_name].filter(function (x) { return x !== s && (x.day !== s.day || x.period !== s.period) && x.teacher_id !== s.teacher_id; });
      var np = R.lastP(s.class_name);
      for (var d = 0; d < days; d++) for (var p = 1; p <= np; p++) if (!cBusy[s.class_name + '|' + d + '|' + p]) list.push({ day: d, period: p });
      return list;
    };
    var bestSingle = function (pool, needGain) {
      var best = null;
      pool.forEach(function (a) {
        candidates(a).forEach(function (b) {
          if (!valid(a, b)) return;
          var undo = doMove(a, b), j = judge(a, b);
          if (j.ok && j.gain >= needGain && (!best || j.gain > best.gain)) best = { a: a, b: b, gain: j.gain, t: j.t, c: j.c };
          undo();
        });
      });
      return best;
    };
    var commit = function (m) { Object.keys(m.t).forEach(function (t) { curT[t] = m.t[t]; }); Object.keys(m.c).forEach(function (c) { curC[c] = m.c[c]; }); };
    var apply = function (m) { doMove(m.a, m.b); commit(m); };
    var pool = function () {
      return tid ? (byT[tid] || []) : S0.filter(function (s) { return (s.teacher_id && val(curT[s.teacher_id]) > 0) || val(curC[s.class_name]) > 0; });
    };
    for (var step = 0; step < 30 && Date.now() - started < 6000; step++) {
      if (tid && (!curT[tid] || val(curT[tid]) === 0)) break;
      var m = bestSingle(pool(), 1);
      if (m) { apply(m); continue; }
      // لا تبديل واحد يكفي: تبديل محايد في شعبة من شعب الهدف يفتح الطريق لتبديل ثانٍ يحسّن
      var two = null, classes = {};
      pool().forEach(function (s) { classes[s.class_name] = 1; });
      Object.keys(classes).some(function (c) {
        return byC[c].some(function (a) {
          if (tid && a.teacher_id === tid) return false;
          return candidates(a).some(function (b) {
            if ((b.id && tid && b.teacher_id === tid) || !valid(a, b)) return false;
            var undo = doMove(a, b), j = judge(a, b);
            if (j.ok && j.gain >= 0) {
              var savedT = {}, savedC = {};
              Object.keys(j.t).forEach(function (t) { savedT[t] = curT[t]; });
              Object.keys(j.c).forEach(function (k) { savedC[k] = curC[k]; });
              commit(j);
              var m2 = bestSingle(pool(), 1);
              Object.keys(savedT).forEach(function (t) { curT[t] = savedT[t]; });
              Object.keys(savedC).forEach(function (k) { curC[k] = savedC[k]; });
              if (m2) { two = [{ a: a, b: b, t: j.t, c: j.c }, m2]; undo(); return true; }
            }
            undo();
            return Date.now() - started > 6000;
          });
        });
      });
      if (!two) break;
      apply(two[0]); apply(two[1]);
    }
    var changes = S0.filter(function (s) { return s.day !== s.d0 || s.period !== s.p0; }).map(function (s) { return { id: s.id, from: { d: s.d0, p: s.p0 }, to: { d: s.day, p: s.period } }; });
    var summary = {};
    changes.forEach(function (c) { var s = S0.filter(function (x) { return x.id === c.id; })[0]; if (s.teacher_id) summary[s.teacher_id] = { before: val(baseT[s.teacher_id]), after: val(curT[s.teacher_id]) }; });
    if (tid && !summary[tid] && baseT[tid]) summary[tid] = { before: val(baseT[tid]), after: val(curT[tid]) };
    return { changes: changes, summary: summary };
  }

  // الجدول بعد تطبيق تغييرات اقتراح (نسخة، لا يمس البيانات)
  // التغيير: نقل { id, from, to }، أو إضافة حصة { id, add: {class_name, teacher_id, subject}, to }، أو حذف حصة { id, from, rm: true }
  function ttChSession(c) {
    if (c.add) return Object.assign({ id: c.id, status: 'ok' }, c.add, { day: c.to.d, period: c.to.p });
    return ttById(c.id);
  }
  function ttWithChanges(changes) {
    var to = {}, gone = {}, added = [];
    changes.forEach(function (c) { if (c.add) added.push(ttChSession(c)); else if (c.rm) gone[c.id] = 1; else to[c.id] = c.to; });
    return ttLive().filter(function (s) { return !gone[s.id]; }).map(function (s) { return to[s.id] ? Object.assign({}, s, { day: to[s.id].d, period: to[s.id].p }) : s; }).concat(added);
  }

  // شبكة صغيرة لجدول معلم قبل/بعد، الحصص المنقولة ملوّنة
  function ttMiniGrid(list, moved, title) {
    var cfg = ttCfg(), NP = ttPeriods(), h = '<div class="tt-mini"><b>' + esc(title) + '</b><table><thead><tr><th></th>';
    for (var p = 1; p <= NP; p++) h += '<th>' + p + '</th>';
    h += '</tr></thead><tbody>';
    cfg.days.forEach(function (dn, d) {
      h += '<tr><th>' + esc(dn) + '</th>';
      for (var q = 1; q <= NP; q++) {
        var c = list.filter(function (s) { return s.day === d && s.period === q; });
        h += '<td' + (c.some(function (s) { return moved[s.id]; }) ? ' class="mv"' : '') + '>' + c.map(function (s) { return esc(ttShortCls(s.class_name)); }).join('/') + '</td>';
      }
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  function ttChangeText(c) {
    var s = ttChSession(c), days = ttCfg().days;
    if (!s) return 'حصة لم تعد موجودة';
    if (c.add) return '<b>' + esc(s.class_name) + '</b>: إضافة حصة ' + esc(s.subject) + ' (' + esc(ttShortTName(s.teacher_id)) + ') في ' + esc(days[c.to.d]) + ' الحصة ' + c.to.p;
    if (c.rm) return '<b>' + esc(s.class_name) + '</b>: حذف حصة ' + esc(s.subject) + ' (' + esc(ttShortTName(s.teacher_id)) + ') من ' + esc(days[c.from.d]) + ' الحصة ' + c.from.p;
    return '<b>' + esc(s.class_name) + '</b>: ' + esc(s.subject) + ' (' + esc(ttShortTName(s.teacher_id)) + ') من ' + esc(days[c.from.d]) + ' الحصة ' + c.from.p + ' إلى ' + esc(days[c.to.d]) + ' الحصة ' + c.to.p;
  }

  // عرض اقتراح: التغييرات، ونسبة الالتزام قبل وبعد، ودرجة كل معلم متأثر قبل وبعد، وجداولهم قبل وبعد
  function ttProposalBody(changes, summary) {
    var moved = {}, after = ttWithChanges(changes), R = ttRuleSet(), ev0 = ttEvalAll(ttLive(), R), ev1 = ttEvalAll(after, R);
    changes.forEach(function (c) { moved[c.id] = 1; });
    var teachers = Object.keys(summary);
    changes.forEach(function (c) { var s = ttChSession(c); if (s && s.teacher_id && teachers.indexOf(s.teacher_id) < 0) teachers.push(s.teacher_id); });
    var cell = function (e) {
      if (!e) return '0';
      return e.soft + (e.hard ? ' <b style="color:var(--red)">· ملزمة ' + e.hard + '</b>' : '') + '<br><small class="hint">' + (e.notes.length ? e.notes.map(esc).join('، ') : 'لا مخالفات') + '</small>';
    };
    var v = function (e) { return e ? e.hard * 1000 + e.soft : 0; };
    var rows = teachers.map(function (t) {
      var b = ev0.t[t], a = ev1.t[t];
      return '<tr><td><b>' + esc(ttTName(t)) + '</b></td><td>' + cell(b) + '</td><td>' + cell(a) + '</td><td>' +
        (v(a) < v(b) ? '<span class="badge approved">تحسّن</span>' : v(a) === v(b) ? '<span class="badge new">كما هو</span>' : '<span class="badge unpaid">ساء</span>') + '</td></tr>';
    }).join('');
    var grids = teachers.map(function (t) {
      return '<div class="tt-minis">' + ttMiniGrid(ttLive().filter(function (s) { return s.teacher_id === t; }), moved, ttTName(t) + ' — قبل') +
        ttMiniGrid(after.filter(function (s) { return s.teacher_id === t; }), moved, ttTName(t) + ' — بعد') + '</div>';
    }).join('');
    return '<div class="tt-comp"><b>الالتزام بالقواعد: ' + ttPct(ev0.ok, ev0.total) + '% ← ' + ttPct(ev1.ok, ev1.total) + '%</b><span>المخالفات الملزمة: ' + ev0.hard + ' ← ' + ev1.hard + '</span></div>' +
      '<ul class="tt-checks">' + changes.map(function (c) { return '<li>' + ttChangeText(c) + '</li>'; }).join('') + '</ul>' +
      '<div class="table-wrap" style="margin-top:8px"><table class="grid"><thead><tr><th>المعلم</th><th>الدرجة قبل</th><th>الدرجة بعد</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="hint" style="margin:6px 0">الدرجة مجموع مخالفات القواعد بأوزانها؛ الأقل أفضل، والصفر بلا مخالفات.</p>' +
      '<details class="bank"><summary>الجداول قبل وبعد (الخانات الملوّنة هي المنقولة)</summary>' + grids + '</details>';
  }

  function ttImproveHtml() {
    if (S.ttPlanMissing) return ttPlanMissingHtml();
    var edit = canEditTT(), ev = ttEvalAll();
    var scored = ttTeachers().map(function (t) { var e = ev.t[t.id] || { soft: 0, hard: 0, notes: [] }; return { t: t, e: e }; })
      .sort(function (a, b) { return (b.e.hard * 1000 + b.e.soft) - (a.e.hard * 1000 + a.e.soft) || a.t.name.localeCompare(b.t.name, 'ar'); });
    var opts = '<option value="">كل المعلمين والشعب (يقلّ مجموع المخالفات ولا يسوء جدول أحد)</option>' + scored.map(function (x) {
      return '<option value="' + x.t.id + '"' + (ui.ttImpT === x.t.id ? ' selected' : '') + '>' + esc(ttName(x.t)) + ' — الدرجة ' + x.e.soft + (x.e.hard ? ' · ملزمة ' + x.e.hard : '') + '</option>';
    }).join('');
    var res = ui.ttOpt, card = '';
    if (res && res.tid === (ui.ttImpT || '') && (res.tol || 0) === (ui.ttTol || 0)) {
      card = !res.changes.length
        ? '<div class="card"><h2>النتيجة</h2><p class="hint" style="margin:0">لم أجد تبديلًا يحسّن ' + (res.tid ? 'جدول «' + esc(ttTName(res.tid)) + '»' : 'الجدول') + ' دون أن يسيء إلى جدول معلم آخر أو يزيد مخالفة قاعدة ملزمة أو يصنع تعارضًا. ' +
          'هذا أفضل ما يمكن بالقواعد الحالية؛ يمكنك خفض أولوية قاعدة أو تخفيفها في «النصاب والقواعد»، أو تعديل حصص يدويًا ثم إعادة البحث.</p></div>'
        : '<div class="card" style="border:2px solid var(--primary)"><h2>الاقتراح: ' + res.changes.length + ' حصة تنتقل</h2>' + ttProposalBody(res.changes, res.summary) +
          (edit ? '<div class="toolbar" style="margin:12px 0 0"><input type="text" id="tt-proptitle" placeholder="عنوان الاقتراح (اختياري)" value="' + esc(res.title || '') + '" style="flex:1;min-width:200px"><button type="button" class="btn primary" data-ttpropsave>حفظ كاقتراح للاعتماد</button><button type="button" class="btn" data-ttprint="prop|" data-ro-ok>طباعة / PDF</button><button type="button" class="btn" data-ttoptclear>إلغاء</button></div>' : '') + '</div>';
    }
    var props = S.ttProposals || [];
    var pend = props.filter(function (p) { return p.status === 'pending'; }), done = props.filter(function (p) { return p.status !== 'pending'; }).slice(0, 15);
    var propCard = function (p) {
      var st = p.status === 'approved' ? '<span class="badge approved">اعتُمد</span>' : p.status === 'rejected' ? '<span class="badge unpaid">رُفض</span>' : '<span class="badge edit">بانتظار الاعتماد</span>';
      return '<div class="card"><h2>' + esc(p.title || 'اقتراح تحسين') + ' ' + st + '</h2><p class="hint">' + (p.goal ? esc(p.goal.split('. ')[0]) + ' · ' : '') + 'أعدّه ' + esc(p.created_by || '') + ' في ' + dmy(String(p.created_at || '').slice(0, 10)) +
        (p.decided_by ? ' · ' + (p.status === 'approved' ? 'اعتمده ' : 'رفضه ') + esc(p.decided_by) : '') + '</p>' +
        (p.status === 'pending' ? ttProposalBody(p.changes || [], p.summary || {}) +
          '<div class="toolbar" style="margin:12px 0 0">' + (edit ? '<button type="button" class="btn primary" data-ttpropok="' + p.id + '">اعتماد وتطبيق</button><button type="button" class="btn danger" data-ttpropno="' + p.id + '">رفض</button>' : '') +
            '<button type="button" class="btn" data-ttprint="prop|' + p.id + '" data-ro-ok>طباعة / PDF</button></div>'
          : '<ul class="tt-checks">' + (p.changes || []).map(function (c) { return '<li>' + ttChangeText(c) + '</li>'; }).join('') + '</ul>' +
            '<button type="button" class="btn" data-ttprint="prop|' + p.id + '" data-ro-ok>طباعة / PDF</button>') + '</div>';
    };
    var me = ui.ttImpT && ev.t[ui.ttImpT];
    return '<div class="card"><h2>تحسين الجدول</h2><p class="hint">يبحث البرنامج عن تبديل حصتين في الشعبة نفسها يحسّن الجدول حسب القواعد، فيبدأ بالقواعد الملزمة ثم الأعلى أولوية، بشرط ألا يصنع تعارضًا، ولا يغيّر النصاب، ولا يزيد مخالفة قاعدة ملزمة، ولا يسيء إلى جدول أي معلم آخر. ' +
        'لا يتغير الجدول قبل أن يُعتمد الاقتراح.</p>' +
        '<div class="toolbar no-print" style="margin:0 0 8px">' + ttHeadBox() + '<span class="hint" style="margin:0">لطباعة الاقتراحات</span><button type="button" class="btn" data-ttprint="imp|" data-ro-ok>طباعة تقرير الالتزام بالقواعد / PDF</button></div>' +
        '<div class="tt-comp" style="margin-bottom:10px"><b>الالتزام بالقواعد الآن: ' + ttPct(ev.ok, ev.total) + '%</b><span>' + (ev.hard ? '<b style="color:var(--red)">مخالفات ملزمة: ' + ev.hard + '</b>' : 'لا مخالفات ملزمة') + '</span></div>' +
        '<div class="toolbar" style="align-items:center;margin:0"><select id="tt-impt" style="width:auto;max-width:440px">' + opts + '</select>' +
        '<select id="tt-tol" style="width:auto" title="عند إصلاح مخالفة قاعدة ملزمة">' + [[0, 'صارم: لا يسوء جدول أحد'], [3, 'لإصلاح الملزمة: تراجع بسيط مقبول (حتى 3 نقاط للمعلم)'], [6, 'لإصلاح الملزمة: تراجع متوسط مقبول (حتى 6 نقاط)']].map(function (o) { return '<option value="' + o[0] + '"' + ((ui.ttTol || 0) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
        '<button type="button" class="btn primary" data-ttopt' + (edit ? '' : ' disabled') + '>ابحث عن تحسين</button></div>' +
        (ui.ttImpT ? '<p class="hint" style="margin:8px 0 0">المخالفات الآن: ' + (me && me.notes.length ? me.notes.map(esc).join('، ') : 'لا شيء') + '</p>' : '') + '</div>' +
      card +
      (pend.length ? '<h3 style="margin:18px 0 8px">اقتراحات بانتظار الاعتماد (' + pend.length + ')</h3>' + pend.map(propCard).join('') : '') +
      (done.length ? '<details class="bank" style="margin-top:14px"><summary>اقتراحات سابقة (' + done.length + ')</summary>' + done.map(propCard).join('') + '</details>' : '');
  }

  async function ttSaveProposal() {
    var res = ui.ttOpt, t = res.tid ? ttTName(res.tid) : '';
    var row = { title: (document.getElementById('tt-proptitle') || {}).value || (t ? 'تحسين جدول ' + t : 'تحسين الجدول لكل المعلمين'),
      goal: (res.tol ? 'سُمح بتراجع حتى ' + res.tol + ' نقاط في جداول الآخرين لإصلاح القواعد الملزمة. ' : 'صارم: لم يسُؤ جدول أحد. ') + 'القواعد المفعّلة: ' + ttCustomRules().filter(function (r) { return r.on !== false; }).map(function (r) { return ttRuleText(r) + ' (' + (TT_LEVELS[r.level] || TT_LEVELS.mid).label + ')'; }).join('؛ '),
      teacher_id: res.tid || null, changes: res.changes, summary: res.summary, status: 'pending', created_by: ttWho() };
    var r = await sb.from('timetable_proposals').insert(row).select().single();
    if (r.error) return fail(r.error);
    (S.ttProposals || (S.ttProposals = [])).unshift(r.data || row);
    ui.ttOpt = null;
    render();
    toast('حُفظ الاقتراح بانتظار الاعتماد');
  }

  // الاعتماد: يُتحقق أن الحصص ما زالت حيث كانت عند إعداد الاقتراح، وأن التطبيق لا يصنع تعارضًا جديدًا
  // ولا يزيد مخالفة قاعدة ملزمة، ثم تُنقل
  async function ttDecideProposal(id, approve) {
    var now = new Date().toISOString(), who = ttWho();
    // الجدول والاقتراحات كما هي الآن في القاعدة، لا كما حُمّلت (قد يكون غيرك عدّل الجدول أو بتّ في الاقتراح)
    await loadTimetable();
    var p = (S.ttProposals || []).filter(function (x) { return x.id === id; })[0];
    if (!p || p.status !== 'pending') { render(); return toast('بُتّ في هذا الاقتراح من قبل', true); }
    if (approve) {
      var stale = (p.changes || []).filter(function (c) { if (c.add) return false; var s = ttById(c.id); return !s || s.status === 'removed' || s.day !== c.from.d || s.period !== c.from.p; });
      if (stale.length) return alert('تغيّر الجدول منذ إعداد هذا الاقتراح (' + stale.length + ' من حصصه لم تعد في مكانها). ارفضه وأعد البحث عن تحسين.');
      if (ttConflicts(ttWithChanges(p.changes)).groups.length > ttConflicts().groups.length) return alert('تطبيق هذا الاقتراح الآن يصنع تعارضًا. ارفضه وأعد البحث عن تحسين.');
      if (ttEvalAll(ttWithChanges(p.changes)).hard > ttEvalAll().hard) return alert('تطبيق هذا الاقتراح يزيد مخالفة قاعدة ملزمة (ربما تغيّرت القواعد بعد إعداده). ارفضه وأعد البحث عن تحسين.');
      // حصة قرآن واحدة للصف في اليوم: اقتراح (قديم مثلًا) يجمع حصتين في يوم واحد لا يُعتمد
      var dupQ = {}, dupHit = '';
      ttWithChanges(p.changes).forEach(function (x) { if (qzIsQuran(x.subject)) { var k = x.class_name + '|' + x.day; if (dupQ[k]) dupHit = x.class_name + ' — ' + (ttCfg().days[x.day] || ''); dupQ[k] = 1; } });
      if (dupHit) return alert('هذا الاقتراح يضع حصتَي قرآن لصف في يوم واحد (' + dupHit + ') وهذا غير جائز. ارفضه وأعد توزيع القرآن من جديد.');
      if (!confirm('اعتماد الاقتراح ونقل ' + p.changes.length + ' حصة؟')) return;
      var done = [], created = [];
      var undoAll = async function () {
        for (var j = 0; j < done.length; j++) {
          var d0 = done[j];
          if (d0.rm) await sb.from('timetable_sessions').update({ status: 'ok' }).eq('id', d0.id);
          else if (!d0.add) await sb.from('timetable_sessions').update({ day: d0.from.d, period: d0.from.p }).eq('id', d0.id);
        }
        for (var q = 0; q < created.length; q++) await sb.from('timetable_sessions').delete().eq('id', created[q].id);
      };
      for (var i = 0; i < p.changes.length; i++) {
        var c = p.changes[i], r;
        if (c.add) {
          r = await sb.from('timetable_sessions').insert(Object.assign({ day: c.to.d, period: c.to.p, status: 'ok', note: '', updated_by: who, updated_at: now }, c.add)).select().single();
          if (!r.error) created.push(r.data);
        } else if (c.rm) r = await sb.from('timetable_sessions').update({ status: 'removed', updated_by: who, updated_at: now }).eq('id', c.id);
        else r = await sb.from('timetable_sessions').update({ day: c.to.d, period: c.to.p, updated_by: who, updated_at: now }).eq('id', c.id);
        if (r.error) { await undoAll(); return fail(r.error); }
        if (!c.add) done.push(c);
      }
      p.changes.forEach(function (c) { var s = c.add ? null : ttById(c.id); if (c.rm) { s.status = 'removed'; } else if (s) { s.day = c.to.d; s.period = c.to.p; } if (s) { s.updated_by = who; s.updated_at = now; } });
      created.forEach(function (x) { S.ttSessions.push(x); });
    } else if (!confirm('رفض الاقتراح؟ لا يتغير الجدول.')) return;
    var patch = { status: approve ? 'approved' : 'rejected', decided_by: who, decided_at: now };
    var u = await sb.from('timetable_proposals').update(patch).eq('id', id);
    if (u.error) fail(u.error);
    Object.assign(p, patch);
    render();
    toast(approve ? 'اعتُمد الاقتراح وطُبّق على الجدول' : 'رُفض الاقتراح');
  }

  /* --- طباعة اقتراح تحسين (لعرضه على المشرف قبل الاعتماد) ---
     الصفحة الأولى: الملخص ونسبة الالتزام والمعلمون المتأثرون وخانة القرار؛ ثم جدول التغييرات؛ ثم جداول المعلمين
     قبل وبعد (الحصص المنقولة مظللة). الاقتراح المعتمد أو المرفوض يُطبع بتغييراته وقراره فقط، لأن الجدول تغيّر بعده */
  function ttPropPages(p) {
    var pending = p.status !== 'approved' && p.status !== 'rejected', changes = p.changes || [], days = ttCfg().days;
    var R = ttRuleSet(), ev0 = pending ? ttEvalAll(ttLive(), R) : null, after = pending ? ttWithChanges(changes) : null, ev1 = pending ? ttEvalAll(after, R) : null;
    var moved = {};
    changes.forEach(function (c) { moved[c.id] = 1; });
    var teachers = Object.keys(p.summary || {});
    changes.forEach(function (c) { var s = ttChSession(c); if (s && s.teacher_id && teachers.indexOf(s.teacher_id) < 0) teachers.push(s.teacher_id); });
    var st = p.status === 'approved' ? 'اعتُمد' + (p.decided_by ? ' — ' + p.decided_by : '') : p.status === 'rejected' ? 'رُفض' + (p.decided_by ? ' — ' + p.decided_by : '') : 'بانتظار الاعتماد';
    var meta = [['الحالة', st], ['أعدّه', p.created_by || ttWho()], ['تاريخ الإعداد', dmy(String(p.created_at || todayISO()).slice(0, 10))]];
    var head = function (sub) {
      return ttTop() + '<div class="tt-ptitle">' + esc(p.title || 'اقتراح تحسين جدول الحصص') + '</div>' +
        '<div class="tt-pmeta">' + (sub ? esc(sub) + ' · ' : '') + meta.map(function (m) { return m[0] + ': ' + esc(m[1]); }).join(' · ') + '</div>';
    };
    var v = function (e) { return e ? e.hard * 1000 + e.soft : 0; };
    var pages = [];
    // 1) الملخص
    var sum = '';
    if (pending) {
      sum = '<div class="tt-pbox"><b>الالتزام بالقواعد: ' + ttPct(ev0.ok, ev0.total) + '% ← ' + ttPct(ev1.ok, ev1.total) + '%</b><span>المخالفات الملزمة: ' + ev0.hard + ' ← ' + ev1.hard + '</span><span>الحصص التي تنتقل: ' + changes.length + '</span></div>' +
        (p.goal ? '<p class="tt-pnote">' + esc(p.goal) + '</p>' : '') +
        '<table class="tt-ptab"><thead><tr><th>المعلم</th><th>الدرجة قبل</th><th>الدرجة بعد</th><th>المخالفات بعد الاقتراح</th><th>النتيجة</th></tr></thead><tbody>' +
        teachers.map(function (t) {
          var b = ev0.t[t], a = ev1.t[t];
          return '<tr><td><b>' + esc(ttTName(t)) + '</b></td><td class="c">' + (b ? b.soft + (b.hard ? ' · ملزمة ' + b.hard : '') : 0) + '</td><td class="c">' + (a ? a.soft + (a.hard ? ' · ملزمة ' + a.hard : '') : 0) + '</td>' +
            '<td>' + (a && a.notes.length ? a.notes.map(esc).join('، ') : 'لا مخالفات') + '</td><td class="c">' + (v(a) < v(b) ? 'تحسّن' : v(a) === v(b) ? 'كما هو' : '<b>ساء</b>') + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="tt-pnote">الدرجة مجموع مخالفات قواعد الجدول بأوزانها؛ الأقل أفضل. الاقتراح لا يصنع تعارضًا ولا يغيّر نصاب أي شعبة أو معلم.</p>';
    } else sum = '<div class="tt-pbox"><b>' + esc(st) + '</b><span>الحصص التي نُقلت: ' + changes.length + '</span></div>';
    sum += '<div class="tt-pdecide"><b>القرار:</b><span>☐ اعتماد</span><span>☐ رفض</span><span>☐ تعديل ثم إعادة العرض</span>' +
      '<div class="tt-plines">ملاحظات: ......................................................................................................................................................</div>' +
      '<div class="tt-psig"><span>المشرف التربوي: ..........................</span><span>مدير/ة الأكاديمية: ' + esc(principalName()) + ' ..........................</span></div></div>';
    pages.push('<section class="tt-page" data-base="11">' + head('الملخص') + sum + '</section>');
    // 2) التغييرات (على صفحات من 26 سطرًا)
    for (var k = 0; k < changes.length; k += 26) {
      pages.push('<section class="tt-page" data-base="11">' + head('التغييرات' + (changes.length > 26 ? ' (' + (k + 1) + '–' + Math.min(changes.length, k + 26) + ' من ' + changes.length + ')' : '')) +
        '<table class="tt-ptab"><thead><tr><th>م</th><th>الشعبة</th><th>المادة</th><th>المعلم</th><th>من</th><th>إلى</th></tr></thead><tbody>' +
        changes.slice(k, k + 26).map(function (c, i) {
          var s = ttChSession(c) || {};
          return '<tr><td class="c">' + (k + i + 1) + '</td><td>' + esc(s.class_name || '') + '</td><td>' + esc(s.subject || '') + '</td><td>' + esc(ttTName(s.teacher_id)) + '</td>' +
            '<td class="c">' + (c.add || !c.from ? 'إضافة' : esc(days[c.from.d] || '') + ' — الحصة ' + c.from.p) + '</td><td class="c"><b>' + (c.rm || !c.to ? 'حذف' : esc(days[c.to.d] || '') + ' — الحصة ' + c.to.p) + '</b></td></tr>';
        }).join('') + '</tbody></table></section>');
    }
    // 3) جداول المعلمين قبل وبعد: معلمان في الصفحة
    if (pending) {
      for (var j = 0; j < teachers.length; j += 2) {
        pages.push('<section class="tt-page" data-base="11">' + head('الجداول قبل وبعد — الخانات المظللة هي الحصص المنقولة') +
          teachers.slice(j, j + 2).map(function (t) {
            return '<div class="tt-pmrow">' + ttPrintMini(ttLive().filter(function (s) { return s.teacher_id === t; }), moved, ttTName(t) + ' — قبل') +
              ttPrintMini(after.filter(function (s) { return s.teacher_id === t; }), moved, ttTName(t) + ' — بعد') + '</div>';
          }).join('') + '</section>');
      }
    }
    return pages.join('');
  }

  function ttPrintMini(list, moved, title) {
    var cfg = ttCfg(), NP = ttPeriods(), h = '<div class="tt-pm"><b>' + esc(title) + '</b><table><thead><tr><th></th>';
    for (var p = 1; p <= NP; p++) h += '<th>' + p + '</th>';
    h += '</tr></thead><tbody>';
    cfg.days.forEach(function (dn, d) {
      h += '<tr class="tt-r"><th>' + esc(dn) + '</th>';
      for (var q = 1; q <= NP; q++) {
        var c = list.filter(function (s) { return s.day === d && s.period === q; });
        h += '<td' + (c.some(function (s) { return moved[s.id]; }) ? ' class="mv"' : '') + '>' + c.map(function (s) { return esc(ttShortCls(s.class_name)); }).join('/') + '</td>';
      }
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  /* ----- الطباعة -----
     جدول لكل معلم أو صف: صفحة A4 أفقية بالترويسة ومكان التوقيع. الجدولان العامان: صفحة أفقية واحدة بلا شعار،
     الأحد يبدأ من اليمين. مواعيد الدوام: صفحة طولية لكل مرحلة. كل صفحة تُضبط وحدها (fitTtPages) */
  var pendingTT = null;

  function ttShortSub(s) { return { 'إنجليزي': 'E', 'انجليزي': 'E', 'تكنولوجيا': 'تك' }[s] || s; }
  function ttShortCls(c) { return String(c).replace(/^ال/, ''); }

  function ttEntityPage(kind, x) {
    var isT = kind === 't', cfg = ttCfg(), NP = ttPeriods();
    var mine = ttLive().filter(function (s) { return isT ? s.teacher_id === x.id : s.class_name === x; });
    var st = !isT && ttStageOf(x);
    var meta = isT ? [x.job_title || x.subject || '', 'عدد الحصص الأسبوعية: ' + mine.length]
      : ['عدد الحصص الأسبوعية: ' + mine.length, classTeacher(x) ? 'مربي الصف: ' + classTeacher(x) : '', st ? 'المواعيد: ' + st.name : ''];
    var head = '<tr><th>اليوم</th>';
    for (var p = 1; p <= NP; p++) head += '<th>الحصة ' + (TT_ORD[p - 1] || p) + '<small>' + esc(ttHeadTime(isT ? null : x, p)) + '</small></th>';
    var body = cfg.days.map(function (dn, d) {
      var r = '<tr class="tt-r"><th>' + esc(dn) + '</th>';
      for (var q = 1; q <= NP; q++) {
        var c = mine.filter(function (s) { return s.day === d && s.period === q; });
        r += '<td>' + c.map(function (s) {
          if (!isT) return '<b>' + esc(s.subject) + '</b><small>' + esc(ttShortTName(s.teacher_id)) + '</small>';
          var pt = !ttCommonTime(q) && ttTimeFor(s.class_name, q);
          return '<b>' + esc(s.class_name) + '</b><small>' + esc(s.subject) + (pt ? ' · ' + pt[0] : '') + '</small>';
        }).join('<hr>') + '</td>';
      }
      return r + '</tr>';
    }).join('');
    return '<section class="tt-page" data-base="13">' + ttTop() +
      '<div class="tt-ptitle">' + (isT ? 'جدول المعلم/ة: ' + esc(ttName(x)) : 'جدول الصف ' + esc(x)) + '</div>' +
      '<div class="tt-pmeta">' + meta.filter(Boolean).map(esc).join(' · ') + '</div>' +
      '<table class="tt-ptable"><thead>' + head + '</tr></thead><tbody>' + body + '</tbody></table>' +
      (ttSignOn() ? '<div class="tt-sig"><span>المشرف التربوي: ..........................</span><span>مدير/ة الأكاديمية: ' + esc(principalName()) + ' ..........................</span></div>' : '') + '</section>';
  }

  function ttMasterPage(byCls) {
    var cfg = ttCfg(), NP = ttPeriods(), ND = cfg.days.length, rows = byCls ? ttClasses() : ttTeachers(), map = {};
    ttLive().forEach(function (s) {
      var k = (byCls ? s.class_name : s.teacher_id) + '|' + s.day + '|' + s.period;
      (map[k] || (map[k] = [])).push(byCls ? ttShortSub(s.subject) : ttShortCls(s.class_name));
    });
    var title = byCls ? 'الجدول العام للشعب الدراسية' : 'الجدول العام للمعلمين';
    var head1 = '<tr><th class="corner" rowspan="2"></th>' + cfg.days.map(function (n) { return '<th class="day ds" colspan="' + NP + '">' + esc(n) + '</th>'; }).join('') + '</tr>';
    var head2 = '<tr>';
    for (var d = 0; d < ND; d++) for (var p = 1; p <= NP; p++) head2 += '<th class="per' + (p === 1 ? ' ds' : '') + '">' + p + '</th>';
    var body = rows.map(function (r) {
      var id = byCls ? r : r.id, tr = '<tr class="tt-r"><th class="rh">' + esc(byCls ? ttShortCls(r) : ttName(r)) + '</th>';
      for (var d2 = 0; d2 < ND; d2++) for (var q = 1; q <= NP; q++) {
        var v = map[id + '|' + d2 + '|' + q], tx = v ? v.join(' / ') : '';
        tr += '<td' + (q === 1 ? ' class="ds"' : '') + '>' + (tx.length > 6 ? '<span class="sm">' + esc(tx) + '</span>' : esc(tx)) + '</td>';
      }
      return tr + '</tr>';
    }).join('');
    var b = ttDayBounds();
    return '<section class="tt-page tt-master" data-base="10"><div class="tt-mtitle">' + title + '</div>' +
      '<table class="tt-mtable' + (byCls ? '' : ' wide') + '"><colgroup><col class="c0">' + new Array(ND * NP + 1).join('<col>') + '</colgroup><thead>' + head1 + head2 + '</tr></thead><tbody>' + body + '</tbody></table>' +
      '<div class="tt-mfoot"><span>تاريخ الإصدار: ' + dmy(todayISO()) + '</span><span>' + NP + ' حصص يوميًا' + (b[0] ? ' · الطابور ' + b[0] + ' · نهاية الدوام ' + b[1] : '') + '</span></div></section>';
  }

  function ttBellsPages() {
    return ttCfg().bells.stages.map(function (st) {
      var R = st.rows;
      return '<section class="tt-page tt-bellpage" data-base="16"><div class="tt-btitle">مواعيد الدوام المدرسي</div><div class="tt-bgroup"><span>' + esc(st.name) + '</span></div>' +
        '<table class="tt-btable"><thead><tr><th>البند</th><th class="t">من</th><th class="t">إلى</th></tr></thead><tbody>' +
        R.map(function (r, i) { return '<tr class="tt-r k-' + r.k + '"><td>' + esc(ttRowLabel(st, i)) + '</td><td class="t">' + esc(r.f) + '</td><td class="t">' + esc(r.t) + '</td></tr>'; }).join('') +
        '</tbody></table><div class="tt-mfoot"><span>بداية الدوام: ' + esc(R.length ? R[0].f : '') + '</span><span>عدد الحصص: ' + ttPTimes(st).length + '</span><span>نهاية الدوام: ' + esc(R.length ? R[R.length - 1].t : '') + '</span></div></section>';
    }).join('');
  }

  function buildTtSheet(q) {
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    if (q.kind === 'form') return buildTeacherFormationSheet();
    if (q.kind === 'imp') {
      // تقرير الالتزام بالقواعد: لكل معلم درجته (الأسوأ أولًا) ومخالفاته، 24 معلمًا في الصفحة
      var ev = ttEvalAll(), rows = ttTeachers().map(function (t) { return { t: t, e: ev.t[t.id] || { soft: 0, hard: 0, notes: [] } }; })
        .sort(function (a, b) { return (b.e.hard * 1000 + b.e.soft) - (a.e.hard * 1000 + a.e.soft) || a.t.name.localeCompare(b.t.name, 'ar'); });
      var top = function (k) { return ttTop() + '<div class="tt-ptitle">تقرير الالتزام بقواعد جدول الحصص</div><div class="tt-pmeta">' + dmy(todayISO()) + ' · الالتزام: ' + ttPct(ev.ok, ev.total) + '% · المخالفات الملزمة: ' + ev.hard + (rows.length > 24 ? ' · ' + (k + 1) + '–' + Math.min(rows.length, k + 24) + ' من ' + rows.length : '') + '</div>'; };
      var out = '';
      for (var k = 0; k < rows.length || k === 0; k += 24) {
        out += '<section class="tt-page" data-base="11">' + top(k) + '<table class="tt-ptab"><thead><tr><th>#</th><th>المعلم</th><th>الدرجة</th><th>ملزمة</th><th>المخالفات</th></tr></thead><tbody>' +
          rows.slice(k, k + 24).map(function (x, i) { return '<tr><td>' + (k + i + 1) + '</td><td>' + esc(ttName(x.t)) + '</td><td>' + x.e.soft + '</td><td>' + (x.e.hard || '—') + '</td><td style="text-align:right">' + (x.e.notes.length ? x.e.notes.map(esc).join('، ') : 'لا شيء') + '</td></tr>'; }).join('') + '</tbody></table></section>';
        if (!rows.length) break;
      }
      printLandscape = true;
      sheet.style.width = '267mm';
      sheet.className = 'tt-pages land';
      sheet.innerHTML = ttWm() + out;
    } else if (q.kind === 'prop') {
      var pr = q.id ? (S.ttProposals || []).filter(function (x) { return x.id === q.id; })[0] : ui.ttOpt && { title: ((document.getElementById('tt-proptitle') || {}).value || '') || (ui.ttOpt.tid ? 'تحسين جدول ' + ttTName(ui.ttOpt.tid) : 'تحسين الجدول لكل المعلمين') + ' (مسودة)',
        changes: ui.ttOpt.changes, summary: ui.ttOpt.summary, status: 'draft', created_by: ttWho(), created_at: new Date().toISOString(),
        goal: ui.ttOpt.tol ? 'سُمح بتراجع حتى ' + ui.ttOpt.tol + ' نقاط في جداول الآخرين لإصلاح القواعد الملزمة.' : 'صارم: لم يسُؤ جدول أحد.' };
      printLandscape = true;
      sheet.style.width = '267mm';
      sheet.className = 'tt-pages land';
      sheet.innerHTML = pr ? ttWm() + ttPropPages(pr) : '<p>لا يوجد اقتراح.</p>';
    } else if (q.kind === 'brk') {
      printLandscape = false;
      sheet.className = 'tt-pages';
      sheet.innerHTML = ttWm() + ttBreakPage();
    } else if (q.kind === 'bells') {
      printLandscape = false;
      sheet.className = 'tt-pages';
      sheet.innerHTML = ttBellsPages() || '<p>لم تُحدَّد مواعيد الدوام.</p>';
    } else {
      printLandscape = true;
      sheet.style.width = '267mm';
      if (q.kind === 'gc' || q.kind === 'gt') {
        sheet.className = 'tt-pages land';
        sheet.innerHTML = ttMasterPage(q.kind === 'gc');
      } else {
        var list = q.kind === 't' ? (q.id ? [find(q.id)] : ttTeachers()) : (q.id ? [q.id] : ttClasses());
        sheet.className = 'tt-pages land';
        sheet.innerHTML = ttWm() + list.filter(Boolean).map(function (x) { return ttEntityPage(q.kind, x); }).join('');
      }
    }
    fitTtPages(sheet);
  }

  // كل صفحة وحدها: يُصغَّر خطها حتى تتسع طولًا ولا تفيض خانة، ثم تطول صفوف جدولها لتملأ الصفحة.
  // هامش أمان لحافة الطابعة غير القابلة للطباعة
  function fitTtPages(root) {
    var p = REPORT.page, land = root.classList.contains('land');
    var maxPx = ((land ? p.width : p.height) - 2 * p.marginY - 20) * 96 / 25.4;
    Array.prototype.forEach.call(root.querySelectorAll('.tt-page'), function (pg) {
      var pad = parseFloat(pg.ownerDocument.defaultView.getComputedStyle(pg).paddingTop) || 0;
      var rows = pg.querySelectorAll('tr.tt-r'), cells = pg.querySelectorAll('td, th');
      Array.prototype.forEach.call(rows, function (tr) { tr.style.height = ''; });
      var over = function () {
        if (pg.offsetHeight - pad > maxPx) return true;
        for (var i = 0; i < cells.length; i++) if (cells[i].scrollWidth > cells[i].clientWidth + 1) return true;
        return false;
      };
      var size = Number(pg.getAttribute('data-base')) || REPORT.baseSize;
      pg.style.fontSize = size + 'pt';
      while (over() && size > 5) { size -= 0.25; pg.style.fontSize = size + 'pt'; }
      var spare = maxPx - (pg.offsetHeight - pad);
      if (rows.length && spare > rows.length) {
        var add = Math.floor(spare / rows.length) - 1;
        Array.prototype.forEach.call(rows, function (tr) { tr.style.height = (tr.offsetHeight + add) + 'px'; });
      }
    });
  }

  /* ----- الأحداث ----- */
  app.addEventListener('click', function (e) {
    if (!/^#\/timetable/.test(location.hash)) return;
    var el;
    if ((el = e.target.closest('[data-tgo]'))) return go(el.getAttribute('data-tgo'));
    if ((el = e.target.closest('[data-ttpick]'))) {
      if (el.getAttribute('data-ttpick') === 't') ui.ttTeacher = el.getAttribute('data-id'); else ui.ttClass = el.getAttribute('data-id');
      ui.ttEdit = null;
      return render();
    }
    if ((el = e.target.closest('[data-tqpick]'))) { ui.ttQClass = el.getAttribute('data-id'); return render(); }
    if ((el = e.target.closest('[data-ttimprove]'))) { e.preventDefault(); ui.ttImpT = el.getAttribute('data-ttimprove'); ui.ttOpt = null; return go('#/timetable/improve'); }
    if ((el = e.target.closest('[data-ttprint]'))) {
      var q = el.getAttribute('data-ttprint').split('|');
      pendingTT = { kind: q[0], id: q.slice(1).join('|') };
      return printNow();
    }
    if (e.target.closest('[data-tbshow]')) return ttOpenDisplay();
    if (e.target.closest('[data-tbcopy]')) {
      var link = ttBellsLink();
      if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { toast('نُسخ رابط شاشة الممر'); }, function () { prompt('انسخ الرابط:', link); });
      else prompt('انسخ الرابط:', link);
      return;
    }
    if (!canEditTT()) return;
    if ((el = e.target.closest('[data-ttnew]'))) { var dp = el.getAttribute('data-ttnew').split('|'); return ttOpenEditor({ day: +dp[0], period: +dp[1] }); }
    if ((el = e.target.closest('[data-ttopen]'))) return ttOpenEditor({ id: el.getAttribute('data-ttopen') });
    if (e.target.closest('[data-ttsave]')) return ttSaveEditor();
    if (e.target.closest('[data-ttcancel]')) { ui.ttEdit = null; return render(); }
    if ((el = e.target.closest('[data-ttremove]'))) return ttSetStatus(el.getAttribute('data-ttremove'), 'removed');
    if ((el = e.target.closest('[data-ttact]'))) return ttSetStatus(el.getAttribute('data-id'), el.getAttribute('data-ttact'));
    if (e.target.closest('[data-tbedit]')) { ui.ttBell = JSON.parse(JSON.stringify(ttCfg().bells)); return render(); }
    if (e.target.closest('[data-tbstart]')) { ui.ttBell = { auto: true, stages: [ttDefaultStage('كل الصفوف', ttClasses())] }; return render(); }
    if (e.target.closest('[data-tbcancel]')) { ui.ttBell = null; return render(); }
    if (e.target.closest('[data-tbsave]')) return ttSaveBells();
    if (e.target.closest('[data-tbaddstage]')) { ui.ttBell.stages.push(ttDefaultStage('مرحلة جديدة', [])); return render(); }
    if ((el = e.target.closest('[data-tbdelstage]'))) {
      var stages = ui.ttBell.stages, si = +el.getAttribute('data-tbdelstage');
      if (stages.length < 2) return toast('لا بد من مرحلة واحدة على الأقل', true);
      var moved = stages[si].classes;
      stages.splice(si, 1);
      stages[0].classes = stages[0].classes.concat(moved);
      return render();
    }
    if ((el = e.target.closest('[data-tbcls]'))) return ttToggleStageClass(+el.getAttribute('data-tbst'), el.getAttribute('data-tbcls'));
    if ((el = e.target.closest('[data-tbadd]'))) {
      var st = ui.ttBell.stages[+el.getAttribute('data-tbst')], k = el.getAttribute('data-tbadd'), last = st.rows[st.rows.length - 1];
      var s0 = last ? ttMins(last.t) : 8 * 60, len = k === 'p' ? 40 : 15, nr = { k: k, f: ttHm(s0), t: ttHm(s0 + len) };
      if (k === 'b') nr.l = 'الاستراحة';
      st.rows.push(nr);
      return render();
    }
    if (e.target.closest('[data-tqadd]')) { ui.ttQuota.push({ class_name: ui.ttQClass, subject: '', teacher_id: '', count: 1 }); return render(); }
    if ((el = e.target.closest('[data-tqdel]'))) { ui.ttQuota.splice(+el.getAttribute('data-tqdel'), 1); return render(); }
    if (e.target.closest('[data-tqreset]')) { ui.ttQuota = null; return render(); }
    if (e.target.closest('[data-tqfill]')) {
      if (ui.ttQuota.length && !confirm('استبدال النصاب المكتوب بما في الجدول الحالي؟ (لا يُحفظ قبل «حفظ النصاب»)')) return;
      var act = ttActualLoad();
      ui.ttQuota = Object.keys(act).map(function (k) { var p = k.split('\u0001'); return { class_name: p[0], subject: p[1], teacher_id: p[2], count: act[k] }; })
        .sort(function (a, b) { var c = ttClasses(); return c.indexOf(a.class_name) - c.indexOf(b.class_name) || a.subject.localeCompare(b.subject, 'ar'); });
      return render();
    }
    if (e.target.closest('[data-tqsave]')) {
      var bad = ui.ttQuota.filter(function (r) { return !r.subject || !(Number(r.count) >= 0); });
      if (bad.length) return toast('أكمل المادة والعدد في كل سطر، أو احذف السطر الناقص', true);
      ui.ttQuota.forEach(function (r) { r.count = Math.round(Number(r.count)); r.teacher_id = r.teacher_id || ''; });
      ttSaveConfig({ quota: ui.ttQuota }).then(function (ok) { if (ok) { ui.ttQuota = null; render(); toast('حُفظ النصاب'); } });
      return;
    }
    if (e.target.closest('[data-trulesave]')) {
      var dr = ttRuleDraft();
      for (var ri = 0; ri < dr.c.length; ri++) { var pr = ttRuleProblem(dr.c[ri]); if (pr) return toast(pr, true); }
      // القواعد الأساسية في مفاتيحها، و«قواعدي» في custom (شرط القرآن القديم rules.first صار منها)
      ttSaveConfig({ rules: Object.assign({}, dr.b, { custom: dr.c }) }).then(function (ok) { if (ok) { ui.ttRuleDraft = null; ui.ttOpt = null; render(); toast('حُفظت القواعد'); } });
      return;
    }
    if (e.target.closest('[data-trreset]')) { ui.ttRuleDraft = null; return render(); }
    if (e.target.closest('[data-traddrule]')) {
      var type = document.getElementById('tt-newrule').value, nr = { id: 'r' + Date.now().toString(36), type: type, on: true, level: 'mid' };
      if (TT_RTYPES[type].f.indexOf('n') > -1) nr.n = type === 'subjDayMax' ? 1 : type === 'tLastMax' ? 2 : type === 'tFirstMin' ? 1 : 4;
      ttRuleDraft().c.push(nr);
      return render();
    }
    if ((el = e.target.closest('[data-trdel]'))) { ttRuleDraft().c.splice(+el.getAttribute('data-trdel'), 1); return render(); }
    if ((el = e.target.closest('[data-trcx]'))) {
      var px = el.getAttribute('data-trcx').split('|'), rr = ttRuleDraft().c[+px[0]], list = ttNums(rr[px[1]]), v = +px[2], at = list.indexOf(v);
      if (at > -1) list.splice(at, 1); else list.push(v);
      rr[px[1]] = list.sort(function (a, b) { return a - b; });
      return render();
    }
    if (e.target.closest('[data-ttopt]')) {
      var btn = e.target.closest('[data-ttopt]');
      btn.disabled = true;
      btn.textContent = 'جارٍ البحث…';
      setTimeout(function () { var r = ttOptimize(ui.ttImpT || '', ui.ttTol || 0); r.tid = ui.ttImpT || ''; r.tol = ui.ttTol || 0; ui.ttOpt = r; render(); }, 30);
      return;
    }
    if (e.target.closest('[data-ttoptclear]')) { ui.ttOpt = null; return render(); }
    if (e.target.closest('[data-ttpropsave]')) return ttSaveProposal();
    if ((el = e.target.closest('[data-ttpropok]'))) return ttDecideProposal(el.getAttribute('data-ttpropok'), true);
    if ((el = e.target.closest('[data-ttpropno]'))) return ttDecideProposal(el.getAttribute('data-ttpropno'), false);
    if ((el = e.target.closest('[data-ttmerge]'))) { var mp = el.getAttribute('data-ttmerge').split('|'); return ttMergeTeacher(mp[0], mp[1]); }
    if ((el = e.target.closest('[data-ttmoveto]'))) {
      var to = document.getElementById('tt-moveto').value;
      if (!to) return toast('اختر السجل الذي تنتقل إليه الحصص', true);
      return ttMergeTeacher(el.getAttribute('data-ttmoveto'), to);
    }
    if (e.target.closest('[data-ttimprun]')) return ttRunImport(e.target.closest('[data-ttimprun]'));
    if (e.target.closest('[data-ttimpcancel]')) { ui.ttImp = null; return render(); }
  });

  // إغلاق شاشة العرض (خارج منطقة التطبيق)
  document.addEventListener('click', function (e) { if (e.target.closest('[data-tbclose]')) ttCloseDisplay(); });

  app.addEventListener('change', function (e) {
    if (!/^#\/timetable/.test(location.hash)) return;
    var el = e.target;
    if (el.id === 'tt-addteacher' && el.value) { ui.ttTeacher = el.value; return render(); }
    if (el.id === 'tt-impt') { ui.ttImpT = el.value; ui.ttOpt = null; return render(); }
    if (el.id === 'tt-tol') { ui.ttTol = Number(el.value) || 0; ui.ttOpt = null; return render(); }
    if (el.id === 'tt-head') { try { localStorage.setItem('tt-nohead', el.checked ? '0' : '1'); } catch (err) {} return; }
    if (el.id === 'tt-sign') { try { localStorage.setItem('tt-sign', el.checked ? '1' : '0'); } catch (err) {} return; }
    if (!canEditTT()) return;
    if (/^tte-(day|period|class|teacher|subject)$/.test(el.id)) {
      ttReadEditor();
      if (el.id === 'tte-teacher' && !ui.ttEdit.id && !ui.ttEdit.newSubject) ui.ttEdit.subject = ttGuessSubject(ui.ttEdit.teacher_id) || ui.ttEdit.subject;
      render();
      var f = document.getElementById(el.id === 'tte-subject' && ui.ttEdit.newSubject ? 'tte-subnew' : el.id);
      if (f) f.focus();
      return;
    }
    if (el.id === 'tb-auto' && ui.ttBell) { ui.ttBell.auto = el.checked; return; }
    if (el.hasAttribute('data-tbact')) { var a = el.value; el.value = ''; if (a) ttBellAction(+el.getAttribute('data-tbst'), +el.getAttribute('data-tbr'), a); return; }
    if (el.hasAttribute('data-tbf') && ui.ttBell) return ttBellInput(el);
    if (el.id === 'tt-file' && el.files && el.files[0]) {
      var file = el.files[0], reader = new FileReader();
      reader.onload = function () {
        try { ttImpPrepare(JSON.parse(String(reader.result).replace(/^﻿/, '')), file.name); render(); }
        catch (err) { toast('تعذرت قراءة الملف: ' + err.message, true); }
      };
      reader.readAsText(file, 'utf-8');
      return;
    }
    if (el.hasAttribute('data-trb')) {
      var bp = el.getAttribute('data-trb').split('|');
      ttRuleDraft().b[bp[0]][bp[1]] = bp[1] === 'on' ? el.checked : Number(el.value) || 0;
      return render();
    }
    if (el.hasAttribute('data-trc')) {
      var cp = el.getAttribute('data-trc').split('|'), cr = ttRuleDraft().c[+cp[0]];
      cr[cp[1]] = cp[1] === 'on' ? el.checked : cp[1] === 'n' ? el.value : el.value.trim();
      return render();
    }
    if (el.hasAttribute('data-tq')) {
      var row = ui.ttQuota[+el.getAttribute('data-tq')], f = el.getAttribute('data-f');
      row[f] = f === 'count' ? el.value : el.value;
      return render();
    }
    if (el.hasAttribute('data-ttimpc')) { ui.ttImp.classMap[el.getAttribute('data-ttimpc')] = el.value; return render(); }
    if (el.hasAttribute('data-ttimpt')) { ui.ttImp.teacherMap[el.getAttribute('data-ttimpt')] = el.value; return render(); }
  });

