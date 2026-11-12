'use strict';
  /* ----- قراءة كشف الدوام المصوَّر -----
     تُرفع صورة الكشف الورقي (أو PDF)، فتقرؤها خدمة read-staff-sheet (نموذج يقرأ الصور على DeepInfra، بمفتاح على الخادم)
     وتطابق كل سطر بموظف من القائمة. الناتج يُوضع في شاشة اليوم المختار تعديلاتٍ غير محفوظة: ما شكّ فيه النموذج يُعلَّم،
     وما لم يُطابَق يُعرض لاختيار صاحبه. لا يُحفظ شيء حتى يراجع المستخدم ويضغط «حفظ» */
  async function saReadSheet(file) {
    var st = saState(), staff = saStaff('', st.day), sc = st.scan = { busy: true, msg: 'جارٍ تجهيز الصورة…', unmatched: [], unsure: {}, fromSheet: {}, date: '', error: '' };
    render();
    try {
      var pages = await scanFilePages(file), rows = [], chosen = scanModel(), model = '';
      var list = staff.map(function (t, i) { return { key: 's' + (i + 1), name: t.name, title: t.job_title || staffCat(t) }; });
      for (var p = 0; p < pages.length; p++) {
        sc.msg = 'جارٍ قراءة الكشف' + (pages.length > 1 ? ' — الصفحة ' + (p + 1) + ' من ' + pages.length : '') + '… (قد تستغرق دقيقة)';
        render();
        var req = { file: pages[p], staff: list };
        if (chosen) req.model = chosen;
        var r = await sb.functions.invoke('read-staff-sheet', { body: req });
        if (r.error || !r.data || r.data.error) {
          var why = (r.data && r.data.error) || (r.error && r.error.message) || '';
          if (/Failed to send|not found|404/i.test(why)) why = 'خدمة قراءة الكشوف غير منشورة على الخادم بعد. شغّل «Deploy Supabase functions» من تبويب Actions في GitHub.';
          else if (/API_KEY is not set/i.test(why)) why = 'خدمة القراءة منشورة لكن مفتاح DeepInfra لم يصلها. أعد تشغيل «Deploy Supabase functions» من تبويب Actions.';
          else if (/forbidden/i.test(why)) why = 'قراءة الكشوف للمدير العام والمدير فقط.';
          throw new Error(why || 'تعذر الاتصال بخدمة القراءة');
        }
        model = r.data.model || model;
        if (r.data.date && !sc.date) sc.date = r.data.date;
        rows = rows.concat(Array.isArray(r.data.rows) ? r.data.rows : []);
      }
      var used = {}, applied = 0;
      rows.forEach(function (row) {
        var idx = /^s\d+$/.test(row.key || '') ? Number(row.key.slice(1)) - 1 : -1, t = staff[idx];
        var status = row.status || (row.in || row.out ? 'present' : '');
        if (!status && !row.note) return; // سطر فارغ في الكشف
        if (!t || used[t.id]) { sc.unmatched.push(Object.assign({ status: status, dup: !!(t && used[t.id]) }, row)); return; }
        used[t.id] = 1;
        saApplyRead(t.id, row, status);
        applied++;
      });
      sc.busy = false;
      sc.model = model;
      var L = ['سطر واحد', 'سطران', 'أسطر', 'سطرًا'], E = ['موظف واحد', 'موظفَين', 'موظفين', 'موظفًا'];
      sc.msg = 'قُرئ من الكشف ' + arCount(rows.length, L) + '، وطُبّقت القراءة على ' + arCount(applied, E) +
        (Object.keys(sc.unsure).length ? '، منهم ' + arCount(Object.keys(sc.unsure).length, ['موظف واحد', 'موظفان', 'موظفين', 'موظفًا']) + ' بقراءة غير مؤكدة (بإطار برتقالي)' : '') +
        (sc.unmatched.length ? '، وبقي ' + arCount(sc.unmatched.length, L) + ' لم يُعرف صاحبه (أسفل)' : '') +
        '. راجع على الورقة ثم اضغط «حفظ».';
      sc.missing = staff.filter(function (t) { return !used[t.id]; }).length;
    } catch (err) {
      sc.busy = false;
      sc.error = err.message || String(err);
    }
    render();
  }

  /* ----- كشوف الدوام الواردة من واتساب -----
     من رقم مسموح: «دوام» ← صورة الكشف ← تأكيد التاريخ، فتُحفظ القراءة هنا بانتظار المراجعة (n8n/absence-bot.json، supabase/staff_bot.sql).
     «فتح للمراجعة» يضعها في يومها تعديلاتٍ غير محفوظة كقراءة صورة مرفوعة من الشاشة؛ وبعد «حفظ» تُعلَّم «طُبّقت» */
  function saApplyInbox(it) {
    var st = saState(), sc = st.scan = { busy: false, unmatched: [], unsure: {}, fromSheet: {}, date: '', error: '', inboxId: it.id, model: it.model, msg: '' };
    var staff = saStaff('', it.day), used = {}, applied = 0, rows = Array.isArray(it.rows) ? it.rows : [];
    rows.forEach(function (row) {
      var t = row.teacher_id && staff.filter(function (x) { return x.id === row.teacher_id; })[0];
      var status = row.status || (row.in || row.out ? 'present' : '');
      if (!status && !row.note) return;
      if (!t || used[t.id]) { sc.unmatched.push(Object.assign({ status: status, dup: !!(t && used[t.id]) }, row)); return; }
      used[t.id] = 1;
      saApplyRead(t.id, row, status);
      applied++;
    });
    var L = ['سطر واحد', 'سطران', 'أسطر', 'سطرًا'], E = ['موظف واحد', 'موظفَين', 'موظفين', 'موظفًا'];
    sc.msg = 'كشف وارد من واتساب (' + (it.sender || it.phone) + '، ' + new Date(it.created_at).toLocaleString('ar-u-nu-latn', { dateStyle: 'short', timeStyle: 'short' }) + '): ' +
      arCount(rows.length, L) + '، طُبّقت على ' + arCount(applied, E) +
      (Object.keys(sc.unsure).length ? '، منهم ' + arCount(Object.keys(sc.unsure).length, ['موظف واحد', 'موظفان', 'موظفين', 'موظفًا']) + ' بقراءة غير مؤكدة (بإطار برتقالي)' : '') +
      (sc.unmatched.length ? '، وبقي ' + arCount(sc.unmatched.length, L) + ' لم يُعرف صاحبه (أسفل)' : '') + '. راجع على الورقة ثم اضغط «حفظ».';
    sc.missing = staff.filter(function (t) { return !used[t.id]; }).length;
  }

  function saInboxHtml() {
    var list = (S.sa && S.sa.inbox) || [], st = saState();
    if (!list.length) return '';
    return '<div class="card" style="border-color:#f79009"><h2>قراءات واردة من واتساب بانتظار مراجعتك (' + list.length + ')</h2><ul style="margin:6px 0 0;padding-inline-start:18px">' +
      list.map(function (it) {
        var n = Array.isArray(it.rows) ? it.rows.length : 0;
        return '<li style="margin:6px 0"><b>كشف يوم ' + dayName(it.day) + ' ' + dmy(it.day) + '</b> — ' + arCount(n, ['سطر واحد', 'سطران', 'أسطر', 'سطرًا']) + '، من ' + esc(it.sender || it.phone) +
          ' · ' + new Date(it.created_at).toLocaleString('ar-u-nu-latn', { dateStyle: 'short', timeStyle: 'short' }) +
          (st.scan && st.scan.inboxId === it.id ? ' <span class="badge part">مفتوح الآن</span>' :
            ' <button type="button" class="btn" data-saibopen="' + it.id + '" data-ro-mgr>فتح للمراجعة</button>') +
          ' <button type="button" class="btn link" data-saibdrop="' + it.id + '" data-ro-mgr>تجاهل</button></li>';
      }).join('') + '</ul></div>';
  }

  // الأرقام المسموح لها بإرسال كشف الدوام عبر واتساب (المدير العام)
  function saPhonesHtml() {
    if (!isAdmin() || !S.sa || S.sa.botMissing) return '';
    var ph = S.sa.phones || [];
    return '<details class="card"><summary><b>إرسال كشف الدوام عبر واتساب</b> <span class="hint" style="margin:0">(' + (ph.length ? arCount(ph.length, ['رقم واحد مسموح', 'رقمان مسموحان', 'أرقام مسموحة', 'رقمًا مسموحًا']) : 'لا أرقام بعد') + ')</span></summary>' +
      '<p class="hint" style="margin:8px 0">من هذه الأرقام فقط: يرسل «دوام» إلى رقم الأكاديمية، ثم صورة الكشف، ثم يؤكد التاريخ؛ فتظهر القراءة هنا لمراجعتها وحفظها.</p>' +
      (ph.length ? '<ul style="margin:0 0 8px;padding-inline-start:18px">' + ph.map(function (p) {
        return '<li><span dir="ltr">+' + esc(p.phone) + '</span>' + (p.name ? ' — ' + esc(p.name) : '') + ' <button type="button" class="btn link" data-saphdel="' + esc(p.phone) + '">حذف</button></li>';
      }).join('') + '</ul>' : '') +
      '<div class="toolbar" style="align-items:center;margin:0"><input type="text" id="sa-ph-num" dir="ltr" inputmode="tel" placeholder="+972599… أو 010…" style="max-width:200px;text-align:right">' +
      '<input type="text" id="sa-ph-name" placeholder="الاسم (اختياري)" style="max-width:200px"><button type="button" class="btn" data-saphadd>إضافة رقم</button></div></details>';
  }

  // العدد مع المعدود بالعربية: 1 «سطر واحد»، 2 «سطران»، 3-10 «أسطر»، وما فوقها «سطرًا»
  function arCount(n, w) { return n === 1 ? w[0] : n === 2 ? w[1] : n + ' ' + (n >= 3 && n <= 10 ? w[2] : w[3]); }

  function saApplyRead(id, row, status) {
    var sc = saState().scan, patch = { status: status || 'present', note: row.note || (saRow(id) || {}).note || '' };
    if (patch.status === 'present') { patch.time_in = row.in || ''; patch.time_out = row.out || ''; }
    saEdit(id, patch);
    sc.fromSheet[id] = row.name || '';
    if (row.unsure && row.unsure.length) sc.unsure[id] = row.unsure; else delete sc.unsure[id];
  }

  // بطاقة القراءة: الرفع، والحالة، والأسطر التي لم يُعرف صاحبها
  function saScanHtml() {
    var st = saState(), sc = st.scan;
    var models = isAdmin() ? '<details style="margin-top:6px"><summary class="hint">نموذج القراءة</summary><div class="toolbar" style="align-items:center;margin-top:6px">' +
      '<input type="text" id="sa-model" data-ro-mgr list="sa-models" dir="ltr" placeholder="الافتراضي على الخادم" value="' + esc(scanModel()) + '" style="max-width:320px">' +
      '<datalist id="sa-models">' + SCAN_MODELS.map(function (m) { return '<option value="' + esc(m) + '">'; }).join('') + '</datalist></div></details>' : '';
    var body = '';
    if (sc) {
      if (sc.busy) body = '<p class="hint" style="margin:8px 0 0">' + esc(sc.msg) + '</p>';
      else if (sc.error) body = '<p class="formhint" style="margin:8px 0 0">' + esc(sc.error) + '</p>';
      else {
        body = '<p class="hint" style="margin:8px 0 0">' + esc(sc.msg) + (sc.model ? ' <span dir="ltr">(' + esc(sc.model) + ')</span>' : '') + '</p>' +
          (sc.date && sc.date !== st.day ? '<p class="formhint" style="margin:6px 0 0">تنبيه: التاريخ المكتوب على الكشف ' + dmy(sc.date) + '، والقراءة طُبّقت على يوم ' + dmy(st.day) + '. تأكد أنه اليوم الصحيح قبل الحفظ.</p>' : '') +
          (sc.missing ? '<p class="hint" style="margin:6px 0 0">لم يظهر في الكشف ' + arCount(sc.missing, ['موظف واحد', 'موظفان', 'موظفين', 'موظفًا']) + '؛ بقيت حالتهم كما هي.</p>' : '');
        if (sc.unmatched.length) {
          var opts = '<option value="">— اختر الموظف —</option>' + saStaff('', st.day).map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('');
          body += '<div class="table-wrap" style="margin-top:8px"><table class="grid"><thead><tr><th>الاسم كما في الكشف</th><th>القراءة</th><th>صاحبه</th></tr></thead><tbody>' +
            sc.unmatched.map(function (u, i) {
              return '<tr><td><b>' + esc(u.name || '—') + '</b>' + (u.dup ? ' <span class="badge part">تكرر في الكشف</span>' : '') + '</td>' +
                '<td>' + esc((u.status ? SA_STATUS[u.status] : '') + (u.in ? ' · ' + u.in : '') + (u.out ? ' – ' + u.out : '') + (u.note ? ' · ' + u.note : '')) + '</td>' +
                '<td><select data-saunm="' + i + '" data-ro-mgr style="width:auto">' + opts + '</select></td></tr>';
            }).join('') + '</tbody></table></div>';
        }
      }
    }
    return '<div class="card"><h2>قراءة كشف الدوام المصوَّر</h2><div class="toolbar" style="align-items:center;margin:8px 0 0">' +
      '<button type="button" class="btn" data-sascan data-ro-mgr' + (sc && sc.busy ? ' disabled' : '') + '>رفع صورة الكشف لقراءته</button>' +
      '<input type="file" id="sa-scan-file" accept="image/*,application/pdf" hidden>' +
      '<span class="hint" style="margin:0">تُطبَّق القراءة على يوم ' + dayName(st.day) + ' ' + dmy(st.day) + ' تعديلاتٍ غير محفوظة، فراجعها ثم احفظ.</span></div>' + models + body + '</div>';
  }

  async function saSave() {
    var st = saState(), ids = Object.keys(st.draft);
    if (!ids.length) return;
    var who = (S.profile && S.profile.full_name) || displayName(S.email);
    var rows = ids.map(function (id) {
      var d = st.draft[id];
      return { teacher_id: id, day: st.day, status: d.status || 'present', time_in: d.status === 'present' && d.time_in ? d.time_in : null,
        time_out: d.status === 'present' && d.time_out ? d.time_out : null, note: d.note || '', recorded_by: who, updated_at: new Date().toISOString() };
    });
    st.busy = true;
    render();
    var r = await sb.from('staff_attendance').upsert(rows, { onConflict: 'teacher_id,day' });
    st.busy = false;
    if (r.error) { render(); return fail(r.error); }
    // كشف وارد من واتساب حُفظ: يُعلَّم «طُبّق» فيخرج من قائمة الانتظار
    if (st.scan && st.scan.inboxId) {
      await sb.from('staff_sheet_inbox').update({ status: 'applied', done_at: new Date().toISOString(), done_by: who }).eq('id', st.scan.inboxId);
    }
    st.draft = {};
    st.scan = null;
    S.sa = null;
    render();
    toast('حُفظ دوام ' + rows.length + ' موظفًا');
  }

  // كشف الشهر: لكل موظف أعداد الحالات والتأخير والانصراف المبكر، وتفصيل الأيام
  async function saMonthData(month) {
    var from = month + '-01', to = addDays(shiftMonth(month, 1) + '-01', -1);
    var rows = await fetchAll(function () { return sb.from('staff_attendance').select('*').gte('day', from).lte('day', to).order('day').order('teacher_id'); });
    if (!rows) return null;
    var H = S.saHours || { time_in: '07:30', time_out: '13:30' }, days = [], by = {};
    for (var d = from; d <= to; d = addDays(d, 1)) days.push(d);
    rows.forEach(function (r) { r.time_in = hm5(r.time_in); r.time_out = hm5(r.time_out); (by[r.teacher_id] || (by[r.teacher_id] = {}))[r.day] = r; });
    // من كان على رأس عمله يومًا واحدًا على الأقل من الشهر؛ ولا يُحسب له إلا ما سُجّل في مدة عمله
    var staff = saStaff('').filter(function (t) { return days.some(function (dd) { return employedOn(t, dd); }); }).map(function (t) {
      var mine = {}, s = { t: t, present: 0, absent: 0, leave: 0, mission: 0, lateDays: 0, late: 0, early: 0, days: mine, work: 0 };
      Object.keys(by[t.id] || {}).forEach(function (k) { if (employedOn(t, k)) mine[k] = by[t.id][k]; });
      var T = shiftOf(t);
      Object.keys(mine).forEach(function (k) { var r = mine[k], l = saLate(r, T); s[r.status]++; if (l) { s.lateDays++; s.late += l; } s.early += saEarly(r, T); });
      days.forEach(function (dd) { if (employedOn(t, dd)) s.work++; });
      // التحق أو انتهى عقده خلال الشهر
      var hf = String(t.hire_date || '').slice(0, 10), ce = String(t.contract_end || '').slice(0, 10);
      s.term = [hf && hf > from && hf <= to ? 'من ' + dmy(hf) : '', ce && ce >= from && ce < to ? 'حتى ' + dmy(ce) : ''].filter(Boolean).join(' ');
      return s;
    });
    return { month: month, from: from, to: to, days: days, staff: staff, H: H };
  }

  /* ----- كشف الحضور الشهري للموظفين (مثل كشف الطلاب) -----
     صف لكل موظف وعمود لكل يوم: + حاضر، L إجازة، غ غائب، م مأمورية، و— خارج مدة عمله.
     تُظلَّل الجمعة والسبت والعطل (attOff) وخانات الإجازة. في الأسفل عدد الحاضرين في كل يوم */
  var SA_REG = { present: '+', leave: 'L', absent: 'غ', mission: 'م' };
  // سُجّل دوام أحد في اليوم (وإلا فخانة عدد الحاضرين فارغة لا صفر)
  function saDayRecorded(D, dd) { return D.staff.some(function (s) { return !!s.days[dd]; }); }
  function saRegMark(s, dd) {
    if (!employedOn(s.t, dd)) return '—';
    var r = s.days[dd];
    return r ? SA_REG[r.status] || '' : '';
  }

  async function saRegisterXlsx(D) {
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new(), used = {};
      wb.Workbook = { Views: [{ RTL: true }] };
      var head = ['م', 'اسم الموظف', 'الفئة'].concat(D.days.map(function (dd) {
        return Number(dd.slice(8)) + (attOff(dd) ? ' (' + (attHoliday(dd) ? 'عطلة' : WEEKDAYS[new Date(dd + 'T00:00').getDay()]) + ')' : '');
      }), ['حضور', 'إجازة', 'غياب', 'مأمورية']);
      var presentPerDay = D.days.map(function (dd) { return D.staff.filter(function (s) { return (s.days[dd] || {}).status === 'present' && employedOn(s.t, dd); }).length; });
      var aoa = [[schoolName()], ['كشف حضور الموظفين — ' + monthLabel(D.month)], [], head].concat(D.staff.map(function (s, i) {
        return [i + 1, s.t.name + (s.term ? ' (' + s.term + ')' : ''), staffCat(s.t)].concat(D.days.map(function (dd) { return saRegMark(s, dd); }), [s.present, s.leave, s.absent, s.mission]);
      }), [['', 'عدد الحاضرين في اليوم', ''].concat(D.days.map(function (dd, j) { return attOff(dd) || !saDayRecorded(D, dd) ? '' : presentPerDay[j]; }))],
        [[], ['المفتاح: + حاضر · L إجازة · غ غائب · م مأمورية · — خارج مدة عمله · الأيام بين قوسين: الجمعة والسبت والعطل']]);
      xlsxSheet(wb, used, 'كشف الحضور', aoa, [4, 28, 13].concat(D.days.map(function (dd) { return attOff(dd) ? 9 : 4; }), [7, 7, 7, 8]));
      XLSX.writeFile(wb, 'كشف-حضور-الموظفين-' + D.month + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  // صفحة أفقية واحدة بأسلوب كشف الطلاب (att-regs)، يُكبَّر خطها إلى أكبر حجم يتسع
  function buildSaRegisterSheet(D) {
    printLandscape = true;
    var off = attOff;
    var body = D.staff.map(function (s, i) {
      return '<tr><td class="c">' + (i + 1) + '</td><td class="nm">' + esc(s.t.name) + (s.term ? ' <small>(' + esc(s.term) + ')</small>' : '') + '</td>' + D.days.map(function (dd) {
        var m = saRegMark(s, dd), st = (s.days[dd] || {}).status;
        return '<td class="c' + (off(dd) || st === 'leave' || m === '—' ? ' fr' : '') + (st === 'absent' ? ' ab' : '') + '">' + m + '</td>';
      }).join('') + '<td class="c">' + s.present + '</td><td class="c">' + s.leave + '</td><td class="c"><b>' + s.absent + '</b></td></tr>';
    }).join('');
    var perDay = D.days.map(function (dd) {
      if (off(dd)) return '<td class="c fr">' + (attHoliday(dd) ? 'ع' : '') + '</td>';
      if (!saDayRecorded(D, dd)) return '<td class="c"></td>';
      return '<td class="c pd">' + D.staff.filter(function (s) { return (s.days[dd] || {}).status === 'present' && employedOn(s.t, dd); }).length + '</td>';
    }).join('');
    sheet.className = 'att-regs';
    sheet.removeAttribute('data-fit');
    sheet.style.width = '267mm';
    sheet.innerHTML = '<section class="att-page">' +
      '<div class="att-title"><b>' + esc(schoolName()) + '</b><span>كشف حضور الموظفين — ' + monthLabel(D.month) + '</span><span></span></div>' +
      '<div class="att-sub"><span>عدد الموظفين: <b>' + D.staff.length + '</b></span><span>الوقت الرسمي: <b>' + D.H.time_in + ' – ' + D.H.time_out + '</b></span></div>' +
      '<table class="rz att-reg"><thead><tr><th>م</th><th>اسم الموظف</th>' + D.days.map(function (dd) { return '<th class="' + (off(dd) ? 'fr' : '') + '">' + Number(dd.slice(8)) + '</th>'; }).join('') +
        '<th class="tot">حضور</th><th class="tot">إجازة</th><th class="tot">غياب</th></tr></thead>' +
      '<tbody>' + body + '<tr class="total"><td colspan="2">عدد الحاضرين في اليوم</td>' + perDay + '<td colspan="3"></td></tr></tbody></table>' +
      '<p class="att-key">المفتاح: + حاضر · L إجازة · غ غائب · م مأمورية · — خارج مدة عمله · المظلّل: الجمعة والسبت والعطل' + (D.days.some(attHoliday) ? ' (ع: عطلة)' : '') +
        ' والإجازات · الخانة الفارغة: لم يُسجَّل · تاريخ الإصدار: ' + dmy(todayISO()) + '</p>' +
      reportSigns([['مدير الأكاديمية', principalName()]]) + '</section>';
    fitRegisterPages(sheet);
  }

  async function saReport(fmt) {
    var st = saState(), D = await saMonthData(st.month);
    if (!D) return toast('تعذر جلب الدوام', true);
    if (fmt === 'pdf') { pendingSa = D; return printNow(); }
    if (fmt === 'regp') { pendingSa = Object.assign({ reg: true }, D); return printNow(); }
    if (fmt === 'regx') return saRegisterXlsx(D);
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      var top = [[schoolName()], ['دوام الموظفين — ' + monthLabel(D.month) + ' — الوقت الرسمي ' + D.H.time_in + ' إلى ' + D.H.time_out], []];
      var ws = XLSX.utils.aoa_to_sheet(top.concat([['م', 'الموظف', 'الفئة', 'المسمى', 'حضور', 'غياب', 'إجازة', 'مأمورية', 'أيام التأخير', 'دقائق التأخير', 'دقائق الانصراف المبكر']],
        D.staff.map(function (s, i) { return [i + 1, s.t.name + (s.term ? ' (' + s.term + ')' : ''), staffCat(s.t), s.t.job_title || '', s.present, s.absent, s.leave, s.mission, s.lateDays, s.late, s.early]; })));
      ws['!cols'] = [5, 28, 14, 18, 7, 7, 7, 8, 11, 12, 18].map(function (w) { return { wch: w }; });
      XLSX.utils.book_append_sheet(wb, ws, 'الملخص');
      var ws2 = XLSX.utils.aoa_to_sheet(top.concat([['الموظف'].concat(D.days.map(function (d) { return Number(d.slice(8)) + ' ' + WEEKDAYS[new Date(d + 'T00:00').getDay()]; }))],
        D.staff.map(function (s) {
          return [s.t.name].concat(D.days.map(function (d) {
            var r = s.days[d];
            if (!r) return employedOn(s.t, d) ? '' : '—';
            return SA_CODE[r.status] + (r.status === 'present' && (r.time_in || r.time_out) ? ' ' + (r.time_in || '؟') + '-' + (r.time_out || '؟') : '');
          }));
        }), [[], ['ح حاضر · غ غائب · إ إجازة · م مأمورية؛ والوقت: الحضور-الانصراف؛ — خارج مدة عمله (قبل تعيينه أو بعد انتهاء عقده)']]));
      ws2['!cols'] = [{ wch: 26 }].concat(D.days.map(function () { return { wch: 12 }; }));
      XLSX.utils.book_append_sheet(wb, ws2, 'تفصيل الأيام');
      XLSX.writeFile(wb, 'دوام-الموظفين-' + D.month + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  var pendingSa = null;
  function buildSaSheet(D) {
    var n = 11, c = function (v, b) { return '<td class="c" style="white-space:nowrap">' + (b ? '<b>' + v + '</b>' : v === 0 ? '' : v) + '</td>'; };
    var head = reportHead('كشف دوام الموظفين', [['الشهر', monthLabel(D.month)], ['الوقت الرسمي', D.H.time_in + ' – ' + D.H.time_out], ['عدد الموظفين', D.staff.length]]).replace(/^<img class="wm"[^>]*>/, '');
    var body = D.staff.map(function (s, i) {
      return '<tr>' + c(i + 1) + '<td style="white-space:nowrap"><b>' + esc(s.t.name) + '</b>' + (s.term ? ' <small>(' + esc(s.term) + ')</small>' : '') + '</td><td style="white-space:nowrap">' + esc(staffCat(s.t)) + '</td>' +
        c(s.present, true) + c(s.absent) + c(s.leave) + c(s.mission) + c(s.lateDays) + c(s.late) + c(s.early) + '<td style="min-width:5em"></td></tr>';
    }).join('');
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' +
      '<table class="rz"><thead><tr><td class="pg-space" colspan="' + n + '"></td></tr><tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>' +
      '<tr><th>م</th><th>الموظف</th><th>الفئة</th><th>حضور</th><th>غياب</th><th>إجازة</th><th>مأمورية</th><th>أيام<br>التأخير</th><th>دقائق<br>التأخير</th><th>دقائق الانصراف<br>المبكر</th><th>ملاحظات</th></tr></thead>' +
      '<tbody>' + body + '</tbody><tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>' +
      reportSigns([['مدير الأكاديمية', principalName()]]);
  }

  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/staffatt' || !canView()) return;
    var st = saState(), H = S.saHours, el;
    if (e.target.closest('[data-saallin]') || e.target.closest('[data-saallout]')) {
      var isIn = !!e.target.closest('[data-saallin]');
      saStaff(st.cat, st.day).forEach(function (t) {
        var r = saRow(t.id);
        if (r && r.status !== 'present') return;
        var T = shiftOf(t);
        saEdit(t.id, isIn ? { status: 'present', time_in: T.time_in } : { status: 'present', time_out: T.time_out });
      });
      return render();
    }
    if ((el = e.target.closest('[data-saibopen]'))) {
      var it = (S.sa.inbox || []).filter(function (x) { return x.id === el.getAttribute('data-saibopen'); })[0];
      if (!it) return;
      if (Object.keys(st.draft).length && !confirm('في اليوم المعروض تعديلات لم تُحفظ، وفتح الكشف الوارد يلغيها. متابعة؟')) return;
      st.draft = {};
      st.scan = null;
      if (it.day === st.day && S.sa && S.sa.day === st.day) { saApplyInbox(it); return render(); }
      st.openInbox = it;
      st.day = it.day;
      return render();
    }
    if ((el = e.target.closest('[data-saibdrop]'))) {
      var drop = (S.sa.inbox || []).filter(function (x) { return x.id === el.getAttribute('data-saibdrop'); })[0];
      if (!drop || !confirm('تجاهل كشف يوم ' + dmy(drop.day) + ' الوارد من واتساب؟ لا يُسجَّل منه شيء.')) return;
      var dr = await sb.from('staff_sheet_inbox').update({ status: 'discarded', done_at: new Date().toISOString(), done_by: (S.profile && S.profile.full_name) || displayName(S.email) }).eq('id', drop.id);
      if (dr.error) return fail(dr.error);
      if (st.scan && st.scan.inboxId === drop.id) { st.scan = null; st.draft = {}; }
      S.sa = null;
      return render();
    }
    if (e.target.closest('[data-saphadd]')) {
      var num = waNumber(document.getElementById('sa-ph-num').value), nm = document.getElementById('sa-ph-name').value.trim();
      if (num.length < 9) return toast('اكتب رقم الواتساب كاملًا مع رمز الدولة، مثل +972599… أو 010…', true);
      var pa = await sb.from('staff_bot_phones').upsert({ phone: num, name: nm }, { onConflict: 'phone' });
      if (pa.error) return fail(pa.error);
      S.sa = null;
      render();
      return toast('أُضيف الرقم +' + num);
    }
    if ((el = e.target.closest('[data-saphdel]'))) {
      if (!confirm('حذف الرقم +' + el.getAttribute('data-saphdel') + ' من المسموح لهم بإرسال كشف الدوام؟')) return;
      var pd = await sb.from('staff_bot_phones').delete().eq('phone', el.getAttribute('data-saphdel'));
      if (pd.error) return fail(pd.error);
      S.sa = null;
      return render();
    }
    if (e.target.closest('[data-sasave]')) return saSave();
    if (e.target.closest('[data-sacancel]')) { st.draft = {}; st.scan = null; return render(); }
    if (e.target.closest('[data-sascan]')) {
      if (Object.keys(st.draft).length && !confirm('في هذا اليوم تعديلات لم تُحفظ. القراءة تُضاف إليها (وتستبدل ما يخص الموظفين الذين في الكشف). متابعة؟')) return;
      return document.getElementById('sa-scan-file').click();
    }
    if ((el = e.target.closest('[data-sarep]'))) return saReport(el.getAttribute('data-sarep'));
    if ((el = e.target.closest('[data-satosubs]'))) {
      var tid = el.getAttribute('data-satosubs'), t = find(tid), r = S.sa.rows[tid];
      if (!t || !confirm('تسجيل غياب «' + t.name + '» في الاحتياط ليوم ' + dayName(st.day) + ' ' + dmy(st.day) + '؟\nتظهر حصصه في «جدول الحصص ← الاحتياط» لاختيار البدلاء.')) return;
      var ins = await sb.from('teacher_absences').insert({ day: st.day, teacher_id: tid, periods: null, reason: SA_STATUS[r.status] + (r.note ? ' — ' + r.note : ''),
        created_by: (S.profile && S.profile.full_name) || displayName(S.email) });
      if (ins.error) return fail(ins.error);
      S.sa.subsAbs.push(tid);
      S.subs = null;
      render();
      toast('سُجّل غيابه في الاحتياط؛ اختر البدلاء من جدول الحصص ← الاحتياط');
    }
  });
  document.addEventListener('change', async function (e) {
    if (location.hash !== '#/staffatt' || !canView()) return;
    var st = saState(), el = e.target, id;
    if (el.id === 'sa-day') {
      if (!el.value) return;
      if (Object.keys(st.draft).length && !confirm('في هذا اليوم تعديلات لم تُحفظ. الانتقال يلغيها؟')) { el.value = st.day; return; }
      st.day = el.value; st.draft = {}; st.scan = null; return render();
    }
    if (el.id === 'sa-cat') { st.cat = el.value; return render(); }
    if (el.id === 'sa-scan-file') { var file = el.files && el.files[0]; el.value = ''; if (file) saReadSheet(file); return; }
    if (el.id === 'sa-model') { setScanModel(el.value); return; }
    if (el.hasAttribute('data-saunm')) {
      // سطر لم يُعرف صاحبه: يُنسب إلى الموظف المختار
      var sc = st.scan, i = Number(el.getAttribute('data-saunm')), u = sc && sc.unmatched[i];
      if (!u || !el.value) return;
      if (st.draft[el.value] && sc.fromSheet[el.value] != null && !confirm('لهذا الموظف قراءة أخرى من الكشف («' + sc.fromSheet[el.value] + '»). استبدالها؟')) { el.value = ''; return; }
      saApplyRead(el.value, Object.assign({}, u, { unsure: [] }), u.status);
      sc.unmatched.splice(i, 1);
      return render();
    }
    if (el.id === 'sa-month') { st.month = el.value; return; }
    if (el.id === 'sa-hin' || el.id === 'sa-hout') {
      var hin = document.getElementById('sa-hin').value, hout = document.getElementById('sa-hout').value;
      if (!hin || !hout || hin >= hout) { render(); return toast('وقت الحضور يجب أن يكون قبل وقت الانصراف', true); }
      var r = await sb.from('staff_hours').update({ time_in: hin, time_out: hout, updated_by: (S.profile && S.profile.full_name) || displayName(S.email), updated_at: new Date().toISOString() }).eq('id', 1);
      if (r.error) return fail(r.error);
      S.saHours.time_in = hin; S.saHours.time_out = hout;
      render();
      return toast('حُفظ الوقت الرسمي');
    }
    if ((id = el.getAttribute('data-sast')) != null) saEdit(id, { status: el.value || 'present' });
    else if ((id = el.getAttribute('data-sain')) != null) saEdit(id, { status: 'present', time_in: el.value });
    else if ((id = el.getAttribute('data-saout')) != null) saEdit(id, { status: 'present', time_out: el.value });
    else if ((id = el.getAttribute('data-sanote')) != null) saEdit(id, { note: el.value.trim() });
    else return;
    render();
  });

