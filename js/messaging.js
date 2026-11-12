'use strict';
  /* ---------- روابط أولياء الأمور (المدير العام) ----------
     لكل ولي أمر رابط سري واحد (parent.html) يرى منه أبناءه المسجلين: الغياب، وإيصالات المواصلات، وجدول الحصص.
     ولي الأمر يُعرف برقم هويته، وإلا بالجوال، وإلا فالرابط للطالب وحده (supabase/parent_links.sql) */

  // يجب أن يطابق public.parent_key() في supabase/parent_links.sql
  function guardianKey(x) {
    var d = function (s) { return latinDigits(String(s || '')).replace(/\D/g, ''); };
    var gid = d((x.details || {}).guardian_id), tel = d(x.phone);
    if (gid.length >= 5) return 'id:' + gid;
    if (tel.length >= 8) return 'tel:' + (/^0\d{10}$/.test(tel) ? '2' + tel : /^00/.test(tel) ? tel.slice(2) : tel);
    return 'st:' + x.id;
  }

  // الأسر: أبناء كل ولي أمر من المسجلين (نهائي أو احتياط)، بترتيب اسم أول الأبناء
  function parentFamilies() {
    var by = {}, out = [];
    S.students.forEach(function (x) {
      if (!enrolled(x)) return;
      var k = guardianKey(x);
      if (!by[k]) { by[k] = { key: k, kids: [] }; out.push(by[k]); }
      by[k].kids.push(x);
    });
    out.forEach(function (f) {
      f.kids.sort(function (a, b) { return a.full_name.localeCompare(b.full_name, 'ar'); });
      var x = f.kids[0];
      f.guardian = x.guardian_name || '';
      f.phone = f.kids.map(function (k) { return k.phone; }).filter(Boolean)[0] || '';
      f.link = (S.pLinks || []).filter(function (l) { return l.guardian_key === f.key; })[0] || null;
    });
    return out.sort(function (a, b) { return a.kids[0].full_name.localeCompare(b.kids[0].full_name, 'ar'); });
  }

  function parentLink(token) { return location.origin + location.pathname.replace(/[^\/]*$/, '') + 'parent.html?t=' + token; }
  function waNumber(phone) { var t = latinDigits(String(phone || '')).replace(/\D/g, ''); return /^0\d{10}$/.test(t) ? '2' + t : /^00/.test(t) ? t.slice(2) : t; }
  function parentMsg(f) {
    return 'السلام عليكم ' + (f.guardian ? 'ولي الأمر ' + f.guardian : 'ولي أمر ' + f.kids.map(function (k) { return k.full_name.split(/\s+/)[0]; }).join(' و')) + '،\n' +
      'هذا رابط متابعة ' + (f.kids.length > 1 ? 'أبنائكم' : 'ابنكم/ابنتكم') + ' في ' + schoolName() + ': الغياب، وإيصالات المواصلات، وجدول الحصص.\n' +
      parentLink(f.link.token) + '\nالرابط خاص بكم، فلا ترسلوه لغيركم.';
  }

  async function loadParentLinks() {
    var r = await sb.from('parent_links').select('*');
    S.pLinksMissing = !!r.error;
    S.pLinks = r.data || [];
    render();
  }

  function renderParents() {
    if (S.pLinks == null) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; loadParentLinks(); return; }
    var head = '<div class="page-head"><div><h1>روابط وحسابات أولياء الأمور</h1><p>لكل ولي أمر رابط خاص، أو حساب يدخل به برقم هويته وكلمة مرور على ' + esc(parentLoginUrl()) + '، فيرى كل أبنائه: الحضور والغياب، والدرجات، والرسائل، والمواصلات، وجدول الحصص.</p></div></div>';
    if (S.pLinksMissing) {
      app.innerHTML = head + '<div class="card empty">روابط أولياء الأمور تحتاج إلى جدول جديد في قاعدة البيانات.<br>شغّل الملف <code dir="ltr">supabase/parent_links.sql</code> في محرر SQL ثم حدّث الصفحة.</div>';
      return;
    }
    var fams = parentFamilies(), q = norm(ui.plSearch || ''), digits = latinDigits(ui.plSearch || '').replace(/\D/g, '');
    var shown = fams.filter(function (f) {
      if (ui.plFilter === 'none' && f.link) return false;
      if (ui.plFilter === 'off' && !(f.link && !f.link.active)) return false;
      if (ui.plFilter === 'seen' && !(f.link && f.link.views)) return false;
      if (!q) return true;
      return norm(f.guardian + ' ' + f.kids.map(function (k) { return k.full_name + ' ' + (k.class_name || ''); }).join(' ')).indexOf(q) > -1 || (digits && waNumber(f.phone).indexOf(digits) > -1);
    });
    var made = fams.filter(function (f) { return f.link; }).length, seen = fams.filter(function (f) { return f.link && f.link.views; }).length;
    var rows = shown.map(function (f) {
      var l = f.link, wa = waNumber(f.phone), key = esc(f.key);
      var accBtn = f.key.indexOf('id:') === 0 ? '<button type="button" class="btn' + (l && l.pass_hash ? '' : ' primary') + '" data-placc="' + key + '">' + (l && l.pass_hash ? 'كلمة مرور جديدة' : 'إنشاء حساب') + '</button>' : '';
      var acts = accBtn + (!l
        ? '<button type="button" class="btn primary" data-plmake="' + key + '">إنشاء رابط</button>'
        : '<button type="button" class="btn" data-plcopy="' + key + '">نسخ الرسالة</button>' +
          (wa && l.active ? '<a class="btn" target="_blank" rel="noopener" href="https://wa.me/' + esc(wa) + '?text=' + encodeURIComponent(parentMsg(f)) + '">إرسال واتساب</a>' : '') +
          '<button type="button" class="btn" data-pltoggle="' + key + '">' + (l.active ? 'إيقاف' : 'تفعيل') + '</button>' +
          '<button type="button" class="btn danger" data-plnew="' + key + '" title="يتوقف الرابط القديم ويُنشأ غيره">رابط جديد</button>');
      return '<tr' + (l && !l.active ? ' style="color:var(--muted)"' : '') + '><td>' + f.kids.map(function (k) { return '<div><b>' + esc(k.full_name) + '</b> <span class="hint" style="margin:0">' + esc(k.class_name || '—') + '</span></div>'; }).join('') +
        (f.key.indexOf('st:') === 0 ? '<div class="hint" style="margin:2px 0 0">لا رقم هوية ولي أمر ولا جوال: الرابط لهذا الطالب وحده</div>' : '') + '</td>' +
        '<td>' + esc(f.guardian || '—') + '</td><td dir="ltr" style="text-align:right;white-space:nowrap">' + esc(f.phone || '—') + '</td>' +
        '<td>' + (!l ? '<span class="badge pending">بلا رابط</span>' : !l.active ? '<span class="badge unpaid">موقوف</span>' :
          l.views ? '<span class="badge paid">فُتح ' + l.views + ' مرة</span><div class="hint" style="margin:2px 0 0">آخر فتح ' + dmy(String(l.last_seen).slice(0, 10)) + '</div>' : '<span class="badge part">لم يُفتح بعد</span>') +
          (l && l.pass_hash ? '<div class="hint" style="margin:2px 0 0">له حساب' + (l.last_login ? ' · آخر دخول ' + dmy(String(l.last_login).slice(0, 10)) : '') + '</div>' : '') + '</td>' +
        '<td><div class="acts">' + acts + '</div></td></tr>';
    }).join('');
    var opt = function (v, label) { return '<option value="' + v + '"' + ((ui.plFilter || '') === v ? ' selected' : '') + '>' + label + '</option>'; };
    app.innerHTML = head +
      '<div class="stats"><div class="card stat"><span class="lbl">أولياء الأمور</span><span class="num">' + fams.length + '</span><span class="sub">بحسب رقم هوية ولي الأمر أو الجوال</span></div>' +
        '<div class="card stat"><span class="lbl">لهم روابط</span><span class="num">' + made + '</span><span class="sub">بلا رابط: ' + (fams.length - made) + '</span></div>' +
        '<div class="card stat"><span class="lbl">فتحوا الرابط</span><span class="num">' + seen + '</span><span class="sub">مرة واحدة على الأقل</span></div></div>' +
      '<div class="toolbar" style="align-items:center">' +
        '<input type="search" id="pl-search" placeholder="اسم الطالب أو ولي الأمر أو الجوال" aria-label="بحث" value="' + esc(ui.plSearch || '') + '" style="max-width:280px">' +
        '<select id="pl-filter" style="width:auto">' + opt('', 'الكل') + opt('none', 'بلا رابط') + opt('seen', 'فتحوا الرابط') + opt('off', 'موقوفة') + '</select>' +
        '<button type="button" class="btn primary" data-plall' + (fams.length - made ? '' : ' disabled') + '>إنشاء روابط لكل من ليس له رابط (' + (fams.length - made) + ')</button>' +
        '<button type="button" class="btn" data-plxlsx' + (made ? '' : ' disabled') + '>تصدير الروابط (Excel)</button>' +
        '<button type="button" class="btn" data-placcall title="لكل ولي أمر له رقم هوية وليس له حساب: تُولَّد كلمات المرور ويُنزَّل ملف Excel بها">إنشاء حسابات لمن ليس له حساب (Excel)</button></div>' +
      '<p class="hint">«إرسال واتساب» يفتح واتساب برسالة جاهزة فيها الرابط، فترسلها أنت. الإيقاف يمنع فتح الرابط فورًا، و«رابط جديد» يلغي القديم إن وصل لغير صاحبه. ' +
        'الإخوة يجمعهم رقم هوية ولي الأمر في ملف التسجيل؛ ومن نقص رقمه يُجمع بالجوال.</p>' +
      '<div class="card">' + (rows
        ? '<div class="table-wrap"><table class="grid"><thead><tr><th>الأبناء</th><th>ولي الأمر</th><th>الجوال / واتساب</th><th>الحالة</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">لا يوجد ما يطابق البحث.</div>') + '</div>';
  }

  // حساب ولي الأمر: رقم هويته وكلمة مرور تُولَّد هنا وتظهر مرة واحدة (تُحفظ مشفّرة في القاعدة)
  function parentLoginUrl() { return location.origin + location.pathname.replace(/[^\/]*$/, '') + 'parent.html'; }
  function parentPass() { var a = new Uint32Array(1); crypto.getRandomValues(a); return String(10000000 + a[0] % 90000000); }
  function parentAccMsg(f, pass) {
    return 'السلام عليكم ' + (f.guardian ? 'ولي الأمر ' + f.guardian : 'ولي أمر ' + f.kids.map(function (k) { return k.full_name.split(/\s+/)[0]; }).join(' و')) + '،\n' +
      'حسابكم لمتابعة ' + (f.kids.length > 1 ? 'أبنائكم' : 'ابنكم/ابنتكم') + ' في ' + schoolName() + ' (الحضور والغياب، والدرجات، والرسائل، والمواصلات، وجدول الحصص):\n' +
      parentLoginUrl() + '\nرقم الهوية: ' + f.key.slice(3) + '\nكلمة المرور: ' + pass + '\nالحساب خاص بكم، فلا تشاركوا كلمة المرور.';
  }
  async function makeParentAccount(f) {
    var pass = parentPass();
    var r = await sb.rpc('parent_set_password', { p_key: f.key, p_pass: pass });
    if (r.error) { fail(r.error); return null; }
    return pass;
  }
  // تُرسل من رقم الأكاديمية عبر SendWhats (دالة send-whatsapp) إلى جوال ولي الأمر، وتُحفظ في أرشيف الرسائل
  async function sendParentAcc(f, pass) {
    var r = await sb.functions.invoke('send-whatsapp', { body: { action: 'send', batch_id: 'acc-' + f.key.slice(3) + '-' + Date.now().toString(36), kind: 'account', title: 'حساب ولي الأمر',
      text: parentAccMsg(f, pass), student_ids: f.kids.map(function (k) { return k.id; }), per: 'family', school: schoolName() } });
    var d = r.data || {};
    if (r.error || d.error) return (d.error || r.error.message);
    return '';
  }
  function showParentAcc(f, pass) {
    var msg = parentAccMsg(f, pass), wa = waNumber(f.phone);
    var o = document.createElement('div');
    o.style.cssText = 'position:fixed;inset:0;background:rgba(12,33,82,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    o.innerHTML = '<div class="card" style="max-width:520px;width:100%;margin:0"><h2 style="margin-top:0">حساب ' + esc(f.guardian || 'ولي الأمر') + '</h2>' +
      '<p class="hint">كلمة المرور تظهر الآن فقط ولا يمكن عرضها لاحقًا (يمكن تعيين غيرها). أرسلها لولي الأمر:</p>' +
      '<textarea rows="8" style="width:100%" readonly>' + esc(msg) + '</textarea>' +
      '<div class="actions"><button type="button" class="btn primary" data-pacopy>نسخ الرسالة</button>' +
      (f.phone ? '<button type="button" class="btn" data-pasend>إرسال واتساب (من رقم الأكاديمية)</button>' : '') +
      '<button type="button" class="btn" data-paclose>إغلاق</button></div></div>';
    document.body.appendChild(o);
    o.addEventListener('click', function (e) {
      if (e.target.closest('[data-pacopy]')) copyText(msg, 'نُسخت الرسالة');
      var sb2 = e.target.closest('[data-pasend]');
      if (sb2) { sb2.disabled = true; sb2.textContent = 'جارٍ الإرسال…'; sendParentAcc(f, pass).then(function (err) { sb2.textContent = err ? 'تعذّر الإرسال' : 'أُضيفت إلى قائمة الإرسال'; toast(err ? 'تعذّر الإرسال: ' + err : 'أُضيفت الرسالة إلى قائمة الإرسال. تابعها في «رسائل واتساب».', !!err); }); }
      if (e.target.closest('[data-paclose]') || e.target === o) o.remove();
    });
  }
  async function exportParentAccounts(list) {
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      var ws = XLSX.utils.aoa_to_sheet([[schoolName()], ['حسابات أولياء الأمور — ' + dmy(todayISO())], ['سري: كلمات المرور لا تُحفظ في البرنامج إلا مشفّرة، وهذه نسختها الوحيدة.'], [],
        ['م', 'ولي الأمر', 'الأبناء', 'الجوال', 'رقم الهوية (اسم الدخول)', 'كلمة المرور', 'الرسالة']].concat(list.map(function (x, i) {
          return [i + 1, x.f.guardian, x.f.kids.map(function (k) { return k.full_name; }).join('، '), x.f.phone, x.f.key.slice(3), x.pass, parentAccMsg(x.f, x.pass)];
        })));
      ws['!cols'] = [5, 24, 40, 16, 18, 12, 90].map(function (w) { return { wch: w }; });
      XLSX.utils.book_append_sheet(wb, ws, 'الحسابات');
      XLSX.writeFile(wb, 'حسابات-أولياء-الأمور-' + todayISO() + '.xlsx');
    } catch (err) { toast(err.message, true); }
  }

  async function makeParentLinks(keys) {
    if (!keys.length) return;
    for (var i = 0; i < keys.length; i += 200) {
      var r = await sb.from('parent_links').insert(keys.slice(i, i + 200).map(function (k) { return { guardian_key: k }; }));
      if (r.error) { await loadParentLinks(); return fail(r.error); }
    }
    await loadParentLinks();
    toast(keys.length === 1 ? 'أُنشئ الرابط' : 'أُنشئت ' + keys.length + ' روابط');
  }

  function famByKey(key) { return parentFamilies().filter(function (f) { return f.key === key; })[0]; }

  async function exportParentLinks() {
    try {
      await loadXlsx();
      var fams = parentFamilies().filter(function (f) { return f.link; });
      var wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      var ws = XLSX.utils.aoa_to_sheet([[schoolName()], ['روابط أولياء الأمور — ' + dmy(todayISO())], ['الروابط سرية: كل رابط يكشف بيانات أبناء صاحبه، فلا تنشر هذا الملف.'], [],
        ['م', 'الأبناء', 'الشعب', 'ولي الأمر', 'الجوال / واتساب', 'الحالة', 'الرابط']].concat(fams.map(function (f, i) {
          return [i + 1, f.kids.map(function (k) { return k.full_name; }).join('، '), f.kids.map(function (k) { return k.class_name || ''; }).join('، '), f.guardian, f.phone,
            f.link.active ? (f.link.views ? 'فُتح ' + f.link.views + ' مرة' : 'لم يُفتح') : 'موقوف', parentLink(f.link.token)];
        })));
      ws['!cols'] = [5, 40, 18, 24, 16, 12, 80].map(function (w) { return { wch: w }; });
      XLSX.utils.book_append_sheet(wb, ws, 'الروابط');
      XLSX.writeFile(wb, 'روابط-أولياء-الأمور-' + todayISO() + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/parents' || !isAdmin()) return;
    var el, f, r;
    if ((el = e.target.closest('[data-plmake]'))) makeParentLinks([el.getAttribute('data-plmake')]);
    else if (e.target.closest('[data-plall]')) {
      var keys = parentFamilies().filter(function (x) { return !x.link; }).map(function (x) { return x.key; });
      if (confirm('إنشاء ' + keys.length + ' رابطًا لأولياء الأمور الذين ليس لهم رابط؟\nلا يُرسل شيء لأحد؛ الإرسال من زر «إرسال واتساب» لكل ولي أمر.')) makeParentLinks(keys);
    }
    else if ((el = e.target.closest('[data-plcopy]'))) { f = famByKey(el.getAttribute('data-plcopy')); if (f && f.link) copyText(parentMsg(f), 'نُسخت الرسالة مع الرابط'); }
    else if ((el = e.target.closest('[data-pltoggle]'))) {
      f = famByKey(el.getAttribute('data-pltoggle'));
      if (!f || !f.link) return;
      r = await sb.from('parent_links').update({ active: !f.link.active }).eq('token', f.link.token);
      if (r.error) return fail(r.error);
      await loadParentLinks();
      toast(f.link.active ? 'أُوقف الرابط' : 'فُعّل الرابط');
    }
    else if ((el = e.target.closest('[data-plnew]'))) {
      f = famByKey(el.getAttribute('data-plnew'));
      if (!f || !f.link || !confirm('إلغاء الرابط الحالي وإنشاء رابط جديد؟\nالرابط القديم يتوقف فورًا، فيجب إرسال الجديد لولي الأمر.')) return;
      r = await sb.from('parent_links').delete().eq('token', f.link.token);
      if (r.error) return fail(r.error);
      makeParentLinks([f.key]);
    }
    else if (e.target.closest('[data-plxlsx]')) exportParentLinks();
    else if ((el = e.target.closest('[data-placc]'))) {
      f = famByKey(el.getAttribute('data-placc'));
      if (!f || (f.link && f.link.pass_hash && !confirm('تعيين كلمة مرور جديدة لـ' + (f.guardian || 'ولي الأمر') + '؟ القديمة تتوقف فورًا.'))) return;
      var pass = await makeParentAccount(f);
      if (!pass) return;
      await loadParentLinks();
      showParentAcc(famByKey(f.key) || f, pass);
    }
    else if (e.target.closest('[data-placcall]')) {
      var todo = parentFamilies().filter(function (x) { return x.key.indexOf('id:') === 0 && !(x.link && x.link.pass_hash); });
      if (!todo.length) return toast('كل أولياء الأمور الذين لهم رقم هوية لديهم حسابات');
      if (!confirm('إنشاء ' + todo.length + ' حسابًا؟ ستُنزَّل كلمات المرور في ملف Excel، وهو نسختها الوحيدة.')) return;
      var made2 = [];
      for (var i = 0; i < todo.length; i++) { var pw = await makeParentAccount(todo[i]); if (!pw) break; made2.push({ f: todo[i], pass: pw }); }
      await loadParentLinks();
      if (made2.length) {
        exportParentAccounts(made2);
        toast('أُنشئ ' + made2.length + ' حسابًا');
        var withPh = made2.filter(function (x) { return x.f.phone; });
        if (withPh.length && confirm('إرسال بيانات الدخول الآن عبر واتساب الأكاديمية إلى ' + withPh.length + ' ولي أمر؟ (تُرسل تباعًا كرسائل الغياب)')) {
          var bad = 0;
          for (var j = 0; j < withPh.length; j++) { if (await sendParentAcc(withPh[j].f, withPh[j].pass)) bad++; }
          toast('أُضيفت ' + (withPh.length - bad) + ' رسالة إلى قائمة الإرسال' + (bad ? '، وتعذّرت ' + bad : '') + '. تابعها في «رسائل واتساب».', bad > 0);
        }
      }
    }
  });
  document.addEventListener('change', function (e) {
    if (location.hash === '#/parents' && e.target.id === 'pl-filter') { ui.plFilter = e.target.value; render(); }
  });
  document.addEventListener('input', function (e) {
    if (location.hash !== '#/parents' || e.target.id !== 'pl-search') return;
    ui.plSearch = e.target.value;
    var pos = e.target.selectionStart;
    render();
    var q = document.getElementById('pl-search');
    if (q) { q.focus(); q.setSelectionRange(pos, pos); }
  });

  /* ---------- رسائل واتساب ----------
     إرسال لأولياء الأمور عبر SendWhats (دالة send-whatsapp): اختيار الطلاب، والقوالب تُعدَّل وتُحفظ هنا (ومنها قالبا رسائل الغياب)،
     والأرشيف بكل رسالة أُرسلت وحالتها. يراها المدير العام والمسجِّل. الأرقام تُقرأ في السيرفر، والصفحة ترسل المعرّفات والنص فقط */

  var WA_VARS = [['{الاسم}', 'اسم الطالب (أو أسماء الإخوة)'], ['{الاسم_الأول}', 'الاسم الأول'], ['{ولي_الأمر}', 'اسم ولي الأمر'], ['{الشعبة}', 'الشعبة'], ['{التاريخ}', 'تاريخ اليوم'], ['{الأكاديمية}', 'اسم الأكاديمية']];
  var WA_STATUS = { queued: ['pending', 'في الانتظار'], sending: ['part', 'يُرسَل'], sent: ['published', 'أُرسلت'], delivered: ['paid', 'وصلت'], read: ['paid', 'قُرئت'],
    failed: ['unpaid', 'فشلت'], cancelled: ['unpaid', 'أُلغيت'], rejected: ['unpaid', 'رقم غير صالح'], nophone: ['unpaid', 'بلا رقم'] };

  function waUi() {
    return ui.wa || (ui.wa = { tab: 'send', tpl: '', title: '', text: '', sel: {}, q: '', cls: '', bus: '', fresh: '', per: 'family', batch: null, busy: false,
      aq: '', akind: '', astatus: '', afrom: '', ato: '' });
  }
  function waBatchId() { return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

  async function loadWaTemplates() {
    var r = await sb.from('wa_templates').select('*').order('sort').order('title');
    S.waMissing = !!r.error;
    S.waTpl = r.data || [];
    return S.waTpl;
  }
  async function loadWaArchive() {
    var r = await sb.from('wa_messages').select('*').order('created_at', { ascending: false }).limit(2000);
    S.waMissing = !!r.error;
    S.waMsgs = r.data || [];
    render();
  }
  // رسالة فشلت ولولي الأمر رقم جوال آخر غير الذي أُرسلت إليه: زر لإعادة إرسالها إليه
  function waRetryBtn(m) {
    if (['failed', 'rejected', 'cancelled'].indexOf(m.status) < 0 || !(m.student_ids || []).length) return '';
    var alt = (m.student_ids || []).map(findStudent).filter(function (x) { return x && x.phone && waNumber(x.phone) !== waNumber(m.phone || ''); })[0];
    return alt ? '<div style="margin-top:4px"><button type="button" class="btn" data-waretry="' + m.id + '" title="' + esc(alt.phone) + '">إعادة الإرسال إلى جوال ولي الأمر</button></div>' : '';
  }
  async function waRetry(id) {
    var m = (S.waMsgs || []).filter(function (x) { return String(x.id) === String(id); })[0];
    if (!m) return;
    var x = findStudent(m.student_ids[0]);
    if (!confirm('إعادة إرسال الرسالة إلى جوال ولي الأمر' + (x ? ' (' + x.phone + ')' : '') + '؟')) return;
    // النص المحفوظ مكتمل (الاسم والتاريخ فيه)، فيُرسل كما هو لكل طالب في الرسالة
    var r = await sb.functions.invoke('send-whatsapp', { body: { action: 'send', batch_id: 'retry-' + m.id + '-' + Date.now().toString(36), kind: m.kind, title: m.title || '', text: m.body, student_ids: m.student_ids, per: 'family', use: 'phone', school: schoolName() } });
    var d = r.data || {};
    if (r.error || d.error) return toast('تعذّرت إعادة الإرسال: ' + (d.error || r.error.message), true);
    toast('أُضيفت الرسالة إلى قائمة الإرسال إلى جوال ولي الأمر');
    loadWaArchive();
  }
  function waTpl(key) { return (S.waTpl || []).filter(function (t) { return t.key === key; })[0]; }

  // معاينة الرسالة لأول طالب مختار (أو أول طالب في القائمة)
  function waPreview(text, x) {
    if (!x) return text;
    var vars = { 'الاسم': x.full_name, 'الاسم_الأول': x.full_name.split(/\s+/)[0], 'ولي_الأمر': x.guardian_name || 'ولي الأمر', 'الشعبة': x.class_name || '',
      'التاريخ': dmy(todayISO()), 'الأكاديمية': schoolName(), 'العدد': 3, 'من': dmy(todayISO()), 'إلى': dmy(todayISO()) };
    return text.replace(/\{([^{}\s]+)\}/g, function (all, k) { return k in vars ? vars[k] : all; });
  }

  function waShown() {
    var w = waUi(), q = norm(w.q), digits = latinDigits(w.q).replace(/\D/g, ''), g = transportGroupOf();
    var since = w.fresh ? new Date(Date.now() - Number(w.fresh) * 864e5).toISOString().slice(0, 10) : '';
    return S.students.filter(function (x) {
      if (w.reg === 'all' ? false : w.reg ? stStatus(x) !== w.reg : !enrolled(x)) return false;
      if (w.cls && (x.class_name || '') !== w.cls) return false;
      if (w.bus && (w.bus === 'none' ? g[x.id] : g[x.id] !== w.bus)) return false;
      if (since && String(x.created_at || '').slice(0, 10) < since) return false;
      if (!q) return true;
      return norm(x.full_name + ' ' + (x.guardian_name || '')).indexOf(q) > -1 || (digits && waNumber(x.phone).indexOf(digits) > -1);
    });
  }

  function renderMessages() {
    var w = waUi();
    if (S.waTpl == null) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; loadWaTemplates().then(render); return; }
    var tabs = [['send', 'إرسال رسالة'], ['archive', 'الأرشيف والتقرير'], ['templates', 'القوالب']];
    var head = '<div class="page-head"><div><h1>رسائل واتساب</h1><p>رسائل لأولياء الأمور من رقم الأكاديمية عبر SendWhats: ترحيب، وتنويهات، ودعوات، ورسائل الغياب. وكل ما يُرسل محفوظ في الأرشيف بحالته.</p></div></div>' +
      '<div class="tabbar"><nav class="tabs" aria-label="أقسام الرسائل">' + tabs.map(function (t) { return '<button type="button"' + (w.tab === t[0] ? ' class="on" aria-current="true"' : '') + ' data-watab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</nav></div>';
    if (S.waMissing) {
      app.innerHTML = head + '<div class="card empty">شاشة الرسائل تحتاج إلى جدولين جديدين في قاعدة البيانات.<br>شغّل الملف <code dir="ltr">supabase/whatsapp_messages.sql</code> في محرر SQL، ثم انشر الدالتين ' +
        '<code dir="ltr">send-whatsapp</code> و <code dir="ltr">send-absence-whatsapp</code>، وحدّث الصفحة.</div>';
      return;
    }
    if (w.tab === 'archive') { if (S.waMsgs == null) { app.innerHTML = head + '<div class="card empty">جارٍ التحميل…</div>'; loadWaArchive().then(function () { if (!w.autoRefreshed) { w.autoRefreshed = true; waRefresh(true); } }); return; } app.innerHTML = head + waArchiveHtml(); return; }
    if (w.tab === 'templates') { app.innerHTML = head + waTemplatesHtml(); return; }
    app.innerHTML = head + waSendHtml();
  }

  function waSendHtml() {
    var w = waUi(), list = waShown(), g = transportGroupOf();
    var selIds = Object.keys(w.sel).filter(function (id) { return w.sel[id] && findStudent(id); });
    var selSt = selIds.map(findStudent), noPh = selSt.filter(function (x) { return !(x.phone); }).length;
    var fams = {};
    selSt.forEach(function (x) { var p = x.phone; if (p) fams[waNumber(p)] = 1; });
    var nMsg = w.per === 'family' ? Object.keys(fams).length : selSt.length - noPh;
    var allOn = list.length && list.every(function (x) { return w.sel[x.id]; });
    var opt = function (v, label, cur) { return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(label) + '</option>'; };
    var tplOpts = opt('', '— رسالة حرة —', w.tpl) + (S.waTpl || []).filter(function (t) { return t.key !== 'absence' && t.key !== 'repeat' && t.key !== 'leave'; }).map(function (t) { return opt(t.key, t.title, w.tpl); }).join('');
    var compose = '<div class="card"><h2 style="margin-top:0">الرسالة</h2>' +
      '<div class="toolbar" style="align-items:center"><label class="field" for="wa-tpl" style="margin:0">القالب</label><select id="wa-tpl" style="width:auto">' + tplOpts + '</select>' +
        (w.tpl ? '<button type="button" class="btn" data-wasavetpl title="يُحفظ هذا النص في القالب ليُستعمل في المرات القادمة">حفظ النص في القالب</button>' : '<button type="button" class="btn" data-wanewtpl' + (w.text.trim() ? '' : ' disabled') + '>حفظه قالبًا جديدًا</button>') + '</div>' +
      '<label class="field" for="wa-title">عنوان الرسالة في الأرشيف</label><input id="wa-title" value="' + esc(w.title) + '" placeholder="مثلًا: تنويه تغيير موعد الدوام">' +
      '<label class="field" for="wa-text">نص الرسالة</label><textarea id="wa-text" rows="7" style="width:100%">' + esc(w.text) + '</textarea>' +
      '<div class="toolbar" style="margin:6px 0">' + WA_VARS.map(function (v) { return '<button type="button" class="btn" data-wavar="' + esc(v[0]) + '" title="' + esc(v[1]) + '">' + esc(v[0]) + '</button>'; }).join('') + '</div>' +
      '<p class="hint">اضغط متغيرًا ليُضاف في موضع المؤشر، ويُستبدل عند الإرسال ببيانات كل طالب.</p>' +
      '<div class="hint" style="white-space:pre-wrap;background:var(--ivory,#faf7f0);border:1px solid var(--line,#e5e7eb);border-radius:8px;padding:10px;margin:0"><b>معاينة' + (selSt[0] || list[0] ? ' (' + esc((selSt[0] || list[0]).full_name) + ')' : '') + ':</b>\n' +
        esc(waPreview(w.text, selSt[0] || list[0]) || '—') + '</div></div>';
    var buses = (S.tGroups || []).slice().sort(function (a, b) { return String(a.assembly_point).localeCompare(String(b.assembly_point), 'ar'); });
    var filters = '<div class="toolbar" style="align-items:center">' +
      '<input type="search" id="wa-q" placeholder="اسم الطالب أو ولي الأمر أو الجوال" aria-label="بحث" value="' + esc(w.q) + '" style="max-width:260px">' +
      '<select id="wa-cls" style="width:auto">' + opt('', 'كل الشعب', w.cls) + schoolClasses().map(function (c) { return opt(c, c, w.cls); }).join('') + '</select>' +
      '<select id="wa-bus" style="width:auto">' + opt('', 'كل الطلاب (مواصلات أو لا)', w.bus) + buses.map(function (b) { return opt(b.id, 'باص: ' + b.assembly_point, w.bus); }).join('') + opt('none', 'بلا مواصلات', w.bus) + '</select>' +
      '<select id="wa-reg" style="width:auto">' + opt('', 'المسجلون (نهائي أو احتياط)', w.reg || '') + opt('pending', 'تسجيل مبدئي فقط', w.reg || '') + opt('final', 'تسجيل نهائي فقط', w.reg || '') +
        opt('reserve', 'احتياط فقط', w.reg || '') + opt('all', 'كل الطلاب', w.reg || '') + '</select>' +
      '<select id="wa-fresh" style="width:auto">' + opt('', 'كل تواريخ التسجيل', w.fresh) + opt('7', 'سُجّلوا آخر 7 أيام', w.fresh) + opt('30', 'سُجّلوا آخر 30 يومًا', w.fresh) + '</select>' +
      '<button type="button" class="btn" data-waall>' + (allOn ? 'إلغاء تحديد المعروضين' : 'تحديد المعروضين (' + list.length + ')') + '</button>' +
      (selIds.length ? '<button type="button" class="btn" data-waclear>مسح الاختيار</button>' : '') + '</div>';
    var rows = list.map(function (x) {
      var ph = x.phone, grp = (S.tGroups || []).filter(function (b) { return b.id === g[x.id]; })[0];
      return '<tr><td><input type="checkbox" data-wasel="' + x.id + '"' + (w.sel[x.id] ? ' checked' : '') + ' aria-label="اختيار"></td><td><b>' + esc(x.full_name) + '</b></td><td>' + esc(x.class_name || '—') + '</td>' +
        '<td>' + esc(x.guardian_name || '—') + '</td><td dir="ltr" style="text-align:right">' + (ph ? esc(ph) : '<span class="badge unpaid" dir="rtl">بلا رقم</span>') + '</td><td>' + (grp ? esc(grp.assembly_point) : '—') + '</td></tr>';
    }).join('');
    var send = '<div class="card" style="position:sticky;bottom:0;z-index:2"><div class="toolbar" style="align-items:center;margin:0">' +
      '<b>المختارون: ' + selIds.length + ' طالبًا</b>' + (noPh ? '<span class="badge unpaid">' + noPh + ' بلا رقم</span>' : '') +
      '<label style="display:flex;gap:4px;align-items:center"><input type="radio" name="wa-per" value="family"' + (w.per === 'family' ? ' checked' : '') + '> رسالة واحدة لكل ولي أمر (الإخوة معًا)</label>' +
      '<label style="display:flex;gap:4px;align-items:center"><input type="radio" name="wa-per" value="student"' + (w.per === 'student' ? ' checked' : '') + '> رسالة لكل طالب</label>' +
      '<button type="button" class="btn primary" data-wasend' + (nMsg && w.text.trim() && !w.busy ? '' : ' disabled') + '>' + (w.busy ? 'جارٍ الإرسال…' : 'إرسال (' + nMsg + ' رسالة)') + '</button></div></div>';
    return compose + '<div class="card"><h2 style="margin-top:0">المستلمون</h2>' + filters +
      (rows ? '<div class="table-wrap" style="max-height:60vh;overflow:auto"><table class="grid"><thead><tr><th></th><th>الطالب</th><th>الشعبة</th><th>ولي الأمر</th><th>واتساب / جوال</th><th>الباص</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">لا طلاب يطابقون الاختيار.</div>') + '</div>' + send;
  }

  function waArchiveRows() {
    var w = waUi(), q = norm(w.aq), d = latinDigits(w.aq).replace(/\D/g, '');
    return (S.waMsgs || []).filter(function (m) {
      var day = String(m.created_at).slice(0, 10);
      if (w.akind && m.kind !== w.akind) return false;
      if (w.astatus && (w.astatus === 'bad' ? ['failed', 'cancelled', 'rejected', 'nophone'].indexOf(m.status) < 0 : w.astatus === 'ok' ? ['sent', 'delivered', 'read'].indexOf(m.status) < 0 : m.status !== w.astatus)) return false;
      if (w.afrom && day < w.afrom) return false;
      if (w.ato && day > w.ato) return false;
      return !q || norm((m.names || '') + ' ' + (m.title || '') + ' ' + m.body).indexOf(q) > -1 || (d && latinDigits(m.phone || '').replace(/\D/g, '').indexOf(d) > -1);
    });
  }
  function waKindLabel(k) { var t = waTpl(k); return t ? t.title : k === 'custom' ? 'رسالة حرة' : k; }
  function waTime(ts) { var t = new Date(ts); return isNaN(t) ? '' : dmy(t.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })) + ' ' + t.toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' }); }

  function waArchiveHtml() {
    var w = waUi(), list = waArchiveRows(), cnt = {};
    list.forEach(function (m) { cnt[m.status] = (cnt[m.status] || 0) + 1; });
    var ok = (cnt.sent || 0) + (cnt.delivered || 0) + (cnt.read || 0), bad = (cnt.failed || 0) + (cnt.cancelled || 0) + (cnt.rejected || 0) + (cnt.nophone || 0), wait = (cnt.queued || 0) + (cnt.sending || 0);
    var kinds = {};
    (S.waMsgs || []).forEach(function (m) { kinds[m.kind] = 1; });
    var opt = function (v, label, cur) { return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(label) + '</option>'; };
    // الدفعات: عنوان، وقت، عدد، وحالات
    var batches = {}, order = [];
    list.forEach(function (m) { var b = batches[m.batch_id]; if (!b) { b = batches[m.batch_id] = { id: m.batch_id, title: m.title || waKindLabel(m.kind), at: m.created_at, by: m.created_by, n: 0, ok: 0, bad: 0, wait: 0 }; order.push(b); }
      b.n++; if (['sent', 'delivered', 'read'].indexOf(m.status) > -1) b.ok++; else if (m.status === 'queued' || m.status === 'sending') b.wait++; else b.bad++; });
    var rows = list.slice(0, 500).map(function (m) {
      var s = WA_STATUS[m.status] || ['pending', m.status];
      return '<tr><td style="white-space:nowrap">' + waTime(m.created_at) + '</td><td>' + esc(m.title || waKindLabel(m.kind)) + '</td><td>' + esc(m.names || '') + '</td>' +
        '<td dir="ltr" style="text-align:right;white-space:nowrap">' + esc(m.phone || '—') + '</td>' +
        '<td><details><summary style="cursor:pointer">' + esc(m.body.slice(0, 50)) + (m.body.length > 50 ? '…' : '') + '</summary><div style="white-space:pre-wrap">' + esc(m.body) + '</div></details></td>' +
        '<td><span class="badge ' + s[0] + '">' + s[1] + '</span>' + (m.error ? '<div class="hint" style="margin:2px 0 0">' + esc(m.error) + '</div>' : '') + waRetryBtn(m) + '</td></tr>';
    }).join('');
    return '<div class="stats"><div class="card stat"><span class="lbl">الرسائل</span><span class="num">' + list.length + '</span><span class="sub">في ' + order.length + ' دفعة</span></div>' +
        '<div class="card stat"><span class="lbl">أُرسلت</span><span class="num">' + ok + '</span><span class="sub">منها وصلت: ' + ((cnt.delivered || 0) + (cnt.read || 0)) + '</span></div>' +
        '<div class="card stat"><span class="lbl">في الانتظار</span><span class="num">' + wait + '</span><span class="sub">تُرسل تباعًا بحسب حدود الرقم اليومية</span></div>' +
        '<div class="card stat"><span class="lbl">لم تُرسل</span><span class="num">' + bad + '</span><span class="sub">فشل أو رقم غير صالح أو بلا رقم</span></div></div>' +
      '<div class="toolbar" style="align-items:center">' +
        '<input type="search" id="wa-aq" placeholder="اسم الطالب أو الرقم أو نص الرسالة" aria-label="بحث" value="' + esc(w.aq) + '" style="max-width:240px">' +
        '<select id="wa-akind" style="width:auto">' + opt('', 'كل الأنواع', w.akind) + Object.keys(kinds).map(function (k) { return opt(k, waKindLabel(k), w.akind); }).join('') + '</select>' +
        '<select id="wa-astatus" style="width:auto">' + opt('', 'كل الحالات', w.astatus) + opt('ok', 'أُرسلت', w.astatus) + opt('queued', 'في الانتظار', w.astatus) + opt('bad', 'لم تُرسل', w.astatus) + '</select>' +
        '<label class="field" for="wa-afrom" style="margin:0">من</label><input type="date" id="wa-afrom" value="' + esc(w.afrom) + '" style="width:auto">' +
        '<label class="field" for="wa-ato" style="margin:0">إلى</label><input type="date" id="wa-ato" value="' + esc(w.ato) + '" style="width:auto">' +
        '<button type="button" class="btn primary" data-warefresh' + (w.busy ? ' disabled' : '') + ' title="يسأل SendWhats عن حالة الرسائل غير المكتملة في آخر 30 يومًا">' + (w.busy ? 'جارٍ التحديث…' : 'تحديث الحالات') + '</button>' +
        '<button type="button" class="btn" data-waxlsx' + (list.length ? '' : ' disabled') + '>تصدير Excel</button></div>' +
      (order.length ? '<div class="card"><h2 style="margin-top:0">الدفعات</h2><div class="table-wrap"><table class="grid"><thead><tr><th>الوقت</th><th>الرسالة</th><th>المرسِل</th><th>العدد</th><th>أُرسلت</th><th>في الانتظار</th><th>لم تُرسل</th></tr></thead><tbody>' +
        order.slice(0, 100).map(function (b) { return '<tr><td style="white-space:nowrap">' + waTime(b.at) + '</td><td><b>' + esc(b.title) + '</b></td><td dir="ltr" style="text-align:right">' + esc(displayName(b.by || '')) + '</td><td>' + b.n + '</td><td>' + b.ok + '</td><td>' + b.wait + '</td><td>' + (b.bad ? '<b style="color:var(--danger,#b91c1c)">' + b.bad + '</b>' : 0) + '</td></tr>'; }).join('') +
        '</tbody></table></div></div>' : '') +
      '<div class="card"><h2 style="margin-top:0">الرسائل' + (list.length > 500 ? ' (أحدث 500 — ضيّق البحث أو صدّر Excel للكل)' : '') + '</h2>' + (rows
        ? '<div class="table-wrap"><table class="grid"><thead><tr><th>الوقت</th><th>الرسالة</th><th>الطالب</th><th>الرقم</th><th>النص</th><th>الحالة</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">لا رسائل.</div>') + '</div>';
  }

  function waTemplatesHtml() {
    var list = S.waTpl || [];
    return '<p class="hint">القوالب نقطة بداية: عند الإرسال تختار القالب ثم تعدّل نصه كما تشاء. قالبا «غياب اليوم» و«تكرار الغياب» تستعملهما أزرار الغياب في شاشة الحضور مباشرة' +
        ' (ولتكرار الغياب أيضًا {العدد} {من} {إلى}). المتغيرات: ' + WA_VARS.map(function (v) { return esc(v[0]) + ' ' + esc(v[1]); }).join('، ') + '.</p>' +
      list.map(function (t) {
        var fixed = t.key === 'absence' || t.key === 'repeat';
        return '<div class="card" data-watplcard="' + esc(t.key) + '"><div class="toolbar" style="align-items:center;margin:0 0 6px">' +
          '<input data-watpltitle value="' + esc(t.title) + '" aria-label="اسم القالب" style="max-width:280px;font-weight:700">' + (fixed ? '<span class="badge published">رسائل الغياب</span>' : '') +
          '<span style="flex:1"></span><button type="button" class="btn primary" data-watplsave="' + esc(t.key) + '">حفظ</button>' +
          (fixed ? '' : '<button type="button" class="btn danger" data-watpldel="' + esc(t.key) + '">حذف</button>') + '</div>' +
          '<textarea data-watplbody rows="5" style="width:100%">' + esc(t.body) + '</textarea>' +
          (t.updated_by ? '<div class="hint" style="margin:4px 0 0">آخر تعديل ' + waTime(t.updated_at) + ' — ' + esc(displayName(t.updated_by)) + '</div>' : '') + '</div>';
      }).join('') +
      '<button type="button" class="btn" data-watpladd>+ قالب جديد</button>';
  }

  async function waSaveTemplate(key, title, body) {
    var row = { key: key, title: title.trim() || 'قالب', body: body, updated_at: new Date().toISOString(), updated_by: S.email || '' };
    var t = waTpl(key);
    if (!t) row.sort = 100 + (S.waTpl || []).length;
    var r = await sb.from('wa_templates').upsert(row, { onConflict: 'key' });
    if (r.error) return fail(r.error), false;
    await loadWaTemplates();
    toast('حُفظ القالب');
    return true;
  }

  async function waSend() {
    var w = waUi(), ids = Object.keys(w.sel).filter(function (id) { return w.sel[id] && findStudent(id); });
    if (!ids.length || !w.text.trim()) return;
    var noPh = ids.filter(function (id) { var x = findStudent(id); return !(x.phone); }).length;
    if (!confirm('إرسال الرسالة إلى أولياء أمور ' + ids.length + ' طالبًا' + (w.per === 'family' ? ' (رسالة واحدة لكل ولي أمر)' : '') + '؟' + (noPh ? '\n' + noPh + ' منهم بلا رقم فلن تصلهم.' : '') + '\nلا يمكن التراجع بعد الإرسال.')) return;
    if (!w.batch) w.batch = waBatchId();
    w.busy = true; render();
    var r = await sb.functions.invoke('send-whatsapp', { body: { action: 'send', batch_id: w.batch, kind: w.tpl || 'custom', title: w.title.trim() || (w.tpl && waTpl(w.tpl) ? waTpl(w.tpl).title : 'رسالة حرة'),
      text: w.text, student_ids: ids, per: w.per, school: schoolName() } });
    w.busy = false;
    if (r.error) { render(); return toast('تعذّر الإرسال: ' + r.error.message + ' — يمكنك الضغط مرة أخرى، ولن تتكرر الرسائل التي وصلت', true); }
    var d = r.data || {}, skipped = (d.noPhone || []).length + (d.rejected || 0);
    w.batch = null; w.sel = {}; S.waMsgs = null;
    render();
    toast('أُضيف ' + (d.queued || 0) + ' رسالة إلى قائمة الإرسال' + (d.alreadySent ? '، و' + d.alreadySent + ' سبق إرسالها' : '') + (skipped ? '، و' + skipped + ' بلا رقم صحيح' : '') + '. تابعها في «الأرشيف والتقرير».', skipped > 0 && !d.queued);
  }

  // يسأل SendWhats عن الرسائل غير المكتملة (آخر 30 يومًا) ويكتب حالتها في الأرشيف.
  // يعمل تلقائيًا عند فتح الأرشيف، ومن زر «تحديث الحالات»؛ وأي خطأ من الدالة يظهر بدل أن يُبلَع
  async function waRefresh(quiet) {
    var w = waUi(), since = new Date(Date.now() - 30 * 864e5).toISOString();
    var ids = {};
    (S.waMsgs || []).forEach(function (m) { if (m.created_at >= since && ['queued', 'sending', 'sent', 'delivered'].indexOf(m.status) > -1) ids[m.batch_id] = 1; });
    if (!Object.keys(ids).length) return quiet ? null : toast('لا رسائل غير مكتملة في آخر 30 يومًا');
    w.busy = true; render();
    var r = await sb.functions.invoke('send-whatsapp', { body: { action: 'refresh', batch_ids: Object.keys(ids).slice(0, 60) } });
    w.busy = false;
    var d = r.data || {};
    if (r.error || d.error) { render(); return toast('تعذّر تحديث الحالات: ' + (d.error || r.error.message), true); }
    await loadWaArchive();
    if (d.failed && d.failed.length) return toast('حُدّث ' + (d.updated || 0) + ' رسالة، وتعذّر ' + d.failed.length + ': ' + d.failed.slice(0, 2).join(' — '), true);
    if (!quiet) toast('حُدّثت حالة ' + (d.updated || 0) + ' رسالة');
  }

  async function waExport() {
    try {
      await loadXlsx();
      var list = waArchiveRows(), wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      var ws = XLSX.utils.aoa_to_sheet([[schoolName()], ['أرشيف رسائل واتساب — ' + dmy(todayISO())], [], ['م', 'الوقت', 'الرسالة', 'الطالب', 'الرقم', 'الحالة', 'السبب', 'النص', 'المرسِل']].concat(list.map(function (m, i) {
        return [i + 1, waTime(m.created_at), m.title || waKindLabel(m.kind), m.names || '', m.phone || '', (WA_STATUS[m.status] || [0, m.status])[1], m.error || '', m.body, displayName(m.created_by || '')];
      })));
      ws['!cols'] = [5, 18, 24, 34, 16, 12, 20, 80, 20].map(function (x) { return { wch: x }; });
      XLSX.utils.book_append_sheet(wb, ws, 'الرسائل');
      XLSX.writeFile(wb, 'رسائل-واتساب-' + todayISO() + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  // رسالة الترحيب عند اعتماد التسجيل النهائي (خيار في صفحة تسجيل الطالب)، من قالب «welcome»، ومرة واحدة لكل طالب
  async function waSendWelcome(x) {
    if (!canRecordAtt() || !x) return;
    if (!(x.phone)) return toast('لم تُرسل رسالة الترحيب: لا رقم جوال لولي الأمر', true);
    if (S.waTpl == null) await loadWaTemplates();
    var t = waTpl('welcome');
    if (!t) return toast('لم تُرسل رسالة الترحيب: لا يوجد قالب «ترحيب بطالب جديد» في شاشة رسائل واتساب', true);
    var r = await sb.functions.invoke('send-whatsapp', { body: { action: 'send', batch_id: 'welcome-' + x.id, kind: 'welcome', title: t.title, text: t.body, student_ids: [x.id], per: 'student', school: schoolName() } });
    if (r.error) return toast('تعذّر إرسال الترحيب: ' + r.error.message, true);
    S.waMsgs = null;
    toast(r.data && r.data.queued ? 'أُضيفت رسالة الترحيب إلى قائمة الإرسال' : 'سبق إرسال الترحيب لهذا الطالب');
  }

  document.addEventListener('click', async function (e) {
    if (location.hash !== '#/messages' || !canRecordAtt()) return;
    var w = waUi(), el;
    if ((el = e.target.closest('[data-watab]'))) { w.tab = el.getAttribute('data-watab'); if (w.tab === 'archive') S.waMsgs = null; return render(); }
    if ((el = e.target.closest('[data-wavar]'))) {
      var ta = document.getElementById('wa-text'), v = el.getAttribute('data-wavar'), p = ta.selectionStart || ta.value.length;
      w.text = ta.value.slice(0, p) + v + ta.value.slice(ta.selectionEnd || p);
      render();
      var t2 = document.getElementById('wa-text'); t2.focus(); t2.setSelectionRange(p + v.length, p + v.length);
      return;
    }
    if (e.target.closest('[data-waall]')) {
      var list = waShown(), on = !(list.length && list.every(function (x) { return w.sel[x.id]; }));
      list.forEach(function (x) { if (on) w.sel[x.id] = 1; else delete w.sel[x.id]; });
      w.batch = null;
      return render();
    }
    if (e.target.closest('[data-waclear]')) { w.sel = {}; w.batch = null; return render(); }
    if (e.target.closest('[data-wasend]')) return waSend();
    if (e.target.closest('[data-wasavetpl]')) { var t = waTpl(w.tpl); if (t && confirm('حفظ هذا النص في قالب «' + t.title + '» بدل نصه الحالي؟')) await waSaveTemplate(t.key, t.title, w.text); return render(); }
    if (e.target.closest('[data-wanewtpl]')) {
      var name = prompt('اسم القالب الجديد:', w.title || '');
      if (!name || !name.trim()) return;
      var key = 't' + Date.now().toString(36);
      if (await waSaveTemplate(key, name, w.text)) w.tpl = key;
      return render();
    }
    if (e.target.closest('[data-warefresh]')) return waRefresh();
    var wr = e.target.closest('[data-waretry]'); if (wr) return waRetry(wr.getAttribute('data-waretry'));
    if (e.target.closest('[data-waxlsx]')) return waExport();
    if ((el = e.target.closest('[data-watplsave]'))) {
      var card = el.closest('[data-watplcard]');
      await waSaveTemplate(el.getAttribute('data-watplsave'), card.querySelector('[data-watpltitle]').value, card.querySelector('[data-watplbody]').value);
      return render();
    }
    if ((el = e.target.closest('[data-watpldel]'))) {
      var k = el.getAttribute('data-watpldel'), tt = waTpl(k);
      if (!tt || !confirm('حذف قالب «' + tt.title + '»؟ الرسائل المرسلة به تبقى في الأرشيف.')) return;
      var r = await sb.from('wa_templates').delete().eq('key', k);
      if (r.error) return fail(r.error);
      if (w.tpl === k) w.tpl = '';
      await loadWaTemplates();
      return render();
    }
    if (e.target.closest('[data-watpladd]')) {
      var nm = prompt('اسم القالب الجديد:');
      if (!nm || !nm.trim()) return;
      await waSaveTemplate('t' + Date.now().toString(36), nm, 'السلام عليكم ورحمة الله وبركاته،\n\nإدارة الأكاديمية');
      return render();
    }
  });
  document.addEventListener('change', function (e) {
    if (location.hash !== '#/messages') return;
    var w = waUi(), id = e.target.id, el;
    if ((el = e.target.closest('[data-wasel]'))) { var sid = el.getAttribute('data-wasel'); if (el.checked) w.sel[sid] = 1; else delete w.sel[sid]; w.batch = null; return render(); }
    if (e.target.name === 'wa-per') { w.per = e.target.value; w.batch = null; return render(); }
    if (id === 'wa-tpl') { w.tpl = e.target.value; var t = waTpl(w.tpl); if (t) { w.text = t.body; w.title = t.title; } w.batch = null; return render(); }
    var map = { 'wa-reg': 'reg', 'wa-cls': 'cls', 'wa-bus': 'bus', 'wa-fresh': 'fresh', 'wa-akind': 'akind', 'wa-astatus': 'astatus', 'wa-afrom': 'afrom', 'wa-ato': 'ato' };
    if (map[id]) { w[map[id]] = e.target.value; return render(); }
  });
  document.addEventListener('input', function (e) {
    if (location.hash !== '#/messages') return;
    var w = waUi(), id = e.target.id;
    if (id === 'wa-text' || id === 'wa-title') {
      w[id === 'wa-text' ? 'text' : 'title'] = e.target.value;
      if (id === 'wa-text') w.batch = null;
      // المعاينة وزر الإرسال يتبعان النص دون إعادة رسم الحقل نفسه
      clearTimeout(waUi.t);
      waUi.t = setTimeout(function () {
        var a = document.activeElement, pos = a && a.selectionStart;
        var aid = a && a.id;
        render();
        var b = aid && document.getElementById(aid);
        if (b) { b.focus(); if (pos != null) b.setSelectionRange(pos, pos); }
      }, 400);
      return;
    }
    if (id === 'wa-q' || id === 'wa-aq') {
      w[id === 'wa-q' ? 'q' : 'aq'] = e.target.value;
      var p = e.target.selectionStart;
      render();
      var q = document.getElementById(id);
      if (q) { q.focus(); q.setSelectionRange(p, p); }
    }
  });

  async function copyText(text, done) {
    try { await navigator.clipboard.writeText(text); toast(done); } catch (err) { prompt('انسخ:', text); }
  }

  app.addEventListener('click', async function (e) {
    if (location.hash !== '#/attendance' || !isAdmin()) return;
    var el, r;
    if (e.target.closest('[data-aladd]')) {
      var name = document.getElementById('al-name').value.replace(/\s+/g, ' ').trim(), phone = latinDigits(document.getElementById('al-phone').value).replace(/[^0-9+]/g, '');
      if (!name) return toast('اكتب اسم المعلم', true);
      if (phone && S.attLinks.some(function (t) { return t.phone && plainPhone(t.phone).slice(-10) === plainPhone(phone).slice(-10); })) return toast('هذا الجوال مسجَّل لمعلم آخر', true);
      r = await sb.from('attendance_tokens').insert({ name: name, phone: phone }).select().single();
      if (r.error) return fail(r.error);
      S.attLinks.push(r.data);
      S.attLinks.sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); });
      render();
      toast('أُضيف ' + name);
    } else if ((el = e.target.closest('[data-alcopy]'))) {
      copyText(absenceLink(el.getAttribute('data-alcopy')), 'نُسخ الرابط');
    } else if ((el = e.target.closest('[data-altoggle]'))) {
      var t = S.attLinks.filter(function (x) { return x.token === el.getAttribute('data-altoggle'); })[0];
      r = await sb.from('attendance_tokens').update({ active: !t.active }).eq('token', t.token);
      if (r.error) return fail(r.error);
      t.active = !t.active;
      render();
    } else if ((el = e.target.closest('[data-aldel]'))) {
      var d = S.attLinks.filter(function (x) { return x.token === el.getAttribute('data-aldel'); })[0];
      if (!confirm('حذف «' + d.name + '»؟ يتوقف رابطه نهائيًا، وما سجّله من غياب يبقى.')) return;
      r = await sb.from('attendance_tokens').delete().eq('token', d.token);
      if (r.error) return fail(r.error);
      S.attLinks = S.attLinks.filter(function (x) { return x !== d; });
      render();
    }
  });

  function renderAttendance() {
    var a = attState();
    if (S.attMissing) {
      app.innerHTML = tabs('attendance') + '<div class="card empty">لم تُجهَّز قاعدة البيانات للحضور والغياب بعد.<br>شغّل الملف <code dir="ltr">supabase/attendance.sql</code> في محرر SQL ثم حدّث الصفحة.</div>';
      return;
    }
    if (a.view !== 'report' && !S.attDay[a.day]) {
      app.innerHTML = tabs('attendance') + '<div class="card empty">جارٍ التحميل…</div>';
      loadAttDay(a.day);
      return;
    }
    var classes = attClasses();
    if (role() === 'supervisor' && !S.students.length) {
      app.innerHTML = tabs('attendance') + '<div class="card empty">لا تظهر بيانات الطلاب لحساب المشرف بعد.<br>يشغّل المدير العام الملف <code dir="ltr">supabase/attendance_supervisor.sql</code> في محرر SQL، ثم تُحدَّث الصفحة.</div>';
      return;
    }
    app.innerHTML = tabs('attendance') +
      '<div class="tabbar"><nav class="tabs" aria-label="أقسام الحضور والغياب">' +
        [['day', 'الحضور اليومي'], ['leaves', 'الإجازات'], ['sheets', 'الكشوف'], ['report', 'تقرير فترة']].concat(isAdmin() ? [['links', 'تسجيل المعلمين']] : []).map(function (v) {
          return '<button type="button" data-attview="' + v[0] + '"' + (a.view === v[0] ? ' class="on" aria-current="true"' : '') + '>' + v[1] + '</button>';
        }).join('') + '</nav>' +
        '<span style="flex:1"></span>' +
        (a.view === 'links' ? '' : '<select id="att-cls" aria-label="الشعبة" style="width:auto;min-width:170px"><option value="">كل المدرسة</option>' + classes.map(function (c) {
          return '<option' + (c === a.cls ? ' selected' : '') + '>' + esc(c) + '</option>';
        }).join('') + '</select>') +
        (a.view === 'day' ? '<span class="monthpick"><label class="field" for="att-day">اليوم</label><input type="date" id="att-day" max="' + todayISO() + '" value="' + a.day + '"></span>' : '') + '</div>' +
      (a.view === 'report' ? attReportHtml() : a.view === 'leaves' ? stLeavesHtml() : a.view === 'sheets' ? attExportHtml() : a.view === 'links' ? attLinksHtml() : a.cls ? attClassHtml(a.cls) : attSchoolHtml());
  }

  async function saveAttendance() {
    var a = attState(), roll = classRoll(a.cls), who = (S.profile && S.profile.full_name) || displayName(S.email), now = new Date().toISOString();
    if (!roll.length || a.day > todayISO()) return;
    var rows = roll.map(function (x) {
      var st = attOf(x.id);
      return { student_id: x.id, day: a.day, status: st.status === 'suspended' ? 'excused' : st.status, note: st.note.trim(), class_name: a.cls, recorded_by: who, updated_at: now };
    });
    a.busy = true;
    render();
    var r = await sb.from('attendance').upsert(rows, { onConflict: 'student_id,day' });
    a.busy = false;
    if (r.error) { render(); return fail(r.error); }
    var map = S.attDay[a.day] || (S.attDay[a.day] = {});
    rows.forEach(function (row) { map[row.student_id] = row; });
    a.draft = {};
    render();
    var n = attCounts(rows, function (row) { return row.status; });
    toast('حُفظ حضور ' + a.cls + ' — حاضر: ' + n.present + ' · غائب: ' + n.absent + (n.excused ? ' · مأذون: ' + n.excused : '') + (n.suspended ? ' · مفصول: ' + n.suspended : ''));
  }

  function leaveAttDraft() {
    var a = attState();
    return !Object.keys(a.draft).length || confirm('في حضور هذه الشعبة تعديلات لم تُحفظ. تركها؟');
  }

  function exportAttDayXlsx() {
    var a = attState();
    a.expDay = a.day;
    return exportAttSchool('day');
  }

  async function exportAttReportXlsx() {
    var a = attState();
    if (!a.report) return;
    try {
      await loadXlsx();
      var d = attReportData(), wb = XLSX.utils.book_new(), used = {};
      wb.Workbook = { Views: [{ RTL: true }] };
      var title = 'من ' + dmy(a.report.from) + ' إلى ' + dmy(a.report.to);
      var classes = a.cls ? [a.cls] : attClasses();
      if (!a.cls) {
        xlsxSheet(wb, used, 'ملخص الشعب', [[schoolName()], ['الحضور والغياب — ' + title], [], ['الشعبة', 'أيام التسجيل', 'الغياب (طالب×يوم)', 'نسبة الحضور']].concat(classes.map(function (cls) {
          var c = d.byClass[cls];
          return c ? [cls, Object.keys(c.days).length, c.n.absent, attPct(c.n)] : [cls, 0, '', ''];
        })), [18, 12, 16, 12]);
      }
      classes.forEach(function (cls) {
        var roll = classRoll(cls);
        if (!roll.length) return;
        xlsxSheet(wb, used, cls, [[schoolName()], ['حضور ' + cls + ' — ' + title], [], ['م', 'الطالب', 'أيام الحضور', 'أيام الغياب', 'نسبة الحضور', 'واتساب ولي الأمر']].concat(roll.map(function (x, i) {
          var p = d.per[x.id] || { present: 0, absent: 0 };
          return [i + 1, x.full_name, p.present, p.absent, attPct(p), plainPhone(x.phone)];
        })), [5, 32, 12, 12, 12, 16]);
      });
      XLSX.writeFile(wb, ('تقرير-الحضور-' + (a.cls || 'المدرسة') + '-' + a.report.from + '-' + a.report.to).replace(/\s+/g, '-') + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  app.addEventListener('click', function (e) {
    if (location.hash !== '#/attendance' || !canAttView()) return;
    var el, a = attState();
    if (!canRecordAtt() && e.target.closest('[data-attset], [data-attall], [data-attsave]')) return;
    if ((el = e.target.closest('[data-attdetail]'))) return attDetail(el.getAttribute('data-attdetail'));
    if ((el = e.target.closest('[data-attstu]'))) { var sp = el.getAttribute('data-attstu').split('|'); return attStudentRecord(sp[0], sp[1]); }
    if ((el = e.target.closest('[data-attset]'))) {
      var sid = el.getAttribute('data-attset'), cur = attOf(sid);
      a.draft[sid] = { status: el.getAttribute('data-attv'), note: cur.note };
      var y = window.scrollY;
      render();
      window.scrollTo(0, y);
    } else if (e.target.closest('[data-attall]')) {
      classRoll(a.cls).forEach(function (x) { if (attOf(x.id).status !== 'present') a.draft[x.id] = { status: 'present', note: attOf(x.id).note }; });
      render();
    } else if (e.target.closest('[data-attsave]')) {
      saveAttendance();
    } else if ((el = e.target.closest('[data-attview]'))) {
      if (!leaveAttDraft()) return;
      a.draft = {};
      a.view = el.getAttribute('data-attview');
      render();
    } else if ((el = e.target.closest('[data-attcls]'))) {
      a.cls = el.getAttribute('data-attcls');
      render();
      window.scrollTo(0, 0);
    } else if (e.target.closest('[data-attrun]')) {
      loadAttReport();
    } else if (e.target.closest('[data-attrep]')) {
      var rb = e.target.closest('[data-attrep]');
      if (!confirm('إرسال تنبيه تكرار الغياب إلى أولياء أمور ' + rb.getAttribute('data-attrep') + ' طالبًا؟\nرسالة واحدة لكل طالب في هذه الفترة، ولا تُكرَّر.')) return;
      attRepeatSend({});
    } else if ((el = e.target.closest('[data-attrep1]'))) {
      var rx = findStudent(el.getAttribute('data-attrep1'));
      if (!rx || !confirm('إرسال تنبيه تكرار الغياب إلى ولي أمر «' + rx.full_name + '»؟')) return;
      attRepeatSend({ student_id: rx.id });
    } else if (e.target.closest('[data-attnotify1]')) {
      var one = e.target.closest('[data-attnotify1]'), sx = findStudent(one.getAttribute('data-attnotify1'));
      if (!sx || !confirm('إرسال رسالة غياب واتساب إلى ولي أمر الطالب «' + sx.full_name + '»؟\nلا تُرسل له مرة ثانية اليوم.')) return;
      one.disabled = true;
      sb.functions.invoke('send-absence-whatsapp', { body: { student_id: sx.id, school: schoolName() } }).then(function (r) {
        one.disabled = false;
        if (r.error) return toast('تعذّر الإرسال: ' + r.error.message, true);
        var d = r.data || {};
        toast(d.queued ? 'أُضيفت رسالة ' + sx.full_name + ' إلى قائمة الإرسال' : d.alreadySent ? 'سبق إرسال رسالة لهذا الطالب اليوم' : 'لا رقم صحيح لولي الأمر', !d.queued);
      });
    } else if (e.target.closest('[data-attnotify]')) {
      var notifyBtn = e.target.closest('[data-attnotify]');
      if (!confirm('إرسال رسالة واتساب إلى أولياء أمور ' + notifyBtn.dataset.attnotify + ' طالبًا غائبًا اليوم؟\nمن أُرسل له اليوم لن تصله الرسالة مرة أخرى.')) return;
      notifyBtn.disabled = true;
      sb.functions.invoke('send-absence-whatsapp', { body: { school: schoolName() } }).then(function (r) {
        notifyBtn.disabled = false;
        if (r.error) return toast('تعذّر إرسال الغياب: ' + r.error.message, true);
        var d = r.data, skipped = d.noPhone.length + d.rejected;
        toast('أُضيف ' + d.queued + ' إلى قائمة الإرسال' + (d.alreadySent ? '، و' + d.alreadySent + ' سبق إرسالهم' : '') + (skipped ? '، و' + skipped + ' بلا رقم صحيح' : ''), skipped > 0);
      });
    } else if (e.target.closest('[data-attdayxlsx]')) {
      exportAttDayXlsx();
    } else if (e.target.closest('[data-attrepxlsx]')) {
      exportAttReportXlsx();
    } else if (isAdmin() && e.target.closest('[data-attholadd]')) {
      var hd = (document.getElementById('att-hol') || {}).value;
      if (!hd) return toast('اختر اليوم أولًا', true);
      a.expMonth = hd.slice(0, 7);
      setHoliday(hd, true);
    } else if (isAdmin() && (el = e.target.closest('[data-attholdel]'))) {
      setHoliday(el.getAttribute('data-attholdel'), false);
    } else if ((el = e.target.closest('[data-attregister]'))) {
      if (el.getAttribute('data-attregister') === 'pdf') printAttRegister(); else exportAttRegister();
    } else if (e.target.closest('[data-attteacher]')) {
      printAttRegister(true);
    } else if ((el = e.target.closest('[data-attschool]'))) {
      if (el.getAttribute('data-fmt') === 'pdf') printAttSchool(el.getAttribute('data-attschool')); else exportAttSchool(el.getAttribute('data-attschool'));
    } else if (e.target.closest('[data-attschoolpdf]')) {
      a.expDay = a.day;
      printAttSchool('day');
    }
  });

  app.addEventListener('change', function (e) {
    if (location.hash !== '#/attendance' || !canAttView()) return;
    var el = e.target, a = attState();
    if (el.id === 'att-min') { a.minAbs = Number(el.value) || 1; return render(); }
    if (el.hasAttribute('data-attnote') && !canRecordAtt()) return;
    if (el.id === 'att-cls') {
      if (!leaveAttDraft()) { el.value = a.cls; return; }
      a.draft = {};
      a.cls = el.value;
      render();
    } else if (el.id === 'att-day') {
      if (!el.value || !leaveAttDraft()) { el.value = a.day; return; }
      a.draft = {};
      a.day = el.value;
      render();
    } else if (el.id === 'att-exp-month') {
      a.expMonth = el.value;
      render();
    } else if (el.id === 'att-exp-day') {
      if (el.value) a.expDay = el.value;
      render();
    } else if (el.id === 'att-notes') {
      a.dayNote = el.value;
    } else if (el.id === 'att-from') {
      a.from = el.value;
    } else if (el.id === 'att-to') {
      a.to = el.value;
    } else if (el.hasAttribute('data-attnote')) {
      var sid = el.getAttribute('data-attnote');
      a.draft[sid] = { status: attOf(sid).status, note: el.value };
      render();
    }
  });

