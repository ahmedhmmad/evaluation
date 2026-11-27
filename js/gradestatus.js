'use strict';
  /* ---------- متابعة الرصد (الإدارة) ----------
     من رصد ومن لم يرصد: لكل شعبة ومادة في جدول الحصص (ومعلمها) عدد الطلاب المرصودة درجاتهم في كل اختبار من اختبارات الفصل.
     الحالة: «لم يُرصد» (لا درجة في أي اختبار)، «جزئي» (بعض الدرجات)، «مكتمل» (درجة لكل طالب في كل اختبار). */
  var GST = { loaded: false, busy: false, items: [], grades: [], sessions: [], error: '' };
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
      if (!x.class_name || !x.subject || !students[x.class_name]) return;
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
  var GST_LABEL = { none: 'لم يُرصد', part: 'جزئي', full: 'مكتمل' }, GST_COLOR = { none: '#B91C1C', part: '#B45309', full: '#15803D' };
  function gstBadge(st, pct) {
    return '<span style="display:inline-block;padding:1px 10px;border-radius:999px;font-weight:700;font-size:.9em;color:' + GST_COLOR[st] + ';border:1px solid ' + GST_COLOR[st] + '">' + GST_LABEL[st] + (st === 'part' ? ' ' + pct + '%' : '') + '</span>';
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
    } else {
      var key = u.view === 'teacher' ? 'teacher' : 'cls', m = {};
      all.forEach(function (r) { (u.view === 'teacher' ? (r.teachers.length ? r.teachers : ['بلا معلم في الجدول']) : [r.cls]).forEach(function (k) { (m[k] || (m[k] = [])).push(r); }); });
      var names = Object.keys(m); if (u.view === 'teacher') names.sort(function (a, b) { return a.localeCompare(b, 'ar'); });
      var out = names.map(function (k) { var t = gstTally(m[k]); return { k: k, t: t, st: gstGroupStatus(t), rows: m[k] }; }).filter(function (g) { return keep(g.st); });
      body = out.length ? '<div class="card"><div class="table-wrap"><table class="grid"><thead><tr><th>' + (key === 'teacher' ? 'المعلم' : 'الشعبة') + '</th><th>' + (key === 'teacher' ? 'شعبه ومواده' : 'المواد') + '</th><th>مكتمل</th><th>جزئي</th><th>لم يُرصد</th><th>الحالة</th></tr></thead><tbody>' +
        out.map(function (g) {
          var list = g.rows.map(function (r) { return '<span style="color:' + GST_COLOR[r.status] + '">' + esc(key === 'teacher' ? r.cls + ' — ' + r.subject : r.subject) + '</span>'; }).join('، ');
          return '<tr><td><b>' + esc(g.k) + '</b></td><td style="font-size:.92em">' + list + '</td><td class="c">' + g.t.full + '</td><td class="c">' + g.t.part + '</td><td class="c">' + g.t.none + '</td><td>' + gstBadge(g.st, Math.round(g.rows.reduce(function (a, r) { return a + r.pct; }, 0) / g.rows.length)) + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="hint">المواد الملوّنة: أخضر مكتمل، برتقالي جزئي، أحمر لم يُرصد.</p></div>' : '<div class="card empty">لا نتائج.</div>';
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
