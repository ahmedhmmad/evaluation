'use strict';
  /* ---------- الحضور والغياب ----------
     يُسجَّل لكل شعبة يومًا بيوم: صف لكل طالب في جدول attendance (supabase/attendance.sql).
     ثلاث حالات: حاضر وغائب ومأذون (المأذون لا يُعدّ حاضرًا ولا غائبًا: لا يظهر اسمه بين الغائبين ولا يدخل في النسبة؛ «متأخر» القديمة تُعدّ حاضرًا).
     اليوم: تسجيل شعبة، أو ملخص المدرسة مع الغائبين. الفترة: نسب الحضور لكل طالب ولكل شعبة */

  var ATT = { present: 'حاضر', absent: 'غائب', excused: 'مأذون', suspended: 'مفصول' };
  var ATT_BADGE = { present: 'paid', absent: 'unpaid', excused: 'part', suspended: 'unpaid' };
  S.attDay = {};          // { 'YYYY-MM-DD': { studentId: صف } }
  S.attMissing = false;

  function attNorm(status, sid, day) { return status === 'suspended' ? 'suspended' : status === 'excused' ? (sid && day && stSuspOn(sid, day) ? 'suspended' : 'excused') : status === 'absent' ? 'absent' : 'present'; }
  function attNormRows(rows, day) { (rows || []).forEach(function (r) { r.status = attNorm(r.status, r.student_id, r.day || day); }); return rows; }

  function attState() {
    if (!ui.att) ui.att = { view: 'day', day: todayISO(), cls: '', draft: {}, busy: false, from: todayISO().slice(0, 8) + '01', to: todayISO(), report: null, loading: false, dayNote: '' };
    return ui.att;
  }

  // المسجَّلون نهائيًا في الشعبة، بالاسم
  function classRoll(cls) {
    return S.students.filter(function (x) { return enrolled(x) && x.class_name === cls; })
      .sort(function (a, b) { return a.full_name.localeCompare(b.full_name, 'ar'); });
  }

  function attClasses() {
    var names = schoolClasses().slice();
    S.students.forEach(function (x) { if (enrolled(x) && x.class_name && names.indexOf(x.class_name) < 0) names.push(x.class_name); });
    return names;
  }

  // الاسم الأول واسم العائلة (للكشوف المختصرة)
  function shortName(x) {
    var nm = splitFamily(x.full_name), first = String(x.full_name || '').trim().split(/\s+/)[0] || '';
    return nm.family ? first + ' ' + nm.family : x.full_name;
  }

  // إجازات الطلاب (supabase/student_leaves.sql): كل يوم داخل الإجازة يظهر «مأذون» ويُحفظ كذلك (والقاعدة تفرضه أيضًا، فيشمل الموبايل والروابط)
  async function loadStLeaves() {
    if (S.waTpl == null && (isAdmin() || isRegistrar())) { try { await loadWaTemplates(); } catch (x) {} }
    var r = await sb.from('student_leaves').select('*').order('from_day', { ascending: false }).limit(2000);
    S.stLeavesMissing = !!r.error;
    S.stLeaves = r.data || [];
    // الفصل المؤقت يحتاج العمود kind (supabase/student_suspensions.sql)
    if (r.error) S.stSuspMissing = true;
    else if (S.stLeaves.length) S.stSuspMissing = !('kind' in S.stLeaves[0]);
    else { var k = await sb.from('student_leaves').select('kind').limit(1); S.stSuspMissing = !!k.error; }
  }
  function stSuspOn(sid, day) {
    return (S.stLeaves || []).filter(function (l) { return l.kind === 'suspension' && l.student_id === sid && day >= l.from_day && day <= l.to_day; })[0] || null;
  }
  // علامة الكشف وكلمة الحالة: المأذون داخل فصل مؤقت يظهر «ف» / «مفصول»
  function attMark(st, sid, day) { return st === 'excused' && stSuspOn(sid, day) ? 'ف' : ATT_MARK[st]; }
  function attWord(st, sid, day) { return st === 'excused' && stSuspOn(sid, day) ? 'مفصول' : ATT[st]; }
  function stLeaveOn(sid, day) {
    return (S.stLeaves || []).filter(function (l) { return l.student_id === sid && day >= l.from_day && day <= l.to_day; })[0] || null;
  }
  var LV_KINDS = [
    ['sick', 'مرض', 'نتمنى له السلامة والشفاء العاجل'],
    ['surgery', 'إجراء عملية جراحية', 'نتمنى له السلامة والشفاء العاجل'],
    ['travel', 'سفر', 'نتمنى لكم سفرًا آمنًا وعودة سالمة'],
    ['family', 'ظرف عائلي', 'نسأل الله أن يكون كل شيء على ما يرام'],
    ['other', 'أخرى', 'مع تمنياتنا بالتوفيق']
  ];
  function lvUi() { var a = attState(); return a.lv || (a.lv = { q: '', sids: [], kind: 'sick', reason: '', send: false, text: '' }); }
  var LV_TPL = 'السلام عليكم ورحمة الله وبركاته،\nولي أمر الطالب/ة {الاسم} المحترم،\nنفيدكم بأنه تم تسجيل إجازة لابنكم/ابنتكم من {من} إلى {إلى} بسبب {السبب}، ولن يُحتسب غيابه/ا خلالها.\n{التمني}.\n{الأكاديمية}';
  function lvKind(k) { return LV_KINDS.filter(function (x) { return x[0] === k; })[0] || LV_KINDS[0]; }
  function lvMsg(u, from, to) {
    // النص من قالب «إجازة طالب» في «رسائل واتساب ← القوالب» (وإلا النص الافتراضي)
    var k = lvKind(u.kind), why = u.kind === 'other' ? (u.reason || 'ظرف خاص') : k[1] + (u.reason ? ' (' + u.reason + ')' : '');
    var t = (typeof waTpl === 'function' && waTpl('leave')) || null;
    return (t ? t.body : LV_TPL).replace(/\{من\}/g, dmy(from)).replace(/\{إلى\}/g, dmy(to)).replace(/\{السبب\}/g, why).replace(/\{التمني\}/g, k[2]);
  }
  // البحث عن الطالب: فارغ في البداية، ويُظهر من تحتوي أسماؤهم كل الكلمات المكتوبة (الاسم الأول أو الأخير أو أي جزء)
  function lvMatches() {
    var u = lvUi(), a = attState(), words = norm(u.q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return S.students.filter(function (x) {
      if (!enrolled(x) || (a.cls && x.class_name !== a.cls) || u.sids.indexOf(x.id) > -1) return false;
      var n = norm(x.full_name);
      return words.every(function (w) { return n.indexOf(w) > -1; });
    }).slice(0, 12);
  }
  function stLeavesHtml() {
    if (S.stLeaves == null) return '';
    var a = attState(), edit = isAdmin() || isRegistrar(), today = todayISO();
    if (S.stLeavesMissing) return '<div class="card"><h2>إجازات الطلاب</h2><p class="hint" style="margin:0">تحتاج جدولًا جديدًا: شغّل الملف <code dir="ltr">supabase/student_leaves.sql</code> في محرر SQL، ثم حدّث الصفحة.</p></div>';
    var list = S.stLeaves.filter(function (l) { var x = findStudent(l.student_id); return l.kind !== 'suspension' && l.to_day >= (a.leaveAll ? '0000' : today) && (!a.cls || (x && x.class_name === a.cls)); });
    var pool = S.students.filter(function (x) { return enrolled(x) && (!a.cls || x.class_name === a.cls); }).sort(function (p, q) { return (p.class_name || '').localeCompare(q.class_name || '', 'ar') || p.full_name.localeCompare(q.full_name, 'ar'); });
    return '<div class="card"><h2>إجازات الطلاب (عذر لفترة)</h2><p class="hint" style="margin:0">الطالب المجاز يُسجَّل «مأذون» تلقائيًا في كل أيام إجازته، في الموقع وتطبيق الموبايل، فلا حاجة لإدخاله يوميًا. لإلغاء ذلك احذف الإجازة أو قصّرها.</p>' +
      (edit ? '<div class="toolbar" style="align-items:flex-end;margin-top:10px">' +
        (function () {
          var u = lvUi(), m = lvMatches();
          return '<div style="flex:2;min-width:240px;position:relative"><label class="field" for="lv-q">الطلاب (اختر واحدًا أو أكثر)</label>' +
            (u.sids.length ? '<div class="toolbar" style="margin:0 0 6px;gap:6px">' + u.sids.map(function (id) { var x = findStudent(id) || {}; return '<span class="badge part" style="display:inline-flex;gap:6px;align-items:center">' + esc(x.full_name || '') + ' <button type="button" data-lvun="' + id + '" title="إزالة" style="border:0;background:none;cursor:pointer;font-weight:700">×</button></span>'; }).join('') + '</div>' : '') +
            ('<input type="search" id="lv-q" autocomplete="off" placeholder="اكتب جزءًا من الاسم (الأول أو الأخير…)" value="' + esc(u.q) + '">' +
                (u.q.trim() ? '<div style="border:1px solid var(--line);border-radius:8px;margin-top:4px;max-height:240px;overflow:auto;background:var(--surface)">' + (m.length ? m.map(function (x) { return '<button type="button" class="btn" style="display:block;width:100%;text-align:right;border:0;border-radius:0" data-lvpick="' + x.id + '">' + esc(x.full_name) + ' <span class="meta">— ' + esc(x.class_name || '') + '</span></button>'; }).join('') : '<div class="hint" style="padding:8px;margin:0">لا أسماء مطابقة.</div>') + '</div>' : '')) + '</div>' +
            '<div><label class="field" for="lv-from">من</label><input type="date" id="lv-from" value="' + esc(u.from || today) + '"></div>' +
            '<div><label class="field" for="lv-to">إلى</label><input type="date" id="lv-to" value="' + esc(u.to || today) + '"></div>' +
            '<div><label class="field" for="lv-kind">نوع الإجازة</label><select id="lv-kind">' + LV_KINDS.map(function (k) { return '<option value="' + k[0] + '"' + (u.kind === k[0] ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></div>' +
            '<div style="flex:2;min-width:180px"><label class="field" for="lv-reason">تفاصيل (اختياري)</label><input type="text" id="lv-reason" value="' + esc(u.reason) + '" placeholder="مثال: عملية الزائدة"></div></div>' +
            '<label class="check" style="margin:8px 0 0"><input type="checkbox" id="lv-send"' + (u.send ? ' checked' : '') + '> إرسال رسالة واتساب لولي الأمر تؤكد الإجازة (اختياري)</label>' +
            (u.send ? '<textarea id="lv-text" rows="5" style="width:100%;margin-top:6px">' + esc(u.text || lvMsg(u, u.from || today, u.to || today)) + '</textarea><p class="hint" style="margin:2px 0 0">يُرسل لولي أمر كل طالب مختار باسم ابنه. أصل النص من قالب «إجازة طالب» في <a href="#/messages">رسائل واتساب ← القوالب</a>، ويمكن تعديله هنا لهذه المرة.</p>' : '') +
            '<div class="actions" style="margin-top:8px"><button type="button" class="btn primary" data-lvadd>منح إجازة' + (u.send ? ' وإرسال الرسالة' : '') + '</button></div>';
        })() : '') +
      '<div class="toolbar" style="margin:10px 0 0;align-items:center"><label class="check" style="margin:0"><input type="checkbox" id="lv-all"' + (a.leaveAll ? ' checked' : '') + '> عرض الإجازات المنتهية أيضًا</label></div>' +
      (list.length ? '<div class="table-wrap"><table class="grid"><thead><tr><th>الطالب</th><th>الشعبة</th><th>من</th><th>إلى</th><th>الأيام</th><th>السبب</th><th></th></tr></thead><tbody>' +
        list.map(function (l) {
          var x = findStudent(l.student_id), n = Math.round((new Date(l.to_day) - new Date(l.from_day)) / 864e5) + 1;
          return '<tr><td><b>' + esc(x ? x.full_name : '—') + '</b>' + (l.from_day <= today && today <= l.to_day ? ' <span class="badge part">مجاز اليوم</span>' : '') + '</td><td>' + esc(x ? x.class_name || '' : '') + '</td><td>' + dmy(l.from_day) + '</td><td>' + dmy(l.to_day) + '</td><td>' + n + '</td><td>' + esc(l.reason) + '</td>' +
            '<td>' + (edit ? '<button type="button" class="btn danger" data-lvdel="' + l.id + '">حذف</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty" style="margin-top:8px">لا إجازات ' + (a.leaveAll ? '' : 'حالية أو قادمة') + (a.cls ? ' في هذه الشعبة' : '') + '.</div>') + '</div>';
  }
  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/attendance' || !(isAdmin() || isRegistrar())) return;
    var el;
    if (e.target.closest('[data-lvadd]')) {
      var u = lvUi(), sids = u.sids.slice(), from = document.getElementById('lv-from').value, to = document.getElementById('lv-to').value, reason = (lvKind(u.kind)[0] === 'other' ? '' : lvKind(u.kind)[1]) + (u.reason.trim() ? (u.kind === 'other' ? '' : ' — ') + u.reason.trim() : '');
      if (!sids.length) return toast('اختر طالبًا واحدًا على الأقل', true);
      if (!from || !to || to < from) return toast('اختر فترة صحيحة', true);
      var by = (S.profile && S.profile.full_name) || displayName(S.email);
      var r = await sb.from('student_leaves').insert(sids.map(function (sid) { return { student_id: sid, from_day: from, to_day: to, reason: reason, created_by: by }; })).select();
      if (r.error) return fail(r.error);
      S.stLeaves = (r.data || []).concat(S.stLeaves);
      S.attDay = {}; // الأيام المسجَّلة داخل الإجازة صارت «مأذون» في القاعدة
      var nm = sids.length === 1 ? (findStudent(sids[0]) || {}).full_name : sids.length + ' طلاب', text = u.send ? (u.text || lvMsg(u, from, to)) : '';
      attState().lv = null;
      render();
      toast('مُنحت الإجازة لـ' + nm + ' من ' + dmy(from) + ' إلى ' + dmy(to));
      if (text) {
        var w = await sb.functions.invoke('send-whatsapp', { body: { action: 'send', batch_id: 'leave-' + r.data[0].id, kind: 'leave', title: 'إجازة طالب', text: text, student_ids: sids, per: 'student', school: schoolName() } });
        var wd = w.data || {};
        if (w.error || wd.error) return toast('حُفظت الإجازة، لكن تعذّر إرسال الرسالة: ' + (wd.error || w.error.message), true);
        toast('أُضيفت رسالة الإجازة إلى قائمة الإرسال. تابعها في «رسائل واتساب».');
      }
      return;
    }
    if ((el = e.target.closest('[data-lvpick]'))) { var lu = lvUi(); lu.sids.push(el.getAttribute('data-lvpick')); lu.q = ''; render(); var qf = document.getElementById('lv-q'); if (qf) qf.focus(); return; }
    if ((el = e.target.closest('[data-lvun]'))) { var lu2 = lvUi(); lu2.sids = lu2.sids.filter(function (id) { return id !== el.getAttribute('data-lvun'); }); return render(); }
    if ((el = e.target.closest('[data-lvdel]'))) {
      var id = el.getAttribute('data-lvdel'), l = S.stLeaves.filter(function (q) { return q.id === id; })[0];
      if (!l || !confirm('حذف إجازة ' + ((findStudent(l.student_id) || {}).full_name || '') + '؟ (ما سُجِّل «مأذون» في أيامها يبقى كما هو، ويُعدَّل يدويًا إن لزم)')) return;
      var d = await sb.from('student_leaves').delete().eq('id', id);
      if (d.error) return fail(d.error);
      S.stLeaves = S.stLeaves.filter(function (q) { return q.id !== id; });
      render();
    }
  });
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/attendance') return;
    if (e.target.id === 'lv-all') { attState().leaveAll = e.target.checked; return render(); }
    var u = lvUi(), id = e.target.id;
    if (id === 'lv-send') { u.send = e.target.checked; return render(); }
    if (id === 'lv-kind' || id === 'lv-from' || id === 'lv-to') {
      if (id === 'lv-kind') u.kind = e.target.value; else u[id === 'lv-from' ? 'from' : 'to'] = e.target.value;
      if (id === 'lv-from' && (!u.to || u.to < u.from)) u.to = u.from;
      if (!u.textEdited) u.text = '';
      return render();
    }
  });
  document.addEventListener('input', function (e) {
    if (location.hash !== '#/attendance') return;
    var u = lvUi(), id = e.target.id;
    if (id === 'lv-reason') { u.reason = e.target.value; if (!u.textEdited) { u.text = ''; var t = document.getElementById('lv-text'); if (t) t.value = lvMsg(u, u.from || todayISO(), u.to || todayISO()); } return; }
    if (id === 'lv-text') { u.text = e.target.value; u.textEdited = true; return; }
    if (id === 'lv-q') { var pos = e.target.selectionStart; u.q = e.target.value; render(); var q = document.getElementById('lv-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} } }
  });

  async function loadAttDay(day) {
    if (S.stLeaves == null) await loadStLeaves();
    var rows = await fetchAll(function () { return sb.from('attendance').select('*').eq('day', day).order('student_id'); });
    if (!rows) { S.attMissing = true; render(); return; }
    var map = {};
    attNormRows(rows, day).forEach(function (r) { map[r.student_id] = r; });
    S.attDay[day] = map;
    render();
  }

  async function loadAttReport() {
    var a = attState();
    if (!a.from || !a.to || a.from > a.to) return toast('اختر فترة صحيحة', true);
    a.loading = true;
    render();
    var rows = await fetchAttRange(a.from, a.to);
    a.loading = false;
    if (!rows) { toast('تعذر جلب سجلات الحضور', true); render(); return; }
    a.report = { from: a.from, to: a.to, rows: rows };
    render();
  }

  // حالة الطالب في اليوم المعروض: ما عُدِّل ولم يُحفظ، ثم المحفوظ، وإلا حاضر
  function attOf(sid) {
    var a = attState(), d = a.draft[sid], saved = (S.attDay[a.day] || {})[sid], lv = !d && !saved ? stLeaveOn(sid, a.day) : null;
    if (lv) return { status: lv.kind === 'suspension' ? 'suspended' : 'excused', note: (lv.kind === 'suspension' ? 'فصل مؤقت' : 'إجازة') + (lv.reason ? ': ' + lv.reason : ''), saved: saved, leave: lv };
    return { status: d ? d.status : saved ? saved.status : 'present', note: d && d.note != null ? d.note : saved ? saved.note || '' : '', saved: saved };
  }

  function attCounts(list, get) {
    var n = { present: 0, absent: 0, excused: 0, suspended: 0 };
    list.forEach(function (x) { n[attNorm(get(x), x && x.id, attState().day)]++; });
    return n;
  }

  function attPct(n) {
    var total = n.present + n.absent;
    return total ? Math.round(n.present / total * 100) + '%' : '—';
  }

  function attStatsHtml(n, sub) {
    var card = function (lbl, num, color) { return '<div class="card stat"><span class="lbl">' + lbl + '</span><span class="num"' + (color ? ' style="color:' + color + '"' : '') + '>' + num + '</span><span class="sub">' + sub + '</span></div>'; };
    return '<div class="stats">' + card('حاضر', n.present) + card('غائب', n.absent, n.absent ? 'var(--red)' : '') + (n.excused ? card('مأذون', n.excused) : '') + (n.suspended ? card('مفصول', n.suspended, 'var(--red)') : '') + card('نسبة الحضور', attPct(n)) + '</div>';
  }

  function attClassHtml(cls) {
    var a = attState(), roll = classRoll(cls), saved = S.attDay[a.day] || {};
    if (!roll.length) return '<div class="card empty">لا يوجد مسجَّلون نهائيًا في هذه الشعبة.</div>';
    var taken = roll.filter(function (x) { return saved[x.id]; }), last = null;
    taken.forEach(function (x) { if (!last || String(saved[x.id].updated_at) > String(last.updated_at)) last = saved[x.id]; });
    var dirty = Object.keys(a.draft).length, future = a.day > todayISO();
    var n = attCounts(roll, function (x) { return attOf(x.id).status; });
    var rec = canRecordAtt();
    if (!rec) {
      // عرض فقط (المشرف والمدير): الحالة كما سُجّلت، بلا أزرار ولا حفظ
      return attStatsHtml(n, cls) + '<div class="card"><h2>حضور ' + esc(cls) + ' — ' + dmy(a.day) + '</h2>' +
        '<p class="hint">' + (taken.length ? 'سُجّل حضور هذا اليوم' + (last && last.recorded_by ? ' بواسطة ' + esc(last.recorded_by) : '') + '.' : 'لم يُسجَّل حضور هذا اليوم بعد.') + '</p>' +
        '<div class="table-wrap"><table class="grid pay"><thead><tr><th>م</th><th>الطالب</th><th>الحالة</th><th>ملاحظة</th><th>واتساب ولي الأمر</th></tr></thead><tbody>' +
        roll.map(function (x, i) {
          var st = attOf(x.id);
          return '<tr><td>' + (i + 1) + '</td><td class="who"><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '</td><td>' + (st.saved ? '<span class="badge ' + ATT_BADGE[st.status] + '">' + attWord(st.status, x.id, attState().day) + '</span>' : '<span class="badge new">لم يُسجَّل</span>') + '</td>' +
            '<td>' + esc(st.note) + '</td><td dir="ltr" style="text-align:right;white-space:nowrap">' + esc(plainPhone(x.phone) || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }
    var rows = roll.map(function (x, i) {
      var st = attOf(x.id);
      return '<tr><td>' + (i + 1) + '</td><td class="who"><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '</td><td><div class="acts">' + (stSuspOn(x.id, attState().day) ? ['suspended'] : ['present', 'absent', 'excused']).map(function (k) {
          return '<button type="button" class="btn' + (st.status === k ? ' primary' : '') + '" data-attset="' + x.id + '" data-attv="' + k + '"' + (st.status === k ? ' aria-pressed="true"' : ' aria-pressed="false"') +
            (st.status === k && k === 'absent' ? ' style="background:var(--red);border-color:transparent"' : '') + '>' + ATT[k] + '</button>';
        }).join('') + '</div></td>' +
        '<td><input type="text" data-attnote="' + x.id + '" placeholder="ملاحظة (سبب الغياب…)" aria-label="ملاحظة ' + esc(x.full_name) + '" value="' + esc(st.note) + '" style="min-width:180px"></td>' +
        '<td dir="ltr" style="text-align:right;white-space:nowrap">' + esc(plainPhone(x.phone) || '—') + '</td></tr>';
    }).join('');
    return attStatsHtml(n, cls) +
      '<div class="card"><div class="toolbar" style="align-items:center"><h2 style="margin:0;flex:1">حضور ' + esc(cls) + ' — ' + dmy(a.day) + '</h2>' +
        '<button type="button" class="btn" data-attall>الكل حاضر</button>' +
        '<button type="button" class="btn primary" data-attsave' + (a.busy || future ? ' disabled' : '') + '>' + (a.busy ? 'جارٍ الحفظ…' : 'حفظ الحضور') + '</button></div>' +
        (attOff(a.day) ? '<p class="formhint" style="margin:0 0 10px">' + dayName(a.day) + ' ' + dmy(a.day) + (attHoliday(a.day) ? ' مسجَّل عطلة' : ' عطلة أسبوعية') + '؛ تأكد من اليوم قبل تسجيل الحضور.</p>' : '') +
        '<p class="hint" style="margin:0 0 10px">' + (future ? 'لا يُسجَّل الحضور ليوم لم يأتِ بعد.' :
          taken.length ? 'سُجّل حضور هذا اليوم' + (last && last.recorded_by ? ' بواسطة ' + esc(last.recorded_by) : '') + (last && last.updated_at ? ' · ' + issuedWhen({ issued_at: last.updated_at }) : '') + (taken.length < roll.length ? ' — ' + (roll.length - taken.length) + ' طالبًا أُضيفوا بعده لم يُسجَّلوا' : '') + '. يمكنك التعديل والحفظ مجددًا.'
          : 'لم يُسجَّل حضور هذا اليوم بعد. الجميع «حاضر» افتراضيًا: علّم الغائبين ثم احفظ.') +
          (dirty ? ' <b style="color:var(--red)">تعديلات غير محفوظة: ' + dirty + '</b>' : '') + '</p>' +
        '<div class="table-wrap"><table class="grid pay"><thead><tr><th>م</th><th>الطالب</th><th>الحالة</th><th>ملاحظة</th><th>واتساب ولي الأمر</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function attSchoolHtml() {
    var a = attState(), saved = S.attDay[a.day] || {}, all = { present: 0, absent: 0, excused: 0, suspended: 0 }, missing = [], absentees = [];
    var rows = attClasses().map(function (cls) {
      var roll = classRoll(cls);
      if (!roll.length) return '';
      var taken = roll.filter(function (x) { return saved[x.id]; });
      if (!taken.length) missing.push(cls);
      var n = attCounts(taken, function (x) { return saved[x.id].status; });
      all.present += n.present; all.absent += n.absent; all.excused += n.excused; all.suspended += n.suspended;
      var gone = taken.filter(function (x) { return saved[x.id].status === 'absent'; });
      gone.forEach(function (x) { absentees.push({ x: x, r: saved[x.id] }); });
      return '<tr><td><button type="button" class="btn link" data-attcls="' + esc(cls) + '">' + esc(cls) + '</button></td><td>' + roll.length + '</td>' +
        '<td>' + (taken.length ? '<span class="badge paid">سُجّل</span>' : '<span class="badge unpaid">لم يُسجَّل</span>') + '</td>' +
        (taken.length ? '<td>' + n.present + '</td><td>' + (n.absent ? '<b style="color:var(--red)">' + n.absent + '</b>' : 0) + '</td><td><b>' + attPct(n) + '</b></td>' +
          '<td style="font-size:.9rem">' + (gone.map(function (x) { return esc(shortName(x)); }).join('، ') || '—') + '</td>'
          : '<td colspan="4" style="color:var(--muted)">—</td>') + '</tr>';
    }).join('');
    absentees.sort(function (p, q) { return classRank(p.x.class_name) - classRank(q.x.class_name) || p.x.full_name.localeCompare(q.x.full_name, 'ar'); });
    return attStatsHtml(all, 'المدرسة — ' + dmy(a.day)) +
      (missing.length ? '<p class="formhint">لم يُسجَّل حضور ' + missing.length + ' شعبة لهذا اليوم: ' + missing.map(esc).join('، ') + '</p>' : '') +
      '<div class="card"><div class="toolbar" style="align-items:center"><h2 style="margin:0;flex:1">الشعب — ' + dmy(a.day) + '</h2>' +
        '<button type="button" class="btn" data-attschoolpdf="day">طباعة / PDF</button>' +
        '<button type="button" class="btn" data-attdayxlsx>تصدير Excel</button>' +
        (canRecordAtt() && a.day === todayISO() && absentees.length ? '<button type="button" class="btn primary" data-attnotify="' + absentees.length + '" title="لا يتكرر الإرسال لمن أُرسل له اليوم، ولا يشمل الغياب بعذر">إرسال الغياب لأولياء الأمور</button>' : '') + '</div>' +
        (rows ?'<div class="table-wrap"><table class="grid"><thead><tr><th>الشعبة</th><th>الطلاب</th><th>التسجيل</th><th>حاضر</th><th>غائب</th><th>نسبة الحضور</th><th>أسماء الغائبين</th></tr></thead><tbody>' + rows +
          '</tbody><tfoot><tr><td colspan="3">المدرسة</td><td>' + all.present + '</td><td>' + all.absent + '</td><td>' + attPct(all) + '</td><td></td></tr></tfoot></table></div>'
          : '<div class="empty">لا توجد شعب فيها مسجَّلون نهائيًا.</div>') + '</div>' +
      '<div class="card"><h2>الغائبون اليوم (' + absentees.length + ')</h2>' +
        (absentees.length ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الطالب</th><th>الشعبة</th><th>ملاحظة</th><th>ولي الأمر</th><th>واتساب ولي الأمر</th>' + (canRecordAtt() && a.day === todayISO() ? '<th class="no-print">إشعار</th>' : '') + '</tr></thead><tbody>' +
          absentees.map(function (p, i) {
            return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(p.x.full_name) + '</b></td><td>' + esc(p.x.class_name) + '</td>' +
              '<td>' + esc(p.r.note || '') + '</td><td>' + esc(p.x.guardian_name || '') + '</td><td dir="ltr" style="text-align:right;white-space:nowrap">' + esc(plainPhone(p.x.phone) || '—') + '</td>' +
              (canRecordAtt() && a.day === todayISO() ? '<td class="no-print"><button type="button" class="btn" data-attnotify1="' + p.x.id + '"' + (plainPhone(p.x.phone) ? '' : ' disabled title="لا رقم لولي الأمر"') + '>إرسال</button></td>' : '') + '</tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">لا غائبين مسجَّلين لهذا اليوم.</div>') + '</div>';
  }

  // سجلات فترة مجمّعة: لكل طالب ولكل شعبة، والغياب لكل شعبة في كل يوم
  function attCollect(rows) {
    var per = {}, byClass = {}, cell = {};
    rows.forEach(function (r) {
      var p = per[r.student_id] || (per[r.student_id] = { present: 0, absent: 0, excused: 0, suspended: 0, notes: [], days: {} });
      p[r.status]++;
      p.days[r.day] = r.status;
      if (r.note && r.status === 'absent' && p.notes.indexOf(r.note) < 0) p.notes.push(r.note);
      var c = byClass[r.class_name] || (byClass[r.class_name] = { days: {}, n: { present: 0, absent: 0, excused: 0, suspended: 0 } });
      c.days[r.day] = 1;
      c.n[r.status]++;
      var key = r.class_name + '|' + r.day, v = cell[key] || (cell[key] = { absent: 0, all: 0 });
      v.all++;
      if (r.status === 'absent') v.absent++;
    });
    return { per: per, byClass: byClass, cell: cell };
  }

  function attReportData() { return attCollect(attState().report.rows); }

  function attReportHtml() {
    var a = attState();
    var head = '<div class="card"><div class="toolbar" style="align-items:center;margin:0">' +
      '<span class="monthpick"><label class="field" for="att-from">من</label><input type="date" id="att-from" value="' + a.from + '"></span>' +
      '<span class="monthpick"><label class="field" for="att-to">إلى</label><input type="date" id="att-to" value="' + a.to + '"></span>' +
      '<button type="button" class="btn primary" data-attrun' + (a.loading ? ' disabled' : '') + '>' + (a.loading ? 'جارٍ الجلب…' : 'عرض التقرير') + '</button>' +
      (a.report ? '<button type="button" class="btn" data-attrepxlsx>تصدير Excel</button>' : '') + '</div>' +
      (a.report ? '<div class="toolbar" style="align-items:center;margin:10px 0 0"><b style="font-size:.95rem">كشف الغياب المفصّل' + (a.cls ? ' — ' + esc(a.cls) : '') + ':</b>' +
        '<label class="field" for="att-min" style="margin:0">من غاب</label><select id="att-min" style="width:auto">' + [1, 2, 3, 4, 5, 7, 10].map(function (n) {
          return '<option value="' + n + '"' + ((a.minAbs || 1) === n ? ' selected' : '') + '>' + (n === 1 ? 'يومًا فأكثر' : n + ' أيام فأكثر') + '</option>';
        }).join('') + '</select>' +
        '<button type="button" class="btn" data-attdetail="pdf">PDF</button><button type="button" class="btn" data-attdetail="xlsx">Excel</button>' +
        '<span class="hint" style="margin:0">الشعبة، وأيام الغياب وتواريخها، وأطول غياب متصل، والملاحظات، ووسائل الاتصال بولي الأمر والطالب</span></div>' : '') + '</div>';
    if (!a.report) return head + '<div class="card empty">اختر الفترة ثم «عرض التقرير».</div>';
    var d = attReportData();
    if (a.cls) {
      var roll = classRoll(a.cls), days = Object.keys((d.byClass[a.cls] || {}).days || {}).length;
      var rows = roll.map(function (x, i) {
        var p = d.per[x.id] || { present: 0, absent: 0 };
        return '<tr><td>' + (i + 1) + '</td><td class="who"><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '</td><td>' + p.present + '</td><td>' + (p.absent ? '<b style="color:var(--red)">' + p.absent + '</b>' : 0) + '</td><td><b>' + attPct(p) + '</b></td>' + '<td class="no-print" style="white-space:nowrap"><button type="button" class="btn" data-attstu="' + x.id + '|pdf">PDF</button> <button type="button" class="btn" data-attstu="' + x.id + '|xlsx">Excel</button></td>' + '</tr>';
      }).join('');
      return head + '<div class="card"><h2>' + esc(a.cls) + ' — من ' + dmy(a.report.from) + ' إلى ' + dmy(a.report.to) + '</h2><p class="st-count">أيام سُجّل فيها حضور الشعبة: ' + days + '</p>' +
        '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الطالب</th><th>أيام الحضور</th><th>أيام الغياب</th><th>نسبة الحضور</th><th>سجل الطالب</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    }
    var all = { present: 0, absent: 0 };
    var crow = attClasses().map(function (cls) {
      var c = d.byClass[cls];
      if (!c) return '<tr><td><button type="button" class="btn link" data-attcls="' + esc(cls) + '">' + esc(cls) + '</button></td><td>0</td><td colspan="3" style="color:var(--muted)">لم يُسجَّل حضور في الفترة</td></tr>';
      all.present += c.n.present; all.absent += c.n.absent;
      return '<tr><td><button type="button" class="btn link" data-attcls="' + esc(cls) + '">' + esc(cls) + '</button></td><td>' + Object.keys(c.days).length + '</td><td>' + c.n.absent + '</td><td><b>' + attPct(c.n) + '</b></td>' +
        '<td>' + classRoll(cls).filter(function (x) { return (d.per[x.id] || {}).absent >= 3; }).length + '</td></tr>';
    }).join('');
    var repMin = Math.max(2, Number(a.repMin) || 3);
    var most = S.students.filter(function (x) { return (d.per[x.id] || {}).absent >= repMin; })
      .sort(function (p, q) { return d.per[q.id].absent - d.per[p.id].absent || p.full_name.localeCompare(q.full_name, 'ar'); });
    return head + '<div class="card"><h2>الشعب — من ' + dmy(a.report.from) + ' إلى ' + dmy(a.report.to) + '</h2>' +
        '<div class="table-wrap"><table class="grid"><thead><tr><th>الشعبة</th><th>أيام التسجيل</th><th>الغياب (طالب×يوم)</th><th>نسبة الحضور</th><th>غابوا 3 أيام فأكثر</th></tr></thead><tbody>' + crow +
        '</tbody><tfoot><tr><td colspan="2">المدرسة</td><td>' + all.absent + '</td><td>' + attPct(all) + '</td><td>' + most.length + '</td></tr></tfoot></table></div></div>' +
      '<div class="card"><h2>الأكثر غيابًا (' + repMin + ' أيام فأكثر) — ' + most.length + '</h2>' +
        '<div class="toolbar no-print" style="align-items:center;margin:0 0 8px"><label class="field" for="att-repmin" style="margin:0">حد التكرار (أيام الغياب في الفترة)</label>' +
          '<input type="number" id="att-repmin" min="2" max="31" step="1" style="width:5.5em" value="' + repMin + '">' +
          (canRecordAtt() ? '<button type="button" class="btn primary" data-attrep="' + most.length + '"' + (most.length ? '' : ' disabled') + ' title="رسالة واحدة لكل طالب في هذه الفترة، ولا تتكرر">إرسال تنبيه واتساب للجميع (' + most.length + ')</button>' : '') +
          '<span class="hint" style="margin:0">الفترة: من ' + dmy(a.report.from) + ' إلى ' + dmy(a.report.to) + ' (غيّرها من التواريخ أعلاه)</span></div>' + (most.length
        ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الطالب</th><th>الشعبة</th><th>أيام الغياب</th><th>نسبة الحضور</th><th>واتساب ولي الأمر</th><th>سجل الطالب</th>' + (canRecordAtt() ? '<th class="no-print">تنبيه</th>' : '') + '</tr></thead><tbody>' + most.map(function (x, i) {
            return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '</td><td>' + esc(x.class_name || '') + '</td><td><b style="color:var(--red)">' + d.per[x.id].absent + '</b></td><td>' + attPct(d.per[x.id]) + '</td>' +
              '<td dir="ltr" style="text-align:right;white-space:nowrap">' + esc(plainPhone(x.phone) || '—') + '</td>' + '<td class="no-print" style="white-space:nowrap"><button type="button" class="btn" data-attstu="' + x.id + '|pdf">PDF</button> <button type="button" class="btn" data-attstu="' + x.id + '|xlsx">Excel</button></td>' +
              (canRecordAtt() ? '<td class="no-print"><button type="button" class="btn" data-attrep1="' + x.id + '"' + (plainPhone(x.phone) ? '' : ' disabled title="لا رقم لولي الأمر"') + '>إرسال</button></td>' : '') + '</tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">لا أحد.</div>') + '</div>';
  }

  document.addEventListener('change', function (e) {
    if (e.target.id !== 'att-repmin' || location.hash !== '#/attendance') return;
    attState().repMin = Math.max(2, Number(e.target.value) || 3);
    render();
  });

  // تنبيه تكرار الغياب بواتساب: الحدّ والفترة من التقرير المعروض؛ تُحسب الأعداد في السيرفر من جدول الحضور
  function attRepeatSend(body) {
    var a = attState();
    sb.functions.invoke('send-absence-whatsapp', { body: Object.assign({ school: schoolName(), repeat: { from: a.report.from, to: a.report.to, min: Math.max(2, Number(a.repMin) || 3) } }, body) }).then(function (r) {
      if (r.error) return toast('تعذّر الإرسال: ' + r.error.message, true);
      var d = r.data || {}, skipped = (d.noPhone || []).length + (d.rejected || 0);
      toast('أُضيف ' + (d.queued || 0) + ' إلى قائمة الإرسال' + (d.alreadySent ? '، و' + d.alreadySent + ' سبق إرسالهم لهذه الفترة' : '') + (skipped ? '، و' + skipped + ' بلا رقم صحيح' : ''), skipped > 0 && !d.queued);
    });
  }

  /* ----- كشف الغياب المفصّل -----
     لكل طالب غاب في فترة التقرير (أو الحد الأدنى المختار من الأيام): الشعبة، وأيام الغياب من الأيام المسجّلة لشعبته ونسبة الحضور،
     وتواريخ الغياب، وأطول غياب متصل (أيام دراسية متتالية سُجّل فيها غائبًا)، وآخر غياب، والملاحظات، وولي الأمر وهاتفه وواتسابه وجوال الطالب.
     مرتّب بالشعبة ثم بالأكثر غيابًا */
  function attDetailData() {
    var a = attState(), d = attReportData(), min = a.minAbs || 1, rows = [];
    var classes = (a.cls ? [a.cls] : attClasses()).filter(function (c) { return classRoll(c).length; });
    classes.forEach(function (cls) {
      var cdays = Object.keys((d.byClass[cls] || {}).days || {}).sort();
      classRoll(cls).forEach(function (x) {
        var p = d.per[x.id];
        if (!p || p.absent < min) return;
        var abs = Object.keys(p.days).filter(function (dd) { return p.days[dd] === 'absent'; }).sort();
        var run = 0, best = 0;
        cdays.forEach(function (dd) { if (p.days[dd] === 'absent') { run++; best = Math.max(best, run); } else if (p.days[dd]) run = 0; });
        rows.push({ x: x, cls: cls, absent: p.absent, present: p.present, pct: attPct(p), dates: abs, streak: best, last: abs[abs.length - 1] || '', notes: p.notes,
          guardian: stVal(x, 'guardian_name') || '', phone: plainPhone(x.phone), whatsapp: plainPhone(x.whatsapp), student: plainPhone(stVal(x, 'student_phone')) });
      });
    });
    rows.sort(function (p, q) { return classRank(p.cls) - classRank(q.cls) || p.cls.localeCompare(q.cls, 'ar') || q.absent - p.absent || p.x.full_name.localeCompare(q.x.full_name, 'ar'); });
    var sum = classes.map(function (cls) {
      var c = d.byClass[cls];
      return { cls: cls, students: classRoll(cls).length, days: c ? Object.keys(c.days).length : 0, absent: c ? c.n.absent : 0, pct: c ? attPct(c.n) : '—',
        listed: rows.filter(function (r) { return r.cls === cls; }).length };
    });
    return { rows: rows, sum: sum, min: min, from: a.report.from, to: a.report.to, cls: a.cls };
  }
  function attDates(list) { return list.map(function (dd) { return dmy(dd).slice(0, 5); }).join('، '); }

  async function attDetail(fmt) {
    var a = attState();
    if (!a.report) return toast('اعرض تقرير الفترة أولًا', true);
    var D = attDetailData();
    if (!D.rows.length) return toast('لا يوجد من غاب ' + (D.min > 1 ? D.min + ' أيام فأكثر' : '') + ' في هذه الفترة', true);
    if (fmt === 'pdf') { pendingAtt = { kind: 'detail', D: D }; return printNow(); }
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new(), used = {};
      wb.Workbook = { Views: [{ RTL: true }] };
      var top = [[schoolName()], ['كشف الغياب المفصّل — من ' + dmy(D.from) + ' إلى ' + dmy(D.to)], ['الشعبة: ' + (D.cls || 'كل المدرسة') + ' · من غاب ' + (D.min > 1 ? D.min + ' أيام فأكثر' : 'يومًا فأكثر') + ' · عدد الطلاب: ' + D.rows.length], []];
      xlsxSheet(wb, used, 'كشف الغياب', top.concat([['م', 'الطالب', 'الشعبة', 'أيام الغياب', 'الأيام المسجّلة', 'نسبة الحضور', 'أطول غياب متصل', 'آخر غياب', 'تواريخ الغياب', 'ملاحظات الغياب', 'ولي الأمر', 'هاتف ولي الأمر', 'واتساب ولي الأمر', 'جوال الطالب']],
        D.rows.map(function (r, i) {
          return [i + 1, r.x.full_name + rsvText(r.x), r.cls, r.absent, r.absent + r.present, r.pct, r.streak, r.last ? dmy(r.last) : '', attDates(r.dates), r.notes.join(' · '), r.guardian, r.phone, r.whatsapp, r.student];
        })), [5, 32, 12, 10, 12, 11, 13, 12, 40, 30, 28, 15, 15, 15]);
      xlsxSheet(wb, used, 'ملخص الشعب', top.concat([['الشعبة', 'الطلاب', 'أيام التسجيل', 'الغياب (طالب×يوم)', 'نسبة الحضور', 'في الكشف']], D.sum.map(function (c) {
        return [c.cls, c.students, c.days, c.absent, c.pct, c.listed];
      })), [16, 9, 12, 16, 12, 10]);
      XLSX.writeFile(wb, ('كشف-الغياب-المفصل-' + (D.cls || 'المدرسة') + '-' + D.from + '-' + D.to).replace(/\s+/g, '-') + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ----- سجل حضور وغياب طالب واحد في فترة التقرير: كل يوم سُجّل له، بحالته وملاحظته ----- */
  function attStudentData(sid) {
    var a = attState(), x = findStudent(sid);
    if (!a.report || !x) return null;
    var rows = a.report.rows.filter(function (r) { return r.student_id === sid; }).sort(function (p, q) { return p.day.localeCompare(q.day); });
    var n = { present: 0, absent: 0, excused: 0, suspended: 0 };
    rows.forEach(function (r) { n[r.status]++; });
    return { x: x, rows: rows, n: n, from: a.report.from, to: a.report.to };
  }

  function attStudentRecord(sid, fmt) {
    var D = attStudentData(sid);
    if (!D) return toast('اعرض تقرير الفترة أولًا', true);
    return attStudentOut(D, fmt);
  }

  async function attStudentOut(D, fmt) {
    if (!D.rows.length) return toast('لا يوجد حضور مسجَّل لهذا الطالب في الفترة', true);
    if (fmt === 'pdf') { pendingAtt = { kind: 'student', D: D }; return printNow(); }
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new(), used = {};
      wb.Workbook = { Views: [{ RTL: true }] };
      xlsxSheet(wb, used, 'سجل الطالب', [[schoolName()], ['سجل الحضور والغياب — ' + D.x.full_name + rsvText(D.x)], ['الشعبة: ' + (D.x.class_name || '—') + ' · من ' + dmy(D.from) + ' إلى ' + dmy(D.to)],
        ['حاضر: ' + D.n.present + ' · غائب: ' + D.n.absent + (D.n.excused ? ' · مأذون: ' + D.n.excused : '') + (D.n.suspended ? ' · مفصول: ' + D.n.suspended : '') + ' · نسبة الحضور: ' + attPct(D.n)], [],
        ['م', 'التاريخ', 'اليوم', 'الحالة', 'ملاحظة']].concat(D.rows.map(function (r, i) { return [i + 1, dmy(r.day), dayName(r.day), ATT[r.status], r.note || '']; })), [5, 13, 12, 10, 40]);
      XLSX.writeFile(wb, ('سجل-حضور-' + D.x.full_name + '-' + D.from + '-' + D.to).replace(/s+/g, '-') + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  function buildAttStudentSheet(D) {
    var head = reportHead('سجل الحضور والغياب', [['الفترة', 'من ' + dmy(D.from) + ' إلى ' + dmy(D.to)], ['الشعبة', D.x.class_name || ''],
      ['حاضر', D.n.present], ['غائب', D.n.absent]].concat(D.n.excused ? [['مأذون', D.n.excused]] : [], D.n.suspended ? [['مفصول', D.n.suspended]] : [], [['نسبة الحضور', attPct(D.n)]]), { lead: D.x.full_name }).replace(/^<img class="wm"[^>]*>/, '');
    var body = D.rows.map(function (r, i) {
      return '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + dmy(r.day) + '</td><td class="c">' + esc(dayName(r.day)) + '</td><td class="c">' + (r.status === 'absent' ? '<b>' + ATT[r.status] + '</b>' : ATT[r.status]) + '</td><td>' + esc(r.note || '') + '</td></tr>';
    }).join('');
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
      '<table class="rz"><thead><tr><td class="pg-space" colspan="5"></td></tr><tr><td class="ls-head" colspan="5">' + head + '</td></tr>' +
      '<tr><th>م</th><th>التاريخ</th><th>اليوم</th><th>الحالة</th><th>ملاحظة</th></tr></thead><tbody>' + body + '</tbody><tfoot><tr><td class="pg-space" colspan="5"></td></tr></tfoot></table>';
  }

  // الطباعة: أفقية، رأس الجدول يتكرر إن امتد الكشف إلى أكثر من صفحة
  function buildAttDetailSheet(D) {
    var head = reportHead('كشف الغياب المفصّل', [['الفترة', 'من ' + dmy(D.from) + ' إلى ' + dmy(D.to)], ['الشعبة', D.cls || 'كل المدرسة'],
      ['الكشف', 'من غاب ' + (D.min > 1 ? D.min + ' أيام فأكثر' : 'يومًا فأكثر')], ['عدد الطلاب', D.rows.length]]).replace(/^<img class="wm"[^>]*>/, '');
    var c = function (v, b) { return '<td class="c" style="white-space:nowrap">' + (b ? '<b>' + v + '</b>' : v) + '</td>'; };
    var n = 13, prev = '';
    var body = D.rows.map(function (r, i) {
      var first = r.cls !== prev;
      prev = r.cls;
      return '<tr' + (first && i ? ' style="border-top:2px solid #7d8597"' : '') + '>' + c(i + 1) + '<td style="white-space:nowrap"><b>' + esc(r.x.full_name) + '</b>' + rsvMark(r.x) + '</td>' + c(esc(r.cls)) +
        c(r.absent, true) + c(r.pct) + c(r.streak > 1 ? r.streak + ' أيام' : r.streak) + '<td style="font-size:.85em">' + esc(attDates(r.dates)) + '</td><td style="font-size:.85em">' + esc(r.notes.join(' · ')) + '</td>' +
        '<td style="font-size:.9em">' + esc(r.guardian) + '</td>' + c('<span dir="ltr">' + esc(r.phone) + '</span>') + c('<span dir="ltr">' + esc(r.whatsapp) + '</span>') + c('<span dir="ltr">' + esc(r.student) + '</span>') + '<td></td></tr>';
    }).join('');
    printLandscape = true;
    sheet.style.width = '267mm';
    sheet.className = 'ls att-detail';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
      '<table class="rz"><thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>' +
      '<tr><th>م</th><th>الطالب</th><th>الشعبة</th><th>أيام<br>الغياب</th><th>نسبة<br>الحضور</th><th>أطول غياب<br>متصل</th><th>تواريخ الغياب</th><th>ملاحظات</th><th>ولي الأمر</th><th>هاتف ولي الأمر</th><th>واتساب</th><th>جوال الطالب</th><th>المتابعة</th></tr></thead>' +
      '<tbody>' + body + '</tbody><tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>' +
      '<table class="rz" style="margin-top:.8em"><thead><tr><th>الشعبة</th><th>الطلاب</th><th>أيام التسجيل</th><th>الغياب (طالب×يوم)</th><th>نسبة الحضور</th><th>في الكشف</th></tr></thead><tbody>' +
        D.sum.map(function (s2) { return '<tr><td><b>' + esc(s2.cls) + '</b></td>' + c(s2.students) + c(s2.days) + c(s2.absent) + c(s2.pct) + c(s2.listed, true) + '</tr>'; }).join('') + '</tbody></table>' +
      '<p style="font-size:.8em;color:#5e6b80;margin:.5em 0 0">أيام الغياب ونسبة الحضور من الأيام التي سُجّل فيها حضور شعبة الطالب. أطول غياب متصل: أيام دراسية متتالية سُجّل فيها غائبًا. خانة «المتابعة» للكتابة (اتصال، زيارة، إجراء). تاريخ الإصدار: ' + dmy(todayISO()) + '</p>';
  }

  /* ----- كشوف الحضور: Excel و PDF -----
     كشف شهري لكل شعبة بالأسماء وأيام الشهر، وتقارير المدرسة: يومي وأسبوعي (السبت إلى الجمعة) وشهري */

  var ATT_MARK = { present: '✓', absent: 'غـ', excused: 'م', suspended: 'ف' };

  // يوم لا دراسة فيه: الجمعة والسبت، وما أُضيف عطلةً
  function attOff(day) {
    var w = new Date(day + 'T00:00').getDay();
    return w === 5 || w === 6 || classConfig().holidays.indexOf(day) > -1;
  }

  function attHoliday(day) { return classConfig().holidays.indexOf(day) > -1; }

  function classTeacher(cls) { var info = classInfo(cls); return info && info.teacher ? info.teacher : ''; }

  async function setHoliday(day, on) {
    var cfg = classConfig(), list = cfg.holidays.filter(function (d) { return d !== day; });
    if (on) list.push(day);
    await saveClassConfig({ rooms: cfg.rooms, list: cfg.list, fees: cfg.fees, holidays: list.sort() });
  }
  var WEEKDAYS = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

  function isoOf(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function daysBetween(from, to) {
    var out = [], d = new Date(from + 'T00:00'), end = new Date(to + 'T00:00');
    while (d <= end) { out.push(isoOf(d)); d.setDate(d.getDate() + 1); }
    return out;
  }

  function monthRange(month) {
    var y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
    return { from: month + '-01', to: isoOf(new Date(y, m, 0)) };
  }

  // الأسبوع الدراسي الذي فيه اليوم: من السبت إلى الجمعة
  function weekRange(day) {
    var d = new Date(day + 'T00:00');
    d.setDate(d.getDate() - (d.getDay() + 1) % 7);
    var from = isoOf(d);
    d.setDate(d.getDate() + 6);
    return { from: from, to: isoOf(d) };
  }

  async function fetchAttRange(from, to) {
    if (S.stLeaves == null) await loadStLeaves();
    return attNormRows(await fetchAll(function () { return sb.from('attendance').select('student_id, day, status, note, class_name').gte('day', from).lte('day', to).order('day').order('student_id'); }));
  }

  function xlsxSheet(wb, used, name, aoa, widths) {
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = widths.map(function (w) { return { wch: w }; });
    var base = String(name).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 28) || 'ورقة', nm = base, k = 2;
    while (used[nm]) nm = base + ' ' + k++;
    used[nm] = true;
    XLSX.utils.book_append_sheet(wb, ws, nm);
  }

  function schoolRange(kind, day) {
    var range = kind === 'day' ? { from: day, to: day } : kind === 'week' ? weekRange(day) : monthRange(day.slice(0, 7));
    range.label = kind === 'day' ? 'تقرير يومي — ' + dayName(day) + ' ' + dmy(day) : kind === 'week' ? 'تقرير أسبوعي — من ' + dmy(range.from) + ' إلى ' + dmy(range.to) : 'تقرير شهري — ' + monthLabel(day.slice(0, 7));
    return range;
  }

  // أسماء غائبي الشعبة في الفترة: في اليوم بلا عدد، وفي الأسبوع والشهر «الاسم (عدد الأيام)» الأكثر أولًا
  function absentNames(cls, per, kind) {
    return classRoll(cls).filter(function (x) { return (per[x.id] || {}).absent > 0; })
      .sort(function (p, q) { return per[q.id].absent - per[p.id].absent || p.full_name.localeCompare(q.full_name, 'ar'); })
      .map(function (x) { return shortName(x) + (kind === 'day' ? '' : ' (' + per[x.id].absent + ')'); });
  }

  // جلب سجلات المطلوب ثم تنفيذ الدالة عليها (للتصدير والطباعة)
  async function withAttRange(range, done) {
    if (!(await syncData(true))) return;
    var rows = await fetchAttRange(range.from, range.to);
    if (!rows) return toast('تعذر جلب سجلات الحضور', true);
    return done(rows);
  }

  function registerMonth() { var a = attState(); return a.expMonth || a.day.slice(0, 7); }
  function registerClasses() {
    var a = attState();
    return (a.cls ? [a.cls] : attClasses()).filter(function (c) { return classRoll(c).length; });
  }

  // كشف الشهر لكل شعبة (Excel): صف لكل طالب، وعمود لكل يوم من أيام الشهر
  function exportAttRegister() {
    var a = attState(), month = registerMonth(), range = monthRange(month);
    return withAttRange(range, async function (rows) {
      try {
        await loadXlsx();
        var d = attCollect(rows), days = daysBetween(range.from, range.to), wb = XLSX.utils.book_new(), used = {}, classes = registerClasses();
        wb.Workbook = { Views: [{ RTL: true }] };
        if (!classes.length) return toast('لا توجد شعب فيها مسجَّلون نهائيًا', true);
        classes.forEach(function (cls) {
          var roll = classRoll(cls), absentPerDay = days.map(function () { return 0; }), recorded = days.map(function (dd) { return !!((d.byClass[cls] || {}).days || {})[dd]; });
          var head = ['م', 'اسم الطالب'].concat(days.map(function (dd) { return Number(dd.slice(8)) + (attOff(dd) ? ' (' + (attHoliday(dd) ? 'عطلة' : WEEKDAYS[new Date(dd + 'T00:00').getDay()]) + ')' : ''); }), ['أيام الحضور', 'أيام الغياب']);
          var body = roll.map(function (x, i) {
            var p = d.per[x.id] || { present: 0, absent: 0, days: {} };
            var cells = days.map(function (dd, j) { var st = p.days[dd]; if (st === 'absent') absentPerDay[j]++; return st ? attMark(st, x.id, dd) : ''; });
            return [i + 1, x.full_name + rsvText(x)].concat(cells, [p.present, p.absent]);
          });
          var foot = ['', 'عدد الغائبين في اليوم'].concat(absentPerDay.map(function (v, j) { return recorded[j] ? v : ''; }));
          xlsxSheet(wb, used, cls, [[schoolName()], ['كشف الحضور والغياب — ' + monthLabel(month)], ['الصف: ' + cls, '', 'مربي الصف: ' + (classTeacher(cls) || ''), '', '', '', '', '', 'عدد الطلاب: ' + roll.length], [], head].concat(body, [foot, [],
            ['', 'المفتاح: ✓ حاضر · غـ غائب · م مأذون · ف مفصول مؤقتًا · الجمعة والسبت والعطل مذكورة في رأس عمودها · فارغ: لم يُسجَّل حضور الشعبة ذلك اليوم']]),
            [4, 30].concat(days.map(function (dd) { return attOff(dd) ? 9 : 5; }), [10, 10]));
        });
        XLSX.writeFile(wb, ('كشف-الحضور-' + (a.cls || 'كل-الشعب') + '-' + month).replace(/\s+/g, '-') + '.xlsx');
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  // تقرير المدرسة (Excel): ملخص الشعب مع أسماء الغائبين، والغياب يومًا بيوم، وقائمة الغائبين
  function exportAttSchool(kind) {
    var a = attState(), day = a.expDay || a.day, range = schoolRange(kind, day);
    return withAttRange(range, async function (rows) {
      try {
        await loadXlsx();
        var wb = XLSX.utils.book_new(), used = {}, days = daysBetween(range.from, range.to), d = attCollect(rows);
        wb.Workbook = { Views: [{ RTL: true }] };
        var top = function () { return [[schoolName()], ['الحضور والغياب — ' + range.label], []]; };
        var all = { present: 0, absent: 0 }, classes = attClasses().filter(function (c) { return classRoll(c).length; });
        xlsxSheet(wb, used, 'ملخص الشعب', top().concat([['الشعبة', 'الطلاب', 'أيام التسجيل', kind === 'day' ? 'حاضر' : 'حضور (طالب×يوم)', kind === 'day' ? 'غائب' : 'غياب (طالب×يوم)', 'نسبة الحضور', 'أسماء الغائبين']], classes.map(function (cls) {
          var c = d.byClass[cls];
          if (!c) return [cls, classRoll(cls).length, 0, '', '', 'لم يُسجَّل', ''];
          all.present += c.n.present; all.absent += c.n.absent;
          return [cls, classRoll(cls).length, Object.keys(c.days).length, c.n.present, c.n.absent, attPct(c.n), absentNames(cls, d.per, kind).join('، ')];
        }), [['المدرسة', classes.reduce(function (t, c) { return t + classRoll(c).length; }, 0), '', all.present, all.absent, attPct(all), '']],
          a.dayNote ? [[], ['ملاحظات حول اليوم الدراسي:'], [a.dayNote]] : []), [18, 9, 12, 14, 14, 12, 70]);
        if (kind !== 'day') {
          xlsxSheet(wb, used, 'الغياب حسب اليوم', top().concat([['الشعبة'].concat(days.map(function (dd) { return Number(dd.slice(8)) + ' ' + WEEKDAYS[new Date(dd + 'T00:00').getDay()]; }), ['المجموع'])],
            classes.map(function (cls) {
              var sum = 0;
              return [cls].concat(days.map(function (dd) { var v = d.cell[cls + '|' + dd]; if (v) sum += v.absent; return v ? v.absent : ''; }), [sum]);
            }), [[], ['', 'العدد: الغائبون في الشعبة ذلك اليوم · فارغ: لم يُسجَّل حضور الشعبة']]),
            [18].concat(days.map(function () { return 8; }), [10]));
        }
        var list = S.students.filter(function (x) { return (d.per[x.id] || {}).absent > 0; })
          .sort(function (p, q) { return classRank(p.class_name) - classRank(q.class_name) || d.per[q.id].absent - d.per[p.id].absent || p.full_name.localeCompare(q.full_name, 'ar'); });
        xlsxSheet(wb, used, 'الغائبون', top().concat([['م', 'الطالب', 'الشعبة', 'أيام الغياب', 'ملاحظات', 'ولي الأمر', 'هاتف ولي الأمر', 'واتساب ولي الأمر']], list.map(function (x, i) {
          var p = d.per[x.id];
          return [i + 1, x.full_name, x.class_name || '', p.absent, p.notes.join(' · '), x.guardian_name || '', plainPhone(x.phone), plainPhone(x.whatsapp)];
        })), [5, 32, 14, 10, 30, 26, 16, 16]);
        XLSX.writeFile(wb, ('تقرير-الحضور-' + (kind === 'day' ? 'يومي-' + day : kind === 'week' ? 'أسبوعي-' + range.from : 'شهري-' + day.slice(0, 7))) + '.xlsx');
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  /* الطباعة (وحفظها PDF من نافذة الطباعة) */
  var pendingAtt = null;

  // teacher: نسخة المعلم: الأسماء وأيام الشهر مع ✓ للحاضر وغـ للغائب، بلا أعداد الحضور والغياب
  function printAttRegister(teacher) {
    var month = registerMonth(), range = monthRange(month);
    return withAttRange(range, function (rows) {
      var classes = registerClasses();
      if (!classes.length) return toast('لا توجد شعب فيها مسجَّلون نهائيًا', true);
      pendingAtt = { kind: 'register', month: month, range: range, classes: classes, d: attCollect(rows), teacher: !!teacher };
      printNow();
    });
  }

  function printAttSchool(kind) {
    var a = attState(), day = a.expDay || a.day, range = schoolRange(kind, day);
    return withAttRange(range, function (rows) {
      // الملاحظات المكتوبة تخص اليوم؛ تقريرا الأسبوع والشهر يُطبعان بأسطر فارغة للكتابة
      pendingAtt = { kind: kind, day: day, range: range, d: attCollect(rows), note: kind === 'day' ? a.dayNote || '' : '' };
      printNow();
    });
  }

  function buildAttSheet(p) {
    if (p.kind === 'register') return buildAttRegisterSheet(p);
    if (p.kind === 'detail') return buildAttDetailSheet(p.D);
    if (p.kind === 'student') return buildAttStudentSheet(p.D);
    var d = p.d, all = { present: 0, absent: 0, excused: 0, suspended: 0 }, total = 0;
    var c = function (v) { return '<td class="c">' + v + '</td>'; };
    var rows = attClasses().filter(function (cls) { return classRoll(cls).length; }).map(function (cls, i) {
      var k = d.byClass[cls], n = classRoll(cls).length;
      total += n;
      if (!k) return '<tr>' + c(i + 1) + '<td><b>' + esc(cls) + '</b></td>' + c(n) + '<td class="c" colspan="3" style="color:#7d8597">لم يُسجَّل</td><td></td></tr>';
      all.present += k.n.present; all.absent += k.n.absent; all.excused += k.n.excused; all.suspended += k.n.suspended;
      return '<tr>' + c(i + 1) + '<td style="white-space:nowrap"><b>' + esc(cls) + '</b></td>' + c(n) + c(k.n.present) + c(k.n.absent ? '<b>' + k.n.absent + '</b>' : 0) + c(attPct(k.n)) +
        '<td style="font-size:.88em">' + esc(absentNames(cls, d.per, p.kind).join('، ') || '—') + '</td></tr>';
    }).join('');
    var per = p.kind === 'day' ? '' : ' (طالب×يوم)';
    var noteTitle = p.kind === 'day' ? 'ملاحظات حول اليوم الدراسي' : p.kind === 'week' ? 'ملاحظات حول الأسبوع الدراسي' : 'ملاحظات حول الشهر الدراسي';
    sheet.className = 'rm att-sch';
    sheet.innerHTML =
      reportHead('الحضور والغياب — ' + p.range.label.split(' — ')[0], [[p.kind === 'day' ? 'اليوم' : 'الفترة', p.range.label.split(' — ')[1]], ['عدد الطلاب', total], ['الحاضرون' + per, all.present], ['الغائبون' + per, all.absent]].concat(all.excused ? [['المأذونون' + per, all.excused]] : [], [['نسبة الحضور', attPct(all)]])) +
      '<table class="rz"><colgroup><col style="width:5%"><col style="width:13%"><col style="width:8%"><col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:47%"></colgroup>' +
      '<thead><tr><th>م</th><th>الشعبة</th><th>الطلاب</th><th>حاضر' + (per ? '<br><small>طالب×يوم</small>' : '') + '</th><th>غائب' + (per ? '<br><small>طالب×يوم</small>' : '') + '</th><th>نسبة الحضور</th><th>أسماء الغائبين' + (per ? ' (عدد أيام الغياب)' : '') + '</th></tr></thead><tbody>' + rows +
      '<tr class="total"><td colspan="2">المدرسة</td>' + c(total) + c(all.present) + c(all.absent) + c(attPct(all)) + '<td></td></tr></tbody></table>' +
      '<div class="att-notes"><b>' + noteTitle + ':</b><div class="att-lines">' + esc(p.note) + '</div></div>';
    fitSheet();
  }

  // كشف الشهر للشعب: صفحة أفقية لكل شعبة، صف لكل طالب وعمود لكل يوم
  function buildAttRegisterSheet(p) {
    var days = daysBetween(p.range.from, p.range.to), d = p.d;
    printLandscape = true;
    var pages = p.classes.map(function (cls) {
      var roll = classRoll(cls), recorded = {}, absentPerDay = {};
      days.forEach(function (dd) { recorded[dd] = !!((d.byClass[cls] || {}).days || {})[dd]; absentPerDay[dd] = 0; });
      var fri = attOff;
      var body = roll.map(function (x, i) {
        var q = d.per[x.id] || { present: 0, absent: 0, days: {} };
        if (p.teacher) return '<tr class="tc"><td class="c">' + (i + 1) + '</td><td class="nm">' + esc(x.full_name) + rsvMark(x) + '</td>' + days.map(function (dd) {
          var st = q.days[dd];
          return '<td class="c' + (fri(dd) ? ' fr' : '') + (st === 'absent' ? ' ab' : '') + '">' + (st ? attMark(st, x.id, dd) : '') + '</td>';
        }).join('') + '</tr>';
        return '<tr><td class="c">' + (i + 1) + '</td><td class="nm">' + esc(x.full_name) + rsvMark(x) + '</td>' + days.map(function (dd) {
          var st = q.days[dd];
          if (st === 'absent') absentPerDay[dd]++;
          return '<td class="c' + (fri(dd) ? ' fr' : '') + (st === 'absent' ? ' ab' : '') + '">' + (st ? attMark(st, x.id, dd) : '') + '</td>';
        }).join('') + '<td class="c">' + q.present + '</td><td class="c"><b>' + q.absent + '</b></td></tr>';
      }).join('');
      return '<section class="att-page">' +
        '<div class="att-title"><b>' + esc(schoolName()) + '</b><span>' + (p.teacher ? 'سجل الحضور والغياب (نسخة المعلم)' : 'كشف الحضور والغياب') + ' — ' + monthLabel(p.month) + '</span><span></span></div>' +
        '<div class="att-sub"><span>الصف: <b>' + esc(cls) + '</b></span><span>مربي الصف: <b>' + esc(classTeacher(cls) || '..................................') + '</b></span><span>عدد الطلاب: <b>' + roll.length + '</b></span></div>' +
        '<table class="rz att-reg"><thead><tr><th>م</th><th>اسم الطالب</th>' + days.map(function (dd) { return '<th class="' + (fri(dd) ? 'fr' : '') + '">' + Number(dd.slice(8)) + '</th>'; }).join('') +
          (p.teacher ? '' : '<th class="tot">حضور</th><th class="tot">غياب</th>') + '</tr></thead>' +
        '<tbody>' + body + (p.teacher ? '</tbody></table>' : '<tr class="total"><td colspan="2">عدد الغائبين في اليوم</td>' + days.map(function (dd) { return '<td class="c' + (fri(dd) ? ' fr' : '') + '">' + (recorded[dd] ? absentPerDay[dd] : attHoliday(dd) ? 'ع' : '') + '</td>'; }).join('') + '<td colspan="2"></td></tr></tbody></table>') +
        '<p class="att-key">' + (roll.some(isReserve) ? '* احتياط · ' : '') + (p.teacher ? 'المفتاح: ✓ حاضر · غـ غائب · م مأذون · ف مفصول مؤقتًا · الأعمدة المظلّلة: الجمعة والسبت والعطل · الخانة الفارغة: لم يُسجَّل حضور الشعبة ذلك اليوم' : 'المفتاح: ✓ حاضر · غـ غائب · م مأذون · ف مفصول مؤقتًا · الأعمدة المظلّلة: الجمعة والسبت والعطل' + (days.some(attHoliday) ? ' (ع: عطلة)' : '') + ' · الخانة الفارغة: لم يُسجَّل حضور الشعبة ذلك اليوم') + ' · تاريخ الإصدار: ' + dmy(todayISO()) + '</p></section>';
    }).join('');
    sheet.className = 'att-regs';
    sheet.removeAttribute('data-fit');
    sheet.style.width = '267mm';
    sheet.innerHTML = pages;
    fitRegisterPages(sheet);
  }

  // يُكبَّر خط كل شعبة في كشف الشهر إلى أكبر حجم تتسع به في صفحة A4 أفقية، دون أن يُقصّ اسم طالب.
  // لا يصغر عن 11pt: الشعبة الكبيرة تمتد على صفحة ثانية ويتكرر رأس الجدول فيها
  function fitRegisterPages(root) {
    var maxH = (REPORT.page.width - 2 * REPORT.page.marginY - 4) * 96 / 25.4;
    Array.prototype.forEach.call(root.querySelectorAll('.att-page'), function (pg) {
      var size = 14, names = pg.querySelectorAll('td.nm, thead th'); // الأسماء وأرقام الأيام لا تُقص ولا تنكسر
      var tooBig = function () {
        if (pg.offsetHeight > maxH) return true;
        for (var i = 0; i < names.length; i++) if (names[i].scrollWidth > names[i].clientWidth + 1) return true;
        return false;
      };
      pg.style.fontSize = size + 'pt';
      while (tooBig() && size > 11) {
        size -= 0.25;
        pg.style.fontSize = size + 'pt';
      }
      // شعبة قليلة العدد: تطول صفوفها لتملأ الصفحة (حتى 12mm للصف) فتتسع خانات الكتابة
      var rows = pg.querySelectorAll('tbody tr:not(.total)'), spare = maxH - pg.offsetHeight;
      if (rows.length && spare > 0) {
        var h = Math.min(rows[0].offsetHeight + spare / rows.length, 12 * 96 / 25.4);
        Array.prototype.forEach.call(rows, function (tr) { tr.firstElementChild.style.height = Math.floor(h) + 'px'; });
      }
    });
  }

  function attExportHtml() {
    var a = attState(), month = registerMonth(), day = a.expDay || a.day, wk = weekRange(day);
    var pair = function (attr, label) {
      return '<span class="acts" style="display:inline-flex"><b style="font-size:.9rem;margin-inline-end:4px">' + label + '</b>' +
        '<button type="button" class="btn" ' + attr.replace('X', 'pdf') + '>PDF</button><button type="button" class="btn" ' + attr.replace('X', 'xlsx') + '>Excel</button></span>';
    };
    return '<div class="card no-print"><h2>الكشوف (PDF و Excel)</h2>' +
      '<div class="toolbar" style="align-items:center;margin-top:8px">' +
        '<span class="monthpick"><label class="field" for="att-exp-month">الشهر</label><input type="month" id="att-exp-month" value="' + month + '"></span>' +
        pair('data-attregister="X"', a.cls ? 'كشف ' + esc(a.cls) + ' الشهري بالأسماء:' : 'كشوف الشعب الشهرية بالأسماء:') +
        '<button type="button" class="btn" data-attteacher title="الأسماء وأيام الشهر بخانات فارغة، بلا أعداد الحضور والغياب">نسخة المعلم (PDF)</button></div>' +
      '<div class="toolbar" style="align-items:center">' +
        '<span class="monthpick"><label class="field" for="att-exp-day">تقرير المدرسة عن يوم</label><input type="date" id="att-exp-day" max="' + todayISO() + '" value="' + day + '"></span>' +
        pair('data-attschool="day" data-fmt="X"', 'يومي:') +
        pair('data-attschool="week" data-fmt="X"', 'أسبوعي (' + dmy(wk.from).slice(0, 5) + '–' + dmy(wk.to).slice(0, 5) + '):') +
        pair('data-attschool="month" data-fmt="X"', 'شهري (' + monthLabel(day.slice(0, 7)) + '):') + '</div>' +
      (isAdmin() ? (function () {
        var range = monthRange(month), hol = classConfig().holidays.filter(function (dd) { return dd >= range.from && dd <= range.to; });
        return '<div class="toolbar" style="align-items:center">' +
          '<span class="monthpick"><label class="field" for="att-hol">إضافة يوم عطلة</label><input type="date" id="att-hol"></span>' +
          '<button type="button" class="btn" data-attholadd>إضافة عطلة</button>' +
          '<span class="st-count" style="margin:0">عطل ' + monthLabel(month) + ': ' + (hol.length ? hol.map(function (dd) {
            return '<span class="badge pending" style="margin-inline-start:4px">' + dayName(dd) + ' ' + dmy(dd) + ' <button type="button" class="btn link" data-attholdel="' + dd + '" title="حذف العطلة" style="padding:0 2px">×</button></span>';
          }).join('') : 'لا عطل غير الجمعة والسبت') + '</span></div>';
      })() : '') +
      '<label class="field" for="att-notes">ملاحظات حول اليوم الدراسي (تُطبع في الثلث الأخير من كشف المدرسة)</label>' +
      '<textarea id="att-notes" rows="3" placeholder="اتركها فارغة لتُطبع أسطرًا للكتابة باليد">' + esc(a.dayNote || '') + '</textarea>' +
      '<p class="hint" style="margin:6px 0 0">الكشف الشهري: صفحة أفقية لكل شعبة، صف لكل طالب وعمود لكل يوم (✓ حاضر · غـ غائب)، والجمعة والسبت والعطل مظلّلة. كشف المدرسة: الشعب بأعدادها ونسبها وأسماء غائبيها. الأسبوع من السبت إلى الجمعة. الملاحظات لا تُحفظ في البرنامج، تُطبع فقط.</p></div>';
  }

  /* ----- روابط المعلمين لتسجيل الغياب، ومفتاح n8n (مدير النظام) -----
     كل معلم له رابط سري (absence.html?t=…) يسجّل منه الغياب بلا حساب، ويُعرف به في بوت الواتساب برقم جواله.
     الجداول من supabase/attendance_links.sql */
  S.attLinks = null;      // null: لم تُجلب بعد
  S.attBotKey = '';
  S.attLinksMissing = false;

  async function loadAttLinks() {
    var r = await sb.from('attendance_tokens').select('*').order('name');
    if (r.error) { S.attLinksMissing = true; S.attLinks = []; render(); return; }
    var k = await sb.from('attendance_settings').select('bot_key').eq('id', 1).maybeSingle();
    S.attLinks = r.data || [];
    S.attBotKey = (k.data && k.data.bot_key) || '';
    render();
  }

  function absenceLink(token) {
    return location.origin + location.pathname.replace(/[^\/]*$/, '') + 'absence.html?t=' + token;
  }

  function attLinksHtml() {
    if (!isAdmin()) return '';
    if (S.attLinks == null) { loadAttLinks(); return '<div class="card no-print"><h2>تسجيل الغياب من المعلمين</h2><div class="empty">جارٍ التحميل…</div></div>'; }
    if (S.attLinksMissing) {
      return '<div class="card no-print"><h2>تسجيل الغياب من المعلمين (رابط وواتساب)</h2><p class="formhint" style="margin:0">لتفعيلها شغّل الملف <code dir="ltr">supabase/attendance_links.sql</code> في محرر SQL ثم حدّث الصفحة.</p></div>';
    }
    var rows = S.attLinks.map(function (t) {
      var link = absenceLink(t.token), wa = plainPhone(t.phone).replace(/^0/, '20');
      return '<tr' + (t.active ? '' : ' style="color:var(--muted)"') + '><td><b>' + esc(t.name) + '</b>' + (t.active ? '' : ' <span class="badge pending">موقوف</span>') + '</td>' +
        '<td dir="ltr" style="text-align:right;white-space:nowrap">' + esc(t.phone || '—') + '</td>' +
        '<td><div class="acts"><button type="button" class="btn" data-alcopy="' + esc(t.token) + '">نسخ الرابط</button>' +
          (wa ? '<a class="btn" target="_blank" rel="noopener" href="https://wa.me/' + esc(wa) + '?text=' + encodeURIComponent('رابط تسجيل الغياب الخاص بك:\n' + link) + '">إرسال واتساب</a>' : '') +
          '<button type="button" class="btn" data-altoggle="' + esc(t.token) + '">' + (t.active ? 'إيقاف' : 'تفعيل') + '</button>' +
          '<button type="button" class="btn danger" data-aldel="' + esc(t.token) + '">حذف</button></div></td></tr>';
    }).join('');
    return '<div class="card no-print"><h2>تسجيل الغياب من المعلمين (رابط وواتساب)</h2>' +
      '<p class="hint">لكل معلم رابط خاص يفتحه من جواله فيختار الشعبة ويلمس أسماء الغائبين، بلا حساب ولا كلمة مرور. ورقم جواله يعرّفه لبوت الواتساب: يرسل «غياب» إلى رقم المدرسة فيسجّل بالأرقام. لا يرى المعلم إلا أسماء طلاب الشعب، ولا يسجّل إلا ليوم اليوم. إيقاف المعلم يوقف رابطه والبوت معًا.</p>' +
      '<div class="toolbar" style="align-items:center">' +
        '<input type="text" id="al-name" placeholder="اسم المعلم" style="flex:1;min-width:160px">' +
        '<input type="text" id="al-phone" placeholder="جوال المعلم (واتساب)" dir="ltr" inputmode="tel" style="width:200px;text-align:right">' +
        '<button type="button" class="btn primary" data-aladd>إضافة معلم</button></div>' +
      (rows ? '<div class="table-wrap"><table class="grid"><thead><tr><th>المعلم</th><th>الجوال</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">لم يُضف معلمون بعد.</div>') +
      '<p class="hint" style="margin:12px 0 0">مفتاح n8n (للرسائل الصباحية وبوت الواتساب) في <a href="#/admin">الإعدادات والمستخدمون</a>.</p></div>';
  }

  // مفتاح n8n في «الإعدادات والمستخدمون»: يستعمله بوت الواتساب (الغياب وكشف الدوام) والرسائل الصباحية (supabase/attendance_links.sql)
  async function loadBotKey() {
    var k = await sb.from('attendance_settings').select('bot_key').eq('id', 1).maybeSingle();
    S.botKey = k.error ? { missing: true } : { key: (k.data && k.data.bot_key) || '' };
    render();
  }

  function botKeyCardHtml() {
    if (!isAdmin()) return '';
    if (!S.botKey) { loadBotKey(); return ''; }
    if (S.botKey.missing) return '';
    var key = S.botKey.key;
    return '<div class="card"><h2>مفتاح n8n (بوت الواتساب)</h2>' +
      '<p class="hint">يوضع في workflows الـ n8n مكان <code dir="ltr">PUT_BOT_KEY_HERE</code>: بوت الواتساب (تسجيل غياب الطلاب بكلمة «غياب»، وكشف دوام العاملين بكلمة «دوام») والرسائل الصباحية. ' +
        'من يملكه يستطيع تسجيل الغياب باسم المعلمين المسجَّلين ورفع كشوف الدوام للمراجعة، فلا تنشره. إن تسرّب فغيّره ثم ضعه في n8n.</p>' +
      '<div class="toolbar" style="align-items:center;margin:0"><code dir="ltr" style="flex:1;overflow-wrap:anywhere">' + esc(key ? (ui.botKeyShow ? key : key.slice(0, 6) + '…' + key.slice(-4)) : '—') + '</code>' +
        '<button type="button" class="btn" data-botkeyshow>' + (ui.botKeyShow ? 'إخفاء' : 'إظهار') + '</button>' +
        '<button type="button" class="btn" data-alkeycopy>نسخ المفتاح</button><button type="button" class="btn danger" data-alkeynew>تغيير المفتاح</button></div></div>';
  }

  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/admin' || !isAdmin() || !S.botKey || S.botKey.missing) return;
    if (e.target.closest('[data-botkeyshow]')) { ui.botKeyShow = !ui.botKeyShow; return render(); }
    if (e.target.closest('[data-alkeycopy]')) return copyText(S.botKey.key, 'نُسخ المفتاح');
    if (e.target.closest('[data-alkeynew]')) {
      if (!confirm('تغيير مفتاح n8n؟\nيتوقف بوت الواتساب (الغياب والدوام) والرسائل الصباحية حتى تضع المفتاح الجديد في n8n.')) return;
      var bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      var key = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      var r = await sb.from('attendance_settings').update({ bot_key: key }).eq('id', 1);
      if (r.error) return fail(r.error);
      S.botKey.key = key;
      S.attBotKey = key;
      ui.botKeyShow = true;
      render();
      toast('تغيّر المفتاح — ضعه في n8n');
    }
  });

