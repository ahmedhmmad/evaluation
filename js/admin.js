'use strict';
  /* ---------- قائمة المعلمين ---------- */

  function renderList() {
    var q = ui.search.trim();
    var shown = evalTeachers().filter(function (t) {
      return !q || t.name.indexOf(q) > -1 || t.subject.indexOf(q) > -1;
    });

    var cards = shown.map(function (t) {
      var score = t.status === 'new' ? '' :
        '<span class="score">' + total(t) + ' / ' + MAX + '</span>';
      return '<button type="button" class="card teacher" data-open="' + t.id + '">' +
        '<span class="name">' + esc(t.name) + '</span>' +
        '<span class="subject">' + esc(t.subject || '—') + '</span>' +
        '<span class="foot"><span class="badge ' + t.status + '">' + STATUS[t.status] + '</span>' + score + '</span>' +
        '</button>';
    }).join('');

    app.innerHTML = tabs('teachers') +
      '<div class="toolbar">' +
        '<input type="search" id="search" placeholder="ابحث باسم المعلم أو التخصص" aria-label="بحث" value="' + esc(ui.search) + '">' +
        (isAdmin() ? '<a class="btn primary" href="#/staff" style="text-decoration:none">+ إضافة معلم</a>' : '') +
      '</div>' +
      (shown.length
        ? '<div class="teachers">' + cards + '</div>'
        : '<div class="card empty">' + (S.teachers.length ? 'لا توجد نتائج مطابقة.'
            : isAdmin() ? 'لا يوجد معلمون بعد. أضفهم من تبويب «بيانات العاملين».' : 'لا يوجد معلمون بعد. يضيفهم مدير النظام.') + '</div>');
  }

  /* ---------- التقييم ---------- */

  function stepper(t) {
    var cur = stepIndex(t.status);
    var allDone = t.status === 'published';
    return '<ol class="stepper">' + STEPS.map(function (s, i) {
      var cls = allDone || i < cur ? 'done' : (i === cur ? 'current' : '');
      return '<li class="' + cls + '"' + (cls === 'current' ? ' aria-current="step"' : '') + '>' +
        '<span class="num">' + (cls === 'done' ? '✓' : i + 1) + '</span>' +
        '<span><span class="t">' + s.title + '</span><br><span class="d">' + s.desc + '</span></span></li>';
    }).join('') + '</ol>';
  }

  function summary(sum) {
    var pct = Math.round(sum / MAX * 100);
    return '<div class="summary">' +
      '<div class="box"><div class="k">المجموع</div><div class="v">' + sum + ' / ' + MAX + '</div></div>' +
      '<div class="box"><div class="k">النسبة</div><div class="v">' + pct + '%</div></div>' +
      '<div class="box"><div class="k">التقدير</div><div class="v">' + grade(pct) + '</div></div>' +
      '</div>';
  }

  function readOnlyTable(ratings) {
    return '<div class="table-wrap"><table class="criteria"><thead><tr><th>م</th><th>التقييم الأدائي والكفايات الشخصية</th><th>التقييم</th></tr></thead><tbody>' +
      CRITERIA.map(function (c, i) {
        return '<tr><td class="n">' + (i + 1) + '</td><td>' + c + '</td><td class="r"><span class="pill">' + (ratings[i] || '—') + '</span></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function notesBlock(title, text) {
    return text ? '<div class="notes-block"><h3>' + title + '</h3><p>' + esc(text) + '</p></div>' : '';
  }

  function editStep(t) {
    var done = ratedCount(t);
    var rows = CRITERIA.map(function (c, i) {
      var opts = SCALE.slice().reverse().map(function (s) {
        return '<label title="' + s.label + '"><input type="radio" name="c' + i + '" value="' + s.v + '"' +
          (t.ratings[i] === s.v ? ' checked' : '') + ' aria-label="' + s.v + ' - ' + s.label + '"><span>' + s.v + '</span></label>';
      }).join('');
      var missing = ui.error && !t.ratings[i] ? ' class="missing"' : '';
      return '<tr' + missing + '><td class="n">' + (i + 1) + '</td><td>' + c + '</td>' +
        '<td class="r"><span class="rate" role="radiogroup" aria-label="تقييم البند ' + (i + 1) + '">' + opts + '</span></td></tr>';
    }).join('');

    return '<div class="card">' +
      '<div class="progress-row"><span id="progress-text">تم تقييم ' + done + ' من ' + CRITERIA.length + ' بندًا</span>' +
      '<span class="save-state" id="save-state"></span></div>' +
      '<div class="progress"><div id="progress-bar" style="width:' + (done / CRITERIA.length * 100) + '%"></div></div>' +
      '<div class="legend">' + SCALE.map(function (s) { return '<span><b>' + s.v + '</b> = ' + s.label + '</span>'; }).join('') + '</div>' +
      '<div class="table-wrap"><table class="criteria edit"><thead><tr><th>م</th><th>التقييم الأدائي والكفايات الشخصية</th><th>التقييم</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="notes-block"><label class="field" for="notes">ملاحظات المشرف</label>' +
      '<textarea id="notes" placeholder="نقاط القوة، فرص التحسين، التوصيات...">' + esc(t.notes) + '</textarea></div>' +
      (ui.error ? '<div class="msg" role="alert">' + ui.error + '</div>' : '') +
      '<div class="actions">' +
        '<button type="button" class="btn primary" data-act="submit">إرسال للاعتماد</button>' +
        '<button type="button" class="btn" data-act="back">حفظ كمسودة</button>' +
      '</div></div>';
  }

  function reviewStep(t) {
    return '<div class="card">' + summary(total(t)) + readOnlyTable(t.ratings) +
      notesBlock('ملاحظات المشرف', t.notes) +
      '<div class="notes-block"><label class="field" for="approver-notes">ملاحظات الاعتماد</label>' +
      '<textarea id="approver-notes" placeholder="ملاحظات المعتمِد (اختياري)">' + esc(t.approver_notes) + '</textarea></div>' +
      '<div class="actions">' +
        '<button type="button" class="btn primary" data-act="approve">اعتماد التقييم</button>' +
        '<button type="button" class="btn" data-act="return">إعادة للتحرير</button>' +
      '</div></div>';
  }

  function publishStep(t) {
    var published = t.status === 'published';
    return '<div class="card">' +
      '<div class="info no-print">' + (published
        ? 'تم نشر التقييم بتاريخ ' + fmtDate(t.published_at) + (t.visible ? '' : ' (مخفي عن المشاهدين)')
        : 'تم اعتماد التقييم بتاريخ ' + fmtDate(t.approved_at) + ' وهو جاهز للنشر.') + '</div>' +
      summary(total(t)) + readOnlyTable(t.ratings) +
      notesBlock('ملاحظات المشرف', t.notes) +
      notesBlock('ملاحظات الاعتماد', t.approver_notes) +
      '<div class="actions no-print">' +
        (published
          ? '<button type="button" class="btn primary" data-act="print">طباعة</button>' +
            '<button type="button" class="btn" data-act="reopen">إعادة فتح للتحرير</button>'
          : '<button type="button" class="btn primary" data-act="publish">نشر التقييم</button>' +
            '<button type="button" class="btn" data-act="return">إعادة للتحرير</button>') +
      '</div></div>';
  }

  function renderEval(t) {
    var body = t.status === 'review' ? reviewStep(t)
      : (t.status === 'approved' || t.status === 'published') ? publishStep(t)
      : editStep(t);

    app.innerHTML =
      '<button type="button" class="btn link no-print" data-act="back">→ العودة إلى قائمة المعلمين</button>' +
      '<div class="eval-head">' +
        '<div><h2>' + esc(t.name) + '</h2><div class="sub">التخصص: ' + esc(t.subject || '—') + '</div></div>' +
        '<div class="no-print"><span class="badge ' + t.status + '">' + STATUS[t.status] + '</span> ' +
        (isAdmin() ? '<button type="button" class="btn danger" data-act="delete">حذف المعلم</button>' : '') + '</div>' +
      '</div>' +
      stepper(t) + body;
  }

  /* ---------- النتائج المنشورة (ما يراه المشاهدون) ---------- */

  function renderResults(id) {
    if (S.results === null) {
      app.innerHTML = tabs('results') + '<div class="card empty">جارٍ التحميل…</div>';
      loadResults();
      return;
    }
    var r = null;
    if (id) S.results.forEach(function (x) { if (x.id === id) r = x; });

    if (r) {
      app.innerHTML =
        '<a class="btn link no-print" href="' + (isStaff() ? '#/results' : '#/') + '">→ العودة إلى النتائج</a>' +
        '<div class="eval-head"><div><h2>' + esc(r.name) + '</h2><div class="sub">التخصص: ' + esc(r.subject || '—') +
        ' · تاريخ النشر: ' + fmtDate(r.published_at) + '</div></div>' +
        '<div class="no-print"><button type="button" class="btn" data-act="print">طباعة</button></div></div>' +
        '<div class="card">' +
          (r.total != null ? summary(r.total) : '') +
          (r.ratings ? readOnlyTable(r.ratings) : '') +
          notesBlock('ملاحظات المشرف', r.notes) +
          notesBlock('ملاحظات الاعتماد', r.approver_notes) +
          (r.total == null && !r.ratings && !r.notes && !r.approver_notes ? '<div class="empty">لا توجد تفاصيل متاحة للعرض.</div>' : '') +
        '</div>';
      return;
    }

    var cards = S.results.map(function (x) {
      return '<a class="card teacher" href="#/r/' + x.id + '" style="text-decoration:none;color:inherit">' +
        '<span class="name">' + esc(x.name) + '</span>' +
        '<span class="subject">' + esc(x.subject || '—') + '</span>' +
        '<span class="foot"><span class="badge published">' + fmtDate(x.published_at) + '</span>' +
        (x.total != null ? '<span class="score">' + x.total + ' / ' + MAX + '</span>' : '') + '</span></a>';
    }).join('');

    app.innerHTML = tabs('results') +
      (isStaff() ? '<p class="hint" style="color:var(--muted);margin-top:0">هذه الصفحة تعرض ما يراه أصحاب حسابات «مشاهد».</p>' : '') +
      (cards ? '<div class="teachers">' + cards + '</div>' : '<div class="card empty">لا توجد نتائج منشورة.</div>');
  }

  /* ---------- الإدارة (مدير النظام) ---------- */

  function renderAdmin() {
    var s = S.settings || {};
    var checks = VISIBILITY.map(function (v) {
      return '<label class="check"><input type="checkbox" data-setting="' + v.key + '"' + (s[v.key] ? ' checked' : '') + '>' + v.label + '</label>';
    }).join('');

    var published = S.teachers.filter(function (t) { return t.status === 'published'; });
    var vis = published.length ? published.map(function (t) {
      return '<label class="check"><input type="checkbox" data-visible="' + t.id + '"' + (t.visible ? ' checked' : '') + '>' +
        esc(t.name) + ' <span style="color:var(--muted)">— ' + esc(t.subject || '—') + '</span></label>';
    }).join('') : '<div class="hint">لا توجد تقييمات منشورة بعد.</div>';

    var users = S.users.map(function (u) {
      var self = u.id === S.uid;
      // حسابات المعلمين تُدار من تبويب «بيانات العاملين»
      var isTeacher = u.role === 'teacher';
      var opts = Object.keys(ROLES).filter(function (k) { return (isTeacher || k !== 'teacher') && (k !== 'observer' || roColumn()) && (k !== 'gensup' || titleColumn()); }).map(function (k) {
        return '<option value="' + k + '"' + (roleKey(u) === k ? ' selected' : '') + '>' + ROLES[k] + '</option>';
      }).join('');
      return '<tr><td>' + esc(u.full_name || '—') + '</td><td dir="ltr" style="text-align:right">' + esc(displayName(u.email)) + '</td>' +
        '<td><select data-role="' + u.id + '" aria-label="صلاحية ' + esc(u.email) + '"' + (self ? ' disabled title="لا يمكنك تغيير صلاحيتك"' : isTeacher ? ' disabled title="يُدار من تبويب بيانات المعلمين"' : '') + '>' + opts + '</select></td>' +
        '<td>' + (self || isTeacher ? '' : '<button type="button" class="btn" data-resetpw="' + u.id + '">كلمة مرور جديدة</button>') + '</td></tr>';
    }).join('');

    var adTab = vtab('admin', 'users');
    app.innerHTML = tabs('admin') + vtabsHtml('admin', 'users', [['users', 'المستخدمون والصلاحيات'], ['perms', 'صلاحيات الموظفين'], ['school', 'بيانات المدرسة'], ['viewers', 'ما يراه المشاهدون'], ['backup', 'النسخ الاحتياطي والربط']]) +
      (adTab === 'perms' ? permsCardHtml() : '') +
      (adTab === 'backup' ? backupCardHtml() + botKeyCardHtml() : '') +
      (adTab !== 'school' ? '' : '<div class="card"><h2>بيانات المدرسة</h2>' +
        '<label class="field" for="school-name" style="margin-top:8px">اسم المدرسة</label>' +
        '<input type="text" id="school-name" data-settingtext="school_name" value="' + esc((S.settings && S.settings.school_name) || '') + '">' +
        '<p class="hint" style="margin:6px 0 0">يظهر بجانب الشعار في ترويسة كل التقارير المطبوعة. اتركه فارغًا لاستخدام «أكاديمية الركيزة الثالثة».</p>' +
        '<label class="field" for="rep-sub" style="margin-top:14px">المرحلة أو القسم (سطر تحت اسم الأكاديمية في الترويسة)</label>' +
        '<input type="text" id="rep-sub" data-settingtext="report_subtitle" value="' + esc((S.settings && S.settings.report_subtitle) || '') + '">' +
        '<label class="field" for="rep-year" style="margin-top:14px">العام الدراسي</label>' +
        '<input type="text" id="rep-year" dir="ltr" style="text-align:right" data-settingtext="academic_year" placeholder="' + esc(academicYear()) + '" value="' + esc((S.settings && S.settings.academic_year) || '') + '">' +
        '<label class="field" for="rep-contact" style="margin-top:14px">بيانات التواصل (تظهر في تذييل كل تقرير)</label>' +
        '<input type="text" id="rep-contact" data-settingtext="contact_info" placeholder="العنوان · الهاتف · البريد الإلكتروني" value="' + esc((S.settings && S.settings.contact_info) || '') + '">' +
        '<label class="field" for="principal-name" style="margin-top:14px">اسم مدير/ة الأكاديمية</label>' +
        '<input type="text" id="principal-name" data-settingtext="principal_name" value="' + esc(principalName()) + '">' +
        '<p class="hint" style="margin:6px 0 0">يظهر في خانة توقيع المدير في التقارير المطبوعة.</p>' +
        '<label class="field" for="school-address" style="margin-top:14px">عنوان الأكاديمية (أسفل الخطابات الرسمية كالطلبيات)</label>' +
        '<input type="text" id="school-address" data-settingtext="school_address" placeholder="' + esc(REPORT.address) + '" value="' + esc((S.settings && S.settings.school_address) || '') + '">' +
        '<label class="field" for="school-phone" style="margin-top:14px">هاتف الأكاديمية</label>' +
        '<input type="text" id="school-phone" dir="ltr" style="text-align:right" data-settingtext="school_phone" placeholder="' + esc(REPORT.phone) + '" value="' + esc((S.settings && S.settings.school_phone) || '') + '">' +
        '<label class="field" for="school-fb" style="margin-top:14px">صفحة فيسبوك</label>' +
        '<input type="text" id="school-fb" dir="ltr" style="text-align:right" data-settingtext="school_facebook" placeholder="' + esc(REPORT.facebook) + '" value="' + esc((S.settings && S.settings.school_facebook) || '') + '">' +
        '<p class="hint" style="margin:6px 0 0">تظهر هذه الثلاثة في تذييل كل ورقة مطبوعة. اتركها فارغة لاستعمال القيم الظاهرة في الخانات.</p>' +
        '<label class="field" style="margin-top:16px">الصفوف والشعب</label>' +
        '<p class="hint" style="margin:0">الشعب: ' + (schoolClasses().map(esc).join('، ') || 'لا توجد بعد') + '. تُدار من <a href="#/rooms">إعداد الفصول</a>.</p></div>') +
      (adTab !== 'viewers' ? '' : '<div class="card"><h2>ما يراه المشاهدون</h2>' +
        '<p class="hint">يُطبَّق على جميع حسابات «مشاهد» في التقييمات المنشورة.</p>' + checks + '</div>' +
      '<div class="card"><h2>التقييمات الظاهرة للمشاهدين</h2>' +
        '<p class="hint">أزل العلامة لإخفاء تقييم منشور عن المشاهدين.</p>' + vis + '</div>') +
      (adTab !== 'users' ? '' : '<div class="card"><h2>المستخدمون والصلاحيات</h2>' +
        '<p class="hint">الحسابات الجديدة تبقى «بانتظار التفعيل» إلى أن تحدد صلاحيتها.</p>' +
        '<div class="table-wrap"><table class="grid"><thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الصلاحية</th><th></th></tr></thead><tbody>' + users + '</tbody></table></div>' +
        // إنشاء حساب جاهز (يحتاج supabase/registrar.sql)
        '<form id="user-form" style="margin-top:18px;padding-top:14px;border-top:1px solid var(--line)"><h3 style="margin:0 0 4px">إنشاء حساب جديد</h3>' +
          '<p class="hint">للمسجِّلين والمشرفين والمشاهدين. يدخل صاحب الحساب باسم المستخدم وكلمة المرور المؤقتة، ويُطلب منه اختيار كلمة مرور خاصة به عند أول دخول. حسابات المعلمين تُنشأ من «بيانات المعلمين».</p>' +
          '<div class="grid2">' +
            '<div><label class="field" for="nu-name">الاسم <span class="req">*</span></label><input type="text" id="nu-name" required></div>' +
            '<div><label class="field" for="nu-login">اسم المستخدم <span class="req">*</span></label><input type="text" id="nu-login" required dir="ltr" style="text-align:right" autocomplete="off" placeholder="مثال: registrar1"></div>' +
            '<div><label class="field" for="nu-pw">كلمة المرور المؤقتة <span class="req">*</span></label><input type="text" id="nu-pw" required minlength="6" dir="ltr" style="text-align:right" autocomplete="off" value="' + esc(S.defaultPw || '') + '"></div>' +
            '<div><label class="field" for="nu-role">الصلاحية</label><select id="nu-role"><option value="registrar">' + ROLES.registrar + '</option><option value="attclerk">' + ROLES.attclerk + '</option><option value="supervisor">' + ROLES.supervisor + '</option><option value="viewer">' + ROLES.viewer + '</option><option value="manager">' + ROLES.manager + '</option>' +
              (roColumn() ? '<option value="observer">' + ROLES.observer + '</option>' : '') + '</select></div>' +
          '</div><div class="actions"><button type="submit" class="btn primary">إنشاء الحساب</button></div></form></div>');
  }

  /* ----- صلاحيات الموظفين: اختيار موظف ثم الشاشات التي تظهر عنده ويتحكم بها ----- */
  function permAccounts() {
    return S.users.filter(function (u) { return u.role !== 'superadmin' && u.role !== 'pending'; })
      .sort(function (a, b) { return String(a.full_name || a.email).localeCompare(String(b.full_name || b.email), 'ar'); });
  }
  function permsCardHtml() {
    if (!permsColumn()) return '<div class="card empty">صلاحيات الموظفين تحتاج تحديثًا في قاعدة البيانات.<br>شغّل الملف <code dir="ltr">supabase/staff_perms.sql</code> في محرر SQL في Supabase ثم حدّث الصفحة.</div>';
    var list = permAccounts(), u = list.filter(function (x) { return x.id === ui.pmUser; })[0] || null;
    var pick = '<label class="field" for="pm-user">الموظف</label><select id="pm-user" style="max-width:420px"><option value="">اختر الموظف…</option>' +
      list.map(function (x) {
        var n = (x.perms || []).length;
        return '<option value="' + x.id + '"' + (u && u.id === x.id ? ' selected' : '') + '>' + esc(x.full_name || displayName(x.email)) + ' — ' +
          String(ROLES[roleKey(x)] || '').replace(/\s*\(.*\)$/, '') + (n ? ' (' + n + ')' : '') + '</option>';
      }).join('') + '</select>';
    var body = '';
    if (u) {
      var own = {}, groups = {}, order = [];
      withProfile(u, function () { navModelRole().forEach(function (g) { g.items.forEach(function (it) { own[it[0]] = 1; }); }); });
      permScreens().forEach(function (s) { if (!groups[s[3]]) { groups[s[3]] = []; order.push(s[3]); } groups[s[3]].push(s); });
      body = order.map(function (t) {
        return '<h3 style="margin:14px 0 6px">' + esc(t || 'عام') + '</h3><div class="checks">' + groups[t].map(function (s) {
          return '<label class="check"><input type="checkbox" data-perm="' + s[1] + '"' + ((u.perms || []).indexOf(s[1]) > -1 ? ' checked' : '') + '>' + esc(s[2]) +
            (own[s[0]] ? ' <span style="color:var(--muted)">— عنده بصلاحيته، وبالمنح يتحكم بها كالمدير</span>' : '') + '</label>';
        }).join('') + '</div>';
      }).join('');
    }
    var given = list.filter(function (x) { return (x.perms || []).length; });
    var names = {};
    permScreens().forEach(function (s) { names[s[1]] = s[2]; });
    return '<div class="card"><h2>صلاحيات الموظفين</h2>' +
      '<p class="hint" style="margin:6px 0 10px">اختر الموظف ثم علّم الشاشات التي تظهر عنده. تظهر له في قائمته تحت «مهام إضافية»، ويتحكم بكل شاشة منها كما يتحكم بها مدير النظام، ويبقى له ما في حسابه كما هو. يُحفظ كل اختيار فورًا، ويظهر للموظف عند دخوله التالي أو بعد «مزامنة البيانات».</p>' +
      pick + body + '</div>' +
      (given.length ? '<div class="card"><h2>من مُنح صلاحيات</h2><div class="table-wrap"><table class="grid"><thead><tr><th>الموظف</th><th>الشاشات الممنوحة</th></tr></thead><tbody>' +
        given.map(function (x) {
          return '<tr><td>' + esc(x.full_name || displayName(x.email)) + '</td><td>' + (x.perms || []).map(function (k) { return esc(names[k] || k); }).join('، ') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>' : '');
  }

  /* ---------- إعداد الفصول الدراسية (مدير النظام) ----------
     تُحفظ في settings.classes بهذا الشكل: { rooms: عدد الغرف, list: [{ name, gender, capacity, teacher }] } (teacher: مربي الصف).
     الصيغة القديمة (قائمة أسماء فقط) تُقرأ كما هي: شعب بلا جنس ولا سعة */

  var CLASS_GENDERS = { boys: 'ذكور', girls: 'إناث', mixed: 'مختلط' };
  var classCache = { src: null, cfg: null };

  function classConfig() {
    var c = S.settings ? S.settings.classes : null;
    if (classCache && classCache.cfg && classCache.src === c) return classCache.cfg;
    var list = Array.isArray(c) ? c : c && Array.isArray(c.list) ? c.list : [];
    var cfg = {
      rooms: c && !Array.isArray(c) ? Number(c.rooms) || 0 : 0,
      fees: c && !Array.isArray(c) && c.fees ? c.fees : null, // رسوم المواصلات للأسرة: { first, next }
      cycles: c && !Array.isArray(c) && c.cycles && typeof c.cycles === 'object' ? c.cycles : null, // دورات المواصلات (cycleCfg)
      // أيام العطل (غير الجمعة والسبت): تواريخ YYYY-MM-DD
      holidays: c && !Array.isArray(c) && Array.isArray(c.holidays) ? c.holidays.filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }).sort() : [],
      list: list.map(function (x) {
        if (typeof x === 'string') return { name: x, gender: '', capacity: null, teacher: '' };
        var cap = x.capacity == null || x.capacity === '' ? null : Number(x.capacity);
        return { name: String(x.name || ''), gender: CLASS_GENDERS[x.gender] ? x.gender : '', capacity: cap > 0 ? cap : null, teacher: String(x.teacher || '') };
      }).filter(function (x) { return x.name; })
    };
    // الترتيب بالصف ثم الشعبة أيًّا كان ترتيب الإدخال: الأول (أ)، الأول (ب)، الثاني (أ)… والروضة أولًا، وما لا يُعرف صفه آخرًا
    var rank = function (name) {
      if (/kg|روض|تمهيد/i.test(name)) return 0;
      return gradeOf(name) || 999;
    };
    cfg.list.sort(function (a, b) { return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'ar', { numeric: true }); });
    cfg.names = cfg.list.map(function (x) { return x.name; });
    classCache = { src: c, cfg: cfg };
    return cfg;
  }

  function schoolClasses() {
    return classConfig().names;
  }

  function classInfo(name) {
    var list = classConfig().list;
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }

  // عدد المسجلين نهائيًا في كل شعبة { الاسم: العدد }
  function classCounts() {
    var counts = {};
    S.students.forEach(function (x) { if (enrolled(x) && x.class_name) counts[x.class_name] = (counts[x.class_name] || 0) + 1; });
    return counts;
  }

  // حال الشعبة لو أُضيف إليها هذا الطالب: st الطالب إن كان مسجلًا (لا يُعدّ مرتين إن كان فيها أصلًا)، gender جنسه
  function classStatus(name, st, gender) {
    var info = classInfo(name), n = classCounts()[name] || 0;
    if (st && enrolled(st) && st.class_name === name) n--;
    var cap = info ? info.capacity : null, warn = [];
    if (cap != null && n >= cap) warn.push('الشعبة «' + name + '» ممتلئة: المسجلون ' + n + ' والسعة القصوى ' + cap + '.');
    if (info && gender && ((info.gender === 'boys' && gender === 'أنثى') || (info.gender === 'girls' && gender === 'ذكر'))) {
      warn.push('الشعبة «' + name + '» لل' + CLASS_GENDERS[info.gender] + ' والطالب ' + gender + '.');
    }
    return { info: info, count: n, capacity: cap, left: cap == null ? null : cap - n, warn: warn };
  }

  // يُسأل المستخدم قبل وضع طالب في شعبة ممتلئة أو لجنس آخر؛ التجاوز مسموح بعد التأكيد
  function confirmClass(name, st, gender) {
    var warn = name ? classStatus(name, st, gender).warn : [];
    return !warn.length || confirm('تنبيه:\n' + warn.join('\n') + '\n\nهل تريد المتابعة مع ذلك؟');
  }

  // سطر تحت قائمة الشعبة في نموذج الطالب
  function classHintHtml(name, st, gender) {
    if (!schoolClasses().length) return 'عرّف الشعب أولًا من «إعداد الفصول».';
    if (!name) return 'تُحدَّد عند اعتماد التسجيل النهائي.';
    var s = classStatus(name, st, gender);
    var text = s.capacity == null ? 'المسجلون: ' + s.count + ' (لم تُحدَّد سعة)'
      : 'المسجلون ' + s.count + ' من ' + s.capacity + ' — ' + (s.left > 0 ? 'المتاح ' + s.left : 'لا مقاعد متاحة');
    return (s.info && s.info.gender ? CLASS_GENDERS[s.info.gender] + ' · ' : '') + text +
      s.warn.map(function (w) { return '<div class="formhint">' + esc(w) + ' يمكن المتابعة مع التجاوز.</div>'; }).join('');
  }

  // خيارات قائمة الشعبة في نموذج الطالب: الاسم ثم الجنس والمسجلون/السعة
  function classOptionsHtml(current) {
    var counts = classCounts(), names = schoolClasses().slice();
    if (current && names.indexOf(current) < 0) names.push(current);
    return '<option value="">— اختر —</option>' + names.map(function (name) {
      var info = classInfo(name), n = counts[name] || 0, extra = [];
      if (info && info.gender) extra.push(CLASS_GENDERS[info.gender]);
      extra.push(info && info.capacity != null ? n + '/' + info.capacity + (n >= info.capacity ? ' ممتلئة' : '') : String(n));
      return '<option value="' + esc(name) + '"' + (name === current ? ' selected' : '') + '>' + esc(name) + ' — ' + extra.join(' · ') + '</option>';
    }).join('');
  }

  async function saveClassConfig(cfg, focusId) {
    var value = { rooms: cfg.rooms, fees: cfg.fees || classConfig().fees || undefined, holidays: cfg.holidays || classConfig().holidays || [],
      cycles: cfg.cycles || classConfig().cycles || undefined, list: cfg.list.map(function (x) { return { name: x.name, gender: x.gender, capacity: x.capacity, teacher: x.teacher || '' }; }) };
    var r = await sb.from('settings').update({ classes: value }).eq('id', 1);
    if (r.error) { render(); return fail(r.error); }
    (S.settings || (S.settings = {})).classes = value;
    render();
    var box = focusId && document.getElementById(focusId);
    if (box) box.focus();
    toast('تم الحفظ');
  }

  /* ----- مربو الفصول: استيرادهم من كشف Word، وحسابات دخولهم ----- */

  // حرف الشعبة من اسمها: «السابع (ب)» → «ب». فارغ إن لم يكن للصف شعب
  function sectionOf(name) {
    var m = String(name).match(/[(（]\s*([^\s)）]+)\s*[)）]/) || String(name).trim().match(/\s([أ-ي])$/);
    return m ? norm(m[1]) : '';
  }

  // يقرأ جدول «الصف | الشعبة | مربي الصف» من ملف Word ويطابق كل سطر بشعبة معرّفة هنا
  async function readHomeroomFile(file) {
    try {
      await loadFflate();
      var files = fflate.unzipSync(new Uint8Array(await file.arrayBuffer()));
      if (!files['word/document.xml']) throw new Error('ليس ملف Word بصيغة docx');
      var doc = new DOMParser().parseFromString(fflate.strFromU8(files['word/document.xml']), 'application/xml');
      var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      var cellText = function (c) {
        return Array.prototype.map.call(c.getElementsByTagNameNS(W, 't'), function (t) { return t.textContent; }).join('').replace(/\s+/g, ' ').trim();
      };
      var found = [], missing = [], cfg = classConfig();
      Array.prototype.forEach.call(doc.getElementsByTagNameNS(W, 'tbl'), function (tbl) {
        var col = null;
        Array.prototype.forEach.call(tbl.getElementsByTagNameNS(W, 'tr'), function (tr) {
          var cells = Array.prototype.map.call(tr.getElementsByTagNameNS(W, 'tc'), cellText);
          if (!col) {
            // صف العناوين
            var c = { grade: -1, section: -1, teacher: -1 };
            cells.forEach(function (t, i) {
              var n = norm(t);
              if (/مرب/.test(n)) c.teacher = i; else if (/شعب/.test(n)) c.section = i; else if (/صف/.test(n) && c.grade < 0) c.grade = i;
            });
            if (c.grade > -1 && c.teacher > -1) col = c;
            return;
          }
          var teacher = (cells[col.teacher] || '').replace(/\s+/g, ' ').trim(), grade = gradeOf(cells[col.grade] || '');
          if (!teacher || !grade) return;
          var section = col.section > -1 ? norm(cells[col.section]).replace(/[—–\-ـ.]/g, '').trim() : '';
          var same = cfg.list.filter(function (k) { return !/kg|روض|تمهيد/i.test(k.name) && gradeOf(k.name) === grade; });
          // بلا شعبة في الكشف: الشعبة الوحيدة لهذا الصف. بشعبة: التي تحمل الحرف نفسه
          var hit = section ? same.filter(function (k) { return sectionOf(k.name) === section; }) : same.length === 1 ? same : [];
          var label = cells[col.grade] + (section ? ' (' + cells[col.section].trim() + ')' : '');
          if (hit.length === 1) found.push({ name: hit[0].name, teacher: teacher }); else missing.push(label + ': ' + teacher);
        });
      });
      if (!found.length && !missing.length) throw new Error('لم يُعثر في الملف على جدول فيه عمودا «الصف» و«مربي الصف»');
      if (!found.length) return alert('لم تُطابَق أي شعبة. عرّف الشعب أولًا بأسماء فيها الصف والشعبة مثل «السابع (أ)».\n\n' + missing.join('\n'));
      if (!confirm('سيُسجَّل مربو هذه الشعب:\n\n' + found.map(function (f) { return f.name + ' ← ' + f.teacher; }).join('\n') +
        (missing.length ? '\n\nلم تُطابَق بشعبة معرّفة (تُكتب يدويًا):\n' + missing.join('\n') : '') + '\n\nهل تريد المتابعة؟')) return;
      var byName = {};
      found.forEach(function (f) { byName[f.name] = f.teacher; });
      saveClassConfig({ rooms: cfg.rooms, list: cfg.list.map(function (k) { return byName[k.name] ? Object.assign({}, k, { teacher: byName[k.name] }) : k; }) });
    } catch (err) {
      toast('تعذر قراءة الملف: ' + err.message, true);
    }
  }

  // اسم مستخدم مقترح لمربي الشعبة: class7a ،class1…
  function homeroomLogin(name) {
    var letters = { 'ا': 'a', 'ب': 'b', 'ج': 'c', 'د': 'd', 'ه': 'e', 'و': 'f' }, sec = sectionOf(name);
    return 'class' + (gradeOf(name) || '') + (letters[sec] || '');
  }

  function hasAccount(fullName) {
    var n = norm(fullName);
    return S.users.some(function (u) { return norm(u.full_name) === n; });
  }

  // بطاقة في «إعداد الفصول»: مربو الفصول الذين لا حساب لهم، مع اسم مستخدم لكل واحد
  function homeroomAccountsHtml() {
    var list = classConfig().list.filter(function (k) { return k.teacher; });
    if (!list.length) return '';
    var todo = list.filter(function (k) { return !hasAccount(k.teacher); });
    return '<div class="card"><h2>حسابات مربي الفصول</h2>' +
      (todo.length
        ? '<p class="hint">يُنشأ لكل مربٍّ حساب بالصلاحية وكلمة المرور المؤقتة المحددتين، ويُطلب منه تغييرها عند أول دخول. يلزم تشغيل <code dir="ltr">supabase/registrar.sql</code> مرة واحدة.</p>' +
          '<div class="table-wrap"><table class="grid"><thead><tr><th>الشعبة</th><th>مربي الصف</th><th>اسم المستخدم</th></tr></thead><tbody>' +
          todo.map(function (k) {
            return '<tr><td>' + esc(k.name) + '</td><td>' + esc(k.teacher) + '</td>' +
              '<td><input type="text" dir="ltr" style="text-align:right" data-hlogin="' + esc(k.name) + '" value="' + esc(homeroomLogin(k.name)) + '" aria-label="اسم مستخدم ' + esc(k.teacher) + '"></td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="grid2" style="margin-top:12px">' +
            '<div><label class="field" for="h-role">الصلاحية</label><select id="h-role"><option value="registrar">' + ROLES.registrar + '</option><option value="viewer">' + ROLES.viewer + '</option><option value="supervisor">' + ROLES.supervisor + '</option></select></div>' +
            '<div><label class="field" for="h-pw">كلمة المرور المؤقتة (6 أحرف على الأقل)</label><input type="text" id="h-pw" dir="ltr" style="text-align:right" autocomplete="off" value="' + esc(S.defaultPw || '') + '"></div>' +
          '</div><div class="actions"><button type="button" class="btn primary" data-hcreate>إنشاء الحسابات (' + todo.length + ')</button></div>'
        : '<p class="hint" style="margin:0">لكل مربي الفصول (' + list.length + ') حسابات دخول.</p>') + '</div>';
  }

  async function createHomeroomAccounts(btn) {
    var pw = document.getElementById('h-pw').value, role = document.getElementById('h-role').value;
    if (pw.length < 6) return toast('كلمة المرور المؤقتة يجب ألا تقل عن 6 أحرف.', true);
    var jobs = [];
    classConfig().list.forEach(function (k) {
      var box = app.querySelector('[data-hlogin="' + k.name.replace(/"/g, '\\"') + '"]');
      if (box && box.value.trim()) jobs.push({ teacher: k.teacher, login: box.value.trim() });
    });
    if (!jobs.length) return;
    if (!confirm('إنشاء ' + jobs.length + ' حسابًا بصلاحية «' + ROLES[role] + '»؟\n\n' + jobs.map(function (j) { return j.teacher + ' ← ' + j.login; }).join('\n'))) return;
    btn.disabled = true;
    var done = 0, errors = [];
    for (var i = 0; i < jobs.length; i++) {
      var r = await sb.rpc('create_user_account', { p_name: jobs[i].teacher, p_login: toEmail(jobs[i].login), p_password: pw, p_role: role });
      if (r.error) {
        if (/could not find the function|schema cache|PGRST202/i.test((r.error.message || '') + (r.error.code || ''))) { btn.disabled = false; return accountRpcFail(r.error); }
        errors.push(jobs[i].teacher + ' (' + jobs[i].login + '): ' + r.error.message);
      } else done++;
    }
    var list = await sb.from('profiles').select('*').order('created_at');
    if (!list.error) S.users = list.data || [];
    render();
    if (errors.length) alert('لم تُنشأ هذه الحسابات:\n\n' + errors.join('\n'));
    toast('أُنشئت الحسابات: ' + done + (errors.length ? ' · تعذّر: ' + errors.length : ''), !!errors.length);
  }

  function renderRooms() {
    var cfg = classConfig(), counts = classCounts(), sum = { cap: 0, n: 0 };
    var genderSelect = function (attrs, current) {
      return '<select ' + attrs + '><option value="">— لم يُحدَّد —</option>' + Object.keys(CLASS_GENDERS).map(function (k) {
        return '<option value="' + k + '"' + (k === current ? ' selected' : '') + '>' + CLASS_GENDERS[k] + '</option>';
      }).join('') + '</select>';
    };
    var rows = cfg.list.map(function (c, i) {
      var n = counts[c.name] || 0, left = c.capacity == null ? null : c.capacity - n;
      sum.cap += c.capacity || 0; sum.n += n;
      return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(c.name) + '</b></td>' +
        '<td>' + genderSelect('data-rgender="' + esc(c.name) + '" aria-label="جنس ' + esc(c.name) + '"', c.gender) + '</td>' +
        '<td><input type="number" min="1" step="1" data-rcap="' + esc(c.name) + '" aria-label="سعة ' + esc(c.name) + '" value="' + (c.capacity == null ? '' : c.capacity) + '"></td>' +
        '<td><input type="text" list="dl-teachers" style="min-width:150px" data-rteacher="' + esc(c.name) + '" aria-label="مربي ' + esc(c.name) + '" value="' + esc(c.teacher) + '"></td>' +
        '<td><a href="#/classes/' + encodeURIComponent(c.name) + '">' + n + '</a></td>' +
        '<td>' + (left == null ? '—' : left < 0 ? '<span class="badge unpaid">تجاوز بـ ' + (-left) + '</span>' : left === 0 ? '<span class="badge part">ممتلئة</span>' : '<span class="badge paid">' + left + '</span>') + '</td>' +
        '<td><button type="button" class="btn danger" data-rdel="' + esc(c.name) + '">حذف</button></td></tr>';
    }).join('');
    var free = cfg.rooms - cfg.list.length;

    var hrHtml = homeroomAccountsHtml(), rmTab = hrHtml ? vtab('rooms', 'list') : 'list';
    if (rmTab === 'accounts') { app.innerHTML = tabs('rooms') + vtabsHtml('rooms', 'list', [['list', 'الغرف والشعب'], ['accounts', 'حسابات مربي الفصول']]) + hrHtml; return; }
    app.innerHTML = tabs('rooms') + (hrHtml ? vtabsHtml('rooms', 'list', [['list', 'الغرف والشعب'], ['accounts', 'حسابات مربي الفصول']]) : '') +
      '<div class="toolbar"><button type="button" class="btn" data-act="print"' + (cfg.list.length ? '' : ' disabled') + '>طباعة / تصدير PDF</button>' +
        '<button type="button" class="btn" data-homeroom' + (cfg.list.length ? '' : ' disabled') + '>استيراد مربي الفصول من ملف Word</button>' +
        '<input type="file" id="homeroom-file" accept=".docx" hidden></div>' +
      '<div class="card"><h2>الغرف المدرسية</h2>' +
        '<div class="toolbar" style="align-items:center;margin-top:8px"><label class="field" for="rooms-count" style="margin:0">عدد الغرف المتاحة للتدريس</label>' +
        '<input type="number" id="rooms-count" min="0" step="1" style="width:110px" value="' + (cfg.rooms || '') + '">' +
        '<span class="st-count" style="margin:0">' + (cfg.rooms
          ? 'الشعب المعرّفة: ' + cfg.list.length + ' من ' + cfg.rooms + ' غرفة' + (free > 0 ? ' — غرف بلا شعبة: ' + free : '')
          : 'اكتب عدد الغرف أولًا، ثم عرّف شعبة لكل غرفة.') + '</span></div>' +
        (cfg.rooms && free < 0 ? '<div class="formhint" style="margin-top:8px">عدد الشعب (' + cfg.list.length + ') أكبر من عدد الغرف (' + cfg.rooms + ').</div>' : '') + '</div>' +
      '<div class="card"><h2>الشعب</h2>' +
        '<p class="hint">لكل شعبة جنسها وسعتها القصوى. يظهر العدد المسجَّل والمتاح عند اختيار الشعبة في تسجيل الطلاب، وينبّه البرنامج عند تجاوز السعة أو اختلاف الجنس دون أن يمنع التسجيل.</p>' +
        (rows
          ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الشعبة</th><th>الجنس</th><th>السعة القصوى</th><th>مربي الصف</th><th>المسجلون نهائيًا</th><th>المتاح</th><th></th></tr></thead>' +
            '<tbody>' + rows + '</tbody><tfoot><tr><td colspan="3">المجموع</td><td>' + (sum.cap || '—') + '</td><td></td><td>' + sum.n + '</td><td colspan="2">' + (sum.cap ? 'المتاح: ' + Math.max(0, sum.cap - sum.n) : '') + '</td></tr></tfoot></table></div>'
          : '<div class="empty">لا توجد شعب بعد.</div>') +
        '<form id="room-form" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)"><h3 style="margin:0 0 8px">إضافة شعبة</h3><div class="grid2">' +
          '<div><label class="field" for="nr-name">اسم الشعبة <span class="req">*</span></label><input type="text" id="nr-name" required placeholder="مثال: السابع (أ)"></div>' +
          '<div><label class="field" for="nr-gender">الجنس</label>' + genderSelect('id="nr-gender"', '') + '</div>' +
          '<div><label class="field" for="nr-cap">السعة القصوى</label><input type="number" id="nr-cap" min="1" step="1" placeholder="مثال: 30"></div>' +
          '<div><label class="field" for="nr-teacher">مربي الصف</label><input type="text" id="nr-teacher" list="dl-teachers"></div>' +
          '</div><div class="actions"><button type="submit" class="btn primary">إضافة الشعبة</button></div></form>' +
        '<datalist id="dl-teachers">' + evalTeachers().map(function (t) { return '<option value="' + esc(t.name) + '">'; }).join('') + '</datalist></div>';
  }

  function addRoomClass() {
    var cfg = classConfig(), name = document.getElementById('nr-name').value.replace(/\s+/g, ' ').trim();
    if (!name) return;
    if (cfg.names.indexOf(name) > -1) return toast('هذه الشعبة موجودة مسبقًا.', true);
    var cap = Number(document.getElementById('nr-cap').value);
    if (cfg.rooms && cfg.list.length >= cfg.rooms && !confirm('كل الغرف (' + cfg.rooms + ') لها شعب. هل تريد إضافة شعبة أخرى مع ذلك؟')) return;
    saveClassConfig({ rooms: cfg.rooms, list: cfg.list.concat([{ name: name, gender: document.getElementById('nr-gender').value, capacity: cap > 0 ? Math.floor(cap) : null, teacher: document.getElementById('nr-teacher').value.replace(/\s+/g, ' ').trim() }]) }, 'nr-name');
  }

  document.addEventListener('click', function (e) {
    if (!isAdmin() || location.hash !== '#/rooms') return;
    if (e.target.closest('[data-homeroom]')) return document.getElementById('homeroom-file').click();
    var create = e.target.closest('[data-hcreate]');
    if (create) return createHomeroomAccounts(create);
    var el = e.target.closest('[data-rdel]');
    if (!el) return;
    var name = el.getAttribute('data-rdel'), cfg = classConfig(), n = classCounts()[name] || 0;
    if (!confirm(n ? 'في الشعبة «' + name + '» ' + n + ' طالبًا مسجلًا. حذفها من القائمة لا يحذف الطلاب، لكنهم يبقون على اسمها إلى أن تنقلهم. هل تريد الحذف؟'
      : 'حذف الشعبة «' + name + '»؟')) return;
    saveClassConfig({ rooms: cfg.rooms, list: cfg.list.filter(function (c) { return c.name !== name; }) });
  });

  app.addEventListener('change', function (e) {
    var el = e.target;
    if (!isAdmin() || location.hash !== '#/rooms') return;
    var cfg = classConfig();
    if (el.id === 'rooms-count') {
      saveClassConfig({ rooms: Math.max(0, Math.floor(Number(el.value) || 0)), list: cfg.list });
    } else if (el.id === 'homeroom-file') {
      if (el.files[0]) readHomeroomFile(el.files[0]);
    } else if (el.hasAttribute('data-rgender') || el.hasAttribute('data-rcap') || el.hasAttribute('data-rteacher')) {
      var name = el.getAttribute('data-rgender') || el.getAttribute('data-rcap') || el.getAttribute('data-rteacher'), cap = Number(el.value);
      saveClassConfig({ rooms: cfg.rooms, list: cfg.list.map(function (c) {
        if (c.name !== name) return c;
        return Object.assign({}, c, el.hasAttribute('data-rteacher') ? { teacher: el.value.replace(/\s+/g, ' ').trim() }
          : el.hasAttribute('data-rgender') ? { gender: el.value } : { capacity: cap > 0 ? Math.floor(cap) : null });
      }) });
    }
  });

  /* ---------- تصدير «كشوف تسجيل الطلاب» في ملف الأكاديمية الجاهز ----------
     القالب registration-template.xlsx (تعليمات، ملخص، وورقة لكل صف: الأول–السادس مختلطة، والسابع–التاسع بنات/ذكور)
     يُملأ ببيانات المسجلين نهائيًا مع بقاء تصميمه ومعادلاته كما هي: تُعدَّل ملفات XML داخل الملف مباشرة.
     في كل ورقة: الطلاب في الصفوف من 10، وعددها في القالب = القدرة الاستيعابية؛ إن زاد المسجلون تُضاف صفوف ويُزاح ما بعدها */

  function loadFflate() {
    if (window.fflate) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';
      sc.onload = resolve;
      sc.onerror = function () { reject(new Error('تعذر تحميل مكتبة ضغط الملفات')); };
      document.head.appendChild(sc);
    });
  }

  function xmlEsc(v) {
    return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function reEsc(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // يغيّر القيمة المحفوظة لخلية (رقم أو ناتج معادلة) دون المساس بمعادلتها وتنسيقها
  function setCellValue(xml, ref, value) {
    return xml.replace(new RegExp('(<c r="' + ref + '"[^>]*>(?:<f[^>]*>[^<]*</f>)?<v>)[^<]*(</v>)'), function (all, a, b) { return a + value + b; });
  }

  // وسم فتح الصف وتنسيق كل عمود فيه، كما في القالب
  function rowPattern(xml, r) {
    var a = xml.indexOf('<row r="' + r + '"'), b = xml.indexOf('</row>', a);
    var text = xml.slice(a, b), styles = {};
    text.replace(/<c r="([A-Z]+)\d+" s="(\d+)"/g, function (all, col, s) { styles[col] = s; });
    return { open: text.slice(0, text.indexOf('>') + 1), styles: styles };
  }

  // رقم الهاتف بلا علامة «+»
  function plainPhone(v) {
    return String(v == null ? '' : v).replace(/[+\uFF0B\u200e\u200f]/g, '').trim();
  }

  // تاريخ ISO إلى الرقم التسلسلي الذي يخزنه Excel
  function excelDate(iso) {
    var p = String(iso || '').slice(0, 10).split('-');
    return p.length === 3 ? Math.round(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) / 864e5) + 25569 : null;
  }

  // list: طلاب الورقة. capacity: القدرة الاستيعابية من «إعداد الفصول» (null: تبقى قيمة القالب). note: دالة ما يُكتب في العمود الأخير
  // noteHead: عنوان العمود الأخير بدل «ملاحظات» (إن أُعطي)
  function fillRegistrationSheet(xml, list, capacity, note, teacher, noteHead) {
    var m = xml.match(/COUNTA\(B10:B(\d+)\)/);
    if (!m) return null;
    var last = Number(m[1]), slots = last - 9, need = Math.max(slots, list.length), k = need - slots, newLast = last + k;
    var a = xml.indexOf('<row r="10"'), lastAt = xml.indexOf('<row r="' + last + '"'), b = xml.indexOf('</row>', lastAt) + 6;
    var patterns = [rowPattern(xml, 10), rowPattern(xml, 11)];
    var rows = '';
    for (var i = 0; i < need; i++) {
      var p = patterns[i % 2], r = 10 + i, x = list[i];
      var text = function (col, v) {
        return v === '' || v == null ? '<c r="' + col + r + '" s="' + p.styles[col] + '"/>'
          : '<c r="' + col + r + '" s="' + p.styles[col] + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
      };
      var birth = x ? excelDate(x.birth_date) : null;
      rows += p.open.replace(/r="\d+"/, 'r="' + r + '"') + '<c r="A' + r + '" s="' + p.styles.A + '" t="n"><v>' + (i + 1) + '</v></c>' +
        (x
          ? text('B', x.full_name + rsvText(x)) + text('C', x.gender === 'ذكر' || x.gender === 'أنثى' ? x.gender : '') +
            (birth == null ? text('D', '') : '<c r="D' + r + '" s="' + p.styles.D + '" t="n"><v>' + birth + '</v></c>') +
            text('E', x.national_id) + text('F', x.guardian_name) + text('G', x.guardian_relation) + text('H', plainPhone(x.phone)) + text('I', plainPhone(x.whatsapp)) +
            text('J', plainPhone(stVal(x, 'student_phone'))) + text('K', stVal(x, 'city') || stVal(x, 'address')) + text('L', note(x))
          : 'BCDEFGHIJKL'.split('').map(function (col) { return text(col, ''); }).join('')) + '</row>';
    }
    var head = xml.slice(0, a), tail = xml.slice(b);
    if (k) {
      // ما بعد جدول الطلاب (إن وُجد) ينزل k صفًا، ومعه الدمج ونطاقات المعادلات والقوائم المنسدلة
      var cut = tail.indexOf('</sheetData>');
      var shifted = tail.slice(0, cut).replace(/<row r="(\d+)"/g, function (all, n) { return '<row r="' + (Number(n) + k) + '"'; })
        .replace(/<c r="([A-Z]+)(\d+)"/g, function (all, col, n) { return '<c r="' + col + (Number(n) + k) + '"'; });
      var rest = tail.slice(cut).replace(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g, function (all, c1, r1, c2, r2) {
        return Number(r1) > last ? '<mergeCell ref="' + c1 + (Number(r1) + k) + ':' + c2 + (Number(r2) + k) + '"' : all;
      });
      var range = new RegExp('([A-L])10:(?:\\1)' + last + '(?!\\d)', 'g'), grow = function (all, col) { return col + '10:' + col + newLast; };
      head = head.replace(range, grow).replace(/(<dimension ref="A1:L)(\d+)"/, function (all, pre, n) { return pre + (Number(n) + k) + '"'; });
      tail = shifted + rest.replace(range, grow);
    }
    var boys = list.filter(function (x) { return x.gender === 'ذكر'; }).length, girls = list.filter(function (x) { return x.gender === 'أنثى'; }).length;
    var cap = capacity == null ? slots : capacity;
    if (noteHead) head = head.replace(/<c r="L9" s="(\d+)"[^>]*>.*?<\/c>/, function (all, sid) { return '<c r="L9" s="' + sid + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(noteHead) + '</t></is></c>'; });
    // خانة «اسم مربي الصف» (C5)
    if (teacher) head = head.replace(/<c r="C5" s="(\d+)"\/>/, function (all, sid) { return '<c r="C5" s="' + sid + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(teacher) + '</t></is></c>'; });
    head = setCellValue(setCellValue(setCellValue(setCellValue(setCellValue(head, 'F6', cap), 'C7', list.length), 'F7', cap - list.length), 'I6', boys), 'I7', girls);
    return { xml: head + rows + tail, added: k, capacity: cap, count: list.length };
  }

  async function exportRegistrationWorkbook(btn) {
    if (!(await syncData(true))) return;
    btn = document.querySelector('[data-regbook]') || btn; // الشاشة أُعيد رسمها بعد المزامنة
    btn.disabled = true;
    try {
      await loadFflate();
      var res = await fetch('registration-template.xlsx?v=2');
      if (!res.ok) throw new Error('تعذر تحميل قالب الكشوف');
      var files = fflate.unzipSync(new Uint8Array(await res.arrayBuffer()));
      var read = function (name) { return fflate.strFromU8(files[name]); };
      var write = function (name, text) { files[name] = fflate.strToU8(text); };

      // اسم كل ورقة وملفها داخل القالب
      var parse = function (name) { return new DOMParser().parseFromString(read(name), 'application/xml'); };
      var target = {}, sheetFile = {};
      Array.prototype.forEach.call(parse('xl/_rels/workbook.xml.rels').getElementsByTagName('Relationship'), function (r) { target[r.getAttribute('Id')] = r.getAttribute('Target'); });
      Array.prototype.forEach.call(parse('xl/workbook.xml').getElementsByTagName('sheet'), function (sh) {
        var id = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        sheetFile[sh.getAttribute('name')] = 'xl/' + String(target[id]).replace(/^\/?xl\//, '');
      });

      var finals = S.students.filter(function (x) { return enrolled(x) && x.class_name; });

      // العمود الأخير: دفع المواصلات عن الشهر المعروض في شاشة المواصلات (أو الشهر الحالي).
      // الدفعات يقرؤها مدير النظام وحده؛ لغيره يبقى العمود «ملاحظات» كما في القالب
      var payHead = '', payNote = null;
      if (canView() && !S.transportMissing) {
        if (!ui.tMonth) ui.tMonth = currentCycle();
        var payMonth = ui.tMonth;
        var payRowsNow = await fetchAll(function () { return sb.from('transport_payments').select('*').eq('month', payMonth).order('student_id'); });
        if (!payRowsNow) throw new Error('تعذر جلب دفعات المواصلات');
        var payMap = {}, memberOf = {};
        payRowsNow.forEach(function (p) { p.amount = Number(p.amount) || 0; payMap[p.student_id] = p; });
        S.tPay[payMonth] = payMap;
        S.tMembers.forEach(function (m) { memberOf[m.student_id] = m; });
        payHead = 'دفع المواصلات (' + tLabel(payMonth) + ')';
        payNote = function (x) {
          var m = memberOf[x.id], paid = (payMap[x.id] || {}).amount || 0;
          if (!m) return paid > 0 ? 'مدفوع ' + plainNum(paid) : '';
          if (!owesThisMonth(m)) return subscribedIn(m, payMonth) ? 'لم يبدأ الاشتراك' : 'اشتراك متوقف';
          var share = shareOf(m);
          return paid <= 0 ? 'لم يدفع (' + plainNum(share) + ')' : paid >= share ? 'مدفوع ' + plainNum(paid) : 'مدفوع ' + plainNum(paid) + ' من ' + plainNum(share);
        };
      }
      // صف الشعبة من اسمها؛ الروضة (KG2…) ليست صفًّا من صفوف الملف ولو كان في اسمها رقم
      var gradeIn = function (name) { return /kg|روض|تمهيد/i.test(name) ? 0 : gradeOf(name); };
      var placed = {}, stats = {}, workbook = read('xl/workbook.xml'), total = 0, extra = 0;
      Object.keys(sheetFile).forEach(function (name) {
        var grade = gradeIn(name), side = /بنات|إناث/.test(name) ? 'girls' : /ذكور|بنين/.test(name) ? 'boys' : '';
        if (!grade || !/COUNTA\(B10:B\d+\)/.test(read(sheetFile[name]))) return; // ليست ورقة صف
        // أين يقع الطالب في الأوراق المقسومة: جنس شعبته إن حُدِّد (ذكور/إناث)، وإلا جنسه هو
        var sideOf = function (x) {
          var info = classInfo(x.class_name);
          return info && (info.gender === 'boys' || info.gender === 'girls') ? info.gender : x.gender === 'ذكر' ? 'boys' : x.gender === 'أنثى' ? 'girls' : '';
        };
        var list = finals.filter(function (x) { return gradeIn(x.class_name) === grade && (!side || sideOf(x) === side); });
        var sections = {};
        list.forEach(function (x) { placed[x.id] = true; sections[x.class_name] = true; });
        // القدرة من «إعداد الفصول»: مجموع سعات شعب هذا الصف (وهذا الجنس)، إن حُدِّدت كلها
        var mine = classConfig().list.filter(function (c) { return gradeIn(c.name) === grade && (!side || c.gender === side); });
        var cap = mine.length && mine.every(function (c) { return c.capacity != null; }) ? mine.reduce(function (sum, c) { return sum + c.capacity; }, 0) : null;
        var many = Object.keys(sections).length > 1;
        // مربو شعب هذه الورقة: من «إعداد الفصول» (للشعب المقسومة: الشعبة التي جنسها جنس الورقة، أو التي فيها طلاب الورقة)
        var teachers = [];
        classConfig().list.forEach(function (c) {
          if (c.teacher && gradeIn(c.name) === grade && (!side || c.gender === side || sections[c.name]) && teachers.indexOf(c.teacher) < 0) teachers.push(c.teacher);
        });
        var out = fillRegistrationSheet(read(sheetFile[name]), list, cap, payNote || function (x) { return many ? x.class_name : ''; }, teachers.join(' / '), payHead);
        write(sheetFile[name], out.xml);
        stats[name] = out;
        total += out.count;
        if (out.added) {
          extra += out.added;
          workbook = workbook.replace(new RegExp('((?:&apos;|\')?' + reEsc(name) + '(?:&apos;|\')?!\\$A\\$1:\\$L\\$)(\\d+)'), function (all, pre, n) { return pre + (Number(n) + out.added); });
        }
      });
      if (!Object.keys(stats).length) throw new Error('القالب لا يحتوي على أوراق الصفوف المتوقعة');

      // ورقة الملخص: القيم المحفوظة لمعادلاتها، ليظهر الملف صحيحًا حتى في برامج لا تعيد الحساب
      var sumFile = sheetFile['الملخص'];
      if (sumFile) {
        var sum = read(sumFile), all = { cap: 0, n: 0 };
        sum.replace(/<c r="E(\d+)"[^>]*><f[^>]*>(?:&apos;|')?([^!<]+?)(?:&apos;|')?!F6<\/f>/g, function (m0, row, name) {
          var st = stats[name];
          if (!st) return m0;
          all.cap += st.capacity; all.n += st.count;
          sum = setCellValue(setCellValue(setCellValue(setCellValue(sum, 'E' + row, st.capacity), 'F' + row, st.count), 'G' + row, st.capacity - st.count),
            'H' + row, st.capacity ? st.count / st.capacity : 0);
          return m0;
        });
        var tot = sum.match(/<c r="E(\d+)"[^>]*><f[^>]*>SUM\(/);
        if (tot) {
          sum = setCellValue(setCellValue(setCellValue(setCellValue(sum, 'E' + tot[1], all.cap), 'F' + tot[1], all.n), 'G' + tot[1], all.cap - all.n),
            'H' + tot[1], all.cap ? all.n / all.cap : 0);
        }
        write(sumFile, sum);
      }
      // Excel يعيد حساب المعادلات كلها عند فتح الملف
      workbook = /<calcPr\b/.test(workbook)
        ? workbook.replace(/<calcPr\b(?![^>]*fullCalcOnLoad)/, '<calcPr fullCalcOnLoad="true"')
        : workbook.replace('</definedNames>', '</definedNames><calcPr fullCalcOnLoad="true"/>');
      write('xl/workbook.xml', workbook);

      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([fflate.zipSync(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = 'كشوف-تسجيل-الطلاب-' + todayISO() + '.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      var left = finals.filter(function (x) { return !placed[x.id]; }).length;
      toast('صُدّرت الكشوف — الطلاب المدرجون: ' + total + (extra ? ' · صفوف أُضيفت فوق القدرة: ' + extra : '') +
        (left ? ' · لم يُدرج: ' + left + ' (شعبتهم خارج صفوف الملف أو جنسهم غير محدد)' : ''), !!left);
    } catch (err) {
      toast(err.message, true);
    }
    btn.disabled = false;
  }

  /* ---------- النسخ الاحتياطي والاستعادة (مدير النظام) ----------
     النسخة ملف JSON واحد فيه جداول البرنامج كلها. الاستعادة تعيد كل سجل في الملف إلى ما كان عليه
     (تُرجع المحذوف وتُصحّح المعدَّل) ولا تحذف ما أُضيف بعد أخذ النسخة.
     الحسابات وكلمات المرور ليست في النسخة: تديرها خدمة الدخول */

  // بترتيب يحترم الارتباطات: المعلمون قبل زياراتهم، والطلاب والمجموعات قبل الاشتراكات والدفعات.
  // key: ما يُعرَف به السجل عند الاستعادة. insertOnly: جدول لا يُسمح بتعديل صفوفه، فتُضاف الناقصة فقط
  var BACKUP_TABLES = [
    { name: 'teachers', label: 'المعلمون', key: 'id' },
    { name: 'visits', label: 'الزيارات الإشرافية', key: 'id' },
    { name: 'statements', label: 'عبارات التقارير المضافة', key: 'id', insertOnly: true },
    { name: 'students', label: 'الطلاب', key: 'id' },
    { name: 'transport_groups', label: 'مجموعات المواصلات', key: 'id' },
    { name: 'transport_members', label: 'اشتراكات المواصلات', key: 'student_id' },
    { name: 'transport_payments', label: 'دفعات المواصلات', key: 'student_id,month', drop: ['id'] },
    { name: 'transport_voided', label: 'أرشيف الإيصالات المحذوفة', key: 'id' },
    { name: 'transport_refunds', label: 'مستردات المواصلات', key: 'id' },
    // الإيصالات المكمِّلة لا تُعدَّل بعد صدورها (supabase/transport_topups.sql)، فيُضاف الناقص منها فقط
    { name: 'transport_topups', label: 'الإيصالات المكمِّلة', key: 'receipt_no', insertOnly: true },
    // مواصلات الموظفين (supabase/transport_staff.sql): إيصالاتهم لا تُعدَّل، فيُضاف الناقص منها فقط
    { name: 'transport_staff_members', label: 'مواصلات الموظفين', key: 'staff_id' },
    { name: 'transport_staff_payments', label: 'إيصالات مواصلات الموظفين', key: 'receipt_no', insertOnly: true },
    { name: 'transport_staff_refunds', label: 'مستردات مواصلات الموظفين', key: 'id', insertOnly: true },
    { name: 'attendance', label: 'الحضور والغياب', key: 'student_id,day' },
    { name: 'timetable_config', label: 'إعدادات جدول الحصص', key: 'id' },
    { name: 'timetable_sessions', label: 'حصص الجدول', key: 'id' },
    { name: 'timetable_proposals', label: 'مقترحات تحسين الجدول', key: 'id' },
    { name: 'teacher_absences', label: 'غياب المعلمين', key: 'id' },
    { name: 'substitutions', label: 'حصص الاحتياط', key: 'id' },
    { name: 'staff_hours', label: 'الوقت الرسمي للدوام', key: 'id' },
    { name: 'staff_attendance', label: 'دوام الموظفين', key: 'teacher_id,day' }
  ];
  var BACKUP_MARK = 'third-pillar-backup';

  function backupSummary(tables) {
    return BACKUP_TABLES.map(function (t) { return t.label + ': ' + ((tables[t.name] || []).length); }).join(' · ');
  }

  async function downloadBackup(btn) {
    btn.disabled = true;
    var tables = {};
    for (var i = 0; i < BACKUP_TABLES.length; i++) {
      var t = BACKUP_TABLES[i], rows = await fetchAll(function () { return sb.from(t.name).select('*').order(t.key.split(',')[0]); });
      // جدول لم يُنشأ بعد يُتخطى
      if (rows) tables[t.name] = rows;
    }
    var cfg = await sb.from('settings').select('*').eq('id', 1).maybeSingle();
    btn.disabled = false;
    if (!tables.students && !tables.teachers) return toast('تعذر قراءة البيانات؛ لم تُنشأ النسخة', true);
    var d = new Date(), two = function (n) { return ('0' + n).slice(-2); };
    var file = { app: BACKUP_MARK, version: 1, created_at: d.toISOString(), school: schoolName(), settings: cfg.data || null, tables: tables };
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
    a.download = 'نسخة-احتياطية-' + todayISO() + '-' + two(d.getHours()) + two(d.getMinutes()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    try { localStorage.setItem('last-backup', d.toISOString()); } catch (err) { /* التخزين المحلي غير متاح */ }
    toast('نُزّلت النسخة الاحتياطية — ' + backupSummary(tables));
    render();
  }

  async function restoreBackup(fileObj) {
    var data;
    try { data = JSON.parse(await fileObj.text()); } catch (err) { data = null; }
    if (!data || data.app !== BACKUP_MARK || !data.tables) return toast('هذا الملف ليس نسخة احتياطية من البرنامج', true);
    var when = new Date(data.created_at).toLocaleString('ar-u-nu-latn', { dateStyle: 'long', timeStyle: 'short' });
    if (!confirm('استعادة النسخة المأخوذة في ' + when + '؟\n\n' + backupSummary(data.tables) +
      '\n\nكل سجل في النسخة يعود إلى ما كان عليه وقتها، فيضيع أي تعديل أُجري عليه بعدها. ما أُضيف بعد النسخة يبقى كما هو.')) return;
    if (!confirm('تأكيد أخير: يُنصح بتنزيل نسخة احتياطية من الوضع الحالي أولًا. هل تريد المتابعة بالاستعادة الآن؟')) return;

    app.innerHTML = tabs('admin') + '<div class="card empty" id="restore-progress">جارٍ الاستعادة…</div>';
    var box = document.getElementById('restore-progress'), errors = [], done = 0;
    for (var i = 0; i < BACKUP_TABLES.length; i++) {
      var t = BACKUP_TABLES[i], rows = data.tables[t.name] || [];
      if (t.drop) rows = rows.map(function (r) { var c = Object.assign({}, r); t.drop.forEach(function (k) { delete c[k]; }); return c; });
      for (var from = 0; from < rows.length; from += 200) {
        box.textContent = 'جارٍ الاستعادة… ' + t.label + ' (' + Math.min(from + 200, rows.length) + ' من ' + rows.length + ')';
        var opts = { onConflict: t.key };
        if (t.insertOnly) opts.ignoreDuplicates = true;
        var r = await sb.from(t.name).upsert(rows.slice(from, from + 200), opts);
        if (r.error) { errors.push(t.label + ': ' + r.error.message); break; }
        done += Math.min(200, rows.length - from);
      }
    }
    if (data.settings) {
      var cfg = Object.assign({}, data.settings);
      delete cfg.id;
      var up = await sb.from('settings').update(cfg).eq('id', 1);
      if (up.error) errors.push('الإعدادات: ' + up.error.message);
    }
    await loadAll();
    if (errors.length) alert('اكتملت الاستعادة مع أخطاء:\n\n' + errors.join('\n'));
    toast(errors.length ? 'اكتملت الاستعادة مع أخطاء' : 'تمت الاستعادة — سجلات: ' + done, !!errors.length);
  }

  /* ---------- سجل التعديلات (المدير العام) ----------
     تكتبه القاعدة نفسها عند كل إضافة أو تعديل أو حذف (supabase/audit_log.sql)، وتعرضه هذه الشاشة بالعربية.
     التعديل يحمل الحقول التي تغيّرت فقط، بقيمها قبل وبعد. العمليات الجماعية (استيراد جدول مثلًا) تُجمع في سطر واحد */
  var AUDIT_TBL = {
    students: 'الطلاب', teachers: 'المعلمون والعاملون', profiles: 'المستخدمون', settings: 'الإعدادات',
    transport_groups: 'الباصات', transport_members: 'اشتراكات المواصلات', transport_payments: 'إيصالات المواصلات',
    transport_topups: 'الإيصالات المكمِّلة', transport_refunds: 'المستردات', transport_voided: 'أرشيف الإيصالات المحذوفة',
    transport_staff_members: 'مواصلات الموظفين', transport_staff_payments: 'إيصالات مواصلات الموظفين', transport_staff_refunds: 'مستردات الموظفين',
    timetable_sessions: 'جدول الحصص', timetable_config: 'إعدادات الجدول', timetable_proposals: 'مقترحات تحسين الجدول', attendance: 'الحضور والغياب',
    teacher_absences: 'غياب المعلمين', substitutions: 'حصص الاحتياط', staff_attendance: 'دوام الموظفين', staff_hours: 'الوقت الرسمي للدوام',
    payroll_setup: 'إعدادات الرواتب', payroll_runs: 'حساب الرواتب', payroll_access: 'صلاحية الرواتب', staff_bot_phones: 'أرقام بوت الدوام',
    grades: 'الدرجات', grade_items: 'إعداد الدرجات', student_leaves: 'إجازات الطلاب والفصل المؤقت', discipline_records: 'سجل المخالفات',
    student_exits: 'إذن خروج الطلاب', payment_claims: 'سندات الصرف', orders: 'الطلبيات', custody_items: 'العهد', committees: 'اللجان المدرسية',
    committee_members: 'أعضاء اللجان', student_lists: 'قوائم الطلاب', visits: 'الزيارات الإشرافية', statements: 'عبارات الزيارات'
  };
  var AUDIT_ACT = { insert: 'إضافة', update: 'تعديل', 'delete': 'حذف' };
  var AUDIT_FIELD = {
    full_name: 'الاسم', name: 'الاسم', class_name: 'الشعبة', status: 'الحالة', national_id: 'رقم الهوية', phone: 'الجوال', whatsapp: 'الواتساب',
    details: 'بيانات التسجيل', wants_transport: 'يحتاج مواصلات', filled_by: 'مدخل البيانات', amount: 'المبلغ', paid_on: 'تاريخ السداد',
    method: 'وسيلة الدفع', method_note: 'رقم الدفع / ملاحظة', receipt_no: 'رقم الإيصال', due: 'المطلوب', issued_by: 'المسجِّل', month: 'الشهر',
    group_id: 'الباص', pickup: 'نقطة الركوب', grace_until: 'مهلة حتى', suspended_month: 'موقوف عن الركوب في', left_from: 'إيقاف الاشتراك من',
    exempt_from: 'الإعفاء من', exempt_to: 'الإعفاء حتى', assembly_point: 'نقطة التجمع', fee: 'الاشتراك', capacity: 'السعة',
    role: 'الصلاحية', email: 'اسم المستخدم', subject: 'المادة', teacher_id: 'المعلم', day: 'اليوم', period: 'الحصة', note: 'ملاحظة',
    ratings: 'درجات التقييم', notes: 'الملاحظات', approver_notes: 'ملاحظات المعتمد', visible: 'ظاهر', category: 'الفئة', title: 'المسمى الوظيفي',
    classes: 'الصفوف والشعب', bells: 'التوقيت والأجراس', days: 'أيام الدراسة', subjects: 'المواد', quota: 'النصاب', rules: 'القواعد',
    sub_teacher_id: 'معلم الاحتياط', absent_teacher_id: 'المعلم الغائب', periods: 'الحصص', reason: 'السبب', time_in: 'الحضور', time_out: 'الانصراف',
    salaries: 'الرواتب', adj: 'الإضافات والخصومات', rows: 'كشف الشهر', approved_by: 'المعتمِد', approved_at: 'وقت الاعتماد',
    score: 'الدرجة', max_score: 'الدرجة العظمى', term: 'الفصل الدراسي', sort: 'الترتيب', from_day: 'من', to_day: 'إلى', kind: 'النوع', violation: 'المخالفة',
    action: 'الإجراء', exit_time: 'ساعة الخروج', payee: 'المستفيد', payee_id: 'هوية المستفيد', description: 'البيان', items: 'البنود', payer: 'مسلِّم المبلغ',
    claim_date: 'التاريخ', order_date: 'التاريخ', recipient: 'الجهة', recipient2: 'الجهة (سطر ثانٍ)', intro: 'المقدمة', closing: 'الخاتمة', item: 'الصنف', qty: 'العدد',
    student_ids: 'الطلاب', yes_label: 'وصف المختارين', no_label: 'وصف غير المختارين', visit_date: 'تاريخ الزيارة', class_section: 'الشعبة', lesson_title: 'عنوان الدرس',
    strengths: 'نقاط القوة', development: 'جوانب التطوير', recommendations: 'التوصيات', body: 'النص', field: 'المجال'
  };

  function auditState() {
    if (!ui.audit) ui.audit = { from: todayISO().slice(0, 8) + '01', to: todayISO(), who: '', tbl: '', q: '', rows: null, loading: false, missing: false };
    return ui.audit;
  }

  async function loadAudit() {
    var a = auditState();
    if (!a.from || !a.to || a.from > a.to) return toast('اختر فترة صحيحة', true);
    a.loading = true;
    render();
    var from = new Date(a.from + 'T00:00').toISOString(), to = new Date(a.to + 'T23:59:59.999').toISOString();
    var r = await sb.from('audit_log').select('*').gte('at', from).lte('at', to).order('id', { ascending: false }).limit(3000);
    a.loading = false;
    a.missing = !!r.error;
    a.rows = r.error ? null : r.data || [];
    a.cut = !!a.rows && a.rows.length >= 3000;
    render();
  }

  // قيمة الحقل كما تُقرأ: اسم المعلم بدل معرّفه، والتاريخ بصيغته، واختصار ما طال
  function auditVal(k, v, tbl) {
    if (v == null || v === '') return '—';
    if (/teacher_id$/.test(k)) { var t = S.teachers.filter(function (x) { return x.id === v; })[0]; return t ? t.name : 'معلم محذوف'; }
    if (k === 'group_id') { var g = findGroup(v); return g ? g.assembly_point : 'باص محذوف'; }
    if (k === 'role') return ROLES[v] || v;
    if (k === 'method') return PAY_METHODS[v] || v;
    if (k === 'status' && tbl === 'staff_attendance') return SA_STATUS[v] || v;
    if (k === 'day' && tbl === 'timetable_sessions') return ((S.ttConfig && S.ttConfig.days) || [])[v] || v;
    if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
    if (typeof v === 'object') return 'تغيّرت';
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(s)) return dmy(s.slice(0, 10));
    return s.length > 60 ? s.slice(0, 60) + '…' : s;
  }

  // عمّن أو عمّا يتحدث السطر: الطالب، رقم الإيصال، المعلم، الباص، الشعبة واليوم
  function auditSubject(r) {
    var row = r.new || r.old || {}, parts = [];
    if (r.tbl === 'attendance') return 'شعبة ' + (row.class_name || '') + ' — ' + dayName(row.day) + ' ' + dmy(row.day);
    if (r.tbl === 'staff_attendance') {
      // في التعديل يُحفظ ما تغيّر فقط، فالموظف واليوم من مفتاح السجل
      var sk = String(r.row_key || '').split(' | '), se = find(row.teacher_id || sk[0]), sd = String(row.day || sk[1] || '').slice(0, 10);
      return (se ? se.name : 'موظف') + (sd ? ' — ' + dayName(sd) + ' ' + dmy(sd) : '');
    }
    if (r.tbl === 'grades') return [row.item, row.subject, row.class_name ? 'شعبة ' + row.class_name : ''].filter(Boolean).join(' — ');
    if (r.tbl === 'payment_claims') parts.push('سند صرف رقم ' + r.row_key + (row.payee ? ' — ' + row.payee : ''));
    if (r.tbl === 'orders') parts.push('طلبية رقم ' + r.row_key + (row.recipient ? ' — ' + row.recipient : ''));
    if (r.tbl === 'custody_items') parts.push(row.item || '');
    if (r.tbl === 'committees' || r.tbl === 'grade_items') parts.push(row.name || '');
    if (r.tbl === 'student_lists') parts.push(row.title || '');
    if (r.tbl === 'student_leaves' && row.from_day) parts.push((row.kind === 'suspension' ? 'فصل مؤقت' : 'إجازة') + ' من ' + dmy(row.from_day) + ' إلى ' + dmy(row.to_day) + (row.reason ? ' — ' + row.reason : ''));
    if (r.tbl === 'discipline_records' && (row.violation || row.action)) parts.push([row.kind === 'warning' ? 'إنذار' : 'مخالفة', row.violation, row.action].filter(Boolean).join(' — '));
    if (r.tbl === 'student_exits' && row.day) parts.push('خروج يوم ' + dmy(row.day) + (row.reason ? ' — ' + row.reason : ''));
    if (r.tbl === 'visits' && row.teacher_id) parts.push('زيارة ' + auditVal('teacher_id', row.teacher_id, r.tbl) + (row.visit_date ? ' — ' + dmy(row.visit_date) : ''));
    if (r.tbl === 'committee_members' && row.staff_id) parts.push(auditVal('teacher_id', row.staff_id, r.tbl));
    var x = r.student_id ? findStudent(r.student_id) : null;
    var nm = x ? x.full_name : row.student_name || (r.tbl === 'students' ? row.full_name : '');
    if (nm) parts.push(nm);
    if (r.receipt_no != null) parts.push('إيصال رقم ' + r.receipt_no);
    if (row.month && r.tbl !== 'students') parts.push('عن ' + tLabel(row.month));
    if (r.tbl === 'teachers' || r.tbl === 'profiles') {
      var id = r.row_key, t = S.teachers.filter(function (q) { return q.id === id; })[0], u = S.users.filter(function (q) { return q.id === id; })[0];
      parts.push(row.name || row.full_name || (t && t.name) || (u && (u.full_name || displayName(u.email))) || '');
    }
    if (r.tbl === 'transport_groups') { var g = findGroup(r.row_key); parts.push(row.assembly_point || (g && g.assembly_point) || ''); }
    if (r.tbl === 'timetable_sessions') parts.push([row.class_name, auditVal('day', row.day, r.tbl), row.period ? 'الحصة ' + row.period : ''].filter(Boolean).join(' · '));
    if ((r.tbl === 'transport_refunds' || r.tbl === 'transport_staff_refunds') && row.refund_no) parts.push('سند استرداد رقم ' + row.refund_no);
    return parts.filter(Boolean).join(' · ');
  }

  // ما الذي تغيّر، بجملة
  function auditWhat(r) {
    if (r.tbl === 'attendance') {
      var n = r.new || {}, o = r.old || {};
      if (r.action === 'insert') return 'سُجّل الحضور: ' + n.students + ' طالبًا، الغائبون ' + n.absent;
      if (r.action === 'delete') return 'حُذف تسجيل ' + o.students + ' طالبًا';
      return (n.changes || []).map(function (c) {
        var x = findStudent(c.student_id);
        return (x ? x.full_name : 'طالب') + ': ' + (c.from === 'absent' ? 'غائب' : 'حاضر') + ' ← ' + (c.to === 'absent' ? 'غائب' : 'حاضر');
      }).join('، ');
    }
    if (r.tbl === 'grades') {
      var gn = r.new || {}, go = r.old || {};
      if (r.action === 'insert') return 'رُصدت درجات ' + gn.students + ' طالبًا';
      if (r.action === 'delete') return 'حُذفت درجات ' + go.students + ' طالبًا';
      return (gn.changes || []).map(function (c) {
        var x = findStudent(c.student_id);
        return (x ? x.full_name : 'طالب') + ': ' + (c.from == null ? '—' : c.from) + ' ← ' + (c.to == null ? '—' : c.to);
      }).join('، ');
    }
    if (r.action !== 'update') return '';
    return Object.keys(r.new || {}).map(function (k) {
      return (AUDIT_FIELD[k] || k) + ': ' + auditVal(k, (r.old || {})[k], r.tbl) + ' ← ' + auditVal(k, r.new[k], r.tbl);
    }).join(' · ');
  }

  function auditFiltered() {
    var a = auditState(), q = norm(a.q), digits = latinDigits(a.q).replace(/\D/g, '');
    return (a.rows || []).filter(function (r) {
      if (a.who && r.user_name !== a.who) return false;
      if (a.tbl && r.tbl !== a.tbl) return false;
      if (!q) return true;
      if (digits && String(r.receipt_no || '') === digits) return true;
      return norm(auditSubject(r) + ' ' + auditWhat(r)).indexOf(q) > -1;
    });
  }

  // العمليات المتتالية لنفس المستخدم على نفس الجدول بنفس النوع خلال دقيقة تُجمع إن زادت عن 3
  function auditGroups(list) {
    var out = [];
    list.forEach(function (r) {
      var last = out[out.length - 1], t = new Date(r.at).getTime();
      if (last && last.user_name === r.user_name && last.tbl === r.tbl && last.action === r.action && Math.abs(last.t - t) < 60000) { last.items.push(r); last.t = t; }
      else out.push({ user_name: r.user_name, tbl: r.tbl, action: r.action, t: t, items: [r] });
    });
    return out;
  }

  function auditWhen(at) {
    var d = new Date(at);
    return dmy(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')) + ' ' +
      d.toLocaleTimeString('ar-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
  }

  function renderAudit() {
    var a = auditState();
    var opt = function (v, label, cur) { return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(label) + '</option>'; };
    var head = '<div class="page-head"><div><h1>سجل التعديلات</h1><p>من أضاف أو عدّل أو حذف ماذا ومتى. تكتبه قاعدة البيانات نفسها، ولا يمكن تعديله أو حذفه.</p></div></div>' +
      '<div class="card"><div class="toolbar" style="align-items:center;margin:0">' +
      '<span class="monthpick"><label class="field" for="aud-from">من</label><input type="date" id="aud-from" data-ro-ok value="' + a.from + '"></span>' +
      '<span class="monthpick"><label class="field" for="aud-to">إلى</label><input type="date" id="aud-to" data-ro-ok value="' + a.to + '"></span>' +
      '<button type="button" class="btn primary" data-audrun data-ro-ok' + (a.loading ? ' disabled' : '') + '>' + (a.loading ? 'جارٍ الجلب…' : 'عرض') + '</button></div></div>';
    if (a.missing) {
      app.innerHTML = head + '<div class="card empty">سجل التعديلات يحتاج إلى جدول جديد في قاعدة البيانات.<br>شغّل الملف <code dir="ltr">supabase/audit_log.sql</code> في محرر SQL، ويبدأ التسجيل من لحظتها.</div>';
      return;
    }
    if (!a.rows) {
      app.innerHTML = head + '<div class="card empty">اختر الفترة ثم «عرض».</div>';
      if (!a.loading) loadAudit();
      return;
    }
    var who = {}, tbls = {};
    a.rows.forEach(function (r) { who[r.user_name || '—'] = 1; tbls[r.tbl] = 1; });
    var list = auditFiltered(), groups = auditGroups(list);
    var line = function (r) {
      var what = auditWhat(r), subj = auditSubject(r);
      return '<span>' + esc(subj || '—') + '</span>' + (what ? '<div class="hint" style="margin:2px 0 0">' + esc(what) + '</div>' : '');
    };
    var rows = groups.map(function (g) {
      var r = g.items[0], many = g.items.length > 3;
      return '<tr><td style="white-space:nowrap">' + auditWhen(r.at) + '</td><td>' + esc(r.user_name || '—') + '</td>' +
        '<td><span class="badge ' + (r.action === 'delete' ? 'unpaid' : r.action === 'insert' ? 'paid' : 'part') + '">' + AUDIT_ACT[r.action] + '</span></td>' +
        '<td>' + esc(AUDIT_TBL[r.tbl] || r.tbl) + '</td>' +
        '<td>' + (many
          ? '<details><summary>' + g.items.length + (g.items.length <= 10 ? ' سجلات' : ' سجلًا') + ' في عملية واحدة</summary>' + g.items.map(function (x) { return '<div style="margin-top:6px">' + line(x) + '</div>'; }).join('') + '</details>'
          : g.items.map(line).join('<hr style="border:0;border-top:1px solid var(--line);margin:6px 0">')) + '</td></tr>';
    }).join('');
    app.innerHTML = head +
      '<div class="toolbar" style="align-items:center">' +
        '<select id="aud-who" data-ro-ok style="width:auto">' + opt('', 'كل المستخدمين', a.who) + Object.keys(who).sort().map(function (v) { return opt(v, v, a.who); }).join('') + '</select>' +
        '<select id="aud-tbl" data-ro-ok style="width:auto">' + opt('', 'كل البيانات', a.tbl) + Object.keys(tbls).map(function (v) { return opt(v, AUDIT_TBL[v] || v, a.tbl); }).join('') + '</select>' +
        '<input type="search" id="aud-q" data-ro-ok placeholder="اسم الطالب أو رقم الإيصال أو أي كلمة" aria-label="بحث" value="' + esc(a.q) + '" style="max-width:280px">' +
        '<button type="button" class="btn" data-audxlsx data-ro-ok' + (list.length ? '' : ' disabled') + '>تصدير Excel</button></div>' +
      (a.cut ? '<p class="formhint">عُرض آخر 3000 تغيير فقط في هذه الفترة. اختر فترة أقصر لرؤية الأقدم.</p>' : '') +
      '<div class="card"><p class="st-count" style="margin-top:0">التغييرات: ' + list.length + '</p>' +
      (list.length
        ? '<div class="table-wrap"><table class="grid"><thead><tr><th>الوقت</th><th>بواسطة</th><th>العملية</th><th>البيانات</th><th>التفاصيل</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">لا توجد تغييرات مطابقة.</div>') + '</div>';
  }

  async function exportAuditXlsx() {
    var a = auditState(), list = auditFiltered();
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      var ws = XLSX.utils.aoa_to_sheet([[schoolName()], ['سجل التعديلات — من ' + dmy(a.from) + ' إلى ' + dmy(a.to)], [],
        ['م', 'الوقت', 'بواسطة', 'العملية', 'البيانات', 'عن', 'التغيير']].concat(list.map(function (r, i) {
          return [i + 1, auditWhen(r.at), r.user_name || '', AUDIT_ACT[r.action], AUDIT_TBL[r.tbl] || r.tbl, auditSubject(r), auditWhat(r)];
        })));
      ws['!cols'] = [6, 18, 20, 10, 22, 40, 70].map(function (w) { return { wch: w }; });
      XLSX.utils.book_append_sheet(wb, ws, 'سجل التعديلات');
      XLSX.writeFile(wb, 'سجل-التعديلات-' + a.from + '-' + a.to + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  document.addEventListener('click', function (e) {
    if (location.hash !== '#/audit' || !isAdmin()) return;
    if (e.target.closest('[data-audrun]')) { var a = auditState(); a.rows = null; loadAudit(); }
    else if (e.target.closest('[data-audxlsx]')) exportAuditXlsx();
  });
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/audit') return;
    var a = auditState(), el = e.target;
    if (el.id === 'aud-from') a.from = el.value;
    else if (el.id === 'aud-to') a.to = el.value;
    else if (el.id === 'aud-who') { a.who = el.value; render(); }
    else if (el.id === 'aud-tbl') { a.tbl = el.value; render(); }
  });
  document.addEventListener('input', function (e) {
    if (location.hash !== '#/audit' || e.target.id !== 'aud-q') return;
    auditState().q = e.target.value;
    var pos = e.target.selectionStart;
    render();
    var q = document.getElementById('aud-q');
    if (q) { q.focus(); q.setSelectionRange(pos, pos); }
  });

  function backupCardHtml() {
    var last = '';
    try { last = localStorage.getItem('last-backup') || ''; } catch (err) { /* التخزين المحلي غير متاح */ }
    var days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 864e5) : null;
    var bk = S.bk, auto;
    if (!bk) auto = '';
    else if (bk.missing) auto = '<p class="formhint">النسخ التلقائي اليومي إلى Google Drive يحتاج إلى تشغيل الملف <code dir="ltr">supabase/auto_backup.sql</code> في محرر SQL، ثم استيراد <code dir="ltr">n8n/auto-backup.json</code> في n8n.</p>';
    else {
      var ago = bk.last_at ? Math.floor((Date.now() - new Date(bk.last_at).getTime()) / 864e5) : null;
      auto = '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)"><h3 style="margin:0 0 6px">النسخ التلقائي اليومي (Google Drive)</h3>' +
        '<p class="' + (ago == null || ago >= 2 ? 'formhint' : 'hint') + '" style="margin:0">' + (bk.last_at
          ? 'آخر نسخة تلقائية: ' + new Date(bk.last_at).toLocaleString('ar-u-nu-latn', { dateStyle: 'long', timeStyle: 'short' }) + (bk.last_file ? ' — ' + esc(bk.last_file) : '') +
            (ago >= 2 ? ' (منذ ' + ago + ' أيام: تحقّق من n8n)' : '')
          : 'لم تصل أي نسخة تلقائية بعد. استورد n8n/auto-backup.json في n8n وضع فيه المفتاح التالي ورقم مجلد Drive.') + '</p>' +
        '<div class="toolbar" style="align-items:center;margin:8px 0 0"><span class="hint" style="margin:0">مفتاح النسخ (يوضع في n8n فقط):</span>' +
        '<code dir="ltr" style="user-select:all">' + (ui.bkShow ? esc(bk.backup_key) : '••••••••••••') + '</code>' +
        '<button type="button" class="btn" data-bkshow>' + (ui.bkShow ? 'إخفاء' : 'إظهار') + '</button>' +
        '<button type="button" class="btn" data-bknew>مفتاح جديد</button></div>' +
        '<p class="hint" style="margin:6px 0 0">من يملك هذا المفتاح يستطيع تنزيل كل البيانات؛ لا ترسله لأحد. إن شككت في تسرّبه اضغط «مفتاح جديد» ثم ضعه في n8n.</p></div>';
    }
    return '<div class="card"><h2>النسخ الاحتياطي</h2>' +
      '<p class="hint">تنزّل النسخة ملفًا واحدًا فيه كل بيانات البرنامج (الطلاب، المواصلات والدفعات، الحضور والغياب، جدول الحصص، المعلمون، الزيارات، الإعدادات). احفظه في مكان آمن خارج هذا الجهاز؛ فيه بيانات شخصية.</p>' +
      '<div class="toolbar" style="align-items:center">' +
        '<button type="button" class="btn primary" data-backup>تنزيل نسخة احتياطية الآن</button>' +
        '<button type="button" class="btn" data-restore>استعادة من ملف…</button>' +
        '<input type="file" id="restore-file" accept=".json,application/json" hidden>' +
        '<span class="st-count" style="margin:0">' + (last
          ? 'آخر نسخة من هذا المتصفح: ' + dmy(last) + (days ? ' (منذ ' + days + ' يومًا)' : ' (اليوم)')
          : 'لم تؤخذ نسخة من هذا المتصفح بعد.') + '</span>' +
      '</div>' +
      '<p class="hint" style="margin:10px 0 0">الاستعادة تعيد كل سجل في الملف إلى ما كان عليه وقت النسخ (تُرجع المحذوف وتُصحّح المعدَّل)، ولا تحذف ما أُضيف بعدها. حسابات الدخول وكلمات المرور ليست ضمن النسخة. ملفات النسخ التلقائي تُستعاد من هنا أيضًا.</p>' + auto + '</div>';
  }

  // حالة النسخ التلقائي (supabase/auto_backup.sql): تُجلب عند الدخول للمدير العام
  async function loadBackupStatus() {
    var r = await sb.from('backup_status').select('*').eq('id', 1).maybeSingle();
    S.bk = r.error ? { missing: true } : r.data || { missing: true };
  }

  async function newBackupKey() {
    if (!confirm('توليد مفتاح نسخ جديد؟\nيتوقف المفتاح الحالي فورًا، فيجب وضع الجديد في n8n وإلا تتوقف النسخ التلقائية.')) return;
    var r = await sb.rpc('backup_new_key');
    if (r.error) return fail(r.error);
    S.bk.backup_key = r.data;
    ui.bkShow = true;
    render();
    toast('وُلّد مفتاح جديد. ضعه في n8n مكان المفتاح القديم.');
  }

  document.addEventListener('click', function (e) {
    if (!isAdmin() || location.hash !== '#/admin') return;
    var el;
    if (e.target.closest('[data-bkshow]')) { ui.bkShow = !ui.bkShow; render(); }
    else if (e.target.closest('[data-bknew]')) newBackupKey();
    else if ((el = e.target.closest('[data-backup]'))) downloadBackup(el);
    else if (e.target.closest('[data-restore]')) document.getElementById('restore-file').click();
  });

  document.addEventListener('change', function (e) {
    if (!isAdmin() || location.hash !== '#/admin' || e.target.id !== 'restore-file' || !e.target.files[0]) return;
    restoreBackup(e.target.files[0]);
  });

  // دوال إنشاء الحسابات تأتي من supabase/registrar.sql: إن لم يُشغَّل بعدُ تُعرض رسالة واضحة
  function accountRpcFail(error) {
    if (/could not find the function|schema cache|PGRST202/i.test((error.message || '') + (error.code || ''))) {
      return toast('شغّل الملف supabase/registrar.sql في محرر SQL أولًا، ثم حدّث الصفحة', true);
    }
    fail(error);
  }

  document.addEventListener('click', async function (e) {
    var el = e.target.closest('[data-resetpw]');
    if (!el || !isAdmin() || location.hash !== '#/admin') return;
    var u = S.users.filter(function (x) { return x.id === el.getAttribute('data-resetpw'); })[0];
    var pw = prompt('كلمة مرور مؤقتة جديدة للحساب «' + (u.full_name || displayName(u.email)) + '» (6 أحرف على الأقل).\nسيُطلب منه تغييرها عند أول دخول.', S.defaultPw || '');
    if (pw == null) return;
    if (pw.length < 6) return toast('كلمة المرور يجب ألا تقل عن 6 أحرف.', true);
    var r = await sb.rpc('reset_user_password', { p_user: u.id, p_password: pw });
    if (r.error) return accountRpcFail(r.error);
    toast('تم تعيين كلمة المرور المؤقتة');
  });

