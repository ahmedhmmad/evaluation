'use strict';
  /* ---------- متابعة الرصد (الإدارة) ----------
     من رصد ومن لم يرصد: لكل شعبة ومادة في جدول الحصص (ومعلمها) عدد الطلاب المرصودة درجاتهم في كل اختبار من اختبارات الفصل.
     الحالة: «لم يُرصد» (لا درجة في أي اختبار)، «جزئي» (بعض الدرجات)، «مكتمل» (درجة لكل طالب في كل اختبار).
     التصميم من فيجما (rasd): شريط ملخص بحلقة إنجاز وثلاث بطاقات حالة، شريط تحكم ثابت (الفصل، العرض، الحالة، البحث)،
     وأربعة عروض: الشعب (خريطة حرارية)، المعلمون (بطاقات)، التفصيل (جدول)، معلمو القرآن؛ ولوحة جانبية بتفاصيل الخلية أو المعلم. */
  var GST = { loaded: false, busy: false, items: [], grades: [], sessions: [], error: '', at: null, dr: null, cur: null };
  var GST_QURAN = /(قرآن|قران)/;
  function gstUi() { return ui.gst || (ui.gst = { term: '', view: 'class', status: '', q: '', lim: 60, mf: false }); }
  async function gstLoad() {
    if (GST.busy) return; GST.busy = true;
    var it = await sb.from('grade_items').select('id, term, name, max_score, sort').order('term').order('sort');
    var ss = it.error ? null : await fetchAll(function () { return sb.from('timetable_sessions').select('class_name, subject, teacher_id').neq('status', 'removed'); });
    var g = ss == null ? null : await fetchAll(function () { return sb.from('grades').select('student_id, item_id, subject, teacher_id, updated_at').not('score', 'is', null); });
    GST.busy = false;
    if (it.error || ss == null || g == null) GST.error = (it.error && it.error.message) || 'تعذّر جلب البيانات';
    else { GST.items = it.data || []; GST.sessions = ss; GST.grades = g; GST.error = ''; GST.at = new Date(); }
    GST.loaded = true; render();
  }
  // آخر رصد لكل معلم (من وقت حفظ درجاته)
  function gstLastBy() {
    var m = {}; GST.grades.forEach(function (g) { if (g.teacher_id && g.updated_at && (!m[g.teacher_id] || g.updated_at > m[g.teacher_id])) m[g.teacher_id] = g.updated_at; });
    return m;
  }
  function gstAgo(iso) {
    if (!iso) return '';
    var m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (m < 1) return 'الآن';
    if (m < 60) return 'منذ ' + m + ' دقيقة';
    if (m < 1440) return 'منذ ' + Math.round(m / 60) + ' ساعة';
    return 'منذ ' + Math.round(m / 1440) + ' يوم';
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
      var k = x.class_name + '\u0001' + String(x.subject).trim(), e = map[k] || (map[k] = { cls: x.class_name, subject: String(x.subject).trim(), teachers: [], tids: [] }), t = x.teacher_id && find(x.teacher_id);
      if (t && e.teachers.indexOf(t.name) < 0) { e.teachers.push(t.name); e.tids.push(t.id); }
    });
    var rows = Object.keys(map).map(function (k) {
      var e = map[k], n = students[e.cls].length, got = 0;
      e.total = n; e.per = items.map(function (it) { var c = rec[e.cls + '\u0001' + e.subject + '\u0001' + it.id] || 0; got += c; return c; });
      e.got = got; e.need = items.length * n;
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
  var GST_LABEL = { none: 'لم يُرصد', part: 'جزئي', full: 'مكتمل' }, GST_ICON = { none: '!', part: '◐', full: '✓' };
  function gstBadge(st, pct) {
    return '<span class="gs-badge ' + st + '"><b>' + GST_ICON[st] + '</b>' + GST_LABEL[st] + (st === 'part' && pct != null ? ' ' + pct + '%' : '') + '</span>';
  }
  function gstTally(rows) {
    var t = { none: 0, part: 0, full: 0 }; rows.forEach(function (r) { t[r.status]++; });
    return t;
  }
  function gstIcon(name, size) {
    var p = {
      refresh: '<path d="M20 6v5h-5"/><path d="M19 11a7.5 7.5 0 1 0-1.7 7.8"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.7M16 3.3a4 4 0 0 1 0 7.4"/>',
      grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
      table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
      book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5z"/><path d="M8 7h8M8 11h6"/>',
      download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 19h16"/>',
      chevron: '<path d="m9 18 6-6-6-6"/>',
      close: '<path d="m18 6-12 12M6 6l12 12"/>',
      alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 17h.01"/>',
      filter: '<path d="M4 5h16M7 12h10M10 19h4"/>'
    };
    return '<svg class="gs-i" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p[name] + '</svg>';
  }
  function gstMatch(r, u) {
    if (u.status && r.status !== u.status) return false;
    var q = norm(u.q);
    return !q || norm(r.cls + ' ' + r.subject + ' ' + r.teachers.join(' ')).indexOf(q) > -1;
  }
  // المعلمون من صفوف الاختبارات العادية (معلمو القرآن لهم تبويبهم)
  function gstTeacherGroups(rows) {
    var qn = gstQuranTeachers().map(function (t) { return t.name; }), m = {}, last = gstLastBy();
    rows.forEach(function (r) {
      (r.teachers.length ? r.teachers : ['بلا معلم في الجدول']).forEach(function (k, i) {
        if (qn.indexOf(k) > -1) return;
        var g = m[k] || (m[k] = { name: k, rows: [], tids: [], cls: {}, subs: {}, got: 0, need: 0 });
        g.rows.push(r); g.cls[r.cls] = 1; g.subs[r.subject] = 1; g.got += r.got; g.need += r.need;
        var id = r.tids[r.teachers.indexOf(k)]; if (id && g.tids.indexOf(id) < 0) g.tids.push(id);
      });
    });
    return Object.keys(m).map(function (k) {
      var g = m[k]; g.t = gstTally(g.rows); g.pct = g.need ? Math.round(g.got / g.need * 100) : 0;
      g.last = g.tids.map(function (id) { return last[id] || ''; }).sort().pop() || '';
      g.initials = k.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0); }).join('');
      return g;
    });
  }
  // الشريط العلوي المشترك: العنوان، الملخص، شريط التحكم
  function gstTop(o) {
    var u = gstUi(), t = o.tally, total = t.none + t.part + t.full;
    var views = [['class', 'الشعب', 'grid'], ['teacher', 'المعلمون', 'users'], ['detail', 'التفصيل', 'table'], ['quran', 'معلمو القرآن', 'book']];
    var cards = ['full', 'part', 'none'].map(function (k) {
      return '<button type="button" class="gs-sum ' + k + (u.status === k ? ' sel' : '') + '" data-gs-status="' + k + '" data-ro-ok aria-pressed="' + (u.status === k) + '"><span class="gs-sico">' + GST_ICON[k] + '</span><span><span class="gs-slabel">' + GST_LABEL[k] + '</span><strong>' + t[k] + '</strong><small>' + o.unit + ' من أصل ' + total + '</small></span><span class="gs-sarr">' + gstIcon('chevron', 17) + '</span></button>';
    }).join('');
    var chips = '<button type="button" class="' + (u.status === '' ? 'on' : '') + '" data-gs-status="" data-ro-ok>الكل <b>' + total + '</b></button>' + ['full', 'part', 'none'].map(function (k) {
      return '<button type="button" class="' + k + (u.status === k ? ' on' : '') + '" data-gs-status="' + k + '" data-ro-ok><i>' + GST_ICON[k] + '</i>' + GST_LABEL[k] + '</button>';
    }).join('');
    return '<header class="gs-head"><div><p class="gs-eye">الاختبارات والدرجات</p><h1>متابعة الرصد</h1><p>' + o.sub + '</p></div>' +
        '<div class="gs-upd"><button type="button" class="gs-btn primary" data-gs-reload data-ro-ok>' + gstIcon('refresh', 18) + ' تحديث</button><span><i></i> آخر تحديث ' + (GST.at ? gstAgo(GST.at.toISOString()) : '—') + '</span></div></header>' +
      '<section class="gs-strip"><div class="gs-done"><div class="gs-ring" style="--p:' + o.pct + '%" role="img" aria-label="نسبة الإنجاز الكلية ' + o.pct + ' بالمئة"><div><strong>' + o.pct + '%</strong><span>نسبة الإنجاز</span></div></div>' +
        '<div><p class="gs-eye">الإجمالي</p><h2>' + t.full + ' من ' + total + ' ' + o.unit + ' مكتملة</h2><p>' + o.note + '</p></div></div><div class="gs-sums">' + cards + '</div></section>' +
      '<div class="gs-bar"><div class="gs-top">' +
        (o.terms ? '<div class="gs-seg" role="group" aria-label="الفصل الدراسي">' + o.terms.map(function (x) { return '<button type="button" class="' + (x[0] === u.term ? 'on' : '') + '" data-gs-term="' + esc(x[0]) + '" data-ro-ok>' + esc(x[1]) + '</button>'; }).join('') + '</div>' : '<span></span>') +
        '<nav class="gs-tabs" aria-label="طريقة العرض">' + views.map(function (v) {
          var on = o.quran ? v[0] === 'quran' : u.view === v[0];
          return '<button type="button" class="' + (on ? 'on' : '') + '" data-gs-view="' + v[0] + '" data-ro-ok>' + gstIcon(v[2], 18) + v[1] + '</button>';
        }).join('') + '</nav></div>' +
        '<button type="button" class="gs-mf" data-gs-mf data-ro-ok>' + gstIcon('filter', 18) + ' البحث والمرشحات <span>' + (u.status ? 1 : 0) + '</span></button>' +
        '<div class="gs-filters' + (u.mf ? ' show' : '') + '"><div class="gs-chips"><span>الحالة:</span>' + chips + '</div>' +
        '<label class="gs-search">' + gstIcon('search', 19) + '<input id="gs-q" type="search" data-ro-ok value="' + esc(u.q) + '" placeholder="' + o.ph + '" aria-label="' + o.ph + '" autocomplete="off">' + (u.q ? '<button type="button" data-gs-clearq data-ro-ok aria-label="مسح البحث">' + gstIcon('close', 15) + '</button>' : '') + '</label></div></div>';
  }
  function gstNone(msg) {
    return '<div class="gs-empty"><span>' + gstIcon('search', 28) + '</span><h3>' + (msg || 'لا توجد نتائج مطابقة') + '</h3><p>جرّب تغيير عبارة البحث أو إلغاء بعض المرشحات.</p></div>';
  }
  function gstBars(items, per, total) {
    return items.map(function (x, i) {
      var c = per[i], st = c === 0 ? 'none' : c >= total ? 'full' : 'part';
      return '<div class="gs-dt"><div><b>' + esc(x.name) + '</b><span>' + c + ' / ' + total + '</span></div><div class="gs-pb"><i class="' + st + '" style="width:' + (total ? Math.round(c / total * 100) : 0) + '%"></i></div></div>';
    }).join('');
  }
  function gstDrawer(d) {
    var dr = GST.dr; if (!dr) return '';
    var head = '', meta = '', sum = '', body = '', note = '';
    var metaBox = function (k, v) { return '<div><span>' + k + '</span><b>' + v + '</b></div>'; };
    var summary = function (label, txt, pct, st) { return '<div class="gs-dsum"><span>' + label + '</span><strong>' + txt + '</strong><div class="gs-pb"><i class="' + st + '" style="width:' + pct + '%"></i></div></div>'; };
    if (dr.type === 'row') {
      var r = d.rows[dr.i]; if (!r) return '';
      var last = gstLastBy(), lt = r.tids.map(function (id) { return last[id] || ''; }).sort().pop();
      head = r.subject; meta = metaBox('الشعبة', esc(r.cls)) + metaBox('المعلم', esc(r.teachers.join('، ')) || '—') + metaBox('الحالة', gstBadge(r.status, r.pct)) + metaBox('عدد الطلاب', r.total);
      sum = summary('إجمالي الرصد', r.got + ' / ' + r.need, r.pct, r.status);
      body = '<h3>الاختبارات</h3>' + gstBars(d.items, r.per, r.total);
      note = lt ? 'آخر رصد لمعلم المادة ' + gstAgo(lt) + '.' : 'لم يُسجَّل رصد لمعلم المادة بعد.';
    } else if (dr.type === 'teacher') {
      var g = gstTeacherGroups(d.rows).filter(function (x) { return x.name === dr.name; })[0]; if (!g) return '';
      head = g.name; meta = metaBox('الشعب', Object.keys(g.cls).length) + metaBox('المواد', Object.keys(g.subs).length) + metaBox('مكتمل', g.t.full) + metaBox('غير مرصود', g.t.none);
      sum = summary('إنجاز المعلم', g.pct + '%', g.pct, g.t.full === g.rows.length ? 'full' : g.pct ? 'part' : 'none');
      body = '<h3>المواد والشعب</h3>' + g.rows.map(function (r) {
        return '<div class="gs-dt"><div><b>' + esc(r.subject) + ' — ' + esc(r.cls) + '</b>' + gstBadge(r.status, r.pct) + '</div><div class="gs-pb"><i class="' + r.status + '" style="width:' + r.pct + '%"></i></div></div>';
      }).join('');
      note = g.last ? 'آخر رصد ' + gstAgo(g.last) + '.' : 'لم يُسجَّل لهذا المعلم رصد بعد.';
    } else {
      var q = gstQuranRows().filter(function (x) { return x.t.id === dr.id; });
      if (!q.length) return '';
      var tt = q[0].t, tests = q.filter(function (x) { return !x.none; });
      var got = tests.reduce(function (a, x) { return a + x.got; }, 0), n = tests.reduce(function (a, x) { return a + x.n; }, 0), pc = n ? Math.round(got / n * 100) : 0;
      head = tt.name; meta = metaBox('الاختبارات المكلَّف بها', tests.length) + metaBox('المرصود', got + ' / ' + n);
      sum = summary('إنجاز المعلم', pc + '%', pc, !n || !got ? 'none' : got >= n ? 'full' : 'part');
      body = '<h3>الاختبارات</h3>' + (tests.length ? tests.map(function (x) {
        return '<div class="gs-dt"><div><b>' + esc(x.e.title || '') + '</b><span>' + x.got + ' / ' + x.n + '</span></div><div class="gs-pb"><i class="' + x.status + '" style="width:' + (x.n ? Math.round(x.got / x.n * 100) : 0) + '%"></i></div></div>';
      }).join('') : '<p class="gs-mute">لا اختبار مكلَّف به.</p>');
      var lu = tests.map(function (x) { return x.e.updated_at || ''; }).sort().pop();
      note = lu ? 'آخر تحديث لاختبارات المعلم ' + gstAgo(lu) + '.' : '';
    }
    return '<div class="gs-layer" data-gs-close role="presentation"><aside class="gs-drawer" role="dialog" aria-modal="true" aria-labelledby="gs-dt">' +
      '<div class="gs-dhead"><div><p class="gs-eye">تفاصيل الرصد</p><h2 id="gs-dt">' + esc(head) + '</h2></div><button type="button" class="gs-ib" data-gs-close data-ro-ok aria-label="إغلاق">' + gstIcon('close') + '</button></div>' +
      '<div class="gs-dmeta">' + meta + '</div>' + sum + '<div class="gs-dtests">' + body + '</div>' +
      (note ? '<div class="gs-dnote">' + gstIcon('alert', 18) + '<p><b>آخر نشاط</b><br>' + esc(note) + '</p></div>' : '') + '</aside></div>';
  }
  function renderGradeStatus() {
    if (!(isAdmin() || isManager())) return;
    var sk = '<div class="gs"><div class="gs-empty"><b>جارٍ تحميل بيانات الرصد…</b><div class="gs-skel"><i></i><i></i><i></i></div></div></div>';
    if (!GST.loaded) { app.innerHTML = sk; gstLoad(); return; }
    if (GST.error) { app.innerHTML = '<div class="gs"><div class="gs-empty"><span class="err">' + gstIcon('alert', 28) + '</span><h3>تعذّر تحميل البيانات</h3><p>' + esc(GST.error) + '</p><button type="button" class="gs-btn" data-gs-reload data-ro-ok>إعادة المحاولة</button></div></div>'; return; }
    var u = gstUi(), terms = []; GST.items.forEach(function (x) { if (terms.indexOf(x.term) < 0) terms.push(x.term); });
    if (!u.term || (u.term !== '*' && terms.indexOf(u.term) < 0)) u.term = terms[0] || '';
    if (u.view === 'quran') u.view = 'class';
    if (GST.dr && GST.dr.type === 'quran') GST.dr = null;
    var d = gstCompute(u.term), all = d.rows; GST.cur = d;
    var tally = gstTally(all), got = all.reduce(function (a, r) { return a + r.got; }, 0), need = all.reduce(function (a, r) { return a + r.need; }, 0);
    var top = gstTop({ tally: tally, pct: need ? Math.round(got / need * 100) : 0, unit: 'مادة', sub: 'راقب اكتمال درجات الطلاب وحدّد المتأخرين بسرعة.',
      note: 'مادة في شعبة، بحسب جدول الحصص واختبارات الفصل.', ph: 'ابحث باسم شعبة أو معلم أو مادة…',
      terms: terms.map(function (t) { return [t, t]; }).concat(terms.length > 1 ? [['*', 'الفصلان معًا']] : []) });
    if (!d.items.length) { app.innerHTML = '<div class="gs">' + top + '<div class="gs-empty"><span>' + gstIcon('book', 28) + '</span><h3>لم تُعدّ اختبارات لهذا الفصل بعد</h3><p>ستظهر الاختبارات هنا بعد إعدادها في «إعداد الدرجات».</p></div></div>'; return; }
    var body = '';
    if (u.view === 'detail') {
      var rows = all.filter(function (r) { return gstMatch(r, u); });
      body = rows.length ? '<section class="gs-card"><div class="gs-sh"><div><p class="gs-eye">السجل الكامل</p><h2>تفصيل الرصد</h2><p>' + rows.length + ' سجلًا مطابقًا للعرض الحالي</p></div>' +
        '<button type="button" class="gs-btn" data-gs-xlsx data-ro-ok>' + gstIcon('download', 18) + ' تصدير Excel</button></div><div class="gs-scroll"><table class="gs-tbl"><thead><tr><th>الشعبة</th><th>المادة</th><th>المعلم</th>' + d.items.map(function (x) { return '<th>' + esc(x.name) + '</th>'; }).join('') + '<th>الحالة</th></tr></thead><tbody>' +
        rows.slice(0, u.lim).map(function (r) {
          return '<tr><td><b>' + esc(r.cls) + '</b></td><td>' + esc(r.subject) + '</td><td>' + (esc(r.teachers.join('، ')) || '—') + '</td>' +
            r.per.map(function (c) { return '<td class="' + (c === 0 ? 'none' : c >= r.total ? 'full' : 'part') + '">' + c + ' / ' + r.total + '</td>'; }).join('') + '<td>' + gstBadge(r.status, r.pct) + '</td></tr>';
        }).join('') + '</tbody></table></div>' + (rows.length > u.lim ? '<div class="gs-more"><button type="button" class="gs-btn" data-gs-more data-ro-ok>عرض المزيد (' + (rows.length - u.lim) + ' متبقٍ)</button></div>' : '') +
        '<p class="gs-note">الأرقام: عدد الطلاب المرصودة درجاتهم من عدد طلاب الشعبة في كل اختبار.</p></section>' : gstNone();
    } else if (u.view === 'teacher') {
      var gr = gstTeacherGroups(all).filter(function (g) {
        var q = norm(u.q);
        return (!u.status || (u.status === 'full' ? g.t.full : u.status === 'part' ? g.t.part : g.t.none) > 0) && (!q || norm(g.name).indexOf(q) > -1);
      }).sort(function (a, b) { return a.pct - b.pct || a.name.localeCompare(b.name, 'ar'); });
      body = gr.length ? '<section><div class="gs-sh out"><div><p class="gs-eye">الأولوية للمتأخرين</p><h2>إنجاز المعلمين</h2><p>مرتّب من الأقل إنجازًا إلى الأعلى</p></div><span class="gs-count">' + gr.length + ' معلمين</span></div><div class="gs-cards">' +
        gr.map(function (g) {
          var seg = function (k, n) { return n ? '<i class="' + k + '" style="flex:' + n + '"></i>' : ''; };
          return '<article class="gs-tc"><div class="gs-tt"><span class="gs-av">' + esc(g.initials) + '</span><div><h3>' + esc(g.name) + '</h3><p>' + (g.last ? 'آخر رصد: ' + gstAgo(g.last) : 'لم يرصد بعد') + '</p></div><strong class="gs-pn">' + g.pct + '%</strong></div>' +
            '<div class="gs-sp" role="img" aria-label="نسبة إنجاز ' + g.pct + '%">' + seg('full', g.t.full) + seg('part', g.t.part) + seg('none', g.t.none) + '</div>' +
            '<div class="gs-ts"><span><b>' + Object.keys(g.cls).length + '</b> شعب</span><span><b>' + Object.keys(g.subs).length + '</b> مواد</span><span class="miss"><b>' + g.t.none + '</b> غير مرصودة</span></div>' +
            '<button type="button" class="gs-exp" data-gs-teacher="' + esc(g.name) + '" data-ro-ok>عرض المواد والشعب ' + gstIcon('chevron', 16) + '</button></article>';
        }).join('') + '</div></section>' : gstNone();
    } else {
      var subs = [], clsList = [], byKey = {};
      all.forEach(function (r, i) { if (subs.indexOf(r.subject) < 0) subs.push(r.subject); if (clsList.indexOf(r.cls) < 0) clsList.push(r.cls); byKey[r.cls + '\u0001' + r.subject] = i; });
      subs.sort(function (a, b) { return a.localeCompare(b, 'ar'); });
      var any = all.some(function (r) { return gstMatch(r, u); });
      body = !any ? gstNone() : '<section class="gs-card"><div class="gs-sh"><div><p class="gs-eye">نظرة شاملة</p><h2>الرصد حسب الشعبة والمادة</h2></div><div class="gs-legend">' +
        ['full', 'part', 'none'].map(function (k) { return '<span><i class="' + k + '"></i>' + GST_LABEL[k] + '</span>'; }).join('') + '</div></div>' +
        '<div class="gs-scroll"><div class="gs-heat" style="grid-template-columns:minmax(150px,1.2fr) repeat(' + clsList.length + ',minmax(104px,1fr))"><div class="gs-hc">المادة \\ الشعبة</div>' +
        clsList.map(function (c) { return '<div class="gs-hh">' + esc(c) + '</div>'; }).join('') +
        subs.map(function (s) {
          return '<div class="gs-sub"><strong>' + esc(s) + '</strong></div>' + clsList.map(function (c) {
            var i = byKey[c + '\u0001' + s]; if (i == null) return '<div class="gs-cell off">—</div>';
            var r = all[i], dim = !gstMatch(r, u);
            return '<button type="button" class="gs-cell ' + r.status + (dim ? ' dim' : '') + '" data-gs-cell="' + i + '" data-ro-ok><span class="gs-cs">' + GST_ICON[r.status] + '</span><strong>' + r.pct + '%</strong>' +
              '<span class="gs-tip"><b>' + esc(s) + ' — ' + esc(c) + '</b>' + d.items.map(function (it, k) { return '<span>' + esc(it.name) + ': ' + r.per[k] + '/' + r.total + '</span>'; }).join('') + '<span>المعلم: ' + (esc(r.teachers.join('، ')) || '—') + '</span><em>اضغط لعرض التفاصيل</em></span></button>';
          }).join('');
        }).join('') + '</div></div><p class="gs-note">' + gstIcon('alert', 16) + ' حرّك المؤشر فوق أي خلية للتفاصيل، أو اضغط لفتح سجل الاختبارات. النسبة: الدرجات المرصودة من المطلوبة في كل اختبارات الفصل. مادة القرآن الكريم لا تظهر هنا.</p></section>';
    }
    app.innerHTML = '<div class="gs">' + top + '<div class="gs-area">' + body + '</div></div>' + gstDrawer(d);
  }

  /* ---------- معلمو القرآن الكريم ----------
     لا تُقاس متابعتهم بدرجات مادة القرآن في «رصد الدرجات»، بل بالاختبارات التي كُلّفوا بها من شاشة «الاختبارات»:
     لكل معلم اختباراته، وعدد الطلاب المرصودة درجاتهم من عدد طلاب الاختبار. */
  function gstQuranRows() {
    var rows = [], rx = rxState();
    gstQuranTeachers().sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); }).forEach(function (t) {
      var ex = rx.list.filter(function (e) { return (e.teacher_ids || []).indexOf(t.id) > -1; });
      if (!ex.length) return rows.push({ t: t, none: true, status: 'none' });
      ex.forEach(function (e) {
        var ids = e.student_ids || [], got = ids.filter(function (id) { var g = (e.grades || {})[id]; return g != null && String(g).trim() !== ''; }).length;
        rows.push({ t: t, e: e, n: ids.length, got: got, status: got === 0 ? 'none' : got >= ids.length ? 'full' : 'part' });
      });
    });
    return rows;
  }
  function renderQuranStatus() {
    if (!(isAdmin() || isManager())) return;
    var rx = rxState();
    if (!GST.loaded) { app.innerHTML = '<div class="gs"><div class="gs-empty"><b>جارٍ تحميل بيانات الرصد…</b><div class="gs-skel"><i></i><i></i><i></i></div></div></div>'; gstLoad(); return; }
    if (!rx.loaded) { app.innerHTML = '<div class="gs"><div class="gs-empty"><b>جارٍ تحميل بيانات الرصد…</b><div class="gs-skel"><i></i><i></i><i></i></div></div></div>'; rxLoad(); return; }
    if (GST.error) { app.innerHTML = '<div class="gs"><div class="gs-empty"><span class="err">' + gstIcon('alert', 28) + '</span><h3>تعذّر تحميل البيانات</h3><p>' + esc(GST.error) + '</p><button type="button" class="gs-btn" data-gs-reload data-ro-ok>إعادة المحاولة</button></div></div>'; return; }
    if (GST.dr && GST.dr.type !== 'quran') GST.dr = null;
    var u = gstUi(), rows = gstQuranRows(), tests = rows.filter(function (r) { return !r.none; });
    var got = tests.reduce(function (a, r) { return a + r.got; }, 0), need = tests.reduce(function (a, r) { return a + r.n; }, 0);
    var top = gstTop({ quran: true, tally: gstTally(tests), pct: need ? Math.round(got / need * 100) : 0, unit: 'اختبار', sub: 'يُقاس الإنجاز بعدد الطلاب المرصودة درجاتهم في كل اختبار مكلَّف به المعلم.',
      note: 'اختبار مكلَّف به معلمو القرآن من شاشة «الاختبارات».', ph: 'ابحث باسم معلم أو اختبار…', terms: null });
    var q = norm(u.q), by = {};
    rows.forEach(function (r) { (by[r.t.id] || (by[r.t.id] = { t: r.t, list: [] })).list.push(r); });
    var cards = Object.keys(by).map(function (k) { return by[k]; }).filter(function (g) {
      if (u.status && !g.list.some(function (r) { return r.status === u.status && !r.none; })) return false;
      return !q || norm(g.t.name).indexOf(q) > -1 || g.list.some(function (r) { return r.e && norm(r.e.title).indexOf(q) > -1; });
    });
    var body = !rows.length ? '<div class="gs-empty"><span>' + gstIcon('book', 28) + '</span><h3>لا معلمين للقرآن الكريم</h3><p>لا يوجد معلمو قرآن في جدول الحصص أو بيانات المعلمين.</p></div>' : !cards.length ? gstNone() :
      '<section><div class="gs-banner"><div class="gs-bi">' + gstIcon('book', 24) + '</div><div><h2>متابعة اختبارات معلمي القرآن</h2><p>يُقاس الإنجاز بعدد الطلاب المرصودة درجاتهم في كل اختبار مكلَّف.</p></div></div><div class="gs-cards">' +
      cards.map(function (g) {
        var ts = g.list.filter(function (r) { return !r.none; });
        return '<article class="gs-tc"><div class="gs-tt"><span class="gs-av gold">' + esc(g.t.name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0); }).join('')) + '</span><div><h3>' + esc(g.t.name) + '</h3><p>' + (ts.length ? ts.length + ' اختبارات مكلَّف بها' : 'لا توجد تكليفات حالية') + '</p></div></div>' +
          (ts.length ? '<div class="gs-tl">' + ts.map(function (r) {
            return '<div class="gs-ti"><div class="gs-tline"><b>' + esc(r.e.title || '') + '</b>' + gstBadge(r.status, r.n ? Math.round(r.got / r.n * 100) : 0) + '</div><div class="gs-pb"><i class="' + r.status + '" style="width:' + (r.n ? Math.round(r.got / r.n * 100) : 0) + '%"></i></div><div class="gs-tcnt"><span>المرصود / الطلاب</span><strong>' + r.got + ' / ' + r.n + '</strong></div></div>';
          }).join('') + '</div>' : '<div class="gs-noas"><span>—</span><b>لا اختبار مكلَّف به</b><p>سيظهر الاختبار هنا عند إسناده للمعلم.</p></div>') +
          '<button type="button" class="gs-exp" data-gs-qteacher="' + g.t.id + '" data-ro-ok' + (ts.length ? '' : ' disabled') + '>عرض تفاصيل المعلم ' + gstIcon('chevron', 16) + '</button></article>';
      }).join('') + '</div></section>';
    app.innerHTML = '<div class="gs">' + top + '<div class="gs-area">' + body + '</div></div>' + gstDrawer(null);
  }

  async function gstXlsx() {
    try {
      await loadXlsx();
      var u = gstUi(), d = gstCompute(u.term), rows = d.rows.filter(function (r) { return gstMatch(r, u); }), wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      var ws = XLSX.utils.aoa_to_sheet([[schoolName() + ' — متابعة الرصد'], [u.term === '*' ? 'الفصلان معًا' : u.term], [], ['الشعبة', 'المادة', 'المعلم'].concat(d.items.map(function (x) { return x.name; }), ['الحالة', 'نسبة الإنجاز'])]
        .concat(rows.map(function (r) { return [r.cls, r.subject, r.teachers.join('، ')].concat(r.per.map(function (c) { return c + ' / ' + r.total; }), [GST_LABEL[r.status], r.pct + '%']); })));
      ws['!cols'] = [14, 20, 24].concat(d.items.map(function () { return 14; }), [12, 12]).map(function (w) { return { wch: w }; });
      XLSX.utils.book_append_sheet(wb, ws, 'متابعة الرصد');
      XLSX.writeFile(wb, 'متابعة-الرصد-' + todayISO() + '.xlsx');
    } catch (err) { toast(err.message || String(err), true); }
  }
  function gstOn() { return location.hash === '#/gradestatus' || location.hash === '#/quranstatus'; }
  document.addEventListener('click', function (e) {
    if (!gstOn() || !e.target.closest) return;
    var u = gstUi(), el;
    if ((el = e.target.closest('[data-gs-close]'))) {
      // الخلفية تغلق، والضغط داخل اللوحة لا يغلق إلا بزرها
      if (el.classList.contains('gs-layer') && e.target !== el) return;
      GST.dr = null; return render();
    }
    if (e.target.closest('[data-gs-reload]')) { GST.loaded = false; GST.dr = null; rxState().loaded = false; return render(); }
    if ((el = e.target.closest('[data-gs-term]'))) { u.term = el.getAttribute('data-gs-term'); return render(); }
    if ((el = e.target.closest('[data-gs-view]'))) {
      var v = el.getAttribute('data-gs-view'); GST.dr = null; u.lim = 60;
      if (v === 'quran') return go('#/quranstatus');
      u.view = v;
      return location.hash === '#/gradestatus' ? render() : go('#/gradestatus');
    }
    if ((el = e.target.closest('[data-gs-status]'))) { var s = el.getAttribute('data-gs-status'); u.status = u.status === s ? '' : s; u.lim = 60; return render(); }
    if (e.target.closest('[data-gs-mf]')) { u.mf = !u.mf; return render(); }
    if (e.target.closest('[data-gs-clearq]')) { u.q = ''; return render(); }
    if (e.target.closest('[data-gs-more]')) { u.lim += 60; return render(); }
    if (e.target.closest('[data-gs-xlsx]')) return gstXlsx();
    if ((el = e.target.closest('[data-gs-cell]'))) { GST.dr = { type: 'row', i: Number(el.getAttribute('data-gs-cell')) }; return render(); }
    if ((el = e.target.closest('[data-gs-teacher]'))) { GST.dr = { type: 'teacher', name: el.getAttribute('data-gs-teacher') }; return render(); }
    if ((el = e.target.closest('[data-gs-qteacher]'))) { GST.dr = { type: 'quran', id: el.getAttribute('data-gs-qteacher') }; return render(); }
  });
  document.addEventListener('input', function (e) {
    if (!gstOn() || e.target.id !== 'gs-q') return;
    var u = gstUi(), pos = e.target.selectionStart;
    u.q = e.target.value; u.lim = 60; render();
    var q = document.getElementById('gs-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} }
  });
  document.addEventListener('keydown', function (e) {
    if (gstOn() && e.key === 'Escape' && GST.dr) { GST.dr = null; render(); }
  });
