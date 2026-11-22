'use strict';
  /* ---------- البدء ---------- */

  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) {
    // طلبات القاعدة تحمل مفتاح الشاشة الممنوحة التي يعمل فيها الموظف الآن (إن وُجدت)؛ القاعدة تقبله فقط إن كان مدير النظام منحها له
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { global: { fetch: function (input, init) {
      if (ACT_AREA && String(typeof input === 'string' ? input : (input && input.url) || '').indexOf('/rest/v1/') > -1) {
        init = Object.assign({}, init);
        var h = new Headers(init.headers || {});
        h.set('x-act-area', ACT_AREA);
        init.headers = h;
      }
      return fetch(input, init);
    } } });
    sb.auth.onAuthStateChange(function (event, session) {
      // لا تُستدعى دوال Supabase مباشرة داخل هذا المستمع
      setTimeout(function () {
        var uid = session && session.user ? session.user.id : null;
        if (uid && uid === S.uid) return; // تجديد الجلسة فقط
        // حساب آخر: لا يرى ما حُمّل لصاحب الحساب السابق
        TG.loaded = false; TG.missing = false; TG.classes = []; TG.students = []; TG.items = null; TG.cfgEdit = null;
        ui.tg = null; ui.pp = null; ui.thomeSeen = false; S.papers = null; S.ppMe = null; S.paperFiles = null; taReset(); TD_P = { uid: null, at: 0, list: null, failed: false };
        S.uid = uid;
        S.email = uid ? session.user.email : '';
        S.profile = null;
        if (uid) loadAll(); else { S.ready = false; render(); }
      }, 0);
    });
  }
  render();
