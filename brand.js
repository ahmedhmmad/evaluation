/* هوية المدرسة في الصفحات المستقلة (ولي الأمر، مواعيد الدوام، تسجيل الغياب، السيرة الذاتية).
   يقرأ school_brand() من القاعدة (supabase/setup_wizard.sql). المدرسة الأصلية (legacy، أو قاعدة بلا الملف) تبقى كما هي؛
   ومدرسة جديدة: كل عنصر .logo يأخذ شعارها المرفوع (أو يختفي)، وكل عنصر [data-school-name] يأخذ اسمها.
   الصور تُحفظ في المتصفح بالمفتاح نفسه الذي يستعمله الموقع، فلا تُجلب إلا إن تغيّرت. */
(function () {
  var cfg = window.APP_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.fetch) return;
  var KEY = 'tpa-brand-images';
  function rpc(name) {
    return fetch(cfg.SUPABASE_URL + '/rest/v1/rpc/' + name, {
      method: 'POST', body: '{}',
      headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }
    }).then(function (r) { return r.ok ? r.json() : null; });
  }
  function apply(b, imgs) {
    var name = b.name || '';
    document.querySelectorAll('[data-school-name]').forEach(function (el) { if (name) el.textContent = name; });
    // قاعدة CSS لا تعديل للعناصر: تشمل الشعار الذي تُنشئه الصفحة لاحقًا (السيرة الذاتية)
    var st = document.createElement('style');
    st.textContent = imgs.logo ? '.logo{background:#fff url("' + imgs.logo + '") no-repeat center / 84% !important}' : '.logo{display:none !important}';
    document.head.appendChild(st);
    var icon = document.querySelector('link[rel="icon"]');
    if (icon && imgs.logo) icon.href = imgs.logo;
  }
  rpc('school_brand').then(function (b) {
    if (b && b.name) document.querySelectorAll('[data-school-name]').forEach(function (el) { el.textContent = b.name; });
    if (!b || b.legacy !== false) return;
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { cached = null; }
    if (cached && cached.ver === b.brand_ver) return apply(b, cached);
    if (!b.has_logo && !b.has_banner) return apply(b, { logo: '', banner: '' });
    return rpc('school_brand_images').then(function (im) {
      var imgs = { logo: (im && im.logo) || '', banner: (im && im.banner) || '', ver: (im && im.brand_ver) || '' };
      try { localStorage.setItem(KEY, JSON.stringify(imgs)); } catch (e) { /* لا بأس */ }
      apply(b, imgs);
    });
  }).catch(function () { /* بلا اتصال: تبقى الصفحة كما هي */ });
})();
