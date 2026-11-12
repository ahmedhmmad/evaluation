'use strict';
  /* ---------- البدء ---------- */

  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) {
    // طلبات القاعدة تحمل الصلاحية الإضافية التي يعمل بها الحساب الآن (إن وُجدت)؛ القاعدة تقبلها فقط إن كان مدير النظام منحها له
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { global: { fetch: function (input, init) {
      if (ACT_ROLE && String(typeof input === 'string' ? input : (input && input.url) || '').indexOf('/rest/v1/') > -1) {
        init = Object.assign({}, init);
        var h = new Headers(init.headers || {});
        h.set('x-act-role', ACT_ROLE);
        init.headers = h;
      }
      return fetch(input, init);
    } } });
    sb.auth.onAuthStateChange(function (event, session) {
      // لا تُستدعى دوال Supabase مباشرة داخل هذا المستمع
      setTimeout(function () {
        var uid = session && session.user ? session.user.id : null;
        if (uid && uid === S.uid) return; // تجديد الجلسة فقط
        S.uid = uid;
        S.email = uid ? session.user.email : '';
        S.profile = null;
        if (uid) loadAll(); else { S.ready = false; render(); }
      }, 0);
    });
  }
  render();
