'use strict';
  /* ---------- بيانات العاملين (مدير النظام) ----------
     جدول teachers يضم كل العاملين، ولكل واحد فئة. التقييم والزيارات الإشرافية لهيئة التدريس والمحفظين فقط */

  var STAFF_CATS = ['إدارية', 'هيئة تدريس', 'محفظون', 'خدمات مساندة', 'خدمات معاونة'];
  var TEACHING_CATS = ['هيئة تدريس', 'محفظون'];

  function staffCat(t) { return t && STAFF_CATS.indexOf(t.category) > -1 ? t.category : 'هيئة تدريس'; }
  // من ليس من العاملين (حساب تجريبي أو جهة مشرفة) لا يظهر في الدوام ولا التقييم ولا الجدول ولا الاحتياط ولا المواصلات
  function realStaff(t) { return !!t && !t.not_staff; }
  function staffList() { return S.teachers.filter(realStaff); }
  // المعلمون على رأس عملهم اليوم (من انتهى عقده لا يدخل في الأعداد)
  function activeTeachers() { return evalTeachers().filter(function (t) { return employedOn(t, todayISO()); }); }
  // المعلمون = هيئة التدريس فقط؛ المحفظون وظيفة مختلفة فلا يدخلون في قائمة المعلمين وتقييمهم وأعدادهم
  function evalTeachers() { return staffList().filter(function (t) { return staffCat(t) === 'هيئة تدريس'; }); }

  // الفئة من نص حر في كشف مستورد
  function parseStaffCat(v) {
    var n = norm(v);
    if (/محفظ/.test(n)) return 'محفظون';
    if (/ادار/.test(n)) return 'إدارية';
    if (/مساند/.test(n)) return 'خدمات مساندة';
    if (/معاون/.test(n)) return 'خدمات معاونة';
    if (/تدريس|معلم/.test(n)) return 'هيئة تدريس';
    return '';
  }

  // استيراد العاملين من Excel أو CSV: الأعمدة بعناوينها (الاسم، المسمى الوظيفي، الفئة، رقم الجوال، رقم الواتساب)
  async function readStaffFile(file) {
    try {
      await loadXlsx();
      var wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
      var aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      var hi = -1, col = {};
      for (var i = 0; i < Math.min(aoa.length, 15) && hi < 0; i++) {
        aoa[i].forEach(function (h, j) {
          var n = norm(String(h));
          if (/^الاسم|اسم الموظف|اسم العامل/.test(n) && col.name == null) col.name = j;
          else if (/مسمي|وظيف/.test(n) && col.job == null) col.job = j;
          else if (/فئه|التصنيف/.test(n) && col.cat == null) col.cat = j;
          else if (/واتس/.test(n) && col.wa == null) col.wa = j;
          else if (/جوال|هاتف|موبايل/.test(n) && col.phone == null) col.phone = j;
        });
        if (col.name != null) hi = i;
      }
      if (hi < 0) throw new Error('لم يُعثر على عمود «الاسم» في الملف');
      var cell = function (r, k) { return col[k] == null ? '' : String(r[col[k]] == null ? '' : r[col[k]]).replace(/\s+/g, ' ').trim(); };
      var phone = function (v) { return latinDigits(v).replace(/[^0-9+]/g, ''); };
      var rows = aoa.slice(hi + 1).map(function (r) {
        var name = cell(r, 'name');
        if (!name || /^\d+$/.test(name)) return null;
        var hit = S.teachers.filter(function (t) { return norm(t.name) === norm(name); })[0] || null;
        return { name: name, job: cell(r, 'job'), cat: parseStaffCat(cell(r, 'cat')) || 'هيئة تدريس', phone: phone(cell(r, 'phone')), wa: phone(cell(r, 'wa')), match: hit };
      }).filter(Boolean);
      if (!rows.length) throw new Error('لا توجد صفوف بأسماء في الملف');
      ui.staffImp = { file: file.name, rows: rows, busy: false };
      render();
      window.scrollTo(0, 0);
    } catch (err) {
      toast(err.message, true);
    }
  }

  function staffImportHtml() {
    var imp = ui.staffImp, add = imp.rows.filter(function (r) { return !r.match; }).length;
    return '<div class="card"><h2>استيراد العاملين من «' + esc(imp.file) + '»</h2>' +
      '<p class="hint">جديد: ' + add + ' · موجود (تُحدَّث فئته ومسماه وأرقامه): ' + (imp.rows.length - add) + '. راجع الأسماء قبل الحفظ.</p>' +
      '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الاسم</th><th>الفئة</th><th>المسمى الوظيفي</th><th>الجوال</th><th>واتساب</th><th>الحالة</th></tr></thead><tbody>' +
      imp.rows.map(function (r, i) {
        return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(r.name) + '</b></td><td>' + esc(r.cat) + '</td><td>' + esc(r.job) + '</td>' +
          '<td dir="ltr" style="text-align:right">' + esc(r.phone || '—') + '</td><td dir="ltr" style="text-align:right">' + esc(r.wa || '—') + '</td>' +
          '<td>' + (r.match ? '<span class="badge part">تحديث</span>' : '<span class="badge paid">جديد</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="actions"><button type="button" class="btn primary" data-staffimpsave' + (imp.busy ? ' disabled' : '') + '>' + (imp.busy ? 'جارٍ الحفظ…' : 'حفظ ' + imp.rows.length + ' عاملًا') + '</button>' +
      '<button type="button" class="btn" data-staffimpcancel>إلغاء</button></div></div>';
  }

  async function saveStaffImport() {
    var imp = ui.staffImp, done = 0, failed = [];
    imp.busy = true;
    render();
    for (var i = 0; i < imp.rows.length; i++) {
      var r = imp.rows[i], teaching = TEACHING_CATS.indexOf(r.cat) > -1;
      var data = { name: r.name, category: r.cat, job_title: r.job, phone: r.phone, whatsapp: r.wa };
      var res;
      if (r.match) {
        if (teaching && !r.match.subject && r.job) data.subject = r.job;
        res = await sb.from('teachers').update(data).eq('id', r.match.id);
        if (!res.error) Object.assign(r.match, data);
      } else {
        data.subject = teaching ? r.job : '';
        res = await sb.from('teachers').insert(data).select().single();
        if (!res.error) { res.data.ratings = res.data.ratings || {}; S.teachers.push(res.data); }
      }
      if (res.error) failed.push(r.name); else done++;
    }
    S.teachers.sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); });
    ui.staffImp = null;
    render();
    if (failed.length) alert('حُفظ ' + done + '، وتعذّر: ' + failed.join('، ')); else toast('حُفظ ' + done + ' عاملًا');
  }

  // هيئة التدريس إلى «تسجيل الغياب من المعلمين» (روابط الغياب وبوت الواتساب): من ليس فيه بالاسم ولا بالرقم
  async function staffToAbsence() {
    var r = await sb.from('attendance_tokens').select('*');
    if (r.error) return alert('تسجيل الغياب من المعلمين غير مفعَّل بعد: شغّل الملف supabase/attendance_links.sql في محرر SQL.');
    var have = r.data || [], last = function (p) { return latinDigits(String(p || '')).replace(/\D/g, '').slice(-9); };
    var list = S.teachers.filter(function (t) {
      if (staffCat(t) !== 'هيئة تدريس' || !realStaff(t)) return false;
      var num = last(t.whatsapp || t.phone);
      return !have.some(function (h) { return norm(h.name) === norm(t.name) || (num.length >= 8 && last(h.phone) === num); });
    });
    if (!list.length) return toast('كل هيئة التدريس مضافون إلى تسجيل الغياب');
    if (!confirm('إضافة ' + list.length + ' من هيئة التدريس إلى «تسجيل الغياب من المعلمين»؟\nيُستخدم رقم الواتساب، وإن لم يوجد فرقم الجوال:\n\n' + list.map(function (t) { return t.name; }).join('\n'))) return;
    var rows = list.map(function (t) { return { name: t.name, phone: latinDigits(String(t.whatsapp || t.phone || '')).replace(/[^0-9+]/g, '') }; });
    var ins = await sb.from('attendance_tokens').insert(rows);
    if (ins.error) return fail(ins.error);
    S.attLinks = null; // تُجلب من جديد عند فتح شاشة الحضور
    toast('أُضيف ' + rows.length + ' إلى تسجيل الغياب — روابطهم في «الحضور والغياب»');
  }


  /* ---------- ملفات العاملين ----------
     السير الذاتية والشهادات وغيرها في Cloudflare R2 عبر دالة staff-files (روابط مؤقتة)، وجدول staff_files سجل لكل ملف.
     تظهر في بطاقة العامل عند تعديله، للمدير العام والمدير */

  var SF_KINDS = { cv: 'سيرة ذاتية', cv_all: 'سيرة ذاتية وملحقات', degree: 'شهادة جامعية', experience: 'شهادة خبرة', course: 'دورة تدريبية', id: 'هوية', contract: 'عقد', other: 'أخرى' };

  async function loadStaffFiles(id) {
    var r = await sb.from('staff_files').select('*').eq('staff_id', id).order('uploaded_at', { ascending: false });
    S.sfMissing = !!r.error;
    S.sfFiles = { id: id, rows: r.data || [] };
    render();
  }
  function sfSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' م.ب' : Math.max(1, Math.round(n / 1024)) + ' ك.ب'; }

  function staffFilesHtml(t) {
    if (!S.sfFiles || S.sfFiles.id !== t.id) { if (!ui.sfLoading) { ui.sfLoading = true; loadStaffFiles(t.id).then(function () { ui.sfLoading = false; }); } return '<div class="card empty">جارٍ تحميل الملفات…</div>'; }
    if (S.sfMissing) return '<div class="card empty">ملفات العاملين تحتاج إلى جدول جديد: شغّل الملف <code dir="ltr">supabase/staff_files.sql</code> في محرر SQL، وانشر الدالة <code dir="ltr">staff-files</code>.</div>';
    var rows = S.sfFiles.rows, busy = ui.sfBusy;
    return '<div class="card" id="staff-files"><h2 style="margin-top:0">ملفات ' + esc(t.name) + ' (' + rows.length + ')</h2>' +
      (rows.length ? '<div class="table-wrap"><table class="grid"><thead><tr><th>النوع</th><th>الملف</th><th>ملاحظة</th><th>الحجم</th><th>الرفع</th><th></th></tr></thead><tbody>' +
        rows.map(function (f) {
          return '<tr><td><span class="badge part">' + esc(SF_KINDS[f.kind] || f.kind) + '</span></td><td><b>' + esc(f.name) + '</b></td><td>' + esc(f.note || '') + '</td>' +
            '<td style="white-space:nowrap">' + (f.size ? sfSize(f.size) : '') + '</td><td style="white-space:nowrap">' + dmy(String(f.uploaded_at).slice(0, 10)) + '</td>' +
            '<td><div class="acts"><button type="button" class="btn" data-sfopen="' + f.id + '">فتح</button><button type="button" class="btn" data-sfdown="' + f.id + '">تنزيل</button>' +
            (isAdmin() || isManager() ? '<button type="button" class="btn danger" data-sfdel="' + f.id + '">حذف</button>' : '') + '</div></td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">لا ملفات بعد.</div>') +
      '<div class="toolbar" style="align-items:center;margin-top:10px">' +
        '<select id="sf-kind" style="width:auto">' + Object.keys(SF_KINDS).map(function (k) { return '<option value="' + k + '">' + SF_KINDS[k] + '</option>'; }).join('') + '</select>' +
        '<input id="sf-note" placeholder="ملاحظة (اختياري)" style="max-width:240px">' +
        '<button type="button" class="btn primary" data-sfpick' + (busy ? ' disabled' : '') + '>' + (busy ? esc(busy) : 'رفع ملفات…') + '</button>' +
        '<input type="file" id="sf-input" multiple hidden accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.heic"></div>' +
      '<p class="hint">PDF أو Word أو صور، حتى 50 ميجابايت للملف. تُحفظ في مخزن الأكاديمية على Cloudflare R2، ولا يفتحها إلا المدير العام والمدير.</p></div>';
  }

  async function sfUpload(t, files) {
    var kind = (document.getElementById('sf-kind') || {}).value || 'other', note = ((document.getElementById('sf-note') || {}).value || '').trim(), done = 0;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      ui.sfBusy = 'جارٍ رفع ' + (i + 1) + ' من ' + files.length + '…'; render();
      var r = await sb.functions.invoke('staff-files', { body: { action: 'upload', staff_id: t.id, name: file.name, size: file.size, mime: file.type, kind: kind, note: note } });
      if (r.error || !r.data || !r.data.url) { toast('تعذّر رفع «' + file.name + '»: ' + ((r.error && r.error.message) || 'خطأ'), true); continue; }
      var ok = false;
      try { ok = (await fetch(r.data.url, { method: 'PUT', body: file })).ok; } catch (err) { ok = false; }
      if (!ok) { await sb.functions.invoke('staff-files', { body: { action: 'delete', id: r.data.id } }); toast('تعذّر رفع «' + file.name + '» إلى المخزن', true); continue; }
      done++;
    }
    ui.sfBusy = null;
    await loadStaffFiles(t.id);
    if (done) toast('رُفع ' + done + ' ملف');
  }

  async function sfOpen(id, download) {
    // نافذة تُفتح فورًا عند الضغط (لا يحجبها المتصفح)، ثم يوضع فيها الرابط المؤقت
    var w = download ? null : window.open('', '_blank');
    var r = await sb.functions.invoke('staff-files', { body: { action: 'open', id: id, download: !!download } });
    if (r.error || !r.data) { if (w) w.close(); return toast('تعذّر فتح الملف: ' + (r.error ? r.error.message : ''), true); }
    if (w) w.location = r.data.url; else location.href = r.data.url;
  }

  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/staff' || !canView()) return;
    var el, t = ui.editTeacher && ui.editTeacher !== 'new' ? find(ui.editTeacher) : null;
    if (!t && (el = e.target.closest('[data-sfopen]'))) return sfOpen(el.getAttribute('data-sfopen'));
    if (!t) return;
    if (e.target.closest('[data-sfpick]')) return document.getElementById('sf-input').click();
    if ((el = e.target.closest('[data-sfopen]'))) return sfOpen(el.getAttribute('data-sfopen'));
    if ((el = e.target.closest('[data-sfdown]'))) return sfOpen(el.getAttribute('data-sfdown'), true);
    if ((el = e.target.closest('[data-sfdel]'))) {
      var f = S.sfFiles.rows.filter(function (x) { return x.id === el.getAttribute('data-sfdel'); })[0];
      if (!f || !confirm('حذف الملف «' + f.name + '» نهائيًا من المخزن؟')) return;
      var r = await sb.functions.invoke('staff-files', { body: { action: 'delete', id: f.id } });
      if (r.error) return toast('تعذّر الحذف: ' + r.error.message, true);
      await loadStaffFiles(t.id);
      toast('حُذف الملف');
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id !== 'sf-input' || location.hash !== '#/staff') return;
    var t = ui.editTeacher && ui.editTeacher !== 'new' ? find(ui.editTeacher) : null;
    if (t && e.target.files.length) sfUpload(t, Array.prototype.slice.call(e.target.files));
  });

  /* ----- رفع مجلد ملفات العاملين دفعة واحدة -----
     يُختار المجلد من الجهاز: كل مجلد فرعي باسم موظف، أو ملف مفرد باسمه. يُقترح الموظف ونوع الملف، وتُراجَع القائمة قبل الرفع،
     ويُتخطّى ما سبق رفعه (نفس الاسم والحجم للموظف نفسه) */

  function sfTokens(x) { return norm(x).replace(/[_\-.()]+/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1 && ['عبد', 'ابو', 'أبو', 'بن', 'ال'].indexOf(w) < 0; }); }
  function sfMatchStaff(label) {
    var lt = sfTokens(label), best = null, bestScore = 0;
    if (!lt.length) return '';
    S.teachers.forEach(function (t) {
      var tt = sfTokens(t.name), hit = lt.filter(function (w) { return tt.indexOf(w) > -1; }).length;
      // الاسم الأول يجب أن يطابق، ثم كلمة أخرى على الأقل (أو الاسم كله إن كان من كلمة واحدة)
      if (!hit || tt[0] !== lt[0] && lt.indexOf(tt[0]) < 0) return;
      var score = hit / lt.length + hit / tt.length;
      if ((hit >= 2 || lt.length === 1) && score > bestScore) { bestScore = score; best = t.id; }
    });
    return best || '';
  }
  function sfGuessKind(name, loose) {
    var n = norm(name);
    if (/سير|cv|resume|ذاتي/i.test(n)) return 'cv';
    if (/كشف درجات|جامع|بكالوريوس|ماجستير|دبلوم|ثانوي|شهادة الجامعة/.test(n)) return 'degree';
    if (/خبر/.test(n)) return 'experience';
    if (/دور/.test(n)) return 'course';
    if (/شهاد/.test(n)) return 'degree';
    return loose ? 'cv_all' : 'other';
  }

  async function sfBulkPick(files) {
    var all = await sb.from('staff_files').select('staff_id, name, size');
    if (all.error) return toast('شغّل الملف supabase/staff_files.sql أولًا', true);
    var have = {};
    (all.data || []).forEach(function (f) { have[f.staff_id + '|' + f.name + '|' + f.size] = 1; });
    var rows = Array.prototype.slice.call(files).filter(function (f) { return f.size > 0 && !/^\.|thumbs\.db$|desktop\.ini$/i.test(f.name); }).map(function (f) {
      var parts = (f.webkitRelativePath || f.name).split('/'), loose = parts.length <= 2, label = loose ? f.name.replace(/\.[^.]+$/, '') : parts[parts.length - 2];
      var sid = sfMatchStaff(label);
      return { file: f, label: label, path: parts.slice(1).join('/'), staff: sid, kind: sfGuessKind(f.name, loose), on: !!sid, dup: false };
    });
    rows.forEach(function (r) { r.dup = !!have[r.staff + '|' + r.file.name + '|' + r.file.size]; if (r.dup) r.on = false; });
    rows.sort(function (a, b) { return a.label.localeCompare(b.label, 'ar') || a.path.localeCompare(b.path); });
    ui.sfBulk = { rows: rows, busy: null };
    render();
  }

  function sfBulkHtml() {
    var B = ui.sfBulk, on = B.rows.filter(function (r) { return r.on && r.staff; }), size = on.reduce(function (t, r) { return t + r.file.size; }, 0);
    var staffOpts = function (cur) {
      return '<option value="">— لم يُطابَق —</option>' + S.teachers.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); })
        .map(function (t) { return '<option value="' + t.id + '"' + (t.id === cur ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('');
    };
    var kindOpts = function (cur) { return Object.keys(SF_KINDS).map(function (k) { return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + SF_KINDS[k] + '</option>'; }).join(''); };
    var unmatched = B.rows.filter(function (r) { return !r.staff; }).length;
    return '<div class="card"><h2 style="margin-top:0">رفع مجلد ملفات العاملين — ' + B.rows.length + ' ملف</h2>' +
      '<p class="hint">راجع الموظف ونوع كل ملف، وأزل علامة ما لا تريد رفعه. ' + (unmatched ? '<b>' + unmatched + ' ملف لم يُطابَق بموظف</b>: اختره من القائمة أو اتركه. ' : '') +
        'الملفات المرفوعة سابقًا (الاسم والحجم نفسهما) متروكة.</p>' +
      '<div class="table-wrap" style="max-height:65vh;overflow:auto"><table class="grid"><thead><tr><th></th><th>المجلد / الاسم</th><th>الملف</th><th>الحجم</th><th>الموظف</th><th>النوع</th></tr></thead><tbody>' +
      B.rows.map(function (r, i) {
        return '<tr' + (r.dup ? ' style="color:var(--muted)"' : '') + '><td><input type="checkbox" data-sfbon="' + i + '"' + (r.on ? ' checked' : '') + '></td><td><b>' + esc(r.label) + '</b></td>' +
          '<td>' + esc(r.path) + (r.dup ? ' <span class="badge paid">مرفوع سابقًا</span>' : '') + '</td><td style="white-space:nowrap">' + sfSize(r.file.size) + '</td>' +
          '<td><select data-sfbstaff="' + i + '" style="' + (r.staff ? '' : 'border-color:var(--danger,#b91c1c)') + '">' + staffOpts(r.staff) + '</select></td>' +
          '<td><select data-sfbkind="' + i + '">' + kindOpts(r.kind) + '</select></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="actions"><button type="button" class="btn primary" data-sfbgo' + (on.length && !B.busy ? '' : ' disabled') + '>' + (B.busy ? esc(B.busy) : 'رفع ' + on.length + ' ملف (' + sfSize(size) + ')') + '</button>' +
        '<button type="button" class="btn" data-sfbcancel' + (B.busy ? ' disabled' : '') + '>إلغاء</button></div></div>';
  }

  async function sfBulkGo() {
    var B = ui.sfBulk, list = B.rows.filter(function (r) { return r.on && r.staff; }), done = 0, failed = [];
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      B.busy = 'جارٍ رفع ' + (i + 1) + ' من ' + list.length + '…'; render();
      var r = await sb.functions.invoke('staff-files', { body: { action: 'upload', staff_id: x.staff, name: x.file.name, size: x.file.size, mime: x.file.type, kind: x.kind, note: x.label } });
      var ok = false;
      if (!r.error && r.data && r.data.url) {
        try { ok = (await fetch(r.data.url, { method: 'PUT', body: x.file })).ok; } catch (err) { ok = false; }
        if (!ok) await sb.functions.invoke('staff-files', { body: { action: 'delete', id: r.data.id } });
      }
      if (ok) { done++; x.on = false; x.dup = true; } else failed.push(x.file.name);
    }
    B.busy = null;
    if (!failed.length) ui.sfBulk = null;
    S.sfFiles = null;
    render();
    toast('رُفع ' + done + ' ملف' + (failed.length ? '، وتعذّر ' + failed.length + ': ' + failed.slice(0, 3).join('، ') : ''), failed.length > 0);
  }

  document.addEventListener('click', function (e) {
    if (location.hash !== '#/staff' || !canView()) return;
    if (e.target.closest('[data-sfbulk]')) return document.getElementById('sf-dir').click();
    if (!ui.sfBulk) return;
    if (e.target.closest('[data-sfbgo]')) return sfBulkGo();
    if (e.target.closest('[data-sfbcancel]')) { ui.sfBulk = null; return render(); }
  });
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/staff') return;
    if (e.target.id === 'sf-dir') { if (e.target.files.length) sfBulkPick(e.target.files); return; }
    if (!ui.sfBulk) return;
    var el, R = ui.sfBulk.rows;
    if ((el = e.target.closest('[data-sfbon]'))) { R[+el.getAttribute('data-sfbon')].on = el.checked; return render(); }
    if ((el = e.target.closest('[data-sfbstaff]'))) { var r = R[+el.getAttribute('data-sfbstaff')]; r.staff = el.value; r.on = !!el.value; return render(); }
    if ((el = e.target.closest('[data-sfbkind]'))) { R[+el.getAttribute('data-sfbkind')].kind = el.value; }
  });

  /* ----- بطاقة المؤهلات: قراءة ملفات الموظف (دالة read-staff-cv) ومراجعتها -----
     صفحات PDF تُرسم صورًا هنا، وملفات Word يُستخرج نصها هنا، ثم تُرسل كلها مرة واحدة؛ والنتيجة تُعرض للمراجعة ثم تُحفظ في staff_profiles */

  var SP_FIELDS = [['full_name', 'الاسم في الوثائق'], ['degree', 'أعلى مؤهل'], ['major', 'التخصص'], ['university', 'الجامعة'], ['grad_year', 'سنة التخرج'], ['grade', 'التقدير'],
    ['experience_years', 'سنوات الخبرة'], ['birth_date', 'تاريخ الميلاد'], ['phone', 'الجوال'], ['email', 'البريد'], ['address', 'العنوان']];
  var SP_LISTS = [['other_degrees', 'مؤهلات أخرى', ['degree', 'major', 'university', 'year']], ['experience', 'الخبرات', ['place', 'role', 'from', 'to']],
    ['courses', 'الدورات'], ['languages', 'اللغات'], ['skills', 'المهارات']];
  var SP_HAS = [['cv', 'سيرة ذاتية'], ['degree_certificate', 'شهادة جامعية'], ['transcript', 'كشف درجات'], ['experience_letter', 'شهادة خبرة'], ['id', 'هوية']];

  async function loadStaffProfiles() {
    var r = await sb.from('staff_profiles').select('*');
    S.spMissing = !!r.error;
    S.spRows = {};
    (r.data || []).forEach(function (p) { S.spRows[p.staff_id] = p; });
    render();
  }
  function loadMammoth() {
    if (window.mammoth) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
      sc.onload = resolve;
      sc.onerror = function () { reject(new Error('تعذر تحميل مكتبة قراءة Word')); };
      document.head.appendChild(sc);
    });
  }

  // أجزاء الإرسال من ملفات الموظف: صورة لكل صفحة (بدقة أقل من الاستمارات لكثرة الصفحات)، ونص لملفات Word. الحد 30 صفحة
  async function spParts(files, step) {
    var parts = [], skipped = [], keep = SCAN_MAX_SIDE;
    SCAN_MAX_SIDE = 1600;
    try {
      for (var i = 0; i < files.length && parts.length < 30; i++) {
        var f = files[i];
        step('تجهيز «' + f.name + '» (' + (i + 1) + ' من ' + files.length + ')…');
        var r = await sb.functions.invoke('staff-files', { body: { action: 'open', id: f.id } });
        if (r.error || !r.data) { skipped.push(f.name); continue; }
        var blob = await (await fetch(r.data.url)).blob(), file = new File([blob], f.name, { type: f.mime || blob.type });
        try {
          if (/\.docx$/i.test(f.name)) {
            await loadMammoth();
            var t = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
            parts.push({ file: f.name, text: t.value });
          } else if (/\.pdf$/i.test(f.name) || /^image\//.test(file.type)) {
            (await scanFilePages(file)).forEach(function (p, n) { if (parts.length < 30) parts.push({ file: f.name, page: n + 1, media_type: p.media_type, data: p.data }); });
          } else skipped.push(f.name);
        } catch (err) { skipped.push(f.name); }
      }
    } finally { SCAN_MAX_SIDE = keep; }
    return { parts: parts, skipped: skipped };
  }

  async function spRead(t, quiet) {
    var files = (S.sfFiles && S.sfFiles.id === t.id ? S.sfFiles.rows : (await sb.from('staff_files').select('*').eq('staff_id', t.id)).data) || [];
    if (!files.length) { if (!quiet) toast('لا ملفات لهذا الموظف', true); return false; }
    var step = function (m) { ui.spBusy = (ui.spPrefix || '') + m; render(); };
    try {
      var P = await spParts(files, step);
      if (!P.parts.length) throw new Error('تعذرت قراءة الملفات' + (P.skipped.length ? ': ' + P.skipped.join('، ') : ''));
      step('قراءة ' + P.parts.length + ' صفحة بالذكاء الاصطناعي…');
      var r = await sb.functions.invoke('read-staff-cv', { body: { name: t.name, parts: P.parts } });
      if (r.error || !r.data || !r.data.card) throw new Error((r.error && r.error.message) || (r.data && r.data.error) || 'لم تُرجع القراءة نتيجة');
      var row = { staff_id: t.id, data: r.data.card, files: (r.data.card.pages || []), model: r.data.model, read_at: new Date().toISOString(), reviewed: false,
        updated_at: new Date().toISOString(), updated_by: S.email || '' };
      var w = await sb.from('staff_profiles').upsert(row, { onConflict: 'staff_id' });
      if (w.error) throw w.error;
      (S.spRows || (S.spRows = {}))[t.id] = Object.assign({}, (S.spRows || {})[t.id], row);
      ui.spBusy = null; render();
      if (!quiet) toast('قُرئت الملفات — راجع بطاقة المؤهلات وصحّحها ثم اضغط «حفظ واعتماد»' + (P.skipped.length ? '. لم يُقرأ: ' + P.skipped.join('، ') : ''));
      return true;
    } catch (err) {
      ui.spBusy = null; render();
      toast('قراءة ملفات ' + t.name + ': ' + (err.message || err), true);
      return false;
    }
  }

  function spListText(k, v) {
    var L = SP_LISTS.filter(function (x) { return x[0] === k; })[0];
    return (Array.isArray(v) ? v : []).map(function (it) { return L[2] ? L[2].map(function (f) { return (it && it[f]) || ''; }).join(' | ') : String(it || ''); }).filter(function (x) { return x.replace(/[\s|]/g, ''); }).join('\n');
  }
  function spListParse(k, text) {
    var L = SP_LISTS.filter(function (x) { return x[0] === k; })[0];
    return text.split('\n').map(function (x) { return x.trim(); }).filter(Boolean).map(function (line) {
      if (!L[2]) return line;
      var p = line.split('|').map(function (x) { return x.trim(); }), o = {};
      L[2].forEach(function (f, i) { o[f] = p[i] || ''; });
      return o;
    });
  }

  function staffProfileHtml(t) {
    if (S.spRows == null) { if (!ui.spLoading) { ui.spLoading = true; loadStaffProfiles().then(function () { ui.spLoading = false; }); } return ''; }
    if (S.spMissing) return '<div class="card empty">بطاقة المؤهلات تحتاج إلى جدول جديد: شغّل الملف <code dir="ltr">supabase/staff_profiles.sql</code> وانشر الدالة <code dir="ltr">read-staff-cv</code>.</div>';
    var p = S.spRows[t.id], d = (p && p.data) || {}, uns = Array.isArray(d.unsure) ? d.unsure : [], busy = ui.spBusy;
    var head = '<div class="toolbar" style="align-items:center;margin:0 0 8px"><h2 style="margin:0;flex:1">بطاقة المؤهلات</h2>' +
      (p ? '<span class="badge ' + (p.reviewed ? 'paid' : 'part') + '">' + (p.reviewed ? 'مراجَعة' : 'قراءة آلية — تحتاج مراجعة') + '</span>' : '') +
      '<button type="button" class="btn' + (p ? '' : ' primary') + '" data-spread' + (busy ? ' disabled' : '') + '>' + (busy ? esc(busy) : p ? 'إعادة قراءة الملفات' : 'قراءة الملفات واستخراج المؤهلات') + '</button></div>';
    if (!p) return '<div class="card">' + head + '<p class="hint">يقرأ البرنامج كل ملفات الموظف (السيرة والشهادات، بأي شكل) ويستخرج منها بطاقة موحّدة تراجعها قبل اعتمادها.</p></div>';
    var mark = function (k) { return uns.indexOf(k) > -1 ? ' style="border-color:#d97706;background:#fffbeb" title="غير مؤكد: راجعه في الملف"' : ''; };
    return '<div class="card" id="staff-profile">' + head +
      (d.summary ? '<p style="margin:0 0 8px"><textarea data-spf="summary" rows="2" style="width:100%">' + esc(d.summary) + '</textarea></p>' : '<input type="hidden" data-spf="summary" value="">') +
      '<div class="grid2">' + SP_FIELDS.map(function (f) {
        return '<div><label class="field">' + f[1] + (uns.indexOf(f[0]) > -1 ? ' <span class="badge part">غير مؤكد</span>' : '') + '</label><input data-spf="' + f[0] + '" value="' + esc(d[f[0]] || '') + '"' + mark(f[0]) + '></div>';
      }).join('') + '</div>' +
      SP_LISTS.map(function (L) {
        return '<label class="field">' + L[1] + (L[2] ? ' <span class="hint" style="margin:0">(سطر لكل بند: ' + (L[0] === 'experience' ? 'المكان | الوظيفة | من | إلى' : 'المؤهل | التخصص | الجامعة | السنة') + ')</span>' : ' <span class="hint" style="margin:0">(سطر لكل بند)</span>') + '</label>' +
          '<textarea data-spl="' + L[0] + '" rows="' + Math.min(8, Math.max(2, (d[L[0]] || []).length + 1)) + '" style="width:100%">' + esc(spListText(L[0], d[L[0]])) + '</textarea>';
      }).join('') +
      '<div class="toolbar" style="margin:8px 0">' + SP_HAS.map(function (h) { return '<label class="check"><input type="checkbox" data-sph="' + h[0] + '"' + (d.has && d.has[h[0]] ? ' checked' : '') + '> ' + h[1] + '</label>'; }).join('') + '</div>' +
      (Array.isArray(d.pages) && d.pages.length ? '<details><summary class="hint" style="cursor:pointer">محتوى الملفات صفحة صفحة (' + d.pages.length + ')</summary><ul style="margin:4px 0">' +
        d.pages.map(function (g) { return '<li>' + esc(g.file || '') + (g.page ? ' — ص ' + esc(g.page) : '') + ': ' + esc(g.what || '') + '</li>'; }).join('') + '</ul></details>' : '') +
      '<div class="actions"><button type="button" class="btn primary" data-spsave>حفظ واعتماد البطاقة</button></div>' + spCvHtml(p) +
      '<p class="hint">قُرئت ' + dmy(String(p.read_at || '').slice(0, 10)) + (p.updated_by ? ' · آخر حفظ: ' + esc(displayName(p.updated_by)) : '') + '. الحقول الملوّنة لم يتأكد منها القارئ.</p></div>';
  }

  // رابط السيرة الذاتية المنسّقة (cv.html): بعد اعتماد البطاقة، مغلق حتى يُفعَّل، ووسائل التواصل باختيار
  function cvLink(token) { return location.origin + location.pathname.replace(/[^\/]*$/, '') + 'cv.html?t=' + token; }
  function spCvHtml(p) {
    if (!p.reviewed) return '<p class="hint" style="margin-top:10px">بعد «حفظ واعتماد البطاقة» يمكن إنشاء رابط سيرة ذاتية منسّقة لهذا الموظف.</p>';
    if (!('cv_public' in p)) return '<p class="hint" style="margin-top:10px">لرابط السيرة الذاتية شغّل الملف <code dir="ltr">supabase/staff_cv.sql</code> ثم حدّث الصفحة.</p>';
    var on = p.cv_public && p.cv_token;
    return '<div style="border-top:1px solid var(--line,#e5e7eb);margin-top:12px;padding-top:10px"><div class="toolbar" style="align-items:center;margin:0">' +
      '<b style="flex:1">السيرة الذاتية برابط</b>' + (on ? '<span class="badge paid">الرابط مفعّل</span>' : '<span class="badge pending">لا رابط</span>') +
      '<label class="check"><input type="checkbox" data-cvcontact' + (p.cv_contact ? ' checked' : '') + '> إظهار الجوال والبريد والعنوان</label>' +
      (on ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(cvLink(p.cv_token)) + '">فتح</a><button type="button" class="btn" data-cvcopy>نسخ الرابط</button>' +
        '<button type="button" class="btn" data-cvoff>إيقاف</button><button type="button" class="btn danger" data-cvnew title="يتوقف الرابط القديم">رابط جديد</button>'
        : '<button type="button" class="btn primary" data-cvon>' + (p.cv_token ? 'تفعيل الرابط' : 'إنشاء رابط') + '</button>') + '</div>' +
      '<p class="hint" style="margin:4px 0 0">صفحة بتصميم الأكاديمية تُطبع PDF أيضًا. لا تظهر فيها إلا البطاقة المعتمدة، ولا يُعرض الجوال والبريد والعنوان وتاريخ الميلاد إلا إن اخترتها.</p></div>';
  }
  async function cvUpdate(t, patch, done) {
    var r = await sb.from('staff_profiles').update(patch).eq('staff_id', t.id);
    if (r.error) return fail(r.error);
    Object.assign(S.spRows[t.id], patch);
    render();
    if (done) toast(done);
  }
  // زر السيرة الذاتية في قائمة العاملين وتقرير المؤهلات: فتح ونسخ، أو إنشاء الرابط إن كانت البطاقة معتمدة
  function cvCell(id, onlyOpen) {
    var p = S.spRows && S.spRows[id];
    if (!p || !p.reviewed || !('cv_public' in p)) return '';
    if (p.cv_public && p.cv_token) return '<a class="btn" target="_blank" rel="noopener" href="' + esc(cvLink(p.cv_token)) + '">السيرة الذاتية</a>';
    return onlyOpen ? '' : '<button type="button" class="btn" data-cvmake="' + id + '">إنشاء رابط</button>';
  }
  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/staff' || !canView()) return;
    var el, p;
    if ((el = e.target.closest('[data-cvcopy2]'))) { p = S.spRows[el.getAttribute('data-cvcopy2')]; return copyText(cvLink(p.cv_token), 'نُسخ رابط السيرة الذاتية'); }
    if (e.target.closest('[data-cvmakeall]')) {
      var ids = Object.keys(S.spRows).filter(function (k) { var q = S.spRows[k]; return q.reviewed && 'cv_public' in q && !q.cv_token; });
      for (var i = 0; i < ids.length; i++) {
        var pt = { cv_public: true, cv_token: cvToken() }, w = await sb.from('staff_profiles').update(pt).eq('staff_id', ids[i]);
        if (w.error) return fail(w.error);
        Object.assign(S.spRows[ids[i]], pt);
      }
      render();
      return toast('أُنشئت ' + ids.length + ' روابط');
    }
    if ((el = e.target.closest('[data-cvmake]'))) {
      var id = el.getAttribute('data-cvmake'), patch = { cv_public: true, cv_token: S.spRows[id].cv_token || cvToken() };
      var r = await sb.from('staff_profiles').update(patch).eq('staff_id', id);
      if (r.error) return fail(r.error);
      Object.assign(S.spRows[id], patch);
      render();
      toast('أُنشئ رابط السيرة الذاتية');
    }
  });
  function cvToken() { var a = new Uint8Array(20); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  document.addEventListener('click', function (e) {
    if (location.hash !== '#/staff' || !canView()) return;
    var t = ui.editTeacher && ui.editTeacher !== 'new' ? find(ui.editTeacher) : null, p = t && S.spRows && S.spRows[t.id];
    if (!p) return;
    if (e.target.closest('[data-cvon]')) return cvUpdate(t, { cv_public: true, cv_token: p.cv_token || cvToken() }, 'فُعّل رابط السيرة الذاتية');
    if (e.target.closest('[data-cvoff]')) return cvUpdate(t, { cv_public: false }, 'أُوقف الرابط');
    if (e.target.closest('[data-cvnew]')) { if (confirm('إلغاء الرابط الحالي وإنشاء غيره؟ الرابط القديم يتوقف فورًا.')) cvUpdate(t, { cv_public: true, cv_token: cvToken() }, 'أُنشئ رابط جديد'); return; }
    if (e.target.closest('[data-cvcopy]')) return copyText(cvLink(p.cv_token), 'نُسخ رابط السيرة الذاتية');
  });
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/staff' || !e.target.closest('[data-cvcontact]')) return;
    var t = ui.editTeacher && ui.editTeacher !== 'new' ? find(ui.editTeacher) : null;
    if (t && S.spRows && S.spRows[t.id]) cvUpdate(t, { cv_contact: e.target.checked });
  });

  async function spSave(t) {
    var box = document.getElementById('staff-profile'), p = S.spRows[t.id], d = Object.assign({}, p.data);
    box.querySelectorAll('[data-spf]').forEach(function (el) { d[el.getAttribute('data-spf')] = el.value.trim(); });
    box.querySelectorAll('[data-spl]').forEach(function (el) { d[el.getAttribute('data-spl')] = spListParse(el.getAttribute('data-spl'), el.value); });
    d.has = {}; box.querySelectorAll('[data-sph]').forEach(function (el) { d.has[el.getAttribute('data-sph')] = el.checked; });
    d.unsure = [];
    var row = { staff_id: t.id, data: d, reviewed: true, updated_at: new Date().toISOString(), updated_by: S.email || '' };
    // اعتماد البطاقة يُنشئ رابط السيرة الذاتية ويفعّله مباشرة (إلا إن أوقفه أحد عمدًا)
    if ('cv_public' in p && !(p.cv_token && !p.cv_public)) { row.cv_token = p.cv_token || cvToken(); row.cv_public = true; }
    var r = await sb.from('staff_profiles').update(row).eq('staff_id', t.id);
    if (r.error) return fail(r.error);
    Object.assign(p, row);
    render();
    toast(row.cv_public ? 'حُفظت بطاقة المؤهلات، والسيرة الذاتية جاهزة برابط' : 'حُفظت بطاقة المؤهلات');
  }

  // تقرير مؤهلات العاملين: جدول، وقراءة دفعة لمن لم تُقرأ ملفاته، وExcel
  function spReportHtml() {
    if (S.spRows == null) { loadStaffProfiles(); return '<div class="card empty">جارٍ التحميل…</div>'; }
    if (S.spMissing) return '<div class="card empty">شغّل الملف <code dir="ltr">supabase/staff_profiles.sql</code> ثم حدّث الصفحة.</div>';
    var list = S.teachers.filter(function (x) { return !x.not_staff; }).slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); });
    var q = norm(ui.spQ || '');
    var shown = list.filter(function (x) { var d = (S.spRows[x.id] || {}).data || {}; return !q || norm(x.name + ' ' + (d.degree || '') + ' ' + (d.major || '') + ' ' + (d.university || '')).indexOf(q) > -1; });
    var unread = list.filter(function (x) { return !S.spRows[x.id]; }).length;
    return '<div class="card"><div class="toolbar" style="align-items:center;margin:0 0 8px"><h2 style="margin:0;flex:1">مؤهلات العاملين</h2>' +
        '<input type="search" id="sp-q" placeholder="الاسم أو المؤهل أو التخصص" value="' + esc(ui.spQ || '') + '" style="max-width:240px">' +
        '<button type="button" class="btn primary" data-spall' + (ui.spBusy || !unread ? ' disabled' : '') + ' title="يقرأ ملفات من لهم ملفات ولم تُقرأ بعد">' + (ui.spBusy ? esc(ui.spBusy) : 'قراءة ملفات من لم تُقرأ ملفاته (' + unread + ')') + '</button>' +
        (function () { var n = Object.keys(S.spRows).filter(function (k) { var p = S.spRows[k]; return p.reviewed && 'cv_public' in p && !p.cv_token; }).length; return n ? '<button type="button" class="btn" data-cvmakeall>إنشاء روابط السيرة لكل البطاقات المعتمدة (' + n + ')</button>' : ''; })() + '<button type="button" class="btn" data-spxlsx>تصدير Excel</button><button type="button" class="btn" data-spclose>رجوع</button></div>' +
      '<div class="table-wrap"><table class="grid"><thead><tr><th>الموظف</th><th>أعلى مؤهل</th><th>التخصص</th><th>الجامعة</th><th>التخرج</th><th>الخبرة</th><th>الوثائق</th><th>الحالة</th><th>السيرة الذاتية</th></tr></thead><tbody>' +
      shown.map(function (x) {
        var p = S.spRows[x.id], d = (p && p.data) || {}, has = d.has || {};
        return '<tr><td><button type="button" class="btn link" style="padding:0" data-tedit="' + x.id + '">' + esc(x.name) + '</button></td><td>' + esc(d.degree || '') + '</td><td>' + esc(d.major || '') + '</td><td>' + esc(d.university || '') + '</td>' +
          '<td>' + esc(d.grad_year || '') + '</td><td>' + esc(d.experience_years ? d.experience_years + ' سنة' : '') + '</td>' +
          '<td>' + (p ? SP_HAS.filter(function (h) { return has[h[0]]; }).map(function (h) { return h[1]; }).join('، ') || '—' : '') + '</td>' +
          '<td>' + (!p ? '<span class="badge pending">لم تُقرأ</span>' : p.reviewed ? '<span class="badge paid">مراجَعة</span>' : '<span class="badge part">تحتاج مراجعة</span>') + '</td><td>' + cvCell(x.id) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  async function spReadAll() {
    var have = await sb.from('staff_files').select('staff_id');
    var withFiles = {};
    (have.data || []).forEach(function (f) { withFiles[f.staff_id] = 1; });
    var todo = S.teachers.filter(function (x) { return withFiles[x.id] && !S.spRows[x.id]; });
    if (!todo.length) return toast('لا موظف له ملفات لم تُقرأ');
    if (!confirm('قراءة ملفات ' + todo.length + ' موظف؟ تستغرق دقيقة تقريبًا لكل موظف، فأبقِ الصفحة مفتوحة.')) return;
    var ok = 0;
    for (var i = 0; i < todo.length; i++) { ui.spPrefix = (i + 1) + '/' + todo.length + ' ' + todo[i].name + ': '; if (await spRead(todo[i], true)) ok++; }
    ui.spPrefix = '';
    toast('قُرئت ملفات ' + ok + ' من ' + todo.length + ' موظف. راجع كل بطاقة واعتمدها.');
  }

  async function spExport() {
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      var rows = S.teachers.filter(function (x) { return !x.not_staff; }).slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); }).map(function (x, i) {
        var p = S.spRows[x.id], d = (p && p.data) || {}, has = d.has || {};
        return [i + 1, x.name, d.degree || '', d.major || '', d.university || '', d.grad_year || '', d.grade || '', d.experience_years || '', spListText('experience', d.experience).replace(/\n/g, '؛ '),
          spListText('other_degrees', d.other_degrees).replace(/\n/g, '؛ '), (d.courses || []).join('؛ '), (d.languages || []).join('، '),
          SP_HAS.filter(function (h) { return has[h[0]]; }).map(function (h) { return h[1]; }).join('، '), !p ? 'لم تُقرأ' : p.reviewed ? 'مراجَعة' : 'تحتاج مراجعة'];
      });
      var ws = XLSX.utils.aoa_to_sheet([[schoolName()], ['مؤهلات العاملين — ' + dmy(todayISO())], [],
        ['م', 'الموظف', 'أعلى مؤهل', 'التخصص', 'الجامعة', 'سنة التخرج', 'التقدير', 'سنوات الخبرة', 'الخبرات', 'مؤهلات أخرى', 'الدورات', 'اللغات', 'الوثائق', 'الحالة']].concat(rows));
      ws['!cols'] = [5, 28, 14, 20, 24, 10, 10, 10, 50, 40, 40, 16, 30, 12].map(function (w) { return { wch: w }; });
      XLSX.utils.book_append_sheet(wb, ws, 'المؤهلات');
      XLSX.writeFile(wb, 'مؤهلات-العاملين-' + todayISO() + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  document.addEventListener('click', function (e) {
    if (location.hash !== '#/staff' || !canView()) return;
    var t = ui.editTeacher && ui.editTeacher !== 'new' ? find(ui.editTeacher) : null;
    if (e.target.closest('[data-spreport]')) { ui.spReport = true; S.spRows = null; return render(); }
    if (e.target.closest('[data-spclose]')) { ui.spReport = false; return render(); }
    if (e.target.closest('[data-spall]')) return spReadAll();
    if (e.target.closest('[data-spxlsx]')) return spExport();
    if (t && e.target.closest('[data-spread]')) return spRead(t);
    if (t && e.target.closest('[data-spsave]')) return spSave(t);
  });
  document.addEventListener('input', function (e) {
    if (location.hash !== '#/staff' || e.target.id !== 'sp-q') return;
    ui.spQ = e.target.value;
    var pos = e.target.selectionStart;
    render();
    var q = document.getElementById('sp-q');
    if (q) { q.focus(); q.setSelectionRange(pos, pos); }
  });

  /* ----- بطاقة الموظف: تُفتح بالضغط على اسمه في قائمة العاملين -----
     الدوام في فترة (من بداية العام حتى اليوم افتراضيًا): حضور وغياب وإجازات ومأموريات وتأخير، والمؤهلات، والسيرة الذاتية، والملفات */

  async function loadStaffCard(id, from, to) {
    var at = await fetchAll(function () { return sb.from('staff_attendance').select('day, status, time_in, time_out').eq('teacher_id', id).gte('day', from).lte('day', to).order('day'); });
    var fl = await sb.from('staff_files').select('*').eq('staff_id', id).order('uploaded_at', { ascending: false });
    if (!S.saHours) { var h = await sb.from('staff_hours').select('*').eq('id', 1).maybeSingle(); if (!h.error) S.saHours = saParseHours(h.data); }
    ui.tCard = Object.assign(ui.tCard || {}, { id: id, from: from, to: to, att: at, files: fl.error ? null : fl.data || [], loaded: id + from + to });
    render();
  }

  function staffCardHtml() {
    var c = ui.tCard, t = find(c.id);
    if (!t) { ui.tCard = null; return ''; }
    if (c.loaded !== c.id + c.from + c.to) { loadStaffCard(c.id, c.from, c.to); return '<div class="card empty">جارٍ تحميل بطاقة ' + esc(t.name) + '…</div>'; }
    var sh = shiftOf(t), n = { present: 0, absent: 0, leave: 0, mission: 0 }, lateDays = 0, lateMins = 0;
    (c.att || []).forEach(function (r) { n[r.status] = (n[r.status] || 0) + 1; var l = saLate(r, sh); if (l) { lateDays++; lateMins += l; } });
    var p = S.spRows && S.spRows[t.id], d = (p && p.data) || {};
    var stat = function (lbl, num, sub, color) { return '<div class="card stat"><span class="lbl">' + lbl + '</span><span class="num"' + (color ? ' style="color:' + color + '"' : '') + '>' + num + '</span><span class="sub">' + sub + '</span></div>'; };
    var info = [['الفئة', S.staffMissing ? '' : staffCat(t)], ['المسمى الوظيفي', t.job_title], ['المباحث', t.subject], ['الصفوف', t.classes], ['الجوال', t.phone], ['الواتساب', t.whatsapp],
      ['تاريخ التعيين', t.hire_date ? dmy(t.hire_date) : ''], ['انتهاء العقد', t.contract_end ? dmy(t.contract_end) : ''], ['الدوام', sh.name + ' (' + sh.time_in + ' – ' + sh.time_out + ')'],
      ['حساب الدخول', t.user_id ? displayName(t.login) : '']].filter(function (x) { return x[1]; });
    var qual = [['أعلى مؤهل', d.degree || t.qualification], ['التخصص', d.major], ['الجامعة', d.university], ['سنة التخرج', d.grad_year], ['سنوات الخبرة', d.experience_years ? d.experience_years + ' سنة' : '']].filter(function (x) { return x[1]; });
    var kv = function (list) { return '<div class="grid2">' + list.map(function (x) { return '<div><span class="hint" style="margin:0">' + x[0] + '</span><div><b>' + esc(x[1]) + '</b></div></div>'; }).join('') + '</div>'; };
    var files = c.files == null ? '<p class="hint">لملفات العاملين شغّل الملف supabase/staff_files.sql.</p>' : c.files.length
      ? '<div class="acts" style="flex-wrap:wrap">' + c.files.map(function (f) { return '<button type="button" class="btn" data-sfopen="' + f.id + '" title="' + esc(f.name) + '">' + esc(SF_KINDS[f.kind] || f.kind) + ' — ' + esc(f.name.length > 28 ? f.name.slice(0, 26) + '…' : f.name) + '</button>'; }).join('') + '</div>'
      : '<p class="hint">لا ملفات مرفوعة.</p>';
    var cv = p && p.reviewed && p.cv_public && p.cv_token
      ? '<a class="btn primary" target="_blank" rel="noopener" href="' + esc(cvLink(p.cv_token)) + '">فتح السيرة الذاتية</a><button type="button" class="btn" data-cvcopy2="' + t.id + '">نسخ رابط السيرة</button>'
      : '<span class="hint" style="margin:0">' + (p ? (p.reviewed ? 'لا رابط مفعّل للسيرة الذاتية' : 'بطاقة المؤهلات تحتاج مراجعة واعتمادًا') : 'لم تُقرأ ملفاته بعد') + '</span>';
    return '<div class="card"><div class="toolbar" style="align-items:center;margin:0 0 10px"><h2 style="margin:0;flex:1">' + esc(t.name) + '</h2>' +
        '<button type="button" class="btn" data-tedit="' + t.id + '">تعديل البيانات والملفات</button><button type="button" class="btn" data-tcardclose>رجوع للقائمة</button></div>' +
        kv(info) + '</div>' +
      '<div class="card"><div class="toolbar" style="align-items:center;margin:0 0 8px"><h2 style="margin:0;flex:1">الدوام</h2>' +
        '<label class="field" for="tc-from" style="margin:0">من</label><input type="date" id="tc-from" value="' + c.from + '" style="width:auto">' +
        '<label class="field" for="tc-to" style="margin:0">إلى</label><input type="date" id="tc-to" value="' + c.to + '" style="width:auto"></div>' +
        '<div class="stats" style="margin:0">' + stat('حضور', n.present, 'يوم') + stat('غياب', n.absent, 'يوم', n.absent ? 'var(--red)' : '') + stat('إجازات', n.leave, 'يوم') +
          stat('مأموريات', n.mission, 'يوم') + stat('تأخير', lateDays, lateMins ? 'يوم · ' + lateMins + ' دقيقة' : 'يوم', lateDays ? 'var(--red)' : '') + '</div>' +
        '<p class="hint">من سجل «دوام الموظفين»، والتأخير بحسب موعد دوامه.</p></div>' +
      '<div class="card"><h2 style="margin-top:0">المؤهلات والسيرة الذاتية</h2>' + (qual.length ? kv(qual) : '') +
        (d.summary ? '<p style="margin:10px 0 0">' + esc(d.summary) + '</p>' : '') + '<div class="toolbar" style="margin:10px 0 0;align-items:center">' + cv + '</div></div>' +
      '<div class="card"><h2 style="margin-top:0">الملفات والشهادات</h2>' + files + '</div>';
  }

  document.addEventListener('click', function (e) {
    if (location.hash !== '#/staff' || !canView()) return;
    var el;
    if ((el = e.target.closest('[data-tcard]'))) { ui.tCard = { id: el.getAttribute('data-tcard'), from: ui.tCard && ui.tCard.from || afYearStart(), to: ui.tCard && ui.tCard.to || todayISO() }; ui.spReport = false; scrollTo(0, 0); return render(); }
    if (e.target.closest('[data-tcardclose]')) { ui.tCard = null; return render(); }
    if (ui.tCard && e.target.closest('[data-tedit]')) ui.tCard = null;
  }, true);
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/staff' || !ui.tCard || (e.target.id !== 'tc-from' && e.target.id !== 'tc-to')) return;
    ui.tCard[e.target.id === 'tc-from' ? 'from' : 'to'] = e.target.value;
    render();
  });

  function renderStaff() {
    if (canView() && S.spRows == null && !ui.spLoading) { ui.spLoading = true; loadStaffProfiles().then(function () { ui.spLoading = false; }); }
    if (S.accountsMissing) {
      app.innerHTML = tabs('staff') + '<div class="card empty">لم تُجهَّز قاعدة البيانات لبيانات المعلمين وحساباتهم بعد.<br>' +
        'شغّل الملف <code dir="ltr">supabase/teacher_accounts.sql</code> في محرر SQL ثم حدّث الصفحة.</div>';
      return;
    }
    var ed = ui.editTeacher, t = ed && ed !== 'new' ? find(ed) : null;
    var val = function (k) { return esc(t && t[k] != null ? t[k] : ''); };
    var f = function (id, label, inner, wide) {
      return '<div' + (wide ? ' style="grid-column:1/-1"' : '') + '><label class="field" for="' + id + '">' + label + '</label>' + inner + '</div>';
    };

    var own = splitList(t && t.classes);
    var all = schoolClasses().concat(own.filter(function (c) { return schoolClasses().indexOf(c) < 0; }));
    var classPick = all.length
      ? '<div class="classes-pick" id="tf-classes">' + all.map(function (c) {
          return '<label class="check"><input type="checkbox" name="tf-class" value="' + esc(c) + '"' + (own.indexOf(c) > -1 ? ' checked' : '') + '>' + esc(c) + '</label>';
        }).join('') + '</div>'
      : '<div class="day" id="tf-classes">عرّف صفوف المدرسة أولًا من تبويب «الإدارة» ثم اخترها هنا.</div>';

    var form = !ed ? '' :
      '<form class="card" id="teacher-form"><h2>' + (t ? 'تعديل بيانات العامل' : 'إضافة عامل') + '</h2>' +
      '<div class="grid2" style="margin-top:12px">' +
        f('tf-name', 'الاسم', '<input type="text" id="tf-name" required value="' + val('name') + '">') +
        (S.staffMissing ? '' :
          f('tf-cat', 'الفئة', '<select id="tf-cat">' + STAFF_CATS.map(function (c) { return '<option' + (staffCat(t) === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>') +
          f('tf-job', 'المسمى الوظيفي', '<input type="text" id="tf-job" placeholder="مثال: المدير، لغة عربية، مراسل" value="' + val('job_title') + '">') +
          f('tf-wa', 'رقم الواتساب', '<input type="text" id="tf-wa" dir="ltr" inputmode="tel" style="text-align:right" value="' + val('whatsapp') + '">')) +
        '<div class="tf-teach" style="display:' + (TEACHING_CATS.indexOf(staffCat(t)) > -1 ? 'contents' : 'none') + '">' +
        f('tf-subject', 'المباحث التي يدرّسها', '<input type="text" id="tf-subject" placeholder="لهيئة التدريس — مثال: علوم عامة، رياضيات" value="' + val('subject') + '"><div class="day">افصل بين المباحث بفاصلة.</div>') +
        f('tf-classes', 'الصفوف والشعب التي يدرّسها', classPick, true) + '</div>' +
        f('tf-phone', 'رقم الجوال', '<input type="text" id="tf-phone" dir="ltr" inputmode="tel" style="text-align:right" value="' + val('phone') + '">') +
        f('tf-qualification', 'المؤهل العلمي', '<input type="text" id="tf-qualification" placeholder="مثال: بكالوريوس تربية علوم" value="' + val('qualification') + '">') +
        f('tf-hire', 'تاريخ التعيين', '<input type="date" id="tf-hire" value="' + val('hire_date') + '"><div class="day">منه يبدأ حساب دوامه.</div>') +
        (S.contractMissing ? '' : f('tf-end', 'تاريخ انتهاء العقد (آخر يوم عمل)', '<input type="date" id="tf-end" value="' + val('contract_end') + '"><div class="day">فارغ: العقد مستمر. بعده لا يظهر في دوام الموظفين.</div>')) +
        (t && t.user_id
          ? f('tf-login-ro', 'حساب الدخول', '<input type="text" id="tf-login-ro" dir="ltr" readonly style="text-align:right" value="' + esc(displayName(t.login)) + '">')
          : f('tf-login', 'إنشاء حساب دخول: اسم المستخدم', '<input type="text" id="tf-login" dir="ltr" style="text-align:right"' +
              ' placeholder="اتركه فارغًا إن لم يلزمه حساب" autocomplete="off">' +
              '<div class="day">يُنشأ الحساب بكلمة المرور الافتراضية، ويُطلب من صاحبه تغييرها عند أول دخول.</div>') +
            '<div class="tf-nonteach" style="display:' + (TEACHING_CATS.indexOf(staffCat(t)) > -1 ? 'none' : 'contents') + '">' +
              f('tf-role', 'صلاحية الحساب', '<select id="tf-role"><option value="viewer">مشاهد (يرى النتائج المنشورة)</option><option value="registrar">مسجِّل طلاب</option><option value="supervisor">مشرف تربوي</option><option value="manager">مدير (مشاهدة فقط)</option>' + (titleColumn() ? '<option value="gensup">' + ROLES.gensup + '</option>' : '') + (roColumn() ? '<option value="observer">' + ROLES.observer + '</option>' : '') + '</select>' +
                '<div class="day">لهيئة التدريس والمحفظين يكون الحساب حساب معلم يرى تقييمه فقط.</div>') + '</div>') +
        f('tf-details', 'بيانات أخرى', '<textarea id="tf-details" placeholder="أي معلومات إضافية عن المعلم">' + val('details') + '</textarea>', true) +
        (S.notStaffMissing ? '' : '<div style="grid-column:1/-1"><label class="check"><input type="checkbox" id="tf-notstaff"' + (t && t.not_staff ? ' checked' : '') + '>' +
          '<b>ليس من العاملين</b> — حساب تجريبي أو حساب للجهة المشرفة: يبقى حسابه، ولا يظهر في دوام الموظفين ولا كشوفه ولا التقييم ولا الجدول ولا الاحتياط ولا المواصلات</label></div>') +
      '</div>' +
      '<div class="actions"><button type="submit" class="btn primary">حفظ</button>' +
      '<button type="button" class="btn" data-tedit="">إلغاء</button></div></form>';

    var catNow = ui.staffCat || '', counts = {};
    // الأعداد لمن هم على رأس عملهم اليوم فقط: من انتهى عقده يبقى في القائمة (مظلَّلًا) ولا يُحسب
    var activeN = 0;
    staffList().forEach(function (x) { if (!employedOn(x, todayISO())) return; counts[staffCat(x)] = (counts[staffCat(x)] || 0) + 1; activeN++; });
    var sq = norm(ui.staffQ || ''), sdig = latinDigits(ui.staffQ || '').replace(/D/g, '');
    var rows = S.teachers.filter(function (x) {
      if (catNow && staffCat(x) !== catNow) return false;
      if (!sq) return true;
      // بالاسم، أو برقم (هوية أو جوال أو واتساب) مما سُجّل في بيانات العامل
      return norm(x.name).indexOf(sq) > -1 || (sdig.length >= 3 && latinDigits([x.phone, x.whatsapp, x.details, x.login].join(' ')).replace(/D+/g, ' ').replace(/s/g, '').indexOf(sdig) > -1);
    }).map(function (x) {
      var teach = TEACHING_CATS.indexOf(staffCat(x)) > -1, today = todayISO();
      // مدة العمل: يبدأ لاحقًا، أو انتهى عقده، أو ينتهي في تاريخ
      var term = x.contract_end && x.contract_end < today ? '<span class="badge unpaid">انتهى عقده ' + dmy(x.contract_end) + '</span>'
        : x.hire_date && x.hire_date > today ? '<span class="badge part">يبدأ ' + dmy(x.hire_date) + '</span>'
        : x.contract_end ? '<span class="badge part">ينتهي عقده ' + dmy(x.contract_end) + '</span>' : '';
      if (x.not_staff) term = '<span class="badge pending">ليس من العاملين</span>';
      return '<tr' + (x.not_staff || (x.contract_end && x.contract_end < today) ? ' style="color:var(--muted)"' : '') + '><td>' + (canView() ? '<button type="button" class="btn link" style="padding:0;font-weight:700;text-align:right" data-tcard="' + x.id + '">' + esc(x.name) + '</button>' : '<b>' + esc(x.name) + '</b>') + (term ? '<br>' + term : '') + '</td><td>' + (S.staffMissing ? '' : '<span class="badge ' + (teach ? 'published' : 'pending') + '">' + staffCat(x) + '</span>') + '</td>' +
        '<td>' + esc(x.job_title || x.subject || '—') + (teach && x.classes ? '<br><span style="color:var(--muted);font-size:.85rem">' + esc(x.classes) + '</span>' : '') + '</td>' +
        // الجوال، والواتساب تحته إن اختلف عنه (عمود واحد يوفّر عرض الجدول)
        '<td><span dir="ltr" style="white-space:nowrap">' + esc(x.phone || '—') + '</span>' +
          (x.whatsapp && plainPhone(x.whatsapp) !== plainPhone(x.phone) ? '<br><span style="color:var(--muted);font-size:.85rem">واتساب <span dir="ltr" style="white-space:nowrap">' + esc(x.whatsapp) + '</span></span>' : '') + '</td>' +
        '<td dir="ltr" style="text-align:right">' + (x.user_id ? esc(displayName(x.login)) : '<span class="badge pending" dir="rtl">بدون حساب</span>') + '</td>' +
        // الأزرار في شبكة من عمودين تلتف، فلا يخرج أحدها عن الجدول مهما ضاقت الشاشة
        '<td><div class="staff-acts"><button type="button" class="btn" data-tedit="' + x.id + '">تعديل</button>' + (canView() ? cvCell(x.id, true) : '') +
        (x.user_id ? '<button type="button" class="btn" data-treset="' + x.id + '" title="إعادة تعيين كلمة المرور">كلمة مرور جديدة</button>' : '<button type="button" class="btn" data-tacc="' + x.id + '">إنشاء حساب</button>') +
        (S.contractMissing ? '' : x.contract_end && x.contract_end < today
          ? '<button type="button" class="btn" data-tcontract="' + x.id + '">إعادة التعاقد</button>'
          : '<button type="button" class="btn" data-tcontract="' + x.id + '">إنهاء العقد</button>') +
        '<button type="button" class="btn danger" data-tdel="' + x.id + '">حذف</button></div></td></tr>';
    }).join('');

    app.innerHTML = tabs('staff') +
      (isAdmin() ? '<details class="card"' + (String(S.defaultPw || '').length < 6 ? ' open' : '') + '><summary><b>كلمة المرور الافتراضية لحسابات المعلمين</b></summary><form id="defaultpw-form" style="margin-top:8px">' +
        '<p class="hint">تُستخدم عند إنشاء حساب معلم أو إعادة تعيين كلمة مروره، ويُطلب منه تغييرها عند أول دخول.</p>' +
        '<div class="toolbar" style="margin:0"><input type="text" id="default-pw" dir="ltr" minlength="6" required autocomplete="off" aria-label="كلمة المرور الافتراضية" ' +
        'style="flex:1;min-width:180px;text-align:right" placeholder="6 أحرف على الأقل" value="' + esc(S.defaultPw) + '">' +
        '<button type="submit" class="btn">حفظ</button></div></form></details>' : '') +
      (S.staffMissing ? '<p class="formhint">لتسجيل فئة العامل ومسماه الوظيفي ورقم الواتساب شغّل الملف <code dir="ltr">supabase/staff.sql</code> في محرر SQL ثم حدّث الصفحة.</p>' : '') +
      (ui.sfBulk && canView() ? sfBulkHtml() : ui.staffImp ? staffImportHtml() : ed ? form + (t && canView() ? staffFilesHtml(t) + staffProfileHtml(t) : '') : ui.tCard && canView() ? staffCardHtml() : ui.spReport && canView() ? spReportHtml() : '<div class="toolbar" style="margin-top:16px;align-items:center"><button type="button" class="btn primary" data-tedit="new">+ إضافة عامل</button>' +
        '<input type="search" id="st-q" data-ro-ok placeholder="ابحث بالاسم أو رقم الهوية أو الجوال" aria-label="بحث في العاملين" style="flex:1;min-width:200px" value="' + esc(ui.staffQ || '') + '">' +
        menuHtml('طباعة',
          '<button type="button" class="btn" data-stlist="teach" data-ro-ok>بيانات العاملين (المباحث والجوال والواتساب)</button>' +
          '<button type="button" class="btn" data-stlist="jobs" data-ro-ok>كشف العاملين (الوظيفة ورقم الاتصال)</button><hr>' +
          '<label class="check"><input type="checkbox" id="stl-mgr" data-ro-ok' + (ui.stlNoMgr ? '' : ' checked') + '> مع المدير</label>' +
          '<label class="check"><input type="checkbox" id="stl-sup" data-ro-ok' + (ui.stlNoSup ? '' : ' checked') + '> مع المشرف التربوي</label>' +
          '<p class="hint">بالفئة المختارة (أو الكل). المدير والمشرف التربوي يُعرفان من المسمى الوظيفي.</p>') +
        (S.staffMissing ? '' : menuHtml('أدوات', (canView() ? '<button type="button" class="btn" data-spreport>مؤهلات العاملين</button>' : '') + (canView() ? '<button type="button" class="btn" data-sfbulk>رفع مجلد ملفات العاملين</button><input type="file" id="sf-dir" webkitdirectory multiple hidden>' : '') + '<button type="button" class="btn" data-staffimp>استيراد من Excel / CSV</button><input type="file" id="staff-file" accept=".xlsx,.xls,.csv" hidden>' +
          '<button type="button" class="btn" data-staffabs title="إضافة من ليس مضافًا منهم إلى روابط الغياب وبوت الواتساب">إضافة هيئة التدريس إلى تسجيل الغياب</button>')) + '</div>') +
      (ed || ui.staffImp || ui.tCard || ui.spReport ? '' :       (S.staffMissing ? '' : '<nav class="pills" aria-label="الفئة">' + [['', 'الكل', activeN]].concat(STAFF_CATS.map(function (c) { return [c, c, counts[c] || 0]; })).map(function (p) {
        return '<button type="button" data-staffcat="' + p[0] + '"' + (catNow === p[0] ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + p[1] + ' <b>' + p[2] + '</b></button>';
      }).join('') + '</nav>') +
      '<div class="card">' + (rows
        ? '<div class="table-wrap"><table class="grid"><thead><tr><th>الاسم</th><th>' + (S.staffMissing ? '' : 'الفئة') + '</th><th>المسمى / المباحث</th><th>الجوال / واتساب</th><th>حساب الدخول</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">لا يوجد عاملون في هذا التصنيف.</div>') + '</div>');
  }

  async function saveTeacherForm() {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
    var t = ui.editTeacher !== 'new' ? find(ui.editTeacher) : null;
    var data = {
      name: g('tf-name'), subject: splitList(g('tf-subject')).join('، '), phone: g('tf-phone'),
      classes: Array.prototype.map.call(document.querySelectorAll('[name="tf-class"]:checked'), function (c) { return c.value; }).join('، '),
      qualification: g('tf-qualification'), hire_date: g('tf-hire') || null, details: g('tf-details')
    };
    if (!S.notStaffMissing) data.not_staff = !!(document.getElementById('tf-notstaff') || {}).checked;
    if (!S.contractMissing) {
      data.contract_end = g('tf-end') || null;
      if (data.hire_date && data.contract_end && data.contract_end < data.hire_date) return toast('تاريخ انتهاء العقد قبل تاريخ التعيين', true);
    }
    if (!S.staffMissing) {
      data.category = g('tf-cat') || 'هيئة تدريس';
      data.job_title = g('tf-job');
      data.whatsapp = latinDigits(g('tf-wa')).replace(/[^0-9+]/g, '');
    }
    var login = g('tf-login'), role = g('tf-role');
    // الشعب والمباحث لهيئة التدريس والمحفظين فقط
    if (data.category && TEACHING_CATS.indexOf(data.category) < 0) { data.classes = ''; data.subject = ''; }
    if (login) {
      if (login.indexOf('@') < 0 && !/^[a-z0-9._-]{3,}$/i.test(login)) {
        return toast('اسم المستخدم: ثلاثة أحرف إنجليزية أو أرقام على الأقل، بدون مسافات.', true);
      }
      if (S.defaultPw.length < 6) return toast('احفظ كلمة المرور الافتراضية أولًا (6 أحرف على الأقل).', true);
    }

    if (t) {
      var up = await sb.from('teachers').update(data).eq('id', t.id);
      if (up.error) return fail(up.error);
      Object.assign(t, data);
    } else {
      var ins = await sb.from('teachers').insert(data).select().single();
      if (ins.error) return fail(ins.error);
      t = ins.data;
      t.ratings = t.ratings || {};
      S.teachers.push(t);
      S.teachers.sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); });
    }

    if (login && !t.user_id) {
      var acc = await sb.rpc('create_teacher_account', { p_teacher: t.id, p_login: toEmail(login), p_password: S.defaultPw });
      if (acc.error) {
        // بيانات المعلم حُفظت، والحساب لم يُنشأ: يبقى النموذج مفتوحًا لتصحيح اسم المستخدم
        ui.editTeacher = t.id;
        render();
        return fail(acc.error);
      }
      // غير هيئة التدريس: صلاحية الحساب كما اختيرت بدل «معلم»
      if (TEACHING_CATS.indexOf(staffCat(t)) < 0) {
        var pr = await sb.from('profiles').update(rolePatch(role || 'viewer')).eq('id', acc.data);
        if (pr.error) toast('أُنشئ الحساب بصلاحية معلم؛ غيّرها من «الإعدادات والمستخدمون»', true);
      }
      t.user_id = acc.data;
      t.login = toEmail(login);
      // ليظهر الحساب الجديد في قائمة المستخدمين
      var us = await sb.from('profiles').select('*').order('created_at');
      if (!us.error) S.users = us.data || [];
    }
    ui.editTeacher = null;
    render();
    toast('تم الحفظ');
  }

  document.addEventListener('click', async function (e) {
    if (!canView() && !(isSup() && location.hash === '#/staff' && e.target.closest('[data-staffcat],[data-tedit]'))) return;
    var el, t;
    if (location.hash === '#/staff' && (el = e.target.closest('[data-staffcat]'))) {
      ui.staffCat = el.getAttribute('data-staffcat');
      return render();
    }
    if (location.hash === '#/staff' && e.target.closest('[data-staffimp]')) return document.getElementById('staff-file').click();
    if (location.hash === '#/staff' && e.target.closest('[data-staffimpsave]')) return saveStaffImport();
    if (location.hash === '#/staff' && e.target.closest('[data-staffimpcancel]')) { ui.staffImp = null; return render(); }
    if (location.hash === '#/staff' && e.target.closest('[data-staffabs]')) return staffToAbsence();
    if (location.hash === '#/staff' && (el = e.target.closest('[data-tacc]'))) {
      ui.editTeacher = el.getAttribute('data-tacc');
      render();
      var lg = document.getElementById('tf-login');
      if (lg) { lg.focus(); lg.scrollIntoView({ block: 'center' }); }
      return;
    }
    if ((el = e.target.closest('[data-tedit]'))) {
      ui.editTeacher = el.getAttribute('data-tedit') || null;
      render();
      var first = document.getElementById('tf-name');
      if (first) { first.focus(); first.scrollIntoView({ block: 'center' }); }
    } else if ((el = e.target.closest('[data-treset]'))) {
      t = find(el.getAttribute('data-treset'));
      if (S.defaultPw.length < 6) return toast('احفظ كلمة المرور الافتراضية أولًا (6 أحرف على الأقل).', true);
      if (!confirm('إعادة كلمة مرور «' + t.name + '» إلى الكلمة الافتراضية؟')) return;
      var r = await sb.rpc('reset_teacher_password', { p_teacher: t.id, p_password: S.defaultPw });
      if (r.error) return fail(r.error);
      toast('تمت إعادة تعيين كلمة المرور');
    } else if ((el = e.target.closest('[data-tcontract]'))) {
      // إنهاء العقد: آخر يوم عمل، وبعده لا يظهر في دوام الموظفين. إعادة التعاقد تلغي تاريخ الانتهاء
      t = find(el.getAttribute('data-tcontract'));
      if (!t) return;
      var ended = t.contract_end && t.contract_end < todayISO(), endVal = null;
      if (ended) {
        if (!confirm('إعادة التعاقد مع «' + t.name + '»؟\nيُلغى تاريخ انتهاء العقد (' + dmy(t.contract_end) + ') فيعود إلى دوام الموظفين.\nلتغيير تاريخ التعيين استخدم «تعديل».')) return;
      } else {
        var typed = prompt('إنهاء عقد «' + t.name + '»: آخر يوم عمل (يوم/شهر/سنة)\nمن اليوم التالي لا يظهر في دوام الموظفين، ويبقى سجله وما سُجّل من دوامه.', dmy(todayISO()));
        if (typed == null) return;
        var dm = latinDigits(typed).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/), iso = latinDigits(typed).trim().match(/^\d{4}-\d{2}-\d{2}$/);
        endVal = iso ? iso[0] : dm ? dm[3] + '-' + String(dm[2]).padStart(2, '0') + '-' + String(dm[1]).padStart(2, '0') : '';
        if (!isoDay(endVal) || isNaN(new Date(endVal + 'T00:00'))) return toast('اكتب التاريخ مثل ' + dmy(todayISO()), true);
        if (t.hire_date && endVal < t.hire_date) return toast('آخر يوم عمل قبل تاريخ التعيين (' + dmy(t.hire_date) + ')', true);
      }
      var cu = await sb.from('teachers').update({ contract_end: endVal }).eq('id', t.id);
      if (cu.error) return fail(cu.error);
      t.contract_end = endVal;
      S.sa = null;
      render();
      toast(endVal ? 'انتهى عقد «' + t.name + '» بنهاية يوم ' + dmy(endVal) : 'أُعيد التعاقد مع «' + t.name + '»');
    } else if ((el = e.target.closest('[data-tdel]'))) {
      t = find(el.getAttribute('data-tdel'));
      if (!confirm('هل تريد حذف «' + t.name + '» مع تقييمه وتقارير زياراته وحسابه نهائيًا؟')) return;
      var d = await sb.from('teachers').delete().eq('id', t.id);
      if (d.error) return fail(d.error);
      S.teachers = S.teachers.filter(function (x) { return x.id !== t.id; });
      S.visits = S.visits.filter(function (x) { return x.teacher_id !== t.id; });
      if (ui.editTeacher === t.id) ui.editTeacher = null;
      render();
    }
  });

  app.addEventListener('change', function (e) {
    if (isAdmin() && location.hash === '#/staff' && e.target.id === 'tf-cat') {
      var teach = TEACHING_CATS.indexOf(e.target.value) > -1;
      Array.prototype.forEach.call(document.querySelectorAll('.tf-teach'), function (d) { d.style.display = teach ? 'contents' : 'none'; });
      Array.prototype.forEach.call(document.querySelectorAll('.tf-nonteach'), function (d) { d.style.display = teach ? 'none' : 'contents'; });
      return;
    }
    if (!isAdmin() || location.hash !== '#/staff' || e.target.id !== 'staff-file') return;
    if (e.target.files.length) readStaffFile(e.target.files[0]);
    e.target.value = '';
  });

