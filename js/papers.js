'use strict';
  /* ---------- أوراق العمل والاختبارات ----------
     المعلم يكتب المحتوى فقط (التعليمات، والأنشطة أو الأسئلة ودرجاتها)، ويطبعها البرنامج بقالب الأكاديمية الرسمي
     (ترويسة وتذييل الأكاديمية، وخط Cairo، والكحلي والذهبي). أوراقه خاصة به إلا ما ينشره لزملائه.
     المدير العام والمدير والمشرف التربوي يرون كل الأوراق؛ والمشرف التربوي يعتمد أو يعيد حين يُفعَّل الاعتماد (supabase/teacher_papers.sql) */

  var PP_KINDS = { worksheet: 'ورقة عمل', quiz: 'اختبار قصير', monthly: 'اختبار شهري', midterm: 'اختبار نصفي', final: 'اختبار نهائي' };
  var PP_STATUS = { draft: ['pending', 'مسودة'], submitted: ['part', 'بانتظار الاعتماد'], approved: ['paid', 'معتمدة'], returned: ['unpaid', 'معادة للتعديل'] };
  var PP_TERMS = ['الفصل الدراسي الأول', 'الفصل الدراسي الثاني'];

  function canPapers() { return !!S.myStaff || isAdmin() || isManager() || isSup(); }
  function ppReviewer() { return isAdmin() || isSup(); }
  function ppIsExam(p) { return p.kind !== 'worksheet'; }
  function arDigits(v) { return String(v).replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[d]; }); }
  function ppTotal(p) { return (p.items || []).reduce(function (s, it) { return s + (Number(it.points) || 0); }, 0); }
  function ppUi() { return ui.pp || (ui.pp = { tab: S.myStaff ? 'mine' : 'all', q: '', kind: '', teacher: '', status: '', edit: null }); }
  // مباحث وشعب معلم الورقة: من سجله؛ وإن لم تُسجَّل فكل الشعب وإدخال حر للمادة
  function ppTeacherRow(p) { return (S.ppMe && S.ppMe.id === p.teacher_id ? S.ppMe : null) || find(p.teacher_id) || null; }
  function ppSubjects(p) { var t = ppTeacherRow(p); return t ? splitList(String(t.subject || '').replace(/،/g, ',')) : []; }
  function ppClasses(p) { var t = ppTeacherRow(p), own = t ? splitList(String(t.classes || '').replace(/،/g, ',')) : []; return own.length ? own : schoolClasses(); }
  function ppMine(p) { return S.myStaff && p.teacher_id === S.myStaff.id; }

  async function loadPapers() {
    var r = await sb.from('papers').select('*').order('updated_at', { ascending: false }).limit(2000);
    S.ppMissing = !!r.error;
    S.papers = r.data || [];
    var c = await sb.from('paper_settings').select('*').eq('id', 1).maybeSingle();
    S.ppCfg = c.data || { review_enabled: false };
    // مباحث المعلم وشعبه من سجله في «بيانات العاملين»
    var me = S.myStaff ? await sb.from('teachers').select('id, name, subject, classes').eq('id', S.myStaff.id).maybeSingle() : { data: null };
    S.ppMe = me.data || null;
    render();
  }

  function ppNew(kind, mode) {
    var n = mode === 'scan' ? 0 : 3, base = { teacher_id: S.myStaff ? S.myStaff.id : '' }, subs = ppSubjects(base), cls = ppClasses(base);
    return { id: null, mode: mode || 'build', files: [], teacher_id: base.teacher_id, kind: kind || 'worksheet', subject: subs[0] || '', class_name: cls.length === 1 ? cls[0] : '', lesson: '',
      term: PP_TERMS[0], paper_date: todayISO(), duration: '', instructions: '', visibility: 'private', status: 'draft',
      items: Array.apply(null, Array(n)).map(function () { return { title: '', points: kind === 'worksheet' ? '' : 5, body: '', lines: 4 }; }) };
  }

  function renderPapers() {
    var u = ppUi();
    var head = '<div class="page-head"><div><h1>أوراق العمل والاختبارات</h1><p>اكتب المحتوى فقط، ويطبعه البرنامج بقالب الأكاديمية الرسمي (PDF). ' +
      'أوراقك خاصة بك، إلا ما تختار نشره لزملائك.</p></div></div>';
    if (S.papers == null) { app.innerHTML = head + '<div class="card empty">جارٍ التحميل…</div>'; loadPapers(); return; }
    if (S.ppMissing) { app.innerHTML = head + '<div class="card empty">الأوراق تحتاج إلى جداول جديدة: شغّل الملف <code dir="ltr">supabase/teacher_papers.sql</code> في محرر SQL ثم حدّث الصفحة.</div>'; return; }
    app.innerHTML = head + (u.edit ? ppEditorHtml(u.edit) : ppListHtml());
  }

  function ppListHtml() {
    var u = ppUi(), rev = S.ppCfg && S.ppCfg.review_enabled;
    var tabs = (S.myStaff ? [['mine', 'أوراقي'], ['public', 'أوراق الزملاء المنشورة']] : []).concat(isAdmin() || isManager() || isSup() ? [['all', 'كل الأوراق']] : []);
    var q = norm(u.q);
    var list = S.papers.filter(function (p) {
      if (u.tab === 'mine' && !ppMine(p)) return false;
      if (u.tab === 'public' && (ppMine(p) || p.visibility !== 'public')) return false;
      if (u.kind && p.kind !== u.kind) return false;
      if (u.teacher && p.teacher_id !== u.teacher) return false;
      if (u.status && p.status !== u.status) return false;
      var t = find(p.teacher_id);
      return !q || norm([p.subject, p.class_name, p.lesson, t ? t.name : ''].join(' ')).indexOf(q) > -1;
    });
    var opt = function (v, l, cur) { return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(l) + '</option>'; };
    var teachers = {};
    S.papers.forEach(function (p) { teachers[p.teacher_id] = 1; });
    var rows = list.map(function (p) {
      var t = find(p.teacher_id), st = PP_STATUS[p.status] || PP_STATUS.draft;
      return '<tr><td><b>' + PP_KINDS[p.kind] + '</b></td><td>' + esc(p.subject || '—') + '</td><td>' + esc(p.class_name || '—') + '</td><td>' + esc(p.lesson || '') + '</td>' +
        '<td style="white-space:nowrap">' + (p.paper_date ? dmy(p.paper_date) : '') + '</td>' + (u.tab !== 'mine' ? '<td>' + esc(t ? t.name : '') + '</td>' : '') +
        '<td>' + (p.mode === 'scan' ? 'ورقة جاهزة · ' + (p.files || []).length + ' ملف' : (p.items || []).length + (ppTotal(p) ? ' · ' + ppTotal(p) + ' درجة' : '')) + '</td>' +
        '<td>' + (p.visibility === 'public' ? '<span class="badge published">منشورة</span>' : '<span class="badge pending">خاصة</span>') + '</td>' +
        (rev ? '<td><span class="badge ' + st[0] + '">' + st[1] + '</span>' + (p.status === 'returned' && p.review_note ? '<div class="hint" style="margin:2px 0 0">' + esc(p.review_note) + '</div>' : '') + '</td>' : '') +
        '<td><div class="acts"><button type="button" class="btn" data-ppopen="' + p.id + '">' + (ppMine(p) || isAdmin() ? 'فتح' : 'عرض') + '</button>' +
        '<button type="button" class="btn" data-ppprint="' + p.id + '">طباعة / PDF</button>' +
        (S.myStaff ? '<button type="button" class="btn" data-ppcopy="' + p.id + '" title="نسخة جديدة في أوراقي">نسخ</button>' : '') + '</div></td></tr>';
    }).join('');
    return '<div class="toolbar" style="align-items:center">' + tabs.map(function (t) { return '<button type="button" class="btn' + (u.tab === t[0] ? ' primary' : '') + '" data-pptab="' + t[0] + '">' + t[1] + '</button>'; }).join('') +
        '<span style="flex:1"></span>' + (S.myStaff || isAdmin() ? Object.keys(PP_KINDS).map(function (k) { return k === 'worksheet' || k === 'quiz' ? '<button type="button" class="btn primary" data-ppnew="' + k + '">+ ' + PP_KINDS[k] + '</button>' : ''; }).join('') +
          '<button type="button" class="btn" data-ppscan title="صورة أو PDF لورقة أعددتها من قبل، تُطبع بترويسة الأكاديمية وتذييلها">+ ورقة جاهزة (صورة أو PDF)</button>' +
          '<select id="pp-newkind" style="width:auto"><option value="">+ اختبار آخر…</option>' + ['monthly', 'midterm', 'final'].map(function (k) { return opt(k, PP_KINDS[k], ''); }).join('') + '</select>' : '') + '</div>' +
      '<div class="toolbar" style="align-items:center"><input type="search" id="pp-q" placeholder="المادة أو الشعبة أو الدرس أو المعلم" value="' + esc(u.q) + '" style="max-width:260px">' +
        '<select id="pp-kind" style="width:auto">' + opt('', 'كل الأنواع', u.kind) + Object.keys(PP_KINDS).map(function (k) { return opt(k, PP_KINDS[k], u.kind); }).join('') + '</select>' +
        (u.tab !== 'mine' ? '<select id="pp-teacher" style="width:auto">' + opt('', 'كل المعلمين', u.teacher) + Object.keys(teachers).map(function (id) { var t = find(id); return t ? opt(id, t.name, u.teacher) : ''; }).join('') + '</select>' : '') +
        (rev ? '<select id="pp-status" style="width:auto">' + opt('', 'كل الحالات', u.status) + Object.keys(PP_STATUS).map(function (k) { return opt(k, PP_STATUS[k][1], u.status); }).join('') + '</select>' : '') +
        (isAdmin() ? '<label class="check" style="margin-inline-start:auto"><input type="checkbox" id="pp-review"' + (rev ? ' checked' : '') + '> تفعيل اعتماد المشرف التربوي</label>' : '') + '</div>' +
      '<div class="card">' + (rows ? '<div class="table-wrap"><table class="grid"><thead><tr><th>النوع</th><th>المادة</th><th>الشعبة</th><th>الدرس</th><th>التاريخ</th>' + (u.tab !== 'mine' ? '<th>المعلم</th>' : '') +
          '<th>الفقرات</th><th>النشر</th>' + (rev ? '<th>الاعتماد</th>' : '') + '<th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">' + (u.tab === 'mine' ? 'لا أوراق بعد. ابدأ بزر «+ ورقة عمل» أو «+ اختبار قصير».' : 'لا أوراق.') + '</div>') + '</div>';
  }

  function ppEditorHtml(p) {
    var own = !p.id || ppMine(p) || isAdmin(), rev = S.ppCfg && S.ppCfg.review_enabled, exam = ppIsExam(p), t = find(p.teacher_id);
    var ro = own ? '' : ' disabled', unit = exam ? 'السؤال' : 'النشاط';
    var opt = function (v, l, cur) { return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(l) + '</option>'; };
    var f = function (id, label, inner) { return '<div><label class="field" for="' + id + '">' + label + '</label>' + inner + '</div>'; };
    var st = PP_STATUS[p.status] || PP_STATUS.draft;
    var items = (p.items || []).map(function (it, i) {
      return '<div class="card" style="border-inline-start:4px solid #C6A668;margin:10px 0"><div class="toolbar" style="align-items:center;margin:0 0 6px">' +
        '<b style="background:#0B2F5A;color:#fff;border-radius:50%;width:30px;height:30px;display:grid;place-items:center">' + arDigits(i + 1) + '</b>' +
        '<input data-ppi="' + i + '" data-ppk="title" value="' + esc(it.title) + '" placeholder="عنوان ' + unit + ' أو تعليماته (مثلًا: اختر الإجابة الصحيحة)" style="flex:1"' + ro + '>' +
        '<label class="hint" style="margin:0">الدرجة</label><input type="number" min="0" step="0.5" data-ppi="' + i + '" data-ppk="points" value="' + esc(it.points) + '" style="width:5em"' + ro + '>' +
        (own ? '<button type="button" class="btn" data-ppup="' + i + '" title="أعلى"' + (i ? '' : ' disabled') + '>▲</button><button type="button" class="btn" data-ppdown="' + i + '" title="أسفل"' + (i < p.items.length - 1 ? '' : ' disabled') + '>▼</button>' +
          '<button type="button" class="btn danger" data-ppdel="' + i + '" title="حذف">✕</button>' : '') + '</div>' +
        '<textarea data-ppi="' + i + '" data-ppk="body" rows="4" style="width:100%" placeholder="نص ' + unit + ' وفقراته (كل فقرة في سطر). للاختيار من متعدد: اكتب الخيارات أسطرًا، مثل: أ) … ب) …"' + ro + '>' + esc(it.body) + '</textarea>' +
        '<div class="toolbar" style="align-items:center;margin:4px 0 0"><label class="hint" style="margin:0">أسطر للإجابة تحت ' + unit + '</label><input type="number" min="0" max="25" data-ppi="' + i + '" data-ppk="lines" value="' + esc(it.lines) + '" style="width:5em"' + ro + '></div></div>';
    }).join('');
    return '<div class="card"><div class="toolbar" style="align-items:center;margin:0 0 10px"><h2 style="margin:0;flex:1">' + (p.id ? (own ? 'تعديل ' : '') : 'جديد: ') + PP_KINDS[p.kind] +
        (t && !ppMine(p) ? ' — ' + esc(t.name) : '') + '</h2>' + (rev && p.id ? '<span class="badge ' + st[0] + '">' + st[1] + '</span>' : '') +
        '<button type="button" class="btn" data-ppback>رجوع للقائمة</button></div>' +
      (p.status === 'returned' && p.review_note ? '<div class="formhint" style="margin:0 0 10px"><b>ملاحظة المشرف:</b> ' + esc(p.review_note) + '</div>' : '') +
      '<div class="grid2">' +
        (isAdmin() && !S.myStaff || isAdmin() && p.teacher_id !== (S.myStaff && S.myStaff.id) ? f('pp-teacherid', 'المعلم', '<select id="pp-teacherid"' + ro + '>' + opt('', '— اختر —', p.teacher_id) +
          S.teachers.filter(function (x) { return !x.not_staff; }).map(function (x) { return opt(x.id, x.name, p.teacher_id); }).join('') + '</select>') : '') +
        f('pp-kindsel', 'النوع', '<select id="pp-kindsel"' + ro + '>' + Object.keys(PP_KINDS).map(function (k) { return opt(k, PP_KINDS[k], p.kind); }).join('') + '</select>') +
        (function () {
          var subs = ppSubjects(p), cls = ppClasses(p);
          if (p.subject && subs.length && subs.indexOf(p.subject) < 0) subs = subs.concat([p.subject]);
          if (p.class_name && cls.indexOf(p.class_name) < 0) cls = cls.concat([p.class_name]);
          return f('pp-subject', 'المادة', subs.length ? '<select id="pp-subject" data-ppf="subject"' + ro + '>' + subs.map(function (x) { return opt(x, x, p.subject); }).join('') + '</select>'
              : '<input id="pp-subject" data-ppf="subject" value="' + esc(p.subject) + '" placeholder="لم تُسجَّل مباحثك في بياناتك"' + ro + '>') +
            f('pp-class', 'الصف / الشعبة', '<select id="pp-class" data-ppf="class_name"' + ro + '>' + opt('', '— اختر —', p.class_name) + cls.map(function (c) { return opt(c, c, p.class_name); }).join('') + '</select>');
        })() +
        (exam ? f('pp-duration', 'الزمن', '<input id="pp-duration" data-ppf="duration" placeholder="مثلًا: 45 دقيقة" value="' + esc(p.duration) + '"' + ro + '>')
          : f('pp-lesson', 'الدرس', '<input id="pp-lesson" data-ppf="lesson" value="' + esc(p.lesson) + '"' + ro + '>')) +
        (exam ? f('pp-lesson', 'الوحدة / الدروس (اختياري، لا تُطبع)', '<input id="pp-lesson" data-ppf="lesson" value="' + esc(p.lesson) + '"' + ro + '>') : '') +
        f('pp-date', 'التاريخ', '<input type="date" id="pp-date" data-ppf="paper_date" value="' + esc(p.paper_date || '') + '"' + ro + '>') +
        f('pp-term', 'الفصل الدراسي', '<select id="pp-term" data-ppf="term"' + ro + '>' + PP_TERMS.map(function (x) { return opt(x, x, p.term); }).join('') + '</select>') +
      '</div>' +
      (p.mode === 'scan' ? '' : '<label class="field" for="pp-instr">التعليمات</label><textarea id="pp-instr" data-ppf="instructions" rows="3" style="width:100%" placeholder="تعليمات ' + (exam ? 'الاختبار' : 'ورقة العمل') + ' (تُطبع في إطار أعلى الورقة)"' + ro + '>' + esc(p.instructions) + '</textarea>') +
      '</div>' + (p.mode === 'scan' ? ppScanHtml(p, own) : '') +
      (p.mode === 'scan' ? '' : '<h2 style="margin:16px 0 0">' + (exam ? 'الأسئلة' : 'الأنشطة') + ' <span class="hint" style="margin:0">— المجموع: <b id="pp-total">' + ppTotal(p) + '</b> درجة</span></h2>' + items +
      (own ? '<button type="button" class="btn" data-ppadd>+ ' + (exam ? 'سؤال' : 'نشاط') + '</button>' : '')) +
      '<div class="card" style="position:sticky;bottom:0;z-index:2;margin-top:12px"><div class="toolbar" style="align-items:center;margin:0">' +
        (own ? '<label class="check"><input type="checkbox" id="pp-public"' + (p.visibility === 'public' ? ' checked' : '') + '> نشر الورقة لزملائي</label>' +
          '<button type="button" class="btn primary" data-ppsave>حفظ</button>' : '') +
        '<button type="button" class="btn" data-ppsaveprint>' + (own ? 'حفظ و' : '') + 'طباعة / PDF</button>' +
        (own && rev && p.status !== 'submitted' && p.status !== 'approved' ? '<button type="button" class="btn" data-ppsubmit>إرسال للاعتماد</button>' : '') +
        (!own && S.myStaff ? '<button type="button" class="btn" data-ppcopy="' + p.id + '">نسخ إلى أوراقي</button>' : '') +
        (rev && ppReviewer() && p.id && !ppMine(p) ? '<button type="button" class="btn primary" data-ppapprove>اعتماد</button><button type="button" class="btn danger" data-ppreturn>إعادة للتعديل</button>' : '') +
        (own && p.id && p.status !== 'approved' ? '<button type="button" class="btn danger" data-ppremove style="margin-inline-start:auto">حذف الورقة</button>' : '') + '</div></div>';
  }

  // قراءة النموذج إلى الورقة المفتوحة (الحقول تُحدَّث أولًا بأول؛ هنا ما تبقّى)
  function ppCollect() {
    var p = ppUi().edit, pub = document.getElementById('pp-public'), tid = document.getElementById('pp-teacherid');
    if (pub) p.visibility = pub.checked ? 'public' : 'private';
    if (tid) p.teacher_id = tid.value;
    return p;
  }

  async function ppSave(extra) {
    var p = ppCollect();
    if (!p.teacher_id) return toast('اختر المعلم', true), null;
    if (!p.subject.trim()) return toast('اكتب المادة', true), null;
    var row = { teacher_id: p.teacher_id, kind: p.kind, subject: p.subject.trim(), class_name: p.class_name, lesson: p.lesson.trim(), term: p.term, paper_date: p.paper_date || null,
      duration: p.duration.trim(), instructions: p.instructions, visibility: p.visibility, mode: p.mode || 'build', files: p.files || [],
      items: p.items.map(function (it) { return { title: String(it.title || '').trim(), points: it.points === '' || it.points == null ? '' : Number(it.points), body: String(it.body || ''), lines: Math.max(0, Math.min(25, Number(it.lines) || 0)) }; }) };
    Object.assign(row, extra || {});
    var r = p.id ? await sb.from('papers').update(row).eq('id', p.id).select().single() : await sb.from('papers').insert(row).select().single();
    if (r.error) return fail(r.error), null;
    var saved = Object.assign({}, p, row, r.data || {});
    Object.assign(p, saved);
    S.papers = S.papers.filter(function (x) { return x.id !== saved.id; });
    S.papers.unshift(JSON.parse(JSON.stringify(saved)));
    return saved;
  }

  // ورقة جاهزة: صفحاتها صور أو PDF، كل صفحة تُطبع بين ترويسة الأكاديمية وتذييلها
  function ppScanHtml(p, own) {
    var fl = p.files || [], busy = ppUi().busy;
    return '<div class="card"><h2 style="margin-top:0">صفحات الورقة (' + fl.length + ')</h2>' +
      (fl.length ? '<div class="table-wrap"><table class="grid"><tbody>' + fl.map(function (x, i) {
        return '<tr><td>' + arDigits(i + 1) + '</td><td><b>' + esc(x.name) + '</b></td><td><div class="acts"><button type="button" class="btn" data-ppfopen="' + i + '">فتح</button>' +
          (own ? '<button type="button" class="btn" data-ppfup="' + i + '"' + (i ? '' : ' disabled') + '>▲</button><button type="button" class="btn danger" data-ppfdel="' + i + '">حذف</button>' : '') + '</div></td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty">لم تُرفع صفحات بعد.</div>') +
      (own ? '<div class="toolbar" style="margin:10px 0 0"><button type="button" class="btn primary" data-ppfpick' + (busy ? ' disabled' : '') + '>' + (busy ? esc(busy) : 'رفع صور أو PDF…') + '</button>' +
        '<input type="file" id="pp-files" multiple hidden accept="image/jpeg,image/png,image/webp,.pdf"></div>' : '') +
      '<p class="hint">صورة لكل صفحة، أو ملف PDF بصفحاته. عند الطباعة توضع كل صفحة بين ترويسة الأكاديمية في الأعلى وبياناتها في الأسفل. ' +
        'الأفضل صورة واضحة للورقة بلا هوامش كبيرة، وبلا ترويسة قديمة.</p></div>';
  }

  async function ppUploadFiles(files) {
    var u = ppUi(), p = u.edit;
    if (!p.id) { var sv = await ppSave(); if (!sv) return; }
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      u.busy = 'جارٍ رفع ' + (i + 1) + ' من ' + files.length + '…'; render();
      var r = await sb.functions.invoke('staff-files', { body: { action: 'paper_upload', paper_id: p.id, name: file.name, size: file.size, mime: file.type } });
      var ok = false;
      if (!r.error && r.data && r.data.url) { try { ok = (await fetch(r.data.url, { method: 'PUT', body: file })).ok; } catch (err) { ok = false; } }
      if (!ok) { toast('تعذّر رفع «' + file.name + '»' + (r.error ? ': ' + r.error.message : ''), true); continue; }
      p.files.push({ key: r.data.key, name: file.name, mime: file.type, size: file.size });
    }
    u.busy = null;
    if (await ppSave()) toast('رُفعت الصفحات');
    render();
  }

  async function ppFileBlob(p, x) {
    var r = await sb.functions.invoke('staff-files', { body: { action: 'paper_open', paper_id: p.id, key: x.key } });
    if (r.error || !r.data) throw new Error('تعذّر فتح «' + x.name + '»');
    var b = await (await fetch(r.data.url)).blob();
    return new File([b], x.name, { type: x.mime || b.type });
  }

  var pendingPaper = null;
  async function ppPrint(p) {
    if (p.mode === 'scan') {
      if (!(p.files || []).length) return toast('ارفع صفحات الورقة أولًا', true);
      var keep = SCAN_MAX_SIDE, imgs = [];
      SCAN_MAX_SIDE = 2400;
      toast('جارٍ تجهيز الصفحات للطباعة…');
      try {
        for (var i = 0; i < p.files.length; i++) imgs = imgs.concat(await scanFilePages(await ppFileBlob(p, p.files[i])));
      } catch (err) { SCAN_MAX_SIDE = keep; return toast(err.message || String(err), true); }
      SCAN_MAX_SIDE = keep;
      p = Object.assign({}, p, { _imgs: imgs });
    }
    pendingPaper = p;
    printNow();
  }

  // الورقة بقالب الأكاديمية: ترويسة وتذييل ثابتان في كل صفحة، وبيانات الطالب، والتعليمات، ثم الأنشطة أو الأسئلة بمساحات الإجابة
  function buildPaperSheet(p) {
    if (p.mode === 'scan') {
      sheet.className = 'paper';
      sheet.removeAttribute('data-fit');
      sheet.innerHTML = '<img class="pp-hdr" src="paper-header.png" alt=""><img class="pp-ftr" src="paper-footer.png" alt="">' +
        (p._imgs || []).map(function (im, i, a) {
          return '<div class="pp-scan"' + (i < a.length - 1 ? ' style="break-after:page;page-break-after:always"' : '') + '><img src="data:' + im.media_type + ';base64,' + im.data + '" alt=""></div>';
        }).join('');
      return;
    }
    var exam = ppIsExam(p), total = ppTotal(p);
    var lines = function (n) { var s = ''; for (var i = 0; i < n; i++) s += '<div class="pp-line"></div>'; return s; };
    var body = function (t) { return esc(t); };
    var items = (p.items || []).map(function (it, i) {
      return '<div class="pp-item"><div class="pp-ihead"><span class="pp-num">' + arDigits(i + 1) + '</span><span class="pp-ititle">' + (it.title ? esc(it.title) : (exam ? 'السؤال ' : 'النشاط ') + arDigits(i + 1)) + '</span>' +
        '<span class="pp-grade"><span>الدرجة</span><b>ــ / ' + (it.points !== '' && it.points != null ? arDigits(it.points) : '') + '</b></span></div>' +
        (it.body ? '<div class="pp-body">' + body(it.body) + '</div>' : '') + lines(Number(it.lines) || 0) + '</div>';
    }).join('');
    var info = '<table class="pp-info"><tr><th>اسم الطالب</th><td colspan="3"></td><th>الصف</th><td>' + esc(p.class_name || '') + '</td></tr>' +
      '<tr><th>المادة</th><td>' + esc(p.subject) + '</td><th>التاريخ</th><td>' + (p.paper_date ? '<span dir="ltr">' + arDigits(dmy(p.paper_date)) + '</span>' : '/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/') + '</td>' +
      (exam ? '<th>الزمن</th><td>' + esc(p.duration || '') + '</td></tr><tr><th>الدرجة</th><td colspan="5" class="pp-score">ــــ / ' + (total ? arDigits(total) : '') + '</td></tr>'
        : '<th>الدرس</th><td>' + esc(p.lesson || '') + '</td></tr><tr><th>التقييم</th><td colspan="5" class="pp-score">ــــ / ' + (total ? arDigits(total) : '') + '</td></tr>') + '</table>';
    sheet.className = 'paper';
    sheet.removeAttribute('data-fit');
    sheet.innerHTML = '<img class="pp-hdr" src="paper-header.png" alt=""><img class="pp-ftr" src="paper-footer.png" alt="">' + (exam ? '' : '<img class="pp-wm" src="paper-wm.png" alt="">') +
      '<table class="pp-frame"><thead><tr><td class="pp-top"></td></tr></thead><tfoot><tr><td class="pp-bottom"></td></tr></tfoot><tbody><tr><td class="pp-content">' +
        '<div class="pp-title"><span>' + (exam ? 'نموذج اختبار' : 'ورقة عمل') + (p.kind !== 'worksheet' && p.kind !== 'quiz' ? ' — ' + PP_KINDS[p.kind].replace('اختبار ', '') : '') + '</span><b>' + esc(p.subject) + '</b>' +
          (p.term ? '<small>' + esc(p.term) + '</small>' : '') + '</div>' + info +
        (p.instructions ? '<div class="pp-instr"><b>التعليمات</b><div>' + body(p.instructions) + '</div></div>' : '') + items +
        (exam ? '<div class="pp-notes">ملاحظات المصحح <span></span></div>' : '') +
      '</td></tr></tbody></table>';
  }

  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/papers' || !canPapers()) return;
    var u = ppUi(), el, p = u.edit;
    if ((el = e.target.closest('[data-pptab]'))) { u.tab = el.getAttribute('data-pptab'); return render(); }
    if ((el = e.target.closest('[data-ppnew]'))) { u.edit = ppNew(el.getAttribute('data-ppnew')); scrollTo(0, 0); return render(); }
    if (e.target.closest('[data-ppscan]')) { u.edit = ppNew('worksheet', 'scan'); scrollTo(0, 0); return render(); }
    if ((el = e.target.closest('[data-ppopen]'))) { var o = S.papers.filter(function (x) { return x.id === el.getAttribute('data-ppopen'); })[0]; if (o) { u.edit = JSON.parse(JSON.stringify(o)); scrollTo(0, 0); render(); } return; }
    if ((el = e.target.closest('[data-ppprint]'))) { var q = S.papers.filter(function (x) { return x.id === el.getAttribute('data-ppprint'); })[0]; return q && ppPrint(q); }
    if ((el = e.target.closest('[data-ppcopy]'))) {
      var src = S.papers.filter(function (x) { return x.id === el.getAttribute('data-ppcopy'); })[0];
      if (!src) return;
      u.edit = Object.assign(JSON.parse(JSON.stringify(src)), { id: null, teacher_id: S.myStaff.id, status: 'draft', visibility: 'private', review_note: null, paper_date: todayISO() });
      toast('نسخة جديدة — عدّلها ثم احفظها في أوراقك');
      scrollTo(0, 0);
      return render();
    }
    if (e.target.closest('[data-ppback]')) { u.edit = null; return render(); }
    if (!p) return;
    if (e.target.closest('[data-ppfpick]')) { ppCollect(); return document.getElementById('pp-files').click(); }
    if ((el = e.target.closest('[data-ppfopen]'))) {
      var w = window.open('', '_blank'), fx = p.files[+el.getAttribute('data-ppfopen')];
      var ro = await sb.functions.invoke('staff-files', { body: { action: 'paper_open', paper_id: p.id, key: fx.key } });
      if (ro.error || !ro.data) { if (w) w.close(); return toast('تعذّر فتح الملف', true); }
      if (w) w.location = ro.data.url;
      return;
    }
    if ((el = e.target.closest('[data-ppfup]'))) { var fu = +el.getAttribute('data-ppfup'); p.files.splice(fu - 1, 0, p.files.splice(fu, 1)[0]); await ppSave(); return render(); }
    if ((el = e.target.closest('[data-ppfdel]'))) {
      var fi = +el.getAttribute('data-ppfdel'), fd = p.files[fi];
      if (!confirm('حذف «' + fd.name + '» من الورقة؟')) return;
      await sb.functions.invoke('staff-files', { body: { action: 'paper_delete', paper_id: p.id, key: fd.key } });
      p.files.splice(fi, 1); await ppSave(); return render();
    }
    if (e.target.closest('[data-ppadd]')) { ppCollect(); p.items.push({ title: '', points: ppIsExam(p) ? 5 : '', body: '', lines: 4 }); return render(); }
    if ((el = e.target.closest('[data-ppdel]'))) { ppCollect(); var di = +el.getAttribute('data-ppdel'); if (p.items[di].body || p.items[di].title) { if (!confirm('حذف هذه الفقرة؟')) return; } p.items.splice(di, 1); return render(); }
    if ((el = e.target.closest('[data-ppup]'))) { ppCollect(); var a = +el.getAttribute('data-ppup'); p.items.splice(a - 1, 0, p.items.splice(a, 1)[0]); return render(); }
    if ((el = e.target.closest('[data-ppdown]'))) { ppCollect(); var b = +el.getAttribute('data-ppdown'); p.items.splice(b + 1, 0, p.items.splice(b, 1)[0]); return render(); }
    if (e.target.closest('[data-ppsave]')) { if (await ppSave()) { render(); toast('حُفظت الورقة'); } return; }
    if (e.target.closest('[data-ppsaveprint]')) {
      var own = !p.id || ppMine(p) || isAdmin();
      if (own) { var sv = await ppSave(); if (!sv) return; render(); }
      return ppPrint(p);
    }
    if (e.target.closest('[data-ppsubmit]')) { if (await ppSave({ status: 'submitted' })) { render(); toast('أُرسلت الورقة للمشرف التربوي'); } return; }
    if (e.target.closest('[data-ppapprove]') || e.target.closest('[data-ppreturn]')) {
      var ok = !!e.target.closest('[data-ppapprove]'), note = ok ? null : prompt('ملاحظة للمعلم (سبب الإعادة):', p.review_note || '');
      if (!ok && note == null) return;
      var r = await sb.from('papers').update({ status: ok ? 'approved' : 'returned', review_note: note, reviewed_by: (S.profile && S.profile.full_name) || displayName(S.email), reviewed_at: new Date().toISOString() }).eq('id', p.id).select().single();
      if (r.error) return fail(r.error);
      S.papers = S.papers.map(function (x) { return x.id === p.id ? r.data : x; });
      u.edit = null; render();
      return toast(ok ? 'اعتُمدت الورقة' : 'أُعيدت للمعلم');
    }
    if (e.target.closest('[data-ppremove]')) {
      if (!confirm('حذف هذه الورقة نهائيًا؟')) return;
      for (var k = 0; k < (p.files || []).length; k++) await sb.functions.invoke('staff-files', { body: { action: 'paper_delete', paper_id: p.id, key: p.files[k].key } });
      var d = await sb.from('papers').delete().eq('id', p.id);
      if (d.error) return fail(d.error);
      S.papers = S.papers.filter(function (x) { return x.id !== p.id; });
      u.edit = null; render();
      return toast('حُذفت الورقة');
    }
  });
  document.addEventListener('change', async function (e) {
    if (location.hash !== '#/papers' || !canPapers()) return;
    var u = ppUi(), id = e.target.id;
    if (id === 'pp-newkind' && e.target.value) { u.edit = ppNew(e.target.value); scrollTo(0, 0); return render(); }
    var map = { 'pp-kind': 'kind', 'pp-teacher': 'teacher', 'pp-status': 'status' };
    if (map[id]) { u[map[id]] = e.target.value; return render(); }
    if (id === 'pp-review') {
      var r = await sb.from('paper_settings').update({ review_enabled: e.target.checked }).eq('id', 1);
      if (r.error) return fail(r.error);
      S.ppCfg.review_enabled = e.target.checked; render();
      return toast(e.target.checked ? 'فُعّل اعتماد المشرف التربوي' : 'عُطّل الاعتماد');
    }
    if (u.edit && id === 'pp-files' && e.target.files.length) return ppUploadFiles(Array.prototype.slice.call(e.target.files));
    if (u.edit && id === 'pp-teacherid') {
      ppCollect();
      var subs = ppSubjects(u.edit), cls = ppClasses(u.edit);
      u.edit.subject = subs[0] || u.edit.subject;
      if (cls.indexOf(u.edit.class_name) < 0) u.edit.class_name = cls.length === 1 ? cls[0] : '';
      return render();
    }
    if (u.edit && id === 'pp-kindsel') { ppCollect(); u.edit.kind = e.target.value; return render(); }
    if (u.edit && e.target.getAttribute('data-ppf')) u.edit[e.target.getAttribute('data-ppf')] = e.target.value;
  });
  document.addEventListener('input', function (e) {
    if (location.hash !== '#/papers') return;
    var u = ppUi(), el = e.target;
    if (el.id === 'pp-q') {
      u.q = el.value; var pos = el.selectionStart; render();
      var q = document.getElementById('pp-q'); if (q) { q.focus(); q.setSelectionRange(pos, pos); }
      return;
    }
    if (!u.edit) return;
    if (el.getAttribute('data-ppf')) u.edit[el.getAttribute('data-ppf')] = el.value;
    if (el.hasAttribute('data-ppi')) {
      u.edit.items[+el.getAttribute('data-ppi')][el.getAttribute('data-ppk')] = el.value;
      var tot = document.getElementById('pp-total'); if (tot) tot.textContent = ppTotal(u.edit);
    }
  });

  async function loadMine(month) {
    if (loadingMine) return;
    loadingMine = true;
    var r = await sb.rpc('my_staff_month', { p_month: month });
    loadingMine = false;
    S.mine = { month: month, data: r.error ? null : r.data, error: r.error ? r.error.message : '' };
    render();
  }
  // السيرة الذاتية للعامل نفسه في «دوامي وراتبي» (بطاقة المؤهلات المعتمدة ورابطها)
  function mineCvHtml() {
    if (S.myCv === undefined) { S.myCv = null; sb.rpc('my_staff_cv').then(function (r) { S.myCv = r.error ? false : r.data || false; render(); }); return ''; }
    var c = S.myCv, d = (c && c.data) || {};
    var facts = [['المؤهل', d.degree], ['التخصص', d.major], ['الجامعة', d.university], ['التخرج', d.grad_year], ['الخبرة', d.experience_years ? d.experience_years + ' سنة' : '']].filter(function (x) { return x[1]; });
    return '<div class="card"><div class="toolbar" style="align-items:center;margin:0 0 8px"><h2 style="margin:0;flex:1">سيرتي الذاتية</h2>' +
      (c && c.token ? '<a class="btn primary" target="_blank" rel="noopener" href="' + esc(cvLink(c.token)) + '">فتح سيرتي الذاتية</a>' : '') +
      '<a class="btn" href="#/papers">أوراق العمل والاختبارات</a></div>' +
      (facts.length ? '<div class="grid2">' + facts.map(function (x) { return '<div><span class="hint" style="margin:0">' + x[0] + '</span><div><b>' + esc(x[1]) + '</b></div></div>'; }).join('') + '</div>'
        : '<p class="hint" style="margin:0">لم تُعتمد بطاقة مؤهلاتك بعد. ترفع الإدارة سيرتك الذاتية وشهاداتك، ثم تراجع بطاقتك وتعتمدها.</p>') + '</div>';
  }

  function renderMine() {
    var st = mineState(), head = '<div class="page-head"><div><h1>دوامي وراتبي</h1><p>دوامك في الشهر بحسب مواعيد دوامك.</p></div></div>';
    var bar = '<div class="card"><div class="toolbar" style="align-items:center;margin:0"><span class="monthpick"><label class="field" for="mine-month">الشهر</label><input type="month" id="mine-month" data-ro-ok value="' + st.month + '"></span></div></div>';
    if (!S.mine || S.mine.month !== st.month) { app.innerHTML = head + bar + '<div class="card empty">جارٍ التحميل…</div>'; loadMine(st.month); return; }
    var D = S.mine.data;
    if (!D) { app.innerHTML = head + bar + '<div class="card empty">تعذّر جلب بياناتك' + (S.mine.error ? ': ' + esc(S.mine.error) : '') + '.</div>'; return; }
    var sh = D.shift || { time_in: '07:30', time_out: '13:30', name: 'الوقت الرسمي' }, rec = {};
    (D.days || []).forEach(function (r) { rec[String(r.day).slice(0, 10)] = r; });
    var last = prMonthEnd(st.month), today = todayISO(), list = [], n = { present: 0, absent: 0, leave: 0, mission: 0, none: 0 }, lateDays = 0, lateMins = 0;
    for (var d = new Date(st.month + '-01T00:00'); ; d.setDate(d.getDate() + 1)) {
      var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (iso > last || iso > today) break;
      if (attOff(iso) && !rec[iso]) continue;
      var r = rec[iso], late = r ? saLate(r, sh) : 0;
      if (r) n[r.status] = (n[r.status] || 0) + 1; else n.none++;
      if (late) { lateDays++; lateMins += late; }
      list.push({ day: iso, r: r, late: late });
    }
    var card = function (lbl, num, sub, color) { return '<div class="card stat"><span class="lbl">' + lbl + '</span><span class="num"' + (color ? ' style="color:' + color + '"' : '') + '>' + num + '</span><span class="sub">' + sub + '</span></div>'; };
    var rows = list.map(function (x, i) {
      var r = x.r;
      return '<tr><td>' + (i + 1) + '</td><td style="white-space:nowrap">' + dayName(x.day) + ' ' + dmy(x.day) + '</td><td>' + (r ? SA_STATUS[r.status] || r.status : '<span class="hint" style="margin:0">لم يُسجَّل</span>') + '</td>' +
        '<td class="c" dir="ltr">' + (r && r.time_in ? r.time_in : '') + '</td><td class="c" dir="ltr">' + (r && r.time_out ? r.time_out : '') + '</td>' +
        '<td class="c">' + (x.late ? '<b style="color:var(--red)">' + x.late + ' د</b>' : '') + '</td><td>' + esc(r && r.note || '') + '</td></tr>';
    }).join('');
    var x = D.slip, slip;
    if (x) {
      var ded = [['الغياب', x.absent ? x.absent + ' يوم' : '', x.dAbsent], ['الإجازات الزائدة عن الرصيد', x.leaveExtra ? x.leaveExtra + ' يوم' : '', x.dLeave], ['التأخير', x.lateNote || '', x.dLate],
        ['أيام خارج مدة العمل', x.notEmp ? x.notEmp + ' يوم' : '', x.dNotEmp], ['خصومات أخرى', x.dedNote || '', x.ded]].filter(function (q) { return q[2]; });
      slip = '<div class="card"><div class="toolbar" style="align-items:center;margin:0 0 8px"><h2 style="margin:0;flex:1">راتب ' + esc(monthLabel(st.month)) + '</h2>' +
          '<button type="button" class="btn primary" data-mineslip data-ro-ok>طباعة السليب</button></div>' +
        '<div class="table-wrap"><table class="grid"><tbody>' +
          '<tr><th style="text-align:right">الراتب الأساسي</th><td>' + prMoney(x.salary) + ' ج.م' + (x.salNote ? '<div class="hint" style="margin:0">' + esc(x.salNote) + '</div>' : '') + '</td></tr>' +
          (x.add ? '<tr><th style="text-align:right">إضافات' + (x.addNote ? ' (' + esc(x.addNote) + ')' : '') + '</th><td>+ ' + prMoney(x.add) + ' ج.م</td></tr>' : '') +
          (ded.length ? ded.map(function (q) { return '<tr><th style="text-align:right">خصم: ' + q[0] + (q[1] ? ' (' + esc(q[1]) + ')' : '') + '</th><td style="color:var(--red)">− ' + prMoney(q[2]) + ' ج.م</td></tr>'; }).join('')
            : '<tr><th style="text-align:right">الخصومات</th><td>لا خصومات هذا الشهر</td></tr>') +
          '<tr><th style="text-align:right">صافي الراتب</th><td><b>' + prMoney(x.net) + ' ج.م</b></td></tr></tbody></table></div></div>';
    } else slip = '';
    app.innerHTML = head + bar +
      '<p class="hint">مواعيد دوامك: <b>' + esc(sh.name || '') + '</b> من ' + sh.time_in + ' إلى ' + sh.time_out + '. التأخير يُحسب من وقت الحضور هذا.</p>' +
      mineCvHtml() + '<div class="stats">' + card('أيام الحضور', n.present, lateDays ? 'منها ' + lateDays + ' بتأخير' : 'بلا تأخير') + card('أيام الغياب', n.absent, 'في الشهر', n.absent ? 'var(--red)' : '') +
        card('الإجازات والمأموريات', n.leave + n.mission, 'إجازة ' + n.leave + ' · مأمورية ' + n.mission) + card('دقائق التأخير', lateMins, lateDays + ' يوم', lateMins ? 'var(--red)' : '') + '</div>' +
      slip +
      '<div class="card"><h2>دوام ' + esc(monthLabel(st.month)) + '</h2>' + (list.length
        ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>اليوم</th><th>الحالة</th><th>الحضور</th><th>الانصراف</th><th>تأخير</th><th>ملاحظة</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">لا أيام في هذا الشهر بعد.</div>') + '</div>';
  }
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/mine' || e.target.id !== 'mine-month' || !e.target.value) return;
    mineState().month = e.target.value;
    render();
  });
  document.addEventListener('click', function (e) {
    if (location.hash !== '#/mine' || !e.target.closest('[data-mineslip]') || !S.mine || !S.mine.data || !S.mine.data.slip) return;
    var D = S.mine.data;
    pendingPay = { kind: 'slip', id: D.slip.id, P: { month: D.month, approved: true, rules: D.rules || {}, rows: [D.slip] } };
    printNow();
  });

