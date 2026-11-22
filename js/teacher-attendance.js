'use strict';
  /* ---------- تسجيل الحضور (للمعلم) ----------
     بدوال تطبيق الموبايل نفسها: api_att_classes و api_att_roll و api_att_submit (supabase/api.sql و student_suspensions.sql)، فالقواعد واحدة:
     اليوم الحالي فقط، والكل حاضر إلا من عُلّم غائبًا، والحفظ يكتب كشف الشعبة كله. المُجاز والمفصول اليوم يظهران ولا يُبدَّلان */
  var TA = taBlank();
  function taBlank() { return { day: '', classes: null, error: '', loading: false, cls: '', roll: null, mark: {}, dirty: false, recorded: false, saving: false, done: null, q: '' }; }
  function taReset() { TA = taBlank(); }

  function taError(e) {
    var m = String((e && e.message) || '');
    if (/PGRST202|42883/.test(String(e && e.code))) return 'تسجيل الحضور غير مجهّز في قاعدة البيانات: يشغّل المدير العام الملف supabase/api.sql ثم supabase/student_suspensions.sql.';
    if (/fetch|network/i.test(m)) return 'تعذّر الاتصال بالخادم. تحقق من الإنترنت وأعد المحاولة.';
    return m || 'تعذّر الاتصال بالخادم.';
  }

  async function taLoad() {
    var st = TA;
    st.loading = true;
    var r = await sb.rpc('api_att_classes');
    if (st !== TA) return;
    st.loading = false;
    if (r.error) st.error = taError(r.error);
    else { st.error = ''; st.day = r.data.day; st.classes = r.data.classes || []; }
    if (location.hash === '#/tatt') render();
  }

  async function taOpen(cls) {
    if (TA.saving) return;
    if (TA.dirty) {
      if (cls === TA.cls) return go('#/tatt');
      if (!confirm('كشف «' + TA.cls + '» لم يُحفظ. هل تريد تركه دون حفظ؟')) return go('#/tatt');
    }
    taReset();
    var st = TA;
    st.cls = cls || ''; st.loading = true;
    go('#/tatt');
    var res = await Promise.all([sb.rpc('api_att_classes'), cls ? sb.rpc('api_att_roll', { p_class: cls }) : Promise.resolve({ data: null })]);
    if (st !== TA) return;
    st.loading = false;
    var err = res[0].error || res[1].error;
    if (err) st.error = taError(err);
    else {
      st.day = res[0].data.day; st.classes = res[0].data.classes || [];
      if (res[1].data) {
        st.day = res[1].data.day; st.recorded = !!res[1].data.recorded; st.roll = res[1].data.students || [];
        st.roll.forEach(function (x) { if (x.absent) st.mark[x.id] = true; });
      }
    }
    if (location.hash === '#/tatt') render();
  }

  function taCount() { return TA.roll.filter(function (x) { return TA.mark[x.id] && x.leave == null; }).length; }
  function taSumText() {
    var n = taCount(), off = TA.roll.filter(function (x) { return x.leave != null; }).length;
    return 'الحاضرون <b>' + (TA.roll.length - n - off) + '</b> · الغائبون <b class="ta-n">' + n + '</b>' + (off ? ' · مجاز أو مفصول <b>' + off + '</b>' : '');
  }

  function taListHtml() {
    var tid = (S.profile && S.profile.teacher_id) || (S.myStaff && S.myStaff.id), own = {};
    ttLive().forEach(function (x) { if (x.teacher_id === tid) own[x.class_name] = 1; });
    var btn = function (c) {
      return '<button type="button" class="ta-cls" data-ro-ok data-taopen="' + esc(c.name) + '"><span><strong>' + esc(c.name) + '</strong><small>عدد الطلاب: ' + c.students + '</small></span>' +
        '<em class="' + (c.recorded ? 'ok' : '') + '">' + (c.recorded ? 'سُجّل اليوم' : 'لم يُسجَّل') + '</em></button>';
    };
    var mine = TA.classes.filter(function (c) { return own[c.name]; }), other = TA.classes.filter(function (c) { return !own[c.name]; });
    if (!TA.classes.length) return '<div class="card empty">لا شعب فيها طلاب مسجّلون.</div>';
    if (!mine.length) return '<div class="card"><h2 style="margin-top:0">اختر الشعبة</h2><div class="ta-list">' + other.map(btn).join('') + '</div></div>';
    return '<div class="card"><h2 style="margin-top:0">شعبي</h2><div class="ta-list">' + mine.map(btn).join('') + '</div>' +
      (other.length ? '<details class="ta-more"><summary>شعب أخرى (لحصص الاحتياط)</summary><div class="ta-list">' + other.map(btn).join('') + '</div></details>' : '') + '</div>';
  }

  function taRollHtml() {
    if (TA.done) {
      var a = TA.done.absent || [];
      return '<div class="card ta-done" role="status"><h2 style="margin-top:0">حُفظ حضور ' + esc(TA.cls) + '</h2><p>عدد الطلاب في الكشف: <b>' + TA.done.saved + '</b></p>' +
        (a.length ? '<p>الغائبون والمأذونون:</p><ul>' + a.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '<p>لا غياب.</p>') +
        '<div class="toolbar"><button type="button" class="btn primary" data-ro-ok data-taopen="">شعبة أخرى</button><button type="button" class="btn" data-ro-ok data-taopen="' + esc(TA.cls) + '">تعديل الكشف</button></div></div>';
    }
    if (!TA.roll.length) return '<div class="card empty">لا طلاب في هذه الشعبة.<br><button type="button" class="btn" data-ro-ok data-taopen="">كل الشعب</button></div>';
    var q = norm(TA.q);
    return '<div class="card"><div class="toolbar" style="align-items:center;margin:0 0 6px"><h2 style="margin:0;flex:1">' + esc(TA.cls) + '</h2><button type="button" class="btn" data-ro-ok data-taopen="">كل الشعب</button></div>' +
      (TA.recorded ? '<p class="ta-warn">سُجّل حضور هذه الشعبة اليوم. الحفظ من جديد يحلّ محل الكشف المحفوظ.</p>' : '') +
      '<p class="hint">الكل حاضر. اضغط على اسم الغائب فقط، ثم احفظ، حتى لو لم يغب أحد.</p>' +
      (TA.roll.length > 12 ? '<input type="search" id="ta-q" data-ro-ok placeholder="ابحث بالاسم" aria-label="بحث في الكشف" value="' + esc(TA.q) + '">' : '') +
      '<div class="ta-roll">' + TA.roll.map(function (x, i) {
        var lock = x.leave != null, on = !!TA.mark[x.id];
        return '<button type="button" class="ta-st' + (lock ? ' lock' : on ? ' abs' : '') + '" data-ro-ok data-tast="' + esc(x.id) + '" aria-pressed="' + (on || lock) + '"' + (lock || TA.saving ? ' disabled' : '') + (q && norm(x.name).indexOf(q) < 0 ? ' hidden' : '') + '>' +
          '<i>' + (i + 1) + '</i><span><strong>' + esc(x.name) + '</strong>' + (lock ? '<small>' + esc(x.leave || 'إجازة') + '</small>' : '') + '</span>' +
          '<em>' + (lock ? (/^فصل مؤقت/.test(x.leave) ? 'مفصول' : 'مأذون') : on ? 'غائب' : 'حاضر') + '</em></button>';
      }).join('') + '</div>' +
      '<div class="ta-foot"><p id="ta-sum" aria-live="polite">' + taSumText() + '</p><button type="button" class="btn primary" data-ro-ok data-tasave' + (TA.saving ? ' disabled' : '') + '>' + (TA.saving ? 'جارٍ الحفظ…' : 'حفظ الحضور') + '</button></div></div>';
  }

  function renderTeacherAtt() {
    var head = '<div class="page-head"><div><h1>تسجيل الحضور</h1><p>' + (TA.day ? esc(dayName(TA.day)) + ' ' + dmy(TA.day) : 'حضور طلاب اليوم') + '</p></div></div>';
    if (TA.error) { app.innerHTML = head + '<div class="card empty" role="alert">' + esc(TA.error) + '<br><button type="button" class="btn" data-ro-ok data-taopen="' + esc(TA.cls) + '">إعادة المحاولة</button></div>'; return; }
    if (TA.cls && TA.roll) { app.innerHTML = head + taRollHtml(); return; }
    if (!TA.cls && TA.classes) { app.innerHTML = head + taListHtml(); return; }
    app.innerHTML = head + '<div class="card empty">جارٍ التحميل…</div>';
    if (!TA.loading) taLoad();
  }

  async function taSave() {
    var st = TA;
    if (st.saving || !st.roll) return;
    st.saving = true; render();
    var stop = function (msg) {
      if (st !== TA) return;
      st.saving = false;
      if (location.hash === '#/tatt') render();
      if (msg) toast(msg, true);
    };
    // الخادم يكتب في يومه الحالي، وقد يكون غيره سجّل الشعبة منذ فُتح الكشف: يُفحص الاثنان قبل الكتابة
    var c = await sb.rpc('api_att_classes');
    if (st !== TA) return;
    if (c.error) return stop(taError(c.error) + ' لم يُحفظ شيء.');
    if (c.data.day !== st.day) return stop('تغيّر اليوم منذ فتحت الكشف، فلم يُحفظ. اضغط «كل الشعب» وافتح الشعبة من جديد.');
    var info = (c.data.classes || []).filter(function (x) { return x.name === st.cls; })[0] || {};
    var ask = 'حفظ حضور «' + st.cls + '»: ' + (taCount() ? 'الغائبون ' + taCount() : 'لا غياب') + '؟';
    if (ttCfg().days.indexOf(dayName(st.day)) < 0) ask = 'تنبيه: ' + dayName(st.day) + ' ليس يوم دوام.\n\n' + ask;
    if (info.recorded) ask = (st.recorded ? 'الشعبة مسجّلة اليوم، وسيحلّ هذا الكشف محل المحفوظ.' : 'تنبيه: سُجّل حضور الشعبة من جهة أخرى بعد أن فتحت الكشف، وسيحلّ كشفك محله.') + '\n\n' + ask;
    if (!confirm(ask)) return stop();
    // المجاز والمفصول يُرسلان مع الغائبين كما في التطبيق، والخادم يحفظهما «مأذون»
    var ids = st.roll.filter(function (x) { return st.mark[x.id] || x.leave != null; }).map(function (x) { return x.id; });
    var r = await sb.rpc('api_att_submit', { p_class: st.cls, p_absent: ids });
    if (st !== TA) return;
    if (r.error) return stop('لم يتأكد الحفظ: ' + taError(r.error) + ' أعد الضغط على «حفظ الحضور».');
    st.saving = false; st.dirty = false; st.done = r.data;
    if (location.hash === '#/tatt') { render(); window.scrollTo(0, 0); }
    toast('حُفظ الحضور');
  }

  app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-taopen], [data-tast], [data-tasave]');
    if (!el) return;
    if (el.hasAttribute('data-taopen')) return taOpen(el.getAttribute('data-taopen'));
    if (el.hasAttribute('data-tasave')) return taSave();
    if (TA.saving) return;
    var id = el.getAttribute('data-tast'), on = !TA.mark[id];
    TA.mark[id] = on; TA.dirty = true;
    el.classList.toggle('abs', on);
    el.setAttribute('aria-pressed', String(on));
    el.querySelector('em').textContent = on ? 'غائب' : 'حاضر';
    document.getElementById('ta-sum').innerHTML = taSumText();
  });
  app.addEventListener('input', function (e) {
    if (e.target.id !== 'ta-q') return;
    TA.q = e.target.value;
    var q = norm(TA.q);
    app.querySelectorAll('[data-tast]').forEach(function (el) { el.hidden = !!q && norm(el.querySelector('strong').textContent).indexOf(q) < 0; });
  });
  // العودة إلى الشاشة تقرأ من الخادم من جديد، إلا كشفًا لم يُحفظ بعد
  window.addEventListener('hashchange', function () {
    if (location.hash !== '#/tatt' && !TA.dirty && !TA.saving) taReset();
  });
  window.addEventListener('beforeunload', function (e) {
    if (TA.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
