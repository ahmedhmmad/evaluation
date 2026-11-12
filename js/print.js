'use strict';
  /* ---------- الأحداث ---------- */

  document.addEventListener('click', async function (e) {
    var open = e.target.closest('[data-open]');
    if (open) { go('#/t/' + open.getAttribute('data-open')); return; }

    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    var t = currentTeacher();

    if (act === 'sync') {
      el.disabled = true;
      await syncData();
      el.disabled = false;
      return;
    }
    if (act === 'signout') {
      await flush();
      await sb.auth.signOut();
    } else if (act === 'auth-mode') {
      ui.authMode = ui.authMode === 'login' ? 'signup' : 'login';
      ui.authErr = ''; ui.authMsg = '';
      render();
    } else if (act === 'reload') {
      loadAll();
    } else if (act === 'print') {
      printNow();
    } else if (act === 'back') {
      await flush();
      go('#/teachers');
    } else if (!t) {
      return;
    } else if (act === 'submit') {
      var left = CRITERIA.length - ratedCount(t);
      if (left > 0) {
        ui.error = 'يجب تقييم جميع البنود قبل الإرسال للاعتماد (متبقٍ ' + left + ').';
        render();
        var first = app.querySelector('tr.missing');
        if (first) first.scrollIntoView({ block: 'center' });
        return;
      }
      setStatus(t, 'review');
    } else if (act === 'approve') {
      setStatus(t, 'approved');
    } else if (act === 'return') {
      setStatus(t, 'edit');
    } else if (act === 'publish') {
      if (confirm('هل تريد نشر تقييم «' + t.name + '»؟')) setStatus(t, 'published');
    } else if (act === 'reopen') {
      if (confirm('سيتم إلغاء النشر والاعتماد وإعادة التقييم إلى مرحلة التحرير. هل تريد المتابعة؟')) setStatus(t, 'edit');
    } else if (act === 'delete') {
      if (!confirm('هل تريد حذف «' + t.name + '» وتقييمه نهائيًا؟')) return;
      clearTimeout(saveTimer); saveTimer = null;
      var d = await sb.from('teachers').delete().eq('id', t.id);
      if (d.error) return fail(d.error);
      S.teachers = S.teachers.filter(function (x) { return x.id !== t.id; });
      go('#/teachers');
    }
  });

  app.addEventListener('change', async function (e) {
    var el = e.target, r;

    if (el.hasAttribute('data-setting') && isAdmin()) {
      var patch = {};
      patch[el.getAttribute('data-setting')] = el.checked;
      r = await sb.from('settings').update(patch).eq('id', 1);
      if (r.error) { el.checked = !el.checked; return fail(r.error); }
      Object.assign(S.settings || (S.settings = {}), patch);
      toast('تم الحفظ');
    } else if (el.hasAttribute('data-settingtext') && isAdmin()) {
      var tp = {};
      tp[el.getAttribute('data-settingtext')] = el.value.trim();
      r = await sb.from('settings').update(tp).eq('id', 1);
      if (r.error) return fail(r.error);
      Object.assign(S.settings || (S.settings = {}), tp);
      toast('تم الحفظ');
    } else if (el.hasAttribute('data-visible') && isAdmin()) {
      var vt = find(el.getAttribute('data-visible'));
      r = await sb.from('teachers').update({ visible: el.checked }).eq('id', vt.id);
      if (r.error) { el.checked = !el.checked; return fail(r.error); }
      vt.visible = el.checked;
      toast('تم الحفظ');
    } else if (el.hasAttribute('data-role') && isAdmin()) {
      var u = null, uidAttr = el.getAttribute('data-role');
      S.users.forEach(function (x) { if (x.id === uidAttr) u = x; });
      var rp = rolePatch(el.value);
      r = await sb.from('profiles').update(rp).eq('id', u.id);
      if (r.error) { el.value = roleKey(u); return fail(r.error); }
      Object.assign(u, rp);
      toast('تم الحفظ');
    } else if (el.type === 'radio') {
      var t = currentTeacher();
      if (!t) return;
      t.ratings[Number(el.name.slice(1))] = Number(el.value);
      if (t.status === 'new') t.status = 'edit';
      queueSave(t);
      var done = ratedCount(t);
      document.getElementById('progress-text').textContent = 'تم تقييم ' + done + ' من ' + CRITERIA.length + ' بندًا';
      document.getElementById('progress-bar').style.width = (done / CRITERIA.length * 100) + '%';
      var row = el.closest('tr');
      if (row) row.classList.remove('missing');
    }
  });

  app.addEventListener('input', function (e) {
    var t = currentTeacher();
    if (e.target.id === 'search') {
      ui.search = e.target.value;
      render();
      var s = document.getElementById('search');
      s.focus();
      s.setSelectionRange(s.value.length, s.value.length);
    } else if (t && e.target.id === 'notes') {
      t.notes = e.target.value;
      if (t.status === 'new') t.status = 'edit';
      queueSave(t);
    } else if (t && e.target.id === 'approver-notes') {
      t.approver_notes = e.target.value;
      queueSave(t);
    }
  });

  app.addEventListener('submit', async function (e) {
    e.preventDefault();

    if (e.target.id === 'teacher-form') {
      if (isSup()) return;
      saveTeacherForm();
    } else if (e.target.id === 'student-form') {
      saveStudentForm(e.submitter ? e.submitter.getAttribute('data-mode') : 'save');
    } else if (e.target.id === 'room-form' && isAdmin()) {
      addRoomClass();
    } else if (e.target.id === 'group-form') {
      saveGroupForm();
    } else if (e.target.id === 'user-form' && isAdmin()) {
      var nu = function (id) { return document.getElementById(id).value.trim(); };
      // دالة إنشاء الحساب لا تقبل «مدير»: يُنشأ مشاهدًا ثم تُرفع صلاحيته
      var wantRole = nu('nu-role');
      var made = await sb.rpc('create_user_account', { p_name: nu('nu-name'), p_login: toEmail(nu('nu-login')), p_password: document.getElementById('nu-pw').value, p_role: wantRole === 'manager' || wantRole === 'observer' ? 'viewer' : wantRole });
      if (made.error) return accountRpcFail(made.error);
      if (wantRole === 'manager' || wantRole === 'observer') {
        var mr = await sb.from('profiles').update(rolePatch(wantRole)).eq('id', made.data);
        if (mr.error) toast('أُنشئ الحساب مشاهدًا؛ شغّل supabase/manager.sql ثم غيّر صلاحيته', true);
      }
      var list = await sb.from('profiles').select('*').order('created_at');
      if (!list.error) S.users = list.data || [];
      render();
      toast('أُنشئ الحساب — سلّم صاحبه اسم المستخدم وكلمة المرور المؤقتة');
    } else if (e.target.id === 'defaultpw-form') {
      var pw = document.getElementById('default-pw').value;
      if (pw.length < 6) return toast('كلمة المرور الافتراضية يجب ألا تقل عن 6 أحرف.', true);
      var up = await sb.from('private_settings').update({ default_password: pw }).eq('id', 1);
      if (up.error) return fail(up.error);
      S.defaultPw = pw;
      toast('تم الحفظ');
    } else if (e.target.id === 'pw-form') {
      var p1 = document.getElementById('pw-new').value, p2 = document.getElementById('pw-again').value;
      ui.authErr = p1.length < 6 ? 'كلمة المرور يجب ألا تقل عن 6 أحرف.' : p1 !== p2 ? 'كلمتا المرور غير متطابقتين.' : '';
      if (ui.authErr) return render();
      var ch = await sb.auth.updateUser({ password: p1 });
      if (ch.error) { ui.authErr = 'تعذر تغيير كلمة المرور: ' + ch.error.message; return render(); }
      var done = await sb.rpc('finish_password_change');
      if (done.error) return fail(done.error);
      S.profile.must_change_password = false;
      render();
      toast('تم تغيير كلمة المرور');
    } else if (e.target.id === 'auth-form') {
      var email = document.getElementById('au-email').value.trim();
      var pass = document.getElementById('au-pass').value;
      var signup = ui.authMode === 'signup';
      if (!signup && email.indexOf('@') < 0) email = email.toLowerCase() + USER_SUFFIX;
      var fullName = signup ? document.getElementById('au-name').value.trim() : '';
      ui.busy = true; ui.authErr = ''; ui.authMsg = '';
      render();
      var res = signup
        ? await sb.auth.signUp({
            email: email, password: pass,
            options: { data: { full_name: fullName }, emailRedirectTo: location.origin + location.pathname }
          })
        : await sb.auth.signInWithPassword({ email: email, password: pass });
      ui.busy = false;
      if (res.error) {
        ui.authErr = signup ? 'تعذر إنشاء الحساب: ' + res.error.message : 'بيانات الدخول غير صحيحة.';
      } else if (signup && !res.data.session) {
        ui.authMode = 'login';
        ui.authMsg = 'تم إنشاء الحساب. افتح رسالة التأكيد في بريدك ثم سجّل الدخول.';
      }
      if (!S.uid) render();
    }
  });

  /* ---------- تقرير الزيارة الإشرافية ---------- */

  function findVisit(id) {
    for (var i = 0; i < S.visits.length; i++) if (S.visits[i].id === id) return S.visits[i];
    return null;
  }

  function currentVisit() {
    if (!S.ready || !isStaff()) return null;
    var m = location.hash.match(/^#\/v\/(.+)$/);
    return m ? findVisit(m[1]) : null;
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function dayName(iso) {
    return iso ? new Date(iso + 'T00:00').toLocaleDateString('ar-u-nu-latn', { weekday: 'long' }) : '';
  }

  // مفاتيح الحقول: d0..d6 لنقاط القوة في كل مجال، ثم development و recommendations
  function getField(v, key) {
    return (key.charAt(0) === 'd' && key.length === 2 ? v.strengths[key.slice(1)] : v[key]) || '';
  }

  function setField(v, key, val) {
    if (key.charAt(0) === 'd' && key.length === 2) v.strengths[key.slice(1)] = val; else v[key] = val;
  }

  function lines(text) {
    return text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  }

  function chipsHtml(v, key) {
    var have = lines(getField(v, key));
    var builtin = key.charAt(0) === 'd' && key.length === 2 ? DOMAINS[Number(key.slice(1))].bank : BANK[key];
    var chip = function (text) {
      var on = have.indexOf(text) > -1;
      return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-chip="' + key + '" data-text="' + esc(text) +
        '" aria-pressed="' + on + '">' + esc(text) + '</button>';
    };
    var custom = S.statements.filter(function (x) { return x.field === key; }).map(function (x) {
      return '<span class="chip-wrap">' + chip(x.body) +
        '<button type="button" class="chip-del" data-delstmt="' + x.id + '" data-key="' + key + '" title="حذف العبارة من القائمة" aria-label="حذف العبارة من القائمة">×</button></span>';
    }).join('');
    return '<div class="chips">' + builtin.map(chip).join('') + custom + '</div>' +
      '<div class="addstmt"><input type="text" data-newstmt="' + key + '" placeholder="اكتب عبارة جديدة لإضافتها إلى القائمة" aria-label="عبارة جديدة">' +
      '<button type="button" class="btn" data-addstmt="' + key + '">إضافة</button></div>';
  }

  function fieldBlock(v, key, label) {
    return '<label class="field" for="f-' + key + '">' + label + '</label>' +
      '<textarea id="f-' + key + '" data-vfield="' + key + '" placeholder="اختر من العبارات المقترحة أو اكتب مباشرة">' + esc(getField(v, key)) + '</textarea>' +
      '<details class="bank"><summary>عبارات مقترحة</summary><div id="chips-' + key + '">' + chipsHtml(v, key) + '</div></details>';
  }

  function refreshChips(v, key) {
    var box = document.getElementById('chips-' + key);
    if (box) box.innerHTML = chipsHtml(v, key);
  }

  function renderVisits() {
    if (S.visitsMissing) {
      app.innerHTML = tabs('visits') + '<div class="card empty">لم تُجهَّز قاعدة البيانات لتقارير الزيارات بعد.<br>' +
        'شغّل الملف <code dir="ltr">supabase/visits.sql</code> في محرر SQL ثم حدّث الصفحة.</div>';
      return;
    }
    var options = evalTeachers().map(function (t) {
      return '<option value="' + t.id + '">' + esc(t.name) + (t.subject ? ' — ' + esc(t.subject) : '') + '</option>';
    }).join('');

    var rows = S.visits.map(function (v) {
      var t = find(v.teacher_id);
      return '<button type="button" class="card visit-row" data-openv="' + v.id + '">' +
        '<span><span class="name">' + esc(t ? t.name : '—') + '</span><br>' +
        '<span class="meta">' + esc(v.lesson_title || 'بدون عنوان درس') + ' · ' + esc(v.subject || '—') + '</span></span>' +
        '<span class="meta" style="text-align:end">' + fmtDate(v.visit_date + 'T00:00') + '<br>الزيارة رقم ' + v.visit_number + '<br>' + (v.approved_at ? '<span class="badge paid">معتمد</span>' : '<span class="badge pending">بانتظار الاعتماد</span>') + '</span></button>';
    }).join('');

    app.innerHTML = tabs('visits') +
      (S.teachers.length
        ? '<div class="toolbar"><select id="visit-teacher" aria-label="المعلم" style="flex:1;min-width:180px">' + options + '</select>' +
          '<button type="button" class="btn primary" data-newvisit>+ تقرير زيارة جديد</button></div>'
        : '') +
      (rows || '<div class="card empty">' + (S.teachers.length ? 'لا توجد تقارير زيارات بعد.' : 'أضف معلمًا أولًا من تبويب «المعلمون».') + '</div>');
  }

  // اعتماد المدير للتقرير: المشرف يطبع قبله فيظهر «بانتظار اعتماد المدير»، وبعده «معتمد»
  function canApproveVisit() { return isAdmin() || (isManager() && !isReadOnly()); }
  function visitApprovalHtml(v) {
    var ok = !!v.approved_at;
    return '<span class="badge ' + (ok ? 'paid' : 'pending') + '">' + (ok ? 'معتمد' : 'بانتظار اعتماد المدير') + '</span> ' +
      (ok ? '<span class="hint" style="margin:0">' + esc(v.approved_by || 'المدير') + ' · ' + dmy(String(v.approved_at).slice(0, 10)) + '</span> ' : '') +
      (canApproveVisit() ? '<button type="button" class="btn' + (ok ? '' : ' primary') + '" data-visapprove="' + (ok ? '0' : '1') + '" data-ro-ok>' + (ok ? 'إلغاء الاعتماد' : 'اعتماد التقرير') + '</button>' : '');
  }

  function renderVisit(v) {
    var t = find(v.teacher_id);
    var basic = function (label, inner) { return '<div><label class="field">' + label + '</label>' + inner + '</div>'; };
    // صفوف المعلم إن حُدِّدت له، وإلا كل صفوف المدرسة
    var classList = splitList(t && t.classes);
    if (!classList.length) classList = schoolClasses();
    var periods = '<option value="">— اختر —</option>' + PERIODS.map(function (p) {
      return '<option' + (v.period === p ? ' selected' : '') + '>' + p + '</option>';
    }).join('');

    app.innerHTML =
      '<a class="btn link no-print" href="#/visits">→ العودة إلى الزيارات الإشرافية</a>' +
      '<div class="eval-head">' +
        '<div><h2>تقرير زيارة إشرافية صفية</h2><div class="sub">نموذج الإشراف الميداني المعتمد</div></div>' +
        '<div class="no-print"><span id="visit-approval">' + visitApprovalHtml(v) + '</span> <span class="save-state" id="save-state"></span> ' +
        '<button type="button" class="btn primary" data-act="print">طباعة</button> ' +
        '<button type="button" class="btn danger" data-delvisit>حذف التقرير</button></div>' +
      '</div>' +

      '<div class="card"><h2>أولًا: البيانات الأساسية</h2><div class="grid2" style="margin-top:12px">' +
        basic('اليوم / التاريخ', '<input type="date" data-vbasic="visit_date" aria-label="التاريخ" value="' + esc(v.visit_date) + '">' +
          '<div class="day" id="visit-day">' + dayName(v.visit_date) + '</div>') +
        basic('اسم المعلم', '<input type="text" value="' + esc(t ? t.name : '') + '" readonly aria-label="اسم المعلم">') +
        basic('المبحث / المادة', '<select data-vbasic="subject" aria-label="المبحث">' + optionsHtml(splitList(t && t.subject), v.subject) + '</select>') +
        basic('الصف والشعبة', classList.length || v.class_section
          ? '<select data-vbasic="class_section" aria-label="الصف والشعبة">' + optionsHtml(classList, v.class_section) + '</select>'
          : '<input type="text" data-vbasic="class_section" aria-label="الصف والشعبة" value="">' +
            '<div class="day">لم تُعرَّف صفوف المدرسة بعد؛ يعرّفها مدير النظام من تبويب «الإدارة».</div>') +
        basic('الحصة', '<select data-vbasic="period" aria-label="الحصة">' + periods + '</select>') +
        basic('رقم الزيارة', '<input type="number" min="1" data-vbasic="visit_number" aria-label="رقم الزيارة" value="' + esc(v.visit_number) + '">') +
        '<div style="grid-column:1/-1"><label class="field">عنوان الدرس</label>' +
          '<input type="text" data-vbasic="lesson_title" aria-label="عنوان الدرس" value="' + esc(v.lesson_title) + '"></div>' +
      '</div></div>' +

      '<div class="card"><h2>ثانيًا: مجالات التقييم والملاحظات الصفية</h2>' +
        '<p class="hint no-print">لكل مجال: اختر من العبارات المقترحة أو اكتب أبرز نقاط القوة والتميز.</p>' +
        DOMAINS.map(function (d, i) {
          return '<div class="domain"><h3><span class="n">' + (i + 1) + '</span>' + d.title + '</h3><div class="body">' +
            fieldBlock(v, 'd' + i, 'أبرز نقاط القوة والتميز') + '</div></div>';
        }).join('') +
      '</div>' +

      '<div class="card"><h2>الملاحظات ومجالات التطوير والتنمية المهنية المطلوبة</h2>' +
        fieldBlock(v, 'development', 'الملاحظات ومجالات التطوير') + '</div>' +

      '<div class="card"><h2>التوصيات / الإجراء التطويري</h2>' +
        fieldBlock(v, 'recommendations', 'التوصيات') + '</div>' +

      '<div class="card no-print"><h2>التوقيعات</h2><div class="grid2" style="margin-top:12px">' +
        basic('اسم المشرف التربوي', '<input type="text" data-vbasic="supervisor_name" aria-label="اسم المشرف التربوي" value="' + esc(v.supervisor_name) + '">') +
        basic('اسم مدير/ة الأكاديمية', '<input type="text" data-vbasic="principal_name" aria-label="اسم مدير الأكاديمية" value="' + esc(v.principal_name) + '">') +
      '</div></div>';
  }

  /* ورقة الطباعة بتصميم النموذج الورقي، وتُصغَّر لتبقى في صفحة A4 واحدة */

  /* ========== قالب التقارير الموحّد (هوية أكاديمية الركيزة الثالثة) ==========
     كل تقرير مطبوع يُبنى من هذه الدوال: الترويسة، كتلة العنوان، الجداول، التوقيعات، التذييل.
     الألوان والخطوط في CSS تحت «هوية التقارير المطبوعة»؛ والثوابت النصية هنا. يكفي التعديل في هذين الموضعين. */

  var REPORT = {
    nameAr: 'أكاديمية الركيزة الثالثة',
    nameEn: 'Third Pillar Academy',
    logo: 'logo.png',     // الشعار الدائري: علامة مائية فقط
    banner: 'banner.jpg', // الترويسة أعلى كل ملف مطبوع
    address: '12 شارع الدكتور نجيب محفوظ، متفرع من عباس العقاد، المنطقة الثامنة، مدينة نصر', // يُغيَّر من الإعدادات (school_address)
    phone: '01070761330', // يُغيَّر من الإعدادات (school_phone)
    facebook: 'facebook.com/thirdpillaracademy',
    // A4 عمودي: 12mm أعلى وأسفل، 15mm من الجانبين
    page: { width: 210, height: 297, marginY: 12, marginX: 15 },
    fonts: 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Montserrat:wght@600;700&display=swap',
    baseSize: 10.5, // pt: نص التقرير؛ بقية الأحجام نسبة منه
    minSize: 6.5
  };

  function schoolName() {
    return (S.settings && S.settings.school_name) || REPORT.nameAr;
  }

  // العام الدراسي من الإعدادات، وإلا يُحسب: يبدأ في أغسطس
  function academicYear() {
    if (S.settings && S.settings.academic_year) return S.settings.academic_year;
    var d = new Date(), y = d.getFullYear();
    return d.getMonth() >= 7 ? y + '/' + (y + 1) : (y - 1) + '/' + y;
  }

  // يوم/شهر/سنة بأرقام غربية
  function dmy(iso) {
    var p = String(iso || '').slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : '';
  }

  function nowStamp() {
    var d = new Date(), two = function (n) { return ('0' + n).slice(-2); };
    return two(d.getDate()) + '/' + two(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }

  // الترويسة: الصورة العريضة أعلى الصفحة، وتحتها سطر صغير (اسم الأكاديمية والمرحلة يمينًا، العام الدراسي يسارًا) وخط ذهبي
  function letterhead(banner) {
    var cfg = S.settings || {};
    return '<div class="rh"><img class="rh-banner" src="' + (banner || REPORT.banner) + '" alt="' + REPORT.nameEn + '">' +
      '<div class="rh-line"><span><b>' + esc(schoolName()) + '</b>' + (cfg.report_subtitle ? ' · ' + esc(cfg.report_subtitle) : '') + '</span>' +
      '<span>العام الدراسي ' + esc(academicYear()) + '</span></div></div>';
  }

  // بداية كل تقرير: العلامة المائية، الترويسة، ثم اسم التقرير وشريط معلوماته. info: [[العنوان، القيمة]، …]
  // opts.lead: سطر بارز تحت العنوان (اسم الطالب في ملفه). opts.noIssueDate: لا يُضاف تاريخ الإصدار إلى الشريط
  function reportHead(title, info, opts) {
    opts = opts || {};
    var rows = (info || []).filter(function (p) { return p && p[1] !== '' && p[1] != null; });
    if (!opts.noIssueDate) rows.push(['تاريخ الإصدار', dmy(todayISO())]);
    return '<img class="wm" src="' + REPORT.logo + '" alt="">' + letterhead(opts.banner) +
      '<div class="rt"><h1>' + esc(title) + '</h1>' + (opts.lead ? '<div class="rt-lead">' + esc(opts.lead) + '</div>' : '') + '<div class="rt-info">' +
      rows.map(function (p) { return '<span><b>' + p[0] + ':</b> ' + esc(p[1]) + '</span>'; }).join('') + '</div></div>';
  }

  // منطقة التوقيعات: خانات من اليمين بالترتيب المعطى، ثم خانة الختم. list: [[الصفة، الاسم]، …]
  function reportSigns(list, noStamp) {
    var dots = '........................';
    return '<div class="rs">' + list.map(function (p) {
      return '<div><b>' + p[0] + '</b><span>الاسم: ' + esc(p[1] || dots) + '</span><span>التوقيع: ' + dots + '</span></div>';
    }).join('') + (noStamp ? '' : '<div class="stamp">الختم</div>') + '</div>';
  }

  // إعداد الصفحة: هامش الصفحة صفر حتى لا يطبع المتصفح سطوره (العنوان والتاريخ أعلى الصفحة، والرابط ورقم الصفحة أسفلها)؛
  // الهوامش الفعلية (12mm أعلى وأسفل، 15mm من الجانبين) تأتي من حشو الورقة نفسها
  // الكشوف العريضة (كشف الحضور الشهري) تُطبع أفقيًا
  var printLandscape = false;

  function pageCss() {
    return '@page{size:A4 ' + (printLandscape ? 'landscape' : 'portrait') + ';margin:0}';
  }

  function sheetPadCss(prefix) {
    var p = REPORT.page, y = p.marginY + 'mm', x = p.marginX + 'mm';
    return prefix + '#print-sheet{box-sizing:content-box;--pad-x:' + x + ';--pad-y:' + y + ';padding:' + y + ' ' + x + '}' +
      // الكشوف متعددة الصفحات: الهامشان العلوي والسفلي صفّان فارغان في رأس الجدول وذيله يتكرران في كل صفحة
      prefix + '#print-sheet.ls{padding:0 ' + x + ' ' + y + '}' +
      prefix + '#print-sheet td.pg-space{height:' + y + '}';
  }

  // رقم الصف من اسم الشعبة: «السابع (أ)» → 7. يعيد 0 إن لم يُعرف
  function gradeOf(className) {
    var n = norm(latinDigits(className)), m = n.match(/\d+/);
    if (m) return Number(m[0]);
    // بلا «ال» ليُعرف «سابع (أ)» كما يُعرف «السابع (أ)»
    var words = ['اول', 'ثاني', 'ثالث', 'رابع', 'خامس', 'سادس', 'سابع', 'ثامن', 'تاسع', 'عاشر'];
    for (var i = words.length - 1; i >= 0; i--) if (n.indexOf(words[i]) > -1) return i + 1;
    return 0;
  }

  var sheet = document.getElementById('print-sheet');

  // يُصغَّر خط الورقة إلى أن تتسع في صفحة A4 واحدة طولًا وعرضًا. el: الورقة (هنا أو داخل إطار الطباعة)؛
  // padded: الورقة تحمل هوامش الصفحة حشوًا فيدخل في ارتفاعها
  function fitElement(el, padded) {
    var p = REPORT.page, maxPx = ((printLandscape ? p.width : p.height) - (padded ? 0 : 2 * p.marginY) - 22) * 96 / 25.4; // هامش أمان 22mm: الطابعة تقتطع حافة غير قابلة للطباعة (نحو 5mm من كل جهة) فتقصر الصفحة الفعلية
    fitLevels(el, maxPx);
  }

  // جدول أعرض من الورقة (أعمدة كثيرة): يُصغَّر الخط حتى يتسع عرضها أيضًا
  // (يُقارن عرض كل جدول بعرض المحتوى داخل الهوامش، لا بعرض الورقة كلها)
  function tooWide(el) {
    var cs = el.ownerDocument.defaultView.getComputedStyle(el), w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return Array.prototype.some.call(el.querySelectorAll('table'), function (t) { return t.offsetWidth > w + 1; });
  }

  // أكبر خط يتسع فيه العرض (والطول إن طُلب). يعيد { h, w }: هل اتسع الطول والعرض
  function shrinkTo(el, maxPx) {
    var size = REPORT.baseSize, tall = function () { return maxPx != null && el.offsetHeight > maxPx; };
    el.style.fontSize = size + 'pt';
    while ((tall() || tooWide(el)) && size > REPORT.minSize) { size -= 0.25; el.style.fontSize = size + 'pt'; }
    return { h: !tall(), w: !tooWide(el) };
  }

  // درجات الالتفاف حين لا يتسع العرض حتى بأصغر خط: 0 كما صُمّمت الخلايا،
  // 1 تلتف الأسماء والنصوص عند المسافات (الأرقام تبقى كاملة)، 2 آخر حل: تُكسر الكلمات
  function wrapLevel(el, lv) {
    el.classList.toggle('tight', lv > 0);
    el.classList.toggle('tight2', lv > 1);
  }

  function fitLevels(el, maxPx) {
    var r;
    for (var lv = 0; lv < 3; lv++) { wrapLevel(el, lv); r = shrinkTo(el, maxPx); if (r.w) break; }
    return r;
  }

  // الكشوف الطويلة (ls): صفحة واحدة دائمًا، يُصغَّر الخط حتى تتسع. إن لم تتسع حتى بأصغر خط (كشف بمئات الأسطر)
  // تُطبع بأكبر خط يتسع فيه العرض على صفحات متتالية تتكرر فيها عناوين الأعمدة، بدل خط لا يُقرأ يفيض رغم ذلك.
  // هامش أمان 22mm: حافة الطابعة غير القابلة للطباعة تقصّر الصفحة الفعلية
  function fitPages(el) {
    if (el.classList.contains('pay-reg')) { el.classList.remove('one-page'); return; }
    var payReg = el.classList.contains('pay-reg'), p = REPORT.page, maxPx = ((printLandscape ? p.width : p.height) - (payReg ? 12 : 22)) * 96 / 25.4;
    var r = fitLevels(el, maxPx), fits = r.h && r.w;
    if (!fits) fitLevels(el, null);
    // كشف الرواتب يبقى في صفحة واحدة دائمًا: إن لم يتسع حتى بأصغر خط يُصغَّر كله بالتكبير/التصغير (zoom)
    if (!fits && el.classList.contains('pay-reg')) {
      el.style.zoom = ''; el.style.width = '194mm';
      el.style.fontSize = REPORT.minSize + 'pt';
      var h = el.offsetHeight, kz = Math.max(0.6, Math.min(1, maxPx / h * 0.97));
      if (kz < 1) { el.style.zoom = kz; el.style.width = (194 / kz) + 'mm'; }
      fits = true;
    } else if (fits && payReg) {
      // ما بقي من الصفحة يوزَّع على صفوف الجدول
      var trs = el.querySelectorAll('table.rz tbody tr'), spare = maxPx - el.offsetHeight;
      if (trs.length && spare > 0) {
        var rowH = Math.min(46, trs[0].offsetHeight + spare / trs.length);
        Array.prototype.forEach.call(trs, function (tr) { tr.style.height = rowH + 'px'; });
      }
    }
    // اتسع في صفحة: لا يبدأ جدول بعده صفحة جديدة (الإحصائية والكشف معًا في الورقة نفسها)
    el.classList.toggle('one-page', fits);
  }

  function fitSheet() {
    sheet.setAttribute('data-fit', '1');
    fitElement(sheet, false);
  }

  /* ----- تقرير الزيارة الإشرافية ----- */
  function buildVisitSheet(v) {
    var t = find(v.teacher_id);
    var text = function (key) { return '<div class="pre">' + esc(lines(getField(v, key)).join('\n')) + '</div>'; };
    var kv = function (a, b) { return '<tr><th>' + a[0] + '</th><td>' + esc(a[1]) + '</td><th>' + b[0] + '</th><td>' + esc(b[1]) + '</td></tr>'; };

    sheet.className = 'ps';
    sheet.innerHTML =
      reportHead('تقرير زيارة إشرافية صفية', [['النموذج', 'نموذج الإشراف الميداني المعتمد'], ['المعلم', t ? t.name : '']]) +
      (v.approved_at
        ? '<div class="rbox" style="margin:.4em 0 .2em;text-align:center"><b>معتمد من المدير' + (v.approved_by ? ': ' + esc(v.approved_by) : '') + '</b> — ' + dmy(String(v.approved_at).slice(0, 10)) + '</div>'
        : '<div class="rbox" style="margin:.4em 0 .2em;text-align:center;border:1.5pt dashed #B4493F;color:#B4493F"><b>بانتظار اعتماد المدير</b></div>') +
      '<div class="rsec">أولًا: البيانات الأساسية</div>' +
      '<table class="rk">' +
        kv(['اليوم / التاريخ', v.visit_date ? dayName(v.visit_date) + ' ' + dmy(v.visit_date) : ''], ['اسم المعلم', t ? t.name : '']) +
        kv(['المبحث / المادة', v.subject], ['الصف والشعبة', v.class_section]) +
        kv(['الحصة', v.period], ['رقم الزيارة', v.visit_number]) +
        '<tr><th>عنوان الدرس</th><td colspan="3">' + esc(v.lesson_title) + '</td></tr>' +
      '</table>' +
      '<div class="rsec">ثانيًا: مجالات التقييم والملاحظات الصفية</div>' +
      '<table class="ps-domains"><colgroup><col style="width:6%"><col style="width:25%"><col style="width:69%"></colgroup>' +
        '<thead><tr><th>م</th><th>مؤشرات الأداء والمعايير الإشرافية</th><th>أبرز نقاط القوة والتميز</th></tr></thead><tbody>' +
        DOMAINS.map(function (dm, i) {
          return '<tr><td class="c">' + (i + 1) + '</td><td class="c"><b>' + dm.title + '</b></td><td>' + text('d' + i) + '</td></tr>';
        }).join('') + '</tbody></table>' +
      '<div class="rbox"><b>الملاحظات ومجالات التطوير والتنمية المهنية المطلوبة</b>' + text('development') + '</div>' +
      '<div class="rbox"><b>التوصيات / الإجراء التطويري</b>' + text('recommendations') + '</div>' +
      reportSigns([['المعلم (بالعلم والاطلاع)', t ? t.name : ''], ['المشرف التربوي', v.supervisor_name], ['مدير/ة الأكاديمية', v.principal_name || principalName()]]);
    fitSheet();
  }

  /* ----- تقييم المعلم -----
     o: معلم (للمشرف) أو نتيجة منشورة (للمشاهد، وقد تكون بعض حقولها محجوبة) */
  function buildEvalSheet(o) {
    var sum = o.total != null ? o.total : (o.ratings ? total(o) : null);
    var pct = sum != null ? Math.round(sum / MAX * 100) : null;
    var supervisor = isStaff() && S.profile ? S.profile.full_name : '';
    var notes = function (title, body) {
      return body ? '<div class="rbox"><b>' + title + '</b><div class="pre">' + esc(body) + '</div></div>' : '';
    };

    sheet.className = 'pe';
    sheet.innerHTML =
      reportHead('تقييم أداء المعلم', [['المعلم', o.name], ['التخصص', o.subject], ['تاريخ النشر', dmy(o.published_at)]]) +
      (sum != null
        ? '<div class="pe-summary">' +
            '<div><span class="k">المجموع</span><span class="v">' + sum + ' / ' + MAX + '</span></div>' +
            '<div><span class="k">النسبة</span><span class="v">' + pct + '%</span></div>' +
            '<div><span class="k">التقدير</span><span class="v">' + grade(pct) + '</span></div></div>'
        : '') +
      (o.ratings
        ? '<table class="rz"><colgroup><col style="width:6%"><col style="width:82%"><col style="width:12%"></colgroup>' +
          '<thead><tr><th>م</th><th>التقييم الأدائي والكفايات الشخصية</th><th>التقييم</th></tr></thead><tbody>' +
          CRITERIA.map(function (c, i) {
            var r = o.ratings[i];
            return '<tr><td class="c">' + (i + 1) + '</td><td>' + c + '</td><td class="c mark">' + (r || '—') + '</td></tr>';
          }).join('') + '</tbody></table>' +
          '<div class="pe-legend">مفتاح الدرجات: ' + SCALE.map(function (x) { return '<span><b>' + x.v + '</b> = ' + x.label + '</span>'; }).join('') + '</div>'
        : '') +
      notes('ملاحظات المشرف', o.notes) +
      notes('ملاحظات الاعتماد', o.approver_notes) +
      reportSigns([['المشرف التربوي', supervisor], ['مدير/ة الأكاديمية', principalName()]]);
    fitSheet();
  }


  // العدد بالحروف العربية (حتى أقل من مليار)
  function arabicWords(n) {
    var ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر',
      'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
    var tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
    var hundreds = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];
    var below1000 = function (v) {
      var parts = [], rest = v % 100;
      if (v >= 100) parts.push(hundreds[Math.floor(v / 100)]);
      if (rest > 0 && rest < 20) parts.push(ones[rest]);
      else if (rest >= 20) parts.push((rest % 10 ? ones[rest % 10] + ' و' : '') + tens[Math.floor(rest / 10)]);
      return parts.join(' و');
    };
    // one: ألف، two: ألفان، few: آلاف (3–10)، many: ألف
    var scale = function (v, one, two, few, many) {
      return v === 1 ? one : v === 2 ? two : v >= 3 && v <= 10 ? below1000(v) + ' ' + few : below1000(v) + ' ' + many;
    };
    if (!n) return 'صفر';
    var out = [], millions = Math.floor(n / 1e6), thousands = Math.floor(n % 1e6 / 1000), rest = n % 1000;
    if (millions) out.push(scale(millions, 'مليون', 'مليونان', 'ملايين', 'مليون'));
    if (thousands) out.push(scale(thousands, 'ألف', 'ألفان', 'آلاف', 'ألف'));
    if (rest) out.push(below1000(rest));
    return out.join(' و');
  }

  // المبلغ كتابةً كما في سندات القبض: «فقط خمسمئة جنيه مصري لا غير»
  function amountInWords(amount) {
    var total = Math.round((Number(amount) || 0) * 100), pounds = Math.floor(total / 100), piastres = total % 100, last = pounds % 100;
    var text = pounds === 1 ? 'جنيه مصري واحد' : pounds === 2 ? 'جنيهان مصريان'
      // المثنى قبل «جنيه» مضاف تُحذف نونه: «مئتا جنيه»، «ألفا جنيه»
      : last >= 3 && last <= 10 ? arabicWords(pounds) + ' جنيهات مصرية' : last >= 11 ? arabicWords(pounds) + ' جنيهًا مصريًا'
        : arabicWords(pounds).replace(/(مئت|ألف|مليون)ان$/, '$1ا') + ' جنيه مصري';
    if (!pounds && piastres) text = '';
    if (piastres) text += (text ? ' و' : '') + arabicWords(piastres) + ' قرشًا';
    return 'فقط ' + text + ' لا غير';
  }

  /* ----- إيصال اشتراك المواصلات -----
     ورقة A4 واحدة فيها نسختان يفصلهما خط قص في منتصفها: الأصل لولي الأمر، والنسخة لسجل المدرسة.
     على هيئة الإيصالات المتداولة: رقم الإيصال، خانة المبلغ، المبلغ كتابةً، البيان، طريقة الدفع، التوقيعات والختم */
  // كلمة «أصل» / «نسخة» أعلى الإيصال وسند الاسترداد، وعلى النسخة كلمة «نسخة» كبيرة مائلة باهتة تمنع الخلط بينهما
  function rvTag(second) {
    return '<div class="rv-tag">' + (second ? 'نسخة' : 'أصل') + '</div>' + (second ? '<div class="rv-copymark" aria-hidden="true">نسخة</div>' : '');
  }
  function rvCut() { return '<div class="rc-cut">✂</div>'; }

  function buildReceiptSheet(q) {
    if (q.staff) return buildStaffReceiptSheet(q);
    var x = findStudent(q.sid), recs = payReceipts(q.sid);
    var mem = S.tMembers.filter(function (m) { return m.student_id === q.sid; })[0], g = findGroup(mem.group_id);
    // الإيصال المطلوب: برقمه، وإلا الأول. كلٌّ بمبلغه هو، والمتبقي بعده كما كان يوم صدوره
    var rec = (q.no != null && q.no !== '' ? recs.filter(function (p) { return String(p.receipt_no) === String(q.no); })[0] : null) || recs[0];
    var share = rec.kind === 'topup' && rec.due != null ? Number(rec.due) : shareOf(mem, g), before = rec.paid_before || 0;
    var left = Math.max(0, share - before - rec.amount), method = rec.method || 'cash', disc = rec.kind === 'topup' ? 0 : Number(rec.discount) || 0;
    var no = rec.receipt_no != null ? ('00000' + rec.receipt_no).slice(-Math.max(6, String(rec.receipt_no).length)) : '—';
    // الإيصالات التي سبقت هذا الإيصال عن الشهر نفسه (للإشارة إليها عند استيفاء الاشتراك)
    var earlier = recs.slice(0, recs.indexOf(rec)).map(function (p) { return p.receipt_no != null ? p.receipt_no : '—'; });
    var fixed = function (v) { return (Number(v) || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var line = function (ar, en, value, cls) {
      return '<div class="rv-line' + (cls ? ' ' + cls : '') + '"><span class="k">' + ar + '</span><span class="v">' + esc(value || '') + '</span><span class="e">' + en + '</span></div>';
    };
    var methods = Object.keys(PAY_METHODS).map(function (k) {
      return '<span class="rv-m">' + (k === method ? '☑' : '☐') + ' ' + (k === 'other' && method === 'other' && rec.method_note ? 'أخرى: ' + esc(rec.method_note) : PAY_METHODS[k]) + '</span>';
    }).join('');
    var copy = function (tag, second) {
      return '<div class="rc-copy' + (second ? ' rc-2' : '') + '"><img class="wm" src="' + REPORT.logo + '" alt="">' + rvTag(second, 'receipt') + letterhead() +
        '<div class="rv-top">' +
          '<div class="rv-no"><div><span>رقم الإيصال <small>No.</small></span><b>' + no + '</b></div>' +
            '<div><span>التاريخ <small>Date</small></span><i>' + dmy(rec.paid_on || todayISO()) + '</i></div></div>' +
          '<div class="rv-title"><h1>إيصال</h1><span>RECEIPT</span></div>' +
          '<div class="rv-amt"><span>المبلغ <small>Amount</small></span><b>' + fixed(rec.amount) + '</b><i>ج.م <small>EGP</small></i></div>' +
        '</div>' +
        '<div class="rv-body">' +
          line('استلمنا من السيد/ة', 'Received from', x.guardian_name) +
          '<div class="rv-two">' + line('ولي أمر الطالب/ـة', 'Student', x.full_name) + line('الشعبة', 'Class', x.class_name, 'short') + '</div>' +
          line('مبلغًا وقدره', 'The sum of', amountInWords(rec.amount)) +
          line('وذلك عن', 'Being for', (rec.kind === 'topup' ? 'دفعة مكمِّلة لاشتراك المواصلات لشهر ' : 'اشتراك المواصلات لشهر ') + tLabel(ui.tMonth) + ' — نقطة التجمع: ' + g.assembly_point) +
          '<div class="rv-line"><span class="k">طريقة الدفع</span><span class="rv-ms">' + methods + '</span><span class="e">Payment</span></div>' +
          (hasPayRef(method) ? line('رقم الدفع (' + PAY_METHODS[method] + ')', 'Ref. No.', rec.method_note, 'ref') : '') +
          // الباقي بعد هذا الإيصال، أو استيفاء الاشتراك كاملًا
          line('ملاحظة', 'Note', (disc > 0 ? 'تخفيض ' + money(disc) + ' — السبب: ' + (rec.discount_reason || '') + ' · ' : '') + (left > 0 ? 'الباقي من اشتراك الشهر: ' + money(left) : 'استيفاء كامل اشتراك الشهر' + (rec.kind === 'topup' ? ' (مع ' + (earlier.length > 1 ? 'الإيصالات ' : 'الإيصال رقم ') + earlier.join(' و') + ')' : '')), left > 0 ? '' : 'full') +
        '</div>' +
        '<div class="rv-end"><div class="rv-sum"' + (disc > 0 ? ' style="grid-template-columns:repeat(4,1fr)"' : '') + '><div><span>اشتراك الشهر</span><b>' + money(share + disc) + '</b></div>' +
          (disc > 0 ? '<div><span>التخفيض</span><b>' + money(disc) + '</b></div>' : '') +
          (rec.kind === 'topup' ? '<div><span>المدفوع سابقًا</span><b>' + money(before) + '</b></div>' : '<div><span>المدفوع</span><b>' + money(rec.amount) + '</b></div>') +
          '<div><span>المتبقي</span><b' + (left > 0 ? ' class="bad"' : ' class="ok"') + '>' + money(left) + '</b></div></div>' +
        '<div class="rv-stamp">الختم</div></div></div>'; // بلا توقيعات: خانة الختم فقط
    };
    sheet.className = 'rc';
    sheet.innerHTML = copy('أصل') + rvCut('receipt') + copy('نسخة', true);
    fitSheet();
  }

  /* ----- سند استرداد اشتراك المواصلات -----
     بهيئة الإيصال نفسها (أصل ونسخة في ورقة واحدة)، مع توقيع ولي الأمر باستلام المبلغ. v: سجل الاسترداد كما حُفظ */
  function buildRefundSheet(v) {
    var paid = Number(v.paid_before) || 0, amount = Number(v.amount) || 0;
    var no = v.refund_no != null ? ('00000' + v.refund_no).slice(-Math.max(6, String(v.refund_no).length)) : '—';
    var fixed = function (n) { return (Number(n) || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var line = function (ar, en, value) {
      return '<div class="rv-line"><span class="k">' + ar + '</span><span class="v">' + esc(value || '') + '</span><span class="e">' + en + '</span></div>';
    };
    var method = PAY_METHODS[v.method] ? v.method : 'cash';
    var methods = Object.keys(PAY_METHODS).map(function (k) {
      return '<span class="rv-m">' + (k === method ? '☑' : '☐') + ' ' + PAY_METHODS[k] + (k === method && v.method_note ? ': ' + esc(v.method_note) : '') + '</span>';
    }).join('');
    var copy = function (tag, second) {
      return '<div class="rc-copy' + (second ? ' rc-2' : '') + '"><img class="wm" src="' + REPORT.logo + '" alt="">' + rvTag(second, 'refund') + letterhead() +
        '<div class="rv-top">' +
          '<div class="rv-no"><div><span>رقم السند <small>No.</small></span><b>' + no + '</b></div>' +
            '<div><span>التاريخ <small>Date</small></span><i>' + dmy(v.refunded_on || todayISO()) + '</i></div></div>' +
          '<div class="rv-title"><h1>سند استرداد</h1><span>REFUND</span></div>' +
          '<div class="rv-amt"><span>المبلغ <small>Amount</small></span><b>' + fixed(amount) + '</b><i>ج.م <small>EGP</small></i></div>' +
        '</div>' +
        '<div class="rv-body">' +
          line('رُدّ إلى السيد/ة', 'Refunded to', v.guardian_name) +
          (v.staff ? '<div class="rv-two">' + line('الوظيفة', 'Position', v.job || 'موظف') + '<div class="rv-line short"><span class="k">الصفة</span><span class="v">موظف</span><span class="e">Type</span></div></div>'
            : '<div class="rv-two">' + line('ولي أمر الطالب/ـة', 'Student', v.student_name) + '<div class="rv-line short"><span class="k">الشعبة</span><span class="v">' + esc(v.class_name) + '</span><span class="e">Class</span></div></div>') +
          line('مبلغ وقدره', 'The sum of', amountInWords(amount)) +
          line('وذلك عن', 'Being for', 'استرداد من اشتراك المواصلات ' + (v.staff ? 'للموظف عن ' : 'لشهر ') + tLabel(v.month) + (v.reason ? ' — ' + v.reason : '')) +
          '<div class="rv-line"><span class="k">طريقة الرد</span><span class="rv-ms">' + methods + '</span><span class="e">Method</span></div>' +
          line(v.staff ? 'توقيع المستلم' : 'توقيع المستلم (ولي الأمر)', 'Received by', '') +
        '</div>' +
        '<div class="rv-end"><div class="rv-sum"><div><span>' + (v.staff ? 'المدفوع عن الدورة' : 'المدفوع عن الشهر') + '</span><b>' + money(paid) + '</b></div><div><span>المسترد</span><b class="bad">' + money(amount) + '</b></div>' +
          '<div><span>الصافي بعد الاسترداد</span><b>' + money(paid - amount) + '</b></div></div>' +
        '<div class="rv-stamp">الختم</div></div></div>';
    };
    sheet.className = 'rc';
    sheet.innerHTML = copy('أصل') + rvCut('refund') + copy('نسخة', true);
    fitSheet();
  }

  /* ----- كشف دفعات المواصلات (لشعبة، لنقطة تجمع، أو للمدرسة كلها) -----
     للمدرسة كلها: صفحة ملخص الشعب أولًا، ثم كشف تفصيلي بكل الطلاب مرتبين بالشعبة */
  function buildPaymentsSheet(sc) {
    var showClass = !sc.oneClass, showPoint = !sc.group;
    var table = function (title, info, cols, headRow, body, newpage) {
      var head = reportHead(title, info).replace(/^<img class="wm"[^>]*>/, '');
      return '<table class="rz' + (newpage ? ' newpage' : '') + '"><thead>' +
        '<tr><td class="pg-space" colspan="' + cols + '"></td></tr>' +
        '<tr><td class="ls-head" colspan="' + cols + '">' + head + '</td></tr><tr>' + headRow + '</tr></thead><tbody>' + body +
        '</tbody><tfoot><tr><td class="pg-space" colspan="' + cols + '"></td></tr></tfoot></table>';
    };
    var c = function (v) { return '<td class="c">' + v + '</td>'; };
    var pct = function (t) { return t.due ? Math.round(t.paid / t.due * 100) + '%' : '—'; };
    var t = payTotals(sc.rows), list = sc.whole ? payByClass(sc.rows) : [];
    var html = '';

    if (list.length > 1) {
      var keys = Object.keys(PAY_METHODS), byCells = function (x) { return keys.map(function (k) { return c(x.by[k] ? plainNum(x.by[k]) : '—'); }).join(''); };
      html += table('ملخص دفعات المواصلات', sc.info.concat([['عدد المشتركين', t.n]]), 8 + keys.length,
        '<th>م</th><th>الشعبة</th><th>المشتركون</th><th>المطلوب</th><th>المحصَّل</th>' + keys.map(function (k) { return '<th>' + PAY_METHODS[k] + '</th>'; }).join('') +
        '<th>المتبقي</th><th>نسبة التحصيل</th><th>لم يسددوا</th>',
        list.map(function (k, i) {
          return '<tr>' + c(i + 1) + '<td>' + esc(k.name || 'بدون شعبة') + '</td>' + c(k.t.n) + c(plainNum(k.t.due)) + c('<b>' + plainNum(k.t.paid) + '</b>') + byCells(k.t) + c(plainNum(k.t.left)) + c(pct(k.t)) + c(k.t.owing) + '</tr>';
        }).join('') +
        '<tr class="total"><td colspan="2">المجموع (ج.م)</td>' + c(t.n) + c(plainNum(t.due)) + c(plainNum(t.paid)) + byCells(t) + c(plainNum(t.left)) + c(pct(t)) + c(t.owing) + '</tr>');
    }

    var cols = 8 + (showClass ? 1 : 0) + (showPoint ? 1 : 0);
    html += table('كشف دفعات المواصلات', sc.info.concat([['عدد المشتركين', t.n]]), cols,
      '<th>م</th><th>اسم الطالب</th>' + (showClass ? '<th>الشعبة</th>' : '') + (showPoint ? '<th>نقطة التجمع</th>' : '') +
      '<th>الحصة</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th>طريقة الدفع</th><th>تاريخ السداد</th>',
      sc.rows.map(function (r, i) {
        return '<tr>' + c(i + 1) + '<td>' + esc(r.x.full_name) + '</td>' + (showClass ? c(esc(r.x.class_name || '—')) : '') + (showPoint ? '<td>' + esc(r.g.assembly_point) + '</td>' : '') +
          c(plainNum(r.share)) + c(plainNum(r.paid)) + c(plainNum(r.left)) +
          '<td class="c ' + (r.status === 'paid' ? 'ok' : r.status === 'unpaid' ? 'bad' : r.status === 'part' ? 'warn' : '') + '">' + (PAY_STATUS[r.status] || '—') + '</td>' +
          c(r.paid ? esc(payMethodLabel(r.rec)) : '') + c(r.paid ? dmy(r.rec.paid_on) : '') + '</tr>';
      }).join('') +
      '<tr class="total"><td colspan="' + (cols - 6) + '">المجموع بالجنيه المصري</td>' + c(plainNum(t.due)) + c(plainNum(t.paid)) + c(plainNum(t.left)) + '<td colspan="3">نسبة التحصيل: ' + pct(t) + '</td></tr>' +
      '<tr class="total"><td colspan="' + cols + '">تفصيل المحصَّل حسب وسيلة الدفع — ' + methodLine(t) + '</td></tr>',
      list.length > 1);

    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' + html +
      reportSigns([['المسؤول المالي', S.profile && S.profile.full_name], ['مدير/ة الأكاديمية', principalName()]]);
  }

  // مكان السكن: المدينة ثم العنوان التفصيلي
  function residenceOf(x) {
    return [stVal(x, 'city'), stVal(x, 'address')].filter(Boolean).join(' — ');
  }

  // المواصلات: نقطة التجمع إن كان مشتركًا، وإلا ما سُجّل عن حاجته
  function rideOf(x, groupOf) {
    var g = findGroup(groupOf[x.id]);
    return g ? g.assembly_point : x.wants_transport === true ? 'يحتاج — بلا نقطة تجمع' : x.wants_transport === false ? 'لا يحتاج' : '';
  }

  // ملف Excel بما تعرضه شاشة التسجيل بتصفيتها الحالية، وفيه السكن والمواصلات (ملف المواصلات)
  async function exportStudentsXlsx() {
    if (!(await syncData(true))) return;
    var list = filteredStudents(), groupOf = transportGroupOf();
    if (!list.length) return toast('لا يوجد طلاب للتصدير', true);
    var parts = [ui.stStatus ? ST_STATUS[ui.stStatus] : 'كل الطلاب'];
    if (ui.stClass) parts.push(ui.stClass === '-' ? 'بدون صف' : ui.stClass);
    if (ST_FLAGS[ui.stFlag]) parts.push(ST_FLAGS[ui.stFlag].label);
    try {
      await loadXlsx();
      var aoa = [[schoolName()], ['كشف الطلاب — ' + parts.join(' — ') + ' — ' + dmy(todayISO())], [],
        ['م', 'اسم الطالب', 'رقم الهوية', 'الشعبة', 'الجنس', 'حالة التسجيل', 'ولي الأمر', 'هاتف ولي الأمر', 'واتساب', 'المدينة', 'العنوان التفصيلي', 'يحتاج مواصلات', 'الباص']];
      list.forEach(function (x, i) {
        var g = findGroup(groupOf[x.id]);
        aoa.push([i + 1, x.full_name, String(x.national_id || ''), x.class_name || '', x.gender || '', ST_STATUS[stStatus(x)], x.guardian_name || '',
          String(x.phone || ''), String(x.whatsapp || ''), stVal(x, 'city'), stVal(x, 'address'),
          g || x.wants_transport === true ? 'نعم' : x.wants_transport === false ? 'لا' : '', g ? g.assembly_point : '']);
      });
      var ws = XLSX.utils.aoa_to_sheet(aoa), wb = XLSX.utils.book_new();
      ws['!cols'] = [5, 32, 14, 14, 8, 14, 28, 15, 15, 16, 44, 13, 24].map(function (w) { return { wch: w }; });
      wb.Workbook = { Views: [{ RTL: true }] };
      XLSX.utils.book_append_sheet(wb, ws, 'الطلاب');
      XLSX.writeFile(wb, ('كشف-الطلاب-' + parts.join('-') + '-' + todayISO()).replace(/[\\\/:*?"<>|]/g, ' ').replace(/\s+/g, '-') + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ----- كشوف الطلاب -----
     className: كشف شعبة بعينها (من صفحة الشعب)؛ بدونه يُطبع ما تعرضه شاشة التسجيل بتصفيتها الحالية.
     الكشف قد يمتد لصفحات: الترويسة ورأس الجدول داخل thead فيتكرران في كل صفحة.
     الصفوف 7 و8 و9: كشفان منفصلان (بنين / بنات)؛ ما دونها كشف واحد مختلط */
  function buildStudentsSheet(className) {
    var list = className ? classStudents(className) : filteredStudents();
    var flag = className ? null : ST_FLAGS[ui.stFlag], groupOf = transportGroupOf();
    var oneClass = className || (ui.stClass && ui.stClass !== '-' ? ui.stClass : '');
    var info = [];
    if (oneClass) info.push(['الشعبة', oneClass]);
    if (!className) {
      if (ui.stStatus) info.push(['الحالة', ST_STATUS[ui.stStatus]]);
      if (ui.stClass === '-') info.push(['الصف', 'بدون صف']);
      if (flag) info.push(['المعيار', flag.label]);
      if (ui.stSearch.trim()) info.push(['بحث', ui.stSearch.trim()]);
    }

    var g = oneClass ? gradeOf(oneClass) : 0;
    var parts = g >= 7 && g <= 9
      ? [['كشف البنين', list.filter(function (x) { return x.gender === 'ذكر'; })],
         ['كشف البنات', list.filter(function (x) { return x.gender === 'أنثى'; })],
         ['طلاب لم يُحدَّد جنسهم', list.filter(function (x) { return x.gender !== 'ذكر' && x.gender !== 'أنثى'; })]]
          .filter(function (p) { return p[1].length; })
      : [['كشف الطلاب', list]];

    // الأعمدة: [العنوان، القيمة، في الوسط؟، نمط]. كشف الشعبة للمعلمين: ولي الأمر وخانة ملاحظات.
    // كشف التسجيل (لملف المواصلات): مكان السكن والمواصلات بدلًا منهما
    var columns = [['اسم الطالب', function (x) { return x.full_name; }], ['رقم الهوية', function (x) { return x.national_id; }, true]];
    if (!oneClass) columns.push(['الصف', function (x) { return x.class_name || '—'; }, true]);
    columns.push(['الهاتف', function (x) { return x.phone || x.whatsapp || ''; }, true]);
    if (className) columns.push(['ولي الأمر', function (x) { return x.guardian_name; }]);
    else columns.push(['مكان السكن', residenceOf, false, 'width:27%'], ['المواصلات', function (x) { return rideOf(x, groupOf); }, false, 'width:14%']);
    if (flag && flag.extra && ui.stFlag !== 'transport') columns.push([flag.extra[0], function (x) { var v = flag.extra[1](x, groupOf); return v == null ? '' : v; }, true]);
    if (className) columns.push(['ملاحظات', function () { return ''; }, false, 'width:16%']);
    var cols = columns.length + 1;
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' + parts.map(function (part, pi) {
      var head = reportHead(part[0], info.concat([['عدد الطلاب', part[1].length]])).replace(/^<img class="wm"[^>]*>/, '');
      return '<table class="rz' + (pi ? ' newpage' : '') + '"><thead>' +
        '<tr><td class="pg-space" colspan="' + cols + '"></td></tr>' +
        '<tr><td class="ls-head" colspan="' + cols + '">' + head + '</td></tr>' +
        '<tr><th>م</th>' + columns.map(function (c) { return '<th>' + c[0] + '</th>'; }).join('') + '</tr></thead><tbody>' +
        part[1].map(function (x, i) {
          return '<tr><td class="c">' + (i + 1) + '</td>' + columns.map(function (c) {
            return '<td' + (c[2] ? ' class="c"' : '') + (c[3] ? ' style="' + c[3] + '"' : '') + '>' + esc(c[1](x)) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody><tfoot><tr><td class="pg-space" colspan="' + cols + '"></td></tr></tfoot></table>';
    }).join('') +
      reportSigns([['معلم المادة', ''], ['المرشد أو المنسق', ''], ['مدير/ة الأكاديمية', principalName()]]);
  }


  /* ----- استمارة تسجيل ورقية فارغة -----
     توزَّع على أولياء الأمور المنتظرين ليعبئوها بخط اليد، ثم يُدخلها الموظف. حقولها حقول ملف الطالب نفسها
     عدا ما يحدده الموظف (الشعبة، اختبار المستوى، مُدخل البيانات) */
  var pendingBlank = false;

  function buildBlankFormSheet() {
    var skip = { class_name: 1, placement: 1, filled_by: 1 };
    var rows = '', held = null;
    // الخيارات القليلة مربعات تُؤشَّر؛ القوائم الطويلة (المرحلة، المقاس) تُكتب باليد
    var boxes = function (f) { return f.type === 'select' && f.options.length <= 6; };
    var answer = function (f) {
      return boxes(f) ? f.options.map(function (o) { return '<span class="bf-o">☐ ' + o + '</span>'; }).join('') : '';
    };
    // عنوان الخانة المختصر، إلا الأسئلة التي لا يُفهم مختصرها
    var title = function (f) { return f.p || f.label; };
    var flush = function () {
      if (held) rows += '<tr><th>' + title(held) + '</th><td colspan="3">' + answer(held) + '</td></tr>';
      held = null;
    };
    ST_FIELDS.forEach(function (f) {
      if (f.sec) { flush(); if (f.sec !== 'مُدخل البيانات') rows += '<tr><td class="bf-sec" style="background:var(--navy);color:#fff" colspan="4">' + f.sec + '</td></tr>'; }
      if (skip[f.k]) return;
      // الحقول الطويلة ومربعات الخيارات الكثيرة تأخذ الصف كله؛ البقية حقلان في الصف
      if (f.wide || (boxes(f) && f.options.join(' ').length > 22)) {
        flush();
        rows += '<tr><th>' + title(f) + '</th><td colspan="3">' + answer(f) + '</td></tr>';
      } else if (held) {
        rows += '<tr><th>' + title(held) + '</th><td>' + answer(held) + '</td><th>' + title(f) + '</th><td>' + answer(f) + '</td></tr>';
        held = null;
      } else {
        held = f;
      }
    });
    flush();
    rows += '<tr><td class="bf-sec" style="background:var(--navy);color:#fff" colspan="4">المواصلات</td></tr>' +
      '<tr><th>يحتاج الطالب مواصلات؟</th><td><span class="bf-o">☐ نعم</span><span class="bf-o">☐ لا</span></td><th>توقيع ولي الأمر</th><td></td></tr>';

    sheet.className = 'bfp';
    sheet.innerHTML =
      reportHead('استمارة تسجيل طالب', [['العام الدراسي', academicYear()], ['ملاحظة', 'تُعبأ بخط واضح وتُسلَّم لموظف التسجيل مع المستندات']], { noIssueDate: true }) +
      '<table class="rk bf"><colgroup><col style="width:21%"><col style="width:29%"><col style="width:21%"><col style="width:29%"></colgroup><tbody>' + rows + '</tbody></table>';
    fitSheet(); // صفحة واحدة
  }

  /* ----- كشف الفصول الدراسية: الشعب وسعتها والمسجلون والمتاح (بلا جنس الشعبة) ----- */
  function buildRoomsSheet() {
    var cfg = classConfig(), counts = classCounts(), sum = { cap: 0, n: 0 };
    var c = function (v, cls) { return '<td class="c' + (cls ? ' ' + cls : '') + '">' + v + '</td>'; };
    var rows = cfg.list.map(function (k, i) {
      var n = counts[k.name] || 0, left = k.capacity == null ? null : k.capacity - n;
      sum.cap += k.capacity || 0; sum.n += n;
      return '<tr>' + c(i + 1) + '<td>' + esc(k.name) + '</td><td>' + esc(k.teacher) + '</td>' + c(k.capacity == null ? '—' : k.capacity) + c(n) +
        (left == null ? c('—') : left < 0 ? c('تجاوز بـ ' + (-left), 'bad') : left === 0 ? c('ممتلئة', 'warn') : c(left)) + '</tr>';
    }).join('');
    sheet.className = 'rm';
    sheet.innerHTML =
      reportHead('كشف الفصول الدراسية', [['عدد الغرف', cfg.rooms || ''], ['عدد الشعب', cfg.list.length], ['المسجلون نهائيًا', sum.n]]) +
      '<table class="rz"><colgroup><col style="width:7%"><col style="width:23%"><col style="width:28%"><col style="width:14%"><col style="width:14%"><col style="width:14%"></colgroup>' +
      '<thead><tr><th>م</th><th>الشعبة</th><th>مربي الصف</th><th>السعة القصوى</th><th>المسجلون نهائيًا</th><th>المتاح</th></tr></thead><tbody>' + rows +
      '<tr class="total"><td colspan="3">المجموع</td>' + c(sum.cap || '—') + c(sum.n) + c(sum.cap ? Math.max(0, sum.cap - sum.n) : '—') + '</tr></tbody></table>' +
      reportSigns([['مدير/ة الأكاديمية', principalName()]]);
    fitSheet();
  }

  /* ----- ملف الطالب ----- */
  function buildProfileSheet(x) {
    var final = stStatus(x) === 'final', docs = x.documents || {};
    var ride = findGroup(transportGroupOf()[x.id]);
    var label = function (k) { for (var i = 0; i < ST_FIELDS.length; i++) if (ST_FIELDS[i].k === k) return ST_FIELDS[i].p || ST_FIELDS[i].label; return k; };
    var value = function (k) {
      var v = stVal(x, k);
      return k === 'birth_date' || k === 'gaza_exit' ? dmy(v) : v;
    };
    var cell = function (k) { return '<th>' + label(k) + '</th><td>' + esc(value(k)) + '</td>'; };
    // صف بحقلين، أو بحقل واحد يمتد على العرض
    var two = function (a, b) { return '<tr>' + cell(a) + cell(b) + '</tr>'; };
    var one = function (k) { return '<tr><th>' + label(k) + '</th><td colspan="3">' + esc(value(k)) + '</td></tr>'; };
    var table = function (rows) { return '<table class="rk"><colgroup><col style="width:19%"><col style="width:31%"><col style="width:19%"><col style="width:31%"></colgroup>' + rows + '</table>'; };
    var rideText = ride ? 'نقطة التجمع: ' + ride.assembly_point + (ride.pickup_time ? ' — ' + ride.pickup_time : '')
      : x.wants_transport === false ? 'لا يحتاج مواصلات' : x.wants_transport === true ? 'يحتاج مواصلات — لم تُحدَّد نقطة التجمع' : 'لم يُحدَّد';
    var paysRent = stVal(x, 'housing') === 'يدفع';

    sheet.className = 'pf';
    sheet.innerHTML =
      // تاريخ التسجيل: يوم اعتماد التسجيل النهائي، وللمبدئي يوم إدخاله
      reportHead('ملف الطالب', [['حالة التسجيل', final ? 'تسجيل نهائي' : 'تسجيل مبدئي — غير نهائي'], ['الشعبة', x.class_name],
        ['تاريخ التسجيل', dmy((final && x.finalized_at) || x.created_at)]], { lead: x.full_name, noIssueDate: true }) +
      '<div class="rsec">بيانات الطالب</div>' +
      table(one('full_name') + two('national_id', 'gender') + two('birth_date', 'class_name') + two('student_phone', 'enroll_grade')) +
      '<div class="rsec">الخلفية الدراسية</div>' +
      table(two('last_grade', 'placement') + two('teams', 'quran_reading') + two('quran_parts', 'talent') + one('last_school')) +
      '<div class="rsec">بيانات ولي الأمر</div>' +
      table(one('guardian_name') + two('guardian_id', 'guardian_relation') + two('phone', 'alt_phone') + two('whatsapp', 'father_status') +
        two('father_job', 'mother_job') + two('gaza_exit', 'family_size')) +
      '<div class="rsec">الأسرة والوضع الاجتماعي</div>' +
      table(two('siblings_here', 'martyr') + two('financial', 'sponsorship') +
        '<tr>' + cell('housing') + '<th>' + label('rent') + '</th><td>' + esc(paysRent ? value('rent') : '—') + '</td></tr>' + one('family_illness')) +
      '<div class="rsec">الحالة الصحية</div>' +
      table(one('war_injury') + one('illness') + one('disability')) +
      '<div class="rsec">السكن والمواصلات</div>' +
      table('<tr>' + cell('city') + '<th>المواصلات</th><td>' + esc(rideText) + '</td></tr>' + one('address')) +
      '<div class="rsec">الزي والكتب المدرسية</div>' +
      // ثلاثة حقول قصيرة في صف واحد
      '<table class="rk"><tr>' + ['shirt_size', 'pants_size', 'has_books'].map(function (k) {
        return '<th style="width:' + (k === 'has_books' ? 24 : 17) + '%">' + label(k) + '</th><td>' + esc(value(k)) + '</td>';
      }).join('') + '</tr></table>' +
      '<div class="rsec">المستندات المستلمة</div>' +
      '<div class="rbox">' + ST_DOCS.map(function (d) { return '<span class="pf-doc">' + (docs[d[0]] ? '☑' : '☐') + ' ' + d[1] + '</span>'; }).join('') +
        (x.documents_note ? '<div>ملاحظات: ' + esc(x.documents_note) + '</div>' : '') + '</div>' +
      reportSigns([]); // بلا توقيعات: خانة الختم فقط
    fitSheet();
  }

  // يبني الورقة المناسبة للصفحة الحالية (إيصال، ملف طالب، كشف، تقرير زيارة، تقييم). يعيد false إن لم تكن للصفحة ورقة خاصة
  function buildCurrentSheet() {
    var v = currentVisit(), o = currentTeacher() || currentResult();
    printLandscape = false;
    sheet.removeAttribute('data-nosign');
    sheet.style.width = '';
    sheet.style.fontSize = '';
    sheet.removeAttribute('data-pages');
    if (pendingSigned) buildSignedReqSheet(pendingSigned);
    else if (pendingPaper) buildPaperSheet(pendingPaper);
    else if (pendingSign) buildSignSheet(pendingSign);
    else if (pendingStList) buildStaffListSheet(pendingStList);
    else if (pendingCm) buildCommitteeSheet(pendingCm);
    else if (pendingOr) buildOrderSheet(pendingOr);
    else if (pendingCl) buildClaimSheet(pendingCl);
    else if (pendingTg) buildMyStudentsSheet();
    else if (pendingSl) buildSlSheet(pendingSl);
    else if (pendingCu) buildCustodySheet();
    else if (pendingWarn) buildWarningSheet(pendingWarn);
    else if (pendingDc) buildDisciplineSheet();
    else if (pendingEx) buildExitSheet(pendingEx);
    else if (pendingAfList) buildAffairsListSheet();
    else if (pendingLt) buildLateLetterSheet(pendingLt);
    else if (pendingLa) buildAbsLetterSheet(pendingLa);
    else if (pendingSp) buildSpSheet(pendingSp);
    else if (pendingDm) buildDismissSheet(pendingDm);
    else if (pendingTs) buildTransportStatusSheet();
    else if (pendingLedRef) buildLedRefSheet();
    else if (pendingConsent) buildConsentSheet(pendingConsent);
    else if (pendingPay) { if (pendingPay.kind === 'reg') buildPayRegSheet(pendingPay.P); else buildPaySlipSheet(pendingPay); }
    else if (pendingBusRep) buildBusRepSheet();
    else if (pendingSa) { if (pendingSa.reg) buildSaRegisterSheet(pendingSa); else buildSaSheet(pendingSa); }
    else if (pendingSubs) buildSubsSheet(pendingSubs);
    else if (pendingTT) buildTtSheet(pendingTT);
    else if (pendingLed) buildLedSheet();
    else if (pendingRep) buildRepSheet();
    else if (pendingAtt) buildAttSheet(pendingAtt);
    else if (pendingBus) buildBusSheet(pendingBus);
    else if (pendingRefund) buildRefundSheet(pendingRefund);
    else if (pendingBlank) buildBlankFormSheet();
    else if (pendingReceipt) buildReceiptSheet(pendingReceipt);
    else if (pendingProfile) buildProfileSheet(pendingProfile);
    else if (location.hash === '#/students' && canStudents() && !S.studentsMissing && !ui.editStudent && !ui.imp) buildStudentsSheet();
    else if (currentClass() && canStudents()) buildStudentsSheet(currentClass());
    else if (canTransport() && S.tPay[ui.tMonth] && (currentGroup() || /^#\/transport\/(payments|classes)$/.test(location.hash))) buildPaymentsSheet(payScope());
    else if (location.hash === '#/rooms' && canView() && classConfig().list.length) buildRoomsSheet();
    else if (v) buildVisitSheet(v);
    else if (o) buildEvalSheet(o);
    else return false;
    if (sheet.classList.contains('ls')) { sheet.setAttribute('data-pages', '1'); fitPages(sheet); }
    pendingTT = null;
    pendingPaper = null;
    pendingPay = null;
    pendingSign = null;
    pendingStList = null;
    pendingCm = null;
    pendingCu = false;
    pendingOr = null;
    pendingCl = null;
    pendingTg = false;
    pendingSl = null;
    pendingLa = null;
    pendingSp = null;
    pendingWarn = null;
    pendingDc = false;
    pendingEx = null;
    pendingAfList = false;
    pendingLt = null;
    pendingDm = null;
    pendingTs = false;
    pendingLedRef = false;
    pendingConsent = null;
    pendingSubs = null;
    pendingSa = null;
    pendingBusRep = false;
    pendingReceipt = null;
    pendingProfile = null;
    pendingBlank = false;
    pendingRefund = null;
    pendingBus = null;
    pendingAtt = null;
    pendingRep = false;
    pendingLed = false;
    return true;
  }

  // خطوط الهوية تُحمَّل قبل بناء الورقة حتى يكون قياس الصفحة الواحدة صحيحًا (مع مهلة قصوى)
  function reportFontsReady(doc) {
    var wanted = ['700 12pt Cairo', '400 12pt Cairo', '600 12pt Cairo', '800 12pt Cairo', '700 12pt Montserrat'];
    var load = doc.fonts && doc.fonts.load
      ? Promise.all(wanted.map(function (f) { return doc.fonts.load(f, 'أ A').catch(function () {}); }))
      : Promise.resolve();
    return Promise.race([load, new Promise(function (resolve) { setTimeout(resolve, 2500); })]);
  }

  // أزرار الطباعة: تُطبع الورقة من إطار مستقل لا يحتوي إلا عليها وعلى تنسيقها،
  // فلا تتأثر الطباعة بحجم الصفحة الأصلية ولا بتخطيطها
  // الشعار المائي: صورة باهتة جاهزة (ألوان فاتحة وشفافية في الصورة نفسها)، لا شفافية CSS قد تتجاهلها بعض الطابعات وبرامج PDF
  var wmFaded = null, wmGrey = null;
  function fadedLogo(grey) {
    if (grey) return greyLogo();
    if (wmFaded) return Promise.resolve(wmFaded);
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var w = img.naturalWidth || 600, h = img.naturalHeight || 600, k = Math.min(1, 900 / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.round(w * k); c.height = Math.round(h * k);
          var g = c.getContext('2d');
          g.drawImage(img, 0, 0, c.width, c.height);
          var d = g.getImageData(0, 0, c.width, c.height), p = d.data;
          for (var i = 0; i < p.length; i += 4) {
            // يُخلط اللون بالأبيض ثم تُخفَّف شفافيته: يبقى خلفه مقروءًا مهما كانت الطابعة
            p[i] = 255 - (255 - p[i]) * 0.35; p[i + 1] = 255 - (255 - p[i + 1]) * 0.35; p[i + 2] = 255 - (255 - p[i + 2]) * 0.35;
            p[i + 3] = Math.round(p[i + 3] * 0.16);
          }
          g.putImageData(d, 0, 0);
          wmFaded = c.toDataURL('image/png');
        } catch (err) { wmFaded = ''; }
        resolve(wmFaded);
      };
      img.onerror = function () { wmFaded = ''; resolve(''); };
      img.src = REPORT.logo;
    });
  }

  // كشوف الرواتب: شعار رمادي أكبر وأوضح خلف النص
  function greyLogo() {
    if (wmGrey) return Promise.resolve(wmGrey);
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var w = img.naturalWidth || 600, h = img.naturalHeight || 600, k = Math.min(1, 1200 / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.round(w * k); c.height = Math.round(h * k);
          var g = c.getContext('2d');
          g.drawImage(img, 0, 0, c.width, c.height);
          var d = g.getImageData(0, 0, c.width, c.height), p = d.data;
          for (var i = 0; i < p.length; i += 4) {
            var y = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2], v = 255 - (255 - y) * 0.6;
            p[i] = p[i + 1] = p[i + 2] = v;
            p[i + 3] = Math.round(p[i + 3] * 0.24);
          }
          g.putImageData(d, 0, 0);
          wmGrey = c.toDataURL('image/png');
        } catch (err) { wmGrey = ''; }
        resolve(wmGrey);
      };
      img.onerror = function () { wmGrey = ''; resolve(''); };
      img.src = REPORT.logo;
    });
  }

  /* ----- التوقيع الإلكتروني -----
     صاحب التوقيع يرفع صورته في «التوقيع الإلكتروني». عند طباعة أي ورقة يُسأل: بلا توقيع، أو بتوقيعي، أو (لمدير النظام) بتوقيع غيره،
     أو «طلب توقيع» يصل لصاحب التوقيع فيعتمده ثم يطبعه الطالب. الورقة الموقّعة تُحفظ في القاعدة برقم ونصها وبصمتها،
     وتُطبع برمز QR يفتح verify.html فيظهر نصها الأصلي ومن وقّعها، أو أنها ملغاة. (supabase/signatures.sql) */
  var SIG = { loaded: false, missing: false, signers: [], mine: null, inbox: [], mineReqs: [], docs: [] };
  var pendingSigned = null; // { html, meta, data? }: طباعة طلب معتمد بتوقيعه (data)، أو معاينته لصاحب التوقيع (بلا data)
  async function loadSig(force) {
    if (SIG.loaded && !force) return SIG;
    var r = await sb.rpc('sig_signers');
    if (r.error) { SIG.missing = true; SIG.loaded = true; return SIG; }
    SIG.missing = false;
    SIG.signers = r.data || [];
    var me = await sb.from('signatures').select('*').eq('user_id', S.uid).maybeSingle();
    SIG.mine = me.data || null;
    var q = await sb.from('sign_requests').select('id, requester, requester_name, signer_id, title, status, code, note, created_at, decided_at').order('created_at', { ascending: false }).limit(200);
    var all = q.data || [];
    SIG.inbox = all.filter(function (x) { return x.signer_id === S.uid || (isAdmin() && x.requester !== S.uid); });
    SIG.mineReqs = all.filter(function (x) { return x.requester === S.uid; });
    var d = await sb.from('signed_docs').select('code, title, signer_name, signer_title, signed_by_name, created_at, revoked_at').order('created_at', { ascending: false }).limit(200);
    SIG.docs = d.data || [];
    SIG.loaded = true;
    return SIG;
  }
  function sigName(id) { var s = SIG.signers.filter(function (x) { return x.user_id === id; })[0]; return s ? s.name + (s.title ? ' — ' + s.title : '') : ''; }
  function sigVerifyUrl(code) { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'verify.html?c=' + code; }
  var sigQrLib = null;
  function sigQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    return sigQrLib || (sigQrLib = new Promise(function (ok, no) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
      s.onload = function () { ok(window.qrcode); };
      s.onerror = function () { sigQrLib = null; no(new Error('تعذّر تحميل مولّد رمز QR')); };
      document.head.appendChild(s);
    }));
  }
  function sigText(el) { return String(el.textContent || '').replace(/[\s ]+/g, ' ').trim(); }
  async function sigHash(t) {
    var b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
    return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function sigTitle(el) {
    var h = el.querySelector('.tt-ptitle, h1, h2, .rc-title, .title');
    var t = h ? sigText(h) : '';
    return (t || document.title || 'ورقة رسمية').slice(0, 200);
  }
  // التوقيع على الورقة: صورة التوقيع اليدوي مكان نقاط «التوقيع» في خانة صاحبه (المطابقة لصفته)، وعليها رقم الورقة مائلًا باهتًا.
  // ورمز QR وتحته رقم الورقة مكان دائرة «الختم»، أو في أعلى يسار الصفحة الأولى إن لم يكن في الورقة ختم.
  // لا يُضاف شيء إلى طول الورقة
  function sigWords(t) {
    return String(t || '').replace(/\/ة/g, '').replace(/[أإآ]/g, 'ا').split(/[\s:،,—-]+/).map(function (w) { return w.replace(/^ال/, ''); }).filter(function (w) { return w.length >= 3; });
  }
  function sigMatches(text, title) {
    var have = sigWords(text).join(' '), need = sigWords(title);
    return need.length > 0 && need.every(function (w) { return have.indexOf(w) > -1; });
  }
  function sigImgHtml(d) {
    return '<span class="sig-hand" style="position:relative;display:inline-block;vertical-align:middle;margin:-6mm 0 -5mm">' +
      '<img src="' + d.image + '" alt="" style="height:13mm;max-width:40mm;object-fit:contain;display:block">' +
      '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:9pt;letter-spacing:.18em;color:rgba(19,48,107,.22);transform:rotate(-14deg);font-weight:700;white-space:nowrap">' + esc(d.code) + '</span></span>';
  }
  async function sigQrHtml(d, mm) {
    var qr = await sigQr(), q = qr(0, 'M');
    q.addData(sigVerifyUrl(d.code)); q.make();
    var svg = q.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
    return '<span class="sig-qr" style="display:inline-flex;flex-direction:column;align-items:center;font-size:6.5pt;line-height:1.15;font-weight:700;letter-spacing:.05em;color:#222;background:#fff">' +
      svg.replace('<svg ', '<svg style="width:' + mm + 'mm;height:' + mm + 'mm;display:block" ') + esc(d.code) + '</span>';
  }
  async function sigApply(d) {
    // 1) التوقيع مكان النقاط: خانات reportSigns (.rs) أولًا، ثم أي سطر فيه صفة الموقّع ونقاط
    var placed = false, dotsRe = /[.…_]{6,}/;
    Array.prototype.forEach.call(sheet.querySelectorAll('.rs > div'), function (box) {
      if (placed || box.classList.contains('stamp')) return;
      var head = box.querySelector('b');
      if (!head || !sigMatches(head.textContent, d.title)) return;
      var line = Array.prototype.filter.call(box.querySelectorAll('span'), function (sp) { return /التوقيع/.test(sp.textContent) && dotsRe.test(sp.textContent); })[0];
      if (!line) return;
      line.innerHTML = sigImgHtml(d);
      Array.prototype.forEach.call(box.querySelectorAll('span'), function (sp) {
        if (sp !== line && /^\s*الاسم:\s*/.test(sp.textContent) && !dotsRe.test(sp.textContent)) sp.textContent = sp.textContent.replace(/^\s*الاسم:\s*/, '');
      });
      placed = true;
    });
    if (!placed && /مدير/.test(d.title || '')) {
      Array.prototype.forEach.call(sheet.querySelectorAll('.rs > div'), function (box) {
        if (placed || box.classList.contains('stamp')) return;
        var head = box.querySelector('b'), line = Array.prototype.filter.call(box.querySelectorAll('span'), function (sp) { return /التوقيع/.test(sp.textContent) && dotsRe.test(sp.textContent); })[0];
        if (!head || !line || !/مدير/.test(head.textContent) || /مدير النظام/.test(head.textContent)) return;
        line.innerHTML = sigImgHtml(d);
        placed = true;
      });
    }
    if (!placed) {
      var walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT), n, hit = null;
      while ((n = walker.nextNode())) {
        if (!dotsRe.test(n.nodeValue)) continue;
        var ctx = n.nodeValue.split(dotsRe)[0];
        if (!sigMatches(ctx, d.title) && !(n.parentNode && sigMatches(n.parentNode.textContent.split(dotsRe)[0], d.title))) continue;
        hit = n; break;
      }
      if (hit) {
        var m = dotsRe.exec(hit.nodeValue), tail = hit.splitText(m.index);
        tail.nodeValue = tail.nodeValue.slice(m[0].length);
        var holder = document.createElement('span');
        holder.innerHTML = sigImgHtml(d);
        tail.parentNode.insertBefore(holder.firstChild, tail);
        placed = true;
      }
    }
    // 2) رقم الورقة علامة مائية رأسية في الهامش الأيسر لكل صفحة
    sheet.insertAdjacentHTML('beforeend', '<div class="sig-code">' + esc(d.code) + '</div>');
    // لا مكان لتوقيعه في الورقة: يوضع في آخرها
    if (!placed) sheet.insertAdjacentHTML('beforeend', '<div style="text-align:left;margin-top:2mm">' + sigImgHtml(d).replace('margin:-6mm 0 -5mm', 'margin:0') + '</div>');
  }
  function sigMeta() { return { cls: sheet.className, width: sheet.style.width, font: sheet.style.fontSize, land: !!printLandscape, fit: sheet.getAttribute('data-fit') || '' }; }

  // نافذة الاختيار قبل الطباعة
  function sigAsk() {
    return new Promise(function (resolve) {
      var others = SIG.signers.filter(function (x) { return x.user_id !== S.uid; }), mine = SIG.mine;
      var o = document.createElement('div');
      o.style.cssText = 'position:fixed;inset:0;background:rgba(12,33,82,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
      o.innerHTML = '<div class="card" style="max-width:460px;width:100%;margin:0"><h2 style="margin-top:0">التوقيع على الورقة</h2><div style="display:grid;gap:8px">' +
        '<button type="button" class="btn" data-sg="none">طباعة بلا توقيع إلكتروني</button>' +
        (mine ? '<button type="button" class="btn primary" data-sg="me">توقيعها بتوقيعي (' + esc(mine.title || mine.name) + ')</button>' : '') +
        (others.length ? '<label class="field" style="margin:6px 0 0" for="sg-who">' + (isAdmin() ? 'أو بتوقيع:' : 'أو طلب توقيع من:') + '</label><select id="sg-who">' +
          others.map(function (x) { return '<option value="' + x.user_id + '">' + esc(x.name + (x.title ? ' — ' + x.title : '')) + '</option>'; }).join('') + '</select>' +
          (isAdmin() ? '<button type="button" class="btn primary" data-sg="as">توقيعها الآن نيابة عنه (مدير النظام)</button>' : '') +
          '<button type="button" class="btn" data-sg="req">إرسال طلب توقيع (يعتمده صاحبه، ثم تطبعها من «التوقيع الإلكتروني»)</button>' : '') +
        '<button type="button" class="btn" data-sg="cancel" style="margin-top:4px">إلغاء</button></div></div>';
      document.body.appendChild(o);
      o.addEventListener('click', function (e) {
        var b = e.target.closest('[data-sg]'); if (!b) return;
        var who = (o.querySelector('#sg-who') || {}).value;
        o.remove();
        resolve({ k: b.getAttribute('data-sg'), who: who });
      });
    });
  }

  // تُستدعى من printNow بعد بناء الورقة. false = لا تُطبع الآن
  async function sigStep() {
    if (pendingSigned) {
      var ps = pendingSigned; pendingSigned = null;
      if (ps.data) { try { await sigApply(ps.data); } catch (err) { toast(err.message, true); return false; } }
      return true;
    }
    if (!S.uid || role() === 'pending' || sheet.hasAttribute('data-nosign')) return true;
    try { await loadSig(); } catch (err) { return true; }
    if (SIG.missing || !SIG.signers.length) return true;
    var a = await sigAsk();
    if (a.k === 'cancel') return false;
    if (a.k === 'none') return true;
    var body = sigText(sheet), hash = await sigHash(body), title = sigTitle(sheet);
    if (a.k === 'req') {
      var row = { requester: S.uid, requester_name: (S.profile && S.profile.full_name) || displayName(S.email), signer_id: a.who, title: title, html: sheet.innerHTML, meta: sigMeta(), body: body.slice(0, 20000), hash: hash };
      var ir = await sb.from('sign_requests').insert(row).select('id, requester, requester_name, signer_id, title, status, code, note, created_at, decided_at').single();
      if (ir.error) { fail(ir.error); return false; }
      if (ir.data) SIG.mineReqs.unshift(ir.data);
      toast('أُرسل طلب التوقيع إلى ' + sigName(a.who) + '. اطبع الورقة بعد توقيعها من «التوقيع الإلكتروني».');
      return false;
    }
    var r = await sb.rpc('sign_doc', { p_signer: a.k === 'me' ? S.uid : a.who, p_title: title, p_body: body.slice(0, 20000), p_hash: hash, p_request: null });
    if (r.error) { fail(r.error); return false; }
    SIG.loaded = false;
    try { await sigApply(r.data); } catch (err) { toast(err.message, true); return false; }
    return true;
  }
  function buildSignedReqSheet(ps) {
    var m = ps.meta || {};
    sheet.className = m.cls || '';
    sheet.style.width = m.width || '';
    sheet.style.fontSize = m.font || '';
    if (m.fit) sheet.setAttribute('data-fit', m.fit); else sheet.removeAttribute('data-fit');
    printLandscape = !!m.land;
    sheet.innerHTML = ps.html;
  }

  // صفحة «التوقيع الإلكتروني»
  async function renderSignatures() {
    app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>';
    await loadSig(true);
    if (location.hash !== '#/signatures') return;
    if (SIG.missing) { app.innerHTML = '<div class="card"><h2>التوقيع الإلكتروني</h2><p>شغّل الملف <code>supabase/signatures.sql</code> في محرر SQL في Supabase أولًا.</p></div>'; return; }
    var me = SIG.mine;
    var badge = function (s) { return s === 'approved' ? '<span class="badge approved">وُقّعت</span>' : s === 'rejected' ? '<span class="badge unpaid">رُفض</span>' : '<span class="badge edit">بانتظار التوقيع</span>'; };
    var when = function (t) { return t ? dmy(String(t).slice(0, 10)) : ''; };
    var inboxPend = SIG.inbox.filter(function (x) { return x.status === 'pending'; });
    app.innerHTML = '<h1 class="page-title" style="margin:0 0 12px">التوقيع الإلكتروني</h1>' +
      '<div class="card"><h2>توقيعي</h2><p class="hint">ارفع صورة توقيعك على ورق أبيض (تُزال الخلفية البيضاء تلقائيًا). لا يراها أحد غيرك، وتُطبع فقط على الأوراق التي توقّعها، ومعها رقم الورقة ورمز QR يثبت صحتها.</p>' +
        '<div class="grid2"><div><label class="field" for="sg-name">الاسم كما يُطبع</label><input type="text" id="sg-name" value="' + esc(me ? me.name : ((S.profile && S.profile.full_name) || '')) + '"></div>' +
        '<div><label class="field" for="sg-title">الصفة</label><input type="text" id="sg-title" list="sg-titles" placeholder="مثال: مدير/ة الأكاديمية" value="' + esc(me ? me.title : '') + '"><datalist id="sg-titles"><option value="مدير/ة الأكاديمية"><option value="المشرف التربوي"><option value="مسؤول/ة شؤون الطلاب"><option value="المحاسب/ة"><option value="مسؤول/ة المواصلات"></datalist></div></div>' +
        '<div style="margin:12px 0;display:flex;align-items:center;gap:14px;flex-wrap:wrap"><div id="sg-prev" style="min-width:200px;min-height:70px;border:1px dashed var(--line);border-radius:10px;display:flex;align-items:center;justify-content:center;padding:6px;background:#fff">' +
          (me ? '<img src="' + me.image + '" alt="توقيعي" style="max-height:80px;max-width:260px">' : '<span class="hint" style="margin:0">لا توقيع</span>') + '</div>' +
          '<input type="file" id="sg-file" accept="image/*"></div>' +
        '<div class="actions"><button type="button" class="btn primary" data-sgsave>حفظ التوقيع</button>' + (me ? '<button type="button" class="btn danger" data-sgdel>حذف توقيعي</button>' : '') + '</div></div>' +
      (SIG.inbox.length ? '<div class="card"><h2>طلبات التوقيع الواردة' + (inboxPend.length ? ' (' + inboxPend.length + ' بانتظارك)' : '') + '</h2><div class="table-wrap"><table class="grid"><thead><tr><th>الورقة</th><th>من</th><th>إلى</th><th>التاريخ</th><th>الحالة</th><th></th></tr></thead><tbody>' +
        SIG.inbox.slice(0, 60).map(function (x) {
          return '<tr><td>' + esc(x.title) + '</td><td>' + esc(x.requester_name) + '</td><td>' + esc(sigName(x.signer_id)) + '</td><td>' + when(x.created_at) + '</td><td>' + badge(x.status) + (x.code ? ' <small>' + esc(x.code) + '</small>' : '') + '</td><td style="white-space:nowrap">' +
            (x.status === 'pending' ? '<button type="button" class="btn sm" data-sgview="' + x.id + '">معاينة</button> <button type="button" class="btn sm primary" data-sgok="' + x.id + '">توقيع</button> <button type="button" class="btn sm danger" data-sgno="' + x.id + '">رفض</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>' : '') +
      '<div class="card"><h2>طلباتي</h2>' + (SIG.mineReqs.length ? '<div class="table-wrap"><table class="grid"><thead><tr><th>الورقة</th><th>إلى</th><th>التاريخ</th><th>الحالة</th><th></th></tr></thead><tbody>' +
        SIG.mineReqs.slice(0, 60).map(function (x) {
          return '<tr><td>' + esc(x.title) + '</td><td>' + esc(sigName(x.signer_id)) + '</td><td>' + when(x.created_at) + '</td><td>' + badge(x.status) + (x.note ? '<br><small>' + esc(x.note) + '</small>' : '') + '</td><td style="white-space:nowrap">' +
            (x.status === 'approved' ? '<button type="button" class="btn sm primary" data-sgprint="' + x.id + '">طباعة موقّعة / PDF</button>' : x.status === 'pending' ? '<button type="button" class="btn sm" data-sgcancel="' + x.id + '">سحب الطلب</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="hint" style="margin:0">لا طلبات. عند طباعة أي ورقة اختر «إرسال طلب توقيع».</p>') + '</div>' +
      (SIG.docs.length ? '<div class="card"><h2>الأوراق الموقّعة</h2><p class="hint">إلغاء ورقة يجعل صفحة التحقق تُظهرها «ملغاة» لكل من يمسح رمزها.</p><div class="table-wrap"><table class="grid"><thead><tr><th>الرقم</th><th>الورقة</th><th>الموقّع</th><th>وقّعها</th><th>التاريخ</th><th></th></tr></thead><tbody>' +
        SIG.docs.slice(0, 100).map(function (d) {
          return '<tr><td><a href="' + esc(sigVerifyUrl(d.code)) + '" target="_blank" rel="noopener">' + esc(d.code) + '</a></td><td>' + esc(d.title) + '</td><td>' + esc(d.signer_name) + '</td><td>' + esc(d.signed_by_name) + '</td><td>' + when(d.created_at) + '</td><td>' +
            (d.revoked_at ? '<span class="badge unpaid">ملغاة</span>' : '<button type="button" class="btn sm danger" data-sgrevoke="' + esc(d.code) + '">إلغاء</button>') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>' : '');
  }

  // صورة التوقيع: تُصغَّر وتُقص حوافها وتُزال خلفيتها البيضاء
  function sigProcess(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 900 / img.width, 400 / img.height), w = Math.round(img.width * k), h = Math.round(img.height * k);
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
        var px = g.getImageData(0, 0, w, h), d = px.data, x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (var i = 0; i < d.length; i += 4) {
          var lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
          if (lum > 200 || d[i + 3] < 40) d[i + 3] = 0;
          else {
            d[i + 3] = Math.min(255, Math.round((200 - lum) * 2.2) + 60);
            var p = i / 4, x = p % w, y = (p - x) / w;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
        URL.revokeObjectURL(url);
        if (x1 < 0) return reject(new Error('لم أجد توقيعًا في الصورة'));
        g.putImageData(px, 0, 0);
        var o = document.createElement('canvas'), pad = 6;
        o.width = x1 - x0 + 1 + 2 * pad; o.height = y1 - y0 + 1 + 2 * pad;
        o.getContext('2d').drawImage(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1);
        resolve(o.toDataURL('image/png'));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('تعذّر قراءة الصورة')); };
      img.src = url;
    });
  }
  var sigNewImage = null;
  document.addEventListener('change', async function (e) {
    if (e.target.id !== 'sg-file' || location.hash !== '#/signatures') return;
    var f = e.target.files && e.target.files[0]; if (!f) return;
    try { sigNewImage = await sigProcess(f); document.getElementById('sg-prev').innerHTML = '<img src="' + sigNewImage + '" alt="" style="max-height:80px;max-width:260px">'; }
    catch (err) { toast(err.message, true); }
  });
  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/signatures') return;
    var el, r;
    if (e.target.closest('[data-sgsave]')) {
      var image = sigNewImage || (SIG.mine && SIG.mine.image);
      if (!image) return toast('اختر صورة التوقيع أولًا', true);
      var row = { user_id: S.uid, name: document.getElementById('sg-name').value.trim(), title: document.getElementById('sg-title').value.trim(), image: image, updated_at: new Date().toISOString() };
      if (!row.name) return toast('اكتب الاسم', true);
      r = await sb.from('signatures').upsert(row, { onConflict: 'user_id' });
      if (r.error) return fail(r.error);
      sigNewImage = null; toast('حُفظ التوقيع'); return renderSignatures();
    }
    if (e.target.closest('[data-sgdel]')) {
      if (!confirm('حذف توقيعك؟ الأوراق الموقّعة سابقًا تبقى صحيحة.')) return;
      r = await sb.from('signatures').delete().eq('user_id', S.uid);
      if (r.error) return fail(r.error);
      return renderSignatures();
    }
    if ((el = e.target.closest('[data-sgview]'))) {
      r = await sb.from('sign_requests').select('html, meta').eq('id', el.getAttribute('data-sgview')).single();
      if (r.error) return fail(r.error);
      pendingSigned = { html: r.data.html, meta: r.data.meta };
      return printNow();
    }
    if ((el = e.target.closest('[data-sgok]'))) {
      var id = el.getAttribute('data-sgok'), rq = SIG.inbox.filter(function (x) { return x.id === id; })[0];
      if (!rq || !confirm('توقيع «' + rq.title + '» المرسلة من ' + rq.requester_name + '؟ يُفضّل معاينتها أولًا.')) return;
      r = await sb.rpc('sign_doc', { p_signer: rq.signer_id, p_title: '', p_body: '', p_hash: '', p_request: rq.id });
      if (r.error) return fail(r.error);
      toast('وُقّعت الورقة، ويطبعها ' + rq.requester_name + ' من صفحته'); return renderSignatures();
    }
    if ((el = e.target.closest('[data-sgno]'))) {
      var note = prompt('سبب الرفض (يظهر لمرسل الطلب):', '');
      if (note == null) return;
      r = await sb.rpc('sig_reject', { p_request: el.getAttribute('data-sgno'), p_note: note });
      if (r.error) return fail(r.error);
      return renderSignatures();
    }
    if ((el = e.target.closest('[data-sgcancel]'))) {
      r = await sb.from('sign_requests').delete().eq('id', el.getAttribute('data-sgcancel'));
      if (r.error) return fail(r.error);
      return renderSignatures();
    }
    if ((el = e.target.closest('[data-sgprint]'))) {
      r = await sb.rpc('sig_request_print', { p_id: el.getAttribute('data-sgprint') });
      if (r.error) return fail(r.error);
      pendingSigned = { html: r.data.html, meta: r.data.meta, data: r.data };
      return printNow();
    }
    if ((el = e.target.closest('[data-sgrevoke]'))) {
      var code = el.getAttribute('data-sgrevoke');
      if (!confirm('إلغاء الورقة ' + code + '؟ ستظهر «ملغاة» لكل من يتحقق منها، ولا يمكن التراجع.')) return;
      r = await sb.rpc('sig_revoke', { p_code: code });
      if (r.error) return fail(r.error);
      return renderSignatures();
    }
  });

  async function printNow() {
    await reportFontsReady(document);
    // العلامة المائية في كل التقارير (ومنها كشف الرواتب والسليبات) هي الشعار الباهت نفسه، لا الشعار الرمادي الأغمق
    var faded = await fadedLogo(false);
    if (!buildCurrentSheet()) return window.print();
    if (!(await sigStep())) { sheet.innerHTML = ''; return; }
    // تذييل كل ورقة مطبوعة: عنوان الأكاديمية ووسائل الاتصال وصفحة فيسبوك (أوراق العمل لها تذييلها المصوَّر)
    if (!sheet.classList.contains('paper') && !sheet.querySelector('.doc-foot')) {
      var st = S.settings || {};
      sheet.insertAdjacentHTML('beforeend', '<div class="doc-foot">' + esc(st.school_address || REPORT.address) + '&nbsp;&nbsp;|&nbsp;&nbsp;هاتف: <span dir="ltr">' + esc(st.school_phone || REPORT.phone) + '</span>&nbsp;&nbsp;|&nbsp;&nbsp;فيسبوك: <span dir="ltr">' + esc(st.school_facebook || REPORT.facebook) + '</span></div>');
    }
    if (faded) Array.prototype.forEach.call(sheet.querySelectorAll('img.wm'), function (im) { im.src = faded; im.classList.add('wm-baked'); });
    var css = pageCss() + 'html,body{margin:0;background:#fff}';
    var rules = document.getElementById('app-css').sheet.cssRules;
    for (var i = 0; i < rules.length; i++) {
      var sel = rules[i].selectorText || '';
      if (sel.indexOf('#print-sheet') > -1 && sel.indexOf('body.print-sheet') < 0) css += rules[i].cssText;
    }
    css += '#print-sheet{position:static!important;visibility:visible!important;box-sizing:content-box}' + sheetPadCss('');

    var old = document.getElementById('print-frame');
    if (old) old.remove();
    var frame = document.createElement('iframe');
    frame.id = 'print-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    var doc = frame.contentDocument;
    doc.open();
    doc.write('<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>' + esc(document.title) + '</title>' +
      '<link rel="stylesheet" href="' + REPORT.fonts + '"><style>' + css + '</style></head><body>' + sheet.outerHTML + '</body></html>');
    doc.close();
    sheet.innerHTML = ''; // الورقة صارت في الإطار؛ لا تبقى نسخة مخفية تثقل الصفحة

    // يُنتظر تحميل الشعار والخطوط داخل الإطار (مع مهلة قصوى) قبل فتح نافذة الطباعة
    var imgs = Array.prototype.map.call(doc.images, function (img) {
      return img.complete ? null : new Promise(function (resolve) { img.addEventListener('load', resolve); img.addEventListener('error', resolve); });
    });
    // ملف الخطوط يُحمَّل أولًا: طلب الخط قبل وصول تعريفه ينتهي فورًا فيُقاس بخط بديل أقصر وتفيض الورقة عند الطباعة
    var link = doc.querySelector('link[rel="stylesheet"]');
    var cssReady = !link || link.sheet ? Promise.resolve() : new Promise(function (resolve) { link.addEventListener('load', resolve); link.addEventListener('error', resolve); });
    var fontsReady = cssReady.then(function () { return reportFontsReady(doc); });
    await Promise.race([Promise.all(imgs.concat([fontsReady])), new Promise(function (resolve) { setTimeout(resolve, 6000); })]);
    if (!frame.isConnected) return;
    // القياس النهائي داخل الإطار نفسه بعد تحميل خطوطه: هو ما سيُطبع فعلًا
    var printed = doc.getElementById('print-sheet');
    if (printed.getAttribute('data-fit')) fitElement(printed, true);
    else if (printed.getAttribute('data-pages')) fitPages(printed);
    else if (printed.classList.contains('att-regs')) fitRegisterPages(printed); // بخطوط الإطار نفسها
    else if (printed.classList.contains('tt-pages')) fitTtPages(printed);
    frame.contentWindow.focus();
    frame.contentWindow.print();
    printLandscape = false; // طباعة الصفحة العادية بعدها تعود عمودية
  }





  function currentResult() {
    var m = location.hash.match(/^#\/r\/(.+)$/);
    if (!m || !S.results) return null;
    for (var i = 0; i < S.results.length; i++) if (S.results[i].id === m[1]) return S.results[i];
    return null;
  }



  // Ctrl+P من المتصفح مباشرة
  window.addEventListener('beforeprint', function () {
    if (buildCurrentSheet()) document.body.classList.add('print-sheet');
  });

  window.addEventListener('afterprint', function () {
    document.body.classList.remove('print-sheet');
    sheet.innerHTML = '';
  });

  async function createVisit(teacherId) {
    var t = find(teacherId);
    if (!t) return;
    var mine = S.visits.filter(function (x) { return x.teacher_id === teacherId; });
    var maxNo = mine.reduce(function (m, x) { return Math.max(m, x.visit_number || 0); }, 0);
    // تُعبأ البيانات الأساسية تلقائيًا قدر الإمكان
    var ins = await sb.from('visits').insert({
      teacher_id: teacherId,
      visit_date: todayISO(),
      // مبحث واحد يُعبأ تلقائيًا؛ أكثر من مبحث يختاره المشرف من القائمة
      subject: splitList(t.subject).length === 1 ? splitList(t.subject)[0] : '',
      class_section: mine.length ? mine[0].class_section : '',
      visit_number: maxNo + 1,
      supervisor_name: (S.profile && S.profile.full_name) || '',
      principal_name: principalName()
    }).select().single();
    if (ins.error) return fail(ins.error);
    var v = ins.data;
    v.strengths = v.strengths || {};
    S.visits.unshift(v);
    go('#/v/' + v.id);
  }

  document.addEventListener('click', async function (e) {
    var el;
    if ((el = e.target.closest('[data-openv]'))) return go('#/v/' + el.getAttribute('data-openv'));
    if (e.target.closest('[data-newvisit]')) return createVisit(document.getElementById('visit-teacher').value);

    var v = currentVisit();
    if (!v) return;

    if ((el = e.target.closest('[data-visapprove]'))) {
      if (!canApproveVisit()) return;
      var okv = el.getAttribute('data-visapprove') === '1';
      if (!okv && !confirm('إلغاء اعتماد هذا التقرير؟')) return;
      var ar = await sb.rpc('set_visit_approval', { p_id: v.id, p_approve: okv });
      if (ar.error) return /set_visit_approval|schema cache|function/i.test(ar.error.message || '') ? toast('الاعتماد يحتاج تشغيل الملف supabase/visit_approval.sql في محرر SQL', true) : fail(ar.error);
      var fresh = await sb.from('visits').select('*').eq('id', v.id).maybeSingle();
      if (fresh.data) Object.assign(v, fresh.data);
      var abox = document.getElementById('visit-approval');
      if (abox) abox.innerHTML = visitApprovalHtml(v);
      return toast(okv ? 'اعتُمد التقرير' : 'أُلغي الاعتماد');
    }

    if (e.target.closest('[data-delvisit]')) {
      if (!confirm('هل تريد حذف هذا التقرير نهائيًا؟')) return;
      clearTimeout(visitTimer); visitTimer = null;
      var d = await sb.from('visits').delete().eq('id', v.id);
      if (d.error) return fail(d.error);
      S.visits = S.visits.filter(function (x) { return x.id !== v.id; });
      return go('#/visits');
    }

    if ((el = e.target.closest('[data-chip]'))) {
      var key = el.getAttribute('data-chip'), text = el.getAttribute('data-text');
      var cur = lines(getField(v, key));
      var at = cur.indexOf(text);
      if (at > -1) cur.splice(at, 1); else cur.push(text);
      setField(v, key, cur.join('\n'));
      document.getElementById('f-' + key).value = getField(v, key);
      el.classList.toggle('on', at < 0);
      el.setAttribute('aria-pressed', at < 0);
      return queueVisit(v);
    }

    if ((el = e.target.closest('[data-addstmt]'))) return addStatement(v, el.getAttribute('data-addstmt'));

    if ((el = e.target.closest('[data-delstmt]'))) {
      if (!confirm('هل تريد حذف هذه العبارة من القائمة المقترحة؟ (لن تُحذف من التقارير المحفوظة)')) return;
      var sid = el.getAttribute('data-delstmt');
      var r = await sb.from('statements').delete().eq('id', sid);
      if (r.error) return fail(r.error);
      S.statements = S.statements.filter(function (x) { return x.id !== sid; });
      refreshChips(v, el.getAttribute('data-key'));
    }
  });

  async function addStatement(v, key) {
    var input = app.querySelector('[data-newstmt="' + key + '"]');
    var text = input.value.trim();
    if (!text) return input.focus();
    var builtin = key.charAt(0) === 'd' && key.length === 2 ? DOMAINS[Number(key.slice(1))].bank : BANK[key];
    var known = builtin.indexOf(text) > -1 ||
      S.statements.some(function (x) { return x.field === key && x.body === text; });
    if (!known) {
      var ins = await sb.from('statements').insert({ field: key, body: text }).select().single();
      if (ins.error) return fail(ins.error);
      S.statements.push(ins.data);
    }
    var cur = lines(getField(v, key));
    if (cur.indexOf(text) < 0) cur.push(text);
    setField(v, key, cur.join('\n'));
    document.getElementById('f-' + key).value = getField(v, key);
    refreshChips(v, key);
    queueVisit(v);
  }

  app.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.hasAttribute('data-newstmt')) return;
    e.preventDefault();
    var v = currentVisit();
    if (v) addStatement(v, e.target.getAttribute('data-newstmt'));
  });

  app.addEventListener('input', function (e) {
    var v = currentVisit(), el = e.target;
    if (!v) return;
    if (el.hasAttribute('data-vfield')) {
      var key = el.getAttribute('data-vfield');
      setField(v, key, el.value);
      refreshChips(v, key);
      queueVisit(v);
    } else if (el.hasAttribute('data-vbasic')) {
      var col = el.getAttribute('data-vbasic');
      if (col === 'visit_date' && !el.value) return;
      v[col] = col === 'visit_number' ? Math.max(1, parseInt(el.value, 10) || 1) : el.value;
      if (col === 'visit_date') document.getElementById('visit-day').textContent = dayName(v.visit_date);
      var sign = document.getElementById('sign-' + col);
      if (sign) sign.textContent = el.value;
      queueVisit(v);
    }
  });

