'use strict';
  /* ---------- جدول الحصص ----------
     كل حصة: يوم × رقم حصة × شعبة، بمعلمها ومادتها. وقتها الفعلي من مواعيد مرحلة الشعبة.
     المعلمون هم سجلات «بيانات العاملين»، والشعب من «إعداد الفصول». يعدّله المدير العام والمشرف، ويراه المدير،
     ويرى المعلم صاحب الحساب جدوله («جدولي»). الحذف لا يمسح الحصة بل يجعلها «محذوفة» تُستعاد من المراجعة.
     الجداول من supabase/timetable.sql، وشاشة الممر للمشاهدة فقط في bells.html */

  var TT_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
  var TT_ORD = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة', 'الحادية عشرة', 'الثانية عشرة'];

  function canEditTT() { return isAdmin() || role() === 'supervisor'; }
  function isTeacherRole() { return role() === 'teacher'; }

  async function loadTimetable() {
    var res = await Promise.all([
      fetchAll(function () { return sb.from('timetable_sessions').select('*').order('created_at').order('id'); }),
      sb.from('timetable_config').select('*').eq('id', 1).maybeSingle(),
      // النصاب والقواعد والاقتراحات: من supabase/timetable_plan.sql
      !isTeacherRole() ? sb.from('timetable_proposals').select('*').order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null })
    ]);
    var rows = res[0];
    S.ttMissing = !rows;
    S.ttSessions = rows || [];
    var c = rows ? res[1] : { data: null };
    S.ttConfig = c.data || null;
    var pr = rows && !isTeacherRole() ? res[2] : { data: [], error: null };
    S.ttPlanMissing = !!rows && !isTeacherRole() && (!!pr.error || !(S.ttConfig && 'quota' in S.ttConfig));
    S.ttProposals = pr.data || [];
    // المعلم صاحب الحساب لا تُجلب له بيانات العاملين؛ يكفيه سجله
    if (isTeacherRole() && S.profile && S.profile.teacher_id && !find(S.profile.teacher_id)) {
      var me = await sb.from('teachers').select('*').eq('id', S.profile.teacher_id).maybeSingle();
      if (me.data) S.teachers = [me.data];
    }
  }

  function ttCfg() {
    var c = S.ttConfig || {};
    return {
      days: Array.isArray(c.days) && c.days.length ? c.days : TT_DAYS,
      subjects: Array.isArray(c.subjects) ? c.subjects : [],
      bells: c.bells && Array.isArray(c.bells.stages) ? c.bells : { auto: true, stages: [] }
    };
  }

  function ttLive() { return S.ttSessions.filter(function (s) { return s.status !== 'removed'; }); }
  function ttById(id) { for (var i = 0; i < S.ttSessions.length; i++) if (S.ttSessions[i].id === id) return S.ttSessions[i]; return null; }

  // «8:40» ↔ دقائق؛ الأوقات بنظام 24 ساعة بلا صفر بادئ
  function ttMins(t) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim()); return m ? +m[1] * 60 + +m[2] : NaN; }
  function ttHm(m) { m = ((m % 1440) + 1440) % 1440; return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); }

  // مواعيد الحصص في مرحلة: الحصة رقم p = البند رقم p من نوع «حصة»
  function ttPTimes(st) { return st.rows.filter(function (r) { return r.k === 'p'; }).map(function (r) { return [r.f, r.t]; }); }
  // مرحلة الشعبة؛ الشعبة التي لم تُضف إلى مرحلة تتبع آخر مرحلة
  function ttStageOf(cls, bells) {
    var s = (bells || ttCfg().bells).stages;
    for (var i = 0; i < s.length; i++) if (s[i].classes.indexOf(cls) > -1) return s[i];
    return s[s.length - 1] || null;
  }
  function ttTimeFor(cls, p) { var st = ttStageOf(cls); return st ? ttPTimes(st)[p - 1] || null : null; }
  function ttCommonTime(p) {
    var v = ttCfg().bells.stages.map(function (s) { return ttPTimes(s)[p - 1]; }).filter(Boolean);
    if (!v.length) return null;
    for (var i = 1; i < v.length; i++) if (v[i][0] !== v[0][0] || v[i][1] !== v[0][1]) return null;
    return v[0];
  }
  // وقت الحصة في رأس العمود: لشعبة بعينها وقتها، ولجدول معلم الوقت المشترك أو «حسب المرحلة»
  // فترة زمنية تُقرأ من اليمين دائمًا، البداية (الأصغر) ثم النهاية: «8:00 – 8:40» وبداية الفترة على اليمين.
  // محصورة باتجاه عربي (RLI…PDI) فلا يقلب النص المحيط بها ترتيبها
  function ttRange(f, t) { return '⁧' + f + ' – ' + t + '⁩'; }

  function ttHeadTime(cls, p) {
    var t = cls ? ttTimeFor(cls, p) : ttCommonTime(p);
    return t ? ttRange(t[0], t[1]) : ttCfg().bells.stages.length ? 'حسب المرحلة' : '';
  }
  // عدد الحصص في اليوم: أكثرها بين المراحل، ولا يقل عن آخر حصة مستعملة
  function ttPeriods() {
    var n = 0;
    ttCfg().bells.stages.forEach(function (s) { n = Math.max(n, ttPTimes(s).length); });
    S.ttSessions.forEach(function (s) { if (s.status !== 'removed') n = Math.max(n, s.period); });
    return n || 6;
  }
  function ttRowLabel(st, i) {
    var r = st.rows[i];
    if (r.k !== 'p') return r.l || (r.k === 'a' ? 'الطابور' : 'الاستراحة');
    var n = 0;
    for (var j = 0; j <= i; j++) if (st.rows[j].k === 'p') n++;
    return 'الحصة ' + (TT_ORD[n - 1] || n);
  }
  function ttDayBounds() {
    var a = 1e9, b = -1;
    ttCfg().bells.stages.forEach(function (s) { s.rows.forEach(function (r) { a = Math.min(a, ttMins(r.f)); b = Math.max(b, ttMins(r.t)); }); });
    return a < 1e9 ? [ttHm(a), ttHm(b)] : ['', ''];
  }

  // اسم المعلم في الجداول: الأول والأخير؛ ويبقى كاملًا إن تشابه مختصره مع اسم آخر في بيانات العاملين
  function ttName(t) {
    if (!t) return 'بدون معلم';
    var sh = ttShortName(t.name);
    return S.teachers.some(function (x) { return x !== t && ttShortName(x.name) === sh; }) ? t.name : sh;
  }
  function ttTName(id) { var t = id && find(id); return t ? ttName(t) : 'بدون معلم'; }

  // الاسم الأول واسم العائلة: «سحر أحمد محمد الطويل» ← «سحر الطويل». الأسماء المركبة تبقى كاملة («عبد الرحمن»، «عطا الله»، «أبو القمبز»)
  function ttFamily(words) {
    var n = words.length, last = words[n - 1];
    if (n >= 3 && (/^(الله|الدين|الرحمن|الرحيم)$/.test(last) || /^(أبو|ابو|آل|بن|ابن|بني)$/.test(words[n - 2]))) return words[n - 2] + ' ' + last;
    return last;
  }
  function ttShortName(full) {
    var words = String(full || '').trim().split(/\s+/), first = nameParts(full)[0] || '';
    var fam = ttFamily(words), short = first + ' ' + fam;
    return words.length <= 2 || short.split(' ').length >= words.length ? String(full || '').trim() : short;
  }
  function ttShortTName(id) { return ttTName(id); }

  function ttLev(a, b) {
    var p = [], i, j;
    for (j = 0; j <= b.length; j++) p[j] = j;
    for (i = 1; i <= a.length; i++) {
      var prev = p[0];
      p[0] = i;
      for (j = 1; j <= b.length; j++) { var t = p[j]; p[j] = Math.min(p[j] + 1, p[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
    }
    return p[b.length];
  }
  // اسمان لشخص واحد: الاسم الأول نفسه، وبقية أحدهما (بلا مسافات) هي بقية الآخر أو آخرها («عطا الله»/«عطاالله»،
  // «إيمان الدهون»/«إيمان محمد الدهون»)، أو اسم العائلة يختلف بحرف واحد («الدهون»/«المدهون»)
  function ttSameName(a, b) {
    var pa = nameParts(norm(a)), pb = nameParts(norm(b));
    if (pa.length < 2 || pb.length < 2 || pa[0] !== pb[0]) return false;
    var ra = pa.slice(1).join('').replace(/\s/g, ''), rb = pb.slice(1).join('').replace(/\s/g, '');
    if (ra === rb || (Math.min(ra.length, rb.length) >= 3 && (ra.slice(-rb.length) === rb || rb.slice(-ra.length) === ra))) return true;
    var fa = ttFamily(norm(a).split(' ')).replace(/\s/g, ''), fb = ttFamily(norm(b).split(' ')).replace(/\s/g, '');
    return Math.min(fa.length, fb.length) >= 4 && ttLev(fa, fb) <= 1;
  }
  function ttWho() { return (S.profile && S.profile.full_name) || displayName(S.email); }
  // الشعب: من إعداد الفصول، ومعها أي شعبة في الجدول لم تعد في الإعداد (تظهر في المراجعة)
  function ttClasses() {
    var names = classConfig().names.slice();
    S.ttSessions.forEach(function (s) { if (s.status !== 'removed' && names.indexOf(s.class_name) < 0) names.push(s.class_name); });
    return names;
  }
  // محفّظ القرآن: فئته «محفظون»، أو كل حصصه في الجدول قرآن (لمن لم تُضبط فئته)
  function ttIsQuranT(t) {
    if (!t) return false;
    if (t.category === 'محفظون') return true;
    var mine = S.ttSessions.filter(function (s) { return s.teacher_id === t.id && s.status !== 'removed'; });
    return mine.length > 0 && mine.every(function (s) { return norm(ttFixSubject(s.subject)) === norm('قرآن'); });
  }
  // ترتيب المعلمين في كل قوائم الجدول وجداوله: المعلمون أبجديًا، ثم محفّظو القرآن في النهاية
  function ttTeacherCmp(a, b) {
    return (ttIsQuranT(a) ? 1 : 0) - (ttIsQuranT(b) ? 1 : 0) || a.name.localeCompare(b.name, 'ar');
  }
  // معلمو الجدول: من له حصص
  function ttTeachers() {
    var has = {};
    S.ttSessions.forEach(function (s) { if (s.teacher_id && s.status !== 'removed') has[s.teacher_id] = 1; });
    return S.teachers.filter(function (t) { return has[t.id]; }).sort(ttTeacherCmp);
  }
  // من يُختار معلمًا لحصة: هيئة التدريس والمحفظون، ومن هو معلم الحصة أصلًا
  function ttTeacherChoices(cur) {
    return S.teachers.filter(function (t) { return t.id === cur || (realStaff(t) && (!t.category || t.category === 'هيئة تدريس' || t.category === 'محفظون')); }).sort(ttTeacherCmp);
  }

  // التعارض: الشعبة أو المعلم في حصتين بنفس اليوم والحصة. يُعرض ولا يمنع الحفظ
  function ttConflicts(list) {
    var byC = {}, byT = {}, ids = {}, groups = [];
    var add = function (map, k, s) { (map[k] || (map[k] = [])).push(s); };
    (list || ttLive()).forEach(function (s) {
      add(byC, s.day + '|' + s.period + '|' + s.class_name, s);
      if (s.teacher_id) add(byT, s.day + '|' + s.period + '|' + s.teacher_id, s);
    });
    [[byC, 'class'], [byT, 'teacher']].forEach(function (p) {
      Object.keys(p[0]).forEach(function (k) {
        if (p[0][k].length < 2) return;
        groups.push({ kind: p[1], list: p[0][k] });
        p[0][k].forEach(function (s) { ids[s.id] = 1; });
      });
    });
    return { ids: ids, groups: groups };
  }

  function ttView() {
    if (isTeacherRole()) return 'mine';
    var m = location.hash.match(/^#\/timetable\/(teachers|review|bells|breaks|import|quota|improve|subs)$/);
    return m ? m[1] : 'classes';
  }

  function ttNav(view, cf) {
    var badge = cf.groups.length + ttLive().filter(function (s) { return s.status === 'review' || ttLessonHard(s); }).length + ttQuotaDiff().length;
    var pend = (S.ttProposals || []).filter(function (p) { return p.status === 'pending'; }).length;
    var item = function (key, hash, label, n) {
      return '<button type="button" data-tgo="' + hash + '"' + (view === key ? ' class="on" aria-current="page"' : '') + '>' + label + (n ? '<b>' + n + '</b>' : '') + '</button>';
    };
    return '<div class="tabbar"><nav class="tabs" aria-label="أقسام جدول الحصص">' + item('classes', '#/timetable', 'جداول الصفوف') + item('teachers', '#/timetable/teachers', 'جداول المعلمين') +
      item('bells', '#/timetable/bells', 'مواعيد الدوام') + item('breaks', '#/timetable/breaks', 'مقترح الاستراحة') + item('review', '#/timetable/review', 'المراجعة', badge) +
      item('subs', '#/timetable/subs', 'الاحتياط') +
      item('quota', '#/timetable/quota', 'النصاب والقواعد') + item('improve', '#/timetable/improve', 'تحسين الجدول', pend) +
      (canEditTT() ? item('import', '#/timetable/import', 'استيراد من ملف') : '') + '</nav></div>';
  }

  // أزرار الطباعة: الجدول المعروض، والكل، والجدولان العامان، ومواعيد الدوام
  function ttPrintBar(view) {
    var b = function (attr, label) { return '<button type="button" class="btn" ' + attr + ' data-ro-ok>' + label + '</button>'; };
    var one = view === 'classes' && ui.ttClass ? b('data-ttprint="c|' + esc(ui.ttClass) + '"', 'طباعة جدول الصف') :
      view === 'teachers' && ui.ttTeacher ? b('data-ttprint="t|' + esc(ui.ttTeacher) + '"', 'طباعة جدول المعلم') : '';
    return '<div class="toolbar no-print" style="align-items:center">' + one.replace('class="btn"', 'class="btn primary"') +
      menuHtml(one ? 'طباعة أخرى' : 'طباعة / PDF', b('data-ttprint="c|"', 'جداول كل الصفوف') + b('data-ttprint="t|"', 'جداول كل المعلمين') +
      b('data-ttprint="gc|"', 'الجدول العام للشعب') + b('data-ttprint="gt|"', 'الجدول العام للمعلمين') + b('data-ttprint="bells|"', 'مواعيد الدوام') + b('data-ttprint="form|"', 'تشكيل المعلمين')) +
      ttHeadBox() + '<label class="check" style="padding:0"><input type="checkbox" id="tt-sign" data-ro-ok' + (ttSignOn() ? ' checked' : '') + '> مع خانات التوقيع</label></div>';
  }

  // خانات التوقيع في جداول المعلمين والصفوف المطبوعة: اختيارية، ويُحفظ الاختيار في هذا المتصفح
  // الترويسة والشعار (والعلامة المائية) في جداول المعلمين والصفوف واقتراحات التحسين المطبوعة: تُلغى من خانة في شريط الطباعة
  function ttHeadOn() { try { return localStorage.getItem('tt-nohead') !== '1'; } catch (e) { return true; } }
  function ttHeadBox() { return '<label class="check" style="padding:0"><input type="checkbox" id="tt-head" data-ro-ok' + (ttHeadOn() ? ' checked' : '') + '> مع الترويسة والشعار</label>'; }
  // بلا ترويسة: سطر صغير باسم الأكاديمية والعام الدراسي بدلها
  function ttTop() { return ttHeadOn() ? letterhead() : '<div class="tt-plain"><b>' + esc(schoolName()) + '</b><span>العام الدراسي ' + esc(academicYear()) + '</span></div>'; }
  function ttWm() { return ttHeadOn() ? '<img class="wm" src="' + REPORT.logo + '" alt="">' : ''; }

  function ttSignOn() { try { return localStorage.getItem('tt-sign') === '1'; } catch (e) { return false; } }

