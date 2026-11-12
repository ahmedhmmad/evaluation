'use strict';
  /* ---------- البدء ---------- */

  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
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
