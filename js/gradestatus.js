'use strict';
  /* ---------- متابعة الرصد (الإدارة) ----------
     من رصد ومن لم يرصد: لكل شعبة ومادة في جدول الحصص (ومعلمها) عدد الطلاب المرصودة درجاتهم في كل اختبار من اختبارات الفصل.
     الحالة: «لم يُرصد» (لا درجة في أي اختبار)، «جزئي» (بعض الدرجات)، «مكتمل» (درجة لكل طالب في كل اختبار). */
  var GST = { loaded: false, busy: false, items: [], grades: [], sessions: [], error: '' };
  var GST_QURAN = /(قرآن|قران)/;
  function gstUi() { return ui.gst || (ui.gst = { term: '', view: 'class', status: '' }); }
  async function gstLoad() {
    if (GST.busy) return; GST.busy = true;
    var it = await sb.from('grade_items').select('id, term, name, max_score, sort').order('term').order('sort');
    var ss = it.error ? null : await fetchAll(function () { return sb.from('timetable_sessions').select('class_name, subject, teacher_id').neq('status', 'removed'); });
    var g = ss == null ? null : await fetchAll(function () { return sb.from('grades').select('student_id, item_id, subject').not('score', 'is', null); });
    GST.busy = false;
    if (it.error || ss == null || g == null) GST.error = (it.error && it.error.message) || 'تعذّر جلب البيانات';
    else { GST.items = it.data || []; GST.sessions = ss; GST.grades = g; GST.error = ''; }
    GST.loaded = true; render();
  }
  // صف لكل شعبة ومادة: معلموها، وعدد المرصودة درجاتهم في كل اختبار، والحالة
  function gstCompute(term) {
    var items = GST.items.filter(function (x) { return term === '*' || x.term === term; }), isItem = {};
    items.forEach(function (x) { isItem[x.id] = 1; });
    var students = {}, cls = {};
    S.students.filter(enrolled).forEach(function (x) { if (x.class_name) { (students[x.class_name] || (students[x.class_name] = [])).push(x.id); cls[x.id] = x.class_name; } });
    var rec = {}; // صف|مادة|اختبار ← عدد الطلاب المرصودة درجاتهم
    GST.grades.forEach(function (g) {
      if (!isItem[g.item_id]) return;
      var c = cls[g.student_id]; if (!c) return;
      var k = c + '\u0001' + String(g.subject || '').trim() + '\u0001' + g.item_id; rec[k] = (rec[k] || 0) + 1;
    });
    var map = {};
    GST.sessions.forEach(function (x) {
      if (!x.class_name || !x.subject || !students[x.class_name] || GST_QURAN.test(x.subject)) return;
      var k = x.class_name + '\u0001' + String(x.subject).trim(), e = map[k] || (map[k] = { cls: x.class_name, subject: String(x.subject).trim(), teachers: [] }), t = x.teacher_id && find(x.teacher_id);
      if (t && e.teachers.indexOf(t.name) < 0) e.teachers.push(t.name);
    });
    var rows = Object.keys(map).map(function (k) {
      var e = map[k], n = students[e.cls].length, got = 0;
      e.total = n; e.per = items.map(function (it) { var c = rec[e.cls + '\u0001' + e.subject + '\u0001' + it.id] || 0; got += c; return c; });
      e.pct = items.length && n ? Math.round(got / (items.length * n) * 100) : 0;
      e.status = got === 0 ? 'none' : got >= items.length * n ? 'full' : 'part';
      return e;
    }).sort(function (a, b) { return classRank(a.cls) - classRank(b.cls) || gradeOf(a.cls) - gradeOf(b.cls) || a.cls.localeCompare(b.cls, 'ar', { numeric: true }) || a.subject.localeCompare(b.subject, 'ar'); });
    return { items: items, rows: rows };
  }
  // معلمو القرآن الكريم: من مادته في بياناته قرآن، أو كل حصصه في الجدول قرآن
  function gstQuranTeachers() {
    var by = {}; GST.sessions.forEach(function (x) { if (x.teacher_id) { var e = by[x.teacher_id] || (by[x.teacher_id] = { all: 0, q: 0 }); e.all++; if (GST_QURAN.test(x.subject || '')) e.q++; } });
    return S.teachers.filter(function (t) { var e = by[t.id]; return GST_QURAN.test(t.subject || '') || (e && e.all === e.q); });
  }
  var GST_LABEL = { none: 'لم يُرصد', part: 'جزئي', full: 'مكتمل' }, GST_COLOR = { none: '#B91C1C', part: '#B45309', full: '#15803D' };
  function gstBadge(st, pct) {
    return '<span style="display:inline-block;padding:1px 10px;border-radius:999px;font-weight:700;font-size:.9em;color:' + GST_COLOR[st] + ';border:1px solid ' + GST_COLOR[st] + '">' + GST_LABEL[st] + (st === 'part' && pct != null ? ' ' + pct + '%' : '') + '</span>';
  }
  function gstTally(rows) {
    var t = { none: 0, part: 0, full: 0 }; rows.forEach(function (r) { t[r.status]++; });
    return t;
  }
  // حالة مجموعة (شعبة أو معلم) من حالات صفوفها
  function gstGroupStatus(t) { return t.full && !t.part && !t.none ? 'full' : !t.full && !t.part ? 'none' : 'part'; }
  function renderGradeStatus() {
    if (!(isAdmin() || isManager())) return;
    if (!GST.loaded) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; gstLoad(); return; }
    if (GST.error) { app.innerHTML = '<div class="card empty">' + esc(GST.error) + '</div>'; return; }
    var u = gstUi(), terms = []; GST.items.forEach(function (x) { if (terms.indexOf(x.term) < 0) terms.push(x.term); });
    if (!u.term || (u.term !== '*' && terms.indexOf(u.term) < 0)) u.term = terms[0] || '';
    var d = gstCompute(u.term), all = d.rows, tot = gstTally(all);
    var head = '<div class="page-head"><div><h1>متابعة الرصد</h1><p>من رصد درجاته ومن لم يرصد، والشعب والمواد المرصودة وغير المرصودة، بحسب جدول الحصص واختبارات الفصل.</p></div></div>';
    var bar = '<div class="card"><div class="toolbar" style="align-items:center;margin:0">' +
      '<label class="field" for="gst-term" style="margin:0">الفصل</label><select id="gst-term" data-ro-ok style="width:auto">' + terms.map(function (t) { return '<option value="' + esc(t) + '"' + (t === u.term ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + (terms.length > 1 ? '<option value="*"' + (u.term === '*' ? ' selected' : '') + '>الفصلان معًا</option>' : '') + '</select>' +
      '<label class="field" for="gst-view" style="margin:0">العرض</label><select id="gst-view" data-ro-ok style="width:auto"><option value="class"' + (u.view === 'class' ? ' selected' : '') + '>الشعب</option><option value="teacher"' + (u.view === 'teacher' ? ' selected' : '') + '>المعلمون</option><option value="detail"' + (u.view === 'detail' ? ' selected' : '') + '>التفصيل (شعبة ومادة)</option></select>' +
      '<label class="field" for="gst-status" style="margin:0">الحالة</label><select id="gst-status" data-ro-ok style="width:auto"><option value="">الكل</option>' + ['none', 'part', 'full'].map(function (k) { return '<option value="' + k + '"' + (u.status === k ? ' selected' : '') + '>' + GST_LABEL[k] + '</option>'; }).join('') + '</select>' +
      '<span style="flex:1"></span><button type="button" class="btn" data-gst-reload data-ro-ok>تحديث</button></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px">' + ['full', 'part', 'none'].map(function (k) { return '<div style="flex:1;min-width:130px;border:1px solid ' + GST_COLOR[k] + ';border-radius:10px;padding:8px 12px"><div style="color:' + GST_COLOR[k] + ';font-weight:800;font-size:1.6em">' + tot[k] + '</div><div class="meta">مادة ' + GST_LABEL[k] + '</div></div>'; }).join('') + '</div></div>';
    if (!d.items.length) { app.innerHTML = head + bar + '<div class="card empty">لم تُعدّ اختبارات لهذا الفصل بعد.</div>'; return; }
    var keep = function (st) { return !u.status || st === u.status; }, body = '';
    if (u.view === 'detail') {
      var rows = all.filter(function (r) { return keep(r.status); });
      body = rows.length ? '<div class="card"><div class="table-wrap"><table class="grid"><thead><tr><th>الشعبة</th><th>المادة</th><th>المعلم</th>' + d.items.map(function (x) { return '<th style="white-space:nowrap">' + esc(x.name) + '</th>'; }).join('') + '<th>الحالة</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td><b>' + esc(r.cls) + '</b></td><td>' + esc(r.subject) + '</td><td>' + (esc(r.teachers.join('، ')) || '<span class="meta">—</span>') + '</td>' +
            r.per.map(function (c) { return '<td class="c" style="color:' + (c === 0 ? GST_COLOR.none : c >= r.total ? GST_COLOR.full : GST_COLOR.part) + ';font-weight:700">' + c + ' / ' + r.total + '</td>'; }).join('') + '<td>' + gstBadge(r.status, r.pct) + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="hint">الأرقام: عدد الطلاب المرصودة درجاتهم من عدد طلاب الشعبة في كل اختبار.</p></div>' : '<div class="card empty">لا نتائج.</div>';
    } else if (u.view === 'class') {
      // جدول رأسه الصف، ثم كل مادة برأس يتفرع إلى اختباراتها؛ وتحت كل اختبار: المدخل / عدد طلاب الصف
      var subs = [], byCls = {};
      all.forEach(function (r) { if (subs.indexOf(r.subject) < 0) subs.push(r.subject); (byCls[r.cls] || (byCls[r.cls] = {}))[r.subject] = r; });
      subs.sort(function (a, b) { return a.localeCompare(b, 'ar'); });
      var cl = Object.keys(byCls).filter(function (c) { return keep(gstGroupStatus(gstTally(Object.keys(byCls[c]).map(function (s) { return byCls[c][s]; })))); });
      var nI = d.items.length, cellC = function (c, n) { return c === 0 ? GST_COLOR.none : c >= n ? GST_COLOR.full : GST_COLOR.part; };
      body = cl.length ? '<div class="card"><div class="table-wrap"><table class="grid"><thead><tr><th rowspan="2">الصف</th>' + subs.map(function (s) { return '<th colspan="' + nI + '" style="text-align:center;border-inline-start:2px solid var(--line)">' + esc(s) + '</th>'; }).join('') + '</tr><tr>' +
        subs.map(function () { return d.items.map(function (x, i) { return '<th style="white-space:nowrap;font-size:.85em;font-weight:600' + (i === 0 ? ';border-inline-start:2px solid var(--line)' : '') + '">' + esc(x.name) + '</th>'; }).join(''); }).join('') + '</tr></thead><tbody>' +
        cl.map(function (c) {
          return '<tr><td style="white-space:nowrap"><b>' + esc(c) + '</b></td>' + subs.map(function (s) {
            var r = byCls[c][s];
            if (!r) return '<td class="c" colspan="' + nI + '" style="color:var(--muted);border-inline-start:2px solid var(--line)">—</td>';
            return r.per.map(function (n, i) { return '<td class="c" style="white-space:nowrap;font-weight:700;color:' + cellC(n, r.total) + (i === 0 ? ';border-inline-start:2px solid var(--line)' : '') + '">' + n + '/' + r.total + '</td>'; }).join('');
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div><p class="hint">الأرقام: عدد الطلاب المرصودة درجاتهم / عدد طلاب الصف، لكل اختبار؛ أخضر مكتمل، برتقالي جزئي، أحمر لم يُرصد. مادة القرآن الكريم لا تظهر هنا.</p></div>' : '<div class="card empty">لا نتائج.</div>';
    } else {
      var key = u.view === 'teacher' ? 'teacher' : 'cls', m = {};
      var qn = gstQuranTeachers().map(function (t) { return t.name; });
      all.forEach(function (r) { (u.view === 'teacher' ? (r.teachers.length ? r.teachers : ['بلا معلم في الجدول']) : [r.cls]).forEach(function (k) { if (u.view === 'teacher' && qn.indexOf(k) > -1) return; (m[k] || (m[k] = [])).push(r); }); });
      var names = Object.keys(m); if (u.view === 'teacher') names.sort(function (a, b) { return a.localeCompare(b, 'ar'); });
      var out = names.map(function (k) { var t = gstTally(m[k]); return { k: k, t: t, st: gstGroupStatus(t), rows: m[k] }; }).filter(function (g) { return keep(g.st); });
      body = out.length ? '<div class="card"><div class="table-wrap"><table class="grid"><thead><tr><th>' + (key === 'teacher' ? 'المعلم' : 'الشعبة') + '</th><th>' + (key === 'teacher' ? 'شعبه ومواده' : 'المواد') + '</th><th>مكتمل</th><th>جزئي</th><th>لم يُرصد</th><th>الحالة</th></tr></thead><tbody>' +
        out.map(function (g) {
          var list = g.rows.map(function (r) { return '<span style="color:' + GST_COLOR[r.status] + '">' + esc(key === 'teacher' ? r.cls + ' — ' + r.subject : r.subject) + '</span>'; }).join('، ');
          return '<tr><td><b>' + esc(g.k) + '</b></td><td style="font-size:.92em">' + list + '</td><td class="c">' + g.t.full + '</td><td class="c">' + g.t.part + '</td><td class="c">' + g.t.none + '</td><td>' + gstBadge(g.st, u.view === 'teacher' ? null : Math.round(g.rows.reduce(function (a, r) { return a + r.pct; }, 0) / g.rows.length)) + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="hint">المواد الملوّنة: أخضر مكتمل، برتقالي جزئي، أحمر لم يُرصد. معلمو القرآن الكريم في تبويب «معلمو القرآن».</p></div>' : '<div class="card empty">لا نتائج.</div>';
    }
    app.innerHTML = head + bar + body;
  }
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/gradestatus') return;
    var u = gstUi(), t = e.target;
    if (t.id === 'gst-term') u.term = t.value; else if (t.id === 'gst-view') u.view = t.value; else if (t.id === 'gst-status') u.status = t.value; else return;
    render();
  });
  document.addEventListener('click', function (e) {
    if (location.hash === '#/gradestatus' && e.target.closest('[data-gst-reload]')) { GST.loaded = false; render(); }
  });
  /* ---------- معلمو القرآن الكريم ----------
     لا تُقاس متابعتهم بدرجات مادة القرآن في «رصد الدرجات»، بل بالاختبارات التي كُلّفوا بها من شاشة «الاختبارات»:
     لكل معلم اختباراته، وعدد الطلاب المرصودة درجاتهم من عدد طلاب الاختبار. */
  function renderQuranStatus() {
    if (!(isAdmin() || isManager())) return;
    var rx = rxState();
    if (!GST.loaded) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; gstLoad(); return; }
    if (!rx.loaded) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; rxLoad(); return; }
    if (GST.error) { app.innerHTML = '<div class="card empty">' + esc(GST.error) + '</div>'; return; }
    var u = gstUi(), rows = [];
    gstQuranTeachers().sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); }).forEach(function (t) {
      var ex = rx.list.filter(function (e) { return (e.teacher_ids || []).indexOf(t.id) > -1; });
      if (!ex.length) return rows.push({ t: t, none: true, status: 'none' });
      ex.forEach(function (e) {
        var ids = e.student_ids || [], got = ids.filter(function (id) { var g = (e.grades || {})[id]; return g != null && String(g).trim() !== ''; }).length;
        rows.push({ t: t, e: e, n: ids.length, got: got, status: got === 0 ? 'none' : got >= ids.length ? 'full' : 'part' });
      });
    });
    var tot = gstTally(rows.filter(function (r) { return !r.none; })), shown = rows.filter(function (r) { return !u.status || r.status === u.status; });
    var head = '<div class="page-head"><div><h1>معلمو القرآن الكريم</h1><p>متابعة الرصد لمعلمي القرآن بحسب الاختبارات المكلَّفين بها في شاشة «الاختبارات»، لا بدرجات المادة.</p></div></div>';
    var bar = '<div class="card"><div class="toolbar" style="align-items:center;margin:0"><label class="field" for="gst-status" style="margin:0">الحالة</label><select id="gst-status" data-ro-ok style="width:auto"><option value="">الكل</option>' +
      ['none', 'part', 'full'].map(function (k) { return '<option value="' + k + '"' + (u.status === k ? ' selected' : '') + '>' + GST_LABEL[k] + '</option>'; }).join('') + '</select><span style="flex:1"></span><button type="button" class="btn" data-gst-qreload data-ro-ok>تحديث</button></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px">' + ['full', 'part', 'none'].map(function (k) { return '<div style="flex:1;min-width:130px;border:1px solid ' + GST_COLOR[k] + ';border-radius:10px;padding:8px 12px"><div style="color:' + GST_COLOR[k] + ';font-weight:800;font-size:1.6em">' + tot[k] + '</div><div class="meta">اختبار ' + GST_LABEL[k] + '</div></div>'; }).join('') + '</div></div>';
    if (!rows.length) { app.innerHTML = head + bar + '<div class="card empty">لا معلمين للقرآن الكريم في جدول الحصص أو بيانات المعلمين.</div>'; return; }
    app.innerHTML = head + bar + (shown.length ? '<div class="card"><div class="table-wrap"><table class="grid"><thead><tr><th>المعلم</th><th>الاختبار</th><th>التاريخ</th><th>المرصود / الطلاب</th><th>الحالة</th></tr></thead><tbody>' +
      shown.map(function (r) {
        if (r.none) return '<tr><td><b>' + esc(r.t.name) + '</b></td><td colspan="3" class="meta">لا اختبار مكلَّف به</td><td>' + gstBadge('none') + '</td></tr>';
        return '<tr><td><b>' + esc(r.t.name) + '</b></td><td>' + esc(r.e.title || '') + '</td><td class="c">' + (r.e.exam_date ? dmy(r.e.exam_date) : '') + '</td><td class="c" style="font-weight:700;color:' + GST_COLOR[r.status] + '">' + r.got + ' / ' + r.n + '</td><td>' + gstBadge(r.status, r.n ? Math.round(r.got / r.n * 100) : 0) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>' : '<div class="card empty">لا نتائج.</div>');
  }
  document.addEventListener('change', function (e) {
    if (location.hash === '#/quranstatus' && e.target.id === 'gst-status') { gstUi().status = e.target.value; render(); }
  });
  document.addEventListener('click', function (e) {
    if (location.hash === '#/quranstatus' && e.target.closest('[data-gst-qreload]')) { GST.loaded = false; rxState().loaded = false; render(); }
  });
