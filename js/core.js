'use strict';

  // البنود مأخوذة من «نموذج تقييم معلم»
  var CRITERIA = [
    'المهارة في إعداد وتحضير وتنفيذ خطط الدروس الصفية',
    'يضع أهدافًا تعليمية محددة وقابلة للقياس',
    'يضع أنشطة متنوعة لتحديد الاحتياجات التعليمية لمختلف التلاميذ',
    'يراعي ما لدى الطلاب من معارف وخبرات سابقة في تخطيط الدروس',
    'يصمم أساليب مختلفة ومناسبة لتقويم أداء التلاميذ',
    'يدير وقت التدريس داخل الصف إدارة فعالة',
    'التمكن من المادة العلمية والقدرة على تحقيق الأهداف',
    'يظهر عمليًا امتلاكه لمهارات الإدارة الصفية',
    'يؤكد على ضمان مشاركة الطلاب في أنشطة التعلم بغض النظر عما بينهم من فروق من حيث النوع ومستوى التحصيل الدراسي والاحتياجات الخاصة وغير ذلك',
    'يشارك الطلاب في تصميم بيئة التعلم ويشجعهم على ذلك',
    'يستخدم الموارد التعليمية المختلفة استخدامًا فعالًا في شرح المفاهيم والمهارات المتعلقة بالمستوى التعليمي',
    'يوظف معطيات تكنولوجيا التعليم في زيادة فرص الاكتشاف ومعالجة المعلومات والتعلم بالممارسة',
    'يستخدم أسئلة كاشفة (عميقة) وأسئلة مفتوحة (غير محددة الإجابة) إلى الطلاب لتشجيعهم على التفكير',
    'يستخدم استراتيجيات تدريس متنوعة لزيادة المشاركة الطلابية النشطة في التعلم',
    'يؤكد في تدريسه على تنمية المهارات الاجتماعية ومهارات العمل التعاوني لدى الطلاب',
    'يتيح للطلاب فرصًا للربط بين محتوى المادة التعليمية والمجالات التطبيقية لها',
    'يتيح للطلاب فرصًا لربط مجالات المحتوى التعليمي بخبرات الحياة اليومية وتطبيق ما تعلموه واكتسبوه من أفكار ومهارات في التعامل مع المواقف والمشكلات اليومية',
    'يتيح للطلاب فرصًا لممارسة كل من مهارات التفكير العليا والتفكير الناقد',
    'يقدم قدرًا مناسبًا من التعزيز اللفظي البناء والدقيق ويساعد الطلاب على ذلك',
    'يتيح للطلاب فرصًا معدة سلفًا للتأمل في عملية تعلمهم بهدف تقييم وتعديل المسار',
    'يستخدم أساليب متنوعة ومناسبة لتقويم أداء التلاميذ',
    'تقبل التوجيهات بشكل إيجابي والالتزام بها'
  ];

  var SCALE = [
    { v: 5, label: 'ممتاز' },
    { v: 4, label: 'جيد جدًا' },
    { v: 3, label: 'جيد' },
    { v: 2, label: 'مقبول' },
    { v: 1, label: 'ضعيف' }
  ];
  var MAX = CRITERIA.length * 5;

  var STATUS = {
    new: 'لم يبدأ',
    edit: 'قيد التحرير',
    review: 'بانتظار الاعتماد',
    approved: 'معتمد',
    published: 'منشور'
  };

  var STEPS = [
    { title: 'التحرير', desc: 'إدخال الدرجات والملاحظات' },
    { title: 'الاعتماد', desc: 'مراجعة التقييم واعتماده' },
    { title: 'النشر', desc: 'نشر التقييم النهائي' }
  ];

  var ROLES = {
    pending: 'بانتظار التفعيل',
    viewer: 'مشاهد',
    teacher: 'معلم',
    registrar: 'مسجِّل طلاب',
    attclerk: 'مسجِّل حضور (تطبيق الموبايل فقط)',
    supervisor: 'مشرف تربوي',
    manager: 'مدير (مشاهدة فقط)',
    // ليس دورًا في القاعدة: دور المدير مع role_title (supabase/general_supervisor.sql)، فصلاحياته صلاحيات المدير
    gensup: 'مشرف عام (مثل المدير)',
    // ليس دورًا في القاعدة: دور المدير مع read_only (supabase/outside_accounts.sql)، فيرى ما يراه المدير ولا يكتب شيئًا
    observer: 'جهة مشرفة (مشاهدة وتصدير فقط)',
    superadmin: 'مدير النظام'
  };

  // الصلاحية كما تُعرض وتُختار: «جهة مشرفة» لحساب المدير المقيَّد بالمشاهدة
  function roleKey(p) { return p && p.role === 'manager' && p.read_only ? 'observer' : p && p.role === 'manager' && p.role_title === 'general_supervisor' ? 'gensup' : p ? p.role : 'pending'; }
  // عمود role_title موجود؟ (قبل تشغيل supabase/general_supervisor.sql لا يوجد)
  function titleColumn() { return !!S.profile && 'role_title' in S.profile; }
  // عمود read_only موجود؟ (قبل تشغيل supabase/outside_accounts.sql لا يوجد)
  function roColumn() { return !!S.profile && 'read_only' in S.profile; }
  // ما يُكتب في profiles لاختيار صلاحية
  function rolePatch(k) {
    var p = { role: k === 'observer' || k === 'gensup' ? 'manager' : k };
    if (roColumn()) p.read_only = k === 'observer';
    if (titleColumn()) p.role_title = k === 'gensup' ? 'general_supervisor' : '';
    return p;
  }

  // ما يراه المشاهدون (يتحكم به مدير النظام)
  var VISIBILITY = [
    { key: 'show_totals', label: 'المجموع والنسبة والتقدير' },
    { key: 'show_items', label: 'درجات البنود التفصيلية' },
    { key: 'show_notes', label: 'ملاحظات المشرف' },
    { key: 'show_approver_notes', label: 'ملاحظات الاعتماد' }
  ];

  // تقرير الزيارة الإشرافية: المجالات السبعة وعبارات مقترحة لكل حقل
  var DOMAINS = [
    { title: 'التخطيط والإعداد', bank: [
      'يعدّ خطة درس مكتملة العناصر ومتسلسلة',
      'يصوغ أهدافًا تعليمية واضحة وقابلة للقياس',
      'يربط أهداف الدرس بنتاجات المنهاج',
      'يخطط لأنشطة تراعي الفروق الفردية بين الطلبة',
      'يجهّز الوسائل وأوراق العمل قبل الحصة',
      'يوزّع زمن الحصة على فعالياتها بشكل مناسب'
    ] },
    { title: 'التمهيد والتهيئة', bank: [
      'يبدأ الحصة بتمهيد مشوّق يثير دافعية الطلبة',
      'يربط الدرس الجديد بالتعلم السابق',
      'يستخدم سؤالًا أو موقفًا حياتيًا لإثارة التفكير',
      'يعرض أهداف الدرس على الطلبة بوضوح',
      'يراجع المتطلبات السابقة للدرس',
      'يهيّئ البيئة الصفية قبل البدء بالدرس'
    ] },
    { title: 'استراتيجيات التدريس', bank: [
      'ينوّع في استراتيجيات التدريس بما يناسب أهداف الدرس',
      'يوظف التعلم النشط والعمل في مجموعات',
      'يطرح أسئلة تنمّي مهارات التفكير العليا',
      'يفعّل دور الطالب بوصفه محور العملية التعليمية',
      'يراعي الفروق الفردية وأنماط التعلم',
      'يربط المحتوى بحياة الطلبة وخبراتهم',
      'يتمكن من المادة العلمية ويعرضها بتسلسل منطقي'
    ] },
    { title: 'الوسائل والتقنيات', bank: [
      'يوظف الوسائل التعليمية المناسبة لأهداف الدرس',
      'يستخدم التقنيات الحديثة والعروض التفاعلية بفاعلية',
      'يستثمر السبورة بشكل منظم وواضح',
      'ينتج وسائل تعليمية من خامات البيئة',
      'يشرك الطلبة في استخدام الوسائل والتقنيات',
      'يوظف مصادر تعلم متنوعة غير الكتاب المدرسي'
    ] },
    { title: 'الإدارة الصفية', bank: [
      'يدير وقت الحصة بفاعلية',
      'يضبط الصف بأسلوب تربوي هادئ',
      'يوفر بيئة صفية آمنة ومحفزة على التعلم',
      'يعزز السلوك الإيجابي لدى الطلبة',
      'يوزع المشاركة بعدالة بين الطلبة',
      'يبني علاقة احترام متبادل مع الطلبة',
      'يتحرك داخل الصف ويتابع الطلبة جميعهم'
    ] },
    { title: 'التقويم والتغذية الراجعة', bank: [
      'ينوّع في أساليب التقويم (قبلي، تكويني، ختامي)',
      'يتحقق من بلوغ أهداف الدرس في نهاية الحصة',
      'يقدم تغذية راجعة فورية وبنّاءة',
      'يوظف أدوات تقويم متنوعة (سلالم تقدير، قوائم رصد)',
      'يستخدم نتائج التقويم في تعديل مسار التدريس',
      'يشجع التقويم الذاتي وتقويم الأقران'
    ] },
    { title: 'متابعة أعمال الطلبة', bank: [
      'يتابع دفاتر الطلبة وكراساتهم بانتظام',
      'يصحح أعمال الطلبة ويدوّن عليها ملاحظات مفيدة',
      'يكلف الطلبة بواجبات بيتية هادفة ومتنوعة',
      'يتابع تنفيذ الواجبات ويقدم تغذية راجعة عنها',
      'يوثق تقدم الطلبة في سجلات منظمة',
      'يتابع الطلبة ذوي التحصيل المتدني بخطط علاجية',
      'يعرض أعمال الطلبة المتميزة ويحتفي بها'
    ] }
  ];

  var BANK = {
    development: [
      'تنويع استراتيجيات التدريس وتفعيل التعلم النشط',
      'صياغة الأهداف بصورة إجرائية قابلة للقياس',
      'تحسين إدارة وقت الحصة وتوزيعه على الفعاليات',
      'توظيف التقنيات والوسائل التعليمية بصورة أوسع',
      'طرح أسئلة تنمّي مهارات التفكير العليا',
      'مراعاة الفروق الفردية وتقديم أنشطة علاجية وإثرائية',
      'تنويع أساليب التقويم وأدواته',
      'تفعيل مشاركة جميع الطلبة وعدم الاقتصار على فئة محددة',
      'متابعة دفاتر الطلبة وتصحيحها بانتظام',
      'تفعيل الغلق والتقويم الختامي في نهاية الحصة',
      'تعزيز مهارات الإدارة الصفية وضبط الصف'
    ],
    recommendations: [
      'حضور ورشة تدريبية في استراتيجيات التعلم النشط',
      'تبادل الزيارات الصفية مع الزملاء ذوي الخبرة',
      'إعداد خطة علاجية للطلبة ذوي التحصيل المتدني',
      'إعداد أنشطة إثرائية للطلبة المتفوقين',
      'الاطلاع على دليل المعلم وتوظيف ما ورد فيه',
      'إعداد أوراق عمل وأدوات تقويم متنوعة',
      'توثيق أعمال الطلبة وتحديث السجلات بانتظام',
      'تنفيذ درس توضيحي ومناقشته مع المشرف',
      'زيارة متابعة للتحقق من تنفيذ التوصيات',
      'الاستمرار في الأداء المتميز ونقل الخبرة للزملاء'
    ]
  };

  // اليوم الدراسي ست حصص
  var PERIODS = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة'];
  var DEFAULT_PRINCIPAL = 'أ. سمر أبو مدين';

  var cfg = window.APP_CONFIG || {};
  // حسابات اسم المستخدم (بدون بريد حقيقي) تُخزَّن بهذا النطاق
  var USER_SUFFIX = '@' + (cfg.USERNAME_DOMAIN || 'ahmedhmmad.github.io');
  function displayName(email) {
    email = email || '';
    return email.slice(-USER_SUFFIX.length) === USER_SUFFIX ? email.slice(0, -USER_SUFFIX.length) : email;
  }
  var app = document.getElementById('app');
  var userbar = document.getElementById('userbar');
  var toastEl = document.getElementById('toast');
  var sb = null;

  var S = { uid: null, email: '', profile: null, teachers: [], settings: null, users: [], results: null, ready: false,
            visits: [], statements: [], visitsMissing: false, defaultPw: '', accountsMissing: false,
            students: [], studentsMissing: false, regMissing: false, wantsMissing: false,
            tGroups: [], tMembers: [], tPay: {}, transportMissing: false, aliasMissing: false };
  var ui = { tsSearch: '', rcStaff: null, staffCat: '', staffImp: null, exemptFor: null, att: null, lateState: '', check: null, sibFix: null, scan: null, rcRefund: false, rcQuery: '', rcStudent: null, rcMethod: '', sibSearch: '', tpClass: '', tpStatus: '', tpSearch: '', search: '', editTeacher: null, editStudent: null, stSearch: '', stClass: '', imp: null, cl: null, clsSearch: '', stFlag: '', stStatus: '', editGroup: null, tMonth: '', tSearch: '', error: '', authMode: 'login', authMsg: '', authErr: '', busy: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var toastTimer;
  function toast(text, isErr) {
    toastEl.textContent = text;
    toastEl.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = ''; }, isErr ? 6000 : 2500);
  }

  function fail(error) {
    toast('تعذر تنفيذ العملية: ' + (error && error.message ? error.message : 'خطأ غير معروف'), true);
  }

  /* صلاحيات الموظفين (supabase/staff_perms.sql): مدير النظام يمنح حسابًا شاشات بعينها من شاشاته (المواصلات، العهد، شئون الطلاب...).
     تظهر للموظف في قائمته تحت «مهام إضافية»، وحين يفتح إحداها يعمل فيها بصلاحية المدير في تلك الشاشة:
     S.baseProfile حسابه كما هو، و S.profile نسخة بصلاحية المدير ما دام داخل الشاشة الممنوحة، و ACT_AREA مفتاح الشاشة
     ويُرسل مع كل طلب إلى القاعدة، فتقبله القاعدة فقط إن كانت الشاشة ممنوحة له. عند الخروج منها يعود إلى صلاحيته */
  var ACT_AREA = '';
  // شاشات لا تُمنح: الرئيسية، الإعدادات والمستخدمون، سجل التعديلات، وما هو خاص بصاحب الحساب
  var PERM_SKIP = ['home', 'admin', 'audit', 'results', 'signatures', 'mine', 'papers', 'mystudents', 'thome'];
  // مسارات فرعية لا تبدأ بمسار الشاشة نفسها
  var PERM_ALIAS = { teachers: ['#/t/'], visits: ['#/v/'] };
  function permsColumn() { var b = S.baseProfile || S.profile; return !!b && 'perms' in b; }
  function withProfile(p, fn) { var keep = S.profile; S.profile = p; try { return fn(); } finally { S.profile = keep; } }
  function adminLike(p) {
    var q = Object.assign({}, p, { role: 'superadmin' });
    if ('read_only' in q) q.read_only = false;
    if ('role_title' in q) q.role_title = '';
    return q;
  }
  // كل شاشات مدير النظام التي يمكن منحها: [المسار، المفتاح، الاسم، المجموعة]
  function permScreens() {
    var out = [], b = S.baseProfile || S.profile;
    if (!b) return out;
    withProfile(adminLike(b), function () {
      navModelRole().forEach(function (g) { g.items.forEach(function (it) { if (PERM_SKIP.indexOf(it[1]) < 0) out.push([it[0], it[1], it[2], g.title || '']); }); });
    });
    return out;
  }
  function myPerms() { var b = S.baseProfile; return b && b.role !== 'superadmin' && b.role !== 'pending' ? b.perms || [] : []; }
  // الشاشة الممنوحة التي ينتمي إليها هذا المسار (فارغ: ليس من الشاشات الممنوحة)
  function permAreaFor(h) {
    var my = myPerms();
    if (!my.length) return '';
    h = h || '';
    var hit = permScreens().filter(function (s) {
      return my.indexOf(s[1]) > -1 && (h === s[0] || h.indexOf(s[0] + '/') === 0 || (PERM_ALIAS[s[1]] || []).some(function (p) { return h.indexOf(p) === 0; }));
    })[0];
    return hit ? hit[1] : '';
  }
  function applyPerms() {
    S.baseProfile = S.profile;
    ACT_AREA = permAreaFor(location.hash);
    if (ACT_AREA) S.profile = adminLike(S.baseProfile);
  }
  function role() { return S.profile ? S.profile.role : 'pending'; }
  function isAdmin() { return role() === 'superadmin'; }
  // مدير المدرسة: يرى كل الشاشات ولا يعدّل (القاعدة تمنحه القراءة فقط: supabase/manager.sql)
  function isManager() { return role() === 'manager'; }
  // جهة مشرفة أو حساب خارجي: يرى ويصدّر فقط، ولا يعدّل حتى ما يعدّله المدير (دوام الموظفين)
  function isReadOnly() { return isManager() && !!(S.profile && S.profile.read_only); }
  function canView() { return isAdmin() || isManager(); }
  function isStaff() { return role() === 'supervisor' || isAdmin() || isManager(); }
  // مسجِّل الطلاب: يسجّل الطلاب ويعدّل بياناتهم ويرى الشعب فقط؛ لا حذف ولا مدفوعات ولا تقييمات (supabase/registrar.sql)
  function isRegistrar() { return role() === 'registrar'; }
  // المواصلات: يراها المدير العام والمدير، والمسجِّل (الباصات وإصدار الإيصالات)
  function canTransport() { return canView() || isRegistrar(); }
  function canStudents() { return isAdmin() || isRegistrar() || isManager(); }
  // المشرف التربوي: يستعرض بيانات العاملين والطلاب حسب الشعب، ولا يعدّل فيهما شيئًا
  function isSup() { return role() === 'supervisor'; }
  function supViewPage() { return isSup() && (location.hash === '#/staff' || /^#\/classes/.test(location.hash)); }
  // شاشة الحضور والغياب: يراها ويصدّر كشوفها من يرى الطلاب والمشرف (supabase/attendance_supervisor.sql)؛ ويسجّل الحضور المدير العام والمسجِّل فقط
  function canAttView() { return canStudents() || role() === 'supervisor'; }
  function canRecordAtt() { return isAdmin() || isRegistrar(); }

  // «علوم عامة، رياضيات» → ['علوم عامة', 'رياضيات']
  function splitList(text) {
    return String(text || '').split(/[،,]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  // صفوف المدرسة وشعبها كما عرّفها مدير النظام
  function optionsHtml(list, current) {
    if (current && list.indexOf(current) < 0) list = list.concat([current]);
    return '<option value="">— اختر —</option>' + list.map(function (x) {
      return '<option' + (x === current ? ' selected' : '') + '>' + esc(x) + '</option>';
    }).join('');
  }

  function principalName() {
    return (S.settings && S.settings.principal_name) || DEFAULT_PRINCIPAL;
  }

  // اسم المستخدم بدون @ يُحوَّل إلى بريد داخلي
  function toEmail(login) {
    login = login.trim().toLowerCase();
    return login.indexOf('@') < 0 ? login + USER_SUFFIX : login;
  }

  function find(id) {
    for (var i = 0; i < S.teachers.length; i++) if (S.teachers[i].id === id) return S.teachers[i];
    return null;
  }

  function ratedCount(t) {
    var n = 0;
    for (var i = 0; i < CRITERIA.length; i++) if (t.ratings[i]) n++;
    return n;
  }

  function total(t) {
    var sum = 0;
    for (var i = 0; i < CRITERIA.length; i++) sum += t.ratings[i] || 0;
    return sum;
  }

  function grade(pct) {
    if (pct >= 90) return 'ممتاز';
    if (pct >= 80) return 'جيد جدًا';
    if (pct >= 70) return 'جيد';
    if (pct >= 60) return 'مقبول';
    return 'ضعيف';
  }

  function fmtDate(iso) {
    return iso ? new Date(iso).toLocaleDateString('ar-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  }

  function stepIndex(status) {
    if (status === 'review') return 1;
    if (status === 'approved' || status === 'published') return 2;
    return 0;
  }

  /* ---------- البيانات ---------- */

  async function loadAll() {
    S.ready = false;
    render();
    var p = await sb.from('profiles').select('*').eq('id', S.uid).maybeSingle();
    if (p.error) fail(p.error);
    S.profile = p.data || null;
    applyPerms();
    S.myStaff = null; S.mine = null;
    if (S.profile && S.profile.role !== 'pending') {
      var ms = await sb.rpc('my_staff_month', { p_month: null });
      S.myStaff = !ms.error && ms.data && ms.data.id ? ms.data : null;
    }
    S.teachers = []; S.users = []; S.settings = null; S.results = null;
    S.visits = []; S.statements = []; S.visitsMissing = false; S.defaultPw = ''; S.accountsMissing = false;
    S.students = []; S.studentsMissing = false; S.regMissing = false;
    S.tGroups = []; S.tMembers = []; S.tPay = {}; S.tTop = {}; S.transportMissing = false;
    S.ttSessions = []; S.ttConfig = null; S.ttMissing = false; S.dash = null; S.pLinks = null; S.subs = null; S.sa = null; S.botKey = null;

    if (isStaff()) {
      var res = await Promise.all([
        sb.from('teachers').select('*').order('name'),
        sb.from('settings').select('*').eq('id', 1).maybeSingle(),
        canView() ? sb.from('profiles').select('*').order('created_at') : Promise.resolve({ data: [] })
      ]);
      if (res[0].error) fail(res[0].error);
      S.teachers = res[0].data || [];
      S.settings = res[1].data || null;
      S.users = res[2].data || [];
      // حساب معلم فقد ربطه بسجله (teacher_id فارغ أو لسجل آخر) وسجله يشير إليه: يُعاد الربط، فيرى المعلم جدوله وتقييمه
      if (isAdmin()) {
        var relink = S.teachers.filter(function (t) {
          var u = t.user_id && S.users.filter(function (x) { return x.id === t.user_id; })[0];
          return u && u.role === 'teacher' && u.teacher_id !== t.id;
        });
        for (var ri = 0; ri < relink.length; ri++) {
          var rl = await sb.from('profiles').update({ teacher_id: relink[ri].id }).eq('id', relink[ri].user_id);
          if (!rl.error) S.users.forEach(function (x) { if (x.id === relink[ri].user_id) x.teacher_id = relink[ri].id; });
        }
        if (relink.length) toast('أُعيد ربط ' + relink.length + ' من حسابات المعلمين بسجلاتهم: ' + relink.map(function (t) { return t.name; }).join('، '));
      }
      S.prAccess = '';
      if (isManager()) {
        var pa = await sb.from('payroll_access').select('can_edit').eq('user_id', S.uid).maybeSingle();
        S.prAccess = pa.data ? (pa.data.can_edit ? 'edit' : 'view') : '';
      }
      S.pr = null; S.prAtt = null;

      // كل ما يلي مستقل بعضه عن بعض، فيُجلب معًا
      S.bk = null;
      var all = await Promise.all([
        // الجدولان غير موجودين إلى أن يُشغَّل الملف supabase/visits.sql
        Promise.all([
          sb.from('visits').select('*').order('visit_date', { ascending: false }),
          sb.from('statements').select('*').order('created_at')
        ]),
        canView() ? Promise.all([
          // غير موجود إلى أن يُشغَّل الملف supabase/teacher_accounts.sql
          isAdmin() ? sb.from('private_settings').select('*').eq('id', 1).maybeSingle() : Promise.resolve({ data: null, error: null }),
          isAdmin() ? loadBackupStatus() : null,
          // فئة العامل ومسماه الوظيفي وواتسابه: أعمدة من supabase/staff.sql
          colMissing('teachers', 'category'),
          // تاريخ انتهاء العقد: عمود من supabase/staff_attendance.sql
          colMissing('teachers', 'contract_end'),
          // «ليس من العاملين»: عمود من supabase/outside_accounts.sql
          colMissing('teachers', 'not_staff'),
          loadStudents(),
          loadTransport()
        ]) : role() === 'supervisor' ? loadStudents() /* للحضور والغياب (قراءة فقط) */ : null,
        loadTimetable()
      ]);
      var vis = all[0];
      if (canView()) {
        var ps = all[1][0];
        S.staffMissing = all[1][2];
        S.contractMissing = all[1][3];
        S.notStaffMissing = all[1][4];
        S.accountsMissing = !!ps.error;
        S.defaultPw = (ps.data && ps.data.default_password) || '';
      }
      S.visitsMissing = !!(vis[0].error || vis[1].error);
      S.visits = vis[0].data || [];
      S.statements = vis[1].data || [];
    } else if (isTeacherRole()) {
      await loadTimetable(); // «جدولي»
    } else if (isRegistrar()) {
      var reg = await Promise.all([sb.from('settings').select('*').eq('id', 1).maybeSingle(), loadStudents(), loadTransport()]);
      S.settings = reg[0].data || null;
    }
    S.ready = true;
    S.syncedAt = new Date();
    render();
  }

  /* مزامنة: تعيد جلب الطلاب والشعب والمواصلات ودفعات الشهر المعروض من القاعدة، ليُصدَّر ما فيها الآن
     لا ما كان عند فتح الصفحة (ما أضافه مسجِّل آخر مثلًا). تُستدعى من زر «مزامنة البيانات» وقبل كل تصدير Excel.
     إن تعذّر الجلب أو لم يكتمل تبقى البيانات السابقة كما هي وتعيد false. quiet: بلا رسائل نجاح */
  // يُزاد مع كل نشر: به يُعرف هل الصفحة المفتوحة هي الأحدث أم نسخة قديمة من ذاكرة المتصفح
  // رقم الإصدار APP_BUILD صار في index.html (به تُحمَّل ملفات js بنسخة واحدة)

  var syncing = null;
  function syncData(quiet) {
    if (!syncing) syncing = doSync(quiet).then(function (ok) { syncing = null; return ok; }, function () { syncing = null; return false; });
    return syncing;
  }

  async function doSync(quiet) {
    if (!S.ready) return false;
    if (!canStudents()) { await flush(); await loadAll(); return true; }
    // نموذج بقي مفتوحًا في صفحة غير المعروضة: لا يُرى ولا يُحفظ منه شيء، فيُغلق
    if (ui.editStudent != null && location.hash !== '#/students') ui.editStudent = null;
    if (ui.editTeacher != null && location.hash !== '#/staff') ui.editTeacher = null;
    if (!quiet && (ui.editStudent != null || ui.editTeacher != null)) {
      var who = ui.editStudent != null ? (ui.editStudent === 'new' ? 'تسجيل طالب جديد' : 'تعديل بيانات الطالب «' + ((findStudent(ui.editStudent) || {}).full_name || '') + '»')
        : (ui.editTeacher === 'new' ? 'إضافة عامل جديد' : 'تعديل بيانات «' + ((find(ui.editTeacher) || {}).name || '') + '»');
      toast('نموذج ' + who + ' مفتوح في هذه الصفحة: احفظه أو اضغط «إلغاء»، ثم زامن', true);
      return false;
    }
    var KEYS = ['sMembers', 'sPay', 'staffTMissing', 'sRefunds', 'staffRefundMissing', 'staffExemptMissing', 'settings', 'students', 'studentsMissing', 'regMissing', 'wantsMissing', 'tGroups', 'tMembers', 'tPay', 'tFirstPaid', 'tRefunds', 'tVoided',
      'tTop', 'topupMissing', 'ttSessions', 'ttConfig', 'ttMissing', 'ttProposals', 'ttPlanMissing', 'transportMissing', 'aliasMissing', 'archiveMissing', 'issuerMissing', 'busMissing', 'exemptMissing', 'dueMissing', 'refundMissing', 'leaveMissing'];
    var keep = {};
    KEYS.forEach(function (k) { keep[k] = S[k]; });
    if (!quiet) toast('جارٍ مزامنة البيانات…');
    document.body.classList.add('syncing');
    try {
      await flush();
      var cfg = await sb.from('settings').select('*').eq('id', 1).maybeSingle();
      if (cfg.error) throw new Error(cfg.error.message);
      S.settings = cfg.data || null;
      // عدد الصفوف في القاعدة يُقارن بما جُلب: الجلب على دفعات، فإن نقص شيء أُعيد مرة ثم يُعدّ فشلًا
      var complete = async function (table, load, size) {
        for (var attempt = 0; attempt < 2; attempt++) {
          await load();
          var c = await sb.from(table).select('*', { count: 'exact', head: true });
          if (c.error || typeof c.count !== 'number' || c.count === size()) return;
        }
        throw new Error('لم تكتمل بيانات الجدول ' + table);
      };
      await complete('students', loadStudents, function () { return S.students.length; });
      if (S.studentsMissing && !keep.studentsMissing) throw new Error('تعذر جلب الطلاب');
      await complete('transport_members', loadTransport, function () { return S.tMembers.length; });
      if (isStaff()) await loadTimetable();
      if (S.transportMissing && !keep.transportMissing) throw new Error('تعذر جلب المواصلات');
      if (ui.tMonth && !S.transportMissing) {
        var month = ui.tMonth;
        var rows = await fetchAll(function () { return sb.from('transport_payments').select('*').eq('month', month).order('student_id'); });
        if (!rows) throw new Error('تعذر جلب دفعات المواصلات');
        var map = {};
        rows.forEach(function (p) { p.amount = Number(p.amount) || 0; map[p.student_id] = p; });
        S.tPay[month] = map;
        await loadTopups(month);
      }
    } catch (err) {
      KEYS.forEach(function (k) { S[k] = keep[k]; });
      document.body.classList.remove('syncing');
      toast('تعذرت المزامنة، والبيانات المعروضة لم تتغير. تحقق من الاتصال ثم أعد المحاولة. (' + err.message + ')', true);
      return false;
    }
    document.body.classList.remove('syncing');
    S.syncedAt = new Date();
    S.attDay = {}; // سجلات الحضور تُجلب من جديد عند فتحها
    render();
    if (!quiet) toast('تمت المزامنة — الطلاب: ' + S.students.length + ' · المشتركون في المواصلات: ' + S.tMembers.length);
    return true;
  }

  // قاعدة البيانات تعيد ألف صف كحد أقصى في الطلب الواحد، فتُجلب الجداول الكبيرة على دفعات.
  // make: دالة تبني الاستعلام من جديد لكل دفعة. تعيد null عند الخطأ (الجدول غير موجود بعد)
  async function fetchAll(make) {
    var all = [], page = 1000;
    for (var from = 0; ; from += page) {
      var r = await make().range(from, from + page - 1);
      if (r.error) return null;
      all = all.concat(r.data || []);
      if (!r.data || r.data.length < page) return all;
    }
  }

  // الطلبات المستقلة تُرسل معًا لا واحدًا بعد الآخر، فيصير زمن التحميل زمن أبطأ طلب لا مجموعها.
  // فحص وجود عمود: طلب صف واحد منه؛ الخطأ يعني أن ملف SQL الذي يضيفه لم يُشغَّل بعد
  function colMissing(table, cols) { return sb.from(table).select(cols).limit(1).then(function (r) { return !!r.error; }); }

  async function loadStudents() {
    var res = await Promise.all([
      // الجدول غير موجود إلى أن يُشغَّل الملف supabase/students.sql
      fetchAll(function () { return sb.from('students').select('*').order('full_name').order('id'); }),
      // أعمدة التسجيل على مرحلتين غير موجودة إلى أن يُشغَّل الملف supabase/student_registration.sql
      colMissing('students', 'status, details'),
      // عمود «يحتاج مواصلات» أُضيف لاحقًا إلى الملف نفسه
      colMissing('students', 'wants_transport')
    ]);
    var all = res[0];
    S.studentsMissing = !all;
    S.students = all || [];
    S.regMissing = !!all && res[1];
    S.wantsMissing = !!all && res[2];
  }

  async function loadTransport() {
    var res = await Promise.all([
      // الجداول غير موجودة إلى أن يُشغَّل الملف supabase/transport.sql
      sb.from('transport_groups').select('*').order('assembly_point'),
      fetchAll(function () { return sb.from('transport_members').select('*').order('joined_at').order('student_id'); }),
      // عمود التسميات البديلة أُضيف لاحقًا إلى supabase/transport.sql
      colMissing('transport_groups', 'aliases'),
      // أرشيف الإيصالات المحذوفة: جدوله يأتي من supabase/receipt_archive.sql، ويُجلب عند فتح شاشته
      colMissing('transport_voided', 'id'),
      // أول شهر دفع عنه كل طالب: به يبدأ اشتراكه الفعلي. اختيار نقطة التجمع وحده لا يُنشئ مطالبة
      fetchAll(function () { return sb.from('transport_payments').select('student_id, month, amount, paid_on').order('month').order('student_id'); }),
      // من سجّل الدفعة ومتى: عمودان يأتيان من supabase/transport_issuer.sql
      colMissing('transport_payments', 'issued_by'),
      // سجل المستردات: جدوله يأتي من supabase/transport_refunds.sql
      fetchAll(function () { return sb.from('transport_refunds').select('*').order('created_at', { ascending: false }); }),
      // عمود إيقاف الاشتراك يأتي من supabase/transport_unsubscribe.sql
      colMissing('transport_members', 'left_from'),
      // بيانات الباص ونقطة الركوب والمهلة والتعليق: أعمدتها تأتي من supabase/transport_buses.sql
      colMissing('transport_members', 'pickup, grace_until, suspended_month'),
      // الإعفاء بالأشهر: أعمدته من supabase/reserve_and_exempt.sql
      colMissing('transport_members', 'exempt_from'),
      // المبلغ المطلوب وقت إصدار الإيصال: عمود من supabase/receipts_due.sql
      colMissing('transport_payments', 'due'),
      // رقم الباص والمنطقة وخط السير: أعمدة من supabase/transport_buses.sql
      colMissing('transport_groups', 'bus_no, area, route'),
      // مواصلات الموظفين: جداولها من supabase/transport_staff.sql
      loadStaffTransport()
    ]);
    var g = res[0], m = g.error ? null : res[1];
    S.transportMissing = !m;
    S.aliasMissing = !!m && res[2];
    S.tGroups = g.data || [];
    S.tMembers = m || [];
    S.tPay = {};
    S.archiveMissing = !!m && res[3];
    S.tFirstPaid = {};
    (m ? res[4] || [] : []).forEach(function (p) {
      var k = firstPaidKey(p);
      if (Number(p.amount) > 0 && (!S.tFirstPaid[p.student_id] || k < S.tFirstPaid[p.student_id])) S.tFirstPaid[p.student_id] = k;
    });
    S.issuerMissing = !!m && res[5];
    var refunds = m ? res[6] : null;
    S.refundMissing = !!m && !refunds;
    S.tRefunds = (refunds || []).sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); });
    S.leaveMissing = !!m && res[7];
    S.busMissing = !!m && res[8];
    S.exemptMissing = !!m && res[9];
    S.dueMissing = !!m && res[10];
    // التخفيض وسببه على الإيصال: عمودان من supabase/transport_discount.sql
    S.discountMissing = !!m && (await colMissing('transport_payments', 'discount, discount_reason'));
    S.routeMissing = !!m && res[11];
    S.tVoided = null;
  }

  /* إيصالات الدفعات المكمِّلة: من دفع جزءًا ثم أكمل يصدر له عن الإكمال إيصال جديد برقمه ومبلغه ووسيلته،
     ويبقى إيصاله الأول كما صدر. مجموع الشهر يبقى في transport_payments.amount (supabase/transport_topups.sql).
     S.tTop: { month: { studentId: [إيصالات مكمِّلة بترتيب الرقم] } } */
  S.tTop = {};
  S.topupMissing = false;
  async function loadTopups(month) {
    var rows = await fetchAll(function () { return sb.from('transport_topups').select('*').eq('month', month).order('receipt_no'); });
    S.topupMissing = !rows;
    var map = {};
    (rows || []).forEach(function (t) { t.amount = Number(t.amount) || 0; t.paid_before = Number(t.paid_before) || 0; (map[t.student_id] || (map[t.student_id] = [])).push(t); });
    S.tTop[month] = map;
  }
  function topupsOf(sid, month) { return (S.tTop[month || ui.tMonth] || {})[sid] || []; }
  // إيصالات الطالب عن الشهر: الأول بمبلغه وقت صدوره (قبل أي دفعة مكمِّلة)، ثم المكمِّلة
  function payReceipts(sid, month) {
    month = month || ui.tMonth;
    var rec = (S.tPay[month] || {})[sid], tops = topupsOf(sid, month);
    if (!rec || !(rec.amount > 0)) return [];
    return [{ kind: 'main', receipt_no: rec.receipt_no, amount: tops.length ? tops[0].paid_before : rec.amount, paid_before: 0,
      method: PAY_METHODS[rec.method] ? rec.method : 'cash', method_note: rec.method_note || '', paid_on: rec.paid_on, issued_by: rec.issued_by, issued_at: rec.issued_at, discount: Number(rec.discount) || 0, discount_reason: rec.discount_reason || '' }]
      .concat(tops.map(function (t) { return Object.assign({ kind: 'topup' }, t, { method: PAY_METHODS[t.method] ? t.method : 'cash' }); }));
  }
  // المحصَّل عن الشهر موزّعًا على الإيصالات (لتفصيل وسائل الدفع): المكمِّلة بمبالغها، والأول بالباقي من المجموع
  // (المجموع بعد أي استرداد). [{ method, ref, amount }]
  function payParts(sid, paid, month) {
    var recs = payReceipts(sid, month), top = 0, parts = [];
    recs.forEach(function (p) { if (p.kind === 'topup') { top += p.amount; parts.push({ method: p.method, ref: p.method === 'cash' ? '' : p.method_note, amount: p.amount }); } });
    if (recs.length) parts.unshift({ method: recs[0].method, ref: recs[0].method === 'cash' ? '' : recs[0].method_note, amount: Math.max(0, paid - top) });
    return parts.filter(function (p) { return p.amount > 0; });
  }

  // مدفوعات الشهر تُجلب عند أول عرض له ثم تُحفظ: { studentId: صف الدفعة }
  var loadingPay = {};
  async function loadPayments(month) {
    if (loadingPay[month]) return;
    loadingPay[month] = true;
    var rows = await fetchAll(function () { return sb.from('transport_payments').select('*').eq('month', month).order('student_id'); });
    loadingPay[month] = false;
    var map = {};
    (rows || []).forEach(function (p) { p.amount = Number(p.amount) || 0; map[p.student_id] = p; });
    await loadTopups(month);
    S.tPay[month] = map;
    render();
  }

  var loadingResults = false;
  async function loadResults() {
    if (loadingResults) return;
    loadingResults = true;
    var r = await sb.rpc('get_results');
    loadingResults = false;
    if (r.error) fail(r.error);
    S.results = (r.data && r.data.results) || [];
    if (!isStaff() && r.data && r.data.settings) S.settings = r.data.settings;
    render();
  }

  // الحفظ التلقائي أثناء التحرير
  var saveTimer = null, dirty = null;

  function setSaveState(text) {
    var el = document.getElementById('save-state');
    if (el) el.textContent = text;
  }

  async function saveNow(t) {
    var r = await sb.from('teachers').update({
      status: t.status,
      ratings: t.ratings,
      notes: t.notes,
      approver_notes: t.approver_notes,
      approved_at: t.approved_at,
      published_at: t.published_at
    }).eq('id', t.id);
    if (r.error) { setSaveState('لم يتم الحفظ'); fail(r.error); return false; }
    setSaveState('تم الحفظ');
    return true;
  }

  function queueSave(t) {
    clearTimeout(saveTimer);
    dirty = t;
    setSaveState('جارٍ الحفظ…');
    saveTimer = setTimeout(function () { saveTimer = null; saveNow(t); }, 600);
  }

  function flush() {
    var a = true, b = true;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; a = saveNow(dirty); }
    if (visitTimer) { clearTimeout(visitTimer); visitTimer = null; b = saveVisit(visitDirty); }
    return Promise.all([a, b]);
  }

  var visitTimer = null, visitDirty = null;

  async function saveVisit(v) {
    var r = await sb.from('visits').update(Object.assign({
      visit_date: v.visit_date,
      subject: v.subject,
      class_section: v.class_section,
      period: v.period,
      lesson_title: v.lesson_title,
      visit_number: v.visit_number,
      strengths: v.strengths,
      development: v.development,
      recommendations: v.recommendations,
      supervisor_name: v.supervisor_name,
      principal_name: v.principal_name
    }, v.approved_at ? { approved_by: '', approved_at: null } : {})).eq('id', v.id);
    if (r.error) { setSaveState('لم يتم الحفظ'); fail(r.error); return false; }
    if (v.approved_at) { v.approved_by = ''; v.approved_at = null; var ab = document.getElementById('visit-approval'); if (ab) ab.innerHTML = visitApprovalHtml(v); }
    setSaveState('تم الحفظ');
    return true;
  }

  function queueVisit(v) {
    clearTimeout(visitTimer);
    visitDirty = v;
    setSaveState('جارٍ الحفظ…');
    visitTimer = setTimeout(function () { visitTimer = null; saveVisit(v); }, 600);
  }

  /* ---------- الشريط العلوي والتبويبات ---------- */

  var shell = document.getElementById('shell');
  var sideNav = document.getElementById('side-nav');

  var ICONS = {
    // التوقيع الإلكتروني: خط توقيع وقلم
    signatures: 'M3 17c3-4 5-4 6 0s3 2 5-2M3 21h18M15 4l5 5-8 8H7v-5z',
    // دوامي وراتبي: ساعة
    papers: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
    mine: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
    home: 'M3 11l9-8 9 8M5 10v10h14V10',
    teachers: 'M12 3l2.7 5.6 6.3.9-4.5 4.3 1 6.2L12 17l-5.5 3 1-6.2L3 9.5l6.3-.9z',
    visits: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M8 11h8M8 15h8',
    results: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    staff: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
    students: 'M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5',
    transport: 'M5 4h14a1 1 0 011 1v11H4V5a1 1 0 011-1zM4 11h16M7 16v3M17 16v3M8 14h.01M16 14h.01',
    classes: 'M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z',
    admin: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4',
    rooms: 'M4 20V6l8-3 8 3v14M4 20h16M9 20v-5h6v5M8 9h2M14 9h2M8 12h2M14 12h2',
    attendance: 'M8 3v3M16 3v3M4 7h16v13H4zM8 14l3 3 5-6',
    reports: 'M5 3h10l4 4v14H5zM14 3v5h5M8 17v-3M12 17v-6M16 17v-4',
    timetable: 'M4 5h16v15H4zM4 10h16M9 5v15M14 5v15M8 3v4M16 3v4',
    // روابط أولياء الأمور: حلقتا سلسلة
    messages: 'M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z',
    parents: 'M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1.5 1.5M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1.5-1.5',
    // سجل التعديلات: ساعة بسهم رجوع
    audit: 'M3 12a9 9 0 103-6.7M3 4v4h4M12 7v5l3 2',
    // دوام الموظفين: بطاقة موظف مع ساعة
    staffatt: 'M4 6h16v13H4zM8 12a2 2 0 104 0 2 2 0 00-4 0M6.5 17a3.5 3.5 0 017 0M15 10h3M15 13h3M15 16h2',
    // الرواتب: ورقة نقدية
    payroll: 'M3 7h18v10H3zM7 7v10M17 7v10M12 10a2 2 0 100 4 2 2 0 000-4',
    // حساب الرواتب: آلة حاسبة
    payrun: 'M6 3h12v18H6zM9 6h6v3H9zM9 12h.01M12 12h.01M15 12h.01M9 15h.01M12 15h.01M15 15h.01M9 18h.01M12 18h3',
    // إدارة شئون الطلاب: بطاقة هوية الطالب
    affairs: 'M3 5h18v14H3zM9 11a2 2 0 100-4 2 2 0 000 4zM5.5 16a3.5 3.5 0 017 0M14 9h4M14 12h4M14 15h3',
    // سجل المخالفات: ورقة بعلامة تعجب
    discipline: 'M6 3h9l3 3v15H6zM15 3v3h3M12 9v5M12 17h.01',
    // إذن خروج الطلاب: باب وسهم خروج
    exits: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
    // اللجان المدرسية: مجموعة أشخاص
    committees: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M16 5.5a3 3 0 010 5.5M17.5 14a5.5 5.5 0 013.5 6',
    // العهد: صندوق
    custody: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8',
    // الطلبيات: قائمة بعلامات
    orders: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4',
    // المطالبات المالية: ورقة وعملة
    // طلابي: مجموعة أشخاص، والدرجات: ورقة بعلامة
    mystudents: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M16 5.5a3 3 0 010 5.5M17.5 14a5.5 5.5 0 013.5 6',
    grades: 'M6 3h12v18H6zM9 8h6M9 12h3M9 16l2 2 4-4',
    gradecfg: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4',
    claims: 'M5 3h10l4 4v14H5zM15 3v4h4M12 10v8M14.5 11.5c-.5-.9-1.5-1.2-2.5-1.2-1.4 0-2.3.7-2.3 1.7 0 2.4 5 1.3 5 3.8 0 1-1 1.7-2.5 1.7-1.2 0-2.2-.5-2.7-1.4'
  };

  // صفحات القائمة الجانبية بحسب الصلاحية، مقسّمة إلى مجموعات
  // قائمة الحساب: قائمة صلاحيته، ومعها الشاشات التي منحها له مدير النظام
  function navModel() {
    var b = S.baseProfile, my = myPerms();
    if (!my.length) return navModelRole();
    var groups = withProfile(b, navModelRole), have = {};
    groups.forEach(function (g) { g.items.forEach(function (it) { have[it[0]] = 1; }); });
    var extra = permScreens().filter(function (s) { return my.indexOf(s[1]) > -1 && !have[s[0]]; }).map(function (s) { return [s[0], s[1], s[2]]; });
    if (extra.length) groups.push({ title: 'مهام إضافية', items: extra });
    return groups;
  }
  function navModelRole() {
    var groups = navModel0();
    if (canView()) groups.forEach(function (g) { if (g.title === 'الإدارة') g.items.push(['#/custody', 'custody', 'العهد'], ['#/orders', 'orders', 'الطلبيات']); });
    if (canAttView()) groups.forEach(function (g) { if (g.title === 'الطلاب') g.items.unshift(['#/affairs', 'affairs', 'إدارة شئون الطلاب'], ['#/discipline', 'discipline', 'سجل المخالفات'], ['#/exits', 'exits', 'إذن خروج الطلاب']); });
    if (S.myStaff) groups.push({ title: 'حسابي', items: [['#/mine', 'mine', 'دوامي وراتبي'], ['#/papers', 'papers', 'أوراق العمل والاختبارات']] });
    else if (canPapers()) groups.forEach(function (g) { if (g.title === 'المعلمون') g.items.push(['#/papers', 'papers', 'أوراق العمل والاختبارات']); });
    if (isTeacherRole()) groups.push({ title: 'صفوفي', items: [['#/mystudents', 'mystudents', 'طلابي'], ['#/grades', 'grades', 'رصد الدرجات']] });
    else if (isAdmin() || isManager()) groups.forEach(function (g) { if (g.title === 'الطلاب') g.items.push(['#/grades', 'grades', 'الدرجات']); });
    if (isAdmin()) groups.forEach(function (g) { if (g.title === 'الإدارة') g.items.push(['#/gradecfg', 'gradecfg', 'إعداد الدرجات']); });
    if (isStaff() || isRegistrar() || S.myStaff) groups.push({ title: 'التوقيعات', items: [['#/signatures', 'signatures', 'التوقيع الإلكتروني']] });
    return navArrange(groups);
  }
  // إعادة الترتيب: الرئيسية، الموظفون، الطلاب، المواصلات، المالية، الإدارة، ثم الباقي
  function navArrange(groups) {
    var by = function (t) { return groups.filter(function (g) { return g.title === t; })[0]; };
    var take = function (g, href) { if (!g) return null; var i = g.items.map(function (x) { return x[0]; }).indexOf(href); return i < 0 ? null : g.items.splice(i, 1)[0]; };
    var emp = by('المعلمون'); if (emp) emp.title = 'الموظفون';
    var st = by('الطلاب'), adm = by('الإدارة'), pay = by('الرواتب');
    var tr = take(st, '#/transport');
    var trG = tr ? { title: 'المواصلات', items: [tr] } : null;
    var fin = pay || (canView() ? { title: 'المالية', items: [] } : null);
    if (fin) {
      fin.title = 'المالية';
      var od = take(adm, '#/orders'); if (od) fin.items.push(od);
      if (canView()) fin.items.push(['#/claims', 'claims', 'المطالبات المالية']);
    }
    var order = [emp, st, trG, fin, adm], out = [];
    groups.forEach(function (g) { if (!g.title) out.push(g); });
    order.forEach(function (g) { if (g && g.items.length) out.push(g); });
    groups.forEach(function (g) { if (g.title && order.indexOf(g) < 0 && g !== pay) out.push(g); });
    return out;
  }
  function navModel0() {
    if (isRegistrar()) return [{ title: 'الطلاب', items: [['#/students', 'students', 'تسجيل الطلاب'], ['#/classes', 'classes', 'الطلاب حسب الشعب'], ['#/attendance', 'attendance', 'الحضور والغياب'], ['#/reports', 'reports', 'التقارير'], ['#/transport', 'transport', 'المواصلات'], ['#/messages', 'messages', 'رسائل واتساب']] }];
    if (!isStaff()) return [{ items: (isTeacherRole() ? [['#/thome', 'home', 'الرئيسية']] : []).concat([['#/', 'results', 'نتائج التقييم']], isTeacherRole() ? [['#/timetable', 'timetable', 'جدولي']] : []) }];
    var groups = [
      { items: [['#/', 'home', 'الرئيسية']] },
      { title: 'المعلمون', items: [['#/teachers', 'teachers', 'تقييم المعلمين'], ['#/visits', 'visits', 'الزيارات الإشرافية'], ['#/results', 'results', 'النتائج المنشورة'], ['#/timetable', 'timetable', 'جدول الحصص']] }
    ];
    if (canCm()) groups[1].items.push(['#/committees', 'committees', 'اللجان المدرسية']);
    if (isSup()) {
      groups[1].items.push(['#/staff', 'staff', 'بيانات العاملين']);
      groups.push({ title: 'الطلاب', items: [['#/classes', 'classes', 'الطلاب حسب الشعب'], ['#/attendance', 'attendance', 'الحضور والغياب']] });
    }
    if (canView()) {
      groups[1].items.push(['#/staff', 'staff', 'بيانات العاملين'], ['#/staffatt', 'staffatt', 'دوام الموظفين']);
      groups.push(
        { title: 'الطلاب', items: [['#/students', 'students', 'تسجيل الطلاب'], ['#/classes', 'classes', 'الطلاب حسب الشعب'], ['#/attendance', 'attendance', 'الحضور والغياب'], ['#/reports', 'reports', 'التقارير'], ['#/transport', 'transport', 'المواصلات']].concat(isAdmin() ? [['#/parents', 'parents', 'روابط أولياء الأمور'], ['#/messages', 'messages', 'رسائل واتساب']] : []) },
        { title: 'الإدارة', items: [['#/rooms', 'rooms', 'إعداد الفصول'], ['#/admin', 'admin', 'الإعدادات والمستخدمون']].concat(isAdmin() ? [['#/audit', 'audit', 'سجل التعديلات']] : []) }
      );
    }
    if (prLevel()) groups.splice(canView() ? groups.length - 1 : groups.length, 0, { title: 'الرواتب', items: [['#/payroll', 'payroll', 'إعدادات الرواتب'], ['#/payrun', 'payrun', 'حساب الرواتب']] });
    return groups;
  }

  // الصفحة الحالية كما يدل عليها العنوان (صفحات التفاصيل تتبع قائمتها)
  function activeKey() {
    var h = location.hash;
    if (h === '#/mine' && S.myStaff) return 'mine';
    if (h === '#/papers' && canPapers()) return 'papers';
    if (h === '#/thome' && isTeacherRole()) return 'thome';
    if (h === '#/mystudents' && isTeacherRole()) return 'mystudents';
    if (h === '#/grades' && (isTeacherRole() || isAdmin() || isManager())) return 'grades';
    if (h === '#/gradecfg' && isAdmin()) return 'gradecfg';
    if (h === '#/signatures') return 'signatures';
    if (h === '#/messages' && canRecordAtt()) return 'messages';
    if (h === '#/exits' && canAttView()) return 'exits';
    if (h === '#/discipline' && canDisc()) return 'discipline';
    if (h === '#/custody' && canView()) return 'custody';
    if (h === '#/orders' && canView()) return 'orders';
    if (h === '#/claims' && canView()) return 'claims';
    if (/^#\/affairs/.test(h) && canAttView()) return 'affairs';
    if (isRegistrar()) return /^#\/transport/.test(h) ? 'transport' : /^#\/classes/.test(h) ? 'classes' : h === '#/attendance' ? 'attendance' : h === '#/reports' ? 'reports' : 'students';
    if (/^#\/timetable/.test(h) && (isStaff() || isTeacherRole())) return 'timetable';
    if (h === '#/attendance' && canAttView()) return 'attendance';
    if (/^#\/committees/.test(h) && canCm()) return 'committees';
    if (!isStaff()) return 'results';
    if (h === '#/staff' && isSup()) return 'staff';
    if (/^#\/classes/.test(h) && isSup()) return 'classes';
    if (h === '#/teachers' || /^#\/t\//.test(h)) return 'teachers';
    if (h === '#/visits' || /^#\/v\//.test(h)) return 'visits';
    if (h === '#/results' || /^#\/r\//.test(h)) return 'results';
    if (/^#\/transport/.test(h)) return 'transport';
    if (/^#\/classes/.test(h) && canView()) return 'classes';
    if (h === '#/audit' && isAdmin()) return 'audit';
    if (h === '#/parents' && isAdmin()) return 'parents';
    if (h === '#/staffatt' && canView()) return 'staffatt';
    if ((h === '#/payroll' || h === '#/payrun') && prLevel()) return h.slice(2);
    var m = h.match(/^#\/(staff|students|admin|rooms|attendance|reports)$/);
    return m && canView() ? m[1] : 'home';
  }

  function pageLabel(key) {
    var label = '';
    navModel().forEach(function (g) { g.items.forEach(function (it) { if (it[1] === key) label = it[2]; }); });
    return label;
  }

  function renderSide() {
    var signedIn = !!(S.uid && S.ready && role() !== 'pending' && !(S.profile && S.profile.must_change_password));
    shell.classList.toggle('bare', !signedIn);
    if (!signedIn) { sideNav.innerHTML = ''; userbar.innerHTML = ''; return; }
    var active = activeKey();
    sideNav.innerHTML = navModel().map(function (g) {
      return (g.title ? '<h3>' + g.title + '</h3>' : '') + g.items.map(function (it) {
        return '<a href="' + it[0] + '"' + (it[1] === active ? ' class="on" aria-current="page"' : '') + '>' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICONS[it[1]] + '"/></svg>' + it[2] + '</a>';
      }).join('');
    }).join('');
    document.getElementById('brand-name').textContent = schoolName();
    userbar.innerHTML =
      '<div class="who">' + esc((S.profile && S.profile.full_name) || displayName(S.email)) + '</div>' +
      '<div class="role">' + String(ROLES[roleKey(S.baseProfile || S.profile)] || '').replace(/\s*\(.*\)$/, '') + '</div>' +
      '<button type="button" class="btn" data-act="sync" title="إعادة جلب البيانات من القاعدة">مزامنة البيانات</button>' +
      '<div class="role" title="رقم نسخة البرنامج المفتوحة في هذا المتصفح">نسخة البرنامج: ' + APP_BUILD + '</div>' +
      (S.syncedAt ? '<div class="role">آخر مزامنة: ' + S.syncedAt.toLocaleTimeString('ar-u-nu-latn', { hour: '2-digit', minute: '2-digit' }) + '</div>' : '') +
      '<button type="button" class="btn" data-act="signout">تسجيل الخروج</button>';
  }

  function closeMenu() {
    shell.classList.remove('open');
    document.getElementById('menu-btn').setAttribute('aria-expanded', 'false');
  }

  document.getElementById('menu-btn').addEventListener('click', function () {
    this.setAttribute('aria-expanded', String(shell.classList.toggle('open')));
  });
  document.getElementById('scrim').addEventListener('click', closeMenu);
  sideNav.addEventListener('click', function (e) { if (e.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

  // عنوان الصفحة أعلى المحتوى
  function tabs(active) {
    return '<div class="page-head no-print"><h1>' + pageLabel(active) + '</h1></div>';
  }

  /* ---------- الرئيسية ---------- */

  /* ---------- لوحة المؤشرات (الرئيسية) ----------
     للمدير العام والمدير: الغياب اليوم، وحصيلة المواصلات اليوم والشهر، والمتأخرون في الدفع، والطلاب الجدد، والشعب الممتلئة.
     المشرف يرى بطاقة الغياب وحدها. الأرقام تُجلب عند فتح الرئيسية، و«تحديث» يعيد جلبها */
  S.dash = null;
  var loadingDash = false;
  async function loadDash() {
    if (loadingDash) return;
    loadingDash = true;
    // «الشهر» في المواصلات هو الدورة الجارية (من بدايتها إلى اليوم)
    var today = todayISO(), month = canView() ? currentCycle(today) : today.slice(0, 7), d = { day: today, month: month, at: new Date() };
    var att = await fetchAll(function () { return sb.from('attendance').select('student_id, status, class_name').eq('day', today).order('student_id'); });
    if (S.stLeaves == null) await loadStLeaves();
    d.att = att ? attNormRows(att, today) : null;
    if (canView() && !S.transportMissing) {
      var got = await receiptsBetween(cycleOf(month).from, today);
      d.recs = got ? got.list : null;
      if (!S.tPay[month]) await loadPayments(month);
    }
    // رسائل واتساب التي فشل إرسالها اليوم (يقرؤها مدير النظام ومسجِّل الطلاب)
    d.waFailed = null;
    if (isAdmin()) {
      var wf = await sb.from('wa_messages').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', new Date(today + 'T00:00').toISOString());
      if (!wf.error) d.waFailed = wf.count || 0;
    }
    S.dash = d;
    loadingDash = false;
    render();
  }

  function dashHtml() {
    var d = S.dash;
    if (!d || d.day !== todayISO()) { loadDash(); return '<div class="card empty" style="padding:16px">جارٍ تجهيز مؤشرات اليوم…</div>'; }
    var stat = function (href, label, num, sub, color) {
      return '<a class="card stat" href="' + href + '"><span class="lbl">' + label + '</span><span class="num"' + (color ? ' style="color:' + color + '"' : '') + '>' + num + '</span><span class="sub">' + sub + '</span></a>';
    };
    var cards = '';

    // الغياب اليوم: المسجلون في الشعب، والغائبون منهم، والشعب التي لم يُسجَّل غيابها بعد
    if (d.att) {
      var cfgDays = (S.ttConfig && S.ttConfig.days) || [], off = cfgDays.length && cfgDays.indexOf(dayName(d.day)) < 0;
      var roll = S.students.filter(function (x) { return enrolled(x) && x.class_name; }), byCls = {}, done = {};
      roll.forEach(function (x) { byCls[x.class_name] = (byCls[x.class_name] || 0) + 1; });
      var absent = 0;
      d.att.forEach(function (r) { done[r.class_name] = 1; if (r.status === 'absent') absent++; });
      var leftNames = Object.keys(byCls).filter(function (c) { return !done[c]; }).sort(), left = leftNames.length, taken = d.att.length;
      cards += off && !taken
        ? stat('#/attendance', 'الغياب اليوم', '—', 'لا دراسة اليوم (' + dayName(d.day) + ')')
        : !taken
          ? stat('#/attendance', 'الغياب اليوم', '—', 'لم يُسجَّل الغياب اليوم بعد', 'var(--muted)')
          : stat('#/attendance', 'الغياب اليوم', absent + ' <small>(' + Math.round(absent * 100 / taken) + '%)</small>',
              'من ' + taken + ' طالبًا سُجّل حضورهم' + (left ? ' · شعب لم تُسجَّل: ' + left + ' (' + leftNames.slice(0, 5).map(esc).join('، ') + (left > 5 ? '…' : '') + ')' : ' · سُجّلت كل الشعب'), absent ? 'var(--red)' : '');
    }

    // المجازون والمفصولون مؤقتًا اليوم
    var onLeave = 0, onSusp = 0, seenLv = {};
    (S.stLeaves || []).forEach(function (l) {
      if (d.day < l.from_day || d.day > l.to_day || seenLv[l.student_id + l.kind] || !findStudent(l.student_id)) return;
      seenLv[l.student_id + l.kind] = 1;
      if (l.kind === 'suspension') onSusp++; else onLeave++;
    });
    if (onLeave || onSusp) cards += stat(onSusp && !onLeave ? '#/affairs/suspend' : '#/attendance', 'مجازون ومفصولون اليوم', onLeave + onSusp,
      'في إجازة: ' + onLeave + ' · مفصولون مؤقتًا: ' + onSusp, onSusp ? 'var(--red)' : '');
    if (d.waFailed != null) cards += stat('#/messages', 'رسائل واتساب فشلت اليوم', d.waFailed,
      d.waFailed ? 'افتح الأرشيف لإعادة إرسالها' : 'لا رسائل فاشلة اليوم', d.waFailed ? 'var(--red)' : '');

    if (canView()) {
      // حصيلة المواصلات بتاريخ السداد، كما في «سجل الدفعات»
      if (d.recs) {
        var sum = function (list) {
          var t = { all: 0, cash: 0, n: list.length };
          list.forEach(function (r) { t.all += r.amount; if (r.method === 'cash') t.cash += r.amount; });
          return t;
        };
        var td = sum(d.recs.filter(function (r) { return r.day === d.day; }));
        var split = function (t) { return t.n + ' إيصالًا · نقدًا ' + money(t.cash) + ' · تحويلات ' + money(t.all - t.cash); };
        cards += stat('#/transport/ledger', 'حصيلة المواصلات اليوم', money(td.all), split(td));
        // حصيلة الدورة: كل ما سُدّد عن الدورة (بإيصالاتها وإيصالات إكمالها) أيًّا كان يوم السداد، كما في تقرير الباصات وملخص الشعب
        if (S.tPay[d.month]) {
          var keepM = ui.tMonth;
          ui.tMonth = d.month;
          var mt = payTotals(payRows()), cnt = 0;
          Object.keys(mt.byCount).forEach(function (k) { cnt += mt.byCount[k]; });
          ui.tMonth = keepM;
          cards += stat('#/transport/payments', 'حصيلة ' + tLabel(d.month), money(mt.paid),
            cnt + ' إيصالًا · نقدًا ' + money(mt.by.cash) + ' · تحويلات ' + money(mt.paid - mt.by.cash));
        }
      }
      // المتأخرون عن سداد اشتراك هذا الشهر بعد المهلة
      if (!S.transportMissing && !S.busMissing && S.tPay[d.month]) {
        var keep = ui.tMonth;
        ui.tMonth = d.month;
        var due = dueRows();
        ui.tMonth = keep;
        var late = due.filter(function (r) { return r.state === 'late'; }), owed = 0, stopped = 0;
        due.forEach(function (r) { if (r.state === 'late') owed += r.left; if (r.state === 'suspended') stopped++; });
        cards += stat('#/transport/late', 'المتأخرون في دفع المواصلات', late.length,
          (late.length ? 'المتبقي عليهم ' + money(owed) : todayISO() <= payDeadline(d.month) ? 'المهلة حتى ' + dmy(payDeadline(d.month)) : 'لا متأخرين') + (stopped ? ' · موقوفون: ' + stopped : ''),
          late.length ? 'var(--red)' : '');
      }
      // الطلاب الجدد: من سُجّلوا (بأي حالة) هذا الأسبوع وهذا الشهر
      var weekAgo = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
      var newM = S.students.filter(function (x) { return String(x.created_at || '').slice(0, 7) === d.month; });
      cards += stat('#/students', 'الطلاب الجدد', newM.length,
        'هذا الشهر · آخر 7 أيام: ' + newM.filter(function (x) { return String(x.created_at || '').slice(0, 10) >= weekAgo; }).length +
        ' · بانتظار الاعتماد: ' + S.students.filter(function (x) { return stStatus(x) === 'pending'; }).length);
      // الشعب الممتلئة والمتجاوزة لسعتها
      var counts = {};
      S.students.forEach(function (x) { if (enrolled(x) && x.class_name) counts[x.class_name] = (counts[x.class_name] || 0) + 1; });
      var full = [], over = [];
      schoolClasses().forEach(function (c) {
        var info = classInfo(c), cap = info ? info.capacity : null, n = counts[c] || 0;
        if (cap == null) return;
        if (n > cap) over.push(c); else if (n === cap) full.push(c);
      });
      var names = over.concat(full);
      cards += stat('#/classes', 'الشعب الممتلئة', names.length,
        names.length ? (over.length ? 'تجاوزت السعة: ' + over.length + ' · ' : '') + names.slice(0, 4).map(esc).join('، ') + (names.length > 4 ? '…' : '') : 'كل الشعب فيها أماكن متاحة',
        over.length ? 'var(--red)' : '');
    }

    return '<div class="toolbar" style="align-items:center;margin:0 0 8px"><h2 style="margin:0">مؤشرات اليوم</h2>' +
      '<span class="hint" style="margin:0">آخر تحديث ' + d.at.toLocaleTimeString('ar-u-nu-latn', { hour: '2-digit', minute: '2-digit' }) + '</span>' +
      '<button type="button" class="btn" data-dashrefresh data-ro-ok>تحديث</button></div>' +
      '<div class="stats">' + cards + '</div>';
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-dashrefresh]')) { S.dash = null; render(); }
  });

  function renderHome() {
    var count = function (list, test) { return list.filter(test).length; };
    var month = todayISO().slice(0, 7);
    var stat = function (href, label, num, sub) {
      return '<a class="card stat" href="' + href + '"><span class="lbl">' + label + '</span><span class="num">' + num + '</span><span class="sub">' + sub + '</span></a>';
    };
    var stats =
      stat('#/teachers', 'المعلمون', activeTeachers().length,
        'تقييمات منشورة: ' + count(activeTeachers(), function (t) { return t.status === 'published'; }) +
        ' · قيد العمل: ' + count(activeTeachers(), function (t) { return t.status === 'edit' || t.status === 'review' || t.status === 'approved'; })) +
      stat('#/visits', 'الزيارات الإشرافية', S.visits.length,
        'هذا الشهر: ' + count(S.visits, function (v) { return (v.visit_date || '').slice(0, 7) === month; }));
    if (isAdmin()) {
      stats +=
        stat('#/students', 'الطلاب', count(S.students, enrolled), 'المسجلون نهائيًا والاحتياط · منهم ' + count(S.students, function (x) { return stStatus(x) === 'reserve'; }) + ' احتياط') +
        stat('#/transport', 'المواصلات', S.tGroups.length, 'مجموعات · الطلاب المشتركون: ' + count(S.tMembers, function (m) { return findStudent(m.student_id); }));
    }

    // ما يحتاج متابعة
    var todo = [];
    var add = function (n, text, href) { if (n) todo.push('<a href="' + href + '"><span>' + text + '</span><span class="n">' + n + '</span></a>'); };
    add(count(evalTeachers(), function (t) { return t.status === 'review'; }), 'تقييمات بانتظار الاعتماد', '#/teachers');
    add(count(evalTeachers(), function (t) { return t.status === 'approved'; }), 'تقييمات معتمدة لم تُنشر', '#/teachers');
    add(count(evalTeachers(), function (t) { return t.status === 'new'; }), 'معلمون لم يبدأ تقييمهم', '#/teachers');
    if (isAdmin()) {
      if (!S.accountsMissing) add(count(S.teachers, function (t) { return !t.user_id; }), 'معلمون بدون حساب دخول', '#/staff');
      add(count(S.students, function (x) { return x.status !== 'final'; }), 'تسجيلات مبدئية بانتظار المراجعة والاعتماد', '#/students');
      var riding = transportGroupOf();
      add(count(S.students, function (x) { return x.wants_transport === true && !riding[x.id]; }), 'طلاب يحتاجون مواصلات بلا نقطة تجمع', '#/transport');
      add(count(S.users, function (u) { return u.role === 'pending'; }), 'حسابات بانتظار التفعيل', '#/admin');
      // النسخ التلقائي متوقف: لم تصل نسخة منذ يومين أو أكثر
      if (S.bk && !S.bk.missing && S.bk.last_at && Date.now() - new Date(S.bk.last_at).getTime() >= 2 * 864e5) {
        todo.push('<a href="#/admin"><span>لم تصل نسخة احتياطية تلقائية منذ ' + Math.floor((Date.now() - new Date(S.bk.last_at).getTime()) / 864e5) + ' أيام</span><span class="n">!</span></a>');
      }
      if (!schoolClasses().length) todo.push('<a href="#/rooms"><span>لم تُعرَّف شعب المدرسة بعد</span><span class="n">!</span></a>');
    }

    app.innerHTML =
      '<div class="page-head"><div><h1>مرحبًا، ' + esc((S.profile && S.profile.full_name) || displayName(S.email)) + '</h1>' +
        '<p>' + new Date().toLocaleDateString('ar-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '</p></div></div>' +
      (canView() || role() === 'supervisor' ? dashHtml() : '') +
      '<div class="stats">' + stats + '</div>' +
      '<div class="card"><h2>إجراءات سريعة</h2><div class="quick" style="margin-top:10px">' +
        '<a class="btn primary" href="#/visits">+ تقرير زيارة إشرافية</a>' +
        '<a class="btn" href="#/teachers">تقييم معلم</a>' +
        (isAdmin() ? '<a class="btn" href="#/students">تسجيل طالب أو استيراد Excel</a><a class="btn" href="#/transport/receipt">إيصال مواصلات</a><a class="btn" href="#/transport/payments">مدفوعات المواصلات</a><a class="btn" href="#/staff">إضافة معلم</a>' : '') +
      '</div></div>' +
      '<div class="card"><h2>يحتاج متابعة</h2><div class="todo" style="margin-top:6px">' +
        (todo.join('') || '<div class="empty" style="padding:20px">لا توجد مهام معلّقة.</div>') + '</div></div>';
  }

  /* ---------- الدخول ---------- */

  function renderSetup() {
    // المكتبة لم تُحمَّل (انقطاع، أو شبكة تحجب مصدرها، أو متصفح قديم جدًا): رسالة تدل على السبب الحقيقي
    if (!window.supabase) {
      app.innerHTML = '<div class="card empty">تعذّر تحميل مكتبة الاتصال بقاعدة البيانات على هذا الجهاز.<br>' +
        'تحقق من الاتصال بالإنترنت ثم أعد تحميل الصفحة. إن تكرر ذلك فقد تكون شبكة المكان تحجب الموقعين ' +
        '<span dir="ltr">cdn.jsdelivr.net</span> و<span dir="ltr">unpkg.com</span>، أو يكون المتصفح قديمًا: جرّب شبكة أخرى (بيانات الجوال) أو حدّث المتصفح.</div>';
      return;
    }
    app.innerHTML = '<div class="card empty">لم يتم ربط قاعدة البيانات بعد.<br>أضف عنوان المشروع والمفتاح العام في الملف <code dir="ltr">config.js</code>.</div>';
  }

  function renderAuth() {
    var signup = ui.authMode === 'signup';
    app.innerHTML =
      '<form class="card auth" id="auth-form">' +
        '<h2>' + (signup ? 'إنشاء حساب' : 'تسجيل الدخول') + '</h2>' +
        (signup ? '<p class="hint">بعد إنشاء الحساب يقوم مدير النظام بتفعيله وتحديد صلاحيته.</p>' : '') +
        (signup ? '<div class="f"><label class="field" for="au-name">الاسم</label><input type="text" id="au-name" required autocomplete="name"></div>' : '') +
        '<div class="f"><label class="field" for="au-email">' + (signup ? 'البريد الإلكتروني' : 'البريد الإلكتروني أو اسم المستخدم') + '</label>' +
          '<input type="' + (signup ? 'email' : 'text') + '" id="au-email" dir="ltr" required autocomplete="' + (signup ? 'email' : 'username') + '"></div>' +
        '<div class="f"><label class="field" for="au-pass">كلمة المرور</label><input type="password" id="au-pass" dir="ltr" required' + (signup ? ' minlength="6"' : '') + ' autocomplete="' + (signup ? 'new-password' : 'current-password') + '"></div>' +
        (ui.authErr ? '<div class="msg" role="alert" style="margin:0 0 12px">' + esc(ui.authErr) + '</div>' : '') +
        (ui.authMsg ? '<div class="info">' + esc(ui.authMsg) + '</div>' : '') +
        '<button type="submit" class="btn primary"' + (ui.busy ? ' disabled' : '') + '>' + (signup ? 'إنشاء الحساب' : 'دخول') + '</button>' +
        '<div class="switch"><button type="button" class="btn link" data-act="auth-mode">' +
          (signup ? 'لديك حساب؟ سجّل الدخول' : 'ليس لديك حساب؟ أنشئ حسابًا') + '</button></div>' +
      '</form>';
  }

  function renderPending() {
    app.innerHTML = '<div class="card empty">حسابك بانتظار التفعيل من مدير النظام.<br>' +
      '<button type="button" class="btn" data-act="reload" style="margin-top:12px">تحديث</button></div>';
  }

  function renderChangePw() {
    app.innerHTML =
      '<form class="card auth" id="pw-form">' +
        '<h2>اختر كلمة مرور جديدة</h2>' +
        '<p class="hint">تم إنشاء حسابك بكلمة مرور افتراضية. اختر كلمة مرور خاصة بك للمتابعة.</p>' +
        '<div class="f"><label class="field" for="pw-new">كلمة المرور الجديدة</label><input type="password" id="pw-new" dir="ltr" required minlength="6" autocomplete="new-password"></div>' +
        '<div class="f"><label class="field" for="pw-again">تأكيد كلمة المرور</label><input type="password" id="pw-again" dir="ltr" required minlength="6" autocomplete="new-password"></div>' +
        (ui.authErr ? '<div class="msg" role="alert" style="margin:0 0 12px">' + esc(ui.authErr) + '</div>' : '') +
        '<button type="submit" class="btn primary">حفظ ومتابعة</button>' +
      '</form>';
  }

