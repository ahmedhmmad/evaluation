'use strict';
  /* ---------- الأوائل (الإدارة) ----------
     أوائل كل شعبة وكل مرحلة (سابع أ وسابع ب = مرحلة «سابع») من الدرجات التي رصدها المعلمون.
     نسبة الطالب في المادة = مجموع درجاته ÷ مجموع درجات الاختبارات التي أُجريت في مادته وشعبته (رُصدت فيها درجة لأحد الطلاب)؛ وكل درجة غير مرصودة لطالب تُحسب صفرًا (الغياب مثلًا).
     المعدل = متوسط نسب مواد الشعبة المحسوبة، فيتساوى الطلاب في عدد المواد.
     يُستبعد من المعدل ما تختاره الإدارة من المواد */
  var TOPS = { loaded: false, busy: false, items: [], grades: [], error: '' };
  // الخيارات الثابتة: الاسم الظاهر ونمط يطابق اسم المادة كما رُصدت (لا يطابق «الرياضيات»)
  var TOPS_FIXED = [['فن', /(^|\s)(ال)?(فن|فنون|فنية)/], ['رياضة', /(رياضة|بدنية)/], ['قرآن كريم', /(قرآن|قران)/]];
  function topsMatch(subjects, re) { return subjects.filter(function (s) { return re.test(s); }); }
  function topsRest(subjects, ex) { return subjects.filter(function (s) { return ex.indexOf(s) < 0 && !TOPS_FIXED.some(function (f) { return f[1].test(s); }); }); }
  function topsUi() { return ui.tops || (ui.tops = { term: '', view: 'class', n: 3, ex: topsLoadEx() }); }
  function topsLoadEx() { try { return JSON.parse(localStorage.getItem('tops_ex') || '[]') || []; } catch (e) { return []; } }
  function topsSaveEx(a) { try { localStorage.setItem('tops_ex', JSON.stringify(a)); } catch (e) { /* التخزين غير متاح */ } }
  function topsLevel(cls) { return String(cls || '').replace(/\s*[(（][^)）]*[)）]\s*$/, '').replace(/\s+[أ-ي]$/, '').trim() || String(cls || ''); }
  async function topsLoad() {
    if (TOPS.busy) return; TOPS.busy = true;
    var it = await sb.from('grade_items').select('id, term, name, max_score').order('term');
    var g = it.error ? null : await fetchAll(function () { return sb.from('grades').select('student_id, item_id, subject, score').not('score', 'is', null); });
    TOPS.busy = false;
    if (it.error || g == null) { TOPS.error = (it.error && it.error.message) || 'تعذّر جلب الدرجات'; }
    else { TOPS.items = it.data || []; TOPS.grades = g; TOPS.error = ''; }
    TOPS.loaded = true; render();
  }
  // يحسب معدلات الطلاب للفصل المختار ('*' = الفصلان) دون المواد المستبعدة
  function topsCompute(term, ex) {
    var item = {}; TOPS.items.forEach(function (x) { if (term === '*' || x.term === term) item[x.id] = Number(x.max_score); });
    var cls = {}, enr = S.students.filter(enrolled); enr.forEach(function (x) { cls[x.id] = x.class_name || ''; });
    // الاختبار «أُجري» لمادة في شعبة إن رُصدت فيه درجة لأحد طلابها؛ وكل طالب في تلك الشعبة لا درجة له فيه تُحسب له صفرًا
    var held = {}, score = {}, subjects = {};
    TOPS.grades.forEach(function (g) {
      var mx = item[g.item_id]; if (!mx) return;
      var s = String(g.subject || '').trim(), c = cls[g.student_id]; if (!s) return;
      subjects[s] = (subjects[s] || 0) + 1;
      if (ex.indexOf(s) > -1 || c == null) return;
      var h = held[c] || (held[c] = {}), hs = h[s] || (h[s] = {}); hs[g.item_id] = mx;
      score[g.student_id + '|' + s + '|' + g.item_id] = Number(g.score);
    });
    var rows = [];
    enr.forEach(function (x) {
      var h = held[x.class_name || '']; if (!h) return;
      var subs = Object.keys(h), pcts = subs.map(function (s) {
        var sum = 0, max = 0; Object.keys(h[s]).forEach(function (id) { max += h[s][id]; sum += score[x.id + '|' + s + '|' + id] || 0; });
        return max > 0 ? sum / max * 100 : null;
      }).filter(function (v) { return v != null; });
      if (!pcts.length) return;
      var avg = pcts.reduce(function (a, v) { return a + v; }, 0) / pcts.length;
      rows.push({ id: x.id, name: x.full_name, cls: x.class_name || '', level: topsLevel(x.class_name), avg: Math.round(avg * 100) / 100, n: pcts.length });
    });
    return { rows: rows, subjects: Object.keys(subjects).sort(function (a, b) { return a.localeCompare(b, 'ar'); }) };
  }
  // الترتيب بالمعدل؛ المتساوون في المعدل لهم الترتيب نفسه، ويدخل كل من ساوى آخر المطلوبين
  function topsRank(rows, n) {
    var s = rows.slice().sort(function (a, b) { return b.avg - a.avg || a.name.localeCompare(b.name, 'ar'); }), out = [], rank = 0, last = null;
    s.forEach(function (r, i) { if (r.avg !== last) { rank = i + 1; last = r.avg; } r.rank = rank; if (rank <= n) out.push(r); });
    return out;
  }
  function topsGroups(rows, key) {
    var m = {}; rows.forEach(function (r) { (m[r[key]] || (m[r[key]] = [])).push(r); });
    return Object.keys(m).sort(function (a, b) { return gradeOf(a) - gradeOf(b) || a.localeCompare(b, 'ar', { numeric: true }); }).map(function (k) { return { name: k, rows: m[k] }; });
  }
  function topsData(forceView) {
    var u = topsUi(), terms = []; TOPS.items.forEach(function (x) { if (terms.indexOf(x.term) < 0) terms.push(x.term); });
    if (!u.term || (u.term !== '*' && terms.indexOf(u.term) < 0)) u.term = terms[0] || '';
    var c = topsCompute(u.term, u.ex), groups = topsGroups(c.rows, (forceView || u.view) === 'level' ? 'level' : 'cls');
    return { u: u, terms: terms, subjects: c.subjects, groups: groups.map(function (g) { return { name: g.name, total: g.rows.length, top: topsRank(g.rows, u.n) }; }) };
  }
  function renderToppers() {
    if (!(isAdmin() || isManager())) return;
    if (!TOPS.loaded) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; topsLoad(); return; }
    if (TOPS.error) { app.innerHTML = '<div class="card empty">' + esc(TOPS.error) + '</div>'; return; }
    var d = topsData(), u = d.u, lvl = u.view === 'level';
    var head = '<div class="page-head"><div><h1>الأوائل</h1><p>أوائل كل شعبة أو كل مرحلة بحسب معدل الدرجات التي رصدها المعلمون. المعدل = متوسط نسب مواد الطالب، ويمكنك استبعاد مواد من الحساب.</p></div></div>';
    var bar = '<div class="card"><div class="toolbar" style="align-items:center;margin:0">' +
      '<label class="field" for="tops-term" style="margin:0">الفصل</label><select id="tops-term" data-ro-ok style="width:auto">' + d.terms.map(function (t) { return '<option value="' + esc(t) + '"' + (t === u.term ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + (d.terms.length > 1 ? '<option value="*"' + (u.term === '*' ? ' selected' : '') + '>الفصلان معًا</option>' : '') + '</select>' +
      '<label class="field" for="tops-view" style="margin:0">العرض</label><select id="tops-view" data-ro-ok style="width:auto"><option value="class"' + (lvl ? '' : ' selected') + '>أوائل الشعب</option><option value="level"' + (lvl ? ' selected' : '') + '>أوائل المراحل (كل صف بشعبه: السابع والثامن والتاسع…)</option></select>' +
      '<label class="field" for="tops-n" style="margin:0">عدد الأوائل</label><select id="tops-n" data-ro-ok style="width:auto">' + [1, 3, 5, 10].map(function (n) { return '<option' + (n === u.n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>' +
      '<span style="flex:1"></span><select id="tops-one" data-ro-ok style="width:auto"><option value="">طباعة مرحلة واحدة…</option>' + topsData('level').groups.map(function (g) { return '<option>' + esc(g.name) + '</option>'; }).join('') + '</select><button type="button" class="btn" data-tops-print data-ro-ok' + (d.groups.length ? '' : ' disabled') + '>طباعة</button><button type="button" class="btn" data-tops-xlsx data-ro-ok' + (d.groups.length ? '' : ' disabled') + '>تصدير Excel</button><button type="button" class="btn" data-tops-reload data-ro-ok>تحديث الدرجات</button></div>' +
      '<details style="margin-top:10px"><summary><b>استبعاد مواد من المعدل</b></summary>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:8px">' + TOPS_FIXED.map(function (f) { var m = topsMatch(d.subjects, f[1]); return '<label style="display:flex;gap:5px;align-items:center;cursor:pointer"><input type="checkbox" data-tops-fix="x|' + esc(f[0]) + '"' + (m.length && m.every(function (s) { return u.ex.indexOf(s) > -1; }) ? ' checked' : '') + (m.length ? '' : ' disabled') + '> ' + esc(f[0]) + '</label>'; }).join('') + '</div>' +
      '<div class="toolbar" style="align-items:center;margin:8px 0 0"><select id="tops-add" data-ro-ok style="width:auto"><option value="">مادة أخرى…</option>' + topsRest(d.subjects, u.ex).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</select>' +
      u.ex.filter(function (s) { return !TOPS_FIXED.some(function (f) { return f[1].test(s); }); }).map(function (s) { return '<span class="chip" style="display:inline-flex;gap:6px;align-items:center;border:1px solid #C8A45D;border-radius:999px;padding:2px 10px">' + esc(s) + ' <a href="#" data-tops-del="' + esc(s) + '" title="إزالة">×</a></span>'; }).join('') +
      '<span style="flex:1"></span><button type="button" class="btn" data-tops-none data-ro-ok>إلغاء الاستبعاد</button></div></details></div>';
    var body = d.groups.length ? d.groups.map(function (g) {
      return '<div class="card"><h2 style="margin-top:0">' + esc(g.name) + ' <span class="meta">(' + g.total + ' طالبًا لهم درجات)</span></h2><div class="table-wrap"><table class="grid"><thead><tr><th style="width:4em">الترتيب</th><th>الطالب</th>' + (lvl ? '<th>الشعبة</th>' : '') + '<th>المعدل</th><th>عدد المواد</th></tr></thead><tbody>' +
        g.top.map(function (r) { var medal = r.rank <= 3 ? ' style="font-weight:800;color:' + (r.rank === 1 ? '#C8A45D' : '#13306B') + '"' : ''; return '<tr><td' + medal + '>' + r.rank + '</td><td><b>' + esc(r.name) + '</b></td>' + (lvl ? '<td>' + esc(r.cls) + '</td>' : '') + '<td><b>' + r.avg.toFixed(2) + '%</b></td><td>' + r.n + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    }).join('') : '<div class="card empty">لا درجات مرصودة في هذا الفصل بعد.</div>';
    app.innerHTML = head + bar + body;
  }
  // كشف الأوائل المطبوع بترويسة الأكاديمية: عنوان لكل شعبة أو مرحلة ثم أوائلها، وتحته توقيعا المشرف التربوي والمدير
  var pendingTops = false;
  function buildToppersSheet() {
    var one = typeof pendingTops === 'string' ? pendingTops : '', d = topsData(one ? 'level' : null), lvl = one || d.u.view === 'level', n = lvl ? 4 : 3, rows = '';
    if (one) d.groups = d.groups.filter(function (g) { return g.name === one; });
    d.groups.forEach(function (g) {
      rows += '<tr><td class="c" colspan="' + n + '" style="background:#13306B;color:#fff;font-weight:800;font-size:1.1em">' + esc(g.name) + '</td></tr>';
      g.top.forEach(function (r) {
        rows += '<tr><td class="c"><b>' + r.rank + '</b></td><td><b>' + esc(r.name) + '</b></td>' + (lvl ? '<td class="c">' + esc(r.cls) + '</td>' : '') + '<td class="c"><b>' + r.avg.toFixed(2) + '%</b></td></tr>';
      });
    });
    var info = [[one ? 'المرحلة' : 'العرض', one || (lvl ? 'أوائل المراحل' : 'أوائل الشعب')], ['عدد الأوائل', d.u.n]];
    var head = reportHead('كشف الأوائل — ' + (d.u.term === '*' ? 'الفصلان' : d.u.term), info).replace(/^<img class="wm"[^>]*>/, '');
    printLandscape = false;
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
      '<table class="rz"><colgroup><col style="width:9%"><col style="width:' + (lvl ? 50 : 66) + '%">' + (lvl ? '<col style="width:23%">' : '') + '<col style="width:' + (lvl ? 18 : 25) + '%"></colgroup>' +
      '<thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>' +
      '<tr><th>الترتيب</th><th>الطالب</th>' + (lvl ? '<th>الشعبة</th>' : '') + '<th>المعدل</th></tr></thead><tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>' + reportSigns([['توقيع المشرف التربوي', supervisorName()], ['توقيع المدير', principalName()]]);
  }
  async function topsXlsx() {
    try {
      await loadXlsx();
      var d = topsData(), lvl = d.u.view === 'level', aoa = [[schoolName() + ' — أوائل ' + (lvl ? 'المراحل' : 'الشعب') + ' — ' + (d.u.term === '*' ? 'الفصلان' : d.u.term)]];
      aoa.push([]);
      d.groups.forEach(function (g) {
        aoa.push([g.name]); aoa.push(['الترتيب', 'الطالب', 'الشعبة', 'المعدل %', 'عدد المواد']);
        g.top.forEach(function (r) { aoa.push([r.rank, r.name, r.cls, r.avg, r.n]); });
        aoa.push([]);
      });
      var wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'الأوائل');
      XLSX.writeFile(wb, 'الأوائل-' + (lvl ? 'المراحل' : 'الشعب') + '-' + todayISO() + '.xlsx');
    } catch (err) { toast(err.message || String(err), true); }
  }
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/toppers') return;
    var u = topsUi(), t = e.target, s = t.getAttribute && t.getAttribute('data-tops-ex');
    if (t.id === 'tops-one') { var lv = t.value; t.value = ''; if (lv) { pendingTops = lv; printNow(); } return; }
    if (t.id === 'tops-term') u.term = t.value;
    else if (t.id === 'tops-view') u.view = t.value;
    else if (t.id === 'tops-n') u.n = Number(t.value) || 3;
    else if (t.id === 'tops-add') { if (!t.value) return; if (u.ex.indexOf(t.value) < 0) u.ex.push(t.value); topsSaveEx(u.ex); }
    else if (t.getAttribute && t.getAttribute('data-tops-fix')) {
      var f = TOPS_FIXED.filter(function (x) { return x[0] === t.getAttribute('data-tops-fix').split('|')[1]; })[0], m = topsMatch(topsData().subjects, f[1]);
      u.ex = u.ex.filter(function (x) { return m.indexOf(x) < 0; }); if (t.checked) u.ex = u.ex.concat(m); topsSaveEx(u.ex);
    }
    else if (s != null) { u.ex = u.ex.filter(function (x) { return x !== s; }); if (t.checked) u.ex.push(s); topsSaveEx(u.ex); }
    else return;
    render();
  });
  document.addEventListener('click', function (e) {
    if (location.hash !== '#/toppers') return;
    var u = topsUi();
    if (e.target.closest('[data-tops-print]')) { pendingTops = true; return printNow(); }
    if (e.target.closest('[data-tops-xlsx]')) return topsXlsx();
    if (e.target.closest('[data-tops-reload]')) { TOPS.loaded = false; return render(); }
    var del = e.target.closest('[data-tops-del]');
    if (del) { e.preventDefault(); u.ex = u.ex.filter(function (x) { return x !== del.getAttribute('data-tops-del'); }); topsSaveEx(u.ex); return render(); }
    if (e.target.closest('[data-tops-none]')) { u.ex = []; topsSaveEx(u.ex); return render(); }
  });
