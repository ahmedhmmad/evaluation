'use strict';
  /* ---------- الاختبارات ----------
     شاشة مستقلة تصلح لأي اختبار (دورة القراءة العربية وغيرها): لكل اختبار عنوان وتاريخ ومادة، ويُختار له طلاب من أي صف،
     ويُطبع كشفه: م، الطالب، الصف، تاريخ الميلاد، المدرس (من جدول الحصص: معلم المادة في صف الطالب)، الدرجة،
     ثم توقيعات أعضاء اللجنة ومدير الأكاديمية. بعد التشكيل تُدخل الدرجة لكل طالب وتُحفظ (supabase/student_exams.sql). يراها من يرى الحضور */
  var RX_DEFAULT = 'اختبار دورة القراءة العربية';
  function rxHead(t) { return 'كشف ' + t + ' - مركز الركيزة الثالثة'; }
  function rxTeachHead(t) { return /دورة/.test(t || '') ? 'مدرس الدورة' : 'مدرس المادة'; }
  var pendingRx = null;
  // شرائح التقدير: كل شريحة من درجة إلى درجة (شاملتين) بتقديرها؛ تُعدَّل لكل اختبار
  var RX_BANDS = [{ from: 90, to: 100, label: 'ممتاز' }, { from: 80, to: 89.99, label: 'جيد جدًا' }, { from: 70, to: 79.99, label: 'جيد' }, { from: 60, to: 69.99, label: 'مقبول' }, { from: 0, to: 59.99, label: 'ضعيف' }];
  function rxNum(v) { var n = parseFloat(latinDigits(String(v == null ? '' : v)).replace(/[^\d.]/g, '')); return isNaN(n) ? null : n; }
  // التقدير: الشريحة التي تقع فيها الدرجة (إن وقعت في شريحتين فالأعلى بدايةً)
  function rxRating(bands, g) {
    var n = rxNum(g), hit = null;
    if (n == null) return '';
    (bands || []).forEach(function (b) {
      var f = rxNum(b.from), t = rxNum(b.to);
      if (f != null && t != null && n >= f && n <= t && (!hit || f > hit.f)) hit = { f: f, l: b.label };
    });
    return hit ? hit.l : '';
  }
  function rxState() { return S.rx || (S.rx = { list: [], loaded: false, loading: false, missing: false, open: '', draft: null, dirty: false, cls: '', q: '', show: '' }); }
  function rxCanEdit() { return isAdmin() || isRegistrar(); }
  async function rxLoad() {
    var c = rxState();
    if (c.loading) return;
    c.loading = true;
    var rows = await fetchAll(function () { return sb.from('student_exams').select('*').order('exam_date', { ascending: false }).order('created_at', { ascending: false }); });
    c.loading = false; c.loaded = true; c.missing = !rows; c.list = rows || [];
    render();
  }
  function rxCur() { var c = rxState(); return c.list.filter(function (x) { return x.id === c.open; })[0]; }
  // نسخة العمل: ما يُعدَّل قبل الحفظ
  function rxD() {
    var c = rxState(), E = rxCur();
    if (!c.draft && E) {
      c.draft = { title: E.title || RX_DEFAULT, bands: (E.bands && E.bands.length ? E.bands : RX_BANDS).map(function (b) { return { from: b.from, to: b.to, label: b.label }; }), places: {}, exam_date: String(E.exam_date).slice(0, 10), subject: E.subject || '', committee: (E.committee || []).join('\n'), sel: {}, grades: Object.assign({}, E.grades || {}) };
      (E.student_ids || []).forEach(function (id) { c.draft.sel[id] = true; });
    }
    return c.draft;
  }
  // مواد جدول الحصص؛ الافتراضية أول مادة فيها «قراءة»
  function rxSubjects() {
    var m = {};
    ttLive().forEach(function (s) { var n = ttFixSubject(s.subject); if (n) m[n] = 1; });
    return Object.keys(m).sort(function (a, b) { return a.localeCompare(b, 'ar'); });
  }
  function rxDefaultSubject() { var l = rxSubjects(); return l.filter(function (n) { return /قراء/.test(n); })[0] || l.filter(function (n) { return /عرب/.test(n); })[0] || ''; }
  // مدرس الدورة: معلم المادة في صف الطالب من جدول الحصص (الأول والأخير من اسمه)
  function rxTeacher(x, subject) {
    if (!subject) return '';
    var seen = {}, names = [];
    ttLive().forEach(function (s) {
      if (s.class_name !== x.class_name || !s.teacher_id || ttFixSubject(s.subject) !== subject || seen[s.teacher_id]) return;
      seen[s.teacher_id] = 1;
      var t = find(s.teacher_id);
      if (t) names.push(ttName(t));
    });
    return names.join('، ');
  }
  function rxShown() {
    var c = rxState(), d = rxD(), q = norm(c.q);
    return slStudents().filter(function (x) {
      if (c.cls && (x.class_name || '') !== c.cls) return false;
      if (c.show === 'yes' && !d.sel[x.id]) return false;
      if (c.show === 'no' && d.sel[x.id]) return false;
      return !q || norm(x.full_name).indexOf(q) > -1;
    });
  }
  function rxPlace(x, d) { return d.places[x.id] != null ? d.places[x.id] : (x.details && x.details.birth_place) || ''; }
  function rxBandsHtml(d, dis) {
    return '<div style="margin-top:10px"><label class="field">شرائح التقدير (من درجة إلى درجة، شاملتان)</label>' + d.bands.map(function (b, i) {
      return '<div class="toolbar" style="align-items:center;margin:0 0 6px"><span>من</span><input type="text" inputmode="decimal" data-rxband="' + i + '|from" value="' + esc(b.from) + '"' + dis + ' style="width:5em" aria-label="من"><span>إلى</span><input type="text" inputmode="decimal" data-rxband="' + i + '|to" value="' + esc(b.to) + '"' + dis + ' style="width:5em" aria-label="إلى"><span>التقدير</span><input type="text" data-rxband="' + i + '|label" value="' + esc(b.label) + '"' + dis + ' style="width:9em" aria-label="التقدير">' + (dis ? '' : '<button type="button" class="btn" data-rxbanddel="' + i + '">حذف</button>') + '</div>';
    }).join('') + (dis ? '' : '<button type="button" class="btn" data-rxbandadd>إضافة شريحة</button>') + '</div>';
  }
  function rxPicked() { var d = rxD(); return slStudents().filter(function (x) { return d.sel[x.id]; }); }
  function rxNames(d) { return String(d.committee || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean); }
  function rxRefreshRates() {
    var d = rxD();
    Array.prototype.forEach.call(document.querySelectorAll('[data-rxrate]'), function (td) { td.innerHTML = '<b>' + esc(rxRating(d.bands, d.grades[td.getAttribute('data-rxrate')])) + '</b>'; });
  }
  function rxMarkDirty() {
    var c = rxState();
    if (c.dirty) return;
    c.dirty = true;
    var b = document.querySelector('[data-rxsave]');
    if (b) { b.disabled = false; b.textContent = 'حفظ التغييرات'; }
  }

  function renderExams() {
    app.innerHTML = '<h1 class="page-title" style="margin:0 0 12px">الاختبارات</h1>' + rxScreen();
  }

  function rxScreen() {
    var c = rxState(), edit = rxCanEdit();
    if (!c.loaded) { rxLoad(); return '<div class="card empty">جارٍ التحميل…</div>'; }
    if (c.missing) return '<div class="card empty">الاختبارات تحتاج جدولًا جديدًا.<br>شغّل الملف <code dir="ltr">supabase/student_exams.sql</code> في محرر SQL، ثم حدّث الصفحة.</div>';
    var back = '';
    var E = rxCur();
    if (!E) {
      return back + '<div class="card"><h2 style="margin-top:0">اختبارات دورة القراءة العربية</h2><p class="hint" style="margin:0">اختر الطلاب من أي صف وشكّل الاختبار، ثم اطبع الكشف (الطالب، الصف، تاريخ الميلاد، مدرس الدورة، الدرجة) بتوقيعات اللجنة والمدير، وأدخل الدرجات بعد الاختبار.</p>' +
        (edit ? '<div class="toolbar" style="margin-top:10px"><button type="button" class="btn primary" data-rxnew>اختبار جديد</button></div>' : '') +
        (c.list.length ? '<div class="table-wrap" style="margin-top:10px"><table class="grid"><thead><tr><th>الاختبار</th><th>التاريخ</th><th>الطلاب</th><th>الدرجات المدخلة</th><th></th></tr></thead><tbody>' +
          c.list.map(function (x) {
            return '<tr><td><b>' + esc(x.title || RX_DEFAULT) + '</b></td><td>' + dmy(x.exam_date) + '</td><td>' + (x.student_ids || []).length + '</td><td>' + Object.keys(x.grades || {}).filter(function (k) { return String(x.grades[k]).trim() !== ''; }).length + '</td>' +
              '<td style="white-space:nowrap"><button type="button" class="btn primary" data-rxopen="' + x.id + '">فتح</button>' + (edit ? ' <button type="button" class="btn danger" data-rxdel="' + x.id + '">حذف</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">لا توجد اختبارات بعد.</div>') + '</div>';
    }
    var d = rxD(), subjects = rxSubjects(), picked = rxPicked(), shown = rxShown();
    var opt = function (v, t, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(t) + '</option>'; };
    var dis = edit ? '' : ' disabled';
    var formed = picked.length ? '<div class="card"><h2 style="margin-top:0">الاختبار المُشكَّل (' + picked.length + ' طالبًا)</h2><div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>اسم الطالب</th><th>مكان الميلاد</th><th>الصف</th><th>تاريخ الميلاد</th><th>' + rxTeachHead(d.title) + '</th><th style="width:7em">الدرجة</th><th>التقدير</th></tr></thead><tbody>' +
      picked.map(function (x, i) {
        return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(x.full_name) + '</b></td><td><input type="text" data-rxplace="' + x.id + '" value="' + esc(rxPlace(x, d)) + '" aria-label="مكان ميلاد ' + esc(x.full_name) + '"' + dis + ' style="width:9em"></td><td>' + esc(x.class_name || '—') + '</td><td>' + dmy(x.birth_date) + '</td><td>' + esc(rxTeacher(x, d.subject) || '—') + '</td>' +
          '<td><input type="text" inputmode="decimal" data-rxgrade="' + x.id + '" value="' + esc(d.grades[x.id] == null ? '' : d.grades[x.id]) + '" aria-label="درجة ' + esc(x.full_name) + '"' + dis + ' style="width:6em"></td><td class="rx-rate" data-rxrate="' + x.id + '"><b>' + esc(rxRating(d.bands, d.grades[x.id])) + '</b></td></tr>';
      }).join('') + '</tbody></table></div></div>' : '';
    return back + '<div class="card"><div class="toolbar" style="align-items:center;margin:0"><h2 style="margin:0;flex:1">' + esc(d.title) + ' — ' + dmy(d.exam_date) + '</h2>' +
        (edit ? '<button type="button" class="btn primary" data-rxsave' + (c.dirty ? '' : ' disabled') + '>' + (c.dirty ? 'حفظ التغييرات' : 'محفوظ') + '</button>' : '') +
        '<button type="button" class="btn" data-rxprint data-ro-ok>طباعة الكشف / PDF</button><button type="button" class="btn" data-rxclose>كل الاختبارات</button></div>' +
      '<div style="margin-top:10px"><label class="field" for="rx-title">عنوان الاختبار</label><input type="text" id="rx-title" value="' + esc(d.title) + '"' + dis + '></div>' +
      '<div class="grid2" style="margin-top:10px"><div><label class="field" for="rx-date">تاريخ الاختبار</label><input type="date" id="rx-date" value="' + esc(d.exam_date) + '"' + dis + '></div>' +
        '<div><label class="field" for="rx-subj">مادة الاختبار في جدول الحصص (منها يُعرف مدرس كل طالب)</label><select id="rx-subj"' + dis + '>' + opt('', '— بلا مدرس —', d.subject) + subjects.map(function (n) { return opt(n, n, d.subject); }).join('') + '</select></div></div>' +
      '<div style="margin-top:10px"><label class="field" for="rx-com">أعضاء لجنة الاختبار (اسم في كل سطر)</label><textarea id="rx-com" rows="3" placeholder="يُترك فارغًا لتبقى خانات التوقيع بلا أسماء"' + dis + '>' + esc(d.committee) + '</textarea></div>' + rxBandsHtml(d, dis) + '</div>' +
      '<div class="card"><h2 style="margin-top:0">اختيار الطلاب (' + picked.length + ' مختارًا)</h2><div class="toolbar" style="align-items:center;margin:0">' +
        '<input type="search" id="rx-q" placeholder="ابحث بالاسم" style="flex:1;min-width:200px" value="' + esc(c.q) + '">' +
        '<select id="rx-cls" style="width:auto">' + opt('', 'كل الصفوف', c.cls) + attClasses().map(function (n) { return opt(n, n, c.cls); }).join('') + '</select>' +
        '<select id="rx-show" style="width:auto">' + opt('', 'الكل', c.show) + opt('yes', 'المختارون فقط', c.show) + opt('no', 'غير المختارين فقط', c.show) + '</select>' +
        (edit ? '<button type="button" class="btn" data-rxall="1">تحديد الظاهرين</button><button type="button" class="btn" data-rxall="0">إلغاء تحديد الظاهرين</button>' : '') + '</div>' +
      (shown.length ? '<div class="table-wrap" style="margin-top:8px;max-height:420px;overflow:auto"><table class="grid"><thead><tr><th style="width:3em">✓</th><th>م</th><th>الطالب</th><th>الصف</th></tr></thead><tbody>' +
        shown.map(function (x, i) {
          return '<tr><td><input type="checkbox" data-rxpick="' + x.id + '"' + (d.sel[x.id] ? ' checked' : '') + dis + ' aria-label="' + esc(x.full_name) + '"></td><td>' + (i + 1) + '</td><td><b>' + esc(x.full_name) + '</b></td><td>' + esc(x.class_name || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">لا طلاب مطابقون.</div>') + '</div>' + formed;
  }

  // كشف الاختبار: بما في الشاشة الآن (حتى ما لم يُحفظ بعد)
  // التوقيعات في مستوى واحد: أعضاء اللجنة كلٌّ بمسماه وفوقهم «أعضاء اللجنة»، ثم مدير الأكاديمية
  function rxSigns(names) {
    var inner = function (list) { return reportSigns(list, true).replace(/^<div class="rs">/, '').replace(/<\/div>$/, ''); };
    var list = (names.length ? names : ['', '', '']).map(function (nm) { return ['عضو اللجنة', nm]; });
    return '<div class="rs"><div style="flex:' + list.length + ';border:0;padding:0"><div class="rsec" style="text-align:center;margin-top:0">أعضاء اللجنة</div><div class="rs" style="margin-top:.4em">' + inner(list) + '</div></div>' + inner([[principalTitle(), principalName()]]) + '</div>';
  }
  function buildRxSheet() {
    var d = rxD(), rows = rxPicked(), n = 8, names = rxNames(d);
    var head = reportHead(rxHead(d.title), [['التاريخ', dmy(d.exam_date)], ['عدد الطلاب', rows.length]], { noIssueDate: true }).replace(/^<img class="wm"[^>]*>/, '').replace('<h1>', '<h1 style="font-size:1.9em;line-height:1.35">');
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
      '<table class="rz"><thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>' +
      '<tr><th style="width:3em">م</th><th>اسم الطالب</th><th>مكان الميلاد</th><th>الصف</th><th>تاريخ الميلاد</th><th>' + rxTeachHead(d.title) + '</th><th style="width:8%">الدرجة</th><th style="width:10%">التقدير</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (x, i) {
        var g = d.grades[x.id];
        return '<tr><td class="c">' + (i + 1) + '</td><td><b>' + esc(x.full_name) + '</b></td><td class="c">' + esc(rxPlace(x, d)) + '</td><td class="c">' + esc(x.class_name || '') + '</td><td class="c">' + dmy(x.birth_date) + '</td><td class="c">' + esc(rxTeacher(x, d.subject)) + '</td><td class="c">' + (g == null ? '' : esc(g)) + '</td><td class="c">' + esc(rxRating(d.bands, g)) + '</td></tr>';
      }).join('') : '<tr><td colspan="' + n + '" class="c">لم يُختر طلاب.</td></tr>') + '</tbody>' +
      '<tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>' +
      rxSigns(names);
  }

  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/exams') return;
    var el, c = rxState(), E = rxCur();
    if ((el = e.target.closest('[data-rxopen]'))) { c.open = el.getAttribute('data-rxopen'); c.draft = null; c.dirty = false; c.show = ''; scrollTo(0, 0); return render(); }
    if (e.target.closest('[data-rxclose]')) { if (c.dirty && !confirm('لم تُحفظ التغييرات. الخروج بدون حفظ؟')) return; c.open = ''; c.draft = null; c.dirty = false; return render(); }
    if (e.target.closest('[data-rxprint]')) { if (!E) return; pendingRx = true; return printNow(); }
    if (!rxCanEdit()) return;
    if (e.target.closest('[data-rxnew]')) {
      var r = await sb.from('student_exams').insert({ title: RX_DEFAULT, exam_date: todayISO(), subject: rxDefaultSubject(), created_by: (S.profile && S.profile.full_name) || displayName(S.email) }).select().single();
      if (r.error) return fail(r.error);
      c.list.unshift(r.data); c.open = r.data.id; c.draft = null; c.dirty = false;
      return render();
    }
    if ((el = e.target.closest('[data-rxdel]'))) {
      var y = c.list.filter(function (q) { return q.id === el.getAttribute('data-rxdel'); })[0];
      if (!y || !confirm('حذف «' + (y.title || RX_DEFAULT) + '» (' + dmy(y.exam_date) + ') ودرجاته؟')) return;
      var dl = await sb.from('student_exams').delete().eq('id', y.id);
      if (dl.error) return fail(dl.error);
      c.list = c.list.filter(function (q) { return q.id !== y.id; }); return render();
    }
    if (!E) return;
    var d = rxD();
    if (e.target.closest('[data-rxbandadd]')) { d.bands.push({ from: '', to: '', label: '' }); c.dirty = true; return render(); }
    if ((el = e.target.closest('[data-rxbanddel]'))) { d.bands.splice(Number(el.getAttribute('data-rxbanddel')), 1); c.dirty = true; return render(); }
    if ((el = e.target.closest('[data-rxall]'))) { var on = el.getAttribute('data-rxall') === '1'; rxShown().forEach(function (s1) { if (on) d.sel[s1.id] = true; else delete d.sel[s1.id]; }); c.dirty = true; return render(); }
    if (e.target.closest('[data-rxsave]')) {
      var valid = {}; slStudents().forEach(function (s2) { valid[s2.id] = 1; });
      var ids = Object.keys(d.sel).filter(function (id) { return d.sel[id]; });
      var keep = (E.student_ids || []).filter(function (id) { return !valid[id]; }); // طلاب انسحبوا يبقون كما كانوا
      var all = keep.concat(ids), grades = {};
      all.forEach(function (id) { if (d.grades[id] != null && String(d.grades[id]).trim() !== '') grades[id] = String(d.grades[id]).trim(); });
      var pl = [];
      Object.keys(d.places).forEach(function (id) { var x = findStudent(id), v = String(d.places[id] || '').trim(); if (x && v !== String((x.details && x.details.birth_place) || '')) pl.push([x, v]); });
      var bands = d.bands.filter(function (b) { return String(b.label || '').trim() && rxNum(b.from) != null && rxNum(b.to) != null; }).map(function (b) { return { from: rxNum(b.from), to: rxNum(b.to), label: String(b.label).trim() }; });
      var patch = { bands: bands, title: (d.title || '').trim() || RX_DEFAULT, exam_date: d.exam_date || todayISO(), subject: d.subject, committee: rxNames(d), student_ids: all, grades: grades, updated_at: new Date().toISOString() };
      var w = await sb.from('student_exams').update(patch).eq('id', E.id);
      if (w.error) return fail(w.error);
      // مكان الميلاد يُحفظ في سجل الطالب
      var bad = 0;
      await Promise.all(pl.map(async function (p) {
        var det = Object.assign({}, p[0].details || {}); if (p[1]) det.birth_place = p[1]; else delete det.birth_place;
        var q = await sb.from('students').update({ details: det }).eq('id', p[0].id);
        if (q.error) bad++; else { p[0].details = det; delete d.places[p[0].id]; }
      }));
      if (bad) toast('حُفظ الاختبار وتعذّر حفظ مكان الميلاد لـ ' + bad + ' طالبًا', true);
      Object.assign(E, patch); c.dirty = !!bad; render(); toast('حُفظ الاختبار');
    }
  });
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/exams') return;
    var c = rxState(), el = e.target, id;
    if (el.id === 'rx-cls') { c.cls = el.value; return render(); }
    if (el.id === 'rx-show') { c.show = el.value; return render(); }
    if (!rxCur() || !rxCanEdit()) return;
    var d = rxD();
    if ((id = el.getAttribute('data-rxpick'))) { if (el.checked) d.sel[id] = true; else delete d.sel[id]; c.dirty = true; return render(); }
    if (el.id === 'rx-date') { d.exam_date = el.value; c.dirty = true; return render(); }
    if (el.id === 'rx-subj') { d.subject = el.value; c.dirty = true; return render(); }
  });
  document.addEventListener('input', function (e) {
    if (location.hash !== '#/exams') return;
    var c = rxState(), el = e.target, id;
    if (el.id === 'rx-q') { var pos = el.selectionStart; c.q = el.value; render(); var q = document.getElementById('rx-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} } return; }
    if (!rxCur() || !rxCanEdit()) return;
    var d = rxD();
    if (el.id === 'rx-title') { d.title = el.value; return rxMarkDirty(); }
    if (el.id === 'rx-com') { d.committee = el.value; return rxMarkDirty(); }
    if ((id = el.getAttribute('data-rxplace'))) { d.places[id] = el.value; rxMarkDirty(); return; }
    if ((id = el.getAttribute('data-rxband'))) { var bp = id.split('|'); d.bands[Number(bp[0])][bp[1]] = el.value; rxMarkDirty(); rxRefreshRates(); return; }
    if ((id = el.getAttribute('data-rxgrade'))) { d.grades[id] = el.value; rxMarkDirty(); rxRefreshRates(); }
  });
