'use strict';
  /* ---------- مواصلات الطلاب (مدير النظام) ---------- */

  function findGroup(id) {
    for (var i = 0; i < S.tGroups.length; i++) if (S.tGroups[i].id === id) return S.tGroups[i];
    return null;
  }

  function currentGroup() {
    var m = location.hash.match(/^#\/transport\/(.+)$/);
    return m && canTransport() ? findGroup(m[1]) : null;
  }

  function membersOf(gid) {
    return S.tMembers.filter(function (m) { return m.group_id === gid && findStudent(m.student_id); });
  }

  // left_from: أول شهر لا يشترك فيه الطالب (أُوقف اشتراكه ابتداءً منه). قبله يبقى في كشوف الأشهر ودفعاتها
  // صف العضوية عند الإضافة إلى مجموعة أو النقل إليها: مشترك من جديد (إن كان عمود الإيقاف موجودًا)
  function memberRow(studentId, groupId) {
    var row = { student_id: studentId, group_id: groupId, share: null };
    if (!S.leaveMissing) row.left_from = null;
    return row;
  }

  function subscribedIn(m, month) {
    return !m.left_from || month < m.left_from;
  }

  // بدأ اشتراكه: صدر له إيصال عن الشهر المعروض أو عن شهر قبله.
  // من اختيرت له نقطة تجمع فقط (في التسجيل مثلًا) ليس مشتركًا بعد، فلا يُطالَب بشيء حتى يصدر له أول إيصال
  function startedBy(m, month) {
    var first = (S.tFirstPaid || {})[m.student_id];
    return !!first && first.slice(0, 7) <= month;
  }

  // من يُطلب منه اشتراك الشهر المعروض: من بدأ اشتراكه ولم يُوقَف، ومن له دفعة مسجلة عن هذا الشهر (حتى لا تختفي)
  // معفى من اشتراك الشهر: الإعفاء يُحدَّد بأول شهر وآخر شهر (آخر شهر فارغ: مستمر)
  function exemptIn(m, month) {
    return !!m && !!m.exempt_from && month >= m.exempt_from && (!m.exempt_to || month <= m.exempt_to);
  }

  function owesThisMonth(m) {
    return (exemptIn(m, ui.tMonth) && subscribedIn(m, ui.tMonth)) || (startedBy(m, ui.tMonth) && subscribedIn(m, ui.tMonth)) || ((S.tPay[ui.tMonth] || {})[m.student_id] || {}).amount > 0;
  }

  // اختيرت له نقطة تجمع ولم يبدأ اشتراكه بعد
  function awaitingStart(m) {
    return !owesThisMonth(m) && subscribedIn(m, ui.tMonth);
  }

  // بعد تسجيل دفعة أو حذفها أو ردّها: يُعاد حساب أول شهر دفع عنه الطالب
  // أول شهر دفع عنه الطالب. الإخوة الذين بدأوا في الشهر نفسه يُرتَّبون بالسن: الأكبر بالرسم الأول، وهكذا تُصدر إيصالات الأسر.
  // جُرّب الترتيب برقم الإيصال ثم بيوم السداد فخالف إيصالات أسر كثيرة؛ لا يُغيَّر دون مراجعة «أسر تحتاج مراجعة»
  function firstPaidKey(p) {
    return p.month;
  }

  async function refreshFirstPaid(studentId) {
    var r = await sb.from('transport_payments').select('student_id, month, amount, paid_on').eq('student_id', studentId);
    if (r.error) return;
    var first = '';
    (r.data || []).forEach(function (p) { var k = firstPaidKey(p); if (Number(p.amount) > 0 && (!first || k < first)) first = k; });
    if (first) S.tFirstPaid[studentId] = first; else delete S.tFirstPaid[studentId];
  }

  // فتح شاشة «إصدار إيصال» على طالب بعينه
  function openDesk(studentId) {
    var x = findStudent(studentId);
    ui.rcStudent = studentId;
    ui.rcQuery = (x && x.national_id) || '';
    ui.rcMethod = '';
    ui.rcRefund = false;
    go('#/transport/receipt');
  }

  async function setSubscription(sid, stop) {
    if (S.leaveMissing) return toast('شغّل الملف supabase/transport_unsubscribe.sql في محرر SQL أولًا، ثم حدّث الصفحة', true);
    var x = findStudent(sid), m = S.tMembers.filter(function (k) { return k.student_id === sid; })[0];
    if (!x || !m) return;
    if (stop) {
      if (((S.tPay[ui.tMonth] || {})[sid] || {}).amount > 0) {
        return alert('للطالب «' + x.full_name + '» دفعة مسجلة عن ' + tLabel(ui.tMonth) + '.\nاحذف إيصالها أولًا إن كان لن يشترك هذا الشهر، أو اختر الشهر التالي من أعلى الصفحة ثم أوقف الاشتراك ابتداءً منه.');
      }
      if (!confirm('إيقاف اشتراك «' + x.full_name + '» في المواصلات ابتداءً من ' + tLabel(ui.tMonth) + '؟\n\nلن يُطلب منه اشتراك هذا الشهر وما بعده. الأشهر السابقة ودفعاتها تبقى كما هي.')) return;
    }
    var value = stop ? ui.tMonth : null;
    var r = await sb.from('transport_members').update({ left_from: value }).eq('student_id', sid);
    if (r.error) return fail(r.error);
    m.left_from = value;
    render();
    toast(stop ? 'أُوقف الاشتراك ابتداءً من ' + tLabel(ui.tMonth) : 'أُعيد الاشتراك');
  }

  // حصة الطالب: المحددة له، وإلا اشتراك المجموعة
  // رسوم المواصلات الشهرية تُحسب للأسرة: الطالب الأول بمبلغ، وكل أخ بعده بمبلغ أقل
  var DEFAULT_FEES = { first: 700, next: 600 };

  function feeNum(v, d) { return v == null || v === '' || isNaN(Number(v)) ? d : Number(v); }
  // الرسوم: لدورة بعينها إن مُرّرت (قد تُعدَّل رسوم دورة واحدة)، وإلا الرسوم العامة
  function transportFees(month) {
    if (month) { var c = cycleOf(month); return { first: c.first, next: c.next }; }
    var f = classConfig().fees || {};
    return { first: feeNum(f.first, DEFAULT_FEES.first), next: feeNum(f.next, DEFAULT_FEES.next) };
  }

  // ترتيب كل مشترك في المواصلات بين إخوته المشتركين: { studentId: { rank, size, family } } (family: معرّف الأسرة).
  // الإخوة: من يشتركون في هوية ولي الأمر، أو هاتفه، أو اسم الأب والجد والعائلة. الأول هو الأكبر سنًّا.
  // تُحسب مرة لكل رسم للشاشة ثم تُنسى، لأن بيانات الطلاب قد تتغير
  var famCache = null;
  function familyInfo() {
    if (famCache) return famCache;
    var byId = {}, parent = {}, keyOwner = {};
    S.students.forEach(function (x) { byId[x.id] = x; });
    var ids = [];
    var atDesk = location.hash === '#/transport/receipt' ? ui.rcStudent : null;
    S.tMembers.forEach(function (m) {
      // من اختيرت له نقطة التجمع ولم يبدأ اشتراكه يُحسب مع إخوته أيضًا (بعدهم في الترتيب)، فيظهر مطلوبه في تقرير الباصات وملخص الشعب بتخفيض الإخوة
      // والطالب المفتوح في شاشة الإيصال يُحسب مع إخوته، ليُعرف مبلغه قبل الدفع
      if (byId[m.student_id] && !parent[m.student_id] && (owesThisMonth(m) || awaitingStart(m) || (m.student_id === atDesk && subscribedIn(m, ui.tMonth)))) { parent[m.student_id] = m.student_id; ids.push(m.student_id); }
    });
    var root = function (id) { while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; } return id; };
    ids.forEach(function (id) {
      var x = byId[id], keys = [], gid = String((x.details || {}).guardian_id || '').trim(), phone = String(x.phone || '').replace(/\D/g, ''), fam = familyName(x);
      if (gid.length >= 5) keys.push('g:' + gid);
      if (phone.length >= 8) keys.push('p:' + phone.slice(-10));
      if (fam.split(' ').length >= 3) keys.push('n:' + fam);
      keys.forEach(function (k) {
        if (keyOwner[k]) parent[root(id)] = root(keyOwner[k]); else keyOwner[k] = id;
      });
    });
    var families = {};
    ids.forEach(function (id) { var r = root(id); (families[r] || (families[r] = [])).push(byId[id]); });
    var info = {};
    Object.keys(families).forEach(function (r) {
      // الأول من بدأ اشتراكه أولًا (فلا يتغير مبلغ من سبق أن دفع)، ثم الأكبر سنًّا
      var list = families[r].sort(function (a, b) {
        return String(S.tFirstPaid[a.id] || '9999').localeCompare(String(S.tFirstPaid[b.id] || '9999')) ||
          String(a.birth_date || '9999').localeCompare(String(b.birth_date || '9999')) || a.full_name.localeCompare(b.full_name, 'ar');
      });
      list.forEach(function (x, i) { info[x.id] = { rank: i + 1, size: list.length, family: r }; });
    });
    famCache = info;
    Promise.resolve().then(function () { famCache = null; });
    return info;
  }

  // حصة الطالب الشهرية: المحددة له يدويًا، وإلا رسوم الأسرة بحسب ترتيبه بين إخوته المشتركين
  function shareOf(m) {
    // صدر إيصال لهذا الشهر وحُفظ معه المطلوب وقتها: هو المطلوب، ولا يُعاد حسابه بعد ذلك (الإيصالات الأقدم بلا مطلوب محفوظ تُحسب كما كانت)
    var issued = (S.tPay[ui.tMonth] || {})[m.student_id];
    if (issued && issued.amount > 0 && issued.due != null && issued.due !== '') return Number(issued.due);
    if (m.share != null && m.share !== '') return Number(m.share);
    var fees = transportFees(ui.tMonth), fam = familyInfo()[m.student_id];
    return fam && fam.rank > 1 ? fees.next : fees.first;
  }

  // «الأخ الثاني من 3» لمن له إخوة مشتركون
  function familyNote(studentId) {
    var fam = familyInfo()[studentId];
    if (!fam || fam.size < 2) return '';
    var words = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس'];
    return 'أسرة من ' + fam.size + ' مشتركين — ' + (words[fam.rank - 1] || fam.rank);
  }

  // المبالغ بالجنيه المصري
  function money(x) {
    return (Math.round(x * 100) / 100).toLocaleString('en') + ' ج.م';
  }

  function monthLabel(m) {
    return new Date(m + '-01T00:00').toLocaleDateString('ar-u-nu-latn', { month: 'long', year: 'numeric' });
  }

  /* ----- دورات المواصلات -----
     اشتراك المواصلات لدورة لا لشهر ميلادي: تبدأ كل دورة يومًا محددًا من الشهر (15 مثلًا) وتنتهي قبل بداية التالية،
     وموعد سدادها بعد بدايتها بعدد أيام المهلة. تُعرف الدورة بشهر بدايتها («2026-11» = 15/11 – 14/12)، وبه تُحفظ الإيصالات كما كانت.
     لكل دورة يمكن تعديل بدايتها ونهايتها وموعد سدادها ورسومها؛ وتعديل نهاية دورة يجعل التالية تبدأ في اليوم الذي يليها.
     الإعداد في settings.classes.cycles: { startDay, graceDays, over: { 'YYYY-MM': { from, to, due, first, next } } }.
     بلا إعداد: الدورة هي الشهر الميلادي وموعد السداد اليوم المحدد منه (كما كان). يطابق transport_cycle() في supabase/transport_cycles.sql */
  function isoDay(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function shiftMonth(key, n) {
    var y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7)) - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + '-' + String(m + 1).padStart(2, '0');
  }
  function cycleCfg() {
    var c = classConfig().cycles || {}, sd = Number(c.startDay), gd = Number(c.graceDays);
    return {
      startDay: c.startDay != null && c.startDay !== '' && sd >= 1 && sd <= 28 ? Math.round(sd) : 1,
      graceDays: c.graceDays != null && c.graceDays !== '' && gd >= 0 && gd <= 27 ? Math.round(gd) : payDueDay() - 1,
      over: c.over && typeof c.over === 'object' && !Array.isArray(c.over) ? c.over : {},
      set: c.startDay != null && c.startDay !== ''
    };
  }
  function cycleFrom(key, cc) {
    var o = cc.over[key] || {}, p = cc.over[shiftMonth(key, -1)] || {};
    if (isoDay(o.from)) return o.from;
    if (isoDay(p.to)) return addDays(p.to, 1);
    return key + '-' + String(cc.startDay).padStart(2, '0');
  }
  // { key, from, to, due, first, next, custom }
  function cycleOf(key) {
    var cc = cycleCfg(), o = cc.over[key] || {}, from = cycleFrom(key, cc), base = transportFees();
    return {
      key: key, from: from,
      to: isoDay(o.to) ? o.to : addDays(cycleFrom(shiftMonth(key, 1), cc), -1),
      due: isoDay(o.due) ? o.due : addDays(from, cc.graceDays),
      first: feeNum(o.first, base.first), next: feeNum(o.next, base.next),
      custom: Object.keys(o).length > 0
    };
  }
  // الدورة التي يقع فيها اليوم
  function currentCycle(day) {
    day = day || todayISO();
    var key = day.slice(0, 7);
    for (var i = 0; i < 3; i++) {
      var c = cycleOf(key);
      if (day < c.from) key = shiftMonth(key, -1);
      else if (day > c.to) key = shiftMonth(key, 1);
      else break;
    }
    return key;
  }
  // اسم الدورة: «نوفمبر 2026 (15/11 – 14/12)»؛ وإن طابقت الشهر الميلادي فاسمه وحده
  function tLabel(key) {
    if (!key) return '';
    var c = cycleOf(key), dm = function (iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); };
    if (c.from === key + '-01' && c.to === addDays(shiftMonth(key, 1) + '-01', -1)) return monthLabel(key);
    return monthLabel(key) + ' (⁧' + dm(c.from) + ' – ' + dm(c.to) + '⁩)';
  }

  // المطلوب والمحصَّل لمجموعة في الشهر المعروض
  function groupTotals(g) {
    var pay = S.tPay[ui.tMonth] || {}, due = 0, paid = 0, n = 0;
    // المعفى خارج العدد والمطلوب والمحصَّل
    membersOf(g.id).filter(owesThisMonth).forEach(function (m) {
      if (exemptIn(m, ui.tMonth)) return;
      n++; due += shareOf(m, g); paid += pay[m.student_id] ? pay[m.student_id].amount : 0;
    });
    return { n: n, due: due, paid: paid };
  }

  function groupFormHtml(g) {
    var val = function (k) { return esc(g && g[k] != null ? g[k] : ''); };
    var f = function (id, label, inner, wide) {
      return '<div' + (wide ? ' style="grid-column:1/-1"' : '') + '><label class="field" for="' + id + '">' + label + '</label>' + inner + '</div>';
    };
    return '<form class="card" id="group-form"><h2>' + (g ? 'تعديل بيانات الباص' : 'باص جديد') + '</h2>' +
      '<div class="grid2" style="margin-top:12px">' +
        f('gf-point', 'اسم الباص / المسار <span class="req">*</span>', '<input type="text" id="gf-point" required placeholder="مثال: باص 5 – الواحة والحي العاشر" value="' + val('assembly_point') + '">') +
        f('gf-time', 'وقت التجمع', '<input type="time" id="gf-time" value="' + val('pickup_time') + '">') +
        f('gf-sup', 'المشرف المرافق', '<input type="text" id="gf-sup" list="gf-sup-list" value="' + val('supervisor_name') + '">' +
          '<datalist id="gf-sup-list">' + S.teachers.map(function (t) { return '<option value="' + esc(t.name) + '">'; }).join('') + '</datalist>') +
        f('gf-phone', 'هاتف المشرف', '<input type="text" id="gf-phone" dir="ltr" inputmode="tel" style="text-align:right" value="' + val('supervisor_phone') + '">') +
        (S.busMissing ? '' :
          f('gf-driver', 'السائق', '<input type="text" id="gf-driver" value="' + val('driver_name') + '">') +
          f('gf-dphone', 'هاتف السائق', '<input type="text" id="gf-dphone" dir="ltr" inputmode="tel" style="text-align:right" value="' + val('driver_phone') + '">') +
          f('gf-cap', 'سعة الباص (عدد المقاعد)', '<input type="number" id="gf-cap" min="0" step="1" value="' + val('capacity') + '">')) +
        (S.routeMissing ? '' :
          f('gf-no', 'رقم الباص', '<input type="number" id="gf-no" min="1" step="1" value="' + val('bus_no') + '">') +
          f('gf-route', 'خط السير', '<textarea id="gf-route" rows="2" placeholder="مثال: من الواحة ثم الحي العاشر ثم المدرسة">' + val('route') + '</textarea>', true)) +
        f('gf-notes', 'ملاحظات', '<input type="text" id="gf-notes" value="' + val('notes') + '">') +
      '</div><div class="actions"><button type="submit" class="btn primary">حفظ</button>' +
      '<button type="button" class="btn" data-gedit="">إلغاء</button></div></form>';
  }

  // مرشحون للإضافة: طلاب ليسوا في هذه المجموعة، بالبحث في الاسم أو الهوية أو العنوان أو الصف
  function candidatesHtml(g) {
    var q = norm(ui.tSearch), inGroup = {};
    S.tMembers.forEach(function (m) { inGroup[m.student_id] = m.group_id; });
    var list = S.students.filter(function (x) {
      if (inGroup[x.id] === g.id || !enrolled(x)) return false; // الباصات للمسجَّلين نهائيًا فقط
      return !q || norm(x.full_name + ' ' + x.address + ' ' + x.class_name).indexOf(q) > -1 || x.national_id.indexOf(latinDigits(ui.tSearch)) > -1;
    });
    // غير الملتحقين بأي مجموعة أولًا
    list.sort(function (a, b) { return (inGroup[a.id] ? 1 : 0) - (inGroup[b.id] ? 1 : 0); });
    var LIMIT = 30;
    return (list.slice(0, LIMIT).map(function (x) {
      var other = inGroup[x.id] && findGroup(inGroup[x.id]);
      return '<div class="cand"><span><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '<br><span class="meta">' + esc(x.class_name || 'بدون صف') +
        (x.address ? ' · ' + esc(x.address) : '') + (other ? ' · في مجموعة «' + esc(other.assembly_point) + '»' : '') + '</span></span>' +
        '<button type="button" class="btn" data-madd="' + x.id + '">' + (other ? 'نقل إلى هنا' : 'إضافة') + '</button></div>';
    }).join('') || '<div class="empty">' + (S.students.length ? 'لا يوجد طلاب مطابقون.' : 'سجّل الطلاب أولًا من تبويب «تسجيل الطلاب».') + '</div>') +
      (list.length > LIMIT ? '<p class="st-count" style="margin-top:8px">يُعرض أول ' + LIMIT + ' من ' + list.length + '؛ اكتب في البحث لتضييق القائمة.</p>' : '');
  }

  function membersTableHtml(g) {
    var pay = S.tPay[ui.tMonth] || {}, members = membersOf(g.id), due = 0, paid = 0;
    members.sort(function (a, b) { return findStudent(a.student_id).full_name.localeCompare(findStudent(b.student_id).full_name, 'ar'); });
    var rows = members.map(function (m, i) {
      var x = findStudent(m.student_id);
      if (awaitingStart(m)) {
        return '<tr style="color:var(--muted)"><td>' + (i + 1) + '</td><td><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '<br><span class="meta" style="font-size:.85rem">' + esc(x.class_name || 'بدون صف') + '</span>' +
          pickupInput(m, x) + '</td>' + '<td dir="ltr" style="text-align:right">' + esc(x.phone || '—') + '</td><td colspan="3">أُضيف إلى الباص ولم يبدأ اشتراكه (لم يصدر له إيصال)</td>' +
          '<td><span class="badge pending">بانتظار الاشتراك</span></td>' +
          '<td class="no-print" style="white-space:nowrap"><button type="button" class="btn" data-mdesk="' + x.id + '">إصدار إيصال</button> ' +
          '<button type="button" class="btn" data-mexempt="' + x.id + '" title="إعفاء من الاشتراك لأشهر محددة">إعفاء</button> ' +
          '<button type="button" class="btn" data-mdel="' + x.id + '" title="إزالة من الباص">إزالة</button></td></tr>';
      }
      if (!owesThisMonth(m)) {
        return '<tr style="color:var(--muted)"><td>' + (i + 1) + '</td><td><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '<br><span class="meta" style="font-size:.85rem">' + esc(x.class_name || 'بدون صف') + '</span></td>' +
          '<td dir="ltr" style="text-align:right">' + esc(x.phone || '—') + '</td><td colspan="3">اشتراكه متوقف منذ ' + tLabel(m.left_from) + '</td>' +
          '<td><span class="badge pending">متوقف</span></td>' +
          '<td class="no-print" style="white-space:nowrap"><button type="button" class="btn" data-mresume="' + x.id + '" title="إعادة الاشتراك">إعادة</button> ' +
          '<button type="button" class="btn" data-mdel="' + x.id + '" title="إزالة من الباص">إزالة</button></td></tr>';
      }
      var sh = shareOf(m, g), rec = pay[x.id] || {}, p = rec.amount || 0, ex = exemptIn(m, ui.tMonth);
      var method = rec.method || 'cash';
      if (!ex) { due += sh; paid += p; }
      var badge = ex ? ['exempt', PAY_STATUS.exempt] : sh > 0 && p >= sh ? ['paid', 'مدفوع'] : p > 0 ? ['part', 'جزئي'] : sh > 0 ? ['unpaid', 'غير مدفوع'] : ['pending', '—'];
      var famNote = familyNote(x.id);
      return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '<br><span class="meta" style="color:var(--muted);font-size:.85rem">' + esc(x.class_name || 'بدون صف') + (famNote ? ' · ' + famNote : '') + '</span>' + pickupInput(m, x) + '</td>' +
        '<td dir="ltr" style="text-align:right">' + esc(x.phone || '—') + '</td>' +
        '<td><input type="number" min="0" step="any" data-mshare="' + x.id + '" aria-label="حصة ' + esc(x.full_name) + '" placeholder="' + shareOf({ student_id: x.id, share: null }) + '" value="' + (m.share != null ? esc(m.share) : '') + '"></td>' +
        (ex ? exReceiptCells(p, rec) :
        receiptCells(p, rec)) +
        '<td><span class="badge ' + badge[0] + '">' + badge[1] + '</span>' + (ex ? '<br><span style="color:var(--muted);font-size:.8rem">' + exemptText(m) + '</span>' : rideBadge(rideState(m, Math.max(0, sh - p)))) + (p > 0 ? '<br><span style="color:var(--muted);font-size:.8rem">' + esc(issuedNote(rec)) + '</span>' : '') + '</td>' +
        '<td class="no-print" style="white-space:nowrap">' + (p > 0 ? '<button type="button" class="btn" data-mreceipt="' + x.id + '">إيصال</button> <button type="button" class="btn danger" data-mvoid="' + x.id + '" title="حذف الإيصال (يُحفظ في الأرشيف)">حذف</button> ' : '') + (sh > p && !ex ? '<button type="button" class="btn" data-mfull="' + x.id + '">دفع كامل</button> ' : '') +
        (p > 0 ? '' : '<button type="button" class="btn" data-mstop="' + x.id + '" title="إيقاف الاشتراك">إيقاف</button> ') +
        '<button type="button" class="btn" data-mexempt="' + x.id + '" title="إعفاء من الاشتراك لأشهر محددة">إعفاء</button> ' +
        '<button type="button" class="btn" data-mdel="' + x.id + '" title="إزالة من الباص">إزالة</button></td></tr>';
    }).join('');
    return rows
      ? '<div class="table-wrap"><table class="grid pay"><thead><tr><th>م</th><th>الطالب</th><th>واتساب ولي الأمر</th><th>الحصة (ج.م)</th><th>المدفوع (ج.م)</th><th>طريقة الدفع</th><th>الحالة</th><th class="no-print"></th></tr></thead>' +
        '<tbody>' + rows + '</tbody><tfoot><tr><td colspan="3">المجموع</td><td>' + money(due) + '</td><td>' + money(paid) + '</td>' +
        '<td colspan="3">المتبقي: ' + money(Math.max(0, due - paid)) + '</td></tr></tfoot></table></div>' + groupMethodsHtml(g)
      : '<div class="empty">لا يوجد طلاب في هذه المجموعة بعد.</div>';
  }

  function exemptText(m) {
    if (!m || !m.exempt_from) return '';
    return 'إعفاء ' + (m.exempt_to && m.exempt_to !== m.exempt_from ? 'من ' + tLabel(m.exempt_from) + ' إلى ' + tLabel(m.exempt_to) : m.exempt_to ? tLabel(m.exempt_from) : 'من ' + tLabel(m.exempt_from) + ' (مستمر)') +
      (m.exempt_note ? ' — ' + esc(m.exempt_note) : '');
  }

  // بطاقة إعفاء طالب من اشتراك المواصلات لأشهر محددة (في صفحة باصه)
  function exemptStaffId() {
    return ui.exemptFor && String(ui.exemptFor).indexOf('s:') === 0 ? ui.exemptFor.slice(2) : null;
  }

  function exemptFormHtml(g) {
    var sid = exemptStaffId(), m = ui.exemptFor && (sid ? staffMember(sid) : memberOf(ui.exemptFor));
    if (!m || m.group_id !== g.id) return '';
    var name = sid ? (find(sid) || {}).name || '' : findStudent(m.student_id).full_name;
    if (sid ? S.staffExemptMissing : S.exemptMissing) {
      return '<div class="card"><p class="formhint" style="margin:0">الإعفاء يحتاج إلى أعمدة جديدة: شغّل الملف <code dir="ltr">supabase/' + (sid ? 'transport_staff.sql' : 'reserve_and_exempt.sql') + '</code> في محرر SQL ثم حدّث الصفحة.</p>' +
        '<div class="actions"><button type="button" class="btn" data-excancel>إغلاق</button></div></div>';
    }
    return '<div class="card" style="border:2px solid #c4b5fd"><h2>إعفاء ' + (sid ? 'الموظف ' : '') + '«' + esc(name) + '» من اشتراك المواصلات</h2>' +
      '<p class="hint">في أشهر الإعفاء يظهر ' + (sid ? 'الموظف' : 'الطالب') + ' «مدفوع (إعفاء)» بلون بنفسجي، ولا يُطلب منه اشتراك ولا يدخل في المطلوب' + (sid ? ' ولا في المتأخرين' : '') + '. اترك «إلى شهر» فارغًا لإعفاء مستمر.</p>' +
      '<div class="toolbar" style="align-items:center">' +
        '<span class="monthpick"><label class="field" for="ex-from">من شهر</label><input type="month" id="ex-from" value="' + esc(m.exempt_from || ui.tMonth) + '"></span>' +
        '<span class="monthpick"><label class="field" for="ex-to">إلى شهر</label><input type="month" id="ex-to" value="' + esc(m.exempt_from ? m.exempt_to || '' : ui.tMonth) + '"></span>' +
        '<input type="text" id="ex-note" placeholder="' + (sid ? 'سبب الإعفاء' : 'سبب الإعفاء (مثلًا: ابن موظف، حالة خاصة)') + '" value="' + esc(m.exempt_note || '') + '" style="flex:1;min-width:220px"></div>' +
      '<div class="actions"><button type="button" class="btn primary" data-exsave>حفظ الإعفاء</button>' +
        (m.exempt_from ? '<button type="button" class="btn danger" data-exdel>إلغاء الإعفاء</button>' : '') +
        '<button type="button" class="btn" data-excancel>إغلاق</button></div></div>';
  }

  async function saveExempt(remove) {
    var staffId = exemptStaffId(), sid = ui.exemptFor, m = staffId ? staffMember(staffId) : memberOf(sid);
    if (!m) return;
    var patch;
    if (remove) {
      if (!confirm('إلغاء إعفاء ' + (staffId ? 'هذا الموظف' : 'هذا الطالب') + '؟ يعود مطالَبًا باشتراك الأشهر التي كان معفى منها ولم يدفعها.')) return;
      patch = { exempt_from: null, exempt_to: null, exempt_note: '' };
    } else {
      var from = document.getElementById('ex-from').value, to = document.getElementById('ex-to').value;
      if (!from) return toast('اختر أول شهر للإعفاء', true);
      if (to && to < from) return toast('«إلى شهر» قبل «من شهر»', true);
      patch = { exempt_from: from, exempt_to: to || null, exempt_note: document.getElementById('ex-note').value.trim() };
    }
    var r = staffId ? await sb.from('transport_staff_members').update(patch).eq('staff_id', staffId)
      : await sb.from('transport_members').update(patch).eq('student_id', sid);
    if (r.error) return fail(r.error);
    Object.assign(m, patch);
    ui.exemptFor = null;
    render();
    toast(remove ? 'أُلغي الإعفاء' : 'حُفظ الإعفاء: ' + exemptText(m).replace(/<[^>]+>/g, ''));
  }

  // خانة «نقطة الركوب» تحت اسم الطالب في صفحة الباص (ومعها تنبيه لمن أُضيف قبل تسجيله النهائي)
  function pickupInput(m, x) {
    var warn = !enrolled(x) ? '<br><span class="badge unpaid" style="margin-top:4px">مبدئي — لا يظهر في كشف الباص</span>' : '';
    if (S.busMissing) return warn;
    return warn + pickupBox(m, x);
  }

  function pickupBox(m, x) {
    return '<input type="text" class="mnote" data-mpickup="' + x.id + '" placeholder="نقطة الركوب" aria-label="نقطة ركوب ' + esc(x.full_name) + '" value="' + esc(m.pickup || '') + '">';
  }

  /* ----- مهلة السداد والتنبيه والتعليق عن الركوب -----
     اشتراك الشهر يُسدَّد حتى يوم محدد منه (المهلة). من فاتته ولم يسدد كاملًا «متأخر»: يُقترح تعليقه،
     والقرار للإدارة: تعليقه عن الركوب لهذا الشهر، أو منحه مهلة إضافية حتى تاريخ. السداد الكامل يرفع التعليق تلقائيًا */

  function payDueDay() {
    var d = Number((classConfig().fees || {}).dueDay);
    return d >= 1 && d <= 28 ? Math.round(d) : 5;
  }

  // بطاقة «دورات المواصلات ورسومها» (صفحة الباصات): الإعداد العام، ثم الدورة السابقة والجارية والتاليتان، كلٌّ قابلة للتعديل
  function cyclesCardHtml() {
    var cc = cycleCfg(), base = transportFees(), cur = currentCycle(), edit = isAdmin();
    var keys = [shiftMonth(cur, -1), cur, shiftMonth(cur, 1), shiftMonth(cur, 2)];
    var dis = edit ? '' : ' disabled';
    var rows = keys.map(function (k) {
      var c = cycleOf(k), o = cc.over[k] || {};
      var date = function (f) { return '<input type="date" data-cyc="' + k + '|' + f + '" value="' + c[f] + '"' + dis + (o[f] ? ' style="border-color:var(--primary)"' : '') + '>'; };
      var fee = function (f) { return '<input type="number" min="0" step="any" style="width:90px" data-cyc="' + k + '|' + f + '" placeholder="' + base[f] + '" value="' + (o[f] != null && o[f] !== '' ? esc(o[f]) : '') + '"' + dis + '>'; };
      return '<tr' + (k === cur ? ' style="background:var(--primary-soft, #eef2ff)"' : '') + '><td><b>' + monthLabel(k) + '</b>' + (k === cur ? ' <span class="badge paid">الجارية</span>' : '') + '</td>' +
        '<td>' + date('from') + '</td><td>' + date('to') + '</td><td>' + date('due') + '</td><td>' + fee('first') + '</td><td>' + fee('next') + '</td>' +
        '<td>' + (edit && c.custom ? '<button type="button" class="btn link" data-cycreset="' + k + '">إلى الافتراضي</button>' : '') + '</td></tr>';
    }).join('');
    return '<div class="card"><h2>دورات المواصلات ورسومها</h2>' +
      '<div class="toolbar" style="align-items:center;margin-top:8px">' +
        '<label class="field" for="fee-first" style="margin:0">الطالب الأول</label><input type="number" id="fee-first" min="0" step="any" style="width:100px" value="' + base.first + '"' + dis + '>' +
        '<label class="field" for="fee-next" style="margin:0">كل أخ بعده</label><input type="number" id="fee-next" min="0" step="any" style="width:100px" value="' + base.next + '"' + dis + '>' +
        '<span class="st-count" style="margin:0">ج.م لكل طالب في الدورة</span></div>' +
      '<div class="toolbar" style="align-items:center;margin-top:8px">' +
        '<label class="field" for="cyc-start" style="margin:0">تبدأ كل دورة يوم</label><input type="number" id="cyc-start" min="1" max="28" step="1" style="width:80px" value="' + cc.startDay + '"' + dis + '>' +
        '<span class="st-count" style="margin:0">من الشهر، وتنتهي قبل بداية التالية ·</span>' +
        '<label class="field" for="cyc-grace" style="margin:0">مهلة السداد</label><input type="number" id="cyc-grace" min="0" max="27" step="1" style="width:80px" value="' + cc.graceDays + '"' + dis + '>' +
        '<span class="st-count" style="margin:0">أيام بعد بدايتها</span></div>' +
      '<div class="table-wrap" style="margin-top:10px"><table class="grid"><thead><tr><th>الدورة</th><th>من</th><th>إلى</th><th>آخر موعد للسداد</th><th>الطالب الأول</th><th>كل أخ</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="hint" style="margin:8px 0 0">لكل دورة تعديل بدايتها أو نهايتها أو موعد سدادها أو رسومها وحدها (الخانة المعدّلة بإطار ملوّن)؛ ' +
        'وتغيير نهاية دورة يجعل التالية تبدأ في اليوم الذي يليها. الرسوم الفارغة تعني الرسوم العامة أعلاه. الإيصالات الصادرة لا يتغير مبلغها. ' +
        'الدورة تُسمّى بشهر بدايتها، وإيصالاتها «عن شهر» ذلك. يُعرف الإخوة بهوية ولي الأمر أو هاتفه أو اسم الأب والجد والعائلة، والأول هو الأكبر سنًّا؛ ومبلغ خاص لطالب بعينه من صفحة نقطة التجمع.</p></div>';
  }

  // حفظ إعداد الدورات (يبقى معه كل إعداد الفصول الآخر)
  function saveCycles(next) {
    var cfg = classConfig();
    saveClassConfig({ rooms: cfg.rooms, list: cfg.list, fees: cfg.fees, holidays: cfg.holidays, cycles: next });
  }

  function cycleEdit(key, field, value) {
    var cc = cycleCfg(), over = JSON.parse(JSON.stringify(cc.over)), o = over[key] || {};
    if (value === '' || value == null) delete o[field];
    else if (field === 'first' || field === 'next') o[field] = Math.max(0, Number(value) || 0);
    else if (isoDay(value)) o[field] = value;
    else return toast('تاريخ غير صحيح', true);
    if (Object.keys(o).length) over[key] = o; else delete over[key];
    // تحقق: البداية قبل النهاية في هذه الدورة وجارتيها
    var test = { startDay: cc.startDay, graceDays: cc.graceDays, over: over };
    var old = S.settings.classes;
    S.settings.classes = Object.assign({}, old, { cycles: test });
    classCache = null;
    var bad = [shiftMonth(key, -1), key, shiftMonth(key, 1)].filter(function (k) { var c = cycleOf(k); return c.from > c.to; });
    S.settings.classes = old;
    classCache = null;
    if (bad.length) { render(); return toast('بداية الدورة يجب أن تكون قبل نهايتها (' + bad.map(monthLabel).join('، ') + ')', true); }
    saveCycles(test);
  }

  // آخر موعد لسداد اشتراك الدورة
  function payDeadline(month) {
    return cycleOf(month).due;
  }

  // left: المتبقي عليه عن الشهر المعروض. يعيد: ok | grace (ضمن المهلة) | extended (مهلة إضافية) | late | suspended
  function rideState(m, left) {
    if (!(left > 0)) return 'ok';
    if (m.suspended_month === ui.tMonth) return 'suspended';
    var today = todayISO();
    if (today <= payDeadline(ui.tMonth)) return 'grace';
    if (m.grace_until && String(m.grace_until).slice(0, 10) >= today) return 'extended';
    return 'late';
  }

  var RIDE_STATE = { grace: 'ضمن المهلة', extended: 'مهلة إضافية', late: 'متأخر', suspended: 'موقوف عن الركوب' };

  function rideBadge(state) {
    return state === 'late' || state === 'suspended' || state === 'extended'
      ? ' <span class="badge ' + (state === 'extended' ? 'part' : 'unpaid') + '">' + RIDE_STATE[state] + '</span>' : '';
  }

  function memberOf(studentId) {
    for (var i = 0; i < S.tMembers.length; i++) if (S.tMembers[i].student_id === studentId) return S.tMembers[i];
    return null;
  }

  // المطالَبون بهذا الشهر ولم يسددوا كاملًا، مع حالة كل واحد
  function dueRows() {
    return payRows().filter(function (r) { return r.left > 0; }).map(function (r) {
      r.m = memberOf(r.x.id);
      r.state = rideState(r.m, r.left);
      return r;
    });
  }

  function daysLate() {
    var d = Math.floor((new Date(todayISO() + 'T00:00') - new Date(payDeadline(ui.tMonth) + 'T00:00')) / 864e5);
    return d > 0 ? d : 0;
  }

  async function updateMember(studentId, patch, done) {
    var r = await sb.from('transport_members').update(patch).eq('student_id', studentId);
    if (r.error) return fail(r.error);
    var m = memberOf(studentId);
    if (m) Object.assign(m, patch);
    render();
    if (done) toast(done);
  }

  function suspendPatch(on) {
    return on
      ? { suspended_month: ui.tMonth, suspended_by: (S.profile && S.profile.full_name) || displayName(S.email), suspended_at: new Date().toISOString(), grace_until: null }
      : { suspended_month: null, suspended_by: null, suspended_at: null };
  }

  function lateHtml() {
    if (S.busMissing) {
      return '<div class="card empty">متابعة السداد والتعليق تحتاج إلى أعمدة جديدة في قاعدة البيانات.<br>شغّل الملف <code dir="ltr">supabase/transport_buses.sql</code> في محرر SQL ثم حدّث الصفحة.</div>';
    }
    var rows = dueRows(), n = { grace: 0, extended: 0, late: 0, suspended: 0 }, owed = 0;
    rows.forEach(function (r) { n[r.state]++; if (r.state !== 'grace') owed += r.left; });
    var order = { late: 0, extended: 1, suspended: 2, grace: 3 };
    var shown = rows.filter(function (r) { return !ui.lateState ? r.state !== 'grace' : r.state === ui.lateState; })
      .sort(function (a, b) { return order[a.state] - order[b.state] || String(a.g.assembly_point).localeCompare(b.g.assembly_point, 'ar') || a.x.full_name.localeCompare(b.x.full_name, 'ar'); });
    var late = daysLate(), soon = new Date(Date.now() + 3 * 864e5), soonISO = soon.getFullYear() + '-' + String(soon.getMonth() + 1).padStart(2, '0') + '-' + String(soon.getDate()).padStart(2, '0');
    var card = function (key, lbl, sub, color) {
      return '<button type="button" class="card stat" data-latestate="' + key + '" style="text-align:right;cursor:pointer' + (ui.lateState === key ? ';outline:2px solid var(--primary)' : '') + '">' +
        '<span class="lbl">' + lbl + '</span><span class="num"' + (color ? ' style="color:' + color + '"' : '') + '>' + n[key] + '</span><span class="sub">' + sub + '</span></button>';
    };
    var body = shown.map(function (r, i) {
      var x = r.x, m = r.m, act = '';
      if (r.state !== 'grace') {
        act = (r.state === 'suspended'
            ? '<button type="button" class="btn" data-unsuspend="' + x.id + '">رفع التعليق</button> '
            : '<button type="button" class="btn danger" data-suspend="' + x.id + '">تعليق الركوب</button> ') +
          '<input type="date" id="grace-' + x.id + '" aria-label="مهلة حتى" min="' + todayISO() + '" value="' + esc(String(m.grace_until || '').slice(0, 10) >= todayISO() ? String(m.grace_until).slice(0, 10) : soonISO) + '"> ' +
          '<button type="button" class="btn" data-gracegive="' + x.id + '">' + (r.state === 'extended' ? 'تعديل المهلة' : 'منح مهلة') + '</button> ';
      }
      act += '<button type="button" class="btn" data-mdesk="' + x.id + '">إصدار إيصال</button>';
      return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '<br><span style="color:var(--muted);font-size:.85rem">' + esc(x.class_name || 'بدون صف') + '</span></td>' +
        '<td>' + esc(r.g.assembly_point) + '</td><td dir="ltr" style="text-align:right">' + esc(plainPhone(x.phone) || '—') + '</td>' +
        '<td><b>' + plainNum(r.left) + '</b>' + (r.paid ? '<br><span style="color:var(--muted);font-size:.85rem">دفع ' + plainNum(r.paid) + ' من ' + plainNum(r.share) + '</span>' : '') + '</td>' +
        '<td><span class="badge ' + (r.state === 'late' || r.state === 'suspended' ? 'unpaid' : r.state === 'extended' ? 'part' : 'pending') + '">' + RIDE_STATE[r.state] + '</span>' +
          (r.state === 'extended' ? '<br><span style="color:var(--muted);font-size:.85rem">حتى ' + dmy(m.grace_until) + '</span>' : '') +
          (r.state === 'late' && late ? '<br><span style="color:var(--muted);font-size:.85rem">منذ ' + late + ' يومًا</span>' : '') +
          (r.state === 'suspended' && m.suspended_by ? '<br><span style="color:var(--muted);font-size:.85rem">' + esc(m.suspended_by) + (m.suspended_at ? ' · ' + dmy(m.suspended_at) : '') + '</span>' : '') + '</td>' +
        '<td class="no-print"><div class="acts">' + act + '</div></td></tr>';
    }).join('');
    return '<div class="card"><div class="toolbar" style="align-items:center;margin:0">' +
        '<span><b>آخر موعد لسداد اشتراك ' + tLabel(ui.tMonth) + ': ' + dmy(payDeadline(ui.tMonth)) + '</b></span>' +
        (isAdmin() ? '<a class="btn link" href="#/transport/setup">تعديل الدورات ومواعيدها</a>' : '') + '</div>' +
        '<p class="hint" style="margin:8px 0 0">من فاته الموعد ولم يسدد كاملًا يظهر «متأخرًا». القرار لك: تعليقه عن الركوب، أو منحه مهلة إضافية حتى تاريخ تختاره. لا يُعلَّق أحد تلقائيًا، والسداد الكامل يرفع التعليق.</p></div>' +
      '<div class="stats">' + card('late', 'متأخرون', 'فات الموعد — بانتظار قرارك', n.late ? 'var(--red)' : '') + card('extended', 'بمهلة إضافية', 'لم تنتهِ مهلتهم بعد') +
        card('suspended', 'موقوفون عن الركوب', 'لشهر ' + tLabel(ui.tMonth), n.suspended ? 'var(--red)' : '') + card('grace', 'ضمن المهلة', 'لم يحن الموعد بعد') + '</div>' +
      '<div class="card"><div class="toolbar" style="align-items:center"><h2 style="margin:0;flex:1">' + (ui.lateState ? RIDE_STATE[ui.lateState] : 'المتأخرون والموقوفون') + ' (' + shown.length + ')' +
          (ui.lateState ? '' : ' — المتبقي عليهم ' + plainNum(owed) + ' ج.م') + '</h2>' +
        (ui.lateState ? '<button type="button" class="btn" data-latestate="">عرض الكل</button>' : '') +
        (n.late ? '<button type="button" class="btn danger" data-suspendall>تعليق كل المتأخرين (' + n.late + ')</button>' : '') +
        '<button type="button" class="btn" data-latexlsx' + (rows.length ? '' : ' disabled') + '>تصدير Excel</button></div>' +
      (body
        ? '<div class="table-wrap"><table class="grid pay"><thead><tr><th>م</th><th>الطالب</th><th>الباص</th><th>واتساب ولي الأمر</th><th>المتبقي (ج.م)</th><th>الحالة</th><th class="no-print">الإجراء</th></tr></thead><tbody>' + body + '</tbody></table></div>'
        : '<div class="empty">لا أحد في هذه القائمة.</div>') + '</div>' + staffLateHtml();
  }

  async function suspendAllLate() {
    var list = dueRows().filter(function (r) { return r.state === 'late'; });
    if (!list.length || !confirm('تعليق ' + list.length + ' طالبًا عن ركوب الباص لشهر ' + tLabel(ui.tMonth) + '؟\n\nيظهرون «موقوفين» في كشوف الباصات إلى أن يسددوا أو تمنحهم مهلة.')) return;
    var patch = suspendPatch(true), done = 0;
    for (var i = 0; i < list.length; i++) {
      var r = await sb.from('transport_members').update(patch).eq('student_id', list[i].x.id);
      if (!r.error) { Object.assign(list[i].m, patch); done++; }
    }
    render();
    toast('عُلِّق ' + done + ' طالبًا' + (done < list.length ? '، وتعذّر ' + (list.length - done) : ''), done < list.length);
  }

  async function exportLateXlsx() {
    if (!(await syncData(true))) return;
    var rows = dueRows();
    if (!rows.length) return toast('لا يوجد ما يُصدَّر', true);
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new(), late = daysLate();
      wb.Workbook = { Views: [{ RTL: true }] };
      var ws = XLSX.utils.aoa_to_sheet([[schoolName()], ['متابعة سداد المواصلات — ' + tLabel(ui.tMonth) + ' — آخر موعد ' + dmy(payDeadline(ui.tMonth))], [],
        ['م', 'اسم الطالب', 'الشعبة', 'الباص', 'نقطة الركوب', 'ولي الأمر', 'هاتف ولي الأمر', 'رقم الواتساب', 'الحصة (ج.م)', 'المدفوع (ج.م)', 'المتبقي (ج.م)', 'الحالة', 'مهلة حتى', 'أيام التأخير']]
        .concat(rows.map(function (r, i) {
          return [i + 1, r.x.full_name, r.x.class_name || '', r.g.assembly_point, r.m.pickup || '', r.x.guardian_name || '', plainPhone(r.x.phone), plainPhone(r.x.whatsapp),
            r.share, r.paid, r.left, RIDE_STATE[r.state], r.state === 'extended' ? dmy(r.m.grace_until) : '', r.state === 'late' || r.state === 'suspended' ? late : ''];
        })));
      ws['!cols'] = [5, 32, 14, 28, 20, 26, 16, 16, 12, 13, 13, 18, 13, 12].map(function (w) { return { wch: w }; });
      XLSX.utils.book_append_sheet(wb, ws, 'متابعة السداد');
      XLSX.writeFile(wb, 'متابعة-سداد-المواصلات-' + ui.tMonth + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ----- كشف الباص ----- */

  // ركاب الباص في الشهر المعروض: كل من فيه إلا من أُوقف اشتراكه
  function busRiders(g) {
    return membersOf(g.id).filter(function (m) {
      var x = findStudent(m.student_id);
      return x && enrolled(x) && (owesThisMonth(m) || subscribedIn(m, ui.tMonth));
    });
  }

  // اسم العائلة (الكلمة الأخيرة، ومعها «أبو» ونحوها) وما قبله
  function splitFamily(fullName) {
    var words = String(fullName || '').trim().split(/\s+/), family = words.length > 1 ? words.pop() : '';
    if (words.length > 1 && /^(أبو|ابو|ابن|بن|آل|ال)$/.test(words[words.length - 1])) family = words.pop() + ' ' + family;
    return { given: words.join(' '), family: family };
  }

  var pendingBus = null;

  // أجزاء الاسم: كل «عبد» أو «أبو» ونحوهما يُضم إلى الكلمة التي بعده
  function nameParts(full) {
    var w = String(full || '').trim().split(/\s+/), out = [];
    for (var i = 0; i < w.length; i++) {
      if (/^(عبد|عبدال|أبو|ابو|أبي|ابي|بن|ابن|آل|ال)$/.test(w[i]) && i + 1 < w.length) { out.push(w[i] + ' ' + w[i + 1]); i++; }
      else out.push(w[i]);
    }
    return out;
  }

  function buildBusSheet(g) {
    var pay = S.tPay[ui.tMonth] || {}, paidN = 0, exemptN = 0;
    var list = busRiders(g).map(function (m) {
      // الاسم الأول واسم الأب كما يُكتبان: «عبد الرحمن» و«أبو بكر» اسم واحد من كلمتين
      var x = findStudent(m.student_id), nm = splitFamily(x.full_name), parts = nameParts(x.full_name), first = parts[0] || '';
      var gid = latinDigits(String((x.details || {}).guardian_id || '')).replace(/\D/g, ''), ph = latinDigits(String(x.phone || '')).replace(/\D/g, '').slice(-10);
      // خانة الاشتراك: تُعلَّم لمن دفع عن الشهر، والفارغة لم يدفع
      var paid = (pay[x.id] || {}).amount || 0, share = shareOf(m, g);
      var ex = exemptIn(m, ui.tMonth);
      var mark = ex ? '✓ إعفاء' : paid > 0 && paid >= share ? '✓ مدفوع' : paid > 0 ? 'جزئي ' + plainNum(paid) : '';
      if (ex) exemptN++;
      else if (paid > 0 && paid >= share) paidN++;
      var father = parts[1] || '';
      return { x: x, m: m, name: nm.family ? first : x.full_name, family: nm.family, father: father, mark: mark, full: ex || (paid > 0 && paid >= share), exempt: ex,
        key: gid.length >= 5 ? 'g' + gid : ph.length >= 8 ? 'p' + ph : 'n' + norm(nm.family) + x.id };
    });
    // الإخوة متتالون: الترتيب باسم العائلة ثم الأسرة ثم السن، ويفصل بين الأسر خط
    var head = {};
    list.forEach(function (r) { if (!head[r.key] || r.family.length > head[r.key].length) head[r.key] = r.family; });
    list.sort(function (a, b) {
      return head[a.key].localeCompare(head[b.key], 'ar') || a.key.localeCompare(b.key) || String(a.x.birth_date || '').localeCompare(String(b.x.birth_date || '')) || a.name.localeCompare(b.name, 'ar');
    });
    var families = Object.keys(head).length, prev = '', size = {};
    list.forEach(function (r) { size[r.key] = (size[r.key] || 0) + 1; });
    var c = function (v) { return '<td class="c">' + v + '</td>'; };
    var phone = function (v, span) { return '<td class="c big" dir="ltr" style="white-space:nowrap' + (span > 1 ? ';vertical-align:middle' : '') + '"' + (span > 1 ? ' rowspan="' + span + '"' : '') + '>' + esc(plainPhone(v)) + '</td>'; };
    // جوال الطالب، وإن كان هو رقم ولي الأمر نفسه فرقم الواتساب بدله (إن اختلف)، حتى لا يتكرر الرقم
    var same = function (p, q) { var a = latinDigits(String(p || '')).replace(/\D/g, '').slice(-10), b = latinDigits(String(q || '')).replace(/\D/g, '').slice(-10); return a.length >= 8 && a === b; };
    var secondPhone = function (x) {
      var main = x.phone || x.whatsapp, st = stVal(x, 'student_phone');
      if (st && !same(st, main)) return '<td class="c big" dir="ltr" style="white-space:nowrap">' + esc(plainPhone(st)) + '</td>';
      // سطر واحد حتى لا يتضاعف ارتفاع الصف (الكشف في صفحة واحدة)
      if (x.whatsapp && !same(x.whatsapp, main)) return '<td class="c big" style="white-space:nowrap"><small style="font-size:.6em">واتساب</small> <span dir="ltr">' + esc(plainPhone(x.whatsapp)) + '</span></td>';
      return '<td class="c" style="color:#7d8597">' + (st ? 'نفس رقم ولي الأمر' : '—') + '</td>';
    };
    // العائلة وهاتف ولي الأمر خانة واحدة تجمع الإخوة: يعرف المشرف أنهم لأسرة واحدة ويتصل برقم واحد
    var rows = list.map(function (r, i) {
      var first = r.key !== prev, n = size[r.key];
      prev = r.key;
      var famCell = first ? '<td class="big"' + (n > 1 ? ' rowspan="' + n + '" style="vertical-align:middle;background:#eef2f7"' : '') + '><b>' + esc(head[r.key] || '—') + '</b>' +
        // سطر ثانٍ واحد: الأب وعدد الإخوة ثم العنوان التفصيلي
        // (للأسرة ذات الطالب الواحد في السطر نفسه بعد اسم العائلة: صف واحد أقصر يبقي الكشف في صفحة واحدة)
        (r.father || stVal(r.x, 'address') ? (n > 1 ? '<br><span class="addr">' : ' <span class="addr in">— ') + [r.father ? 'الأب: ' + esc(r.father) + (n > 1 ? ' · ' + n + ' إخوة' : '') : '', stVal(r.x, 'address') ? 'العنوان: ' + esc(stVal(r.x, 'address')) : ''].filter(Boolean).join(' — ') + '</span>' : '') + '</td>' : '';
      return '<tr' + (first && i ? ' style="border-top:2px solid #7d8597"' : '') + '><td class="c" style="white-space:nowrap;padding-inline:.2em">' + (i + 1) + '</td><td class="big" style="white-space:nowrap"><b>' + esc(r.name) + '</b>' + rsvMark(r.x) + '</td><td class="c" style="white-space:nowrap">' + esc(r.x.class_name || '—') + '</td>' + famCell +
        (first ? phone(r.x.phone || r.x.whatsapp, n) : '') + secondPhone(r.x) +
        '<td class="c" style="white-space:nowrap' + (r.full ? ';font-weight:700' : '') + (r.exempt ? ';color:#6d28d9' : '') + '">' + esc(r.mark) + '</td></tr>';
    }).join('');
    var staffPart = staffBusSheetRows(g, list.length);
    var dots = '............................';
    // صفحة واحدة (يُصغَّر الخط حتى يتسع)؛ وتتكرر عناوين الأعمدة لو امتد اضطرارًا إلى صفحة ثانية
    var head = reportHead('كشف الباص — ' + esc(g.assembly_point), [['الشهر', tLabel(ui.tMonth)], ['السائق', g.driver_name ? esc(g.driver_name) + (g.driver_phone ? ' (' + esc(g.driver_phone) + ')' : '') : dots],
        ['المشرف/ة', g.supervisor_name ? esc(g.supervisor_name) + (g.supervisor_phone ? ' (' + esc(g.supervisor_phone) + ')' : '') : dots], ['وقت التجمع', g.pickup_time || '']]).replace(/^<img class="wm"[^>]*>/, '');
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
      // رأس الكشف في الصفحة الأولى فقط؛ عناوين الأعمدة تتكرر في كل صفحة
      // (الهامش السفلي السالب يلغي فراغ الهامش العلوي المتكرر في رأس الجدول تحته في الصفحة الأولى)
      '<div style="padding-top:var(--pad-y);margin-bottom:calc(.3em - var(--pad-y));font-size:1.087em;position:relative">' + head + '</div>' +
      '<table class="rz bus"><thead><tr><td class="pg-space" colspan="7"></td></tr>' +
      '<tr><th>م</th><th>اسم الطالب</th><th>الشعبة</th><th style="width:42%">العائلة والعنوان</th><th>هاتف ولي الأمر</th><th>جوال الطالب<br>/ واتساب</th><th>الاشتراك</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7" class="c">لا يوجد طلاب في هذا الباص</td></tr>') + staffPart.html + '</tbody><tfoot><tr><td class="pg-space" colspan="7"></td></tr></tfoot></table>' +
      '<p style="margin:.7em 0;font-weight:700">عدد الطلاب: ' + list.length + ' &nbsp;&nbsp;&nbsp; عدد العائلات: ' + families +
        (list.some(function (r) { return isReserve(r.x); }) ? ' &nbsp;&nbsp;&nbsp; * احتياط' : '') + ' &nbsp;&nbsp;&nbsp; سدّدوا اشتراك الشهر: ' + paidN + ' &nbsp;&nbsp;&nbsp; لم يسددوا: ' + (list.length - paidN - exemptN) + (exemptN ? ' &nbsp;&nbsp;&nbsp; معفون: ' + exemptN : '') +
        (staffPart.n ? ' &nbsp;&nbsp;&nbsp; الموظفون: ' + staffPart.n + ' (سدّدوا: ' + staffPart.paid + (staffPart.exempt ? '، معفون: ' + staffPart.exempt : '') + ')' : '') + (g.capacity != null ? ' &nbsp;&nbsp;&nbsp; سعة الباص: ' + g.capacity : '') + '</p>';
  }

  // تفصيل وسائل الدفع لنقطة تجمع
  function groupMethodsHtml(g) {
    return methodStripHtml(payTotals(payRows().filter(function (r) { return r.g === g; })));
  }


  /* ---------- مواصلات الموظفين ----------
     الموظف (من «بيانات المعلمين») يركب الباص ويدفع اشتراكه بإيصال. جداول مستقلة عن الطلاب (supabase/transport_staff.sql):
     لا رسم ثابت للموظف؛ المبلغ يُكتب في كل إيصال، ورقمه من تسلسل إيصالات المواصلات نفسه.
     الإيصال لا يُعدَّل ولا يُحذف؛ الخطأ يُلغى مع سببه (يبقى محفوظًا ولا يُحتسب) ثم يصدر إيصال جديد */

  S.sMembers = [];
  S.sPay = [];
  S.staffTMissing = false;
  S.sRefunds = [];
  S.staffRefundMissing = false;

  async function loadStaffTransport() {
    var res = await Promise.all([
      fetchAll(function () { return sb.from('transport_staff_members').select('*').order('joined_at').order('staff_id'); }),
      fetchAll(function () { return sb.from('transport_staff_payments').select('*').order('receipt_no'); }),
      fetchAll(function () { return sb.from('transport_staff_refunds').select('*').order('created_at'); })
    ]);
    var m = res[0], p = m ? res[1] : null;
    S.staffTMissing = !m;
    S.sMembers = m || [];
    S.sPay = (p || []).map(function (r) { r.amount = Number(r.amount) || 0; return r; });
    // المستردات من الموظفين: جدولها أُضيف لاحقًا إلى supabase/transport_staff.sql
    S.staffRefundMissing = !!m && !res[2];
    // إعفاء الموظفين: أعمدته أُضيفت لاحقًا إلى supabase/transport_staff.sql
    S.staffExemptMissing = !!m && !!(await sb.from('transport_staff_members').select('exempt_from').limit(1)).error;
    S.sRefunds = (res[2] || []).map(function (r) { r.amount = Number(r.amount) || 0; return r; });
  }

  var STAFF_SQL_MSG = 'مواصلات الموظفين تحتاج إلى جداول جديدة: شغّل الملف supabase/transport_staff.sql في محرر SQL ثم حدّث الصفحة.';

  function staffMember(id) {
    for (var i = 0; i < S.sMembers.length; i++) if (S.sMembers[i].staff_id === id) return S.sMembers[i];
    return null;
  }

  // إيصالات الموظف السارية عن دورة (الملغاة لا تُحتسب)
  function staffReceipts(id, month) {
    return S.sPay.filter(function (p) { return p.staff_id === id && p.month === (month || ui.tMonth) && !p.voided_at; });
  }

  // الموظف معفى من اشتراك الدورة (الإعفاء بأول دورة وآخرها، كالطلاب)
  function staffExempt(id, month) {
    return exemptIn(staffMember(id), month || ui.tMonth);
  }

  function staffRefunds(id, month) {
    return S.sRefunds.filter(function (v) { return v.staff_id === id && v.month === (month || ui.tMonth); });
  }

  // صافي ما دفعه الموظف عن الدورة: إيصالاته السارية ناقص ما رُدّ إليه (الإيصال نفسه لا يتغير)
  function staffPaid(id, month) {
    var paid = staffReceipts(id, month).reduce(function (a, p) { return a + p.amount; }, 0);
    return Math.round((paid - refundTotal(staffRefunds(id, month))) * 100) / 100;
  }

  // صافي كل إيصال بعد المستردات: يُنقص المسترد من أحدث الإيصالات أولًا (لسجل الدفعات)
  function staffNetOfReceipts(id, month) {
    var left = refundTotal(staffRefunds(id, month)), net = {};
    staffReceipts(id, month).slice().sort(function (a, b) { return b.receipt_no - a.receipt_no; }).forEach(function (p) {
      var cut = Math.min(left, p.amount);
      left = Math.round((left - cut) * 100) / 100;
      net[p.receipt_no] = Math.round((p.amount - cut) * 100) / 100;
    });
    return net;
  }

  var STAFF_REFUND_SQL_MSG = 'استرداد مبالغ الموظفين يحتاج إلى جدول جديد: شغّل الملف supabase/transport_staff.sql مرة أخرى في محرر SQL ثم حدّث الصفحة.';

  // سجل المستردات: مستردات الموظفين بهيئة مستردات الطلاب، بشعبة «موظفون»
  function staffRefundRows() {
    return S.sRefunds.map(function (v) {
      var m = staffMember(v.staff_id), g = m && findGroup(m.group_id), t = find(v.staff_id);
      return Object.assign({}, v, { staff: true, student_name: v.staff_name, guardian_name: v.staff_name, class_name: 'موظفون', assembly_point: g ? g.assembly_point : '',
        job: t ? [t.job_title, t.category].filter(Boolean).join(' — ') : '' });
    });
  }

  function allRefunds() {
    return (S.tRefunds || []).concat(staffRefundRows()).sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); });
  }

  async function staffRefundSave(print) {
    if (S.staffRefundMissing) return toast(STAFF_REFUND_SQL_MSG, true);
    var t = find(ui.rcStaff), paid = t ? staffPaid(t.id) : 0;
    if (!t || !(paid > 0)) return;
    var amount = Math.round((Number(document.getElementById('rf-amount').value) || 0) * 100) / 100;
    var reason = document.getElementById('rf-reason').value.trim(), method = document.getElementById('rf-method').value;
    var stopBox = document.getElementById('rf-stop'), stop = !!(stopBox && stopBox.checked);
    if (!(amount > 0)) return toast('اكتب المبلغ المسترد.', true);
    if (amount > paid) return toast('المبلغ المسترد أكبر من صافي المدفوع عن الدورة (' + plainNum(paid) + ' ج.م).', true);
    if (!reason) return toast('اكتب سبب الاسترداد.', true);
    var net = Math.round((paid - amount) * 100) / 100;
    if (!confirm('استرداد ' + money(amount) + ' للموظف «' + t.name + '» من المدفوع عن ' + tLabel(ui.tMonth) + '؟\n\nالمدفوع الآن: ' + money(paid) + '\nالصافي بعد الاسترداد: ' + money(net) +
      '\n\nالإيصالات تبقى كما صدرت، ويُسجَّل الاسترداد بسند مستقل.' + (stop && net === 0 ? '\nوسيُوقف ركوبه ابتداءً من هذه الدورة.' : ''))) return;
    var recs = staffReceipts(t.id), last = recs.length ? recs[recs.length - 1] : null;
    var row = { staff_id: t.id, staff_name: t.name, month: ui.tMonth, receipt_no: last ? last.receipt_no : null, paid_before: paid, amount: amount,
      method: method, method_note: document.getElementById('rf-note').value.trim(), reason: reason,
      refunded_by: (S.profile && S.profile.full_name) || displayName(S.email), refunded_on: todayISO() };
    var ins = await sb.from('transport_staff_refunds').insert(row).select().single();
    if (ins.error) return fail(ins.error);
    var saved = Object.assign({}, row, ins.data || {});
    saved.amount = Number(saved.amount) || amount;
    S.sRefunds.push(saved);
    var m = staffMember(t.id);
    if (stop && net === 0 && m) {
      var left = await sb.from('transport_staff_members').update({ left_from: ui.tMonth }).eq('staff_id', t.id);
      if (left.error) fail(left.error); else m.left_from = ui.tMonth;
    }
    ui.rcRefund = false;
    document.getElementById('rc-body').innerHTML = deskBodyHtml();
    toast('سُجّل استرداد ' + money(amount));
    if (print) { pendingRefund = staffRefundRows().filter(function (v) { return v.id === saved.id; })[0] || null; if (pendingRefund) printNow(); }
  }

  // موظفو الباص في الدورة المعروضة (من أُوقف ركوبه قبلها لا يُعدّ)
  function staffRiders(g) {
    return S.sMembers.filter(function (m) {
      // من أُضيف إلى الباص في دورة لاحقة لا يُعدّ في الدورات التي قبلها
      return m.group_id === g.id && find(m.staff_id) && (!m.left_from || ui.tMonth < m.left_from) &&
        (!m.joined_at || currentCycle(String(m.joined_at).slice(0, 10)) <= ui.tMonth);
    }).sort(function (a, b) { return find(a.staff_id).name.localeCompare(find(b.staff_id).name, 'ar'); });
  }

  // ركاب الباص: الطلاب والموظفون (لسعة الباص)
  function busCount(g) {
    return busRiders(g).length + staffRiders(g).length;
  }

  function staffMeta(t) {
    return [t.category, t.job_title].filter(Boolean).map(esc).join(' · ') || 'موظف';
  }

  // بطاقة الموظفين في صفحة الباص: من في الباص، وما دفعه عن الدورة، والإضافة
  function staffBusCardHtml(g) {
    if (S.staffTMissing) return isAdmin() ? '<div class="card no-print"><h2>الموظفون في الباص</h2><p class="formhint" style="margin:0">' + esc(STAFF_SQL_MSG) + '</p></div>' : '';
    var riders = staffRiders(g), q = norm(ui.tsSearch || '');
    var rows = riders.map(function (m, i) {
      var t = find(m.staff_id), recs = staffReceipts(t.id), paid = staffPaid(t.id);
      return '<tr><td>' + (i + 1) + '</td><td class="who"><b>' + esc(t.name) + '</b><br><span class="meta" style="font-size:.85rem">' + staffMeta(t) + '</span>' +
          (isAdmin() ? '<input type="text" class="mnote" data-spickup="' + t.id + '" placeholder="نقطة الركوب" aria-label="نقطة ركوب ' + esc(t.name) + '" value="' + esc(m.pickup || '') + '">' : (m.pickup ? '<br><span class="meta">' + esc(m.pickup) + '</span>' : '')) + '</td>' +
        '<td dir="ltr" style="text-align:right;white-space:nowrap">' + esc(plainPhone(t.whatsapp) || '—') + '</td>' +
        '<td>' + (staffExempt(t.id) ? '<span class="badge exempt">مدفوع (إعفاء)</span><br><span class="meta" style="font-size:.8rem">' + exemptText(m) + '</span>'
          : paid ? '<span class="badge paid">مدفوع ' + plainNum(paid) + '</span><br><span class="meta" style="font-size:.8rem">' +
          recs.map(function (p) { return 'إيصال ' + p.receipt_no; }).join('، ') + '</span>' : '<span class="badge unpaid">لم يسدد</span>' + (m.exempt_from ? '<br><span class="meta" style="font-size:.8rem">' + exemptText(m) + '</span>' : '')) + '</td>' +
        '<td class="no-print"><div class="acts">' + (isAdmin() ? '<button type="button" class="btn" data-sdesk="' + t.id + '">إصدار إيصال</button>' +
          '<button type="button" class="btn" data-sexempt="' + t.id + '" title="إعفاء من الاشتراك لدورات محددة">إعفاء</button>' +
          '<button type="button" class="btn" data-sdel="' + t.id + '" title="إزالة من الباص">إزالة</button>' : '') + '</div></td></tr>';
    }).join('');
    var inBus = {};
    S.sMembers.forEach(function (m) { inBus[m.staff_id] = m.group_id; });
    var cands = isAdmin() ? staffList().filter(function (t) {
      return inBus[t.id] !== g.id && (!q || norm(t.name + ' ' + (t.category || '') + ' ' + (t.job_title || '')).indexOf(q) > -1 || (latinDigits(ui.tsSearch || '').replace(/\D/g, '').length >= 4 && latinDigits(String(t.whatsapp || '')).indexOf(latinDigits(ui.tsSearch).replace(/\D/g, '')) > -1));
    }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); }) : [];
    return '<div class="card"><h2>الموظفون في الباص (' + riders.length + ') — ' + tLabel(ui.tMonth) + '</h2>' +
      (rows ? '<div class="table-wrap"><table class="grid pay"><thead><tr><th>م</th><th>الموظف</th><th>الجوال</th><th>اشتراك الدورة</th><th class="no-print"></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">لا يوجد موظفون في هذا الباص.</div>') +
      (isAdmin() ? '<details class="no-print" style="margin-top:12px"' + (ui.tsSearch ? ' open' : '') + '><summary>إضافة موظفين إلى الباص</summary>' +
        '<input type="search" id="ts-search" placeholder="ابحث باسم الموظف أو وظيفته أو جواله" aria-label="بحث عن موظف" style="margin:8px 0" value="' + esc(ui.tsSearch || '') + '">' +
        '<div id="ts-cands">' + (cands.slice(0, 30).map(function (t) {
          var other = inBus[t.id] && findGroup(inBus[t.id]);
          return '<div class="cand"><span><b>' + esc(t.name) + '</b><br><span class="meta">' + staffMeta(t) + (other ? ' · في باص «' + esc(other.assembly_point) + '»' : '') + '</span></span>' +
            '<button type="button" class="btn" data-sadd="' + t.id + '">' + (other ? 'نقل إلى هنا' : 'إضافة') + '</button></div>';
        }).join('') || '<div class="empty">' + (S.teachers.length ? 'لا يوجد موظفون مطابقون.' : 'أضف الموظفين أولًا من «بيانات المعلمين».') + '</div>') +
        (cands.length > 30 ? '<p class="st-count" style="margin-top:8px">يُعرض أول 30 من ' + cands.length + '؛ اكتب في البحث لتضييق القائمة.</p>' : '') + '</div></details>' : '') + '</div>';
  }

  // البحث في شاشة الإيصال: بالاسم أو بأرقام الجوال (4 أرقام فأكثر)
  function deskStaffMatches(query) {
    if (S.staffTMissing) return [];
    var digits = latinDigits(query).replace(/[\s-]/g, ''), n = norm(query);
    if (!n) return [];
    if (/^\d+$/.test(digits)) return digits.length >= 4 ? staffList().filter(function (t) { return latinDigits(String(t.whatsapp || '')).replace(/\D/g, '').indexOf(digits) > -1; }).slice(0, 8) : [];
    return staffList().filter(function (t) { return norm(t.name).indexOf(n) > -1; }).slice(0, 8);
  }

  function staffDeskHtml(t) {
    var m = staffMember(t.id), g = m && findGroup(m.group_id), recs = staffReceipts(t.id), paid = staffPaid(t.id);
    var row = function (label, value) { return '<div><b>' + label + '</b><span>' + esc(value || '—') + '</span></div>'; };
    var head = '<div class="card"><div class="toolbar" style="align-items:center;margin-bottom:6px"><h2 style="margin:0;flex:1">' + esc(t.name) + '</h2><span class="badge part">موظف</span></div>' +
      '<div class="orig-answers">' + row('الفئة', t.category) + row('الوظيفة', t.job_title) + row('الجوال', plainPhone(t.whatsapp)) + row('الباص', g ? g.assembly_point : 'غير مشترك في المواصلات') + '</div>';
    if (!g) {
      return head + '<p class="formhint" style="margin-top:10px">هذا الموظف غير مشترك في المواصلات. اختر الباص لإضافته ثم سجّل الدفعة.</p>' +
        '<div class="toolbar" style="align-items:center;margin-top:8px"><select id="rc-sgroup" aria-label="الباص" style="width:auto;min-width:220px"><option value="">— اختر الباص —</option>' +
        S.tGroups.map(function (k) { return '<option value="' + k.id + '">' + esc(k.assembly_point) + '</option>'; }).join('') + '</select>' +
        '<button type="button" class="btn primary" data-sjoin="' + t.id + '">إضافة إلى المواصلات</button></div></div>';
    }
    var method = ui.rcMethod || 'cash', ref = hasPayRef(method);
    var voided = S.sPay.filter(function (p) { return p.staff_id === t.id && p.month === ui.tMonth && p.voided_at; });
    return head +
      '<div class="stats" style="margin:14px 0 6px"><div class="card stat"><span class="lbl">' + (staffRefunds(t.id).length ? 'صافي المدفوع عن ' : 'المدفوع عن ') + tLabel(ui.tMonth) + '</span><span class="num" style="color:var(--green)">' + plainNum(paid) + ' <small>ج.م</small></span>' +
        '<span class="sub">' + (recs.length ? recs.length + ' إيصال' : 'لم يُسجَّل دفع لهذه الدورة') + '</span></div>' +
        (staffExempt(t.id) ? '<div class="card stat"><span class="lbl">الاشتراك</span><span class="num" style="color:#6d28d9">إعفاء</span><span class="sub">' + exemptText(m) + '</span></div>' : '') + '</div>' +
      (recs.length ? '<div class="table-wrap" style="margin-bottom:10px"><table class="grid pay"><thead><tr><th>رقم الإيصال</th><th>المبلغ</th><th>الوسيلة</th><th>التاريخ</th><th>المسجِّل</th><th></th></tr></thead><tbody>' +
        recs.map(function (p) {
          return '<tr><td><b>' + p.receipt_no + '</b></td><td>' + money(p.amount) + '</td><td>' + esc(payMethodLabel(p)) + '</td><td>' + dmy(p.paid_on) + '</td><td>' + esc(p.issued_by || '—') + '</td>' +
            '<td><div class="acts"><button type="button" class="btn" data-sprint="' + p.receipt_no + '">طباعة</button>' +
            (isAdmin() ? '<button type="button" class="btn danger" data-svoid="' + p.receipt_no + '" title="يبقى محفوظًا بسبب الإلغاء ولا يُحتسب">إلغاء</button>' : '') + '</div></td></tr>';
        }).join('') + '</tbody></table></div>' : '') +
      (function () {
        var back = staffRefunds(t.id);
        return back.length ? '<p class="st-count" style="margin:0 0 10px">رُدّ له عن هذه الدورة: ' + money(refundTotal(back)) + ' (' + back.map(function (v) {
          return 'سند ' + (v.refund_no != null ? v.refund_no : '—') + ' بتاريخ ' + dmy(v.refunded_on);
        }).join('، ') + ') — والمدفوع أعلاه صافٍ بعده. التفاصيل في «المستردات».</p>' : '';
      })() +
      (isAdmin() && paid > 0 ? (ui.rcRefund ? refundFormHtml(null, paid, true) : '<div class="actions" style="margin:0 0 12px"><button type="button" class="btn" data-rcrefund>استرداد مبلغ</button></div>') : '') +
      (voided.length ? '<p class="st-count" style="margin:0 0 10px">إيصالات ملغاة لهذه الدورة: ' + voided.map(function (p) { return p.receipt_no + ' (' + money(p.amount) + ' — ' + esc(p.void_reason || '') + ')'; }).join('، ') + '</p>' : '') +
      (isAdmin() ? '<div class="grid2">' +
        '<div><label class="field" for="rc-amount">المبلغ المدفوع (ج.م)</label><input type="number" id="rc-amount" min="0" step="any" value="">' +
          '<div class="day">لا رسم ثابت للموظفين: اكتب المبلغ المدفوع فعلًا. يصدر به إيصال برقم جديد عن ' + tLabel(ui.tMonth) + '.</div></div>' +
        '<div><label class="field" for="rc-method">طريقة الدفع</label><select id="rc-method">' + Object.keys(PAY_METHODS).map(function (k) {
          return '<option value="' + k + '"' + (k === method ? ' selected' : '') + '>' + PAY_METHODS[k] + '</option>';
        }).join('') + '</select></div>' +
        (method === 'cash' ? '' : '<div style="grid-column:1/-1"><label class="field" for="rc-note">' + (ref ? 'رقم الدفع (' + PAY_METHODS[method] + ')' : 'حدّد طريقة الدفع') + '</label>' +
          '<input type="text" id="rc-note"' + (ref ? ' dir="ltr" inputmode="numeric" style="text-align:right"' : '') + ' value=""></div>') +
        '</div><div class="actions"><button type="button" class="btn primary" data-rcsave="print">تسجيل الدفعة وطباعة الإيصال</button>' +
        '<button type="button" class="btn" data-rcsave="save">تسجيل دون طباعة</button></div>' : '') + '</div>';
  }

  async function staffSave(print) {
    if (S.staffTMissing) return toast(STAFF_SQL_MSG, true);
    var t = find(ui.rcStaff), amount = Number(document.getElementById('rc-amount').value);
    if (!t || !staffMember(t.id)) return;
    if (!(amount > 0)) return toast('اكتب مبلغًا أكبر من صفر.', true);
    var method = document.getElementById('rc-method').value, note = document.getElementById('rc-note');
    var row = { staff_id: t.id, staff_name: t.name, month: ui.tMonth, amount: amount, method: method, method_note: method === 'cash' ? '' : (note ? note.value.trim() : ''),
      paid_on: todayISO(), issued_by: (S.profile && S.profile.full_name) || displayName(S.email), issued_at: new Date().toISOString() };
    var ins = await sb.from('transport_staff_payments').insert(row).select().single();
    if (ins.error) return fail(ins.error);
    var rec = ins.data || row;
    rec.amount = Number(rec.amount) || amount;
    S.sPay.push(rec);
    ui.rcMethod = '';
    document.getElementById('rc-body').innerHTML = deskBodyHtml();
    toast('صدر الإيصال رقم ' + (rec.receipt_no != null ? rec.receipt_no : '—') + ' بمبلغ ' + money(amount));
    if (print) { pendingReceipt = { staff: t.id, no: rec.receipt_no }; printNow(); }
    var box = document.getElementById('rc-id');
    if (box) { box.focus(); box.select(); }
  }

  async function staffVoid(no) {
    var p = S.sPay.filter(function (r) { return String(r.receipt_no) === String(no); })[0];
    if (!p || p.voided_at) return;
    if (staffPaid(p.staff_id, p.month) - p.amount < 0) {
      return toast('استُرد للموظف من هذه الدورة ' + money(refundTotal(staffRefunds(p.staff_id, p.month))) + '؛ إلغاء هذا الإيصال يجعل المسترد أكبر من المدفوع، فلا يُلغى.', true);
    }
    var reason = prompt('إلغاء الإيصال رقم ' + p.receipt_no + ' للموظف «' + p.staff_name + '» بمبلغ ' + money(p.amount) + '.\n' +
      'يبقى محفوظًا مع سبب الإلغاء ولا يُحتسب في المحصَّل، ثم يمكن إصدار إيصال صحيح.\n\nاكتب سبب الإلغاء:', '');
    if (reason == null) return;
    reason = reason.trim();
    if (!reason) return toast('لا يُلغى الإيصال دون كتابة السبب.', true);
    var patch = { voided_at: new Date().toISOString(), voided_by: (S.profile && S.profile.full_name) || displayName(S.email), void_reason: reason };
    var r = await sb.from('transport_staff_payments').update(patch).eq('receipt_no', p.receipt_no);
    if (r.error) return fail(r.error);
    Object.assign(p, patch);
    var body = document.getElementById('rc-body');
    if (body) body.innerHTML = deskBodyHtml(); else render();
    toast('أُلغي الإيصال رقم ' + p.receipt_no);
  }

  async function staffJoin(id, groupId) {
    if (S.staffTMissing) return toast(STAFF_SQL_MSG, true);
    var row = { staff_id: id, group_id: groupId, left_from: null };
    var r = await sb.from('transport_staff_members').upsert(row, { onConflict: 'staff_id' });
    if (r.error) return fail(r.error);
    var m = staffMember(id);
    if (m) Object.assign(m, row); else S.sMembers.push(Object.assign({ pickup: '' }, row));
  }

  // إيصال الموظف: بهيئة إيصال الطالب (أصل ونسخة)، بلا اشتراك ثابت ولا متبقٍ
  function buildStaffReceiptSheet(q) {
    var rec = S.sPay.filter(function (p) { return String(p.receipt_no) === String(q.no); })[0];
    if (!rec) return;
    var t = find(rec.staff_id) || { name: rec.staff_name }, m = staffMember(rec.staff_id), g = m && findGroup(m.group_id), method = rec.method || 'cash';
    var no = ('00000' + rec.receipt_no).slice(-Math.max(6, String(rec.receipt_no).length));
    var fixed = function (v) { return (Number(v) || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var line = function (ar, en, value, cls) {
      return '<div class="rv-line' + (cls ? ' ' + cls : '') + '"><span class="k">' + ar + '</span><span class="v">' + esc(value || '') + '</span><span class="e">' + en + '</span></div>';
    };
    var methods = Object.keys(PAY_METHODS).map(function (k) {
      return '<span class="rv-m">' + (k === method ? '☑' : '☐') + ' ' + (k === 'other' && method === 'other' && rec.method_note ? 'أخرى: ' + esc(rec.method_note) : PAY_METHODS[k]) + '</span>';
    }).join('');
    var total = staffPaid(rec.staff_id, rec.month);
    var copy = function (second) {
      return '<div class="rc-copy' + (second ? ' rc-2' : '') + '"><img class="wm" src="' + REPORT.logo + '" alt="">' + rvTag(second, 'receipt') + letterhead() +
        '<div class="rv-top">' +
          '<div class="rv-no"><div><span>رقم الإيصال <small>No.</small></span><b>' + no + '</b></div>' +
            '<div><span>التاريخ <small>Date</small></span><i>' + dmy(rec.paid_on || todayISO()) + '</i></div></div>' +
          '<div class="rv-title"><h1>إيصال</h1><span>RECEIPT</span></div>' +
          '<div class="rv-amt"><span>المبلغ <small>Amount</small></span><b>' + fixed(rec.amount) + '</b><i>ج.م <small>EGP</small></i></div>' +
        '</div>' +
        '<div class="rv-body">' +
          line('استلمنا من السيد/ة', 'Received from', t.name) +
          '<div class="rv-two">' + line('الوظيفة', 'Position', [t.job_title, t.category].filter(Boolean).join(' — ') || 'موظف') + line('الصفة', 'Type', 'موظف', 'short') + '</div>' +
          line('مبلغًا وقدره', 'The sum of', amountInWords(rec.amount)) +
          line('وذلك عن', 'Being for', 'اشتراك المواصلات للموظف عن ' + tLabel(rec.month) + (g ? ' — الباص: ' + g.assembly_point : '')) +
          '<div class="rv-line"><span class="k">طريقة الدفع</span><span class="rv-ms">' + methods + '</span><span class="e">Payment</span></div>' +
          (hasPayRef(method) ? line('رقم الدفع (' + PAY_METHODS[method] + ')', 'Ref. No.', rec.method_note, 'ref') : '') +
        '</div>' +
        '<div class="rv-end"><div class="rv-sum"><div><span>المدفوع بهذا الإيصال</span><b>' + money(rec.amount) + '</b></div>' +
          '<div><span>مجموع المدفوع عن الدورة</span><b class="ok">' + money(total) + '</b></div></div>' +
        '<div class="rv-stamp">الختم</div></div></div>';
    };
    sheet.className = 'rc';
    sheet.innerHTML = copy(false) + rvCut('receipt') + copy(true);
    fitSheet();
  }

  // كشف الباص: صفوف الموظفين بعد الطلاب
  function staffBusSheetRows(g, start) {
    var riders = staffRiders(g), paidN = 0, exemptN = 0;
    var rows = riders.map(function (m, i) {
      var t = find(m.staff_id), ex = exemptIn(m, ui.tMonth), paid = !ex && staffPaid(t.id) > 0;
      if (ex) exemptN++; else if (paid) paidN++;
      return '<tr><td class="c" style="white-space:nowrap;padding-inline:.2em">' + (start + i + 1) + '</td><td class="big" style="white-space:nowrap"><b>' + esc(t.name) + '</b></td>' +
        '<td class="c" style="white-space:nowrap">موظف</td><td class="big">' + esc([t.job_title || t.category, m.pickup ? 'الركوب: ' + m.pickup : ''].filter(Boolean).join(' — ')) + '</td>' +
        '<td class="c big" dir="ltr" style="white-space:nowrap">' + esc(plainPhone(t.whatsapp)) + '</td><td class="c" style="color:#7d8597">—</td>' +
        '<td class="c" style="white-space:nowrap' + (paid || ex ? ';font-weight:700' : '') + (ex ? ';color:#6d28d9' : '') + '">' + (ex ? '✓ إعفاء' : paid ? '✓ مدفوع' : '') + '</td></tr>';
    }).join('');
    return { n: riders.length, paid: paidN, exempt: exemptN, html: rows ? '<tr><td colspan="7" style="background:#eef2f7;font-weight:700">الموظفون (' + riders.length + ')</td></tr>' + rows : '' };
  }

  // المتأخرون من الموظفين: في باص ولم يصدر لهم إيصال عن الدورة بعد موعد السداد
  function staffLateRows() {
    if (S.staffTMissing || todayISO() <= payDeadline(ui.tMonth)) return [];
    var out = [];
    S.tGroups.forEach(function (g) {
      staffRiders(g).forEach(function (m) { if (!exemptIn(m, ui.tMonth) && !(staffPaid(m.staff_id) > 0)) out.push({ t: find(m.staff_id), g: g, m: m }); });
    });
    return out.sort(function (a, b) { return a.g.assembly_point.localeCompare(b.g.assembly_point, 'ar') || a.t.name.localeCompare(b.t.name, 'ar'); });
  }

  function staffLateHtml() {
    var rows = staffLateRows();
    if (!rows.length) return '';
    return '<div class="card"><h2 style="margin:0 0 8px">موظفون لم يسددوا اشتراك ' + tLabel(ui.tMonth) + ' (' + rows.length + ')</h2>' +
      '<div class="table-wrap"><table class="grid pay"><thead><tr><th>م</th><th>الموظف</th><th>الباص</th><th>الجوال</th><th class="no-print"></th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        return '<tr><td>' + (i + 1) + '</td><td class="who"><b>' + esc(r.t.name) + '</b><br><span class="meta" style="font-size:.85rem">' + staffMeta(r.t) + '</span></td><td>' + esc(r.g.assembly_point) + '</td>' +
          '<td dir="ltr" style="text-align:right;white-space:nowrap">' + esc(plainPhone(r.t.whatsapp) || '—') + '</td>' +
          '<td class="no-print">' + (isAdmin() ? '<button type="button" class="btn" data-sdesk="' + r.t.id + '">إصدار إيصال</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  // «دفعات الطلاب»: بطاقة مستقلة لإيصالات الموظفين عن الدورة، بمجموعها وحده
  function staffPayCardHtml() {
    if (S.staffTMissing || ui.tpClass) return '';
    var list = [];
    S.tGroups.forEach(function (g) { staffRiders(g).forEach(function (m) { list.push({ t: find(m.staff_id), g: g }); }); });
    // من دفع عن الدورة وأُزيل من الباص بعدها يبقى ظاهرًا بإيصاله
    S.sPay.forEach(function (p) {
      if (p.month === ui.tMonth && !p.voided_at && !list.some(function (r) { return r.t && r.t.id === p.staff_id; })) list.push({ t: find(p.staff_id) || { id: p.staff_id, name: p.staff_name }, g: null });
    });
    if (!list.length) return '';
    var sum = 0, n = 0, ex = 0;
    var rows = list.map(function (r, i) {
      var recs = staffReceipts(r.t.id), paid = staffPaid(r.t.id), exempt = staffExempt(r.t.id);
      sum += paid; if (paid > 0) n++; if (exempt) ex++;
      return '<tr><td>' + (i + 1) + '</td><td class="who"><b>' + esc(r.t.name) + '</b></td><td>' + esc(r.g ? r.g.assembly_point : '—') + '</td>' +
        '<td>' + (paid > 0 ? '<b>' + plainNum(paid) + '</b>' + (exempt ? ' <span class="badge exempt">إعفاء</span>' : '') : exempt ? '<span class="badge exempt">مدفوع (إعفاء)</span>' : '<span class="badge unpaid">لم يسدد</span>') + '</td>' +
        '<td style="font-size:.85rem">' + recs.map(function (p) { return p.receipt_no + ' · ' + esc(PAY_METHODS[p.method] || '') + ' · ' + dmy(p.paid_on); }).join('<br>') + '</td>' +
        '<td class="no-print">' + (isAdmin() ? '<button type="button" class="btn" data-sdesk="' + r.t.id + '">إيصال</button>' : '') + '</td></tr>';
    }).join('');
    return '<div class="card"><h2 style="margin:0 0 8px">إيصالات الموظفين — ' + tLabel(ui.tMonth) + '</h2>' +
      '<p class="st-count" style="margin:0 0 8px">المحصَّل من الموظفين: <b>' + money(sum) + '</b> من ' + n + ' موظفًا' + (ex ? ' · المعفون: <b style="color:#6d28d9">' + ex + '</b> (خارج المحصَّل)' : '') + ' · خارج مجموع اشتراكات الطلاب أعلاه</p>' +
      '<div class="table-wrap"><table class="grid pay"><thead><tr><th>م</th><th>الموظف</th><th>الباص</th><th>المدفوع (ج.م)</th><th>الإيصالات</th><th class="no-print"></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  // سجل الدفعات: إيصالات الموظفين السارية في الفترة، بشعبة «موظفون»
  function staffLedgerRows(from, to) {
    var nets = {};
    return S.sPay.filter(function (p) { var d = String(p.paid_on || '').slice(0, 10); return !p.voided_at && d >= from && d <= to; }).map(function (p) {
      var k = p.staff_id + '|' + p.month;
      if (!nets[k]) nets[k] = staffNetOfReceipts(p.staff_id, p.month);
      var m = staffMember(p.staff_id), g = m && findGroup(m.group_id), t = find(p.staff_id);
      return { p: p, x: null, staff: true, name: t ? t.name : p.staff_name, cls: 'موظفون', bus: g ? g.assembly_point : '', amount: nets[k][p.receipt_no],
        method: PAY_METHODS[p.method] ? p.method : 'cash', ref: p.method_note || '', who: p.issued_by || '', day: String(p.paid_on || '').slice(0, 10) };
    }).filter(function (r) { return r.amount > 0; });
  }

  document.addEventListener('click', async function (e) {
    if (!canView() || !/^#\/transport/.test(location.hash)) return;
    var el, r, g = currentGroup();
    if ((el = e.target.closest('[data-sdesk]'))) {
      ui.rcStaff = el.getAttribute('data-sdesk');
      ui.rcStudent = null;
      ui.rcRefund = false;
      ui.rcQuery = (find(ui.rcStaff) || {}).name || '';
      ui.rcMethod = '';
      return go('#/transport/receipt');
    }
    if ((el = e.target.closest('[data-rcstaff]'))) {
      ui.rcStaff = el.getAttribute('data-rcstaff');
      ui.rcStudent = null;
      ui.rcMethod = '';
      ui.rcRefund = false;
      document.getElementById('rc-body').innerHTML = deskBodyHtml();
      var amt = document.getElementById('rc-amount');
      if (amt) amt.focus();
      return;
    }
    if ((el = e.target.closest('[data-sprint]'))) {
      pendingReceipt = { staff: true, no: el.getAttribute('data-sprint') };
      return printNow();
    }
    if (!isAdmin()) return;
    if ((el = e.target.closest('[data-svoid]'))) return staffVoid(el.getAttribute('data-svoid'));
    if ((el = e.target.closest('[data-sexempt]'))) {
      ui.exemptFor = 's:' + el.getAttribute('data-sexempt');
      render();
      window.scrollTo(0, 0);
      return;
    }
    if ((el = e.target.closest('[data-sjoin]'))) {
      var gid = (document.getElementById('rc-sgroup') || {}).value;
      if (!gid) return toast('اختر الباص أولًا.', true);
      await staffJoin(el.getAttribute('data-sjoin'), gid);
      document.getElementById('rc-body').innerHTML = deskBodyHtml();
      return;
    }
    if (g && (el = e.target.closest('[data-sadd]'))) {
      await staffJoin(el.getAttribute('data-sadd'), g.id);
      ui.tsSearch = '';
      return render();
    }
    if (g && (el = e.target.closest('[data-sdel]'))) {
      var t = find(el.getAttribute('data-sdel'));
      if (!t || !confirm('إزالة «' + t.name + '» من الباص؟ تبقى إيصالاته محفوظة.')) return;
      r = await sb.from('transport_staff_members').delete().eq('staff_id', t.id);
      if (r.error) return fail(r.error);
      S.sMembers = S.sMembers.filter(function (m) { return m.staff_id !== t.id; });
      return render();
    }
  });

  document.addEventListener('change', async function (e) {
    if (!isAdmin() || !/^#\/transport/.test(location.hash)) return;
    var el = e.target;
    if (el.hasAttribute('data-spickup')) {
      var id = el.getAttribute('data-spickup'), v = el.value.trim();
      var r = await sb.from('transport_staff_members').update({ pickup: v }).eq('staff_id', id);
      if (r.error) return fail(r.error);
      var m = staffMember(id);
      if (m) m.pickup = v;
      toast('تم الحفظ');
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id !== 'ts-search') return;
    ui.tsSearch = e.target.value;
    var g = currentGroup(), box = document.getElementById('ts-cands');
    if (!g || !box) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = staffBusCardHtml(g);
    var fresh = tmp.querySelector('#ts-cands');
    if (fresh) box.innerHTML = fresh.innerHTML;
  });

  /* ----- دفعات المواصلات: كل مشترك مع حصته وما دفعه في الشهر المعروض ----- */

  var PAY_STATUS = { paid: 'مدفوع', exempt: 'مدفوع (إعفاء)', part: 'جزئي', unpaid: 'غير مدفوع' };

  function plainNum(v) {
    return (Math.round(v * 100) / 100).toLocaleString('en');
  }

  // ترتيب الشعب كما عُرّفت في الإعدادات؛ غير المعرّفة في الآخر
  function classRank(name) {
    var i = schoolClasses().indexOf(name);
    return i < 0 ? 9999 : i;
  }

  function payRows() {
    var pay = S.tPay[ui.tMonth] || {};
    return S.tMembers.map(function (m) {
      var x = findStudent(m.student_id), g = findGroup(m.group_id);
      if (!x || !g || !owesThisMonth(m)) return null;
      var rec = pay[x.id] || {}, share = shareOf(m, g), paid = rec.amount || 0, ex = exemptIn(m, ui.tMonth);
      // المعفى: يظهر مسدَّدًا (بلون مختلف)، ولا يدخل اشتراكه في المطلوب
      return { x: x, g: g, rec: rec, share: share, paid: paid, left: ex ? 0 : Math.max(0, share - paid), exempt: ex,
        status: ex ? 'exempt' : share > 0 && paid >= share ? 'paid' : paid > 0 ? 'part' : share > 0 ? 'unpaid' : 'none' };
    }).filter(Boolean).sort(function (a, b) {
      return classRank(a.x.class_name) - classRank(b.x.class_name) || String(a.x.class_name).localeCompare(b.x.class_name, 'ar') ||
        a.x.full_name.localeCompare(b.x.full_name, 'ar');
    });
  }

  // تصفية شاشة «دفعات الطلاب»: الشعبة والبحث، ثم الحالة (anyStatus: تُتجاهل الحالة لحساب أعداد كل حالة)
  function payFiltered(rows, anyStatus) {
    var q = norm(ui.tpSearch), cls = ui.tpClass;
    return rows.filter(function (r) {
      if (cls === '-' ? r.x.class_name : cls && r.x.class_name !== cls) return false;
      if (!anyStatus && ui.tpStatus && r.status !== ui.tpStatus) return false;
      return !q || norm(r.x.full_name + ' ' + r.g.assembly_point).indexOf(q) > -1;
    });
  }

  function payTotals(rows) {
    // by / byCount: المحصَّل وعدد الدفعات لكل وسيلة دفع
    var t = { n: rows.length, due: 0, paid: 0, left: 0, owing: 0, exempt: 0, by: {}, byCount: {} };
    Object.keys(PAY_METHODS).forEach(function (k) { t.by[k] = 0; t.byCount[k] = 0; });
    rows.forEach(function (r) {
      // المعفى خارج الحساب كله: لا في المشتركين المطالَبين ولا المطلوب ولا المحصَّل
      if (r.exempt) { t.exempt++; t.n--; return; }
      t.due += r.share; t.paid += r.paid; t.left += r.left;
      if (r.left > 0) t.owing++;
      if (r.paid > 0) payParts(r.x.id, r.paid).forEach(function (p) { t.by[p.method] += p.amount; t.byCount[p.method]++; });
    });
    return t;
  }

  // شريط تفصيل المحصَّل حسب وسيلة الدفع (للشاشات)
  function methodStripHtml(t) {
    return '<div class="method-strip"><b>تفصيل المحصَّل:</b>' + Object.keys(PAY_METHODS).map(function (k) {
      return '<span' + (t.by[k] ? '' : ' class="zero"') + '>' + PAY_METHODS[k] + ' <b>' + plainNum(t.by[k]) + '</b> ج.م' + (t.byCount[k] ? ' (' + t.byCount[k] + ')' : '') + '</span>';
    }).join('') + (function () {
      var back = (S.tRefunds || []).filter(function (v) { return v.month === ui.tMonth; });
      return back.length ? '<span class="refunded">مستردات الشهر <b>' + plainNum(refundTotal(back)) + '</b> ج.م (' + back.length + ')</span>' : '';
    })() + '</div>';
  }

  // النص نفسه للتقارير المطبوعة
  function methodLine(t) {
    return Object.keys(PAY_METHODS).map(function (k) { return PAY_METHODS[k] + ': ' + plainNum(t.by[k]) + (t.byCount[k] ? ' (' + t.byCount[k] + ')' : ''); }).join(' · ');
  }

  // مجموع كل شعبة، بترتيب الشعب
  function payByClass(rows) {
    var map = {}, list = [];
    rows.forEach(function (r) {
      var name = r.x.class_name || '';
      if (!map[name]) list.push(map[name] = { name: name, rows: [] });
      map[name].rows.push(r);
    });
    list.forEach(function (c) { c.t = payTotals(c.rows); });
    return list;
  }

  // ما يُصدَّر أو يُطبع الآن: مجموعة بعينها، أو ما تعرضه شاشة الدفعات بتصفيتها، أو المدرسة كلها
  function payScope() {
    var g = currentGroup(), all = payRows(), info = [['الشهر', tLabel(ui.tMonth)]];
    if (g) {
      info.push(['الباص', g.assembly_point]);
      return { rows: all.filter(function (r) { return r.g === g; }), info: info, name: g.assembly_point, group: g };
    }
    if (location.hash !== '#/transport/payments') return { rows: all, info: info.concat([['النطاق', 'كل المدرسة']]), name: 'كل المدرسة', whole: true };
    var cls = ui.tpClass, name = cls === '-' ? 'بدون شعبة' : cls || 'كل المدرسة';
    info.push(cls ? ['الشعبة', name] : ['النطاق', name]);
    if (ui.tpStatus) info.push(['الحالة', PAY_STATUS[ui.tpStatus]]);
    if (ui.tpSearch.trim()) info.push(['بحث', ui.tpSearch.trim()]);
    return { rows: payFiltered(all), info: info, name: name + (ui.tpStatus ? ' - ' + PAY_STATUS[ui.tpStatus] : ''),
      oneClass: !!cls, whole: !cls && !ui.tpStatus && !ui.tpSearch.trim() };
  }

  /* ----- تقرير الباصات -----
     لكل باص (خط سيره من اسمه) في الدورة المعروضة: عدد الطلاب المطالَبين، والمسددون كاملًا، وغير المسددين (ومنهم من دفع جزءًا)،
     والمعفون، وإجمالي ما سُدّد والمتبقي. من payRows نفسها التي تبني «دفعات الطلاب» فتتطابق الأرقام */
  function busReportData() {
    var by = {}, inRows = {};
    var box = function (g) { return by[g.id] || (by[g.id] = { g: g, n: 0, paid: 0, unpaid: 0, part: 0, notStarted: 0, exempt: 0, sum: 0, due: 0, left: 0 }); };
    payRows().forEach(function (r) {
      var b = box(r.g);
      inRows[r.x.id] = 1;
      b.n++;
      if (r.status === 'paid') b.paid++;
      else if (r.status === 'exempt') b.exempt++;
      else if (r.status === 'part') { b.unpaid++; b.part++; }
      else b.unpaid++;
      b.sum += r.paid;
      if (!r.exempt) b.due += r.share;
      b.left += r.left;
    });
    // من في الباص ولم يدفع أي اشتراك بعد (اختيرت له نقطة التجمع فقط): لا يُطالَب في الشاشات الأخرى، لكنه في الباص وغير مسدِّد
    S.tMembers.forEach(function (m) {
      var x = findStudent(m.student_id), g = findGroup(m.group_id);
      if (!x || !g || inRows[x.id] || !subscribedIn(m, ui.tMonth)) return;
      var b = box(g), share = shareOf(m);
      b.n++; b.unpaid++; b.notStarted++; b.due += share; b.left += share;
    });
    // بترتيب رقم الباص، ثم الاسم (الباص بلا رقم آخرًا)
    var rows = S.tGroups.slice().sort(function (a, b) {
      return (a.bus_no == null ? 1e9 : a.bus_no) - (b.bus_no == null ? 1e9 : b.bus_no) || String(a.assembly_point).localeCompare(String(b.assembly_point), 'ar', { numeric: true });
    })
      .map(function (g) { return by[g.id] || { g: g, n: 0, paid: 0, unpaid: 0, part: 0, notStarted: 0, exempt: 0, sum: 0, due: 0, left: 0 }; });
    var t = { n: 0, paid: 0, unpaid: 0, part: 0, notStarted: 0, exempt: 0, sum: 0, due: 0, left: 0 };
    rows.forEach(function (b) { Object.keys(t).forEach(function (k) { t[k] += b[k]; }); });
    // الموظفون (معلمون وغيرهم) المعفون من اشتراك الدورة: يُعدّون منفصلين عن الطلاب ويُميَّزون في التقرير
    t.exemptStaff = 0;
    rows.forEach(function (b) {
      b.exemptStaffNames = S.staffTMissing ? [] : staffRiders(b.g).filter(function (m) { return staffExempt(m.staff_id); }).map(function (m) { return find(m.staff_id).name; });
      t.exemptStaff += b.exemptStaffNames.length;
    });
    return { rows: rows, t: t };
  }

  // رقم الباص (المحفوظ، وإلا ترتيبه في التقرير)، والمنطقة، وخط السير مع اسم الباص، والمشرف
  function busNo(b, i) { return b.g.bus_no != null ? b.g.bus_no : i + 1; }
  function busRouteText(g) { return [g.assembly_point, g.route].filter(Boolean).join(' — '); }

  // خانة «المعفون»: الطلاب أولًا، ثم الموظفون المعفون بلون وتسمية مختلفين
  function busExemptCell(b, print) {
    var st = b.exempt ? (print ? '<b>' + b.exempt + '</b>' : '<b style="color:#6d28d9">' + b.exempt + '</b>') : 0;
    var staff = b.exemptStaffNames && b.exemptStaffNames.length
      ? '<div style="' + (print ? 'font-size:.78em;' : 'font-size:.8rem;color:#6d28d9;') + 'margin-top:2px"><b>موظفون: ' + b.exemptStaffNames.length + '</b> (' + b.exemptStaffNames.map(esc).join('، ') + ')</div>' : '';
    return st + staff;
  }

  function busReportHtml() {
    var D = busReportData(), c = function (v, b) { return '<td class="c">' + (b ? '<b>' + v + '</b>' : v) + '</td>'; };
    var line = function (b, i) {
      return '<tr>' + c(busNo(b, i), true) +
        '<td><b>' + esc(b.g.assembly_point) + '</b>' + (b.g.route ? '<div class="hint" style="margin:2px 0 0">' + esc(b.g.route) + '</div>' : '') + '</td>' +
        '<td>' + esc(b.g.supervisor_name || '—') + (b.g.supervisor_phone ? '<div class="hint" style="margin:0" dir="ltr">' + esc(b.g.supervisor_phone) + '</div>' : '') + '</td>' +
        c(b.n) + c(b.paid) +
        '<td class="c">' + (b.unpaid ? '<b style="color:var(--red)">' + b.unpaid + '</b>' : 0) +
          (b.part ? '<div class="hint" style="margin:0">منهم سدّد جزءًا ' + b.part + '</div>' : '') + (b.notStarted ? '<div class="hint" style="margin:0">منهم لم يدفع أي اشتراك بعد ' + b.notStarted + '</div>' : '') + '</td>' +
        c(busExemptCell(b)) + c(plainNum(b.sum), true) + c(b.left ? plainNum(b.left) : '') + '</tr>';
    };
    return '<div class="card"><div class="toolbar" style="align-items:center;margin:0 0 8px"><h2 style="margin:0;flex:1">تقرير الباصات — ' + tLabel(ui.tMonth) + '</h2>' +
        '<button type="button" class="btn" data-busrep="xlsx" data-ro-ok>تصدير Excel</button><button type="button" class="btn" data-busrep="pdf" data-ro-ok>طباعة / PDF</button></div>' +
      (S.routeMissing ? '<p class="formhint">لإضافة خط السير ورقم الباص شغّل الملف <code dir="ltr">supabase/transport_buses.sql</code> في محرر SQL ثم حدّث الصفحة، ثم أدخلها من «تعديل» كل باص.</p>' : '') +
      (D.rows.length
        ? '<div class="table-wrap"><table class="grid"><thead><tr><th>رقم الباص</th><th>خط السير</th><th>المشرف</th><th>عدد الطلاب</th><th>المسددون</th><th>غير المسددين</th><th>المعفون</th><th>إجمالي السداد (ج.م)</th><th>المتبقي (ج.م)</th></tr></thead><tbody>' +
            D.rows.map(line).join('') +
            '<tr class="total"><td colspan="3"><b>المجموع</b></td>' + c(D.t.n, true) + c(D.t.paid, true) + c(D.t.unpaid, true) + c(D.t.exempt + (D.t.exemptStaff ? '<div style="font-size:.8rem;color:#6d28d9">+ ' + D.t.exemptStaff + ' موظف</div>' : ''), true) + c(plainNum(D.t.sum), true) + c(plainNum(D.t.left), true) + '</tr></tbody></table></div>' +
          '<p class="hint" style="margin:8px 0 0">عدد الطلاب: كل المشتركين في الباص في هذه الدورة (عدا من أُوقف اشتراكه). المسددون: من سدّد اشتراكه كاملًا. غير المسددين: من لم يسدد أو سدّد جزءًا، ومنهم من لم يدفع أي اشتراك بعد. المعفون: معفون من اشتراك هذه الدورة، لا يُطالَبون، ويظهر تحت عددهم من الموظفين (المعلمين وغيرهم) المعفين في الباص بلون وتسمية مختلفين. ' +
            'خط السير والمشرف من «تعديل» كل باص في صفحة الباصات.</p>'
        : '<div class="empty">لا توجد باصات بعد.</div>') + '</div>';
  }

  async function busReportXlsx() {
    var D = busReportData();
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new(), used = {};
      wb.Workbook = { Views: [{ RTL: true }] };
      xlsxSheet(wb, used, 'تقرير الباصات', [[schoolName()], ['تقرير الباصات — ' + tLabel(ui.tMonth)], [],
        ['رقم الباص', 'اسم الباص', 'خط السير', 'المشرف', 'هاتف المشرف', 'عدد الطلاب', 'المسددون', 'غير المسددين', 'منهم سدّد جزءًا', 'منهم لم يدفع بعد', 'المعفون (طلاب)', 'المعفون (موظفون)', 'أسماء الموظفين المعفين', 'إجمالي السداد (ج.م)', 'المتبقي (ج.م)']].concat(
        D.rows.map(function (b, i) { return [busNo(b, i), b.g.assembly_point, b.g.route || '', b.g.supervisor_name || '', b.g.supervisor_phone || '', b.n, b.paid, b.unpaid, b.part, b.notStarted, b.exempt, b.exemptStaffNames.length, b.exemptStaffNames.join('، '), b.sum, b.left]; }),
        [['', 'المجموع', '', '', '', D.t.n, D.t.paid, D.t.unpaid, D.t.part, D.t.notStarted, D.t.exempt, D.t.exemptStaff, '', D.t.sum, D.t.left]]), [9, 28, 50, 24, 15, 11, 11, 13, 14, 15, 14, 14, 36, 18, 14]);
      XLSX.writeFile(wb, 'تقرير-الباصات-' + ui.tMonth + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  // PDF: صفحة أفقية (الأعمدة كثيرة وخط السير طويل)، في صفحة واحدة
  var pendingBusRep = false;
  function buildBusRepSheet() {
    var D = busReportData(), c = function (v, b) { return '<td class="c">' + (b ? '<b>' + v + '</b>' : v) + '</td>'; }, n = 9;
    printLandscape = true;
    var head = reportHead('تقرير الباصات', [['الدورة', tLabel(ui.tMonth)], ['عدد الباصات', D.rows.length], ['عدد الطلاب', D.t.n], ['إجمالي السداد', money(D.t.sum)]]).replace(/^<img class="wm"[^>]*>/, '');
    sheet.className = 'ls bus-rep';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.style.width = '267mm';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
      '<table class="rz"><thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>' +
      '<tr><th>رقم<br>الباص</th><th>خط السير</th><th>المشرف</th><th>عدد<br>الطلاب</th><th>المسددون</th><th>غير<br>المسددين</th><th>المعفون</th><th>إجمالي السداد<br>(ج.م)</th><th>المتبقي<br>(ج.م)</th></tr></thead><tbody>' +
      D.rows.map(function (b, i) {
        return '<tr>' + c(busNo(b, i), true) +
          '<td><b>' + esc(b.g.assembly_point) + '</b>' + (b.g.route ? '<br><span style="font-size:.85em">' + esc(b.g.route) + '</span>' : '') + '</td>' +
          '<td>' + esc(b.g.supervisor_name || '') + (b.g.supervisor_phone ? '<br><span style="font-size:.85em" dir="ltr">' + esc(b.g.supervisor_phone) + '</span>' : '') + '</td>' +
          c(b.n) + c(b.paid) + c(b.unpaid + (b.part ? ' <small>(جزئي ' + b.part + ')</small>' : '') + (b.notStarted ? ' <small>(لم يدفع بعد ' + b.notStarted + ')</small>' : '')) +
          c(busExemptCell(b, true)) + c(plainNum(b.sum), true) + c(b.left ? plainNum(b.left) : '') + '</tr>';
      }).join('') +
      '<tr class="total"><td colspan="3">المجموع</td>' + c(D.t.n) + c(D.t.paid) + c(D.t.unpaid) + c(D.t.exempt + (D.t.exemptStaff ? ' <small>(+ ' + D.t.exemptStaff + ' موظف)</small>' : '')) + c(plainNum(D.t.sum), true) + c(plainNum(D.t.left)) + '</tr></tbody>' +
      '<tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>' +
      reportSigns([['مسؤول المواصلات', ''], ['مدير الأكاديمية', principalName()]]);
  }

  document.addEventListener('click', function (e) {
    if (location.hash !== '#/transport/buses' || !canTransport()) return;
    var el = e.target.closest('[data-busrep]');
    if (!el) return;
    if (el.getAttribute('data-busrep') === 'xlsx') return busReportXlsx();
    pendingBusRep = true;
    printNow();
  });

  /* ----- المسددون وغير المسددين (مع الباص والعنوان) -----
     تقرير إضافي في المواصلات للدورة المعروضة: المشتركون في الباصات مقسَّمين إلى مسددين، وغير مسددين (ومنهم من سدّد جزءًا أو لم يبدأ اشتراكه)، ومعفين،
     لكلٍّ باصه وعنوانه وهاتف ولي أمره والمطلوب والمدفوع والمتبقي؛ يُصفّى بالباص والشعبة والحالة، ويُطبع ويُصدَّر Excel */
  function tsUi() { return ui.ts || (ui.ts = { view: '', bus: '', cls: '' }); }
  var pendingTs = false;

  function tsRows() {
    var rows = payRows().map(function (r) {
      return { x: r.x, g: r.g, share: r.share, paid: r.paid, left: r.left, st: r.status === 'paid' ? 'paid' : r.status === 'exempt' ? 'exempt' : 'unpaid', part: r.status === 'part', notStarted: false };
    }), seen = {};
    rows.forEach(function (r) { seen[r.x.id] = 1; });
    // في الباص ولم يدفع أي اشتراك بعد: غير مسدِّد
    S.tMembers.forEach(function (m) {
      var x = findStudent(m.student_id), g = findGroup(m.group_id);
      if (!x || !g || seen[x.id] || !subscribedIn(m, ui.tMonth)) return;
      var sh = shareOf(m);
      rows.push({ x: x, g: g, share: sh, paid: 0, left: sh, st: 'unpaid', part: false, notStarted: true });
    });
    var u = tsUi();
    return rows.filter(function (r) { return (!u.bus || r.g.id === u.bus) && (!u.cls || r.x.class_name === u.cls); }).sort(function (a, b) {
      return (a.g.bus_no == null ? 1e9 : a.g.bus_no) - (b.g.bus_no == null ? 1e9 : b.g.bus_no) || String(a.g.assembly_point).localeCompare(String(b.g.assembly_point), 'ar', { numeric: true }) ||
        classRank(a.x.class_name) - classRank(b.x.class_name) || a.x.full_name.localeCompare(b.x.full_name, 'ar');
    });
  }
  function tsSections() {
    var u = tsUi(), rows = tsRows(), pick = function (k) { return rows.filter(function (r) { return r.st === k; }); };
    var out = [];
    if (u.view !== 'unpaid') out.push({ key: 'paid', title: 'المسددون', list: pick('paid') });
    if (u.view !== 'paid') out.push({ key: 'unpaid', title: 'غير المسددين', list: pick('unpaid') });
    if (!u.view) out.push({ key: 'exempt', title: 'المعفون', list: pick('exempt') });
    return out.filter(function (sec) { return sec.list.length || sec.key !== 'exempt'; });
  }
  function tsCols(r) {
    return [r.x.full_name + rsvText(r.x), r.x.class_name || '', r.g.assembly_point, addressWithNeighborhood(r.x) || '', plainPhone(r.x.phone) || '', r.share, r.paid, r.left];
  }
  function tsStatusText(r) { return r.notStarted ? 'لم يدفع بعد' : r.part ? 'سدّد جزءًا' : ''; }

  function tsHtml() {
    var u = tsUi(), secs = tsSections(), tot = function (l, k) { return l.reduce(function (t, r) { return t + (r.exempt ? 0 : r[k]); }, 0); };
    var busOpts = S.tGroups.slice().sort(function (a, b) { return String(a.assembly_point).localeCompare(String(b.assembly_point), 'ar', { numeric: true }); });
    var head = '<div class="card"><div class="toolbar" style="align-items:center;margin:0"><h2 style="margin:0;flex:1">المسددون وغير المسددين — ' + tLabel(ui.tMonth) + '</h2>' +
      '<select id="ts-view" aria-label="الحالة" style="width:auto">' + afOpts([['', 'الكل'], ['paid', 'المسددون فقط'], ['unpaid', 'غير المسددين فقط']], u.view) + '</select>' +
      '<select id="ts-bus" aria-label="الباص" style="width:auto;max-width:240px"><option value="">كل الباصات</option>' + busOpts.map(function (g) { return '<option value="' + g.id + '"' + (u.bus === g.id ? ' selected' : '') + '>' + esc(g.assembly_point) + '</option>'; }).join('') + '</select>' +
      '<select id="ts-cls" aria-label="الشعبة" style="width:auto"><option value="">كل الشعب</option>' + attClasses().map(function (n) { return '<option' + (n === u.cls ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="btn" data-tsprint data-ro-ok>طباعة / PDF</button><button type="button" class="btn" data-tsxlsx data-ro-ok>تصدير Excel</button></div></div>';
    return head + secs.map(function (sec) {
      var l = sec.list;
      return '<div class="card"><h2>' + sec.title + ' (' + l.length + ')' + (sec.key === 'exempt' ? '' : ' <span class="meta" style="font-weight:400;font-size:.9rem">— المدفوع ' + plainNum(tot(l, 'paid')) + ' · المتبقي ' + plainNum(tot(l, 'left')) + ' ج.م</span>') + '</h2>' +
        (l.length ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الطالب</th><th>الشعبة</th><th>الباص</th><th>العنوان</th><th>واتساب ولي الأمر</th><th>المطلوب</th><th>المدفوع</th><th>المتبقي</th></tr></thead><tbody>' +
          l.map(function (r, i) {
            var c = tsCols(r), note = tsStatusText(r);
            return '<tr><td>' + (i + 1) + '</td><td class="who"><b>' + esc(r.x.full_name) + '</b>' + rsvMark(r.x) + (note ? '<br><span class="meta" style="font-size:.85rem">' + note + '</span>' : '') + '</td><td>' + esc(c[1]) + '</td><td>' + esc(c[2]) + '</td><td>' + esc(c[3]) + '</td>' +
              '<td dir="ltr" style="text-align:right;white-space:nowrap">' + esc(c[4] || '—') + '</td><td>' + plainNum(c[5]) + '</td><td>' + plainNum(c[6]) + '</td><td>' + (c[7] ? '<b style="color:var(--red)">' + plainNum(c[7]) + '</b>' : 0) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">لا أحد.</div>') + '</div>';
    }).join('');
  }

  function buildTransportStatusSheet() {
    var secs = tsSections(), u = tsUi(), n = 9, g = u.bus ? findGroup(u.bus) : null, all = secs.reduce(function (t, sec) { return t + sec.list.length; }, 0);
    var info = [['الدورة', tLabel(ui.tMonth)], ['عدد الطلاب', all]].concat(g ? [['الباص', g.assembly_point]] : [], u.cls ? [['الشعبة', u.cls]] : [], u.view ? [['الحالة', u.view === 'paid' ? 'المسددون فقط' : 'غير المسددين فقط']] : []);
    var head = reportHead('المسددون وغير المسددين في المواصلات', info).replace(/^<img class="wm"[^>]*>/, '');
    var body = secs.map(function (sec) {
      return '<tr><td class="bf-sec" style="background:var(--navy);color:#fff" colspan="' + n + '">' + sec.title + ' (' + sec.list.length + ')</td></tr>' + (sec.list.length ? sec.list.map(function (r, i) {
        var c = tsCols(r), note = tsStatusText(r);
        return '<tr><td class="c">' + (i + 1) + '</td><td style="white-space:nowrap"><b>' + esc(r.x.full_name) + '</b>' + rsvMark(r.x) + (note ? ' <small>(' + note + ')</small>' : '') + '</td><td class="c">' + esc(c[1]) + '</td><td>' + esc(c[2]) + '</td><td style="font-size:.9em">' + esc(c[3]) + '</td>' +
          '<td class="c" dir="ltr">' + esc(c[4]) + '</td><td class="c">' + plainNum(c[5]) + '</td><td class="c">' + plainNum(c[6]) + '</td><td class="c">' + (c[7] ? '<b>' + plainNum(c[7]) + '</b>' : 0) + '</td></tr>';
      }).join('') : '<tr><td colspan="' + n + '" class="c">—</td></tr>');
    }).join('');
    printLandscape = true;
    sheet.style.width = '267mm';
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
      '<table class="rz"><thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>' +
      '<tr><th>م</th><th>الطالب</th><th>الشعبة</th><th>الباص</th><th>العنوان</th><th>الهاتف</th><th>المطلوب</th><th>المدفوع</th><th>المتبقي</th></tr></thead><tbody>' + body + '</tbody>' +
      '<tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>' + reportSigns([['مسؤول المواصلات', ''], ['مدير الأكاديمية', principalName()]]);
  }

  async function tsXlsx() {
    var secs = tsSections();
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new(), used = {};
      wb.Workbook = { Views: [{ RTL: true }] };
      secs.forEach(function (sec) {
        xlsxSheet(wb, used, sec.title, [[schoolName()], [sec.title + ' — المواصلات — ' + tLabel(ui.tMonth)], ['العدد: ' + sec.list.length], [],
          ['م', 'الطالب', 'الشعبة', 'الباص', 'العنوان', 'هاتف ولي الأمر', 'المطلوب', 'المدفوع', 'المتبقي', 'ملاحظة']].concat(sec.list.map(function (r, i) {
          var c = tsCols(r);
          return [i + 1].concat(c, [tsStatusText(r)]);
        })), [5, 30, 12, 26, 36, 15, 10, 10, 10, 14]);
      });
      XLSX.writeFile(wb, 'المسددون-وغير-المسددين-' + ui.tMonth + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  document.addEventListener('click', function (e) {
    if (location.hash !== '#/transport/status' || !canTransport()) return;
    if (e.target.closest('[data-tsxlsx]')) return tsXlsx();
    if (e.target.closest('[data-tsprint]')) { pendingTs = true; return printNow(); }
  });
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/transport/status') return;
    var k = { 'ts-view': 'view', 'ts-bus': 'bus', 'ts-cls': 'cls' }[e.target.id];
    if (!k) return;
    tsUi()[k] = e.target.value;
    render();
  });

  // أقسام المواصلات في أربع مجموعات؛ الصف الثاني يعرض شاشات المجموعة المفتوحة فقط
  var T_NAV = [
    ['الباصات', [['groups', '#/transport', 'الباصات']]],
    ['الدفع', [['desk', '#/transport/receipt', 'إصدار إيصال'], ['pay', '#/transport/payments', 'دفعات الطلاب'], ['ledger', '#/transport/ledger', 'سجل الدفعات'], ['late', '#/transport/late', 'المتأخرون والتعليق']]],
    ['التقارير', [['busrep', '#/transport/buses', 'تقرير الباصات'], ['status', '#/transport/status', 'المسددون وغير المسددين'], ['classes', '#/transport/classes', 'ملخص الشعب'], ['refunds', '#/transport/refunds', 'المستردات'], ['archive', '#/transport/archive', 'أرشيف الإيصالات']]],
    ['الإعدادات', [['setup', '#/transport/setup', 'الدورات والرسوم']]]
  ];
  function transportNavGroup(view) { return T_NAV.filter(function (g) { return g[1].some(function (it) { return it[0] === view; }); })[0] || T_NAV[0]; }
  function transportNav(view) {
    var cur = transportNavGroup(view);
    return '<nav class="tabs" aria-label="أقسام المواصلات">' + T_NAV.map(function (g) {
      return '<button type="button" data-tgo="' + g[1][0][1] + '"' + (g === cur ? ' class="on" aria-current="true"' : '') + '>' + g[0] + '</button>';
    }).join('') + '</nav>';
  }
  function transportSubNav(view) {
    var cur = transportNavGroup(view);
    if (cur[1].length < 2) return '';
    return '<nav class="tabs sub no-print" aria-label="' + cur[0] + '">' + cur[1].map(function (it) {
      return '<button type="button" data-tgo="' + it[1] + '"' + (view === it[0] ? ' class="on" aria-current="page"' : '') + '>' + it[2] + '</button>';
    }).join('') + '</nav>';
  }

  function payStatsHtml(t, firstSub) {
    var card = function (lbl, num, sub, color) {
      return '<div class="card stat"><span class="lbl">' + lbl + '</span><span class="num"' + (color ? ' style="color:' + color + '"' : '') + '>' + num +
        '</span><span class="sub">' + sub + '</span></div>';
    };
    var cash = function (v) { return plainNum(v) + ' <small>ج.م</small>'; };
    return '<div class="stats">' +
      card('الطلاب المشتركون', t.n, firstSub || tLabel(ui.tMonth)) +
      card('المطلوب', cash(t.due), 'مجموع اشتراكات الشهر' + (t.waiting ? ' · منهم ' + t.waiting + ' في الباصات بلا إيصال بعد' : '')) +

      card('المحصَّل', cash(t.paid), 'ما دُفع حتى الآن · ' + (t.due ? Math.round(t.paid / t.due * 100) : 0) + '% من المطلوب', 'var(--green)') +
      card('المتبقي', cash(t.left), t.owing ? 'لم يسددوا كامل الاشتراك: ' + t.owing : 'لا متأخرات', t.left ? 'var(--red)' : '') +
      (t.exempt ? card('المعفون', t.exempt, 'خارج المطلوب والمحصَّل', '#6d28d9') : '') + '</div>' +
      (t.by ? methodStripHtml(t) : '');
  }

  var EXPORT_BTNS = '<button type="button" class="btn" data-tpx="xlsx">تصدير Excel</button>' +
    '<button type="button" class="btn" data-tpx="contacts">تصدير العناوين والاتصال (Excel)</button>' +
    '<button type="button" class="btn" data-tpx="pdf">تصدير PDF / طباعة</button>';

  // محتوى شاشة «دفعات الطلاب» تحت شريط التصفية: الأرقام، الحالات، الجدول
  /* مراجعة الأسر: إخوة مشتركون في الشهر المعروض لا يطابق ما دفعه أحدهم المطلوب منه، أو له حصة خاصة.
     للعثور على ما عُدِّل يدويًا وتصحيحه. يعرض ولا يغيّر شيئًا */
  function naturalShare(m) {
    if (m.share != null && m.share !== '') return Number(m.share);
    var fees = transportFees(ui.tMonth), fam = familyInfo()[m.student_id];
    return fam && fam.rank > 1 ? fees.next : fees.first;
  }

  function familyAuditHtml(all) {
    var info = familyInfo(), fams = {};
    all.forEach(function (r) {
      var f = info[r.x.id];
      if (f && f.size > 1) (fams[f.family] || (fams[f.family] = [])).push(r);
    });
    var bad = Object.keys(fams).map(function (k) {
      return fams[k].sort(function (a, b) { return info[a.x.id].rank - info[b.x.id].rank; });
    }).filter(function (list) {
      var expected = 0, shares = 0;
      list.forEach(function (r) { if (!r.exempt) { expected += naturalShare(memberOf(r.x.id)); shares += r.share; } });
      // يُراجَع أيضًا ما ثُبِّت فيه المطلوب على مجموع لا يساوي مطلوب الأسرة
      return shares !== expected || list.some(function (r) { var m = memberOf(r.x.id); return !r.exempt && ((r.paid > 0 && r.paid !== r.share) || (m && m.share != null && m.share !== '')); });
    });
    if (!bad.length) return '';
    var words = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس'];
    var two = function (n) { return ('0' + n).slice(-2); };
    var when = function (p) { var d = p && p.updated_at ? new Date(p.updated_at) : null; return d && !isNaN(d) ? two(d.getDate()) + '/' + two(d.getMonth() + 1) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) : ''; };
    return '<details class="card bank" style="border:2px solid var(--amber,#b45309)"' + (ui.famAuditOpen ? ' open' : '') + ' data-famaudit><summary><b>أسر تحتاج مراجعة (' + bad.length + ')</b> — إخوة لا يطابق ما دفعه أحدهم المطلوب منه، أو له حصة خاصة</summary>' +
      '<p class="hint" style="margin:8px 0">«المطلوب» هو ما يحسبه البرنامج الآن: الأول 700 والثاني فما بعد 600. إن كنت عدّلت المدفوع أو الحصة الخاصة يدويًا، صحّح من صف الطالب في الجدول أدناه (المدفوع، أو امسح الحصة الخاصة من صفحة الباص).</p>' +
      '<div class="table-wrap"><table class="grid"><thead><tr><th>الطالب</th><th>ترتيبه</th><th>المطلوب</th><th>حصة خاصة</th><th>المدفوع</th><th>الفرق</th><th>رقم الإيصال</th><th>آخر تعديل للدفعة</th></tr></thead><tbody>' +
      bad.map(function (list) {
        var dueT = 0, paidT = 0, paidIds = [], frozen = [], pay = S.tPay[ui.tMonth] || {};
        list.forEach(function (r) {
          if (!r.exempt) { dueT += naturalShare(memberOf(r.x.id)); paidT += r.paid; }
          if (r.paid > 0) paidIds.push(r.x.id);
          if ((pay[r.x.id] || {}).due != null) frozen.push(r.x.id);
        });
        var gap = paidT - dueT;
        var sharesT = list.reduce(function (t, r) { return t + (r.exempt ? 0 : r.share); }, 0);
        var famRow = '<tr style="border-top:3px solid var(--line);background:#F7F3EA"><td colspan="8"><b>أسرة ' + esc(familyName(list[0].x) || list[0].x.full_name) + '</b> — المطلوب للأسرة ' + plainNum(dueT) + ' · المدفوع في الإيصالات ' + plainNum(paidT) +
          (gap ? ' · <b style="color:' + (gap > 0 ? 'var(--amber,#b45309)' : 'var(--red)') + '">' + (gap > 0 ? 'زيادة ' : 'نقص ') + plainNum(Math.abs(gap)) + '</b>' : ' · <b style="color:var(--green)">المجموع مطابق (توزيع مختلف بين الإخوة)</b>') +
          '</td></tr>';
        return famRow + list.map(function (r, i) {
          var m = memberOf(r.x.id), diff = r.paid - r.share, custom = m && m.share != null && m.share !== '';
          return '<tr' + (i === 0 ? ' style="border-top:2px solid var(--line)"' : '') + '><td><b>' + esc(r.x.full_name) + '</b><br><span style="color:var(--muted);font-size:.85rem">' + esc(r.x.class_name || '') + ' · ' + esc(r.g.assembly_point) + '</span></td>' +
            '<td>' + (words[info[r.x.id].rank - 1] || info[r.x.id].rank) + '</td><td>' + (r.exempt ? 'إعفاء' : plainNum(r.share)) + '</td><td>' + (custom ? '<b>' + plainNum(Number(m.share)) + '</b>' : '—') + '</td>' +
            '<td>' + (r.paid ? plainNum(r.paid) : '—') + '</td><td>' + (r.paid && diff ? '<b style="color:' + (diff > 0 ? 'var(--amber,#b45309)' : 'var(--red)') + '">' + (diff > 0 ? '+' : '') + plainNum(diff) + '</b>' : '—') + '</td>' +
            '<td>' + (r.rec.receipt_no != null ? r.rec.receipt_no : '—') + '</td><td dir="ltr" style="text-align:right;white-space:nowrap">' + esc(when(r.rec)) + '</td></tr>';
        }).join('');
      }).join('') + '</tbody></table></div></details>';
  }

  function payBodyHtml() {
    var all = payRows(), scoped = payFiltered(all, true), rows = payFiltered(all);
    if (!all.length) return '<div class="card empty">لا يوجد طلاب مشتركون في المواصلات بعد. أضف الطلاب إلى نقاط التجمع أولًا.</div>' + awaitingListHtml() + staffPayCardHtml();
    var count = function (s) { return scoped.filter(function (r) { return r.status === s; }).length; };
    var pills = [['', 'الكل', scoped.length], ['paid', PAY_STATUS.paid, count('paid')], ['part', PAY_STATUS.part, count('part')], ['unpaid', PAY_STATUS.unpaid, count('unpaid')]];
    if (count('exempt')) pills.splice(2, 0, ['exempt', 'إعفاء', count('exempt')]);
    var t = payTotals(rows);
    var body = rows.map(function (r, i) {
      var x = r.x, rec = r.rec, method = rec.method || 'cash';
      var famNote = familyNote(x.id);
      return '<tr><td>' + (i + 1) + '</td><td class="who"><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '<br><span style="color:var(--muted);font-size:.85rem">' + esc(x.class_name || 'بدون شعبة') + (famNote ? ' · ' + famNote : '') + '</span></td>' +
        '<td class="bus"><a href="#/transport/' + r.g.id + '">' + esc(r.g.assembly_point) + '</a></td><td>' + (r.exempt ? '<span style="color:#6d28d9">إعفاء</span>' : plainNum(r.share)) + '</td>' +
        (r.exempt ? exReceiptCells(r.paid, rec) :
        receiptCells(r.paid, rec)) +
        '<td>' + (r.status === 'none' ? '—' : '<span class="badge ' + r.status + '">' + PAY_STATUS[r.status] + '</span>') +
          (r.paid ? '<br><span dir="ltr" style="color:var(--muted);font-size:.85rem">' + (issuedWhen(rec) || dmy(rec.paid_on)) + '</span>' + (rec.issued_by ? '<br><span style="color:var(--muted);font-size:.85rem">' + esc(rec.issued_by) + '</span>' : '') : '') + '</td>' +
        '<td><div class="acts">' + (r.paid > 0 ? '<button type="button" class="btn" data-mreceipt="' + x.id + '">إيصال</button> ' : '') +
        (r.left > 0 ? '<button type="button" class="btn" data-mfull="' + x.id + '">' + (r.paid > 0 ? 'إكمال الدفع (إيصال جديد)' : 'دفع كامل') + '</button> ' : '') +
        (r.paid > 0 ? '<button type="button" class="btn" data-mrefund="' + x.id + '">استرداد</button> <button type="button" class="btn danger" data-mvoid="' + x.id + '" title="حذف الإيصال (يُحفظ في الأرشيف)">حذف</button>' : '<button type="button" class="btn" data-mstop="' + x.id + '" title="إيقاف الاشتراك">إيقاف</button>') +
        ' <button type="button" class="btn" data-mexempt="' + x.id + '" data-mexemptg="' + r.g.id + '" title="إعفاء من الاشتراك لأشهر محددة">إعفاء</button></div></td></tr>';
    }).join('');
    return payStatsHtml(payTotals(scoped), ui.tpClass === '-' ? 'بدون شعبة' : ui.tpClass || 'كل المدرسة') + familyAuditHtml(all) +
      '<nav class="pills">' + pills.map(function (p) {
        return '<button type="button" data-tpstatus="' + p[0] + '"' + (ui.tpStatus === p[0] ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + p[1] + ' <b>' + p[2] + '</b></button>';
      }).join('') + '</nav>' +
      (body
        ? '<div class="card"><div class="table-wrap"><table class="grid pay"><thead><tr><th>م</th><th>الطالب</th><th>الباص</th><th>الحصة (ج.م)</th>' +
          '<th>المدفوع (ج.م)</th><th>طريقة الدفع</th><th>الحالة والتسجيل</th><th>الإجراء</th></tr></thead><tbody>' + body + '</tbody>' +
          '<tfoot><tr><td colspan="3">المجموع (' + t.n + ')</td><td>' + plainNum(t.due) + '</td><td>' + plainNum(t.paid) + '</td>' +
          '<td colspan="3">المتبقي: ' + money(t.left) + '</td></tr></tfoot></table></div></div>'
        : '<div class="card empty">لا توجد دفعات مطابقة لهذه التصفية.</div>') + awaitingListHtml() + staffPayCardHtml();
  }

  // من اختيرت لهم نقطة تجمع ولم يبدأ اشتراكهم: خارج الدفعات والمطلوب، ويبدأ اشتراك كلٍّ منهم بإصدار أول إيصال له
  function awaitingListHtml() {
    var cls = ui.tpClass, list = S.tMembers.filter(function (m) {
      var x = findStudent(m.student_id);
      return x && findGroup(m.group_id) && awaitingStart(m) && (cls === '-' ? !x.class_name : !cls || x.class_name === cls);
    }).map(function (m) { return { x: findStudent(m.student_id), g: findGroup(m.group_id) }; })
      .sort(function (a, b) { return a.x.full_name.localeCompare(b.x.full_name, 'ar'); });
    if (!list.length) return '';
    return '<details class="card bank" style="margin-top:16px"><summary>أُضيفوا إلى الباصات ولم يبدأ اشتراكهم (' + list.length + ') — لا يُطالَبون بشيء حتى يصدر لهم إيصال</summary>' +
      list.map(function (r) {
        return '<div class="cand"><span><b>' + esc(r.x.full_name) + '</b><br><span class="meta">' + esc(r.x.class_name || 'بدون شعبة') + ' · ' + esc(r.g.assembly_point) + '</span></span>' +
          '<span class="acts"><button type="button" class="btn" data-mdesk="' + r.x.id + '">إصدار إيصال</button>' +
          '<button type="button" class="btn" data-mexempt="' + r.x.id + '" data-mexemptg="' + r.g.id + '" title="إعفاء من الاشتراك لأشهر محددة">إعفاء</button></span></div>';
      }).join('') + '</details>';
  }

  // بعد حفظ دفعة: يُحدَّث الجدول المعروض (جدول المجموعة أو شاشة الدفعات) دون إعادة رسم الصفحة
  function refreshPay() {
    var g = currentGroup(), box = document.getElementById('t-members');
    if (g && box) box.innerHTML = membersTableHtml(g);
    box = document.getElementById('tp-body');
    if (box) box.innerHTML = payBodyHtml();
  }

  /* ----- إصدار إيصال: يُكتب رقم هوية الطالب فتظهر بياناته ومبلغ اشتراكه، ثم تُسجَّل الدفعة ويُطبع الإيصال ----- */

  // برقم الهوية كاملًا يُعثر على الطالب مباشرة؛ وإلا فبجزء من الرقم أو من الاسم
  function deskMatches(query) {
    var digits = latinDigits(query).replace(/[\s-]/g, ''), n = norm(query);
    if (!n) return [];
    var exact = S.students.filter(function (x) { return x.national_id && x.national_id === digits; });
    if (exact.length) return exact;
    var numeric = /^\d+$/.test(digits);
    return S.students.filter(function (x) {
      return numeric ? digits.length >= 4 && String(x.national_id || '').indexOf(digits) > -1 : norm(x.full_name).indexOf(n) > -1;
    }).slice(0, 8);
  }

  function deskStudentHtml(x) {
    var m = S.tMembers.filter(function (k) { return k.student_id === x.id; })[0], g = m && findGroup(m.group_id);
    var row = function (label, value) { return '<div><b>' + label + '</b><span>' + esc(value || '—') + '</span></div>'; };
    var head = '<div class="card"><div class="toolbar" style="align-items:center;margin-bottom:6px"><h2 style="margin:0;flex:1">' + esc(x.full_name) + '</h2>' +
      '<span class="badge ' + (stStatus(x) === 'final' ? 'published' : 'edit') + '">' + ST_STATUS[stStatus(x)] + '</span></div>' +
      '<div class="orig-answers">' + row('رقم الهوية', x.national_id) + row('الشعبة', x.class_name) + row('ولي الأمر', x.guardian_name) +
        row('هاتف ولي الأمر', x.phone || x.whatsapp) + row('الباص', g ? g.assembly_point : 'غير مشترك في المواصلات') + row('الأسرة', familyNote(x.id) || 'لا إخوة مشتركون') + '</div>';

    if (!g && !enrolled(x)) {
      return head + '<p class="formhint" style="margin-top:10px">هذا الطالب غير مشترك في المواصلات، ولا يُضاف إلى الباصات إلا بعد اعتماد تسجيله النهائي من «تسجيل الطلاب».</p></div>';
    }
    if (!g) {
      return head + '<p class="formhint" style="margin-top:10px">هذا الطالب غير مشترك في المواصلات. اختر الباص لإضافته ثم سجّل الدفعة.</p>' +
        '<div class="toolbar" style="align-items:center;margin-top:8px"><select id="rc-group" aria-label="الباص" style="width:auto;min-width:220px"><option value="">— اختر الباص —</option>' +
        S.tGroups.map(function (k) { return '<option value="' + k.id + '">' + esc(k.assembly_point) + '</option>'; }).join('') + '</select>' +
        '<button type="button" class="btn primary" data-rcjoin="' + x.id + '">إضافة إلى المواصلات</button></div></div>';
    }

    if (!owesThisMonth(m) && !subscribedIn(m, ui.tMonth)) {
      return head + '<p class="formhint" style="margin-top:10px">اشتراك هذا الطالب في المواصلات متوقف منذ ' + tLabel(m.left_from) + '، فلا يُطلب منه اشتراك ' + tLabel(ui.tMonth) + '.</p>' +
        '<div class="actions"><button type="button" class="btn primary" data-mresume="' + x.id + '" title="إعادة الاشتراك">إعادة</button></div></div>';
    }
    var rec = (S.tPay[ui.tMonth] || {})[x.id] || {}, share = shareOf(m), paid = rec.amount || 0, left = Math.max(0, share - paid);
    if (!paid) ui.rcRefund = false;
    var method = ui.rcMethod || rec.method || 'cash', ref = method === 'instapay' || method === 'vodafone';
    var notStarted = awaitingStart(m);
    // إخوته المشتركون: للانتقال إلى إيصال كلٍّ منهم
    var info = familyInfo(), mine = info[x.id], sibs = [];
    if (mine && mine.size > 1) {
      S.tMembers.forEach(function (k) {
        var other = k.student_id !== x.id && info[k.student_id] && info[k.student_id].family === mine.family ? findStudent(k.student_id) : null;
        if (other) sibs.push(other);
      });
    }
    return head +
      (exemptIn(m, ui.tMonth) ? '<p class="formhint" style="margin-top:10px;border-color:#c4b5fd;background:#f5f3ff;color:#5b21b6">هذا الطالب معفى من اشتراك ' + tLabel(ui.tMonth) + ' (' + exemptText(m) + '): يُعدّ مسدَّدًا ولا يُطلب منه شيء.</p>' : '') +
      (notStarted ? '<p class="formhint" style="margin-top:10px">لم يبدأ اشتراك هذا الطالب بعد: اختيرت له نقطة التجمع فقط. يبدأ اشتراكه من ' + tLabel(ui.tMonth) + ' عند تسجيل هذه الدفعة.</p>' : '') +
      '<div class="stats" style="margin:14px 0 6px">' +
        '<div class="card stat"><span class="lbl">اشتراك ' + tLabel(ui.tMonth) + '</span><span class="num">' + plainNum(share) + ' <small>ج.م</small></span><span class="sub">' + (m.share != null && m.share !== '' ? 'مبلغ خاص بهذا الطالب' : 'حسب رسوم الأسرة') + '</span></div>' +
        '<div class="card stat"><span class="lbl">المدفوع</span><span class="num" style="color:var(--green)">' + plainNum(paid) + ' <small>ج.م</small></span><span class="sub">' + (paid ? receiptsNote(x.id) : 'لم يُسجَّل دفع لهذا الشهر') + '</span></div>' +
        '<div class="card stat"><span class="lbl">المتبقي</span><span class="num"' + (left ? ' style="color:var(--red)"' : '') + '>' + plainNum(left) + ' <small>ج.م</small></span><span class="sub">' + (left ? 'يُسدَّد بتسجيل المبلغ كاملًا' : 'مسدَّد') + '</span></div>' +
      '</div>' +
      '<div class="grid2">' +
      (paid && Number(rec.discount) > 0 ? '<p class="formhint" style="margin:0 0 10px;border-color:#c4b5fd;background:#f5f3ff;color:#5b21b6">إيصال بتخفيض ' + money(rec.discount) + ' — السبب: ' + esc(rec.discount_reason || '—') + '</p>' : '') +
      (paid ? '<p class="formhint" style="margin:0 0 10px">صدر لهذا الشهر ' + payReceipts(x.id).map(function (p) { return 'الإيصال رقم ' + (p.receipt_no != null ? p.receipt_no : '—') + ' بمبلغ ' + money(p.amount) + ' (' + esc(PAY_METHODS[p.method]) + ')'; }).join('، و') + '. ' +
          'الإيصال المسجَّل لا يُعدَّل: للتخفيض «استرداد مبلغ»، وللتصحيح «حذف» الإيصال (يُحفظ في الأرشيف) ثم إصدار إيصال جديد.' + (left ? ' ويمكن تسجيل دفعة مكمِّلة بالمبلغ المتبقي.' : '') + '</p>' : '') +
      (paid && !left ? '' :
      '<div class="grid2">' +
        (paid
          ? (S.topupMissing
            ? '<div><label class="field" for="rc-amount">دفعة مكمِّلة الآن (ج.م)</label><input type="number" id="rc-amount" min="0" step="any" value="' + left + '">' +
                '<div class="day">تُضاف إلى الإيصال رقم ' + (rec.receipt_no != null ? rec.receipt_no : '—') + ' فيصير ' + money(paid + left) + '، بوسيلة الدفع نفسها. ليصدر لها إيصال مستقل شغّل الملف supabase/transport_topups.sql.</div></div>' +
              '<div><label class="field">طريقة الدفع</label><div style="padding:10px 0"><b>' + esc(payMethodLabel(rec)) + '</b></div></div>'
            : '<div><label class="field" for="rc-amount">دفعة مكمِّلة الآن (ج.م)</label><input type="number" id="rc-amount" min="0" step="any" value="' + left + '">' +
                '<div class="day">يصدر لها إيصال جديد برقم جديد بالمبلغ المدفوع الآن فقط، مع الباقي أو «استيفاء كامل الاشتراك»، ويبقى الإيصال السابق كما هو.</div></div>' +
              '<div><label class="field" for="rc-method">طريقة الدفع</label><select id="rc-method">' + Object.keys(PAY_METHODS).map(function (k) {
                return '<option value="' + k + '"' + (k === method ? ' selected' : '') + '>' + PAY_METHODS[k] + '</option>';
              }).join('') + '</select></div>' +
              (method === 'cash' ? '' : '<div style="grid-column:1/-1"><label class="field" for="rc-note">' + (ref ? 'رقم الدفع (' + PAY_METHODS[method] + ')' : 'حدّد طريقة الدفع') + '</label>' +
                '<input type="text" id="rc-note"' + (ref ? ' dir="ltr" inputmode="numeric" style="text-align:right"' : '') + ' value=""></div>'))
          : '<div><label class="field" for="rc-amount">المبلغ المدفوع عن الشهر (ج.م)</label><input type="number" id="rc-amount" min="0" step="any" value="' + share + '" data-share="' + share + '"></div>' +
            (S.discountMissing || S.dueMissing ? '' :
              '<div><label class="field" for="rc-disc">تخفيض (ج.م) — اختياري</label><input type="number" id="rc-disc" min="0" step="any" placeholder="0" value="">' +
                '<div class="day">يُخصم من اشتراك ' + plainNum(share) + ' ج.م، ويُحسب الإيصال دفعة كاملة لا جزئية.</div></div>' +
              '<div><label class="field" for="rc-disc-why">سبب التخفيض</label><input type="text" id="rc-disc-why" autocomplete="off" placeholder="مطلوب عند كتابة تخفيض"></div>') +
            '<div><label class="field" for="rc-method">طريقة الدفع</label><select id="rc-method">' + Object.keys(PAY_METHODS).map(function (k) {
              return '<option value="' + k + '"' + (k === method ? ' selected' : '') + '>' + PAY_METHODS[k] + '</option>';
            }).join('') + '</select></div>' +
            (method === 'cash' ? '' : '<div style="grid-column:1/-1"><label class="field" for="rc-note">' + (ref ? 'رقم الدفع (' + PAY_METHODS[method] + ')' : 'حدّد طريقة الدفع') + '</label>' +
              '<input type="text" id="rc-note"' + (ref ? ' dir="ltr" inputmode="numeric" style="text-align:right"' : '') + ' value=""></div>')) +
      '</div>') +
      '<div class="actions">' + (paid && !left ? '' : '<button type="button" class="btn primary" data-rcsave="print">' + (paid ? 'تسجيل الدفعة المكمِّلة وطباعة الإيصال' : 'تسجيل الدفعة وطباعة الإيصال') + '</button>' +
        '<button type="button" class="btn" data-rcsave="save">تسجيل دون طباعة</button>') +
        (paid ? payReceipts(x.id).map(function (p) { return '<button type="button" class="btn" data-mreceipt="' + x.id + '|' + (p.receipt_no != null ? p.receipt_no : '') + '">طباعة الإيصال رقم ' + (p.receipt_no != null ? p.receipt_no : '—') + '</button>'; }).join('') +
          '<button type="button" class="btn" data-rcrefund>استرداد مبلغ</button>' +
          '<button type="button" class="btn danger" data-mvoid="' + x.id + '" title="حذف الإيصال (يُحفظ في الأرشيف)">حذف</button>' : notStarted ? '' : '<button type="button" class="btn" data-mstop="' + x.id + '">إيقاف الاشتراك من هذا الشهر</button>') + '</div>' +
      (function () {
        var back = refundsOf(x.id, ui.tMonth);
        return back.length ? '<p class="st-count" style="margin:10px 0 0">رُدّ له عن هذا الشهر: ' + money(refundTotal(back)) + ' (' + back.length + ') — التفاصيل في «المستردات».</p>' : '';
      })() +
      (ui.rcRefund && paid ? refundFormHtml(x, paid) : '') +
      (sibs.length ? '<div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--line)"><b>إخوته المشتركون</b>' + sibs.map(function (o) {
        var om = S.tMembers.filter(function (k) { return k.student_id === o.id; })[0], op = ((S.tPay[ui.tMonth] || {})[o.id] || {}).amount || 0, os = shareOf(om);
        return '<div class="cand"><span><b>' + esc(o.full_name) + '</b><br><span class="meta">' + esc(o.class_name || 'بدون شعبة') + ' · الاشتراك ' + plainNum(os) + ' · المدفوع ' + plainNum(op) + '</span></span>' +
          '<button type="button" class="btn" data-rcpick="' + o.id + '">فتح إيصاله</button></div>';
      }).join('') + '</div>' : '') + '</div>';
  }

  // سطر إيصالات الشهر تحت «المدفوع»: رقم كل إيصال ومبلغه
  function receiptsNote(sid) {
    var recs = payReceipts(sid);
    if (recs.length < 2) { var r = (S.tPay[ui.tMonth] || {})[sid] || {}; return 'إيصال رقم ' + (r.receipt_no != null ? r.receipt_no : '—') + ' · ' + esc(issuedNote(r)); }
    return recs.map(function (p) { return 'إيصال ' + (p.receipt_no != null ? p.receipt_no : '—') + ': ' + plainNum(p.amount); }).join(' · ');
  }

  // ما تحت خانة البحث: الطالب المختار، أو قائمة المطابقين، أو رسالة
  // المعفى: لا يُحصَّل منه شيء؛ وإن صدر له إيصال في شهر إعفائه يظهر الإيصال تنبيهًا ليُحذف إن لم يُستلم المال
  function exReceiptCells(p, rec) {
    if (!(p > 0)) return '<td style="color:#6d28d9">—</td><td style="color:#6d28d9">لا يُحصَّل منه شيء</td>';
    return '<td style="color:var(--red)"><b>' + plainNum(p) + '</b></td><td><span class="badge unpaid">إيصال ' + (rec.receipt_no != null ? rec.receipt_no : '') + ' صدر رغم الإعفاء</span>' +
      '<div class="hint" style="margin:2px 0 0">إن لم يُستلم مال فاحذفه (يُحفظ في الأرشيف)</div></td>';
  }

  function deskBodyHtml() {
    var st = ui.rcStaff && find(ui.rcStaff);
    if (st) return staffDeskHtml(st);
    var x = ui.rcStudent && findStudent(ui.rcStudent);
    if (x) return deskStudentHtml(x);
    if (!ui.rcQuery.trim()) return '<div class="card empty">اكتب رقم هوية الطالب أو اسمه، أو اسم الموظف أو جواله، ثم اضغط Enter.</div>';
    var list = deskMatches(ui.rcQuery), staff = deskStaffMatches(ui.rcQuery);
    if (!list.length && !staff.length) return '<div class="card empty">لا يوجد طالب أو موظف بهذا الرقم أو الاسم.</div>';
    return '<div class="card"><h2>اختر</h2>' + list.map(function (o) {
      return '<div class="cand"><span><b>' + esc(o.full_name) + '</b><br><span class="meta" dir="ltr">' + esc(o.national_id || '') + '</span><span class="meta"> · ' + esc(o.class_name || 'بدون شعبة') + '</span></span>' +
        '<button type="button" class="btn" data-rcpick="' + o.id + '">اختيار</button></div>';
    }).join('') + staff.map(function (t) {
      return '<div class="cand"><span><b>' + esc(t.name) + '</b> <span class="badge part">موظف</span><br><span class="meta">' + staffMeta(t) + '</span></span>' +
        '<button type="button" class="btn" data-rcstaff="' + t.id + '">اختيار</button></div>';
    }).join('') + '</div>';
  }

  function deskSearch() {
    var box = document.getElementById('rc-id');
    ui.rcQuery = box.value;
    ui.rcMethod = '';
    ui.rcRefund = false;
    var list = deskMatches(ui.rcQuery), staff = deskStaffMatches(ui.rcQuery);
    ui.rcStudent = list.length === 1 && !staff.length ? list[0].id : null;
    ui.rcStaff = staff.length === 1 && !list.length ? staff[0].id : null;
    document.getElementById('rc-body').innerHTML = deskBodyHtml();
    var amount = document.getElementById('rc-amount');
    if (amount) { amount.focus(); amount.select(); }
  }

  async function deskSave(print) {
    if (ui.rcStaff) return staffSave(print);
    var x = findStudent(ui.rcStudent), amount = Number(document.getElementById('rc-amount').value);
    if (!x) return;
    if (!(amount > 0)) return toast('اكتب مبلغًا أكبر من صفر.', true);
    if (exemptIn(memberOf(x.id), ui.tMonth) && !confirm('«' + x.full_name + '» معفى من اشتراك ' + tLabel(ui.tMonth) + ' ولا يُحصَّل منه شيء.\nإصدار إيصال بمبلغ ' + money(amount) + ' رغم ذلك؟ لا تفعل إلا إن استلمت المال فعلًا.')) return;
    var prev = (S.tPay[ui.tMonth] || {})[x.id];
    // جدول الإيصالات المكمِّلة قد يكون جُهّز بعد فتح الصفحة: يُفحص من جديد قبل الدمج بالطريقة القديمة
    if (prev && prev.amount > 0 && S.topupMissing) await loadTopups(ui.tMonth);
    if (prev && prev.amount > 0 && !S.topupMissing) return deskTopup(x, prev, amount, print);
    if (prev && prev.amount > 0) {
      // قبل supabase/transport_topups.sql: الدفعة المكمِّلة تُضاف إلى الإيصال القائم بوسيلته نفسها
      amount = prev.amount + amount;
      await setPayment(x.id, { amount: amount });
    } else {
      var method = document.getElementById('rc-method').value, note = document.getElementById('rc-note');
      var patch = { amount: amount, method: method, method_note: note ? note.value.trim() : '' };
      var dEl = document.getElementById('rc-disc'), disc = dEl ? Number(dEl.value) || 0 : 0;
      if (disc > 0) {
        var why = (document.getElementById('rc-disc-why').value || '').trim(), full = shareOf(memberOf(x.id));
        if (!why) return toast('اكتب سبب التخفيض.', true);
        if (disc >= full) return toast('التخفيض يجب أن يكون أقل من اشتراك الشهر (' + plainNum(full) + ' ج.م).', true);
        patch.discount = disc; patch.discount_reason = why;
      }
      await setPayment(x.id, patch);
    }
    var rec = (S.tPay[ui.tMonth] || {})[x.id];
    if (!rec || rec.amount !== amount) return; // لم يُحفظ: ظهرت رسالة الخطأ
    ui.rcMethod = '';
    document.getElementById('rc-body').innerHTML = deskBodyHtml();
    if (print) { pendingReceipt = { sid: x.id }; printNow(); }
    // جاهز للطالب التالي
    var box = document.getElementById('rc-id');
    box.focus(); box.select();
  }

  // دفعة مكمِّلة: إيصال جديد برقم جديد بمبلغها ووسيلتها، ويُرفع مجموع الشهر؛ الإيصال الأول لا يتغير
  async function deskTopup(x, prev, add, print) {
    var method = document.getElementById('rc-method').value, note = document.getElementById('rc-note');
    var now = new Date().toISOString(), who = (S.profile && S.profile.full_name) || displayName(S.email), m = memberOf(x.id);
    var due = !S.dueMissing && prev.due != null && prev.due !== '' ? Number(prev.due) : shareOf(m);
    var row = { student_id: x.id, month: ui.tMonth, amount: add, method: method, method_note: method === 'cash' ? '' : (note ? note.value.trim() : ''),
      paid_before: prev.amount, due: due, paid_on: todayISO(), issued_by: who, issued_at: now };
    var ins = await sb.from('transport_topups').insert(row).select().single();
    if (ins.error) return fail(ins.error);
    var top = ins.data || row, total = prev.amount + add;
    var up = await sb.from('transport_payments').update({ amount: total, updated_at: now }).eq('student_id', x.id).eq('month', ui.tMonth);
    if (up.error) {
      // لم يُرفع مجموع الشهر: يُلغى الإيصال المكمِّل (إلى الأرشيف) فلا يبقى إيصال بلا أثر
      var g0 = m && findGroup(m.group_id);
      await sb.from('transport_voided').insert({ receipt_no: top.receipt_no, student_id: x.id, student_name: x.full_name, class_name: x.class_name || '', assembly_point: g0 ? g0.assembly_point : '',
        month: ui.tMonth, amount: add, method: row.method, method_note: row.method_note, paid_on: row.paid_on, reason: 'أُلغي تلقائيًا: تعذّر تحديث مجموع الشهر', voided_by: who, voided_at: now });
      await sb.from('transport_topups').delete().eq('id', top.id);
      return fail(up.error);
    }
    prev.amount = total;
    var map = S.tTop[ui.tMonth] || (S.tTop[ui.tMonth] = {});
    (map[x.id] || (map[x.id] = [])).push(top);
    ui.rcMethod = '';
    document.getElementById('rc-body').innerHTML = deskBodyHtml();
    toast('صدر إيصال الدفعة المكمِّلة رقم ' + (top.receipt_no != null ? top.receipt_no : '—') + ' بمبلغ ' + money(add));
    if (print) { pendingReceipt = { sid: x.id, no: top.receipt_no }; printNow(); }
    var box = document.getElementById('rc-id');
    box.focus(); box.select();
  }

  /* ----- حذف إيصال وأرشيف الإيصالات المحذوفة -----
     الحذف يلغي أثر الدفعة (يعود اشتراك الشهر مستحقًّا) ويحفظ نسخة من الإيصال في جدول transport_voided
     مع من حذفه ومتى ولماذا (supabase/receipt_archive.sql) */

  var ARCHIVE_SQL_MSG = 'شغّل الملف supabase/receipt_archive.sql في محرر SQL أولًا، ثم حدّث الصفحة';

  async function voidReceipt(sid) {
    if (S.archiveMissing) return toast(ARCHIVE_SQL_MSG, true);
    var x = findStudent(sid), rec = (S.tPay[ui.tMonth] || {})[sid];
    if (!x || !rec || !(rec.amount > 0)) return;
    var reason = prompt('حذف الإيصال رقم ' + (rec.receipt_no != null ? rec.receipt_no : '—') + ' للطالب «' + x.full_name + '» بمبلغ ' + money(rec.amount) + ' عن ' + tLabel(ui.tMonth) + '.\n' +
      'يُلغى أثر الدفعة ويُحفظ الإيصال في أرشيف الإيصالات.\n\nاكتب سبب الحذف:', '');
    if (reason == null) return;
    reason = reason.trim();
    if (!reason) return toast('لا يُحذف الإيصال دون كتابة السبب.', true);
    var m = S.tMembers.filter(function (k) { return k.student_id === sid; })[0], g = m && findGroup(m.group_id);
    var copy = {
      receipt_no: rec.receipt_no != null ? rec.receipt_no : null, student_id: sid, student_name: x.full_name, class_name: x.class_name || '',
      assembly_point: g ? g.assembly_point : '', month: ui.tMonth, amount: rec.amount, method: rec.method || 'cash', method_note: rec.method_note || '',
      paid_on: rec.paid_on || null, reason: reason, voided_by: (S.profile && S.profile.full_name) || displayName(S.email), voided_at: new Date().toISOString()
    };
    // الإيصالات المكمِّلة تُحذف معه، كلٌّ بنسخته في الأرشيف؛ والإيصال الأول بمبلغه هو
    var recs = payReceipts(sid), tops = recs.slice(1);
    if (tops.length) {
      if (!confirm('لهذا الشهر ' + recs.length + ' إيصالات (' + recs.map(function (p) { return p.receipt_no; }).join('، ') + '). تُحذف كلها معًا إلى الأرشيف. متابعة؟')) return;
      copy.amount = recs[0].amount;
    }
    var copies = [copy].concat(tops.map(function (p) {
      return Object.assign({}, copy, { receipt_no: p.receipt_no, amount: p.amount, method: p.method, method_note: p.method_note || '', paid_on: p.paid_on || null });
    }));
    // النسخ أولًا ثم حذف الإيصالات: إن تعذّر الحذف تُسحب النسخ فلا يبقى إيصال في المكانين
    var ins = await sb.from('transport_voided').insert(copies).select();
    if (ins.error) return fail(ins.error);
    var undo = async function () { for (var i = 0; i < (ins.data || []).length; i++) await sb.from('transport_voided').delete().eq('id', ins.data[i].id); };
    if (tops.length) {
      var dt = await sb.from('transport_topups').delete().eq('student_id', sid).eq('month', ui.tMonth);
      if (dt.error) { await undo(); return fail(dt.error); }
    }
    var del = await sb.from('transport_payments').delete().eq('student_id', sid).eq('month', ui.tMonth);
    if (del.error) {
      if (!tops.length) await undo();
      return fail(del.error);
    }
    if (S.tTop[ui.tMonth]) delete S.tTop[ui.tMonth][sid];
    delete S.tPay[ui.tMonth][sid];
    await refreshFirstPaid(sid);
    S.tVoided = null;
    refreshPay();
    var desk = document.getElementById('rc-body');
    if (desk) desk.innerHTML = deskBodyHtml();
    toast('حُذف الإيصال وحُفظ في أرشيف الإيصالات');
  }

  var loadingVoided = false;
  async function loadVoided() {
    if (loadingVoided) return;
    loadingVoided = true;
    var rows = await fetchAll(function () { return sb.from('transport_voided').select('*').order('voided_at', { ascending: false }); });
    loadingVoided = false;
    S.archiveMissing = !rows;
    S.tVoided = (rows || []).sort(function (a, b) { return String(b.voided_at).localeCompare(String(a.voided_at)); });
    render();
  }

  function archiveHtml() {
    if (S.archiveMissing) return '<div class="card empty">' + ARCHIVE_SQL_MSG + '.</div>';
    var list = S.tVoided || [], total = 0;
    if (!list.length) return '<div class="card empty">لا توجد إيصالات محذوفة.</div>';
    var rows = list.map(function (v, i) {
      total += Number(v.amount) || 0;
      return '<tr><td>' + (i + 1) + '</td><td>' + (v.receipt_no != null ? v.receipt_no : '—') + '</td><td><b>' + esc(v.student_name) + '</b><br><span style="color:var(--muted);font-size:.85rem">' +
        esc(v.class_name || 'بدون شعبة') + (v.assembly_point ? ' · ' + esc(v.assembly_point) : '') + '</span></td>' +
        '<td>' + tLabel(v.month) + '</td><td>' + plainNum(Number(v.amount) || 0) + '</td><td>' + esc(payMethodLabel(v)) + '</td><td>' + dmy(v.paid_on) + '</td>' +
        '<td>' + dmy(v.voided_at) + '</td><td>' + esc(v.voided_by) + '</td><td>' + esc(v.reason) + '</td>' +
        '<td><button type="button" class="btn" data-voidrestore="' + v.id + '"' + (v.student_id && isAdmin() ? '' : ' disabled title="' + (v.student_id ? 'للمدير العام فقط' : 'الطالب محذوف من السجلات') + '"') + '>استعادة</button></td></tr>';
    }).join('');
    return '<div class="card"><div class="toolbar" style="align-items:center"><h2 style="margin:0;flex:1">الإيصالات المحذوفة (' + list.length + ')</h2>' +
      '<button type="button" class="btn" data-voidxlsx>تصدير Excel</button></div>' +
      '<p class="hint">هذه الإيصالات أُلغي أثرها: لا تدخل في المحصَّل ولا في كشوف الدفعات، وتبقى هنا للمراجعة. «استعادة» تعيد الإيصال إلى دفعات الطالب بالرقم والمبلغ والوسيلة والتاريخ نفسها، وتُزيله من الأرشيف.</p>' +
      '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>رقم الإيصال</th><th>الطالب</th><th>عن شهر</th><th>المبلغ (ج.م)</th><th>طريقة الدفع</th><th>تاريخ السداد</th>' +
      '<th>تاريخ الحذف</th><th>حذفه</th><th>السبب</th><th></th></tr></thead><tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td colspan="4">مجموع المبالغ المحذوفة</td><td>' + plainNum(total) + '</td><td colspan="6"></td></tr></tfoot></table></div></div>';
  }

  // استعادة إيصال من الأرشيف: يعود برقمه ومبلغه ووسيلته وتاريخه. إن لم يكن للطالب إيصال عن الشهر عاد إيصالًا أول، وإلا عاد إيصالًا مكمِّلًا يُرفع به مجموع الشهر
  async function restoreVoided(id) {
    var v = (S.tVoided || []).filter(function (x) { return x.id === id; })[0];
    if (!v || !v.student_id) return;
    if (!isAdmin()) return toast('الاستعادة للمدير العام فقط.', true);
    var x = findStudent(v.student_id), name = v.student_name || (x ? x.full_name : '');
    if (!confirm('استعادة الإيصال رقم ' + (v.receipt_no != null ? v.receipt_no : '—') + ' للطالب «' + name + '» بمبلغ ' + money(v.amount) + ' عن ' + tLabel(v.month) + '؟')) return;
    // رقم الإيصال لا يكون لإيصال آخر
    if (v.receipt_no != null) {
      var dupP = await sb.from('transport_payments').select('student_id,month').eq('receipt_no', v.receipt_no).limit(1);
      var dupT = S.topupMissing ? { data: [] } : await sb.from('transport_topups').select('student_id,month').eq('receipt_no', v.receipt_no).limit(1);
      if ((dupP.data || []).length || (dupT.data || []).length) return toast('الرقم ' + v.receipt_no + ' مستخدم الآن لإيصال آخر، فلا يمكن استعادته بهذا الرقم.', true);
    }
    var cur = await sb.from('transport_payments').select('*').eq('student_id', v.student_id).eq('month', v.month).maybeSingle();
    if (cur.error) return fail(cur.error);
    var now = new Date().toISOString(), who = (S.profile && S.profile.full_name) || displayName(S.email), method = PAY_METHODS[v.method] ? v.method : 'cash';
    var keep = ui.tMonth, due = null, m = memberOf(v.student_id);
    if (!S.dueMissing && m) { ui.tMonth = v.month; due = shareOf(m); ui.tMonth = keep; }
    var prev = cur.data && Number(cur.data.amount) > 0 ? cur.data : null, ok;
    if (!prev) {
      var row = { student_id: v.student_id, month: v.month, amount: Number(v.amount) || 0, method: method, method_note: v.method_note || '', paid_on: v.paid_on || todayISO(), issued_by: who, issued_at: now, updated_at: now };
      if (v.receipt_no != null) row.receipt_no = v.receipt_no;
      if (!S.dueMissing && due != null) row.due = due;
      if (S.issuerMissing) { delete row.issued_by; delete row.issued_at; }
      ok = await sb.from('transport_payments').upsert(row, { onConflict: 'student_id,month' });
    } else {
      if (S.topupMissing) return toast('للشهر إيصال قائم، واستعادة إيصال آخر معه تحتاج supabase/transport_topups.sql.', true);
      var top = { student_id: v.student_id, month: v.month, amount: Number(v.amount) || 0, method: method, method_note: v.method_note || '', paid_before: Number(prev.amount) || 0, due: prev.due != null ? Number(prev.due) : due, paid_on: v.paid_on || todayISO(), issued_by: who, issued_at: now };
      if (v.receipt_no != null) top.receipt_no = v.receipt_no;
      var ins = await sb.from('transport_topups').insert(top);
      if (ins.error) return fail(ins.error);
      ok = await sb.from('transport_payments').update({ amount: Number(prev.amount) + top.amount, updated_at: now }).eq('student_id', v.student_id).eq('month', v.month);
    }
    if (ok.error) return fail(ok.error);
    var del = await sb.from('transport_voided').delete().eq('id', v.id);
    if (del.error) toast('استُعيد الإيصال لكن تعذّر حذف نسخته من الأرشيف: ' + del.error.message, true);
    S.tVoided = null;
    delete S.tPay[v.month];
    if (S.tTop) delete S.tTop[v.month];
    await refreshFirstPaid(v.student_id);
    if (v.month === ui.tMonth) await loadPayments(v.month);
    else render();
    toast('استُعيد الإيصال رقم ' + (v.receipt_no != null ? v.receipt_no : '—') + ' للطالب ' + name);
  }

  async function exportVoidedXlsx() {
    var list = S.tVoided || [];
    if (!list.length) return toast('لا توجد إيصالات محذوفة للتصدير', true);
    try {
      await loadXlsx();
      var aoa = [[schoolName()], ['أرشيف الإيصالات المحذوفة — ' + dmy(todayISO())], [],
        ['م', 'رقم الإيصال', 'اسم الطالب', 'الشعبة', 'الباص', 'عن شهر', 'المبلغ (ج.م)', 'طريقة الدفع', 'تاريخ السداد', 'تاريخ الحذف', 'حذفه', 'السبب']];
      list.forEach(function (v, i) {
        aoa.push([i + 1, v.receipt_no != null ? v.receipt_no : '', v.student_name, v.class_name, v.assembly_point, v.month, Number(v.amount) || 0,
          payMethodLabel(v), dmy(v.paid_on), dmy(v.voided_at), v.voided_by, v.reason]);
      });
      var ws = XLSX.utils.aoa_to_sheet(aoa), wb = XLSX.utils.book_new();
      ws['!cols'] = [5, 12, 32, 14, 22, 10, 13, 20, 13, 13, 20, 40].map(function (w) { return { wch: w }; });
      wb.Workbook = { Views: [{ RTL: true }] };
      XLSX.utils.book_append_sheet(wb, ws, 'الإيصالات المحذوفة');
      XLSX.writeFile(wb, 'أرشيف-الإيصالات-المحذوفة-' + todayISO() + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ----- استرداد مبالغ المواصلات -----
     الاسترداد يُنقص دفعة الشهر بالمبلغ المردود (فيظهر المحصَّل صافيًا)، ويُسجَّل في جدول transport_refunds
     بسند له رقمه، مع من ردّه ومتى وكيف ولماذا (supabase/transport_refunds.sql) */

  var REFUND_SQL_MSG = 'شغّل الملف supabase/transport_refunds.sql في محرر SQL أولًا، ثم حدّث الصفحة';
  var pendingRefund = null;

  function refundsOf(studentId, month) {
    return (S.tRefunds || []).filter(function (v) { return v.student_id === studentId && v.month === month; });
  }

  function refundTotal(list) {
    return list.reduce(function (sum, v) { return sum + (Number(v.amount) || 0); }, 0);
  }

  // نموذج الاسترداد داخل شاشة «إصدار إيصال»
  function refundFormHtml(x, paid, staff) {
    var opts = Object.keys(PAY_METHODS).map(function (k) { return '<option value="' + k + '">' + PAY_METHODS[k] + '</option>'; }).join('');
    return '<div class="refund-box"><h3 style="margin:0 0 4px">استرداد مبلغ</h3>' +
      '<p class="hint">يُردّ المبلغ من ' + (staff ? 'صافي ' : '') + 'المدفوع عن ' + tLabel(ui.tMonth) + ' (' + plainNum(paid) + ' ج.م)، فينقص المحصَّل بقدره، ويُحفظ الاسترداد في سجل المستردات بسند مستقل.' +
        (staff ? ' إيصالات الموظف تبقى كما صدرت.' : '') + '</p>' +
      '<div class="grid2">' +
        '<div><label class="field" for="rf-amount">المبلغ المسترد (ج.م) <span class="req">*</span></label><input type="number" id="rf-amount" min="0" max="' + paid + '" step="any" value="' + paid + '"></div>' +
        '<div><label class="field" for="rf-method">طريقة الرد</label><select id="rf-method">' + opts + '</select></div>' +
        '<div><label class="field" for="rf-note">رقم التحويل أو ملاحظة على طريقة الرد</label><input type="text" id="rf-note"></div>' +
        '<div><label class="field" for="rf-reason">سبب الاسترداد <span class="req">*</span></label><input type="text" id="rf-reason" list="dl-refund" autocomplete="off">' +
          '<datalist id="dl-refund"><option value="انسحاب من المواصلات"><option value="دفع زائد عن المطلوب"><option value="دفعة مكررة"><option value="تغيير مكان السكن"><option value="انسحاب من الأكاديمية"></datalist></div>' +
      '</div>' +
      (staff ? '<label class="check" style="margin-top:10px"><input type="checkbox" id="rf-stop">عند استرداد المبلغ كاملًا: أوقف ركوبه الباص ابتداءً من هذه الدورة</label>'
        : S.leaveMissing ? '' : '<label class="check" style="margin-top:10px"><input type="checkbox" id="rf-stop">عند استرداد المبلغ كاملًا: أوقف اشتراكه في المواصلات ابتداءً من هذا الشهر</label>') +
      '<div class="actions"><button type="button" class="btn primary" data-rfsave="print">تسجيل الاسترداد وطباعة السند</button>' +
        '<button type="button" class="btn" data-rfsave="save">تسجيل دون طباعة</button>' +
        '<button type="button" class="btn" data-rfcancel>إلغاء</button></div></div>';
  }

  async function saveRefund(print) {
    if (ui.rcStaff) return staffRefundSave(print);
    if (S.refundMissing) return toast(REFUND_SQL_MSG, true);
    var x = findStudent(ui.rcStudent), rec = x && (S.tPay[ui.tMonth] || {})[x.id];
    if (!rec || !(rec.amount > 0)) return;
    var amount = Math.round((Number(document.getElementById('rf-amount').value) || 0) * 100) / 100;
    var reason = document.getElementById('rf-reason').value.trim(), method = document.getElementById('rf-method').value;
    var stopBox = document.getElementById('rf-stop'), stop = !!(stopBox && stopBox.checked);
    if (!(amount > 0)) return toast('اكتب المبلغ المسترد.', true);
    if (amount > rec.amount) return toast('المبلغ المسترد أكبر من المدفوع عن الشهر (' + plainNum(rec.amount) + ' ج.م).', true);
    if (!reason) return toast('اكتب سبب الاسترداد.', true);
    var net = Math.round((rec.amount - amount) * 100) / 100;
    if (!confirm('استرداد ' + money(amount) + ' للطالب «' + x.full_name + '» من المدفوع عن ' + tLabel(ui.tMonth) + '؟\n\nالمدفوع الآن: ' + money(rec.amount) + '\nالصافي بعد الاسترداد: ' + money(net) +
      (stop && net === 0 ? '\n\nوسيُوقف اشتراكه في المواصلات ابتداءً من هذا الشهر.' : ''))) return;

    var m = S.tMembers.filter(function (k) { return k.student_id === x.id; })[0], g = m && findGroup(m.group_id);
    var row = {
      student_id: x.id, student_name: x.full_name, guardian_name: x.guardian_name || '', class_name: x.class_name || '', assembly_point: g ? g.assembly_point : '',
      month: ui.tMonth, receipt_no: rec.receipt_no != null ? rec.receipt_no : null, paid_before: rec.amount, amount: amount,
      method: method, method_note: document.getElementById('rf-note').value.trim(), reason: reason,
      refunded_by: (S.profile && S.profile.full_name) || displayName(S.email), refunded_on: todayISO()
    };
    // السند أولًا ثم تعديل الدفعة: إن تعذّر التعديل يُسحب السند فلا يُسجَّل استرداد بلا أثر
    var ins = await sb.from('transport_refunds').insert(row).select().single();
    if (ins.error) return fail(ins.error);
    // دفعة رُدّت كاملة تُحذف (كإيصال ملغى)، فإن دفع لاحقًا صدر له إيصال جديد
    var change = net > 0
      ? await sb.from('transport_payments').update({ amount: net, updated_at: new Date().toISOString() }).eq('student_id', x.id).eq('month', ui.tMonth)
      : await sb.from('transport_payments').delete().eq('student_id', x.id).eq('month', ui.tMonth);
    if (change.error) {
      if (ins.data) await sb.from('transport_refunds').delete().eq('id', ins.data.id);
      return fail(change.error);
    }
    var saved = Object.assign({}, row, ins.data || {});
    (S.tRefunds || (S.tRefunds = [])).unshift(saved);
    if (net > 0) rec.amount = net; else delete S.tPay[ui.tMonth][x.id];
    await refreshFirstPaid(x.id);
    if (stop && net === 0 && m) {
      var left = await sb.from('transport_members').update({ left_from: ui.tMonth }).eq('student_id', x.id);
      if (left.error) fail(left.error); else m.left_from = ui.tMonth;
    }
    ui.rcRefund = false;
    document.getElementById('rc-body').innerHTML = deskBodyHtml();
    toast('سُجّل استرداد ' + money(amount));
    if (print) { pendingRefund = saved; printNow(); }
  }

  function refundsHtml() {
    if (S.refundMissing && !S.sRefunds.length) return '<div class="card empty">' + REFUND_SQL_MSG + '.</div>';
    var list = allRefunds();
    if (!list.length) return '<div class="card empty">لا توجد مبالغ مستردة. الاسترداد يُسجَّل من «إصدار إيصال» بعد اختيار الطالب أو الموظف.</div>';
    var month = list.filter(function (v) { return v.month === ui.tMonth && !v.staff; }), all = list.filter(function (v) { return !v.staff; });
    var sMonth = list.filter(function (v) { return v.month === ui.tMonth && v.staff; }), sAll = list.filter(function (v) { return v.staff; });
    var rows = list.map(function (v, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + (v.refund_no != null ? v.refund_no : '—') + '</td><td><b>' + esc(v.student_name) + '</b><br><span style="color:var(--muted);font-size:.85rem">' +
        esc(v.class_name || 'بدون شعبة') + (v.assembly_point ? ' · ' + esc(v.assembly_point) : '') + '</span></td>' +
        '<td>' + tLabel(v.month) + '</td><td>' + plainNum(Number(v.paid_before) || 0) + '</td><td><b>' + plainNum(Number(v.amount) || 0) + '</b></td><td>' + esc(payMethodLabel(v)) + '</td>' +
        '<td>' + dmy(v.refunded_on) + '</td><td>' + esc(v.reason) + '</td><td>' + esc(v.refunded_by) + '</td>' +
        '<td><button type="button" class="btn" data-rfprint="' + v.id + '">طباعة السند</button></td></tr>';
    }).join('');
    return '<div class="card"><div class="toolbar" style="align-items:center"><h2 style="margin:0;flex:1">سجل المستردات (' + list.length + ')</h2>' +
      '<button type="button" class="btn" data-rfxlsx>تصدير Excel</button></div>' +
      '<p class="st-count">مستردات الطلاب عن ' + tLabel(ui.tMonth) + ': ' + money(refundTotal(month)) + ' (' + month.length + ') · مجموع مستردات الطلاب: ' + money(refundTotal(all)) + '</p>' +
      (sAll.length ? '<p class="st-count">مستردات الموظفين عن ' + tLabel(ui.tMonth) + ': ' + money(refundTotal(sMonth)) + ' (' + sMonth.length + ') · مجموع مستردات الموظفين: ' + money(refundTotal(sAll)) + '</p>' : '') +
      '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>رقم السند</th><th>الاسم</th><th>عن شهر</th><th>المدفوع قبله</th><th>المسترد (ج.م)</th><th>طريقة الرد</th>' +
      '<th>التاريخ</th><th>السبب</th><th>سجّله</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  async function exportRefundsXlsx() {
    var list = allRefunds();
    if (!list.length) return toast('لا توجد مستردات للتصدير', true);
    try {
      await loadXlsx();
      var aoa = [[schoolName()], ['سجل مستردات المواصلات — ' + dmy(todayISO())], [],
        ['م', 'رقم السند', 'الاسم', 'الشعبة', 'الباص', 'عن شهر', 'رقم الإيصال', 'المدفوع قبله (ج.م)', 'المسترد (ج.م)', 'الصافي بعده (ج.م)', 'طريقة الرد', 'التاريخ', 'السبب', 'سجّله']];
      list.forEach(function (v, i) {
        aoa.push([i + 1, v.refund_no != null ? v.refund_no : '', v.student_name, v.class_name, v.assembly_point, v.month, v.receipt_no != null ? v.receipt_no : '',
          Number(v.paid_before) || 0, Number(v.amount) || 0, (Number(v.paid_before) || 0) - (Number(v.amount) || 0), payMethodLabel(v), dmy(v.refunded_on), v.reason, v.refunded_by]);
      });
      var stu = list.filter(function (v) { return !v.staff; }), stf = list.filter(function (v) { return v.staff; });
      aoa.push(['', 'مجموع مستردات الطلاب', '', '', '', '', '', '', refundTotal(stu)]);
      if (stf.length) aoa.push(['', 'مجموع مستردات الموظفين', '', '', '', '', '', '', refundTotal(stf)]);
      var ws = XLSX.utils.aoa_to_sheet(aoa), wb = XLSX.utils.book_new();
      ws['!cols'] = [5, 11, 32, 14, 22, 10, 12, 16, 14, 16, 20, 13, 34, 20].map(function (w) { return { wch: w }; });
      wb.Workbook = { Views: [{ RTL: true }] };
      XLSX.utils.book_append_sheet(wb, ws, 'المستردات');
      XLSX.writeFile(wb, 'مستردات-المواصلات-' + todayISO() + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  function renderTransport() {
    if (S.studentsMissing || S.transportMissing) {
      app.innerHTML = tabs('transport') + '<div class="card empty">لم تُجهَّز قاعدة البيانات للمواصلات بعد.<br>' +
        'شغّل الملف <code dir="ltr">supabase/' + (S.studentsMissing ? 'students.sql ثم transport.sql' : 'transport.sql') + '</code> في محرر SQL ثم حدّث الصفحة.</div>';
      return;
    }
    var hash = location.hash, g = currentGroup();
    if (ui.cl && hash === '#/transport') return renderCluster();
    if (!ui.tMonth) ui.tMonth = currentCycle();
    if (!S.tPay[ui.tMonth]) {
      app.innerHTML = tabs('transport') + '<div class="card empty">جارٍ التحميل…</div>';
      loadPayments(ui.tMonth);
      return;
    }
    var monthPick = '<span class="monthpick"><label class="field" for="t-month">الدورة (شهر بدايتها)</label>' +
      '<input type="month" id="t-month" value="' + ui.tMonth + '"></span>';

    if (g) {
      var editing = ui.editGroup === g.id, tot = groupTotals(g);
      app.innerHTML = tabs('transport') +
        '<a class="btn link no-print" href="#/transport">→ العودة إلى الباصات</a>' +
        '<div class="eval-head"><div><h2>' + esc(g.assembly_point) + '</h2><div class="sub">' +
          'المشرف: ' + esc(g.supervisor_name || '—') + (g.supervisor_phone ? ' · <span dir="ltr">' + esc(g.supervisor_phone) + '</span>' : '') +
          (g.driver_name ? ' · السائق: ' + esc(g.driver_name) + (g.driver_phone ? ' <span dir="ltr">' + esc(g.driver_phone) + '</span>' : '') : '') +
          (g.pickup_time ? ' · وقت التجمع: ' + esc(g.pickup_time) : '') +
          (g.capacity != null ? ' · السعة: ' + busCount(g) + ' من ' + g.capacity : '') + (g.notes ? '<br>' + esc(g.notes) : '') + '</div></div>' +
          '<div class="no-print" style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn primary" data-busprint="' + g.id + '">طباعة كشف الباص</button>' + EXPORT_BTNS +
          '<button type="button" class="btn" data-gedit="' + g.id + '">تعديل</button>' +
          '<button type="button" class="btn danger" data-gdel="' + g.id + '">حذف الباص</button></div></div>' +
        (editing ? groupFormHtml(g) : '') + exemptFormHtml(g) +
        '<div class="card"><div class="toolbar" style="align-items:center"><h2 style="margin:0;flex:1">الطلاب (' + tot.n + ') — ' + tLabel(ui.tMonth) + '</h2>' +
          '<span class="no-print" style="display:flex;gap:8px;align-items:center">' + monthPick + '</span></div>' +
          '<div id="t-members">' + membersTableHtml(g) + '</div></div>' + staffBusCardHtml(g) +
        '<div class="card no-print"><h2>إضافة طلاب إلى الباص</h2>' +
          '<input type="search" id="t-search" placeholder="ابحث بالاسم أو رقم الهوية أو العنوان أو الصف" aria-label="بحث عن طالب" style="margin:8px 0" value="' + esc(ui.tSearch) + '">' +
          '<div id="t-cands">' + candidatesHtml(g) + '</div></div>';
      return;
    }

    var view = hash === '#/transport/payments' ? 'pay' : hash === '#/transport/classes' ? 'classes' : hash === '#/transport/receipt' ? 'desk' : hash === '#/transport/archive' ? 'archive' : hash === '#/transport/refunds' ? 'refunds' : hash === '#/transport/late' ? 'late' : hash === '#/transport/ledger' ? 'ledger' : hash === '#/transport/buses' ? 'busrep' : hash === '#/transport/status' ? 'status' : hash === '#/transport/setup' ? 'setup' : 'groups';
    var all = payRows();
    var head = tabs('transport') + '<div class="tabbar' + (transportNavGroup(view)[1].length > 1 ? ' has-sub' : '') + '">' + transportNav(view) + monthPick + '</div>' + transportSubNav(view);

    if (view === 'setup') {
      app.innerHTML = head + cyclesCardHtml();
      return;
    }

    if (view === 'refunds') {
      app.innerHTML = head + refundsHtml();
      return;
    }

    if (view === 'ledger') {
      app.innerHTML = head + ledgerHtml();
      return;
    }

    if (view === 'busrep') {
      app.innerHTML = head + busReportHtml();
      return;
    }

    if (view === 'status') {
      app.innerHTML = head + tsHtml();
      return;
    }

    if (view === 'late') {
      app.innerHTML = head + lateHtml();
      return;
    }

    if (view === 'archive') {
      if (!S.archiveMissing && S.tVoided == null) {
        app.innerHTML = head + '<div class="card empty">جارٍ التحميل…</div>';
        loadVoided();
        return;
      }
      app.innerHTML = head + archiveHtml();
      return;
    }

    if (view === 'desk') {
      app.innerHTML = head +
        '<div class="card"><label class="field" for="rc-id">رقم هوية الطالب أو اسمه، أو اسم الموظف أو جواله</label>' +
          '<div class="addstmt"><input type="search" id="rc-id" dir="auto" inputmode="search" autocomplete="off" placeholder="اكتب رقم الهوية ثم Enter" value="' + esc(ui.rcQuery) + '">' +
          '<button type="button" class="btn primary" data-rcfind>بحث</button></div></div>' +
        '<div id="rc-body">' + deskBodyHtml() + '</div>';
      var idBox = document.getElementById('rc-id');
      if (!ui.rcStudent) idBox.focus();
      return;
    }

    if (view === 'pay') {
      var names = schoolClasses().slice();
      all.forEach(function (r) { if (r.x.class_name && names.indexOf(r.x.class_name) < 0) names.push(r.x.class_name); });
      app.innerHTML = head +
        '<div class="toolbar" style="align-items:center">' +
          '<select id="tp-class" aria-label="الشعبة" style="width:auto;min-width:170px"><option value="">كل المدرسة</option>' + names.map(function (c) {
            return '<option' + (c === ui.tpClass ? ' selected' : '') + '>' + esc(c) + '</option>';
          }).join('') + '<option value="-"' + (ui.tpClass === '-' ? ' selected' : '') + '>بدون شعبة</option></select>' +
          '<input type="search" id="tp-search" placeholder="ابحث باسم الطالب أو الباص" aria-label="بحث" style="flex:1;min-width:180px" value="' + esc(ui.tpSearch) + '">' +
          EXPORT_BTNS + '</div>' +
        '<div id="tp-body">' + payBodyHtml() + '</div>';
      return;
    }

    if (view === 'classes') {
      var list = payByClass(all), sum = payTotals(all);
      app.innerHTML = head + payStatsHtml(sum, 'في ' + list.length + ' شعبة') +
        (list.length
          ? '<div class="card"><div class="toolbar" style="align-items:center"><h2 style="margin:0;flex:1">دفعات ' + tLabel(ui.tMonth) + ' حسب الشعبة</h2>' + EXPORT_BTNS + '</div>' +
            '<p class="st-count">التصدير من هنا يشمل المدرسة كلها. لتصدير شعبة واحدة اضغط اسمها.</p>' +
            '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الشعبة</th><th>المشتركون</th><th>المطلوب (ج.م)</th><th>المحصَّل (ج.م)</th>' +
            Object.keys(PAY_METHODS).map(function (k) { return '<th>' + PAY_METHODS[k] + '</th>'; }).join('') +
            '<th>المتبقي (ج.م)</th><th>نسبة التحصيل</th><th>لم يسددوا</th></tr></thead><tbody>' +
            list.map(function (c, i) {
              return '<tr><td>' + (i + 1) + '</td><td><button type="button" class="btn link" data-tpclass="' + esc(c.name || '-') + '">' + esc(c.name || 'بدون شعبة') + '</button></td>' +
                '<td>' + c.t.n + '</td><td>' + plainNum(c.t.due) + '</td><td><b>' + plainNum(c.t.paid) + '</b></td>' +
                Object.keys(PAY_METHODS).map(function (k) { return '<td>' + (c.t.by[k] ? plainNum(c.t.by[k]) : '—') + '</td>'; }).join('') + '<td>' + plainNum(c.t.left) + '</td>' +
                '<td>' + (c.t.due ? Math.round(c.t.paid / c.t.due * 100) : 0) + '%</td><td>' + c.t.owing + '</td></tr>';
            }).join('') + '</tbody><tfoot><tr><td colspan="2">المجموع</td><td>' + sum.n + '</td><td>' + plainNum(sum.due) + '</td><td>' + plainNum(sum.paid) + '</td>' +
            Object.keys(PAY_METHODS).map(function (k) { return '<td>' + plainNum(sum.by[k]) + '</td>'; }).join('') +
            '<td>' + plainNum(sum.left) + '</td><td>' + (sum.due ? Math.round(sum.paid / sum.due * 100) : 0) + '%</td><td>' + sum.owing + '</td></tr></tfoot></table></div></div>'
          : '<div class="card empty">لا يوجد طلاب مشتركون في المواصلات بعد.</div>');
      return;
    }

    var cards = S.tGroups.map(function (x) {
      var t = groupTotals(x);
      return '<a class="card tgroup" href="#/transport/' + x.id + '">' +
        '<span class="name">' + esc(x.assembly_point) + '</span>' +
        '<span class="meta">' + (x.driver_name ? 'السائق: ' + esc(x.driver_name) + ' · ' : '') + 'المشرف: ' + esc(x.supervisor_name || '—') + (x.pickup_time ? ' · ' + esc(x.pickup_time) : '') + '</span>' +
        '<span class="meta">' + (x.capacity != null ? 'الركاب: ' + busCount(x) + ' من ' + x.capacity + (busCount(x) > x.capacity ? ' (فوق السعة)' : '') + ' · ' : '') + 'المشتركون: ' + t.n + (function () {
          var waiting = membersOf(x.id).filter(awaitingStart).length;
          return waiting ? ' · بانتظار الاشتراك: ' + waiting : '';
        })() + '</span>' +
        '<span class="money"><span>المحصَّل: <b>' + money(t.paid) + '</b></span><span>المطلوب: ' + money(t.due) + '</span></span>' +
        '<span class="progress"><span style="display:block;height:100%;background:var(--primary);width:' + (t.due ? Math.min(100, t.paid / t.due * 100) : 0) + '%"></span></span></a>';
    }).join('');

    // المطلوب: من كل راكب في باص، ومنهم من لم يُصدر له إيصال بعد (لم يبدأ اشتراكه)؛ والمحصَّل ما دُفع فعلًا
    var tot = payTotals(all), waitRows = S.tMembers.filter(function (m) { var x = findStudent(m.student_id), wg = findGroup(m.group_id); return x && wg && enrolled(x) && awaitingStart(m); });
    waitRows.forEach(function (m) { var sh = shareOf(m, findGroup(m.group_id)); tot.due += sh; tot.left += sh; tot.n++; if (sh > 0) tot.owing++; });
    tot.waiting = waitRows.length;
    app.innerHTML = head + payStatsHtml(tot, 'في ' + S.tGroups.length + ' باصًا') +
      (ui.editGroup === 'new' ? groupFormHtml(null) :
        '<div class="toolbar" style="align-items:center"><button type="button" class="btn primary" data-gedit="new">+ باص جديد</button>' +
        '<button type="button" class="btn" data-clopen>اقتراح نقاط التجمع من العناوين</button></div>') +
      (cards ? '<div class="teachers">' + cards + '</div>'
        : '<div class="card empty">لا توجد باصات بعد. أنشئ باصًا لكل مسار ثم أضف طلابه.</div>');
  }

  /* ----- تصدير الدفعات ----- */

  async function exportPayXlsx() {
    if (!(await syncData(true))) return;
    var sc = payScope();
    if (!sc.rows.length) return toast('لا توجد دفعات للتصدير', true);
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new(), used = {};
      wb.Workbook = { Views: [{ RTL: true }] };
      // اسم الورقة: 31 حرفًا على الأكثر، بلا رموز يرفضها Excel، وغير مكرر
      var sheetName = function (text) {
        var base = String(text).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 28) || 'ورقة', name = base, n = 2;
        while (used[name]) name = base + ' ' + n++;
        used[name] = true;
        return name;
      };
      var add = function (title, aoa, widths) {
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = widths.map(function (w) { return { wch: w }; });
        XLSX.utils.book_append_sheet(wb, ws, sheetName(title));
      };
      var methodNames = Object.keys(PAY_METHODS).map(function (k) { return PAY_METHODS[k] + ' (ج.م)'; });
      var methodAmounts = function (t) { return Object.keys(PAY_METHODS).map(function (k) { return t.by[k]; }); };
      var top = function (title) { return [[schoolName()], ['دفعات المواصلات — ' + tLabel(ui.tMonth) + ' — ' + title], []]; };
      var detail = function (title, rows) {
        var t = payTotals(rows);
        add(title, top(title).concat(
          [['م', 'اسم الطالب', 'الشعبة', 'الباص', 'هاتف ولي الأمر', 'الحصة (ج.م)', 'المدفوع (ج.م)', 'المتبقي (ج.م)', 'الحالة', 'طريقة الدفع', 'تاريخ السداد', 'رقم الإيصال', 'وقت التسجيل', 'المسجِّل']],
          rows.map(function (r, i) {
            return [i + 1, r.x.full_name, r.x.class_name || '', r.g.assembly_point, String(r.x.phone || ''), r.exempt ? 'إعفاء' : r.share, r.exempt ? '' : r.paid, r.exempt ? '' : r.left,
              PAY_STATUS[r.status] || '', r.paid ? payMethodLabel(r.rec) : '', r.paid ? dmy(r.rec.paid_on) : '', r.paid && r.rec.receipt_no != null ? r.rec.receipt_no : '', r.paid ? issuedWhen(r.rec) : '', r.paid ? r.rec.issued_by || '' : ''];
          }),
          [['', 'المجموع', '', '', '', t.due, t.paid, t.left, t.exempt ? 'المعفون: ' + t.exempt + ' (خارج المجموع)' : '', '', '', '']], [[]], [['', 'تفصيل المحصَّل حسب وسيلة الدفع']],
          Object.keys(PAY_METHODS).map(function (k) { return ['', PAY_METHODS[k], '', '', '', '', t.by[k], '', t.byCount[k] ? 'عدد الدفعات: ' + t.byCount[k] : '']; })),
          [5, 32, 14, 24, 16, 12, 13, 13, 16, 14, 13, 11, 18, 20]);
      };
      if (sc.whole) {
        var list = payByClass(sc.rows), sum = payTotals(sc.rows);
        var pct = function (t) { return t.due ? Math.round(t.paid / t.due * 100) + '%' : ''; };
        add('ملخص الشعب', top('ملخص الشعب').concat(
          [['م', 'الشعبة', 'المشتركون', 'المطلوب (ج.م)', 'المحصَّل (ج.م)'].concat(methodNames, ['المتبقي (ج.م)', 'نسبة التحصيل', 'لم يسددوا', 'المعفون'])],
          list.map(function (c, i) { return [i + 1, c.name || 'بدون شعبة', c.t.n, c.t.due, c.t.paid].concat(methodAmounts(c.t), [c.t.left, pct(c.t), c.t.owing, c.t.exempt || '']); }),
          [['', 'المجموع', sum.n, sum.due, sum.paid].concat(methodAmounts(sum), [sum.left, pct(sum), sum.owing, sum.exempt || ''])]), [5, 22, 12, 14, 14, 12, 12, 14, 12, 14, 13, 12, 10]);
        detail('كل المدرسة', sc.rows);
        list.forEach(function (c) { detail(c.name || 'بدون شعبة', c.rows); });
      } else {
        detail(sc.name, sc.rows);
      }
      XLSX.writeFile(wb, ('دفعات-المواصلات-' + sc.name + '-' + ui.tMonth).replace(/[\\\/:*?"<>|]/g, ' ').replace(/\s+/g, '-') + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ملف المواصلات: عنوان كل طالب ووسائل الاتصال به ودفعته عن الشهر المعروض، ورقة لكل شعبة.
  // يشمل كل المسجلين نهائيًا: المشترك وغير المشترك، الدافع وغير الدافع. غير المطالَب هذا الشهر يظهر بحالته بلا مبالغ.
  // النطاق: المجموعة المفتوحة (طلابها فقط)، أو الشعبة المختارة في «دفعات الطلاب»، وإلا المدرسة كلها
  async function exportTransportContacts() {
    if (!(await syncData(true))) return;
    var g = currentGroup(), cls = !g && location.hash === '#/transport/payments' ? ui.tpClass : '';
    var owing = {};
    payRows().forEach(function (r) { owing[r.x.id] = r; });
    var memberOf = {};
    S.tMembers.forEach(function (m) { memberOf[m.student_id] = m; });
    var rows = S.students.filter(function (x) { return enrolled(x) || owing[x.id]; }).map(function (x) {
      if (owing[x.id]) return owing[x.id];
      var m = memberOf[x.id], mg = m && findGroup(m.group_id);
      return { x: x, g: mg || null, rec: {}, waiting: true,
        note: !mg ? 'غير مشترك' : subscribedIn(m, ui.tMonth) ? 'لم يبدأ الاشتراك' : 'اشتراك متوقف' };
    }).filter(function (r) {
      return (!g || r.g === g) && (cls === '-' ? !r.x.class_name : !cls || r.x.class_name === cls);
    }).sort(function (a, b) {
      return classRank(a.x.class_name) - classRank(b.x.class_name) || String(a.x.class_name).localeCompare(b.x.class_name, 'ar') ||
        a.x.full_name.localeCompare(b.x.full_name, 'ar');
    });
    if (!rows.length) return toast('لا يوجد طلاب للتصدير', true);
    var scope = g ? g.assembly_point : cls === '-' ? 'بدون شعبة' : cls || 'كل المدرسة';
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new(), used = {};
      wb.Workbook = { Views: [{ RTL: true }] };
      var sheet = function (title, list) {
        var due = 0, paid = 0, left = 0;
        var body = list.map(function (r, i) {
          var x = r.x, w = r.waiting;
          if (!w && !r.exempt) { due += r.share; paid += r.paid; left += r.left; }
          return [i + 1, x.full_name, x.class_name || '', r.g ? r.g.assembly_point : '', stVal(x, 'city') || '', stVal(x, 'address') || '', x.guardian_name || '',
            plainPhone(x.phone), plainPhone(x.whatsapp), plainPhone(stVal(x, 'student_phone')),
            w || r.exempt ? '' : r.share, w || r.exempt ? '' : r.paid, w || r.exempt ? '' : r.left, w ? r.note : PAY_STATUS[r.status] || '',
            r.paid ? payMethodLabel(r.rec) : '', r.paid ? dmy(r.rec.paid_on) : '', r.paid && r.rec.receipt_no != null ? r.rec.receipt_no : ''];
        });
        var ws = XLSX.utils.aoa_to_sheet([[schoolName()], ['ملف المواصلات — ' + tLabel(ui.tMonth) + ' — ' + title], [],
          ['م', 'اسم الطالب', 'الشعبة', 'الباص', 'المدينة', 'العنوان', 'ولي الأمر', 'هاتف ولي الأمر', 'رقم الواتساب', 'جوال الطالب',
            'الحصة (ج.م)', 'المدفوع (ج.م)', 'المتبقي (ج.م)', 'الحالة', 'طريقة الدفع', 'تاريخ السداد', 'رقم الإيصال']]
          .concat(body, [['', 'المجموع (' + list.length + ' طالبًا)', '', '', '', '', '', '', '', '', due, paid, left]]));
        ws['!cols'] = [5, 32, 14, 22, 16, 34, 26, 16, 16, 16, 12, 13, 13, 16, 16, 13, 11].map(function (w) { return { wch: w }; });
        var base = String(title).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 28) || 'ورقة', name = base, n = 2;
        while (used[name]) name = base + ' ' + n++;
        used[name] = true;
        XLSX.utils.book_append_sheet(wb, ws, name);
      };
      var classes = payByClass(rows);
      if (classes.length > 1) sheet(scope, rows);
      classes.forEach(function (c) { sheet(c.name || 'بدون شعبة', c.rows); });
      XLSX.writeFile(wb, ('ملف-المواصلات-' + scope + '-' + ui.tMonth).replace(/[\\\/:*?"<>|]/g, ' ').replace(/\s+/g, '-') + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ملف PDF يُحفظ من نافذة الطباعة نفسها (الوجهة: «حفظ بتنسيق PDF»)
  function exportPayPdf() {
    if (!payScope().rows.length) return toast('لا توجد دفعات للتصدير', true);
    toast('للحفظ ملفًا: اختر «حفظ بتنسيق PDF» في نافذة الطباعة');
    printNow();
  }

  async function saveGroupForm() {
    var g = ui.editGroup !== 'new' ? findGroup(ui.editGroup) : null;
    var v = function (id) { return document.getElementById(id).value.trim(); };
    var data = {
      assembly_point: v('gf-point'), pickup_time: v('gf-time'), supervisor_name: v('gf-sup'),
      supervisor_phone: latinDigits(v('gf-phone')), notes: v('gf-notes')
    };
    if (!S.busMissing) {
      data.driver_name = v('gf-driver');
      data.driver_phone = latinDigits(v('gf-dphone'));
      data.capacity = v('gf-cap') === '' ? null : Math.max(0, Math.round(Number(v('gf-cap')) || 0));
    }
    if (!S.routeMissing) {
      data.bus_no = v('gf-no') === '' ? null : Math.max(1, Math.round(Number(latinDigits(v('gf-no'))) || 1));
      data.route = v('gf-route');
    }
    if (g) {
      var up = await sb.from('transport_groups').update(data).eq('id', g.id);
      if (up.error) return fail(up.error);
      Object.assign(g, data);
      ui.editGroup = null;
      render();
    } else {
      var ins = await sb.from('transport_groups').insert(data).select().single();
      if (ins.error) return fail(ins.error);
      S.tGroups.push(ins.data);
      ui.editGroup = null;
      go('#/transport/' + ins.data.id);
    }
    toast('تم الحفظ');
  }

  var PAY_METHODS = { cash: 'نقدًا', instapay: 'إنستاباي', vodafone: 'فودافون كاش', other: 'أخرى' };

  // الدفع الإلكتروني (إنستاباي، فودافون كاش) له رقم دفع يُسجَّل ويظهر في الإيصال
  function hasPayRef(method) { return method === 'instapay' || method === 'vodafone'; }

  function payMethodLabel(rec) {
    if (rec.method === 'other') return rec.method_note || PAY_METHODS.other;
    return PAY_METHODS[rec.method || 'cash'] + (hasPayRef(rec.method) && rec.method_note ? ' — ' + rec.method_note : '');
  }

  // الخانة التي تحت طريقة الدفع: رقم الدفع للإلكتروني، أو تحديد الطريقة عند «أخرى». method_note يحمل أيهما
  function payNoteInput(id, method, rec) {
    if (method !== 'other' && !hasPayRef(method)) return '';
    var ref = hasPayRef(method);
    return '<input type="text" class="mnote" data-mnote="' + id + '"' + (ref ? ' dir="ltr" inputmode="numeric" style="text-align:right"' : '') +
      ' placeholder="' + (ref ? 'رقم الدفع' : 'حدّد طريقة الدفع') + '" aria-label="' + (ref ? 'رقم الدفع' : 'طريقة الدفع الأخرى') + '" value="' + esc(rec.method_note || '') + '">';
  }

  // وقت تسجيل الدفعة بتوقيت الجهاز: «12/10/2026 14:35». للدفعات الأقدم من هذه الخاصية: وقت آخر تعديل
  /* ----- سجل الدفعات: كل الإيصالات في فترة، تُفرز وتُصفّى بالتاريخ ووسيلة الدفع ورقمها والباص والشعبة والمسجِّل ----- */

  function ledState() {
    if (!ui.led) ui.led = { from: cycleOf(currentCycle()).from, to: todayISO(), method: '', q: '', bus: '', cls: '', issuer: '', sort: 'date', rows: null, loading: false };
    return ui.led;
  }

  async function loadLedger() {
    var l = ledState();
    if (!l.from || !l.to || l.from > l.to) return toast('اختر فترة صحيحة', true);
    l.loading = true;
    render();
    var from = l.from, to = l.to, got = await receiptsBetween(from, to);
    l.loading = false;
    if (!got) { toast('تعذر جلب الدفعات', true); render(); return; }
    l.rows = got.list;
    l.dateWarn = got.dateWarn;
    l.loadedFrom = from; l.loadedTo = to;
    render();
  }

  // الإيصالات الصادرة بين تاريخين (بتاريخ السداد): الأول بمبلغه الأول، والمكمِّل بمبلغه. يعيد { list, dateWarn } أو null عند الخطأ.
  // يستعملها «سجل الدفعات» ولوحة المؤشرات، فتتطابق الحصيلة فيهما
  async function receiptsBetween(from, to) {
    var rows = await fetchAll(function () { return sb.from('transport_payments').select('*').gte('paid_on', from).lte('paid_on', to).order('paid_on').order('student_id'); });
    if (!rows) return null;
    var groupOf = transportGroupOf();
    // الإيصالات المكمِّلة: تُعرض بتاريخها ووسيلتها، والإيصال الأول بمبلغه قبلها
    var tops = S.topupMissing ? [] : await fetchAll(function () { return sb.from('transport_topups').select('*').order('receipt_no'); }) || [], firstOf = {};
    tops.forEach(function (t) { var k = t.student_id + '|' + t.month; if (!(k in firstOf)) firstOf[k] = Number(t.paid_before) || 0; });
    var mk = function (p, amount) {
      var x = findStudent(p.student_id), g = findGroup(groupOf[p.student_id]);
      return { p: p, x: x, name: x ? x.full_name : '(طالب محذوف)', cls: x ? x.class_name || '' : '', bus: g ? g.assembly_point : '', amount: amount,
        method: PAY_METHODS[p.method] ? p.method : 'cash', ref: p.method_note || '', who: p.issued_by || '', day: String(p.paid_on || '').slice(0, 10) };
    };
    var list = rows.filter(function (p) { return Number(p.amount) > 0; }).map(function (p) {
      var k = p.student_id + '|' + p.month;
      return mk(p, k in firstOf ? firstOf[k] : Number(p.amount) || 0);
    }).concat(tops.filter(function (t) { var d = String(t.paid_on || '').slice(0, 10); return d >= from && d <= to; }).map(function (t) { return mk(t, Number(t.amount) || 0); }))
      .concat(staffLedgerRows(from, to));
    // إيصال أول صدر قبل الإيصالات المكمِّلة، وأُكمل بالطريقة القديمة فكُتب تاريخ الإكمال فوق تاريخه: تاريخه الآن يوم إكماله أو بعده،
    // فيُحسب مبلغه في يوم الإكمال مرة ثانية. يُنبَّه إليه ليُصحَّح تاريخه
    var firstTop = {};
    tops.forEach(function (t) { var k = t.student_id + '|' + t.month, d = String(t.paid_on || '').slice(0, 10); if (!firstTop[k] || d < firstTop[k]) firstTop[k] = d; });
    // ولا يُعدّ دفعُ الأول والمكمِّل في يوم واحد خطأً: يُنبَّه فقط إن صدر بعده إيصال برقم أكبر وتاريخ أقدم (تاريخه كُتب فوقه لاحقاً)
    var cand = rows.filter(function (p) { var k = p.student_id + '|' + p.month; return Number(p.amount) > 0 && firstTop[k] && String(p.paid_on || '').slice(0, 10) >= firstTop[k]; });
    var seq = {};
    for (var ci = 0; ci < cand.length; ci++) {
      var m = cand[ci].month;
      if (!seq[m]) seq[m] = await fetchAll(function () { return sb.from('transport_payments').select('receipt_no,paid_on').eq('month', m).order('receipt_no'); }) || [];
    }
    var dateWarn = cand.filter(function (p) {
      var d = String(p.paid_on || '').slice(0, 10), n = Number(p.receipt_no) || 0;
      return seq[p.month].some(function (o) { return (Number(o.receipt_no) || 0) > n && String(o.paid_on || '').slice(0, 10) < d; });
    }).map(function (p) { var x = findStudent(p.student_id); return { no: p.receipt_no, name: x ? x.full_name : '', day: String(p.paid_on || '').slice(0, 10) }; });
    return { list: list, dateWarn: dateWarn };
  }

  function ledFiltered() {
    var l = ledState(), q = norm(l.q), digits = latinDigits(l.q).replace(/\D/g, '');
    var list = (l.rows || []).filter(function (r) {
      if (l.method && r.method !== l.method) return false;
      if (l.bus && r.bus !== l.bus) return false;
      if (l.cls && r.cls !== l.cls) return false;
      if (l.issuer && r.who !== l.issuer) return false;
      if (!q) return true;
      return norm(r.name).indexOf(q) > -1 || (digits && (String(r.p.receipt_no || '') === digits || latinDigits(r.ref).replace(/\D/g, '').indexOf(digits) > -1 || String((r.x || {}).national_id || '').indexOf(digits) > -1));
    });
    var by = {
      date: function (a, b) { return a.day.localeCompare(b.day) || (Number(a.p.receipt_no) || 0) - (Number(b.p.receipt_no) || 0); },
      receipt: function (a, b) { return (Number(a.p.receipt_no) || 0) - (Number(b.p.receipt_no) || 0); },
      amount: function (a, b) { return b.amount - a.amount || a.day.localeCompare(b.day); },
      method: function (a, b) { return a.method.localeCompare(b.method) || a.day.localeCompare(b.day); },
      name: function (a, b) { return a.name.localeCompare(b.name, 'ar'); },
      bus: function (a, b) { return a.bus.localeCompare(b.bus, 'ar') || a.day.localeCompare(b.day); }
    };
    return list.sort(by[l.sort] || by.date);
  }

  function ledTotals(list) {
    var t = { n: list.length, sum: 0, by: {}, cnt: {}, days: {} };
    Object.keys(PAY_METHODS).forEach(function (k) { t.by[k] = 0; t.cnt[k] = 0; });
    list.forEach(function (r) {
      t.sum += r.amount; t.by[r.method] += r.amount; t.cnt[r.method]++;
      var d = t.days[r.day] || (t.days[r.day] = { n: 0, sum: 0, by: {} });
      d.n++; d.sum += r.amount; d.by[r.method] = (d.by[r.method] || 0) + r.amount;
    });
    return t;
  }

  function ledDesc() {
    var l = ledState(), parts = [['الفترة', 'من ' + dmy(l.loadedFrom || l.from) + ' إلى ' + dmy(l.loadedTo || l.to)]];
    if (l.method) parts.push(['وسيلة الدفع', PAY_METHODS[l.method]]);
    if (l.bus) parts.push(['الباص', l.bus]);
    if (l.cls) parts.push(['الشعبة', l.cls]);
    if (l.issuer) parts.push(['المسجِّل', l.issuer]);
    if (l.q.trim()) parts.push(['بحث', l.q.trim()]);
    return parts;
  }

  /* ----- ملخص الدفع حسب الرقم المحوَّل إليه -----
     من سجل الدفعات بفترته وتصفيته: لكل وسيلة دفع ورقم محوَّل إليه («رقم الدفع» في الإيصال) عدد الدفعات ومجموعها، والنقد في سطر واحد،
     ثم المبلغ الإجمالي للمواصلات. يُطبع PDF ويُصدَّر Excel */
  function ledRefSummary(list) {
    var by = {}, order = Object.keys(PAY_METHODS);
    list.forEach(function (r) {
      var ref = r.method === 'cash' ? '' : String(r.ref || '').trim(), k = r.method + '|' + latinDigits(ref);
      var g = by[k] || (by[k] = { method: r.method, ref: ref, n: 0, sum: 0, students: {} });
      g.n++; g.sum += r.amount; g.students[r.p.student_id] = 1;
    });
    var rows = Object.keys(by).map(function (k) { var g = by[k]; g.students = Object.keys(g.students).length; return g; })
      .sort(function (a, b) { return order.indexOf(a.method) - order.indexOf(b.method) || b.sum - a.sum || String(a.ref).localeCompare(String(b.ref)); });
    var perMethod = {};
    rows.forEach(function (g) { var m = perMethod[g.method] || (perMethod[g.method] = { n: 0, sum: 0 }); m.n += g.n; m.sum += g.sum; });
    return { rows: rows, perMethod: perMethod, n: list.length, sum: list.reduce(function (t, r) { return t + r.amount; }, 0) };
  }
  function ledRefLabel(g) { return g.method === 'cash' ? 'نقدًا (بلا رقم)' : (g.ref || 'بلا رقم مسجَّل'); }

  function ledRefCardHtml(list) {
    var R = ledRefSummary(list);
    if (!R.rows.length) return '';
    var order = Object.keys(PAY_METHODS), body = '';
    order.filter(function (m) { return R.perMethod[m]; }).forEach(function (m) {
      body += '<tr style="background:var(--ivory,#faf7f0)"><td colspan="2"><b>' + PAY_METHODS[m] + '</b></td><td><b>' + R.perMethod[m].n + '</b></td><td><b>' + plainNum(R.perMethod[m].sum) + '</b></td><td></td></tr>' +
        R.rows.filter(function (g) { return g.method === m; }).map(function (g) {
          return '<tr><td></td><td dir="ltr" style="text-align:right">' + esc(ledRefLabel(g)) + '</td><td>' + g.n + '</td><td>' + plainNum(g.sum) + '</td><td>' + g.students + '</td></tr>';
        }).join('');
    });
    return '<div class="card"><div class="toolbar" style="align-items:center;margin:0 0 8px"><h2 style="margin:0;flex:1">ملخص الدفع حسب الرقم المحوَّل إليه</h2>' +
      '<button type="button" class="btn" data-ledrefpdf data-ro-ok>طباعة الملخص / PDF</button><button type="button" class="btn" data-ledrefxlsx data-ro-ok>تصدير Excel</button></div>' +
      '<div class="table-wrap"><table class="grid"><thead><tr><th>وسيلة الدفع</th><th>الرقم المحوَّل إليه</th><th>عدد الدفعات</th><th>المبلغ (ج.م)</th><th>عدد الطلاب</th></tr></thead><tbody>' + body + '</tbody>' +
      '<tfoot><tr><td colspan="2">المبلغ الإجمالي للمواصلات</td><td>' + R.n + '</td><td>' + plainNum(R.sum) + '</td><td></td></tr></tfoot></table></div></div>';
  }

  var pendingLedRef = false;
  function buildLedRefSheet() {
    var l = ledState(), list = ledFiltered(), R = ledRefSummary(list), n = 5;
    var head = reportHead('ملخص دفعات المواصلات حسب الرقم المحوَّل إليه', ledDesc().concat([['عدد الدفعات', R.n], ['الإجمالي', money(R.sum)]])).replace(/^<img class="wm"[^>]*>/, '');
    var body = '';
    Object.keys(PAY_METHODS).filter(function (m) { return R.perMethod[m]; }).forEach(function (m) {
      body += '<tr><td class="bf-sec" style="background:var(--navy);color:#fff" colspan="' + n + '">' + PAY_METHODS[m] + ' — ' + R.perMethod[m].n + ' دفعة — ' + plainNum(R.perMethod[m].sum) + ' ج.م</td></tr>' +
        R.rows.filter(function (g) { return g.method === m; }).map(function (g, i) {
          return '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + PAY_METHODS[m] + '</td><td class="c" dir="ltr"><b>' + esc(ledRefLabel(g)) + '</b></td><td class="c">' + g.n + '</td><td class="c"><b>' + plainNum(g.sum) + '</b></td></tr>';
        }).join('');
    });
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
      '<table class="rz"><thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>' +
      '<tr><th>م</th><th>وسيلة الدفع</th><th>الرقم المحوَّل إليه</th><th>عدد الدفعات</th><th>المبلغ (ج.م)</th></tr></thead><tbody>' + (body || '<tr><td colspan="' + n + '" class="c">—</td></tr>') +
      '<tr class="total"><td colspan="3">المبلغ الإجمالي للمواصلات</td><td class="c"><b>' + R.n + '</b></td><td class="c"><b>' + plainNum(R.sum) + '</b></td></tr></tbody>' +
      '<tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>' + reportSigns([['مسؤول المواصلات', ''], ['مدير الأكاديمية', principalName()]]);
  }

  async function exportLedRefXlsx() {
    var R = ledRefSummary(ledFiltered());
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new(), used = {};
      wb.Workbook = { Views: [{ RTL: true }] };
      xlsxSheet(wb, used, 'ملخص الدفع', [[schoolName()], ['ملخص دفعات المواصلات حسب الرقم المحوَّل إليه']].concat(ledDesc().map(function (p) { return [p[0] + ': ' + p[1]]; }), [[],
        ['وسيلة الدفع', 'الرقم المحوَّل إليه', 'عدد الدفعات', 'المبلغ (ج.م)', 'عدد الطلاب']],
        R.rows.map(function (g) { return [PAY_METHODS[g.method], g.method === 'cash' ? '' : g.ref, g.n, g.sum, g.students]; }),
        [[], ['مجموع حسب الوسيلة']], Object.keys(PAY_METHODS).filter(function (m) { return R.perMethod[m]; }).map(function (m) { return [PAY_METHODS[m], '', R.perMethod[m].n, R.perMethod[m].sum]; }),
        [['المبلغ الإجمالي للمواصلات', '', R.n, R.sum]]), [22, 26, 14, 16, 14]);
      XLSX.writeFile(wb, 'ملخص-الدفع-حسب-الرقم-' + todayISO() + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  document.addEventListener('click', function (e) {
    if (location.hash !== '#/transport/ledger' || !canTransport()) return;
    if (e.target.closest('[data-ledrefxlsx]')) return exportLedRefXlsx();
    if (e.target.closest('[data-ledrefpdf]')) { pendingLedRef = true; return printNow(); }
  });

  function ledgerHtml() {
    var l = ledState();
    var opt = function (v, label, cur) { return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(label) + '</option>'; };
    var uniq = function (k) { var seen = {}; (l.rows || []).forEach(function (r) { if (r[k]) seen[r[k]] = 1; }); return Object.keys(seen).sort(function (a, b) { return k === 'cls' ? classRank(a) - classRank(b) || a.localeCompare(b, 'ar') : a.localeCompare(b, 'ar'); }); };
    var head = '<div class="card"><div class="toolbar" style="align-items:center;margin:0">' +
      '<span class="monthpick"><label class="field" for="led-from">من</label><input type="date" id="led-from" data-ro-ok value="' + l.from + '"></span>' +
      '<span class="monthpick"><label class="field" for="led-to">إلى</label><input type="date" id="led-to" data-ro-ok value="' + l.to + '"></span>' +
      '<button type="button" class="btn primary" data-ledrun data-ro-ok' + (l.loading ? ' disabled' : '') + '>' + (l.loading ? 'جارٍ الجلب…' : 'عرض الدفعات') + '</button></div>' +
      '<p class="hint" style="margin:8px 0 0">بتاريخ السداد المكتوب في الإيصال. المبالغ صافية بعد أي استرداد.</p></div>';
    if (!l.rows) return head + '<div class="card empty">اختر الفترة ثم «عرض الدفعات».</div>';
    var list = ledFiltered(), t = ledTotals(list);
    var warn = (l.dateWarn || []).length ? '<p class="formhint">' + l.dateWarn.map(function (w) { return 'الإيصال رقم ' + w.no + (w.name ? ' (' + esc(w.name) + ')' : ''); }).join('، ') +
      ': التاريخ المكتوب فيه هو يوم إكماله لا يوم صدوره، لأنه أُكمل بالطريقة القديمة، فيُحسب مبلغه الأول مرة ثانية في يوم الإكمال. صحّح تاريخه إلى تاريخه الأصلي (المكتوب في نسخة الإيصال) لتصح حصيلة الأيام.</p>' : '';
    var filters = warn + '<div class="toolbar" style="align-items:center">' +
      '<select id="led-method" data-ro-ok style="width:auto">' + opt('', 'كل وسائل الدفع', l.method) + Object.keys(PAY_METHODS).map(function (k) { return opt(k, PAY_METHODS[k], l.method); }).join('') + '</select>' +
      '<select id="led-bus" data-ro-ok style="width:auto;max-width:220px">' + opt('', 'كل الباصات', l.bus) + uniq('bus').map(function (v) { return opt(v, v, l.bus); }).join('') + '</select>' +
      '<select id="led-cls" data-ro-ok style="width:auto">' + opt('', 'كل الشعب', l.cls) + uniq('cls').map(function (v) { return opt(v, v, l.cls); }).join('') + '</select>' +
      '<select id="led-issuer" data-ro-ok style="width:auto">' + opt('', 'كل المسجِّلين', l.issuer) + uniq('who').map(function (v) { return opt(v, v, l.issuer); }).join('') + '</select>' +
      '<select id="led-sort" data-ro-ok style="width:auto">' + [['date', 'ترتيب: التاريخ'], ['receipt', 'ترتيب: رقم الإيصال'], ['amount', 'ترتيب: المبلغ'], ['method', 'ترتيب: وسيلة الدفع'], ['name', 'ترتيب: الاسم'], ['bus', 'ترتيب: الباص']].map(function (o) { return opt(o[0], o[1], l.sort); }).join('') + '</select>' +
      '<input type="search" id="led-q" placeholder="اسم الطالب، رقم الإيصال، رقم الدفع أو الهوية" value="' + esc(l.q) + '" style="flex:1;min-width:220px">' +
      '<button type="button" class="btn" data-ledpdf data-ro-ok>طباعة / PDF</button><button type="button" class="btn" data-ledxlsx data-ro-ok>تصدير Excel</button></div>';
    var card = function (lbl, num, sub, color) { return '<div class="card stat"><span class="lbl">' + lbl + '</span><span class="num"' + (color ? ' style="color:' + color + '"' : '') + '>' + num + '</span><span class="sub">' + sub + '</span></div>'; };
    var stats = '<div class="stats">' + card('المحصَّل', plainNum(t.sum) + ' <small>ج.م</small>', t.n + ' إيصالًا', 'var(--green)') +
      Object.keys(PAY_METHODS).filter(function (k) { return t.cnt[k]; }).map(function (k) { return card(PAY_METHODS[k], plainNum(t.by[k]) + ' <small>ج.م</small>', t.cnt[k] + ' إيصالًا'); }).join('') + '</div>';
    var rows = list.map(function (r, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + (r.p.receipt_no != null ? r.p.receipt_no : '—') + '</td><td style="white-space:nowrap">' + dmy(r.day) + '</td>' +
        '<td><b>' + esc(r.name) + '</b><br><span style="color:var(--muted);font-size:.85rem">' + esc(r.cls || '—') + (r.bus ? ' · ' + esc(r.bus) : '') + '</span></td>' +
        '<td>' + tLabel(r.p.month) + '</td><td><b>' + plainNum(r.amount) + '</b></td><td>' + PAY_METHODS[r.method] + '</td>' +
        '<td dir="ltr" style="text-align:right;white-space:nowrap">' + esc(r.method === 'other' ? '' : r.ref) + (r.method === 'other' && r.ref ? '<span dir="rtl">' + esc(r.ref) + '</span>' : '') + '</td>' +
        '<td style="font-size:.85rem">' + esc(r.who || '—') + '<br><span dir="ltr" style="color:var(--muted)">' + esc(issuedWhen(r.p)) + '</span></td></tr>';
    }).join('');
    var days = Object.keys(t.days).sort();
    var daily = days.length > 1 ? '<details class="bank" style="margin-top:12px"><summary>الملخص اليومي (' + days.length + ' يومًا)</summary><div class="table-wrap"><table class="grid"><thead><tr><th>اليوم</th><th>الإيصالات</th>' +
      Object.keys(PAY_METHODS).map(function (k) { return '<th>' + PAY_METHODS[k] + '</th>'; }).join('') + '<th>المجموع</th></tr></thead><tbody>' + days.map(function (d) {
        var v = t.days[d];
        return '<tr><td style="white-space:nowrap">' + dayName(d) + ' ' + dmy(d) + '</td><td>' + v.n + '</td>' + Object.keys(PAY_METHODS).map(function (k) { return '<td>' + (v.by[k] ? plainNum(v.by[k]) : '—') + '</td>'; }).join('') + '<td><b>' + plainNum(v.sum) + '</b></td></tr>';
      }).join('') + '</tbody></table></div></details>' : '';
    return head + filters + stats + ledRefCardHtml(list) + ledExemptCardHtml() +
      '<div class="card"><h2 style="margin-top:0">الدفعات (' + list.length + ')</h2>' + (rows
        ? '<div class="table-wrap"><table class="grid pay"><thead><tr><th>م</th><th>رقم الإيصال</th><th>تاريخ السداد</th><th>الطالب</th><th>عن شهر</th><th>المبلغ (ج.م)</th><th>وسيلة الدفع</th><th>رقم الدفع</th><th>المسجِّل والوقت</th></tr></thead><tbody>' + rows +
          '</tbody><tfoot><tr><td colspan="5">المجموع</td><td>' + plainNum(t.sum) + '</td><td colspan="3"></td></tr></tfoot></table></div>'
        : '<div class="empty">لا توجد دفعات مطابقة.</div>') + daily + '</div>';
  }

  async function exportLedXlsx() {
    var l = ledState();
    if (!l.rows) return;
    var list = ledFiltered(), t = ledTotals(list);
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new(), head = [[schoolName()], ['سجل دفعات المواصلات']].concat(ledDesc().map(function (p) { return [p[0] + ': ' + p[1]]; }), [[]]);
      wb.Workbook = { Views: [{ RTL: true }] };
      var ws = XLSX.utils.aoa_to_sheet(head.concat([['م', 'رقم الإيصال', 'تاريخ السداد', 'اسم الطالب', 'الشعبة', 'الباص', 'عن شهر', 'المبلغ (ج.م)', 'وسيلة الدفع', 'رقم الدفع / ملاحظة', 'المسجِّل', 'وقت التسجيل']],
        list.map(function (r, i) { return [i + 1, r.p.receipt_no != null ? r.p.receipt_no : '', dmy(r.day), r.name, r.cls, r.bus, tLabel(r.p.month), r.amount, PAY_METHODS[r.method], r.ref, r.who, issuedWhen(r.p)]; }),
        [['', '', '', 'المجموع', '', '', '', t.sum]], [[]], [['', 'حسب وسيلة الدفع']],
        Object.keys(PAY_METHODS).map(function (k) { return ['', PAY_METHODS[k], '', 'عدد الإيصالات: ' + t.cnt[k], '', '', '', t.by[k]]; })));
      ws['!cols'] = [5, 11, 12, 32, 14, 24, 14, 12, 14, 20, 20, 17].map(function (w) { return { wch: w }; });
      XLSX.utils.book_append_sheet(wb, ws, 'الدفعات');
      var days = Object.keys(t.days).sort();
      var ws2 = XLSX.utils.aoa_to_sheet(head.concat([['اليوم', 'التاريخ', 'الإيصالات'].concat(Object.keys(PAY_METHODS).map(function (k) { return PAY_METHODS[k] + ' (ج.م)'; }), ['المجموع (ج.م)'])],
        days.map(function (d) { var v = t.days[d]; return [dayName(d), dmy(d), v.n].concat(Object.keys(PAY_METHODS).map(function (k) { return v.by[k] || 0; }), [v.sum]); }),
        [['المجموع', '', t.n].concat(Object.keys(PAY_METHODS).map(function (k) { return t.by[k]; }), [t.sum])]));
      ws2['!cols'] = [12, 12, 10, 12, 12, 14, 12, 14].map(function (w) { return { wch: w }; });
      XLSX.utils.book_append_sheet(wb, ws2, 'الملخص اليومي');
      XLSX.writeFile(wb, ('سجل-الدفعات-' + (l.loadedFrom || l.from) + '-' + (l.loadedTo || l.to)) + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  var pendingLed = false;

  // صفحة غلاف سجل الدفعات: إحصائية المحصَّل حسب وسيلة الدفع، وحسب الرقم المحوَّل إليه لغير النقد، وتشغل صفحة كاملة
  // المعفون في دورات فترة السجل: الطلاب والموظفون (المعلمون وغيرهم)، بلا مبلغ، خارج المحصَّل
  function ledExempts() {
    var l = ledState(), a = currentCycle(l.loadedFrom || l.from), b = currentCycle(l.loadedTo || l.to), keys = [];
    for (var k = a, i = 0; k <= b && i < 24; k = shiftMonth(k, 1), i++) keys.push(k);
    var months = function (m) { return keys.filter(function (k) { return exemptIn(m, k); }); };
    var rows = [];
    S.tMembers.forEach(function (m) {
      var x = findStudent(m.student_id), g = findGroup(m.group_id), ks = x ? months(m) : [];
      if (ks.length) rows.push({ staff: false, name: x.full_name, cls: x.class_name || '', bus: g ? g.assembly_point : '', ks: ks, note: m.exempt_note || '' });
    });
    (S.sMembers || []).forEach(function (m) {
      var t = find(m.staff_id), g = findGroup(m.group_id), ks = t ? months(m) : [];
      if (ks.length) rows.push({ staff: true, name: t.name, cls: 'موظف', bus: g ? g.assembly_point : '', ks: ks, note: m.exempt_note || '' });
    });
    rows.sort(function (p, q) { return (p.staff - q.staff) || p.name.localeCompare(q.name, 'ar'); });
    return { rows: rows, students: rows.filter(function (r) { return !r.staff; }).length, staff: rows.filter(function (r) { return r.staff; }).length };
  }
  function ledExemptTable(E, print) {
    var th = print ? 'th' : 'th';
    return '<table class="' + (print ? 'rz' : 'grid') + '"><thead><tr><' + th + '>م</' + th + '><' + th + '>الاسم</' + th + '><' + th + '>الشعبة</' + th + '><' + th + '>الباص</' + th + '><' + th + '>دورات الإعفاء</' + th + '><' + th + '>السبب</' + th + '></tr></thead><tbody>' +
      E.rows.map(function (r, i) {
        return '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(r.name) + (r.staff ? ' <b style="color:#6d28d9">(موظف)</b>' : '') + '</td><td class="c">' + esc(r.cls) + '</td><td class="c">' + esc(r.bus) + '</td>' +
          '<td class="c">' + r.ks.map(tLabel).join('، ') + '</td><td>' + esc(r.note) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function ledExemptCardHtml() {
    var E = ledExempts();
    if (!E.rows.length) return '';
    return '<div class="card"><h2 style="margin-top:0">المعفون في هذه الفترة — طلاب: ' + E.students + '، موظفون: ' + E.staff + '</h2>' +
      '<p class="hint">لا مبلغ لهم، ولا يدخلون في المحصَّل ولا المطلوب.</p><div class="table-wrap">' + ledExemptTable(E) + '</div></div>';
  }

  function ledCoverHtml(list, t) {
    var R = ledRefSummary(list), pct = function (v) { return t.sum ? Math.round(v / t.sum * 1000) / 10 + '%' : '—'; };
    var th = function (a) { return '<tr>' + a.map(function (x) { return '<th>' + x + '</th>'; }).join('') + '</tr>'; };
    var methods = Object.keys(PAY_METHODS).filter(function (k) { return t.cnt[k]; });
    var refs = R.rows.filter(function (g) { return g.method !== 'cash'; });
    return '<div class="led-cover" style="min-height:262mm;break-after:page;page-break-after:always;padding-top:12mm">' + letterhead() +
      '<div class="rt" style="margin-top:12mm"><h1>إحصائية دفعات المواصلات</h1><div class="rt-info">' +
        ledDesc().concat([['تاريخ الإصدار', dmy(todayISO())]]).map(function (p) { return '<span><b>' + p[0] + ':</b> ' + esc(p[1]) + '</span>'; }).join('') + '</div></div>' +
      '<div class="rbox" style="margin:8mm 0;text-align:center;padding:7mm 6mm"><div style="font-size:1.2em;margin-bottom:3mm">إجمالي المحصَّل</div>' +
        '<div style="font-family:var(--font-head);font-size:3em;font-weight:800;color:var(--navy-dark);line-height:1.2">' + plainNum(t.sum) + ' <span style="font-size:.4em">ج.م</span></div>' +
        '<div style="margin-top:3mm">' + t.n + ' إيصالًا</div></div>' +
      '<div class="rsec">حسب وسيلة الدفع</div><table class="rz"><thead>' + th(['وسيلة الدفع', 'عدد الإيصالات', 'المبلغ (ج.م)', 'النسبة']) + '</thead><tbody>' +
        methods.map(function (k) { return '<tr><td class="c"><b>' + PAY_METHODS[k] + '</b></td><td class="c">' + t.cnt[k] + '</td><td class="c"><b>' + plainNum(t.by[k]) + '</b></td><td class="c">' + pct(t.by[k]) + '</td></tr>'; }).join('') +
        '<tr class="total"><td class="c">المجموع</td><td class="c">' + t.n + '</td><td class="c">' + plainNum(t.sum) + '</td><td class="c">100%</td></tr></tbody></table>' +
      (refs.length ? '<div class="rsec">حسب الرقم المحوَّل إليه</div><table class="rz"><thead>' + th(['وسيلة الدفع', 'الرقم المحوَّل إليه', 'عدد الدفعات', 'المبلغ (ج.م)', 'النسبة']) + '</thead><tbody>' +
        refs.map(function (g) { return '<tr><td class="c">' + PAY_METHODS[g.method] + '</td><td class="c" dir="ltr"><b>' + esc(ledRefLabel(g)) + '</b></td><td class="c">' + g.n + '</td><td class="c"><b>' + plainNum(g.sum) + '</b></td><td class="c">' + pct(g.sum) + '</td></tr>'; }).join('') + '</tbody></table>' : '') +
      (function () { var E = ledExempts(); return E.rows.length ? '<div class="rsec">الإعفاءات (بلا مبلغ، خارج المحصَّل) — طلاب: ' + E.students + '، موظفون: ' + E.staff + '</div>' + ledExemptTable(E, true) : ''; })() +
      '</div>';
  }

  function buildLedSheet() {
    var list = ledFiltered(), t = ledTotals(list), n = 10;
    var head = reportHead('سجل دفعات المواصلات', ledDesc().concat([['عدد الإيصالات', t.n], ['المحصَّل', plainNum(t.sum) + ' ج.م']]).concat(Object.keys(PAY_METHODS).filter(function (k) { return t.cnt[k]; }).map(function (k) {
      return [PAY_METHODS[k], plainNum(t.by[k]) + ' ج.م (' + t.cnt[k] + ')'];
    }))).replace(/^<img class="wm"[^>]*>/, '');
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' + ledCoverHtml(list, t) +
      '<table class="rz"><thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>' +
      '<tr><th>م</th><th>رقم الإيصال</th><th>التاريخ</th><th>اسم الطالب</th><th>الشعبة</th><th>عن شهر</th><th>المبلغ</th><th>الوسيلة</th><th>رقم الدفع</th><th>المسجِّل</th></tr></thead><tbody>' +
      list.map(function (r, i) {
        return '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + (r.p.receipt_no != null ? r.p.receipt_no : '') + '</td><td class="c" style="white-space:nowrap">' + dmy(r.day) + '</td>' +
          '<td>' + esc(r.name) + '</td><td class="c">' + esc(r.cls) + '</td><td class="c">' + tLabel(r.p.month) + '</td><td class="c"><b>' + plainNum(r.amount) + '</b></td>' +
          '<td class="c">' + PAY_METHODS[r.method] + '</td><td class="c" dir="ltr">' + esc(r.ref) + '</td><td class="c">' + esc(r.who) + '</td></tr>';
      }).join('') +
      '<tr class="total"><td colspan="6">المجموع</td><td class="c">' + plainNum(t.sum) + '</td><td colspan="3"></td></tr></tbody>' +
      '<tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>';
  }

  app.addEventListener('click', function (e) {
    if (location.hash !== '#/transport/ledger' || !canTransport()) return;
    if (e.target.closest('[data-ledrun]')) loadLedger();
    else if (e.target.closest('[data-ledxlsx]')) exportLedXlsx();
    else if (e.target.closest('[data-ledpdf]')) { if (ledState().rows) { pendingLed = true; printNow(); } }
  });

  app.addEventListener('change', function (e) {
    if (location.hash !== '#/transport/ledger' || !canTransport()) return;
    var el = e.target, l = ledState(), map = { 'led-from': 'from', 'led-to': 'to', 'led-method': 'method', 'led-bus': 'bus', 'led-cls': 'cls', 'led-issuer': 'issuer', 'led-sort': 'sort' };
    if (!map[el.id]) return;
    l[map[el.id]] = el.value;
    if (el.id !== 'led-from' && el.id !== 'led-to') render();
  });

  // «إلغاء التثبيت»: يُمسح المطلوب المحفوظ مع إيصالات الأسرة فيعود محسوبًا بالقاعدة (الأول 700 ومن بعده 600)
  app.addEventListener('click', async function (e) {
    var el = e.target.closest('[data-famunfreeze]');
    if (!el || !isAdmin() || location.hash !== '#/transport/payments') return;
    var ids = el.getAttribute('data-famunfreeze').split(','), pay = S.tPay[ui.tMonth] || {};
    if (!confirm('إلغاء تثبيت المطلوب لهذه الأسرة عن ' + tLabel(ui.tMonth) + '؟ يعود المطلوب محسوبًا بالقاعدة، ولا يتغير أي إيصال.')) return;
    for (var i = 0; i < ids.length; i++) {
      var r = await sb.from('transport_payments').update({ due: null }).eq('student_id', ids[i]).eq('month', ui.tMonth);
      if (r.error) return fail(r.error);
      if (pay[ids[i]]) pay[ids[i]].due = null;
    }
    refreshPay();
    toast('أُلغي التثبيت');
  });

  // «تثبيت كما في الإيصالات»: لكل إيصال في الأسرة يُحفظ «المطلوب» مساويًا لمبلغه. لا يتغير مبلغ ولا رقم ولا وسيلة
  app.addEventListener('click', async function (e) {
    var el = e.target.closest('[data-famfreeze]');
    if (!el || !isAdmin() || location.hash !== '#/transport/payments') return;
    var ids = el.getAttribute('data-famfreeze').split(','), pay = S.tPay[ui.tMonth] || {};
    var names = ids.map(function (id) { var x = findStudent(id); return (x ? x.full_name : id) + ': ' + plainNum((pay[id] || {}).amount || 0); });
    if (!confirm('تثبيت المطلوب لهذه الأسرة عن ' + tLabel(ui.tMonth) + ' كما في إيصالاتها المطبوعة؟\n\n' + names.join('\n') +
      '\n\nلا يتغير أي إيصال ولا مبلغ مدفوع؛ يصير المطلوب من كل أخ هو مبلغ إيصاله، فتختفي الأسرة من قائمة المراجعة.')) return;
    for (var i = 0; i < ids.length; i++) {
      var rec = pay[ids[i]];
      if (!rec || !(rec.amount > 0)) continue;
      var r = await sb.from('transport_payments').update({ due: rec.amount }).eq('student_id', ids[i]).eq('month', ui.tMonth);
      if (r.error) return fail(r.error);
      rec.due = rec.amount;
    }
    refreshPay();
    toast('ثُبِّت المطلوب كما في الإيصالات');
  });

  app.addEventListener('toggle', function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute('data-famaudit')) ui.famAuditOpen = e.target.open;
  }, true);

  app.addEventListener('input', function (e) {
    if (location.hash !== '#/transport/ledger' || e.target.id !== 'led-q') return;
    ledState().q = e.target.value;
    var pos = e.target.selectionStart;
    render();
    var box = document.getElementById('led-q');
    if (box) { box.focus(); box.setSelectionRange(pos, pos); }
  });

  function issuedWhen(rec) {
    var at = rec.issued_at || rec.updated_at, d = at ? new Date(at) : null;
    if (!d || isNaN(d)) return '';
    var two = function (n) { return ('0' + n).slice(-2); };
    return two(d.getDate()) + '/' + two(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }

  // «سجّله فلان · 12/10/2026 14:35»
  function issuedNote(rec) {
    var when = issuedWhen(rec);
    return (rec.issued_by ? 'سجّله ' + rec.issued_by : 'المسجِّل غير معروف') + (when ? ' · ' + when : '');
  }

  // patch: ما تغيّر في دفعة الطالب لهذا الشهر (المبلغ أو طريقة الدفع)
  // خانتا المبلغ ووسيلة الدفع في الجداول للعرض: الإيصال المسجَّل لا يُعدَّل يدويًا
  function receiptCells(paid, rec) {
    if (!(paid > 0)) return '<td style="color:var(--muted)">—</td><td style="color:var(--muted)">لم يصدر إيصال</td>';
    return '<td><b>' + plainNum(paid) + '</b></td><td>' + esc(PAY_METHODS[rec.method] ? PAY_METHODS[rec.method] : PAY_METHODS.cash) +
      (rec.method_note ? '<br><span dir="ltr" style="color:var(--muted);font-size:.85rem">' + esc(rec.method_note) + '</span>' : '') + '</td>';
  }

  /* الإيصال المسجَّل لا يُعدَّل عشوائيًا: لا يُخفَّض مبلغه ولا تُغيَّر وسيلة دفعه ولا رقم دفعه من هنا.
     التخفيض بـ«الاسترداد» (يُسجَّل في سجل المستردات)، والتصحيح بـ«حذف الإيصال» (يُحفظ في الأرشيف بسببه) ثم إصدار إيصال جديد.
     يُسمح فقط بالزيادة: دفعة مكمِّلة لمن دفع جزءًا، بالوسيلة نفسها */
  function receiptChangeBlocked(old, patch) {
    if (!(old.amount > 0)) return '';
    if ('amount' in patch && Number(patch.amount) < old.amount) return 'لا يُخفَّض مبلغ إيصال مسجَّل. استخدم «استرداد»، أو احذف الإيصال (يُحفظ في الأرشيف) وأصدر إيصالًا جديدًا.';
    // بعد supabase/transport_topups.sql: الباقي إيصال جديد بمبلغه، لا رفعًا لمبلغ الإيصال الأول
    if (!S.topupMissing && 'amount' in patch && Number(patch.amount) > old.amount) return 'الباقي يُسجَّل بإيصال جديد: افتح «إصدار إيصال» على الطالب وسجّل الدفعة المكمِّلة.';
    if ('method' in patch && patch.method !== (old.method || 'cash')) return 'لا تُغيَّر وسيلة دفع إيصال مسجَّل. احذف الإيصال (يُحفظ في الأرشيف) وأصدر إيصالًا جديدًا بالوسيلة الصحيحة.';
    if ('method_note' in patch && String(patch.method_note || '') !== String(old.method_note || '')) return 'لا يُغيَّر رقم الدفع في إيصال مسجَّل. احذف الإيصال (يُحفظ في الأرشيف) وأصدر إيصالًا جديدًا.';
    return '';
  }

  async function setPayment(studentId, patch) {
    var old = S.tPay[ui.tMonth][studentId] || {};
    var blocked = receiptChangeBlocked(old, patch);
    if (blocked) { toast(blocked, true); if (currentGroup()) render(); else refreshPay(); return; }
    var row = {
      student_id: studentId, month: ui.tMonth,
      amount: old.amount || 0, method: old.method || 'cash', method_note: old.method_note || '',
      paid_on: old.paid_on || todayISO(), updated_at: new Date().toISOString()
    };
    Object.assign(row, patch);
    row.amount = Math.max(0, Number(row.amount) || 0);
    // إيصال جديد: يُحفظ معه المطلوب وقت إصداره، فلا يتغير بعد ذلك. الدفعة المكمِّلة تُبقي مطلوبه الأول
    if (!S.dueMissing) {
      if (old.amount > 0) { if (old.due != null) row.due = old.due; }
      else if (row.amount > 0) { var mm = memberOf(studentId); if (mm) row.due = Math.max(0, shareOf(mm) - (Number(patch.discount) || 0)); }
    }
    if (!(Number(patch.discount) > 0)) { delete row.discount; delete row.discount_reason; }
    // الملاحظة تخص طريقة الدفع التي كُتبت لها: تُمسح عند تغيير الطريقة، ولا ملاحظة للنقد
    if (row.method === 'cash' || ('method' in patch && !('method_note' in patch) && patch.method !== (old.method || 'cash'))) row.method_note = '';
    if ('amount' in patch) row.paid_on = todayISO();
    // من سجّل المبلغ ومتى (يتجدد عند تغيير المبلغ، لا عند تعديل طريقة الدفع)
    if (!S.issuerMissing) {
      var stamp = 'amount' in patch && row.amount !== (old.amount || 0);
      row.issued_by = stamp || !old.issued_by ? (S.profile && S.profile.full_name) || displayName(S.email) : old.issued_by;
      row.issued_at = stamp || !old.issued_at ? row.updated_at : old.issued_at;
    }
    var r = await sb.from('transport_payments').upsert(row, { onConflict: 'student_id,month' }).select().single();
    if (r.error) return fail(r.error);
    row.receipt_no = r.data ? r.data.receipt_no : old.receipt_no;
    if (r.data && r.data.discount != null) { row.discount = r.data.discount; row.discount_reason = r.data.discount_reason; }
    S.tPay[ui.tMonth][studentId] = row;
    await refreshFirstPaid(studentId);
    if (currentGroup()) render(); else refreshPay();
    toast('تم الحفظ');
  }

  // إيصال سداد اشتراك المواصلات لطالب عن الشهر المعروض
  var pendingReceipt = null;


  document.addEventListener('click', async function (e) {
    if (!canTransport() || !/^#\/transport/.test(location.hash)) return;
    // المسجِّل: الباصات وإصدار الإيصالات فقط
    if (isRegistrar() && e.target.closest(REG_T_BLOCK)) return;
    var el, g = currentGroup(), r;
    if ((el = e.target.closest('[data-tgo]'))) return go(el.getAttribute('data-tgo'));
    if (e.target.closest('[data-rcfind]')) return deskSearch();
    if ((el = e.target.closest('[data-mrefund]'))) {
      // الاسترداد يُسجَّل من شاشة الإيصال: تُفتح على هذا الطالب ونموذج الاسترداد ظاهر
      ui.rcStudent = el.getAttribute('data-mrefund');
      ui.rcQuery = findStudent(ui.rcStudent).national_id || '';
      ui.rcRefund = true;
      return go('#/transport/receipt');
    }
    if (e.target.closest('[data-rcrefund]') || e.target.closest('[data-rfcancel]')) {
      if (ui.rcStaff ? S.staffRefundMissing : S.refundMissing) return toast(ui.rcStaff ? STAFF_REFUND_SQL_MSG : REFUND_SQL_MSG, true);
      ui.rcRefund = !e.target.closest('[data-rfcancel]');
      document.getElementById('rc-body').innerHTML = deskBodyHtml();
      var rfBox = document.getElementById('rf-reason');
      if (rfBox) { rfBox.scrollIntoView({ block: 'center' }); rfBox.focus(); }
      return;
    }
    if ((el = e.target.closest('[data-rfsave]'))) return saveRefund(el.getAttribute('data-rfsave') === 'print');
    if ((el = e.target.closest('[data-rfprint]'))) {
      pendingRefund = allRefunds().filter(function (v) { return v.id === el.getAttribute('data-rfprint'); })[0] || null;
      if (pendingRefund) printNow();
      return;
    }
    if (e.target.closest('[data-rfxlsx]')) return exportRefundsXlsx();
    if ((el = e.target.closest('[data-mvoid]'))) return voidReceipt(el.getAttribute('data-mvoid'));
    if ((el = e.target.closest('[data-mdesk]'))) return openDesk(el.getAttribute('data-mdesk'));
    if ((el = e.target.closest('[data-mexempt]'))) {
      ui.exemptFor = el.getAttribute('data-mexempt');
      var exg = el.getAttribute('data-mexemptg');
      if (exg && location.hash !== '#/transport/' + exg) go('#/transport/' + exg); else render();
      window.scrollTo(0, 0);
      return;
    }
    if (e.target.closest('[data-exsave]')) return saveExempt(false);
    if (e.target.closest('[data-exdel]')) return saveExempt(true);
    if (e.target.closest('[data-excancel]')) { ui.exemptFor = null; return render(); }
    if ((el = e.target.closest('[data-busprint]'))) {
      pendingBus = findGroup(el.getAttribute('data-busprint'));
      return pendingBus ? printNow() : null;
    }
    if ((el = e.target.closest('[data-latestate]'))) { ui.lateState = el.getAttribute('data-latestate'); return render(); }
    if ((el = e.target.closest('[data-suspend]'))) {
      var sx = findStudent(el.getAttribute('data-suspend'));
      if (!sx || !confirm('تعليق «' + sx.full_name + '» عن ركوب الباص لشهر ' + tLabel(ui.tMonth) + '؟')) return;
      return updateMember(sx.id, suspendPatch(true), 'عُلِّق عن الركوب');
    }
    if ((el = e.target.closest('[data-unsuspend]'))) return updateMember(el.getAttribute('data-unsuspend'), suspendPatch(false), 'رُفع التعليق');
    if ((el = e.target.closest('[data-gracegive]'))) {
      var gsid = el.getAttribute('data-gracegive'), until = (document.getElementById('grace-' + gsid) || {}).value;
      if (!until || until < todayISO()) return toast('اختر تاريخًا من اليوم فصاعدًا', true);
      return updateMember(gsid, Object.assign(suspendPatch(false), { grace_until: until }), 'مُنح مهلة حتى ' + dmy(until));
    }
    if (e.target.closest('[data-suspendall]')) return suspendAllLate();
    if (e.target.closest('[data-latexlsx]')) return exportLateXlsx();
    if ((el = e.target.closest('[data-mstop]'))) return setSubscription(el.getAttribute('data-mstop'), true);
    if ((el = e.target.closest('[data-mresume]'))) return setSubscription(el.getAttribute('data-mresume'), false);
    if (e.target.closest('[data-voidxlsx]')) return exportVoidedXlsx();
    if ((el = e.target.closest('[data-voidrestore]'))) return restoreVoided(el.getAttribute('data-voidrestore'));
    if ((el = e.target.closest('[data-rcpick]'))) {
      ui.rcStudent = el.getAttribute('data-rcpick');
      ui.rcStaff = null;
      ui.rcMethod = '';
      ui.rcRefund = false;
      document.getElementById('rc-body').innerHTML = deskBodyHtml();
      var amountBox = document.getElementById('rc-amount');
      if (amountBox) { amountBox.focus(); amountBox.select(); }
      return;
    }
    if ((el = e.target.closest('[data-rcsave]'))) return deskSave(el.getAttribute('data-rcsave') === 'print');
    if ((el = e.target.closest('[data-rcjoin]'))) {
      var joinId = el.getAttribute('data-rcjoin'), groupId = document.getElementById('rc-group').value;
      if (!groupId) return toast('اختر الباص أولًا.', true);
      if (!findStudent(joinId) || !enrolled(findStudent(joinId))) return toast('يُضاف إلى الباصات المسجَّلون نهائيًا فقط.', true);
      r = await sb.from('transport_members').upsert(memberRow(joinId, groupId), { onConflict: 'student_id' });
      if (r.error) return fail(r.error);
      S.tMembers = S.tMembers.filter(function (k) { return k.student_id !== joinId; });
      S.tMembers.push({ student_id: joinId, group_id: groupId, share: null });
      document.getElementById('rc-body').innerHTML = deskBodyHtml();
      return;
    }
    if ((el = e.target.closest('[data-tpx]'))) return el.getAttribute('data-tpx') === 'xlsx' ? exportPayXlsx() : el.getAttribute('data-tpx') === 'contacts' ? exportTransportContacts() : exportPayPdf();
    if ((el = e.target.closest('[data-tpstatus]'))) {
      ui.tpStatus = el.getAttribute('data-tpstatus');
      return refreshPay();
    }
    if ((el = e.target.closest('[data-tpclass]'))) {
      ui.tpClass = el.getAttribute('data-tpclass');
      ui.tpStatus = ''; ui.tpSearch = '';
      return go('#/transport/payments');
    }
    if ((el = e.target.closest('[data-gedit]'))) {
      ui.editGroup = el.getAttribute('data-gedit') || null;
      render();
      var first = document.getElementById('gf-point');
      if (first) { first.focus(); first.scrollIntoView({ block: 'center' }); }
    } else if ((el = e.target.closest('[data-gdel]'))) {
      if (!confirm('هل تريد حذف مجموعة «' + g.assembly_point + '»؟ يُزال طلابها من المواصلات وتبقى مدفوعاتهم محفوظة.')) return;
      r = await sb.from('transport_groups').delete().eq('id', g.id);
      if (r.error) return fail(r.error);
      S.tGroups = S.tGroups.filter(function (x) { return x.id !== g.id; });
      S.tMembers = S.tMembers.filter(function (m) { return m.group_id !== g.id; });
      go('#/transport');
    } else if (g && (el = e.target.closest('[data-madd]'))) {
      var sid = el.getAttribute('data-madd');
      if (!findStudent(sid) || !enrolled(findStudent(sid))) return toast('يُضاف إلى الباصات المسجَّلون نهائيًا فقط.', true);
      // الطالب في مجموعة واحدة: إن كان في غيرها يُنقل إلى هذه
      r = await sb.from('transport_members').upsert(memberRow(sid, g.id), { onConflict: 'student_id' });
      if (r.error) return fail(r.error);
      S.tMembers = S.tMembers.filter(function (m) { return m.student_id !== sid; });
      S.tMembers.push({ student_id: sid, group_id: g.id, share: null });
      render();
      var box = document.getElementById('t-search');
      if (box) box.focus();
    } else if (g && (el = e.target.closest('[data-mdel]'))) {
      var rid = el.getAttribute('data-mdel');
      if (!confirm('إزالة «' + findStudent(rid).full_name + '» من المجموعة؟')) return;
      r = await sb.from('transport_members').delete().eq('student_id', rid);
      if (r.error) return fail(r.error);
      S.tMembers = S.tMembers.filter(function (m) { return m.student_id !== rid; });
      render();
    } else if ((el = e.target.closest('[data-mfull]'))) {
      var fid = el.getAttribute('data-mfull');
      var mem = S.tMembers.filter(function (m) { return m.student_id === fid; })[0];
      // دفع جزءًا من قبل: الباقي إيصال جديد يصدر من شاشة الإيصال (بالمبلغ الباقي جاهزًا)، لا يُرفع الإيصال الأول
      if ((((S.tPay[ui.tMonth] || {})[fid] || {}).amount || 0) > 0) return openDesk(fid);
      setPayment(fid, { amount: shareOf(mem, findGroup(mem.group_id)) });
    } else if ((el = e.target.closest('[data-mreceipt]'))) {
      var rq = el.getAttribute('data-mreceipt').split('|');
      pendingReceipt = { sid: rq[0], no: rq[1] || '' };
      printNow();
    }
  });

  app.addEventListener('change', async function (e) {
    if (!canTransport() || !/^#\/transport/.test(location.hash)) return;
    var el = e.target, g = currentGroup();
    if (isRegistrar() && (REG_T_IDS.indexOf(el.id) > -1 || el.matches(REG_T_INPUTS))) return;
    if (el.id === 'rc-method') {
      // خانة رقم الدفع تظهر وتختفي بحسب الطريقة، مع بقاء المبلغ المكتوب
      var typed = document.getElementById('rc-amount').value;
      ui.rcMethod = el.value;
      document.getElementById('rc-body').innerHTML = deskBodyHtml();
      document.getElementById('rc-amount').value = typed;
      var noteBox = document.getElementById('rc-note');
      if (noteBox) noteBox.focus();
    } else if (el.id === 'fee-first' || el.id === 'fee-next') {
      var cfgNow = classConfig();
      saveClassConfig({ rooms: cfgNow.rooms, list: cfgNow.list, fees: {
        first: Math.max(0, Number(document.getElementById('fee-first').value) || 0),
        next: Math.max(0, Number(document.getElementById('fee-next').value) || 0), dueDay: payDueDay() } });
    } else if (el.id === 'cyc-start' || el.id === 'cyc-grace') {
      var ccNow = cycleCfg(), sdv = Math.round(Number(document.getElementById('cyc-start').value)), gdv = Math.round(Number(document.getElementById('cyc-grace').value));
      if (!(sdv >= 1 && sdv <= 28) || !(gdv >= 0 && gdv <= 27)) { render(); return toast('يوم البداية من 1 إلى 28، والمهلة من 0 إلى 27 يومًا', true); }
      saveCycles({ startDay: sdv, graceDays: gdv, over: ccNow.over });
    } else if (el.hasAttribute('data-cyc')) {
      var cq = el.getAttribute('data-cyc').split('|');
      cycleEdit(cq[0], cq[1], el.value);
    } else if (el.id === 'fee-due') {
      var cfgDue = classConfig(), feesNow = transportFees();
      saveClassConfig({ rooms: cfgDue.rooms, list: cfgDue.list, fees: { first: feesNow.first, next: feesNow.next, dueDay: Math.min(28, Math.max(1, Math.round(Number(el.value) || 5))) } });
    } else if (el.hasAttribute('data-mpickup')) {
      var pid = el.getAttribute('data-mpickup'), pval = el.value.trim();
      var pr = await sb.from('transport_members').update({ pickup: pval }).eq('student_id', pid);
      if (pr.error) return fail(pr.error);
      S.tMembers.forEach(function (m) { if (m.student_id === pid) m.pickup = pval; });
      toast('تم الحفظ');
    } else if (el.id === 't-month') {
      if (!el.value) return;
      ui.tMonth = el.value;
      render();
    } else if (el.id === 'tp-class') {
      ui.tpClass = el.value;
      ui.tpStatus = '';
      refreshPay();
    } else if (el.hasAttribute('data-mpaid')) {
      setPayment(el.getAttribute('data-mpaid'), { amount: el.value });
    } else if (el.hasAttribute('data-mmethod')) {
      setPayment(el.getAttribute('data-mmethod'), { method: el.value });
    } else if (el.hasAttribute('data-mnote')) {
      setPayment(el.getAttribute('data-mnote'), { method_note: el.value.trim() });
    } else if (g && el.hasAttribute('data-mshare')) {
      var sid = el.getAttribute('data-mshare');
      var share = el.value === '' ? null : Math.max(0, Number(el.value) || 0);
      var r = await sb.from('transport_members').update({ share: share }).eq('student_id', sid);
      if (r.error) return fail(r.error);
      S.tMembers.forEach(function (m) { if (m.student_id === sid) m.share = share; });
      document.getElementById('t-members').innerHTML = membersTableHtml(g);
      toast('تم الحفظ');
    }
  });

  app.addEventListener('keydown', function (e) {
    if (!(isAdmin() || isRegistrar()) || location.hash !== '#/transport/receipt' || e.key !== 'Enter') return;
    if (e.target.id === 'rc-id') { e.preventDefault(); deskSearch(); }
    else if (e.target.id === 'rc-amount' || e.target.id === 'rc-note') { e.preventDefault(); deskSave(true); }
  });

  app.addEventListener('input', function (e) {
    if (e.target.id === 'rc-disc') {
      var amt = document.getElementById('rc-amount');
      if (amt && amt.getAttribute('data-share')) amt.value = Math.max(0, Number(amt.getAttribute('data-share')) - (Number(e.target.value) || 0));
      return;
    }
    var g = currentGroup();
    if (e.target.id === 'tp-search' && canTransport()) {
      ui.tpSearch = e.target.value;
      return refreshPay();
    }
    if (e.target.id !== 't-search' || !g) return;
    ui.tSearch = e.target.value;
    document.getElementById('t-cands').innerHTML = candidatesHtml(g);
  });

  /* ----- اقتراح نقاط التجمع من عناوين السكن ----- */

  // الطلاب الذين لهم عنوان وليسوا في أي مجموعة مواصلات (ولم يُسجَّل أنهم لا يريدون مواصلات)
  function clusterPool(includePending) {
    var inGroup = transportGroupOf();
    return S.students.filter(function (x) {
      return !inGroup[x.id] && x.wants_transport !== false && String(x.address || '').trim() && (includePending || enrolled(x));
    });
  }

  // لا يُرسَل إلا رقم تسلسلي ونص العنوان: بلا أسماء ولا أرقام هوية ولا هواتف
  function clusterPayload(pool) {
    return {
      addresses: pool.map(function (x, i) { return { n: i + 1, a: String(x.address).replace(/\s+/g, ' ').trim() }; }),
      existing: S.tGroups.map(function (g) { return g.assembly_point; })
    };
  }

  // نص جاهز للصق في محادثة مع Claude عند عدم توفر الخدمة الآلية
  function clusterPromptText(payload) {
    return 'أمامك عناوين سكن طلاب مدرسة كتبها أولياء الأمور نصًّا حرًّا. اجمعها في «نقاط تجمع» للمواصلات.\n' +
      '- كل اسم مكان يرد في العناوين (حي، كمبوند، مَعلم، منطقة فرعية) هو نقطة تجمع، وكل عنوان يذكره ينضم إليها مهما اختلفت طريقة كتابته. مثال: «حي السفارات» نقطة تجمع، وكل عنوان فيه «السفارات» ينضم إليها.\n' +
      '- أنشئ المجموعة ولو كان فيها طالب واحد. اختر لكل عنوان أدق مكان مذكور فيه (الحي أو الكمبوند لا المدينة كلها).\n' +
      '- سمِّ كل مجموعة بالاسم كما ورد في العناوين دون اختراع أماكن، واكتب في area المنطقة الأوسع.\n' +
      '- لا تضع في unclear إلا العنوان الذي لا يذكر أي مكان. كل رقم يظهر مرة واحدة فقط.' +
      (payload.existing.length ? '\nنقاط تجمع موجودة (استخدم الاسم نفسه إن انطبق): ' + payload.existing.join('، ') : '') +
      '\n\nأجب بـ JSON فقط بهذا الشكل دون أي شرح:\n{"clusters":[{"name":"اسم نقطة التجمع","area":"المنطقة الأوسع","members":[1,2]}],"unclear":[3]}' +
      '\n\nالعناوين (الرقم: النص):\n' + payload.addresses.map(function (x) { return x.n + ': ' + x.a; }).join('\n');
  }

  /* --- مطابقة العناوين بأسماء الأماكن دون ذكاء اصطناعي --- */

  // صيغة للمقارنة تتجاهل المسافات والهمزات: «جاردينيا سيتي» = «جاردينياسيتي»
  function compact(text) { return norm(text).replace(/[\s\/,،\-–.()؛:]+/g, ''); }

  // كلمات لا تدل على مكان بذاتها، يُقطع عندها العنوان
  var ADDR_BREAK = ['شارع', 'ش', 'عماره', 'عمارات', 'شقه', 'برج', 'رقم', 'بجوار', 'امام', 'خلف', 'الدور', 'دور', 'منزل', 'بيت', 'متفرع', 'من', 'في', 'علي', 'عند', 'بلوك', 'قطعه', 'مدخل', 'قرب', 'مقابل', 'بعد', 'قبل', 'و'];
  var ADDR_GENERIC = ['حي', 'الحي', 'مدينه', 'منطقه', 'كمبوند', 'مساكن', 'ابراج', 'مفترق', 'ميدان', 'محطه'];

  // كلمات العنوان بصيغتيها: كما كُتبت (o) وموحّدة للمقارنة (n)، مقسّمة إلى مقاطع عند الفواصل والأرقام
  function addrSegments(address) {
    return String(address).replace(/[0-9٠-٩]+/g, ' | ').split(/[\/,،\-–.|()؛:]+/).map(function (seg) {
      return seg.trim().split(/\s+/).filter(Boolean).map(function (word) { return { o: word, n: norm(word) }; })
        .filter(function (t) { return t.n; });
    });
  }

  // تجميع محلي دون ذكاء اصطناعي: كل اسم مكان يتكرر في عنوانين فأكثر يصير نقطة تجمع، وكل عنوان يذكره ينضم إليها.
  // - الكلمات التي ترد في أكثر من خُمس العناوين (كاسم المدينة) تُعدّ منطقة عامة لا نقطة تجمع.
  // - «حي السفارات» و«السفارات» مكان واحد: الكلمات العامة (حي، كمبوند…) لا تدخل في المقارنة.
  // - يُلحق العنوان بأدق مكان يذكره ما دام يجمع ثلاثة فأكثر، وإلا فبأكبر مكان يذكره.
  function localClusters(pool) {
    var segs = pool.map(function (x) { return addrSegments(x.address); });
    var limit = Math.max(3, pool.length * 0.2);
    var best = function (obj) { return Object.keys(obj).sort(function (a, b) { return obj[b] - obj[a]; })[0]; };

    var tokenDf = {};
    segs.forEach(function (list) {
      var seen = {};
      list.forEach(function (seg) { seg.forEach(function (t) { seen[t.n] = true; }); });
      Object.keys(seen).forEach(function (n) { tokenDf[n] = (tokenDf[n] || 0) + 1; });
    });
    var broad = function (n) { return tokenDf[n] > limit && ADDR_GENERIC.indexOf(n) < 0 && ADDR_BREAK.indexOf(n) < 0; };

    // لكل عنوان: أسماء الأماكن فيه { المفتاح: النص كما كُتب }، واسم منطقته العامة
    var places = [], areaOf = [];
    segs.forEach(function (list) {
      var out = {}, areas = [];
      list.forEach(function (seg) {
        var run = [], area = [];
        var flush = function () {
          for (var i = 0; i < run.length; i++) {
            for (var n = 1; n <= 3 && i + n <= run.length; n++) {
              var part = run.slice(i, i + n);
              if (ADDR_GENERIC.indexOf(part[n - 1].n) > -1) continue; // لا ينتهي اسم المكان بكلمة عامة
              var key = part.filter(function (t) { return ADDR_GENERIC.indexOf(t.n) < 0; }).map(function (t) { return t.n; }).join('');
              if (key.length < 3) continue;
              var text = part.map(function (t) { return t.o; }).join(' ');
              // يُفضَّل النص الأطول للمفتاح نفسه: «حي السفارات» على «السفارات»
              if (!out[key] || text.length > out[key].length) out[key] = text;
            }
          }
          run = [];
        };
        var flushArea = function () { if (area.length) areas.push(area.join(' ')); area = []; };
        for (var j = 0; j < seg.length; j++) {
          var t = seg[j];
          // «مدينة» قبل «نصر»: الكلمة العامة تتبع اسم المنطقة الذي يليها
          var next = seg[j + 1];
          if (broad(t.n) || (ADDR_GENERIC.indexOf(t.n) > -1 && next && broad(next.n))) { flush(); area.push(t.o); continue; }
          flushArea();
          if (ADDR_BREAK.indexOf(t.n) > -1) flush(); else run.push(t);
        }
        flush(); flushArea();
      });
      places.push(out);
      areaOf.push(areas.sort(function (a, b) { return b.length - a.length; })[0] || '');
    });

    var df = {}, surface = {};
    places.forEach(function (set) {
      Object.keys(set).forEach(function (k) {
        df[k] = (df[k] || 0) + 1;
        var sf = surface[k] || (surface[k] = {});
        sf[set[k]] = (sf[set[k]] || 0) + 1;
      });
    });

    var groups = {}, unclear = [];
    pool.forEach(function (x, i) {
      var cands = Object.keys(places[i]).filter(function (k) { return df[k] >= 2; });
      if (!cands.length) return unclear.push(x.id);
      var solid = cands.filter(function (k) { return df[k] >= 3; });
      var pick = solid.length
        ? solid.sort(function (a, b) { return df[a] - df[b] || b.length - a.length; })[0]
        : cands.sort(function (a, b) { return df[b] - df[a] || b.length - a.length; })[0];
      var g = groups[pick] || (groups[pick] = { key: pick, ids: [], areaVotes: {} });
      g.ids.push(x.id);
      if (areaOf[i]) g.areaVotes[areaOf[i]] = (g.areaVotes[areaOf[i]] || 0) + 1;
    });

    // «جاردينيا» و«جاردينيا سيتي» مكان واحد: تُدمج المجموعة التي يبدأ مفتاحها بمفتاح أخرى
    var keys = Object.keys(groups).sort(function (a, b) { return a.length - b.length; });
    keys.forEach(function (shortKey) {
      keys.forEach(function (longKey) {
        var a = groups[shortKey], b = groups[longKey];
        if (!a || !b || a === b || longKey.indexOf(shortKey) !== 0) return;
        var keep = b.ids.length >= a.ids.length ? b : a, drop = keep === a ? b : a;
        keep.ids = keep.ids.concat(drop.ids);
        Object.keys(drop.areaVotes).forEach(function (v) { keep.areaVotes[v] = (keep.areaVotes[v] || 0) + drop.areaVotes[v]; });
        delete groups[drop.key];
      });
    });

    var clusters = Object.keys(groups).map(function (k) {
      return { name: best(surface[k]), area: best(groups[k].areaVotes) || '', ids: groups[k].ids, on: true };
    });
    clusters.sort(function (a, b) { return a.area.localeCompare(b.area, 'ar') || b.ids.length - a.ids.length; });
    return { clusters: clusters, unclear: unclear };
  }

  // يضم إلى مجموعة كل طالب «بدون مجموعة» يذكر عنوانه اسمها. تُتجاهل أجزاء الاسم العامة (كاسم المدينة)
  function absorbByName(cl, onlyCluster) {
    var addr = {}, moved = 0;
    cl.pool.forEach(function (x) { addr[x.id] = compact(x.address); });
    var broad = function (key) {
      var n = 0;
      cl.pool.forEach(function (x) { if (addr[x.id].indexOf(key) > -1) n++; });
      return n > Math.max(3, cl.pool.length * 0.34);
    };
    var keysOf = function (c) {
      var parts = [];
      [c.name].concat(c.aliases || []).forEach(function (name) {
        String(name).split(/[\/,،\-–()]+/).map(compact).concat([compact(name)]).forEach(function (k) {
          if (k.length >= 4 && parts.indexOf(k) < 0) parts.push(k);
        });
      });
      return parts.filter(function (k) { return !broad(k); });
    };
    var targets = (onlyCluster ? [onlyCluster] : cl.clusters).map(function (c) { return { c: c, keys: keysOf(c) }; });
    cl.unclear = cl.unclear.filter(function (id) {
      var hit = null, len = 0;
      targets.forEach(function (t) {
        t.keys.forEach(function (k) { if (k.length > len && addr[id].indexOf(k) > -1) { hit = t.c; len = k.length; } });
      });
      if (!hit) return true;
      hit.ids.push(id);
      moved++;
      return false;
    });
    return moved;
  }

  // يحوّل إجابة النموذج إلى مجموعات من الطلاب، ويضمن أن كل طالب في مكان واحد فقط
  function readClusterResult(result, pool) {
    if (!result || !Array.isArray(result.clusters)) throw new Error('الإجابة ليست بالشكل المتوقع');
    var seen = {}, clusters = [];
    result.clusters.forEach(function (c) {
      var ids = [];
      (Array.isArray(c.members) ? c.members : []).forEach(function (n) {
        var st = pool[Number(n) - 1];
        if (st && !seen[st.id]) { seen[st.id] = true; ids.push(st.id); }
      });
      var name = String(c.name || '').replace(/\s+/g, ' ').trim();
      if (ids.length && name) clusters.push({ name: name, area: String(c.area || '').trim(), ids: ids, on: true });
      else ids.forEach(function (id) { delete seen[id]; });
    });
    clusters.sort(function (a, b) { return a.area.localeCompare(b.area, 'ar') || b.ids.length - a.ids.length; });
    return { clusters: clusters, unclear: pool.filter(function (x) { return !seen[x.id]; }).map(function (x) { return x.id; }) };
  }

  // بعد أي نتيجة: من بقي بلا مجموعة ويذكر عنوانه اسم مجموعة مقترحة أو موجودة يُضم إليها
  function finishClusters(cl, result) {
    Object.assign(cl, result, { step: 'review', notSame: {} });
    // المجموعات الموجودة تدخل بأسمائها وتسمياتها البديلة: ما طابقها من المقترحات يُدمج فيها مباشرة
    S.tGroups.forEach(function (g) {
      var names = [g.assembly_point].concat(Array.isArray(g.aliases) ? g.aliases : []).map(compact);
      var mine = { name: g.assembly_point, area: '', ids: [], on: true, aliases: (g.aliases || []).slice() };
      cl.clusters = cl.clusters.filter(function (c) {
        if (names.indexOf(compact(c.name)) < 0) return true;
        mine.ids = mine.ids.concat(c.ids);
        if (!mine.area) mine.area = c.area;
        return false;
      });
      cl.clusters.push(mine);
    });
    absorbByName(cl);
    cl.clusters = cl.clusters.filter(function (c) { return c.ids.length; });
    cl.clusters.sort(function (a, b) { return a.area.localeCompare(b.area, 'ar') || b.ids.length - a.ids.length; });
  }

  /* --- حسم الأماكن المتشابهة: هل هي مكان واحد؟ --- */

  // عدد التعديلات (حذف/إضافة/تبديل حرف) بين نصّين
  function editDistance(a, b) {
    var prev = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      var cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function placeWords(name) {
    return norm(name).split(/[\s\/,،\-–()]+/).filter(function (w) { return w.length >= 4 && ADDR_GENERIC.indexOf(w) < 0; });
  }

  // اسمان يُحتمل أنهما مكان واحد: أحدهما جزء من الآخر، أو يختلفان بحرف أو حرفين، أو يشتركان في كلمة مميزة
  function looksSamePlace(a, b) {
    // تُقارن الأسماء دون الكلمات العامة: «الحي السابع» و«الحي التاسع» لا يتشابهان لمجرد اشتراكهما في «الحي»
    var bare = function (name) {
      return norm(name).split(/[\s\/,،\-–()]+/).filter(function (w) { return w && ADDR_GENERIC.indexOf(w) < 0; }).join('');
    };
    var ka = bare(a), kb = bare(b);
    if (ka.length < 3 || kb.length < 3) return false;
    if (ka.indexOf(kb) > -1 || kb.indexOf(ka) > -1) return true;
    if (editDistance(ka, kb) <= (Math.min(ka.length, kb.length) >= 8 ? 2 : 1)) return true;
    var wa = placeWords(a), wb = placeWords(b);
    return wa.some(function (x) { return wb.some(function (y) { return x === y || (x.length >= 6 && y.length >= 6 && editDistance(x, y) <= 1); }); });
  }

  function pairKey(a, b) { return [norm(a), norm(b)].sort().join('|'); }

  // مجموعات من الأسماء المتشابهة التي لم يُحسم أمرها بعد: [[فهرس، فهرس…]، …]
  function similarSets(cl) {
    var n = cl.clusters.length, parent = [], i, j;
    var find = function (x) { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
    for (i = 0; i < n; i++) parent[i] = i;
    for (i = 0; i < n; i++) {
      for (j = i + 1; j < n; j++) {
        var a = cl.clusters[i].name, b = cl.clusters[j].name;
        if (!cl.notSame[pairKey(a, b)] && looksSamePlace(a, b)) parent[find(i)] = find(j);
      }
    }
    var sets = {};
    for (i = 0; i < n; i++) (sets[find(i)] || (sets[find(i)] = [])).push(i);
    return Object.keys(sets).map(function (k) { return sets[k]; }).filter(function (s) { return s.length > 1; });
  }

  // يدمج المجموعات المذكورة في واحدة تحمل الاسم المختار، وتُحفظ الأسماء الأخرى كتسميات بديلة لها
  function mergeClusters(cl, indices, keepIndex) {
    var keep = cl.clusters[keepIndex], names = {};
    (keep.aliases || []).forEach(function (a) { names[a] = true; });
    indices.forEach(function (i) {
      if (i === keepIndex) return;
      var c = cl.clusters[i];
      keep.ids = keep.ids.concat(c.ids);
      names[c.name] = true;
      (c.aliases || []).forEach(function (a) { names[a] = true; });
      if (!keep.area) keep.area = c.area;
    });
    delete names[keep.name];
    keep.aliases = Object.keys(names);
    keep.on = true;
    cl.clusters = cl.clusters.filter(function (c, i) { return i === keepIndex || indices.indexOf(i) < 0; });
  }

  function similarCardHtml(cl) {
    var sets = similarSets(cl);
    if (!sets.length) return '';
    return '<div class="card" style="border-color:var(--amber)"><h2>أسماء متشابهة: هل هي مكان واحد؟ (' + sets.length + ')</h2>' +
      '<p class="hint">اختر الاسم الذي يبقى ثم «دمج»، أو «أماكن مختلفة» إن لم تكن مكانًا واحدًا. الأسماء المدموجة تُحفظ كتسميات بديلة، فيُعرف المكان بها في المرات القادمة.</p>' +
      sets.map(function (set, si) {
        // الاسم المقترح للبقاء: الأكثر طلابًا
        var top = set.slice().sort(function (a, b) { return cl.clusters[b].ids.length - cl.clusters[a].ids.length; })[0];
        return '<div class="simset">' + set.map(function (i) {
          var c = cl.clusters[i];
          return '<label class="check"><input type="radio" name="clm-' + si + '" value="' + i + '"' + (i === top ? ' checked' : '') + '>' +
            '<b>' + esc(c.name) + '</b> <span style="color:var(--muted)">(' + c.ids.length + ')</span></label>';
        }).join('') +
          '<div class="actions" style="margin-top:6px"><button type="button" class="btn primary" data-clmerge="' + set.join(',') + '" data-set="' + si + '">دمج في الاسم المختار</button>' +
          '<button type="button" class="btn" data-clnotsame="' + set.join(',') + '">أماكن مختلفة</button></div></div>';
      }).join('') +
      (sets.length > 1 ? '<div class="actions"><button type="button" class="btn" data-clmergeall>دمج كل المقترحات (الاسم الأكثر طلابًا)</button></div>' : '') +
      '</div>';
  }

  async function runClustering() {
    var cl = ui.cl, pool = clusterPool(cl.includePending);
    if (!pool.length) return toast('لا يوجد طلاب بعناوين خارج مجموعات المواصلات.', true);
    cl.pool = pool; cl.step = 'busy'; cl.error = '';
    render();
    var r;
    try {
      r = await sb.functions.invoke('cluster-addresses', { body: clusterPayload(pool) });
    } catch (err) {
      r = { error: err };
    }
    if (ui.cl !== cl) return; // أُلغي أثناء الانتظار
    if (r.error || !r.data || r.data.error) {
      // الخدمة الآلية غير مفعّلة أو تعذّرت: يُعرض النص ليُنسخ يدويًا
      cl.step = 'manual';
      cl.error = (r.data && r.data.error) || '';
      return render();
    }
    try {
      finishClusters(cl, readClusterResult(r.data, pool));
    } catch (err) {
      cl.step = 'manual'; cl.error = err.message;
    }
    render();
  }

  function clusterMoveSelect(id, current) {
    var cl = ui.cl;
    return '<select data-clmove="' + id + '" aria-label="نقل إلى مجموعة">' +
      cl.clusters.map(function (c, i) { return '<option value="' + i + '"' + (i === current ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') +
      '<option value="-1"' + (current === -1 ? ' selected' : '') + '>بدون مجموعة</option></select>';
  }

  function clusterMemberRow(id, current) {
    var x = findStudent(id);
    return '<div class="cand"><span><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '<br><span class="meta">' + esc(x.address) + '</span></span>' + clusterMoveSelect(id, current) + '</div>';
  }

  function renderCluster() {
    var cl = ui.cl, head = tabs('transport') +
      '<button type="button" class="btn link" data-clcancel>→ العودة إلى مجموعات المواصلات</button>';

    if (cl.step === 'setup' || cl.step === 'busy') {
      var n = clusterPool(cl.includePending).length, busy = cl.step === 'busy';
      app.innerHTML = head + '<div class="card"><h2>اقتراح نقاط التجمع من عناوين السكن</h2>' +
        '<p class="hint">يُحلَّل عنوان كل طالب غير مشترك في المواصلات (عدا من سُجِّل أنه لا يريدها)، ويُقترح تجميعهم حول نقاط تجمع. تراجع الاقتراح وتعدّله قبل إنشاء أي مجموعة.</p>' +
        '<label class="check"><input type="checkbox" id="cl-pending"' + (cl.includePending ? ' checked' : '') + (busy ? ' disabled' : '') + '>تضمين الطلاب ذوي التسجيل المبدئي</label>' +
        '<p class="st-count" style="margin-top:8px">عدد العناوين التي ستُحلَّل: ' + n + '</p>' +
        '<div class="actions">' +
          '<button type="button" class="btn primary" data-cllocal' + (busy || !n ? ' disabled' : '') + '>تجميع حسب الأماكن المتكررة</button>' +
          '<button type="button" class="btn" data-clrun' + (busy || !n ? ' disabled' : '') + '>' + (busy ? 'جارٍ التحليل بالذكاء الاصطناعي… قد يستغرق دقيقة' : 'تحليل بالذكاء الاصطناعي') + '</button></div>' +
        '<p class="hint" style="margin:12px 0 0"><b>الأماكن المتكررة:</b> فوري ويعمل داخل الصفحة؛ كل اسم مكان يتكرر في عنوانين فأكثر يصير نقطة تجمع، وكل عنوان يذكره ينضم إليها.<br>' +
        '<b>الذكاء الاصطناعي:</b> يفهم اختلاف التهجئة والأماكن المتجاورة؛ يُرسَل نص العنوان فقط مع رقم تسلسلي، بلا أسماء ولا أرقام هوية ولا هواتف.</p></div>';
      return;
    }

    if (cl.step === 'manual') {
      app.innerHTML = head + '<div class="card"><h2>التحليل اليدوي عبر محادثة Claude</h2>' +
        '<p class="hint">الخدمة الآلية غير مفعّلة بعد' + (cl.error ? ' (' + esc(cl.error) + ')' : '') + '. يمكنك إتمام العمل يدويًا في ثلاث خطوات:</p>' +
        '<ol style="margin:0 0 10px;padding-inline-start:20px"><li>انسخ النص التالي.</li><li>الصقه في محادثة جديدة على claude.ai وأرسله.</li><li>انسخ إجابة Claude كاملة والصقها في المربع الثاني ثم اضغط «قراءة الإجابة».</li></ol>' +
        '<textarea id="cl-prompt" readonly style="min-height:150px" dir="rtl">' + esc(clusterPromptText(clusterPayload(cl.pool))) + '</textarea>' +
        '<div class="actions" style="margin-top:8px"><button type="button" class="btn" data-clcopy>نسخ النص</button></div>' +
        '<label class="field" for="cl-answer" style="margin-top:16px">إجابة Claude</label>' +
        '<textarea id="cl-answer" style="min-height:120px" dir="ltr" placeholder=\'{"clusters":[...],"unclear":[...]}\'></textarea>' +
        '<div class="actions" style="margin-top:8px"><button type="button" class="btn primary" data-clparse>قراءة الإجابة</button>' +
        '<button type="button" class="btn" data-cllocal>أو: تجميع حسب الأماكن المتكررة</button></div></div>';
      return;
    }

    // مراجعة الاقتراح
    var known = {};
    S.tGroups.forEach(function (g) { known[norm(g.assembly_point)] = true; });
    var chosen = cl.clusters.filter(function (c) { return c.on && c.ids.length; });
    var placed = cl.clusters.reduce(function (a, c) { return a + c.ids.length; }, 0);
    var area = null;
    app.innerHTML = head +
      '<div class="page-head"><div><h1 style="font-size:1.2rem">نقاط التجمع المقترحة</h1>' +
        '<p>المجموعات: ' + cl.clusters.length + ' · طلاب في مجموعات: ' + placed + ' · بدون مجموعة: ' + cl.unclear.length + '</p>' +
        '<p>عدّل الأسماء، انقل الطلاب بين المجموعات، وأزل العلامة عمّا لا تريده. لا يُحفظ شيء قبل الضغط على «إنشاء المجموعات».</p></div></div>' +
      similarCardHtml(cl) +
      '<div class="card"><label class="field" for="cl-newname">إضافة نقطة تجمع باسم مكان</label>' +
        '<div class="addstmt" style="margin-top:0"><input type="text" id="cl-newname" placeholder="مثال: حي السفارات">' +
        '<button type="button" class="btn" data-clnew>إنشاء وضم من يذكرونه</button></div>' +
        '<p class="hint" style="margin:6px 0 0">يُضم إليها كل طالب «بدون مجموعة» يرد هذا الاسم في عنوانه.</p></div>' +
      cl.clusters.map(function (c, i) {
        var title = c.area !== area ? '<h2 style="margin:18px 0 8px;font-size:1rem;color:var(--muted)">' + esc(c.area || 'منطقة غير محددة') + '</h2>' : '';
        area = c.area;
        return title + '<div class="card" style="margin-top:8px"><div class="toolbar" style="align-items:center;margin:0">' +
          '<input type="checkbox" data-clon="' + i + '"' + (c.on ? ' checked' : '') + ' aria-label="إنشاء هذه المجموعة" style="width:18px;height:18px;accent-color:var(--primary)">' +
          '<input type="text" data-clname="' + i + '" aria-label="اسم نقطة التجمع" style="flex:1;min-width:160px;font-weight:700" value="' + esc(c.name) + '">' +
          '<span class="badge ' + (known[norm(c.name)] ? 'review' : 'approved') + '">' + c.ids.length + ' ' + (known[norm(c.name)] ? '· يُضافون إلى مجموعة موجودة' : '· مجموعة جديدة') + '</span>' +
          '<select data-clinto="' + i + '" aria-label="دمج هذه المجموعة في مجموعة أخرى"><option value="">دمج في…</option>' +
            cl.clusters.map(function (o, k) { return k === i ? '' : '<option value="' + k + '">' + esc(o.name) + '</option>'; }).join('') + '</select></div>' +
          (c.aliases && c.aliases.length ? '<p class="hint" style="margin:6px 0 0">تسميات بديلة: ' + esc(c.aliases.join('، ')) + '</p>' : '') +
          '<details class="bank"><summary>الطلاب (' + c.ids.length + ')</summary>' + c.ids.map(function (id) { return clusterMemberRow(id, i); }).join('') + '</details></div>';
      }).join('') +
      (cl.unclear.length
        ? '<div class="card"><h2>بدون مجموعة (' + cl.unclear.length + ')</h2><p class="hint">عناوين لم يُعثر فيها على مكان مشترك. اختر لكل طالب مجموعة، أو أنشئ نقطة تجمع باسم المكان من الأعلى، أو اتركه ليُضاف لاحقًا.</p>' +
          cl.unclear.map(function (id) { return clusterMemberRow(id, -1); }).join('') + '</div>'
        : '') +
      '<div class="actions"><button type="button" class="btn primary" data-clapply' + (chosen.length ? '' : ' disabled') + '>إنشاء المجموعات (' + chosen.length + ') وإضافة الطلاب (' +
        chosen.reduce(function (a, c) { return a + c.ids.length; }, 0) + ')</button>' +
      '<button type="button" class="btn" data-clcancel>إلغاء</button></div>';
  }

  async function applyClusters() {
    var cl = ui.cl, chosen = cl.clusters.filter(function (c) { return c.on && c.ids.length && c.name.trim(); });
    // الباصات للمسجَّلين نهائيًا فقط
    chosen.forEach(function (c) { c.ids = c.ids.filter(function (id) { var x = findStudent(id); return x && enrolled(x); }); });
    chosen = chosen.filter(function (c) { return c.ids.length; });
    for (var i = 0; i < chosen.length; i++) {
      var c = chosen[i], name = c.name.trim();
      var g = S.tGroups.filter(function (x) { return norm(x.assembly_point) === norm(name); })[0];
      if (!g) {
        var fresh = { assembly_point: name, notes: c.area || '' };
        if (!S.aliasMissing) fresh.aliases = c.aliases || [];
        var ins = await sb.from('transport_groups').insert(fresh).select().single();
        if (ins.error) { render(); return fail(ins.error); }
        g = ins.data;
        S.tGroups.push(g);
      } else if (!S.aliasMissing && c.aliases && c.aliases.length) {
        var merged = (Array.isArray(g.aliases) ? g.aliases : []).concat(c.aliases.filter(function (a) { return (g.aliases || []).indexOf(a) < 0; }));
        var al = await sb.from('transport_groups').update({ aliases: merged }).eq('id', g.id);
        if (al.error) { render(); return fail(al.error); }
        g.aliases = merged;
      }
      var rows = c.ids.map(function (id) { return { student_id: id, group_id: g.id, share: null }; });
      var up = await sb.from('transport_members').upsert(rows, { onConflict: 'student_id' });
      if (up.error) { render(); return fail(up.error); }
      S.tMembers = S.tMembers.filter(function (m) { return c.ids.indexOf(m.student_id) < 0; }).concat(rows);
      c.on = false; // لا تُكرَّر إن أُعيد الضغط بعد خطأ لاحق
    }
    S.tGroups.sort(function (a, b) { return a.assembly_point.localeCompare(b.assembly_point, 'ar'); });
    ui.cl = null;
    render();
    toast('تم إنشاء المجموعات وإضافة الطلاب');
  }

  // نقطة تجمع جديدة باسم مكان يكتبه المستخدم، يُضم إليها من يذكره من غير المجمَّعين
  function addClusterByName() {
    var cl = ui.cl, box = document.getElementById('cl-newname'), name = box.value.replace(/\s+/g, ' ').trim();
    if (compact(name).length < 3) return box.focus();
    var c = cl.clusters.filter(function (x) { return norm(x.name) === norm(name); })[0];
    var fresh = !c;
    if (fresh) { c = { name: name, area: '', ids: [], on: true }; cl.clusters.unshift(c); }
    var moved = absorbByName(cl, c);
    if (!moved && fresh) {
      cl.clusters.shift();
      return toast('لا يوجد طالب «بدون مجموعة» يرد «' + name + '» في عنوانه.', true);
    }
    render();
    toast('انضم ' + moved + ' إلى «' + name + '»');
  }

  document.addEventListener('click', async function (e) {
    if (!isAdmin() || (location.hash !== '#/transport' && location.hash !== '#/transport/setup')) return;
    var cl = ui.cl, cr = e.target.closest('[data-cycreset]');
    if (cr) {
      var k = cr.getAttribute('data-cycreset'), cc = cycleCfg(), over = JSON.parse(JSON.stringify(cc.over));
      if (!confirm('إرجاع دورة ' + monthLabel(k) + ' إلى الإعداد العام (البداية والنهاية والموعد والرسوم)؟')) return;
      delete over[k];
      return saveCycles({ startDay: cc.startDay, graceDays: cc.graceDays, over: over });
    }
    if (e.target.closest('[data-clopen]')) {
      ui.cl = { step: 'setup', includePending: true, pool: [], clusters: [], unclear: [], notSame: {}, error: '' };
      render();
    } else if (!cl) {
      return;
    } else if (e.target.closest('[data-clcancel]')) {
      if (cl.step === 'review' && !confirm('إلغاء الاقتراح الحالي دون إنشاء المجموعات؟')) return;
      ui.cl = null;
      render();
    } else if (e.target.closest('[data-clrun]')) {
      runClustering();
    } else if (e.target.closest('[data-cllocal]')) {
      if (!cl.pool.length) cl.pool = clusterPool(cl.includePending);
      if (!cl.pool.length) return toast('لا يوجد طلاب بعناوين خارج مجموعات المواصلات.', true);
      finishClusters(cl, localClusters(cl.pool));
      render();
    } else if (e.target.closest('[data-clnew]')) {
      addClusterByName();
    } else if (e.target.closest('[data-clmerge]')) {
      var mb = e.target.closest('[data-clmerge]');
      var picked = app.querySelector('[name="clm-' + mb.getAttribute('data-set') + '"]:checked');
      mergeClusters(cl, mb.getAttribute('data-clmerge').split(',').map(Number), Number(picked.value));
      render();
    } else if (e.target.closest('[data-clnotsame]')) {
      var idx = e.target.closest('[data-clnotsame]').getAttribute('data-clnotsame').split(',').map(Number);
      idx.forEach(function (a) { idx.forEach(function (b) { if (a < b) cl.notSame[pairKey(cl.clusters[a].name, cl.clusters[b].name)] = true; }); });
      render();
    } else if (e.target.closest('[data-clmergeall]')) {
      // تُعاد قراءة المقترحات بعد كل دمج لأن الفهارس تتغير
      for (var sets = similarSets(cl); sets.length; sets = similarSets(cl)) {
        var set = sets[0];
        mergeClusters(cl, set, set.slice().sort(function (a, b) { return cl.clusters[b].ids.length - cl.clusters[a].ids.length; })[0]);
      }
      render();
    } else if (e.target.closest('[data-clcopy]')) {
      var box = document.getElementById('cl-prompt');
      try { await navigator.clipboard.writeText(box.value); toast('تم نسخ النص'); }
      catch (err) { box.focus(); box.select(); toast('حدِّد النص وانسخه يدويًا (Ctrl+C).', true); }
    } else if (e.target.closest('[data-clparse]')) {
      // الإجابة قد تأتي محاطة بشرح أو بعلامات تنسيق: يُؤخذ منها كائن JSON فقط
      var text = document.getElementById('cl-answer').value, a = text.indexOf('{'), b = text.lastIndexOf('}');
      try {
        if (a < 0 || b <= a) throw new Error('لا تحتوي على JSON');
        finishClusters(cl, readClusterResult(JSON.parse(text.slice(a, b + 1)), cl.pool));
        render();
      } catch (err) {
        toast('تعذرت قراءة الإجابة: ' + err.message, true);
      }
    } else if (e.target.closest('[data-clapply]')) {
      e.target.closest('[data-clapply]').disabled = true;
      applyClusters();
    }
  });

  app.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'cl-newname' && ui.cl) { e.preventDefault(); addClusterByName(); }
  });

  app.addEventListener('change', function (e) {
    var cl = ui.cl, el = e.target;
    if (!cl || !isAdmin() || location.hash !== '#/transport') return;
    if (el.id === 'cl-pending') {
      cl.includePending = el.checked;
      cl.pool = [];
      render();
    } else if (el.hasAttribute('data-clon')) {
      cl.clusters[Number(el.getAttribute('data-clon'))].on = el.checked;
      render();
    } else if (el.hasAttribute('data-clinto')) {
      if (el.value === '') return;
      mergeClusters(cl, [Number(el.getAttribute('data-clinto')), Number(el.value)], Number(el.value));
      render();
    } else if (el.hasAttribute('data-clname')) {
      cl.clusters[Number(el.getAttribute('data-clname'))].name = el.value.replace(/\s+/g, ' ').trim();
      render();
    } else if (el.hasAttribute('data-clmove')) {
      var id = el.getAttribute('data-clmove'), to = Number(el.value);
      cl.clusters.forEach(function (c) { c.ids = c.ids.filter(function (x) { return x !== id; }); });
      cl.unclear = cl.unclear.filter(function (x) { return x !== id; });
      if (to >= 0) cl.clusters[to].ids.push(id); else cl.unclear.push(id);
      // تبقى قوائم الطلاب المفتوحة مفتوحة بعد إعادة الرسم
      var open = Array.prototype.map.call(app.querySelectorAll('details.bank'), function (d) { return d.open; });
      render();
      Array.prototype.forEach.call(app.querySelectorAll('details.bank'), function (d, i) { d.open = !!open[i]; });
    }
  });

