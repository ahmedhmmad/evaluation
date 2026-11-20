'use strict';
  /* ---------- هوية المدرسة ومعالج الإعداد (supabase/setup_wizard.sql) ----------
     S.brand من school_brand(): اسم المدرسة، وهل فيها مدير عام، وهل أُنهي الإعداد، و legacy (المدرسة الأصلية).
     الشعار والترويسة صور في الإعدادات تُحفظ في المتصفح مع brand_ver، فلا تُجلب إلا إن تغيّرت.
     المدرسة الأصلية (legacy، أو قاعدة لم يُشغَّل فيها الملف) تبقى لها القيم الاحتياطية المكتوبة في الكود؛
     ومدرسة جديدة لا يُطبع فيها شيء من بيانات مدرسة أخرى: بلا صور ثابتة ولا عنوان ولا هاتف ولا اسم مدير احتياطي.
     المعالج (#/setup) للمدير العام: الهوية، الإدارة والتواصل، الصفوف، الطلاب والعاملون، المستخدمون، ثم «إنهاء الإعداد». */

  var BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  var BRAND_KEY = 'tpa-brand-images';
  var REPORT_BASE = null; // القيم المكتوبة في الكود كما هي قبل أي تعديل
  var brandImgs = { logo: '', banner: '', ver: '' };

  function legacyBrand() { return !S.brand || S.brand.legacy !== false; }

  async function loadBrand() {
    if (!sb) return;
    var r = await sb.rpc('school_brand');
    if (r.error || !r.data) { S.brand = null; applyBrand(); return; } // الملف لم يُشغَّل: المدرسة الأصلية
    S.brand = r.data;
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(BRAND_KEY) || 'null'); } catch (e) { cached = null; }
    if (cached && cached.ver === S.brand.brand_ver) brandImgs = cached;
    else if (!S.brand.has_logo && !S.brand.has_banner) brandImgs = { logo: '', banner: '', ver: S.brand.brand_ver };
    else {
      var im = await sb.rpc('school_brand_images');
      if (!im.error && im.data) {
        brandImgs = { logo: im.data.logo || '', banner: im.data.banner || '', ver: im.data.brand_ver || '' };
        try { localStorage.setItem(BRAND_KEY, JSON.stringify(brandImgs)); } catch (e) { /* ممتلئ أو ممنوع: تُجلب كل مرة */ }
      }
    }
    applyBrand();
  }

  // يطبّق الاسم والصور على ثوابت التقارير وعلى الصفحة (العنوان، الشريط الجانبي، الأيقونة)
  function applyBrand() {
    if (!REPORT_BASE) REPORT_BASE = { nameAr: REPORT.nameAr, nameEn: REPORT.nameEn, logo: REPORT.logo, banner: REPORT.banner,
      address: REPORT.address, phone: REPORT.phone, facebook: REPORT.facebook, principal: DEFAULT_PRINCIPAL };
    var legacy = legacyBrand(), b = S.brand || {}, set = S.settings || {};
    var name = set.school_name || b.name || '', nameEn = set.school_name_en || b.name_en || '';
    REPORT.nameAr = name || (legacy ? REPORT_BASE.nameAr : 'المدرسة');
    REPORT.nameEn = nameEn || (legacy ? REPORT_BASE.nameEn : '');
    REPORT.logo = brandImgs.logo || (legacy ? REPORT_BASE.logo : BLANK_IMG);
    REPORT.banner = brandImgs.banner || (legacy ? REPORT_BASE.banner : '');
    REPORT.address = legacy ? REPORT_BASE.address : '';
    REPORT.phone = legacy ? REPORT_BASE.phone : '';
    REPORT.facebook = legacy ? REPORT_BASE.facebook : '';
    DEFAULT_PRINCIPAL = legacy ? REPORT_BASE.principal : '';
    var shown = schoolName();
    document.title = shown;
    var bn = document.getElementById('brand-name'), tn = document.getElementById('top-name'), en = document.getElementById('brand-en');
    if (bn) bn.textContent = shown;
    if (tn) tn.textContent = shown;
    if (en) en.textContent = REPORT.nameEn;
    // الشعار المصغّر: الشعار المرفوع، وإلا القصّ من صورة الترويسة الأصلية (المدرسة الأصلية)، وإلا الحرف الأول من الاسم
    var logoCss = brandImgs.logo ? '#fff url("' + brandImgs.logo + '") no-repeat center / 84%' : legacy ? '' : 'var(--gold, #C9A24B)';
    document.querySelectorAll('.tree-logo').forEach(function (el) {
      el.style.background = logoCss;
      el.textContent = !brandImgs.logo && !legacy && name ? name.replace(/^(أكاديمية|مدرسة|مدارس)\s+/, '').charAt(0) : '';
      el.classList.toggle('letter-logo', !brandImgs.logo && !legacy);
    });
    var icon = document.querySelector('link[rel="icon"]');
    if (icon) icon.href = brandImgs.logo || (legacy ? 'logo.png' : BLANK_IMG);
  }

  // صور الأوراق المطبوعة (أوراق العمل والاختبارات، كشف الرواتب) في المدرسة الأصلية؛ وفي غيرها شعار المدرسة وترويستها
  function paperImg(kind) {
    if (legacyBrand() && !brandImgs.banner) return { hdr: 'paper-header.png', ftr: 'paper-footer.png', wm: 'paper-wm.png', payroll: 'banner-payroll.png' }[kind];
    if (kind === 'hdr') return REPORT.banner || BLANK_IMG;
    if (kind === 'wm') return REPORT.logo;
    if (kind === 'payroll') return REPORT.banner;
    return BLANK_IMG;
  }

  /* ----- رفع الصور: تُصغَّر في المتصفح وتُحفظ نصًا في الإعدادات ----- */
  var IMG_SPEC = {
    logo_data: { label: 'الشعار', max: 400, hint: 'صورة مربعة، ويُفضَّل PNG بخلفية شفافة. يظهر علامة مائية في التقارير وفي أعلى الموقع.' },
    banner_data: { label: 'صورة الترويسة', max: 2000, hint: 'صورة عريضة بعرض الصفحة (مثل 2000×300) فيها الشعار والاسم. تظهر أعلى كل تقرير مطبوع. بدونها تُكتب الترويسة نصًا.' }
  };

  function shrinkImage(file, max) {
    return new Promise(function (resolve, reject) {
      var rd = new FileReader();
      rd.onerror = function () { reject(new Error('تعذرت قراءة الملف')); };
      rd.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('الملف ليس صورة يمكن فتحها')); };
        img.onload = function () {
          var k = Math.min(1, max / Math.max(img.width, img.height)), w = Math.round(img.width * k), h = Math.round(img.height * k);
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          // الأصغر من PNG و WebP (يحفظان الشفافية) و JPEG (لصورة بلا شفافية فقط)
          var opts = [c.toDataURL('image/png'), c.toDataURL('image/webp', 0.9)];
          if (!/png|gif|webp/.test(file.type)) opts.push(c.toDataURL('image/jpeg', 0.88));
          opts = opts.filter(function (x) { return /^data:image\/(png|webp|jpeg)/.test(x); }); // متصفح لا يكتب webp يعيد png
          resolve(opts.sort(function (x, y) { return x.length - y.length; })[0]);
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }

  function brandImageField(key) {
    var sp = IMG_SPEC[key], cur = key === 'logo_data' ? brandImgs.logo : brandImgs.banner;
    return '<div class="sw-img"><label class="field">' + sp.label + '</label>' +
      '<div class="sw-prev' + (key === 'banner_data' ? ' wide' : '') + '">' + (cur ? '<img src="' + cur + '" alt="' + sp.label + '">' : '<span class="hint" style="margin:0">لم تُرفع بعد</span>') + '</div>' +
      '<div class="toolbar" style="margin:6px 0 0"><button type="button" class="btn" data-brandpick="' + key + '">' + (cur ? 'تغيير' : 'رفع صورة') + '</button>' +
      (cur ? '<button type="button" class="btn" data-brandclear="' + key + '">حذف</button>' : '') + '</div>' +
      '<p class="hint" style="margin:6px 0 0">' + sp.hint + '</p></div>';
  }

  async function saveBrandImage(key, value) {
    var patch = {};
    patch[key] = value;
    var r = await sb.from('settings').update(patch).eq('id', 1);
    if (r.error) return fail(r.error);
    if (key === 'logo_data') brandImgs.logo = value; else brandImgs.banner = value;
    var b = await sb.rpc('school_brand');
    if (!b.error && b.data) { S.brand = b.data; brandImgs.ver = b.data.brand_ver; }
    try { localStorage.setItem(BRAND_KEY, JSON.stringify(brandImgs)); } catch (e) { /* لا بأس */ }
    applyBrand();
    toast(value ? 'تم حفظ ' + IMG_SPEC[key].label : 'حُذفت ' + IMG_SPEC[key].label);
    render();
  }

  document.addEventListener('click', async function (e) {
    var el;
    if ((el = e.target.closest('[data-brandpick]')) && isAdmin()) {
      var key = el.getAttribute('data-brandpick'), inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp,image/gif';
      inp.onchange = async function () {
        var f = inp.files && inp.files[0];
        if (!f) return;
        try { await saveBrandImage(key, await shrinkImage(f, IMG_SPEC[key].max)); } catch (err) { toast(err.message, true); }
      };
      inp.click();
      return;
    }
    if ((el = e.target.closest('[data-brandclear]')) && isAdmin()) {
      if (confirm('حذف ' + IMG_SPEC[el.getAttribute('data-brandclear')].label + '؟')) saveBrandImage(el.getAttribute('data-brandclear'), '');
      return;
    }
    if (e.target.closest('[data-act="claim-admin"]')) {
      el = e.target.closest('[data-act="claim-admin"]');
      el.disabled = true;
      var c = await sb.rpc('claim_first_admin');
      if (c.error) { el.disabled = false; return fail(c.error); }
      if (!c.data) { toast('يوجد مدير عام لهذه المدرسة بالفعل: اطلب منه تفعيل حسابك', true); await loadBrand(); return render(); }
      if (S.brand) S.brand.has_admin = true;
      toast('أصبح حسابك حساب المدير العام');
      location.hash = '#/setup';
      return loadAll();
    }
    if ((el = e.target.closest('[data-swstep]'))) { ui.swStep = Number(el.getAttribute('data-swstep')); render(); window.scrollTo(0, 0); return; }
    if (e.target.closest('[data-swfinish]') && isAdmin()) {
      var s = S.settings || {};
      if (!s.school_name) { ui.swStep = 0; render(); return toast('اكتب اسم المدرسة أولًا', true); }
      if (!s.principal_name && !confirm('لم يُكتب اسم المدير، فستبقى خانة توقيعه فارغة في التقارير. إنهاء الإعداد مع ذلك؟')) { ui.swStep = 1; return render(); }
      var d = await sb.from('settings').update({ setup_done: true }).eq('id', 1);
      if (d.error) return fail(d.error);
      s.setup_done = true;
      if (S.brand) S.brand.setup_done = true;
      toast('انتهى إعداد المدرسة. يمكن تعديل كل ذلك لاحقًا من «الإعدادات والمستخدمون ← بيانات المدرسة».');
      go('#/');
    }
  });

  // الاسم يُطبَّق فورًا على العنوان والشريط الجانبي بعد حفظه (الحفظ نفسه في مستمع data-settingtext)
  document.addEventListener('change', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-settingtext');
    if (k !== 'school_name' && k !== 'school_name_en') return;
    if (S.settings) S.settings[k] = e.target.value.trim();
    if (S.brand) S.brand[k === 'school_name' ? 'name' : 'name_en'] = e.target.value.trim();
    applyBrand();
  });

  // المعالج يظهر للمدير العام مرة في كل جلسة إلى أن يُنهى الإعداد
  function setupPending() { return isAdmin() && !!S.settings && S.settings.setup_done === false; }

  function renderClaimAdmin() {
    app.innerHTML = '<div class="card auth" style="max-width:560px"><h2>مدرسة جديدة</h2>' +
      '<p>لم يُنشأ في هذه المدرسة حساب مدير عام بعد. إن كنت من يجهّز النظام لهذه المدرسة فاضغط الزر ليصبح حسابك حساب المدير العام، ثم يبدأ معالج الإعداد.</p>' +
      '<p class="hint">يكون ذلك لأول حساب فقط: بعده تُفعَّل الحسابات الأخرى من المدير العام.</p>' +
      '<button type="button" class="btn primary" data-act="claim-admin">أنا مدير النظام: اجعل حسابي المدير العام</button> ' +
      '<button type="button" class="btn" data-act="reload">تحديث</button></div>';
  }

  var SW_STEPS = ['هوية المدرسة', 'الإدارة والتواصل', 'الصفوف والشعب', 'الطلاب والعاملون', 'المستخدمون', 'إنهاء'];

  function swText(id, key, label, opts) {
    opts = opts || {};
    var s = S.settings || {};
    return '<label class="field" for="' + id + '" style="margin-top:12px">' + label + (opts.req ? ' <span class="req">*</span>' : '') + '</label>' +
      '<input type="text" id="' + id + '" data-settingtext="' + key + '"' + (opts.ltr ? ' dir="ltr" style="text-align:right"' : '') +
      (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') + ' value="' + esc(s[key] || '') + '">' + (opts.hint ? '<p class="hint" style="margin:4px 0 0">' + opts.hint + '</p>' : '');
  }

  function swDone(i) {
    var s = S.settings || {};
    if (i === 0) return !!s.school_name;
    if (i === 1) return !!s.principal_name;
    if (i === 2) return schoolClasses().length > 0;
    if (i === 3) return S.students.length > 0 && S.teachers.length > 0;
    if (i === 4) return S.users.filter(function (u) { return u.role !== 'pending' && u.id !== S.uid; }).length > 0;
    return !!s.setup_done;
  }

  function renderSetupWizard() {
    var st = Math.max(0, Math.min(SW_STEPS.length - 1, ui.swStep || 0)), s = S.settings || {}, body = '';
    var pills = '<div class="sw-steps">' + SW_STEPS.map(function (n, i) {
      return '<button type="button" class="sw-pill' + (i === st ? ' on' : '') + (swDone(i) ? ' done' : '') + '" data-swstep="' + i + '">' +
        '<span>' + (swDone(i) ? '✓' : i + 1) + '</span>' + n + '</button>';
    }).join('') + '</div>';
    if (st === 0) {
      body = '<p class="hint" style="margin:0">اسم المدرسة وشعارها يظهران في أعلى الموقع وفي ترويسة كل تقرير مطبوع.</p>' +
        swText('sw-name', 'school_name', 'اسم المدرسة بالعربية', { req: true, ph: 'مثل: مدرسة النور الخاصة' }) +
        swText('sw-name-en', 'school_name_en', 'اسم المدرسة بالإنجليزية', { ltr: true, ph: 'Al Noor School' }) +
        swText('sw-sub', 'report_subtitle', 'المرحلة أو القسم (سطر تحت الاسم في الترويسة)', { ph: 'مثل: المرحلة الابتدائية' }) +
        '<div class="grid2" style="margin-top:14px">' + brandImageField('logo_data') + brandImageField('banner_data') + '</div>';
    } else if (st === 1) {
      body = '<p class="hint" style="margin:0">تظهر في خانات التوقيع وتذييل التقارير والخطابات الرسمية.</p>' +
        swText('sw-principal', 'principal_name', 'اسم المدير/ة', { ph: 'أ. ...' }) +
        '<label class="field" for="sw-pg" style="margin-top:12px">الصفة في التقارير</label><select id="sw-pg" data-settingtext="principal_gender">' +
          [['', 'مدير/ة'], ['m', 'مدير (ذكر)'], ['f', 'مديرة (أنثى)']].map(function (o) { return '<option value="' + o[0] + '"' + ((s.principal_gender || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
        swText('sw-sup', 'supervisor_name', 'اسم المشرف/ة التربوي/ة') +
        swText('sw-year', 'academic_year', 'العام الدراسي', { ltr: true, ph: academicYear(), hint: 'اتركه فارغًا ليُحسب تلقائيًا (يبدأ في أغسطس).' }) +
        swText('sw-addr', 'school_address', 'العنوان') +
        swText('sw-phone', 'school_phone', 'الهاتف', { ltr: true }) +
        swText('sw-fb', 'school_facebook', 'صفحة فيسبوك', { ltr: true, ph: 'facebook.com/...' }) +
        swText('sw-contact', 'contact_info', 'سطر التواصل في تذييل التقارير', { ph: 'العنوان · الهاتف · البريد الإلكتروني' });
    } else if (st === 2) {
      var cls = schoolClasses();
      body = '<p>الصفوف والشعب أساس تسجيل الطلاب والحضور والجدول المدرسي.</p>' +
        '<p class="hint">الشعب الآن: ' + (cls.length ? cls.map(esc).join('، ') : 'لا توجد بعد') + '</p>' +
        '<a class="btn primary" href="#/rooms">إعداد الصفوف والشعب</a>';
    } else if (st === 3) {
      body = '<p>استورد كشوف المدرسة الحالية من Excel بدل إدخالها واحدًا واحدًا.</p>' +
        '<div class="stats" style="margin:10px 0"><div class="stat"><b>' + S.students.length + '</b><span>طالب</span></div><div class="stat"><b>' + S.teachers.length + '</b><span>من العاملين</span></div></div>' +
        '<div class="toolbar"><a class="btn primary" href="#/students">الطلاب: تسجيل أو استيراد Excel</a>' +
        '<a class="btn" href="registration-template.xlsx" download>تحميل نموذج Excel للطلاب</a>' +
        '<a class="btn primary" href="#/staff">العاملون: إضافة أو استيراد Excel / CSV</a></div>' +
        '<p class="hint">كشف العاملين: أعمدة بعناوين «الاسم، المسمى الوظيفي، الفئة، رقم الجوال، رقم الواتساب».</p>';
    } else if (st === 4) {
      var others = S.users.filter(function (u) { return u.id !== S.uid; });
      body = '<p>يُنشئ كل مستخدم حسابه من صفحة الدخول (أو تنشئ له حسابًا جاهزًا)، ثم تحدد صلاحيته: مدير، مشرف تربوي، مسجّل، معلم...</p>' +
        '<p class="hint">الحسابات الأخرى الآن: ' + others.length + (others.filter(function (u) { return u.role === 'pending'; }).length ? '، منها ' + others.filter(function (u) { return u.role === 'pending'; }).length + ' بانتظار التفعيل' : '') + '.</p>' +
        '<a class="btn primary" href="#/admin">المستخدمون والصلاحيات</a>';
    } else {
      var miss = SW_STEPS.slice(0, -1).map(function (n, i) { return swDone(i) ? '' : '<li>' + n + '</li>'; }).join('');
      body = (miss ? '<p>خطوات لم تكتمل بعد (يمكن إكمالها لاحقًا):</p><ul>' + miss + '</ul>' : '<p>اكتملت كل الخطوات.</p>') +
        '<p class="hint">بعد الإنهاء لا يظهر المعالج تلقائيًا، وكل البيانات تُعدَّل من «الإعدادات والمستخدمون ← بيانات المدرسة»، والمعالج نفسه يُفتح من هناك.</p>' +
        '<button type="button" class="btn primary" data-swfinish' + (s.setup_done ? ' disabled' : '') + '>' + (s.setup_done ? 'الإعداد منتهٍ' : 'إنهاء الإعداد') + '</button>';
    }
    app.innerHTML = '<div class="card sw"><h2>إعداد المدرسة</h2>' + pills + '<h3 style="margin:16px 0 6px">' + (st + 1) + '. ' + SW_STEPS[st] + '</h3>' + body +
      '<div class="actions" style="margin-top:18px">' + (st > 0 ? '<button type="button" class="btn" data-swstep="' + (st - 1) + '">السابق</button>' : '') +
      (st < SW_STEPS.length - 1 ? '<button type="button" class="btn primary" data-swstep="' + (st + 1) + '">التالي</button>' : '') + '</div></div>';
  }
