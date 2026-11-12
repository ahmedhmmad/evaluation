'use strict';
  /* ---------- التقارير: كشف وإحصائية حسب المتغيرات ----------
     يختار المستخدم من يشملهم التقرير، وشروطًا على أي حقل (الصف، الجنس، لديه كتب…)، ومتغيرًا أو اثنين للإحصائية،
     وأعمدة الكشف. يُطبع (PDF) ويُصدَّر (Excel) بما يظهر على الشاشة */

  var REP_SCOPES = { enrolled: 'المسجَّلون (نهائي واحتياط)', final: 'التسجيل النهائي', reserve: 'الاحتياط', pending: 'التسجيل المبدئي', all: 'كل الطلاب', bus: 'المضافون إلى باص' };

  // متغيرات دفع المواصلات تُحسب لشهر المواصلات المختار (ui.tMonth، المشترك مع شاشة المواصلات)
  var REP_TPAY = ['_tpay', '_tdue', '_tpaid', '_tleft', '_treceipt', '_tpaidon', '_tmethod', '_tref'];

  // وسيلة دفع الإيصال ورقم الدفع (للإلكتروني)، أو تحديد «أخرى»
  function repPayMethod(rec) { return PAY_METHODS[rec.method] ? rec.method : 'cash'; }
  function repPayRef(rec) { var k = repPayMethod(rec); return k === 'cash' ? '' : String(rec.method_note || '').trim(); }

  // تفصيل الدفعات حسب الرقم المحوَّل إليه («رقم الدفع» في الإيصال: محفظة/حساب الأكاديمية): لكل وسيلة ورقم عدد الدفعات ومجموعها وأسماء الطلاب، ثم مجموع كل وسيلة والمجموع الكلي.
  // يعيد صفوفًا (أولها العناوين) أو [] إن لم يكن في التقرير دفعات
  function repRefAoa(res) {
    if (!repUsesTpay()) return [];
    var groups = {}, byMethod = {}, total = 0, count = 0;
    res.list.forEach(function (x) {
      var t = repTpayOf(x);
      if (!t || !(t.paid > 0)) return;
      // الاسم الأول والعائلة: يكفي للتعرف ويُبقي الجدول قصيرًا
      var nm = splitFamily(x.full_name), short = nm.family ? (nameParts(x.full_name)[0] || '') + ' ' + nm.family : x.full_name;
      payParts(x.id, t.paid).forEach(function (part) {
        var k = part.method, ref = part.ref, key = k + '\u0001' + ref;
        var g = groups[key] || (groups[key] = { k: k, ref: ref, n: 0, sum: 0, names: [] });
        g.n++; g.sum += part.amount;
        if (g.names.indexOf(short) < 0) g.names.push(short);
        byMethod[k] = byMethod[k] || { n: 0, sum: 0 };
        byMethod[k].n++; byMethod[k].sum += part.amount;
        total += part.amount; count++;
      });
    });
    if (!count) return [];
    var order = Object.keys(PAY_METHODS);
    var rows = Object.keys(groups).map(function (key) { return groups[key]; }).sort(function (a, b) {
      return order.indexOf(a.k) - order.indexOf(b.k) || b.sum - a.sum || a.ref.localeCompare(b.ref);
    }).map(function (g) {
      var refText = g.k === 'cash' ? '—' : g.ref || (hasPayRef(g.k) ? '(بلا رقم)' : '—');
      return [PAY_METHODS[g.k], refText, g.n, plainNum(g.sum), g.names.join('، ')];
    });
    return [['وسيلة الدفع', 'الرقم المحوَّل إليه', 'عدد الدفعات', 'المجموع (ج.م)', 'الطلاب']].concat(rows, [['المجموع الكلي', '', count, plainNum(total), '']]);
  }

  // مجموع الدفعات حسب وسيلة الدفع: نقدًا، إنستاباي، فودافون كاش، أخرى (كلها تظهر ولو صفرًا) ثم المجموع
  function repMethodAoa(res) {
    if (!repUsesTpay()) return [];
    var by = {}, total = 0, count = 0;
    Object.keys(PAY_METHODS).forEach(function (k) { by[k] = { n: 0, sum: 0 }; });
    res.list.forEach(function (x) {
      var t = repTpayOf(x);
      if (!t || !(t.paid > 0)) return;
      payParts(x.id, t.paid).forEach(function (part) { by[part.method].n++; by[part.method].sum += part.amount; total += part.amount; count++; });
    });
    if (!count) return [];
    return [['وسيلة الدفع', 'عدد الدفعات', 'المجموع (ج.م)', 'النسبة']].concat(Object.keys(PAY_METHODS).map(function (k) {
      return [PAY_METHODS[k], by[k].n, plainNum(by[k].sum), repPct(by[k].sum, total)];
    }), [['المجموع', count, plainNum(total), '100%']]);
  }

  // جدول بسيط: الصف الأخير مجموع، والأعمدة بعد الأول أرقام في سطر واحد (forPrint: بتنسيق الورقة المطبوعة)
  function repSimpleTable(aoa, forPrint) {
    var nw = ' style="white-space:nowrap"', last = aoa.length - 1;
    return '<table class="' + (forPrint ? 'rz' : 'grid') + '"><thead><tr>' + aoa[0].map(function (h) { return '<th' + nw + '>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      aoa.slice(1).map(function (row, i) {
        return '<tr' + (i + 1 === last ? (forPrint ? ' class="total"' : ' style="font-weight:700"') : '') + '>' + row.map(function (v, j) { return '<td' + (j && forPrint ? ' class="c"' : '') + nw + '>' + esc(v) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }
  var TPAY_ORDER = ['دفع', 'دفع جزئيًا', 'لم يدفع', 'معفى'];

  function repUsesTpay() {
    var r = repState(), used = [r.g1, r.g2].concat(r.cols, r.filters.map(function (f) { return f.k; }));
    return r.scope === 'bus' || used.some(function (k) { return REP_TPAY.indexOf(k) > -1; });
  }

  // حالة دفع طالب في باص عن شهر المواصلات: { state, due, paid, rec } أو null لغير المضاف إلى باص
  function repTpayOf(x) {
    var m = memberOf(x.id);
    if (!m || !findGroup(m.group_id)) return null;
    var rec = (S.tPay[ui.tMonth] || {})[x.id] || {}, paid = rec.amount || 0;
    if (exemptIn(m, ui.tMonth)) return { state: 'معفى', due: 0, paid: paid, rec: rec };
    var due = shareOf(m);
    return { state: paid > 0 && paid >= due ? 'دفع' : paid > 0 ? 'دفع جزئيًا' : 'لم يدفع', due: due, paid: paid, rec: rec };
  }

  // يوم اعتماد التسجيل النهائي (لمن لم يُعتمد بعد: لا يوم)
  function repRegDay(x) { return stStatus(x) === 'final' && x.finalized_at ? String(x.finalized_at).slice(0, 10) : ''; }

  function repState() {
    if (!ui.rep) ui.rep = { scope: 'enrolled', filters: [], g1: 'class_name', g2: 'gender', cols: ['full_name', 'national_id', 'class_name', 'gender'], title: '' };
    return ui.rep;
  }

  // كل المتغيرات: حقول ملف الطالب ومعها حقول محسوبة (الحالة، المواصلات، الباص، العمر)
  function repFields() {
    var groupOf = transportGroupOf(), start = schoolYearStart();
    var fmt = function (v, f) {
      if (v == null || v === '') return '';
      if (f && f.type === 'date') return dmy(v);
      if (v === true) return 'نعم';
      if (v === false) return 'لا';
      if (Array.isArray(v)) return v.join('، ');
      return String(v).trim();
    };
    var out = [
      { k: '_status', label: 'حالة التسجيل', cat: true, get: function (x) { return ST_STATUS[stStatus(x)]; } },
      { k: '_ride', label: 'المواصلات', cat: true, get: function (x) { return groupOf[x.id] || x.wants_transport === true ? 'يحتاج' : x.wants_transport === false ? 'لا يحتاج' : 'لم يُحدَّد'; } },
      { k: '_bus', label: 'الباص', cat: true, get: function (x) { var g = findGroup(groupOf[x.id]); return g ? g.assembly_point : ''; } },
      { k: '_tpay', label: 'دفع المواصلات', cat: true, order: TPAY_ORDER, get: function (x) { var t = repTpayOf(x); return t ? t.state : ''; } },
      { k: '_tdue', label: 'المطلوب', get: function (x) { var t = repTpayOf(x); return t ? (t.state === 'معفى' ? '—' : plainNum(t.due)) : ''; } },
      { k: '_tpaid', label: 'المدفوع', get: function (x) { var t = repTpayOf(x); return t ? plainNum(t.paid) : ''; } },
      { k: '_tleft', label: 'المتبقي', get: function (x) { var t = repTpayOf(x); return t ? (t.state === 'معفى' ? '—' : plainNum(Math.max(0, t.due - t.paid))) : ''; } },
      { k: '_treceipt', label: 'رقم الإيصال', get: function (x) { var t = repTpayOf(x); return t && t.paid > 0 && t.rec.receipt_no != null ? String(t.rec.receipt_no) : ''; } },
      { k: '_tpaidon', label: 'تاريخ الدفع', get: function (x) { var t = repTpayOf(x); return t && t.paid > 0 && t.rec.paid_on ? dmy(t.rec.paid_on) : ''; } },
      { k: '_tmethod', label: 'وسيلة الدفع', cat: true, get: function (x) { var t = repTpayOf(x); return t && t.paid > 0 ? PAY_METHODS[repPayMethod(t.rec)] : ''; } },
      { k: '_tref', label: 'الرقم المحوَّل إليه', get: function (x) { var t = repTpayOf(x); return t && t.paid > 0 ? repPayRef(t.rec) : ''; } },
      { k: '_regdate', label: 'تاريخ التسجيل النهائي', get: function (x) { var d = repRegDay(x); return d ? dmy(d) : ''; } },
      { k: '_age', label: 'العمر عند بداية العام', cat: true, get: function (x) {
        if (!x.birth_date) return '';
        var a = Math.floor((start - new Date(String(x.birth_date).slice(0, 10) + 'T00:00')) / (365.25 * 864e5));
        return a >= 0 && a < 40 ? a + ' سنوات' : '';
      } }
    ];
    ST_FIELDS.forEach(function (f) {
      out.push({ k: f.k, label: f.p || f.label, f: f, cat: !!(f.options || f.list || f.type === 'select' || f.type === 'class'), get: function (x) { return fmt(stVal(x, f.k), f); } });
    });
    return out;
  }

  function repField(k, fields) { for (var i = 0; i < fields.length; i++) if (fields[i].k === k) return fields[i]; return null; }

  function repScoped() {
    var r = repState();
    return S.students.filter(function (x) {
      var st = stStatus(x);
      if (r.scope === 'bus') {
        // كما في كشف الباص: المسجَّل (نهائي أو احتياط) المضاف إلى باص، ما لم يُوقَف اشتراكه قبل الشهر
        var m = memberOf(x.id);
        return !!m && !!findGroup(m.group_id) && enrolled(x) && (owesThisMonth(m) || subscribedIn(m, ui.tMonth));
      }
      return r.scope === 'all' || (r.scope === 'enrolled' ? enrolled(x) : st === r.scope);
    });
  }

  // القيم الموجودة لحقل بين الطلاب، مرتبة (الشعب بترتيب الصفوف)
  function repValues(fd, list) {
    var seen = {};
    list.forEach(function (x) { var v = fd.get(x); seen[v] = (seen[v] || 0) + 1; });
    var vals = Object.keys(seen);
    if (fd.k === 'class_name') vals.sort(function (a, b) { return classRank(a) - classRank(b) || a.localeCompare(b, 'ar'); });
    else if (fd.f && fd.f.options) vals.sort(function (a, b) { var i = fd.f.options.indexOf(a), j = fd.f.options.indexOf(b); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.localeCompare(b, 'ar'); });
    else if (fd.order) vals.sort(function (a, b) { return (fd.order.indexOf(a) + 1 || 99) - (fd.order.indexOf(b) + 1 || 99); });
    else if (fd.k === '_age') vals.sort(function (a, b) { return (parseInt(a, 10) || 999) - (parseInt(b, 10) || 999); });
    else vals.sort(function (a, b) { return seen[b] - seen[a] || a.localeCompare(b, 'ar'); });
    // الفارغ آخرًا
    var e = vals.indexOf('');
    if (e > -1) { vals.splice(e, 1); vals.push(''); }
    return vals;
  }

  // المتغيرات الصالحة للتصفية والإحصائية: ذات خيارات، أو قيمها المختلفة قليلة
  function repCatFields(fields, list) {
    return fields.filter(function (fd) {
      if (fd.cat) return true;
      var seen = {}, n = 0;
      for (var i = 0; i < list.length && n <= 25; i++) { var v = fd.get(list[i]); if (!seen[v]) { seen[v] = 1; n++; } }
      return n > 1 && n <= 25;
    });
  }

  function repResult() {
    var r = repState(), fields = repFields(), list = repScoped();
    if (r.regFrom || r.regTo) list = list.filter(function (x) { var d = repRegDay(x); return d && (!r.regFrom || d >= r.regFrom) && (!r.regTo || d <= r.regTo); });
    r.filters.forEach(function (fl) {
      var fd = repField(fl.k, fields);
      if (fd && fl.v != null) list = list.filter(function (x) { return fd.get(x) === fl.v; });
    });
    list = list.slice().sort(function (a, b) { return classRank(a.class_name) - classRank(b.class_name) || String(a.class_name || '').localeCompare(String(b.class_name || ''), 'ar') || a.full_name.localeCompare(b.full_name, 'ar'); });
    var g1 = repField(r.g1, fields), g2 = r.g2 && r.g2 !== r.g1 ? repField(r.g2, fields) : null;
    var stats = null;
    if (g1) {
      var rows = repValues(g1, list), cols = g2 ? repValues(g2, list) : [], cell = {}, rowT = {}, colT = {};
      list.forEach(function (x) {
        var a = g1.get(x), b = g2 ? g2.get(x) : '';
        cell[a + '\u0001' + b] = (cell[a + '\u0001' + b] || 0) + 1;
        rowT[a] = (rowT[a] || 0) + 1;
        colT[b] = (colT[b] || 0) + 1;
      });
      stats = { g1: g1, g2: g2, rows: rows, cols: cols, cell: cell, rowT: rowT, colT: colT };
    }
    return { fields: fields, list: list, stats: stats };
  }

  function repDesc(res) {
    var r = repState(), parts = [['يشمل', REP_SCOPES[r.scope]]];
    if (repUsesTpay()) parts.push(['شهر المواصلات', tLabel(ui.tMonth)]);
    if (r.regFrom || r.regTo) parts.push(['التسجيل النهائي', (r.regFrom ? 'من ' + dmy(r.regFrom) : '') + (r.regFrom && r.regTo ? ' ' : '') + (r.regTo ? 'إلى ' + dmy(r.regTo) : '')]);
    r.filters.forEach(function (fl) {
      var fd = repField(fl.k, res.fields);
      if (fd && fl.v != null) parts.push([fd.label, fl.v === '' ? '(فارغ)' : fl.v]);
    });
    return parts;
  }

  // أعمدة أرقام لا تنقسم على سطرين
  function repNoWrap(k) {
    return ['national_id', 'guardian_id', 'phone', 'alt_phone', 'whatsapp', 'student_phone', 'birth_date', '_regdate', '_age', '_tdue', '_tpaid', '_tleft', '_treceipt', '_tpaidon', '_tmethod', '_tref'].indexOf(k) > -1;
  }

  function repStatHeadNw(h) { return h === 'العدد' || h === 'المجموع' || h === 'النسبة'; }

  function repPct(n, total) { return total ? Math.round(n / total * 1000) / 10 + '%' : '—'; }

  // جدول الإحصائية: صفوف المتغير الأول، وأعمدة الثاني (أو العدد والنسبة)
  function repStatsAoa(res) {
    var a = repStatsAoa0(res), i = a.length ? a[0].indexOf('النسبة') : -1;
    if (repState().noPct && i > -1) a = a.map(function (row) { return row.filter(function (v, j) { return j !== i; }); });
    return a;
  }
  function repStatsAoa0(res) {
    var s = res.stats, total = res.list.length, show = function (v) { return v === '' ? '(فارغ)' : v; };
    if (!s) return [];
    if (!s.g2) {
      return [[s.g1.label, 'العدد', 'النسبة']].concat(s.rows.map(function (v) { return [show(v), s.rowT[v] || 0, repPct(s.rowT[v] || 0, total)]; }), [['المجموع', total, total ? '100%' : '']]);
    }
    return [[s.g1.label + ' × ' + s.g2.label].concat(s.cols.map(show), ['المجموع', 'النسبة'])].concat(s.rows.map(function (v) {
      return [show(v)].concat(s.cols.map(function (c) { return s.cell[v + '\u0001' + c] || 0; }), [s.rowT[v] || 0, repPct(s.rowT[v] || 0, total)]);
    }), [['المجموع'].concat(s.cols.map(function (c) { return s.colT[c] || 0; }), [total, total ? '100%' : ''])]);
  }

  function renderReports() {
    if (!ui.tMonth) ui.tMonth = currentCycle();
    // دفعات شهر المواصلات تُجلب أولًا إن كان التقرير يستعملها
    if (repUsesTpay() && !S.tPay[ui.tMonth]) {
      app.innerHTML = tabs('reports') + '<div class="card empty">جارٍ تحميل دفعات المواصلات…</div>';
      loadPayments(ui.tMonth);
      return;
    }
    var r = repState(), res = repResult(), scoped = repScoped(), cats = repCatFields(res.fields, scoped);
    var opt = function (v, label, cur) { return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(label) + '</option>'; };
    var fieldSel = function (id, cur, none) {
      return '<select id="' + id + '" data-ro-ok style="width:auto;max-width:260px">' + (none ? opt('', none, cur) : '') + cats.map(function (fd) { return opt(fd.k, fd.label, cur); }).join('') + '</select>';
    };
    var filters = r.filters.map(function (fl, i) {
      var fd = repField(fl.k, res.fields), vals = fd ? repValues(fd, scoped) : [];
      return '<div class="toolbar" style="align-items:center;margin:6px 0">' +
        '<select data-repfk="' + i + '" data-ro-ok style="width:auto;max-width:260px">' + cats.map(function (c) { return opt(c.k, c.label, fl.k); }).join('') + '</select>' +
        '<span>=</span><select data-repfv="' + i + '" data-ro-ok style="width:auto;min-width:160px">' + opt('\u0000', '— اختر —', fl.v == null ? '\u0000' : fl.v) +
          vals.map(function (v) { return opt(v, v === '' ? '(فارغ)' : v, fl.v); }).join('') + '</select>' +
        '<button type="button" class="btn" data-repdelf="' + i + '" data-ro-ok title="حذف الشرط">×</button></div>';
    }).join('');
    var aoa = repStatsAoa(res), s = res.stats;
    // الأعداد والنسب وعناوين «العدد/المجموع/النسبة» في سطر واحد
    var statsHtml = aoa.length ? '<div class="table-wrap"><table class="grid"><thead><tr>' + aoa[0].map(function (h) { return '<th' + (repStatHeadNw(h) ? ' style="white-space:nowrap"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      aoa.slice(1, -1).map(function (row) { return '<tr>' + row.map(function (v, j) { return j ? '<td style="white-space:nowrap">' + esc(v) + '</td>' : '<td><b>' + esc(v) + '</b></td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody><tfoot><tr>' + aoa[aoa.length - 1].map(function (v, j) { return '<td' + (j ? ' style="white-space:nowrap"' : '') + '>' + esc(v) + '</td>'; }).join('') + '</tr></tfoot></table></div>' : '';
    var cols = r.cols.map(function (k) { return repField(k, res.fields); }).filter(Boolean), LIMIT = 300;
    var listHtml = res.list.length ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th>' + cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      res.list.slice(0, LIMIT).map(function (x, i) {
        return '<tr><td style="white-space:nowrap">' + (i + 1) + '</td>' + cols.map(function (c) { return '<td' + (repNoWrap(c.k) ? ' style="white-space:nowrap"' : '') + '>' + esc(c.get(x)) + (c.k === 'full_name' ? rsvMark(x) : '') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' + (res.list.length > LIMIT ? '<p class="st-count">يُعرض أول ' + LIMIT + ' من ' + res.list.length + '؛ الطباعة والتصدير يشملان الجميع.</p>' : '')
      : '<div class="empty">لا يوجد طلاب مطابقون.</div>';
    var repTab = vtab('rep', 'stats');
    app.innerHTML = tabs('reports') +
      '<div class="card"><h2>التقرير</h2>' +
        '<div class="toolbar" style="align-items:center">' +
          '<label class="field" for="rep-scope" style="margin:0">يشمل</label><select id="rep-scope" data-ro-ok style="width:auto">' + Object.keys(REP_SCOPES).map(function (k) { return opt(k, REP_SCOPES[k], r.scope); }).join('') + '</select>' +
          (repUsesTpay() ? '<label class="field" for="rep-month" style="margin:0">دورة المواصلات (شهر بدايتها)</label><input type="month" id="rep-month" data-ro-ok value="' + ui.tMonth + '" style="width:auto">' : '') +
          '<label class="field" for="rep-regfrom" style="margin:0" title="يقتصر التقرير على من اعتُمد تسجيلهم النهائي في هذه الفترة">التسجيل النهائي من</label><input type="date" id="rep-regfrom" data-ro-ok value="' + esc(r.regFrom || '') + '" style="width:auto">' +
          '<label class="field" for="rep-regto" style="margin:0">إلى</label><input type="date" id="rep-regto" data-ro-ok value="' + esc(r.regTo || '') + '" style="width:auto">' +
          '<input type="text" id="rep-title" data-ro-ok placeholder="عنوان التقرير (اختياري)" value="' + esc(r.title) + '" style="flex:1;min-width:200px"></div>' +
          '<div class="toolbar" style="align-items:center;margin-top:8px"><span class="hint" style="margin:0">تقارير جاهزة:</span>' +
          '<button type="button" class="btn" data-reppreset="tpay" data-ro-ok>دفع رسوم المواصلات (المضافون إلى باص)</button></div>' +
        '<h3 style="margin:14px 0 4px">الشروط</h3>' + (filters || '<p class="hint" style="margin:0">بلا شروط: كل من يشملهم التقرير.</p>') +
        '<button type="button" class="btn" data-repaddf data-ro-ok>+ إضافة شرط</button>' +
        '<h3 style="margin:14px 0 4px">الإحصائية</h3>' +
        '<div class="toolbar" style="align-items:center"><span>حسب</span>' + fieldSel('rep-g1', r.g1, 'بلا إحصائية') + '<span>ثم حسب</span>' + fieldSel('rep-g2', r.g2, '— متغير واحد —') +
          '<label class="check" style="margin:0"><input type="checkbox" id="rep-pct" data-ro-ok' + (r.noPct ? '' : ' checked') + '> إظهار النسبة</label></div>' +
        '<details class="bank" style="margin-top:10px"><summary>أعمدة الكشف (' + cols.length + ')</summary><div class="classes-pick" style="margin-top:8px">' + res.fields.map(function (fd) {
          return '<label class="check"><input type="checkbox" data-repcol="' + fd.k + '" data-ro-ok' + (r.cols.indexOf(fd.k) > -1 ? ' checked' : '') + '>' + esc(fd.label) + '</label>';
        }).join('') + '</div></details>' +
        '<div class="toolbar" style="margin-top:12px"><button type="button" class="btn primary" data-reppdf data-ro-ok>طباعة / PDF</button><button type="button" class="btn" data-repxlsx data-ro-ok>تصدير Excel</button></div></div>' +
      '<div class="stats"><div class="card stat"><span class="lbl">عدد الطلاب</span><span class="num">' + res.list.length + '</span><span class="sub">' + esc(repDesc(res).map(function (p) { return p[1]; }).join(' · ')) + '</span></div></div>' +
      (statsHtml ? vtabsHtml('rep', 'stats', [['stats', 'الإحصائية'], ['list', 'الكشف', res.list.length]]) : '') +
      (statsHtml && repTab === 'stats' ? '<div class="card"><h2>الإحصائية' + (s ? ' — ' + esc(s.g1.label) + (s.g2 ? ' × ' + esc(s.g2.label) : '') : '') + '</h2>' + statsHtml + '</div>' : '') +
      (!statsHtml || repTab === 'list' ? '<div class="card"><h2>الكشف (' + res.list.length + ')</h2>' + listHtml + '</div>' : '') + repRefHtml(res);
  }

  function repRefHtml(res) {
    var ma = repMethodAoa(res), ra = repRefAoa(res), n = ra.length;
    if (!n) return '';
    var methodsCard = '<div class="card"><h2>مجموع الدفعات حسب وسيلة الدفع</h2><div class="table-wrap">' + repSimpleTable(ma) + '</div></div>';
    var methods = Object.keys(PAY_METHODS).length, nw = ' style="white-space:nowrap"';
    return methodsCard + '<div class="card"><h2>تفصيل الدفعات حسب الرقم المحوَّل إليه</h2><div class="table-wrap"><table class="grid"><thead><tr>' + ra[0].map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      ra.slice(1).map(function (row) {
        var sum = row[0] === 'المجموع الكلي';
        return '<tr' + (sum ? ' style="font-weight:700"' : '') + '><td' + nw + '>' + esc(row[0]) + '</td><td dir="ltr"' + nw + '>' + esc(row[1]) + '</td><td' + nw + '>' + row[2] + '</td><td' + nw + '>' + esc(row[3]) + '</td><td>' + esc(row[4]) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  async function exportRepXlsx() {
    if (!(await syncData(true))) return;
    var r = repState(), res = repResult();
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new(), title = r.title || 'تقرير الطلاب';
      wb.Workbook = { Views: [{ RTL: true }] };
      var head = [[schoolName()], [title + ' — ' + dmy(todayISO())]].concat(repDesc(res).map(function (p) { return [p[0] + ': ' + p[1]]; }), [['عدد الطلاب: ' + res.list.length], []]);
      var st = repStatsAoa(res);
      if (st.length) {
        var ws1 = XLSX.utils.aoa_to_sheet(head.concat(st));
        ws1['!cols'] = [{ wch: 26 }].concat(st[0].slice(1).map(function () { return { wch: 12 }; }));
        XLSX.utils.book_append_sheet(wb, ws1, 'الإحصائية');
      }
      var cols = r.cols.map(function (k) { return repField(k, res.fields); }).filter(Boolean);
      var ma = repMethodAoa(res), ra = repRefAoa(res);
      // تحت الكشف في الورقة نفسها: المجموع حسب وسيلة الدفع، ثم التفصيل حسب الرقم المحوَّل إليه
      // المبالغ أرقامًا لا نصوصًا («1,400» ← 1400) حتى يجمعها Excel؛ الهواتف وأرقام الهوية تبقى نصًّا
      var xlNum = function (aoa) { return aoa.map(function (row) { return row.map(function (v) { return typeof v === 'string' && /^\d{1,3}(,\d{3})*(\.\d+)?$/.test(v) ? Number(v.replace(/,/g, '')) : v; }); }); };
      ma = xlNum(ma); ra = xlNum(ra);
      var tail = ma.length ? [[], ['مجموع الدفعات حسب وسيلة الدفع']].concat(ma, [[], ['تفصيل الدفعات حسب الرقم المحوَّل إليه']], ra) : [];
      var ws2 = XLSX.utils.aoa_to_sheet(head.concat([['م'].concat(cols.map(function (c) { return c.label; }))], res.list.map(function (x, i) {
        return [i + 1].concat(xlNum([cols.map(function (c) { return c.get(x) + (c.k === 'full_name' ? rsvText(x) : ''); })])[0]);
      }), tail));
      ws2['!cols'] = [{ wch: 5 }].concat(cols.map(function (c) { return { wch: c.k === 'full_name' ? 32 : c.k === 'address' ? 40 : 16 }; }));
      XLSX.utils.book_append_sheet(wb, ws2, 'الكشف');
      if (ma.length) {
        var wsM = XLSX.utils.aoa_to_sheet(head.concat(ma));
        wsM['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(wb, wsM, 'حسب وسيلة الدفع');
      }
      if (ra.length) {
        var ws3 = XLSX.utils.aoa_to_sheet(head.concat(ra));
        ws3['!cols'] = [{ wch: 18 }, { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 60 }];
        XLSX.utils.book_append_sheet(wb, ws3, 'حسب الرقم المحول إليه');
      }
      XLSX.writeFile(wb, (title + '-' + todayISO()).replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, '-') + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  var pendingRep = false;

  // الطباعة: رأس التقرير والإحصائية، ثم الكشف على صفحات متتالية يتكرر رأس جدوله
  function buildRepSheet() {
    var r = repState(), res = repResult(), st = repStatsAoa(res), title = r.title || 'تقرير الطلاب';
    var cols = r.cols.map(function (k) { return repField(k, res.fields); }).filter(Boolean), n = cols.length + 1;
    var head = reportHead(esc(title), repDesc(res).concat([['عدد الطلاب', res.list.length]])).replace(/^<img class="wm"[^>]*>/, '');
    var statsTable = st.length ? '<table class="rz" style="margin-bottom:1em"><thead><tr><td class="pg-space" colspan="' + st[0].length + '"></td></tr>' +
      '<tr><td class="ls-head" colspan="' + st[0].length + '">' + head + '<div class="rsec">الإحصائية' + (res.stats ? ': ' + esc(res.stats.g1.label) + (res.stats.g2 ? ' × ' + esc(res.stats.g2.label) : '') : '') + '</div></td></tr>' +
      '<tr>' + st[0].map(function (h) { return '<th' + (repStatHeadNw(h) ? ' style="white-space:nowrap"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      st.slice(1, -1).map(function (row) { return '<tr>' + row.map(function (v, j) { return '<td' + (j ? ' class="c" style="white-space:nowrap"' : '') + '>' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '<tr class="total">' + st[st.length - 1].map(function (v, j) { return '<td' + (j ? ' class="c" style="white-space:nowrap"' : '') + '>' + esc(v) + '</td>'; }).join('') + '</tr></tbody></table>' : '';
    var listTable = '<table class="rz' + (st.length ? ' newpage' : '') + '"><thead><tr><td class="pg-space" colspan="' + n + '"></td></tr>' +
      (st.length ? '' : '<tr><td class="ls-head" colspan="' + n + '">' + head + '</td></tr>') +
      '<tr><th style="white-space:nowrap;padding-inline:.25em">م</th>' + cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      res.list.map(function (x, i) {
        // كل قيمة قصيرة (الترقيم والأسماء والشعبة والباص والأرقام والمبالغ) في سطر واحد؛ النص الطويل كالعنوان وحده يلتف.
        // يُصغَّر الخط بعدها حتى يتسع الجدول في عرض الورقة
        return '<tr><td class="c" style="white-space:nowrap;padding-inline:.25em">' + (i + 1) + '</td>' + cols.map(function (c) {
          var v = c.get(x);
          return '<td' + (c.k === 'full_name' || c.k === 'address' ? '' : ' class="c"') + (repNoWrap(c.k) || String(v).length <= 30 ? ' style="white-space:nowrap"' : '') + '>' + esc(v) + (c.k === 'full_name' ? rsvMark(x) : '') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody><tfoot><tr><td class="pg-space" colspan="' + n + '"></td></tr></tfoot></table>';
    sheet.className = 'ls';
    sheet.removeAttribute('data-fit');
    sheet.style.fontSize = '';
    // في نهاية التقرير: تفصيل الدفعات حسب الرقم المحوَّل إليه
    var ra = repRefAoa(res), ma = repMethodAoa(res), nw = ' style="white-space:nowrap"';
    var refTable = ra.length ? '<div class="rsec" style="margin-top:1em">مجموع الدفعات حسب وسيلة الدفع</div>' + repSimpleTable(ma, true) +
      '<div class="rsec" style="margin-top:1em">تفصيل الدفعات حسب الرقم المحوَّل إليه</div><table class="rz"><thead><tr>' + ra[0].map(function (h) { return '<th' + nw + '>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      ra.slice(1).map(function (row) {
        var sum = row[0] === 'المجموع الكلي';
        return '<tr' + (sum ? ' class="total"' : '') + '><td' + nw + '>' + esc(row[0]) + '</td><td class="c" dir="ltr"' + nw + '>' + esc(row[1]) + '</td><td class="c"' + nw + '>' + row[2] + '</td><td class="c"' + nw + '>' + esc(row[3]) + '</td><td>' + esc(row[4]) + '</td></tr>';
      }).join('') + '</tbody></table>' : '';
    sheet.innerHTML = '<img class="wm" src="' + REPORT.logo + '" alt="">' + statsTable + (res.list.length ? listTable : '') + refTable;
  }

  app.addEventListener('click', function (e) {
    if (location.hash !== '#/reports' || !canStudents()) return;
    var el, r = repState();
    if ((el = e.target.closest('[data-reppreset]'))) {
      // من دفع ومن لم يدفع عن الشهر، من المضافين إلى باص فقط: إحصائية حسب الحالة والباص، والكشف بالمبالغ
      ui.rep = { scope: 'bus', filters: [], g1: '_tpay', g2: '_bus', cols: ['full_name', 'class_name', 'phone', '_bus', '_tpay', '_tdue', '_tpaid', '_tleft', '_treceipt', '_tmethod', '_tref'], title: 'دفع رسوم المواصلات' };
      render();
    } else if (e.target.closest('[data-repaddf]')) {
      var fields = repFields(), cats = repCatFields(fields, repScoped()), used = r.filters.map(function (f) { return f.k; });
      var next = cats.filter(function (fd) { return used.indexOf(fd.k) < 0; })[0];
      if (next) r.filters.push({ k: next.k, v: null });
      render();
    } else if ((el = e.target.closest('[data-repdelf]'))) {
      r.filters.splice(Number(el.getAttribute('data-repdelf')), 1);
      render();
    } else if (e.target.closest('[data-repxlsx]')) {
      exportRepXlsx();
    } else if (e.target.closest('[data-reppdf]')) {
      syncData(true).then(function (ok) { if (ok) { pendingRep = true; printNow(); } });
    }
  });

  app.addEventListener('change', function (e) {
    if (location.hash !== '#/reports' || !canStudents()) return;
    var el = e.target, r = repState();
    if (el.id === 'rep-scope') r.scope = el.value;
    else if (el.id === 'rep-month') { if (!/^\d{4}-\d{2}$/.test(el.value)) return; ui.tMonth = el.value; }
    else if (el.id === 'rep-title') { r.title = el.value.trim(); return; }
    else if (el.id === 'rep-g1') r.g1 = el.value;
    else if (el.id === 'rep-pct') r.noPct = !el.checked;
    else if (el.id === 'rep-g2') r.g2 = el.value;
    else if (el.id === 'rep-regfrom' || el.id === 'rep-regto') { r[el.id === 'rep-regfrom' ? 'regFrom' : 'regTo'] = el.value; }
    else if (el.hasAttribute('data-repfk')) { var f = r.filters[Number(el.getAttribute('data-repfk'))]; f.k = el.value; f.v = null; }
    else if (el.hasAttribute('data-repfv')) { r.filters[Number(el.getAttribute('data-repfv'))].v = el.value === '\u0000' ? null : el.value; }
    else if (el.hasAttribute('data-repcol')) {
      var k = el.getAttribute('data-repcol'), i = r.cols.indexOf(k);
      if (el.checked && i < 0) {
        // بترتيب الحقول في ملف الطالب
        var order = repFields().map(function (fd) { return fd.k; });
        r.cols.push(k);
        r.cols.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
      } else if (!el.checked && i > -1) r.cols.splice(i, 1);
      var open = el.closest('details') && el.closest('details').open;
      render();
      if (open) { var d = app.querySelector('details.bank'); if (d) d.open = true; }
      return;
    } else return;
    render();
  });

  /* ---------- وضع المشاهدة (المدير) ----------
     تُخفى أزرار التعديل وتُقفل خانات الإدخال، وتبقى التصفية والبحث والعرض والطباعة والتصدير.
     الحماية الفعلية في القاعدة: لا يملك المدير صلاحية كتابة على أي جدول */
  var VIEW_ACTIONS = ['act', 'alcopy', 'attcls', 'attdayxlsx', 'attrepxlsx', 'attrun', 'attschoolpdf', 'attteacher', 'attview', 'attregister', 'attschool',
    'busprint', 'cprint', 'cprofile', 'cedit', 'checkclose', 'checkopen', 'checksev', 'checkxlsx', 'latestate', 'latexlsx', 'mreceipt', 'mdesk', 'rcfind', 'rcpick',
    'regbook', 'rfprint', 'rfxlsx', 'stprint', 'stprofile', 'ststatus', 'stxlsx', 'stedit', 'tedit', 'tgo', 'tpclass', 'tpstatus', 'tpx', 'voidxlsx', 'staffcat',
    'open', 'openv', 'backup', 'excancel', 'scanclose', 'sibfixclose', 'impcancel', 'staffimpcancel'];
  var VIEW_ACTS = ['back', 'print', 'reload', 'signout', 'sync', 'auth-mode'];
  var VIEW_INPUTS = ['tp-class', 'tp-search', 't-month', 't-search', 'att-cls', 'att-day', 'att-from', 'att-to', 'att-exp-month', 'att-exp-day', 'cls-search', 'rc-id', 'st-class'];

  var REG_T_BLOCK = '[data-mrefund],[data-rcrefund],[data-rfsave],[data-mvoid],[data-mexempt],[data-exsave],[data-exdel],[data-suspend],[data-unsuspend],[data-gracegive],' +
    '[data-suspendall],[data-mstop],[data-mresume],[data-gedit],[data-gdel],[data-clopen],[data-rcstaff],[data-sdesk],[data-sadd],[data-sdel],[data-sjoin],[data-svoid],[data-sexempt],' +
    '[data-tgo="#/transport/refunds"],[data-tgo="#/transport/archive"]';
  var REG_T_IDS = ['fee-first', 'fee-next', 'fee-due', 'cyc-start', 'cyc-grace'];
  var REG_T_INPUTS = '[data-cyc],[data-mpaid],[data-mmethod],[data-mnote],[data-mshare],[data-spickup]';
  function applyRegistrarTransport(root) {
    root.querySelectorAll(REG_T_BLOCK).forEach(function (b) { b.style.display = 'none'; });
    root.querySelectorAll(REG_T_INPUTS).forEach(function (el) { el.disabled = true; });
    REG_T_IDS.forEach(function (id) { var el = document.getElementById(id); if (el) el.disabled = true; });
  }
  var regPending = false;
  new MutationObserver(function () {
    if (!isRegistrar() || regPending || !/^#\/transport/.test(location.hash)) return;
    regPending = true;
    Promise.resolve().then(function () { regPending = false; applyRegistrarTransport(app); });
  }).observe(app, { childList: true, subtree: true });

  function applyReadOnly(root) {
    Array.prototype.forEach.call(root.querySelectorAll('button, a.btn'), function (b) {
      if (b.closest('#userbar') || b.hasAttribute('data-ro-ok') || (b.hasAttribute('data-ro-mgr') && !isReadOnly())) return;
      var ok = b.getAttribute('type') !== 'submit' && b.tagName === 'BUTTON' && !b.classList.contains('danger') && Array.prototype.some.call(b.attributes, function (at) {
        var k = at.name.slice(5);
        if (at.name.indexOf('data-') !== 0 || VIEW_ACTIONS.indexOf(k) < 0) return false;
        if (k === 'act') return VIEW_ACTS.indexOf(at.value) > -1;
        if ((k === 'stedit' || k === 'tedit') && at.value === 'new') return false;
        return true;
      });
      if (b.tagName === 'A' || b.matches('.pills button, nav button')) ok = true;
      if (!ok) b.style.display = 'none';
      else if (/^تعديل/.test(b.textContent.trim()) && (b.hasAttribute('data-stedit') || b.hasAttribute('data-tedit') || b.hasAttribute('data-cedit'))) b.textContent = 'عرض';
    });
    Array.prototype.forEach.call(root.querySelectorAll('input, select, textarea'), function (el) {
      if (el.type === 'search' || el.type === 'hidden' || VIEW_INPUTS.indexOf(el.id) > -1 || el.hasAttribute('data-ro-ok') || (el.hasAttribute('data-ro-mgr') && !isReadOnly()) || el.closest('#userbar')) return;
      el.disabled = true;
    });
  }

  var roPending = false;
  new MutationObserver(function () {
    // شاشة تغيير كلمة المرور (أول دخول) وشاشة الدخول ليستا من الشاشات المقفلة
    if (!(isManager() || supViewPage()) || roPending || !S.ready || (S.profile && S.profile.must_change_password) || location.hash === '#/signatures') return;
    roPending = true;
    Promise.resolve().then(function () { roPending = false; applyReadOnly(app); });
  }).observe(app, { childList: true, subtree: true });

  function go(hash) {
    ui.error = '';
    if (location.hash === hash) render(); else location.hash = hash;
  }

  async function setStatus(t, status) {
    var prev = { status: t.status, approved_at: t.approved_at, published_at: t.published_at };
    t.status = status;
    if (status === 'approved') t.approved_at = new Date().toISOString();
    if (status === 'published') t.published_at = new Date().toISOString();
    if (status === 'edit') { t.approved_at = null; t.published_at = null; }
    ui.error = '';
    await flush();
    if (!(await saveNow(t))) Object.assign(t, prev);
    render();
    window.scrollTo(0, 0);
  }

  var prevHash = location.hash;
  window.addEventListener('hashchange', function () {
    // الدخول إلى الرواتب من صفحة أخرى: تُقرأ الرواتب وصلاحية الحساب من جديد
    if (/^#\/pay(roll|run)$/.test(location.hash) && !/^#\/pay(roll|run)$/.test(prevHash)) { S.pr = null; S.prAtt = null; }
    prevHash = location.hash;
    closeMenu();
    ui.error = '';
    flush();
    if (location.hash === '#/results') S.results = null;
    render();
    window.scrollTo(0, 0);
  });

