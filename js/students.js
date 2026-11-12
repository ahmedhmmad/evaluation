'use strict';
  /* ---------- الطلاب (مدير النظام) ---------- */

  // أعمدة استمارة التسجيل المبدئي كما تُستورد من Excel. match: كلمات تُعرَف بها الأعمدة (بعد توحيد الحروف)
  var IMPORT_FIELDS = [
    { k: 'full_name', label: 'اسم الطالب رباعي', req: true, match: ['اسم الطالب'] },
    { k: 'national_id', label: 'رقم هوية الطالب', req: true, ltr: true, num: true, match: ['هويه'] },
    { k: 'gender', label: 'جنس الطالب', type: 'select', options: ['ذكر', 'أنثى'], req: true, match: ['جنس'] },
    { k: 'birth_date', label: 'تاريخ الميلاد', type: 'date', req: true, match: ['الميلاد'] },
    { k: 'phone', label: 'رقم الهاتف الأساسي', req: true, ltr: true, num: true, match: ['الهاتف', 'الجوال'] },
    { k: 'whatsapp', label: 'رقم الواتساب', req: true, ltr: true, num: true, match: ['واتس'] },
    { k: 'email', label: 'البريد الإلكتروني', ltr: true, match: ['email', 'البريد'] },
    { k: 'class_name', label: 'الصف', type: 'class', req: true, match: ['الصف'] },
    { k: 'address', label: 'عنوان السكن الحالي بالتفصيل', req: true, wide: true, match: ['عنوان', 'السكن'] },
    { k: 'has_prev_certificate', label: 'هل حصل على شهادة العام السابق؟', type: 'yn', req: true, match: ['شهاده'] },
    { k: 'prev_grade', label: 'التقدير في العام السابق', dep: 'has_prev_certificate', list: ['ممتاز', 'جيد جدًا', 'جيد', 'مقبول', 'ضعيف'], match: ['التقدير'] },
    { k: 'guardian_name', label: 'اسم ولي الأمر بالكامل', match: ['اسم ولي'] },
    { k: 'guardian_relation', label: 'صلة القرابة بالطالب', match: ['صله', 'القرابه'] },
    { k: 'guardian_job', label: 'مهنة ولي الأمر', match: ['مهنه'] },
    { k: 'has_health_condition', label: 'هل يعاني الطالب من أي حالة صحية؟', type: 'yn', req: true, match: ['صحيه'] },
    { k: 'takes_medication', label: 'هل يتناول الطالب أي أدوية بشكل منتظم؟', type: 'yn', req: true, match: ['ادويه'] },
    { k: 'has_special_needs', label: 'هل لدى الطالب أي احتياجات تعليمية خاصة أو صعوبات في التعلم؟', type: 'yn', req: true, match: ['احتياجات', 'صعوبات'] },
    { k: 'is_orphan', label: 'هل الطفل يتيم؟', type: 'yn', req: true, match: ['يتيم'] },
    { k: 'orphan_of', label: 'في حالة أن الطفل يتيم: يتيم الأب أم الأم أم الاثنين معًا؟', type: 'select', options: ['الأب', 'الأم', 'الاثنين معًا'], dep: 'is_orphan', match: ['في حاله'] },
    { k: 'memorizes_quran', label: 'هل الطفل يحفظ شيئًا من القرآن؟', type: 'yn', req: true, match: ['يحفظ', 'القران'] },
    { k: 'quran_parts', label: 'ما عدد الأجزاء التي يحفظها الطفل؟', type: 'number', dep: 'memorizes_quran', match: ['الاجزاء'] }
  ];
  // عند مطابقة عناوين الأعمدة: الحقول الأخص أولًا (عنوان «في حالة أن الطفل يتيم…» يحتوي كلمة «يتيم» أيضًا)
  var ST_MATCH_ORDER = ['orphan_of', 'quran_parts', 'guardian_name'].concat(IMPORT_FIELDS.map(function (f) { return f.k; }));

  // المستندات التي يُحضرها ولي الأمر عند مراجعة التسجيل في المدرسة
  var ST_DOCS = [
    ['birth', 'شهادة الميلاد / صورة جواز السفر'],
    ['guardian_id', 'صورة جواز سفر ولي الأمر'],
    ['certificate', 'شهادة العام السابق'],
    ['conduct', 'توقيع مدونة السلوك']
  ];

  var ST_STATUS = { pending: 'تسجيل مبدئي', reserve: 'احتياط', final: 'تسجيل نهائي' };

  function stStatus(x) { return x.status === 'final' ? 'final' : x.status === 'reserve' ? 'reserve' : 'pending'; }

  // في المدرسة: المسجَّل نهائيًا، ومن هو احتياط (يُعامَل معاملته حتى يُبَتّ في أمره)
  function enrolled(x) { var st = stStatus(x); return st === 'final' || st === 'reserve'; }
  function isReserve(x) { return !!x && stStatus(x) === 'reserve'; }
  // علامة الاحتياط بعد الاسم: نجمة بلون مختلف (وفي Excel: «*»)
  function rsvMark(x) { return isReserve(x) ? '<span class="rsv" title="احتياط">*</span>' : ''; }
  function rsvText(x) { return isReserve(x) ? ' *' : ''; }

  function stBadge(st) { return st === 'final' ? 'published' : st === 'reserve' ? 'part' : 'edit'; }

  function stField(k) {
    for (var i = 0; i < IMPORT_FIELDS.length; i++) if (IMPORT_FIELDS[i].k === k) return IMPORT_FIELDS[i];
  }

  function findStudent(id) {
    for (var i = 0; i < S.students.length; i++) if (S.students[i].id === id) return S.students[i];
    return null;
  }

  // توحيد الكتابة العربية للمقارنة: بلا تشكيل، وبهمزات وتاء مربوطة موحّدة
  function norm(x) {
    return String(x == null ? '' : x)
      .replace(/[ً-ْـ*؟?:]/g, '')
      .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function latinDigits(x) {
    return String(x == null ? '' : x).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }).trim();
  }

  function yesNo(v) { return v === true ? 'نعم' : v === false ? 'لا' : ''; }



  /* ----- حقول ملف الطالب (التسجيل النهائي) -----
     x: يُحفظ في العمود details (JSON) لا في عمود مستقل.  p: العنوان المختصر في الملف المطبوع.
     sec: يبدأ عنده قسم جديد.  dep: يظهر ويُطلب فقط عند قيمة معينة لحقل آخر.  from: إجابة الاستمارة المبدئية التي تقابله */
  // الأكاديمية تدرّس من الأول إلى التاسع: يُسجَّل الطالب في أحدها، وآخر ما اجتازه دون التاسع
  var GRADES_DONE = ['لم يتم أي مرحلة', 'KG1', 'KG2', 'أول', 'ثاني', 'ثالث', 'رابع', 'خامس', 'سادس', 'سابع', 'ثامن'];
  var GRADES_NEW = ['أول', 'ثاني', 'ثالث', 'رابع', 'خامس', 'سادس', 'سابع', 'ثامن', 'تاسع'];
  var LEVELS = ['ممتاز', 'متوسط', 'ضعيف'];
  var UNIFORM_SIZES = ['6', '8', '10', '12', '14', '16', '18', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

  var ST_FIELDS = [
    { sec: 'بيانات الطالب', k: 'full_name', label: 'اسم الطالب رباعي', req: true, wide: true },
    { k: 'national_id', label: 'رقم هوية الطالب', req: true, ltr: true, num: true },
    { k: 'birth_date', label: 'تاريخ ميلاد الطالب', p: 'تاريخ الميلاد', type: 'date', req: true },
    { k: 'gender', label: 'الجنس', type: 'select', options: ['ذكر', 'أنثى'], req: true },
    { k: 'student_phone', x: true, label: 'رقم جوال الطالب', p: 'جوال الطالب', req: true, ltr: true, num: true },
    { k: 'class_name', label: 'الشعبة', type: 'class', req: true },

    { sec: 'الخلفية الدراسية', k: 'last_grade', x: true, label: 'آخر مرحلة دراسية اختبر فيها واجتازها الطالب', p: 'آخر مرحلة اجتازها', type: 'select', options: GRADES_DONE, req: true },
    { k: 'enroll_grade', x: true, label: 'المرحلة التي سيسجل فيها الطالب في العام الجديد', p: 'مرحلة التسجيل', type: 'select', options: GRADES_NEW, req: true, from: 'class_name' },
    { k: 'last_school', x: true, sug: ['لا'], label: 'هل التحق الطالب بمدرسة العام الماضي، وما اسم المدرسة؟', p: 'مدرسة العام الماضي', wide: true },
    { k: 'teams', x: true, label: 'هل الطالب متابع على التيمز أم عنده مشاكل في ذلك؟', p: 'المتابعة على التيمز', type: 'select', options: ['متابع', 'غير متابع', 'الوكالة', 'غير ذلك'], req: true },
    { k: 'placement', x: true, label: 'نتيجة اختبار مستوى سريع', p: 'اختبار المستوى', type: 'select', options: LEVELS, req: true },
    { k: 'talent', x: true, none: true, sug: ['رسم', 'خط', 'إنشاد', 'كرة قدم', 'إلقاء', 'حفظ القرآن'], label: 'هل عند الطالب موهبة معينة وما هي؟', p: 'الموهبة', req: true, wide: true },
    { k: 'quran_parts', label: 'كم جزءًا يحفظ الطالب من القرآن؟', p: 'أجزاء القرآن المحفوظة', type: 'number', max: 30, step: 0.5, req: true },
    { k: 'quran_reading', x: true, label: 'مستوى الطالب في قراءة القرآن', p: 'مستوى قراءة القرآن', type: 'select', options: LEVELS, req: true },

    { sec: 'بيانات ولي الأمر', k: 'guardian_name', label: 'اسم ولي الأمر الموجود في مصر رباعي (الأب ثم الأم ثم غيرهم)', p: 'اسم ولي الأمر', wide: true },
    { k: 'guardian_id', x: true, label: 'رقم هوية ولي الأمر الموجود', p: 'هوية ولي الأمر', req: true, ltr: true, num: true },
    { k: 'guardian_relation', label: 'صلة القرابة مع الطالب', p: 'صلة القرابة', req: true, sug: ['أب', 'أم', 'أخ', 'أخت', 'جد', 'جدة', 'عم', 'عمة', 'خال', 'خالة'] },
    { k: 'father_status', x: true, label: 'وجود الأب', type: 'select', options: ['مصر', 'غزة', 'شهيد', 'متوفى', 'الخارج', 'مفقود'], req: true },
    { k: 'gaza_exit', x: true, label: 'تاريخ الخروج من غزة', type: 'date', req: true },
    { k: 'father_job', x: true, sug: ['لا يعمل', 'موظف', 'معلم', 'تاجر', 'مهندس', 'طبيب', 'محاسب', 'سائق', 'عامل', 'أعمال حرة'], label: 'وظيفة الأب السابقة أو الحالية', p: 'وظيفة الأب', req: true, from: 'guardian_job' },
    { k: 'mother_job', x: true, sug: ['ربة منزل', 'معلمة', 'موظفة', 'ممرضة', 'طبيبة', 'مهندسة'], label: 'وظيفة الأم السابقة أو الحالية', p: 'وظيفة الأم', req: true },
    { k: 'phone', label: 'رقم جوال ولي الأمر', p: 'جوال ولي الأمر', req: true, ltr: true, num: true },
    { k: 'alt_phone', x: true, label: 'رقم جوال بديل', p: 'جوال بديل', req: true, ltr: true, num: true },
    { k: 'whatsapp', label: 'رقم واتساب الطالب (للتواصل معه؛ رسائل أولياء الأمور تذهب إلى جوال ولي الأمر)', p: 'واتساب الطالب', ltr: true, num: true },

    { sec: 'الأسرة والوضع الاجتماعي', k: 'family_size', x: true, label: 'عدد أفراد أسرة الطالب في مصر', p: 'أفراد الأسرة في مصر', type: 'number', max: 40, step: 1, req: true },
    { k: 'siblings_here', x: true, label: 'عدد الأبناء في نفس المركز', p: 'الأبناء في المركز', type: 'number', max: 20, step: 1, req: true },
    { k: 'martyr', x: true, label: 'هل من أسرة الطالب شهيد درجة أولى؟', p: 'شهيد درجة أولى', type: 'select', options: ['لا', 'أب', 'أم', 'أخ', 'أخت'], req: true, from: 'orphan_of' },
    { k: 'sponsorship', x: true, label: 'هل تستفيد الأسرة كفالة من أي مؤسسة في مصر؟', p: 'كفالة من مؤسسة', type: 'select', options: ['نعم', 'لا', 'أحيانا'], req: true },
    { k: 'financial', x: true, label: 'الوضع المادي للأسرة في مصر', p: 'الوضع المادي', type: 'select', options: ['متيسر', 'متوسط', 'صعب', 'صعب جدا'], req: true },
    { k: 'housing', x: true, label: 'حالة السكن', type: 'select', options: ['مكفول', 'يدفع'], req: true },
    { k: 'rent', x: true, sug: [], label: 'قيمة الإيجار', dep: { k: 'housing', v: 'يدفع' } },
    { k: 'family_illness', x: true, none: true, label: 'هل أحد من أسرة الطالب مريض؟ وما المرض؟', p: 'مرض في الأسرة', req: true, wide: true },

    { sec: 'الحالة الصحية', k: 'war_injury', x: true, none: true, label: 'هل لدى الطالب إصابة حرب؟ وما هي؟', p: 'إصابة حرب', req: true, wide: true },
    { k: 'illness', x: true, none: true, label: 'هل يعاني الطالب من مشكلة مرضية؟', p: 'مشكلة مرضية', req: true, wide: true, from: 'has_health_condition' },
    { k: 'disability', x: true, none: true, label: 'هل لدى الطالب إعاقة أو حالة خاصة؟', p: 'إعاقة أو حالة خاصة', req: true, wide: true, from: 'has_special_needs' },

    { sec: 'السكن', k: 'city', x: true, sug: [], label: 'المدينة', req: true },
    { k: 'address', label: 'العنوان التفصيلي (الحي - الشارع - رقم العمارة)', p: 'العنوان التفصيلي', req: true, wide: true },

    { sec: 'الزي والكتب المدرسية', k: 'shirt_size', x: true, label: 'مقاس الزي: التيشيرت', p: 'مقاس التيشيرت', type: 'select', options: UNIFORM_SIZES },
    { k: 'pants_size', x: true, label: 'مقاس الزي: البنطلون', p: 'مقاس البنطلون', type: 'select', options: UNIFORM_SIZES },
    { k: 'has_books', x: true, label: 'هل لديك كتب مدرسية مسبقًا؟', p: 'لديه كتب مدرسية مسبقًا', type: 'select', options: ['نعم', 'لا'] },

    { sec: 'مُدخل البيانات', k: 'filled_by', x: true, label: 'اسم المعلم/ة الذي ملأ البيانات', p: 'مُدخل البيانات', req: true }
  ];

  function stVal(st, k) {
    var f = null;
    for (var i = 0; i < ST_FIELDS.length; i++) if (ST_FIELDS[i].k === k) f = ST_FIELDS[i];
    if (!st) return null;
    if (k === 'address') return addressWithNeighborhood(st);
    var v = f && f.x ? (st.details || {})[k] : st[k];
    return v == null ? '' : v;
  }

  // رقم المجاورة كان حقلًا مستقلًا ثم أُلغي: من سُجّل له رقم يُضم إلى أول عنوانه التفصيلي
  // (يظهر هكذا في الشاشة والمطبوع، ويُحفظ ضمن العنوان عند أول حفظ للطالب)
  function addressWithNeighborhood(st) {
    var address = st.address || '', n = String((st.details || {}).neighborhood || '').trim();
    if (!n) return address;
    var part = /مجاور/.test(n) ? n : 'المجاورة ' + n;
    if (norm(address).indexOf(norm(part)) > -1) return address;
    return part + (address ? ' - ' + address : '');
  }

  // إجابة تدل على وجود شيء: ليست فارغة ولا «لا» / «لا يوجد»
  function saidYes(text) {
    var n = norm(text);
    return !!n && !/^(لا|لايوجد|لا يوجد|none|no)$/.test(n) && n.indexOf('لا يوجد') !== 0;
  }

  function studentFieldHtml(f, st) {
    var v = stVal(st, f.k), id = 'sf-' + f.k, inner;
    // اسم مُدخل البيانات يُقترح عند التسجيل والاعتماد؛ تعديل تسجيل نهائي لا يغيّره
    if (f.k === 'filled_by' && !v && !(st && stStatus(st) === 'final')) v = (S.profile && S.profile.full_name) || '';
    var need = f.req || f.dep;
    if (f.type === 'class') {
      inner = '<select id="' + id + '" required>' + classOptionsHtml(v || '') + '</select>' +
        '<div class="day" id="sf-class-hint">' + classHintHtml(v || '', st, stVal(st, 'gender')) + '</div>';
    } else if (f.type === 'select') {
      inner = '<select id="' + id + '"' + (f.req ? ' required' : '') + '>' + optionsHtml(f.options.slice(), v || '') + '</select>';
    } else {
      inner = '<input type="' + (f.type || 'text') + '" id="' + id + '"' + (f.req ? ' required' : '') +
        (f.ltr ? ' dir="ltr" style="text-align:right"' : '') + (f.num ? ' inputmode="numeric"' : '') + (f.sug ? ' list="dl-' + f.k + '" autocomplete="off"' : '') +
        (f.type === 'number' ? ' min="0" max="' + f.max + '" step="' + f.step + '"' : '') +
        ' value="' + esc(v == null ? '' : v) + '">';
      // إجابتها الغالبة «لا يوجد»: زر يكتبها بضغطة
      if (f.none) inner = '<div class="with-none">' + inner + '<button type="button" class="btn" data-sfnone="' + f.k + '">لا يوجد</button></div>';
    }
    // ما كتبه ولي الأمر في الاستمارة المبدئية، إن اختلف عن القيمة الحالية (للمراجعة مع المستندات)
    var raw = st && st.form_answers ? st.form_answers[f.from || f.k] : '';
    var hint = raw && norm(raw) !== norm(v) ? '<div class="formhint">في الاستمارة: ' + esc(raw) + '</div>' : '';
    var scanned = st && st.details && st.details.scan;
    if (scanned && scanned.read && scanned.read[f.k] != null && norm(String(scanned.read[f.k])) !== norm(String(v == null ? '' : v))) {
      hint += '<div class="formhint">في الاستمارة المصوّرة: ' + esc(scanned.read[f.k]) + '</div>';
    }
    if (scanned && (scanned.unsure || []).indexOf(f.k) > -1) hint += '<div class="formhint">قراءة غير مؤكدة من الاستمارة المصوّرة — تحقّق من الورقة</div>';
    return (f.sec ? '<h3 class="form-sec">' + f.sec + '</h3>' : '') +
      '<div' + (f.wide ? ' style="grid-column:1/-1"' : '') + (f.dep ? ' data-dep="' + f.dep.k + '" data-depv="' + esc(f.dep.v) + '"' : '') + '>' +
      '<label class="field" for="' + id + '">' + f.label + (need ? ' <span class="req">*</span>' : '') + '</label>' + inner + hint + '</div>';
  }

  // قوائم المقترحات للحقول المتكررة الإجابة (الوظيفة، المدينة…): الأكثر تكرارًا في إجابات الطلاب المسجلين ثم المقترحات الجاهزة.
  // تُبنى مرة واحدة عند فتح النموذج، ويعرضها المتصفح نفسه أثناء الكتابة فلا تُبطئ الإدخال
  function suggestionListsHtml() {
    return ST_FIELDS.filter(function (f) { return f.sug; }).map(function (f) {
      // تُعدّ الإجابات كما كُتبت أولًا، ثم تُوحَّد الصيغ المختلفة للقيم الفريدة القليلة فقط (القاهرة / القاهره)
      var raw = {}, count = {}, text = {};
      S.students.forEach(function (x) {
        var v = f.x ? (x.details || {})[f.k] : x[f.k];
        if (v) raw[v] = (raw[v] || 0) + 1;
      });
      Object.keys(raw).sort(function (a, b) { return raw[b] - raw[a]; }).forEach(function (v) {
        var clean = v.replace(/\s+/g, ' ').trim(), key = norm(clean);
        if (!key || clean.length > 40) return;
        if (!count[key]) text[key] = clean; // الصيغة الأكثر تكرارًا هي التي تُعرض
        count[key] = (count[key] || 0) + raw[v];
      });
      var list = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; }).slice(0, 25).map(function (k) { return text[k]; });
      f.sug.forEach(function (v) { if (!count[norm(v)]) list.push(v); });
      return '<datalist id="dl-' + f.k + '">' + list.map(function (v) { return '<option value="' + esc(v) + '">'; }).join('') + '</datalist>';
    }).join('');
  }

  // الحقول التابعة (قيمة الإيجار) تظهر وتصبح مطلوبة عند القيمة المحددة للحقل الذي تتبعه
  function syncStudentDeps() {
    var deps = app.querySelectorAll('#student-form [data-dep]');
    for (var i = 0; i < deps.length; i++) {
      var src = document.getElementById('sf-' + deps[i].getAttribute('data-dep'));
      var on = !!src && src.value === deps[i].getAttribute('data-depv'), input = deps[i].querySelector('input, select');
      deps[i].hidden = !on;
      input.required = on;
    }
  }

  // كل ما ورد في استمارة التسجيل المبدئي كما كُتب، للرجوع إليه أثناء المراجعة
  function originalAnswersHtml(st) {
    var a = st && st.form_answers, keys = a ? Object.keys(a) : [];
    if (!keys.length) return '';
    return '<details class="bank" style="margin:8px 0 0"><summary>إجابات استمارة التسجيل المبدئي (' + keys.length + ')</summary>' +
      '<div class="orig-answers">' + IMPORT_FIELDS.filter(function (f) { return a[f.k]; }).map(function (f) {
        return '<div><b>' + f.label + '</b><span>' + esc(a[f.k]) + '</span></div>';
      }).join('') + '</div></details>';
  }

  // معايير إضافية لتصفية الطلاب (وللطباعة). extra: عمود إضافي يظهر في الكشف المطبوع
  var ST_FLAGS = {
    orphan: { label: 'أيتام الأب (شهيد أو متوفى)',
      test: function (x) { var f = stVal(x, 'father_status'); return f === 'شهيد' || f === 'متوفى' || (!f && x.is_orphan === true); },
      extra: ['وجود الأب', function (x) { return stVal(x, 'father_status') || x.orphan_of; }] },
    martyr: { label: 'من أسرهم شهيد درجة أولى', test: function (x) { var m = stVal(x, 'martyr'); return !!m && m !== 'لا'; }, extra: ['الشهيد', function (x) { return stVal(x, 'martyr'); }] },
    injury: { label: 'لديهم إصابة حرب', test: function (x) { return saidYes(stVal(x, 'war_injury')); }, extra: ['الإصابة', function (x) { return stVal(x, 'war_injury'); }] },
    health: { label: 'لديهم مشكلة مرضية', test: function (x) { var t = stVal(x, 'illness'); return t ? saidYes(t) : x.has_health_condition === true; }, extra: ['المشكلة', function (x) { return stVal(x, 'illness'); }] },
    needs: { label: 'إعاقة أو حالة خاصة', test: function (x) { var t = stVal(x, 'disability'); return t ? saidYes(t) : x.has_special_needs === true; }, extra: ['الحالة', function (x) { return stVal(x, 'disability'); }] },
    hard: { label: 'وضع مادي صعب أو صعب جدًا', test: function (x) { var f = stVal(x, 'financial'); return f === 'صعب' || f === 'صعب جدا'; }, extra: ['الوضع المادي', function (x) { return stVal(x, 'financial'); }] },
    quran: { label: 'يحفظون من القرآن', test: function (x) { return Number(x.quran_parts) > 0; }, extra: ['عدد الأجزاء', function (x) { return x.quran_parts; }] },
    transport: { label: 'مشتركون في المواصلات', test: function (x, groupOf) { return !!groupOf[x.id]; },
      extra: ['الباص', function (x, groupOf) { var g = findGroup(groupOf[x.id]); return g ? g.assembly_point : ''; }] },
    notransport: { label: 'غير مشتركين في المواصلات', test: function (x, groupOf) { return !groupOf[x.id]; } },
    wantsride: { label: 'يحتاجون مواصلات بلا نقطة تجمع', test: function (x, groupOf) { return x.wants_transport === true && !groupOf[x.id]; } },
    noride: { label: 'لا يحتاجون مواصلات', test: function (x) { return x.wants_transport === false; } },
    scanned: { label: 'من استمارة مصوّرة (تحتاج مراجعة)', test: function (x) { return !!(x.details || {}).scan; },
      extra: ['غير مؤكد', function (x) { return ((x.details || {}).scan.unsure || []).length; }] },
    rideunknown: { label: 'لم يُحدَّد احتياجهم للمواصلات', test: function (x, groupOf) { return x.wants_transport == null && !groupOf[x.id]; } }
  };

  function transportGroupOf() {
    var map = {};
    S.tMembers.forEach(function (m) { map[m.student_id] = m.group_id; });
    return map;
  }

  // الطلاب المطابقون للبحث والحالة والصف والمعيار المختار
  function filteredStudents() {
    var q = norm(ui.stSearch), cls = ui.stClass, flag = ST_FLAGS[ui.stFlag], groupOf = flag ? transportGroupOf() : null;
    return S.students.filter(function (x) {
      if (ui.stStatus && stStatus(x) !== ui.stStatus) return false;
      if (cls === '-' ? x.class_name : cls && x.class_name !== cls) return false;
      if (flag && !flag.test(x, groupOf)) return false;
      return !q || norm(x.full_name).indexOf(q) > -1 || String(x.national_id || '').indexOf(latinDigits(ui.stSearch)) > -1;
    });
  }


  // ملف الطالب المطبوع: كل بياناته في صفحة واحدة
  var pendingProfile = null;


  function studentsTableHtml() {
    var shown = filteredStudents();
    // رقم الهوية المكرر علامة على تسجيل مزدوج يحتاج مراجعة
    var idCount = {};
    S.students.forEach(function (x) { if (x.national_id) idCount[x.national_id] = (idCount[x.national_id] || 0) + 1; });
    var LIMIT = 300, rowNo = 0;
    var rows = shown.slice(0, LIMIT).map(function (x) {
      var st = stStatus(x);
      return '<tr><td>' + (++rowNo) + '</td><td><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '</td>' +
        '<td dir="ltr" style="text-align:right">' + esc(x.national_id || '—') + (idCount[x.national_id] > 1 ? ' <span class="badge unpaid" dir="rtl">مكرر</span>' : '') + '</td>' +
        '<td><span class="badge ' + stBadge(st) + '">' + ST_STATUS[st] + '</span>' + ((x.details || {}).scan ? ' <span class="badge part">مصوّرة</span>' : '') + '</td>' +
        '<td>' + (st === 'final'
          ? '<select data-stclass="' + x.id + '" aria-label="صف ' + esc(x.full_name) + '">' + optionsHtml(schoolClasses(), x.class_name) + '</select>'
          : '<span style="color:var(--muted);font-size:.9rem">' + esc(x.class_name || x.requested_class || '—') + '</span>') + '</td>' +
        '<td dir="ltr" style="text-align:right">' + esc(x.phone || '—') + '</td>' +
        '<td style="white-space:nowrap"><button type="button" class="btn' + (st === 'final' ? '' : ' primary') + '" data-stedit="' + x.id + '">' + (st === 'final' ? 'تعديل' : 'مراجعة') + '</button> ' +
        '<button type="button" class="btn" data-stprofile="' + x.id + '">ملف الطالب</button> ' +
        (isAdmin() ? '<button type="button" class="btn danger" data-stdel="' + x.id + '">حذف</button>' : '') + '</td></tr>';
    }).join('');
    return '<p class="st-count">عدد الطلاب: ' + shown.length + (shown.length !== S.students.length ? ' من ' + S.students.length : '') +
      (shown.length > LIMIT ? ' — يُعرض أول ' + LIMIT + '؛ استخدم البحث أو التصفية لتضييق القائمة.' : '') + '</p>' +
      (rows
        ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الاسم</th><th>رقم الهوية</th><th>الحالة</th><th>الصف</th><th>الهاتف</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">' + (S.students.length ? 'لا توجد نتائج مطابقة.' : 'لا يوجد طلاب مسجلون بعد.') + '</div>');
  }

  function importPreviewHtml() {
    var p = ui.imp, rows = importRows();
    var known = p.flags.filter(function (f) { return f.known; }).length;
    var noId = rows.filter(function (r) { return !r.national_id; }).length;
    var dupIds = p.flags.filter(function (f, i) { return rows.indexOf(p.rows[i]) > -1 && (f.dup || f.known); }).length;
    p = Object.assign({}, p, { rows: rows, noId: noId, dupIds: dupIds, skipped: p.skipped + (p.skipKnown ? known : 0) });
    return '<div class="card"><h2>استيراد من ملف: ' + esc(p.file) + '</h2>' +
      (known
        ? '<label class="check" style="margin:8px 0 2px"><input type="checkbox" id="imp-skipknown"' + (ui.imp.skipKnown ? ' checked' : '') + '>' +
          'تخطَّ الصفوف التي رقم هويتها موجود في البرنامج (' + known + ')</label>' +
          '<p class="hint" style="margin:0 0 6px">مع التخطي لا يُنشأ سجل مكرر لمن أعاد تعبئة الاستمارة أو سُجّل يدويًا، لكن لا يدخل ما صحّحه في ردّه الجديد. بدون التخطي يُضاف ردّه سجلًا مبدئيًا جديدًا بعلامة «مكرر». في الحالتين لا يتغير السجل الموجود.</p>'
        : '') +
      '<ul class="imp-list">' +
        '<li>طلاب جدد سيُضافون بحالة «تسجيل مبدئي»: <b>' + p.rows.length + '</b></li>' +
        (p.skipped ? '<li>مسجلون مسبقًا ولن تتغير بياناتهم: ' + p.skipped + '</li>' : '') +
        '<li>الأعمدة التي تم التعرف عليها: ' + (p.mapped.map(function (k) { return stField(k).label; }).join('، ') || 'لا شيء') + '</li>' +
        (p.unmapped.length ? '<li>أعمدة لم تُستخدم: ' + esc(p.unmapped.slice(0, 6).join('، ')) + (p.unmapped.length > 6 ? ' … و' + (p.unmapped.length - 6) + ' أخرى' : '') + '</li>' : '') +
        (p.dupIds ? '<li>أرقام هوية متكررة في الملف: ' + p.dupIds + ' — ستظهر بعلامة «مكرر» لتراجعها</li>' : '') +
        (p.noId ? '<li>بدون رقم هوية صالح: ' + p.noId + ' — يُستكمل عند المراجعة</li>' : '') +
        p.errors.slice(0, 8).map(function (e) { return '<li class="bad">' + esc(e) + '</li>'; }).join('') +
        (p.errors.length > 8 ? '<li class="bad">… و' + (p.errors.length - 8) + ' صفوف أخرى فيها نقص</li>' : '') +
      '</ul>' +
      '<p class="hint" style="margin:12px 0 0">تُحفظ إجابات الاستمارة كما كُتبت، وتظهر بجانب كل حقل عند مراجعة الطالب. الصف يُحدَّد عند اعتماد التسجيل النهائي.</p>' +
      '<div class="actions"><button type="button" class="btn primary" data-impgo' + (p.rows.length ? '' : ' disabled') + '>استيراد الطلاب (' + p.rows.length + ')</button>' +
      '<button type="button" class="btn" data-impcancel>إلغاء</button></div></div>';
  }

  /* ----- نسخ بيانات الأسرة من أخ مسجَّل -----
     الإخوة يشتركون في بيانات ولي الأمر والأسرة والسكن والمواصلات، فتُنسخ إلى النموذج بضغطة بدل إملائها من جديد */
  var FAMILY_SECTIONS = ['بيانات ولي الأمر', 'الأسرة والوضع الاجتماعي', 'السكن'];

  function familyFields() {
    var sec = '', out = [];
    ST_FIELDS.forEach(function (f) { if (f.sec) sec = f.sec; if (FAMILY_SECTIONS.indexOf(sec) > -1) out.push(f); });
    return out;
  }

  // اسم الأب والجد والعائلة: ما بعد الاسم الأول
  function familyName(x) {
    return norm(x.full_name).split(/\s+/).slice(1).join(' ');
  }

  // بالبحث: من يطابق الاسم أو الهوية أو الهاتف. بلا بحث: إخوة محتملون (الهاتف نفسه، أو هوية ولي الأمر، أو اسم الأب والعائلة)
  function siblingMatches(st, query) {
    var q = norm(query), digits = latinDigits(query || '').trim(), list;
    if (q) {
      list = S.students.filter(function (x) {
        return (!st || x.id !== st.id) && (norm(x.full_name + ' ' + (x.guardian_name || '')).indexOf(q) > -1 ||
          (/\d/.test(digits) && (String(x.national_id || '').indexOf(digits) > -1 || String(x.phone || '').indexOf(digits) > -1)));
      });
    } else {
      if (!st) return [];
      var fam = familyName(st), gid = (st.details || {}).guardian_id;
      list = S.students.filter(function (x) {
        return x.id !== st.id && ((st.phone && x.phone === st.phone) || (gid && (x.details || {}).guardian_id === gid) ||
          (fam.split(' ').length >= 2 && familyName(x) === fam));
      });
    }
    // المسجلون نهائيًا أولًا: بياناتهم روجعت
    return list.sort(function (a, b) { return (stStatus(a) === 'final' ? 0 : 1) - (stStatus(b) === 'final' ? 0 : 1); }).slice(0, 6);
  }

  function siblingListHtml(st) {
    var list = siblingMatches(st, ui.sibSearch);
    return list.map(function (x) {
      return '<div class="cand"><span><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '<br><span class="meta">' + ST_STATUS[stStatus(x)] +
        (x.class_name ? ' · ' + esc(x.class_name) : '') + (x.guardian_name ? ' · ولي الأمر: ' + esc(x.guardian_name) : '') + '</span></span>' +
        '<button type="button" class="btn" data-sibcopy="' + x.id + '">انسخ بيانات الأسرة</button></div>';
    }).join('') || (ui.sibSearch.trim() ? '<div class="empty" style="padding:10px">لا يوجد طالب مطابق.</div>' : '');
  }

  function siblingBoxHtml(st) {
    var auto = siblingMatches(st, '').length;
    return '<details class="bank" id="sib-box" style="margin:8px 0 0"' + (auto ? ' open' : '') + '><summary>نسخ بيانات الأسرة من أخ مسجَّل<span id="sib-count">' + (auto ? ' — إخوة محتملون: ' + auto : '') + '</span></summary>' +
      '<p class="hint" style="margin:8px 0">ينسخ إلى هذا النموذج بيانات ولي الأمر والأسرة والسكن والمواصلات من أخيه. لا يُحفظ شيء قبل الضغط على «حفظ».</p>' +
      '<input type="search" id="sib-search" placeholder="ابحث عن الأخ بالاسم أو رقم الهوية أو هاتف ولي الأمر" aria-label="بحث عن أخ" value="' + esc(ui.sibSearch) + '">' +
      '<div id="sib-results">' + siblingListHtml(st) + '</div></details>';
  }

  // الطالب كما هو مكتوب في النموذج الآن (للطالب الجديد الذي لم يُحفظ بعد): يكفي لاقتراح إخوته أثناء الكتابة
  function draftStudent() {
    var cur = ui.editStudent && ui.editStudent !== 'new' ? findStudent(ui.editStudent) : null;
    var val = function (k) { var el = document.getElementById('sf-' + k); return el ? el.value.trim() : ''; };
    return { id: cur ? cur.id : '', full_name: val('full_name'), phone: latinDigits(val('phone')), details: { guardian_id: latinDigits(val('guardian_id')) } };
  }

  // يُحدَّث صندوق الإخوة بحسب ما كُتب في النموذج (الاسم، هاتف ولي الأمر، هويته) ما دام البحث فارغًا
  function refreshSiblingBox() {
    var box = document.getElementById('sib-box');
    if (!box || ui.sibSearch.trim()) return;
    var draft = draftStudent(), n = siblingMatches(draft, '').length;
    document.getElementById('sib-results').innerHTML = siblingListHtml(draft);
    document.getElementById('sib-count').textContent = n ? ' — إخوة محتملون: ' + n : '';
    if (n) box.open = true;
  }

  function copyFromSibling(id) {
    var sib = findStudent(id);
    if (!sib) return;
    // الحقل الفارغ عند الأخ لا يمسح ما كُتب هنا
    var copied = 0;
    familyFields().forEach(function (f) {
      var el = document.getElementById('sf-' + f.k), v = stVal(sib, f.k);
      if (!el || v === '' || v == null) return;
      // قيمة ليست بين خيارات القائمة (خيار أُلغي لاحقًا) تُضاف خيارًا حتى لا تضيع
      if (el.tagName === 'SELECT' && !Array.prototype.some.call(el.options, function (o) { return o.value === String(v); })) el.add(new Option(v, v));
      el.value = v;
      copied++;
    });
    var wants = document.getElementById('sf-wants'), ride = document.getElementById('sf-transport'), gid = transportGroupOf()[sib.id];
    if (ride && gid) ride.value = gid;
    if (wants && (gid || sib.wants_transport != null)) wants.value = gid || sib.wants_transport ? 'yes' : 'no';
    syncStudentDeps();
    if (!copied) return toast('ملف «' + sib.full_name + '» ليس فيه بيانات أسرة مُدخلة بعد، فلا شيء يُنسخ.', true);
    toast('نُسخ ' + copied + ' حقلًا من بيانات أسرة «' + sib.full_name + '» — راجعها ثم احفظ');
    var firstCopied = document.getElementById('sf-guardian_name');
    if (firstCopied) firstCopied.scrollIntoView({ block: 'center' });
  }

  function studentFormHtml(st) {
    var final = st && stStatus(st) === 'final', docs = (st && st.documents) || {};
    // الباص المختار لطالب لم يُسجَّل نهائيًا بعد يُحفظ في سجله (bus_wish) ويُضاف إليه عند اعتماد تسجيله النهائي
    var groupId = st ? transportGroupOf()[st.id] || (st.details && st.details.bus_wish) || '' : '';
    // من له نقطة تجمع فهو يحتاج مواصلات
    var wants = groupId ? true : st ? st.wants_transport : null;
    return '<form class="card" id="student-form">' +
      '<div class="toolbar" style="align-items:center;margin-bottom:4px"><h2 style="margin:0;flex:1">' + (st ? (final ? 'تعديل بيانات الطالب' : 'مراجعة تسجيل الطالب') : 'تسجيل طالب') + '</h2>' +
        '<span class="badge ' + stBadge(st ? stStatus(st) : 'pending') + '">' + ST_STATUS[st ? stStatus(st) : 'pending'] + '</span></div>' +
      (final ? '' : '<p class="hint">راجع البيانات مع المستندات الأصلية وصحّح ما يلزم، ثم اختر الشعبة واعتمد التسجيل النهائي. يمكنك الحفظ والعودة لاحقًا.</p>') +
      (st && st.details && st.details.scan ? '<p class="formhint" style="margin:8px 0">أُدخل هذا السجل من استمارة مصوّرة (' + esc(st.details.scan.file || '') + (st.details.scan.model ? ' · قرأها ' + esc(st.details.scan.model) : '') + ') ولم يُراجَع بعد. طابق كل خانة مع الورقة، وخصوصًا الحقول المعلَّمة «قراءة غير مؤكدة»' +
        ((st.details.scan.unsure || []).length ? ' (' + st.details.scan.unsure.length + ')' : '') + '.</p>' : '') +
      originalAnswersHtml(st) + siblingBoxHtml(st) +
      '<div class="grid2" style="margin-top:4px">' + ST_FIELDS.map(function (f) { return studentFieldHtml(f, st); }).join('') + '</div>' + suggestionListsHtml() +
      (S.transportMissing ? '' :
        '<h2 style="margin-top:20px">المواصلات</h2>' +
        (S.wantsMissing ? '' :
          '<label class="field" for="sf-wants" style="margin-top:6px">هل يحتاج الطالب مواصلات؟</label>' +
          '<select id="sf-wants" style="width:100%;max-width:420px">' +
            '<option value="">لم يُحدَّد بعد</option>' +
            '<option value="yes"' + (wants === true ? ' selected' : '') + '>نعم</option>' +
            '<option value="no"' + (wants === false ? ' selected' : '') + '>لا</option></select>') +
        '<label class="field" for="sf-transport" style="margin-top:10px">الباص</label>' +
        '<select id="sf-transport" style="width:100%;max-width:420px"><option value="">بدون مواصلات</option>' + S.tGroups.map(function (g) {
          return '<option value="' + g.id + '"' + (g.id === groupId ? ' selected' : '') + '>' + esc(g.assembly_point) +
            (g.pickup_time ? ' — ' + esc(g.pickup_time) : '') + '</option>';
        }).join('') + '</select>' +
        '<div class="day">' + (S.tGroups.length
          ? 'اختر الباص المناسب لعنوان السكن. يُضاف الطالب إلى الباص عند اعتماد تسجيله النهائي فقط، ولا يُنشئ ذلك إيصالًا ولا مطالبة مالية. يبدأ اشتراكه عند إصدار أول إيصال له من «المواصلات ← إصدار إيصال».'
          : 'لا توجد مجموعات مواصلات بعد؛ أنشئها من صفحة «المواصلات».') + '</div>') +
      '<h2 style="margin-top:20px">المستندات المستلمة</h2>' +
      '<div class="classes-pick" style="margin-top:6px">' + ST_DOCS.map(function (d) {
        return '<label class="check"><input type="checkbox" name="sf-doc" value="' + d[0] + '"' + (docs[d[0]] ? ' checked' : '') + '>' + d[1] + '</label>';
      }).join('') + '</div>' +
      '<label class="field" for="sf-docnote" style="margin-top:8px">مستندات أخرى أو ملاحظات</label>' +
      '<input type="text" id="sf-docnote" value="' + esc((st && st.documents_note) || '') + '">' +
      '<div class="actions">' +
        (final
          ? '<button type="submit" class="btn primary" data-mode="edit" formnovalidate>حفظ التعديلات</button>' +
            '<button type="button" class="btn" data-stunfinal="' + st.id + '">إعادة إلى التسجيل المبدئي</button>'
          : (canRecordAtt() ? '<label style="display:flex;gap:6px;align-items:center;flex-basis:100%"><input type="checkbox" id="sf-welcome" checked> إرسال رسالة ترحيب لولي الأمر على واتساب عند اعتماد التسجيل النهائي</label>' : '') +
            '<button type="submit" class="btn primary" data-mode="final">حفظ واعتماد التسجيل النهائي</button>' +
            '<button type="submit" class="btn" data-mode="save" formnovalidate>' + (st && stStatus(st) === 'reserve' ? 'حفظ (يبقى احتياطًا)' : 'حفظ دون اعتماد') + '</button>' +
            (st && stStatus(st) === 'reserve'
              ? '<button type="button" class="btn" data-stunfinal="' + st.id + '">إعادة إلى التسجيل المبدئي</button>'
              : '<button type="submit" class="btn" data-mode="reserve" formnovalidate title="قائمة الانتظار: لا يُحتسب في الشعب">تسجيل احتياط</button>')) +
        (st ? '<button type="button" class="btn" data-stprofile="' + st.id + '">طباعة ملف الطالب</button>' : '') +
        '<button type="button" class="btn" data-stedit="">إلغاء</button>' +
      '</div></form>';
  }

  /* ---------- إدخال الطلاب من استمارات ورقية مصوّرة ----------
     تُرفع صورة الاستمارة المعبأة بخط اليد (أو ملف PDF فيه عدة استمارات)، فتقرؤها خدمة read-registration-form
     (Supabase Edge Function تستدعي نموذجًا يقرأ الصور على DeepInfra)، ويُنشأ لكل استمارة تسجيل مبدئي موسوم «من استمارة مصوّرة» ليُراجَع على الورقة.
     لا يُعتمد شيء نهائيًا من هنا. إن لم تكن الخدمة مفعّلة يمكن نسخ التعليمات ولصق الناتج يدويًا */

  var SCAN_SKIP = { class_name: 1, placement: 1, filled_by: 1 };

  // نماذج القراءة المقترحة على DeepInfra (يمكن كتابة اسم أي نموذج آخر يقبل الصور). الاختيار لمدير النظام، ويُحفظ في هذا المتصفح
  var SCAN_MODELS = ['google/gemini-3.1-pro', 'anthropic/claude-opus-5-5', 'anthropic/claude-sonnet-5-5', 'anthropic/claude-haiku-4-5',
    'Qwen/Qwen3-VL-30B-A3B-Instruct', 'meta-llama/Llama-4-Scout-17B-16E-Instruct', 'google/gemma-3-27b-it', 'mistralai/Mistral-Small-3.2-24B-Instruct-2506'];

  function scanModel() {
    if (!isAdmin()) return '';
    try { return localStorage.getItem('scan-model') || ''; } catch (err) { return ''; }
  }

  function setScanModel(value) {
    try { localStorage.setItem('scan-model', value.trim()); } catch (err) { /* التخزين المحلي غير متاح */ }
  }

  // ما قُرئ من استمارة، خانة خانة (للمقارنة بين النماذج وللتحقق قبل فتح السجل)
  function scanReadingHtml(form) {
    var unsure = Array.isArray(form.unsure) ? form.unsure : [], rows = scanFields().filter(function (f) { return String(form[f.k] == null ? '' : form[f.k]).trim(); });
    return '<details class="bank" style="margin:6px 0 0"><summary>عرض القراءة (' + rows.length + ' خانة)</summary><div class="orig-answers">' + rows.map(function (f) {
      return '<div><b>' + f.label + (unsure.indexOf(f.k) > -1 ? ' <span class="badge part">غير مؤكدة</span>' : '') + '</b><span>' + esc(form[f.k]) + '</span></div>';
    }).join('') + '</div></details>';
  }

  // حقول الاستمارة الورقية كما تُرسل للقراءة: المفتاح، العنوان المطبوع، النوع، الخيارات
  function scanFields() {
    var list = ST_FIELDS.filter(function (f) { return !SCAN_SKIP[f.k]; }).map(function (f) {
      var o = { k: f.k, label: f.p || f.label };
      if (f.type === 'date' || f.type === 'number') o.type = f.type;
      if (f.type === 'select') o.options = f.options.slice();
      return o;
    });
    list.push({ k: 'wants_transport', label: 'يحتاج الطالب مواصلات؟', options: ['نعم', 'لا'] });
    return list;
  }

  // مكتبة عرض صفحات PDF تُحمَّل عند الحاجة فقط
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      sc.onload = function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve();
      };
      sc.onerror = function () { reject(new Error('تعذر تحميل مكتبة قراءة PDF')); };
      document.head.appendChild(sc);
    });
  }

  var SCAN_MAX_SIDE = 2200; // أطول ضلع للصورة المرسلة (بكسل): يكفي لقراءة الخط ولا يثقل الإرسال

  function canvasPayload(canvas) {
    return { media_type: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1] };
  }

  // صور الملف المرسلة للقراءة، صورة لكل صفحة: الصورة تُصغَّر (صور الهواتف كبيرة) وتُحوَّل إلى JPEG،
  // وملف PDF تُرسم صفحاته صورًا هنا في المتصفح لأن خدمة القراءة تقبل الصور فقط
  async function scanFilePages(file) {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      if (file.size > 40 * 1024 * 1024) throw new Error('ملف PDF أكبر من 40 ميغابايت؛ قسّمه إلى ملفات أصغر');
      await loadPdfJs();
      var doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      if (doc.numPages > 60) throw new Error('في الملف ' + doc.numPages + ' صفحة؛ الحد 60 صفحة في الملف الواحد');
      var pages = [];
      for (var n = 1; n <= doc.numPages; n++) {
        var page = await doc.getPage(n), base = page.getViewport({ scale: 1 });
        var view = page.getViewport({ scale: SCAN_MAX_SIDE / Math.max(base.width, base.height) });
        var pc = document.createElement('canvas');
        pc.width = Math.round(view.width);
        pc.height = Math.round(view.height);
        await page.render({ canvasContext: pc.getContext('2d'), viewport: view }).promise;
        pages.push(canvasPayload(pc));
      }
      return pages;
    }
    if (!/^image\//.test(file.type)) throw new Error('نوع الملف غير مدعوم (صورة أو PDF فقط)');
    return [await new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, SCAN_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvasPayload(canvas));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('تعذر فتح الصورة')); };
      img.src = url;
    })];
  }

  // سجل طالب مبدئي من استمارة مقروءة. يعيد { state: saved | dup | error, name, note, id }
  async function saveScannedForm(form, fileName, model) {
    var text = function (k) { return String(form[k] == null ? '' : form[k]).replace(/\s+/g, ' ').trim(); };
    var data = { status: 'pending', class_name: '', details: {} };
    ST_FIELDS.forEach(function (f) {
      if (SCAN_SKIP[f.k]) return;
      var v = text(f.k);
      if (f.type === 'date') v = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
      else if (f.type === 'number') { v = parseFloat(latinDigits(v)); v = isNaN(v) ? null : v; }
      else if (f.num) v = latinDigits(v).replace(/[\s-]/g, '');
      if (f.x) data.details[f.k] = v; else data[f.k] = v;
    });
    var name = data.full_name || '';
    if (!name) return { state: 'error', name: '(بلا اسم)', note: 'لم يُقرأ اسم الطالب' };
    var same = data.national_id ? S.students.filter(function (x) { return x.national_id === data.national_id; })[0] : null;
    if (same && stStatus(same) === 'final') {
      return { state: 'dup', name: same.full_name, note: 'رقم الهوية ' + data.national_id + ' مسجَّل نهائيًا — لم يُغيَّر سجله', id: same.id };
    }
    if (same) return mergeScannedForm(same, data, form, fileName, model);
    data.requested_class = text('enroll_grade');
    data.memorizes_quran = data.quran_parts == null ? null : data.quran_parts > 0;
    if (!S.wantsMissing) { var w = text('wants_transport'); data.wants_transport = w === 'نعم' ? true : w === 'لا' ? false : null; }
    var keys = {};
    ST_FIELDS.forEach(function (f) { keys[f.k] = true; });
    // scan: علامة أن السجل من استمارة مصوّرة ولم يُراجَع، مع الحقول التي لم تُقرأ بثقة
    data.details.scan = {
      at: new Date().toISOString(), by: (S.profile && S.profile.full_name) || displayName(S.email), file: fileName, model: model || '',
      unsure: (Array.isArray(form.unsure) ? form.unsure : []).filter(function (k) { return keys[k]; })
    };
    var r = await sb.from('students').insert(data).select().single();
    if (r.error) return { state: 'error', name: name, note: r.error.message };
    S.students.push(r.data);
    S.students.sort(function (a, b) { return a.full_name.localeCompare(b.full_name, 'ar'); });
    return { state: 'saved', name: name, id: r.data.id, note: data.details.scan.unsure.length ? 'حقول غير مؤكدة القراءة: ' + data.details.scan.unsure.length : '' };
  }

  // الاستمارة لطالب له تسجيل مبدئي (من الاستمارة الإلكترونية مثلًا): لا يُنشأ سجل ثانٍ، بل يُكمَّل سجله.
  // الخانات الفارغة عنده تُملأ من الورقة. ما له قيمة مسجَّلة لا يُستبدل (قد تكون قراءة الخط خاطئة)،
  // وتُحفظ قراءة الورقة المختلفة في scan.read لتظهر بجانب الحقل عند المراجعة
  async function mergeScannedForm(same, data, form, fileName, model) {
    var patch = {}, details = Object.assign({}, same.details), read = {}, filled = 0, differ = 0;
    var empty = function (v) { return v == null || v === ''; };
    ST_FIELDS.forEach(function (f) {
      if (SCAN_SKIP[f.k]) return;
      var v = f.x ? data.details[f.k] : data[f.k], cur = f.x ? (same.details || {})[f.k] : same[f.k];
      if (empty(v)) return;
      if (empty(cur)) { if (f.x) details[f.k] = v; else patch[f.k] = v; filled++; }
      else if (norm(String(cur)) !== norm(String(v))) { read[f.k] = v; differ++; }
    });
    var wants = String(form.wants_transport || '').trim();
    if (!S.wantsMissing && same.wants_transport == null && (wants === 'نعم' || wants === 'لا')) patch.wants_transport = wants === 'نعم';
    if ('quran_parts' in patch) patch.memorizes_quran = patch.quran_parts > 0;
    var known = {};
    ST_FIELDS.forEach(function (f) { known[f.k] = true; });
    details.scan = {
      at: new Date().toISOString(), by: (S.profile && S.profile.full_name) || displayName(S.email), file: fileName, model: model || '', read: read,
      unsure: (Array.isArray(form.unsure) ? form.unsure : []).filter(function (k) { return known[k]; })
    };
    patch.details = details;
    var r = await sb.from('students').update(patch).eq('id', same.id);
    if (r.error) return { state: 'error', name: same.full_name, note: r.error.message, id: same.id };
    Object.assign(same, patch);
    return { state: 'merged', name: same.full_name, id: same.id,
      note: 'له تسجيل مبدئي سابق: مُلئت ' + filled + ' خانة فارغة من الورقة' + (differ ? '، و' + differ + ' خانة قراءتها تختلف عن المسجَّل (تظهر عند المراجعة ولم تُستبدل)' : '') };
  }

  // dry: قراءة تجريبية تُعرض ولا تُحفظ
  async function saveScannedForms(item, forms, dry) {
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i] || {};
      var res = dry ? { state: 'preview', name: String(form.full_name || '(بلا اسم)'), note: 'قراءة تجريبية — لم يُحفظ شيء' } : await saveScannedForm(form, item.name, item.model);
      res.form = form;
      item.results.push(res);
    }
  }

  async function runScanQueue(files) {
    var scan = ui.scan;
    if (!scan || scan.running) return;
    var chosen = scanModel(), dry = !!scan.dry;
    var items = Array.prototype.map.call(files, function (f) { return { file: f, name: f.name, status: 'wait', msg: '', results: [], model: '' }; });
    scan.items = scan.items.concat(items);
    scan.running = true;
    render();
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (ui.scan !== scan) return; // أُغلقت الشاشة
      item.status = 'busy';
      render();
      try {
        var pages = await scanFilePages(item.file);
        for (var p = 0; p < pages.length; p++) {
          if (ui.scan !== scan) return;
          if (pages.length > 1) { item.msg = 'الصفحة ' + (p + 1) + ' من ' + pages.length; render(); }
          var request = { file: pages[p], fields: scanFields() };
          if (chosen) request.model = chosen;
          var r = await sb.functions.invoke('read-registration-form', { body: request });
          if (r.error || !r.data || r.data.error) {
            var why = (r.data && r.data.error) || (r.error && r.error.message) || '';
            // الخدمة غير منشورة أو بلا مفتاح: تُعرض الطريقة اليدوية
            if (!r.data || /not found|404|API_KEY|Failed to send/i.test(why)) scan.manual = true;
            // رسالة المتصفح عند غياب الخدمة عن الخادم غامضة، فتُشرح
            if (/Failed to send|not found/i.test(why)) why = 'خدمة القراءة غير منشورة على الخادم بعد. شغّل «Deploy Supabase functions» من تبويب Actions في GitHub بعد إضافة السرّين، أو استخدم الطريقة اليدوية أدناه.';
            else if (/API_KEY is not set/i.test(why)) why = 'خدمة القراءة منشورة لكن مفتاح DeepInfra لم يصلها. أعد تشغيل «Deploy Supabase functions» من تبويب Actions.';
            throw new Error((pages.length > 1 ? 'الصفحة ' + (p + 1) + ': ' : '') + (why || 'تعذر الاتصال بخدمة القراءة'));
          }
          item.model = r.data.model || chosen || '';
          await saveScannedForms(item, Array.isArray(r.data.forms) ? r.data.forms : [], dry);
        }
        item.status = 'done';
        item.msg = item.results.length ? '' : 'لم يُعثر في الملف على استمارة معبأة';
      } catch (err) {
        item.status = 'error';
        item.msg = err.message;
      }
      item.file = null;
      render();
    }
    scan.running = false;
    render();
  }

  // تعليمات تُنسخ إلى محادثة مع مساعد ذكاء اصطناعي يقرأ الصور، مع إرفاق صورة الاستمارة، عند عدم توفر خدمة القراءة الآلية
  function scanPromptText() {
    var fields = scanFields();
    return 'في المرفق استمارة تسجيل مدرسية عربية مطبوعة عبّأها ولي الأمر بخط اليد. انسخ ما كُتب بجانب كل عنوان مطبوع.\n' +
      '- انسخ المكتوب كما هو دون تصحيح أو تخمين. الخانة الفارغة قيمتها نص فارغ.\n' +
      '- الأرقام (الهوية، الهاتف، الأعداد) بأرقام 0-9 دون مسافات. التواريخ بصيغة YYYY-MM-DD (ولي الأمر يكتب يوم/شهر/سنة).\n' +
      '- الحقل الذي له خيارات: أعد الخيار المؤشَّر أو المطابق لما كُتب حرفيًا من القائمة، أو نصًّا فارغًا.\n' +
      '- unsure: مفاتيح الحقول التي لم تتأكد من قراءة خطها (أعطِ أفضل قراءة لها مع ذلك).\n' +
      '- إن كان في المرفق أكثر من استمارة فلكل استمارة عنصر في forms.\n\n' +
      'أجب بـ JSON فقط بهذا الشكل دون أي شرح:\n{"forms":[{' + fields.slice(0, 3).map(function (f) { return '"' + f.k + '":"…"'; }).join(',') + ',…,"unsure":["…"]}]}\n\n' +
      'الحقول (المفتاح: العنوان المطبوع):\n' + fields.map(function (f) {
        return f.k + ': ' + f.label + (f.type === 'date' ? ' (تاريخ)' : f.type === 'number' ? ' (رقم)' : '') + (f.options ? ' — الخيارات: ' + f.options.join(' | ') : '');
      }).join('\n');
  }

  async function saveScanPaste() {
    var box = document.getElementById('scan-paste'), raw = box.value, a = raw.indexOf('{'), b = raw.lastIndexOf('}'), parsed = null;
    try { parsed = JSON.parse(raw.slice(a, b + 1)); } catch (err) { parsed = null; }
    var forms = parsed && (Array.isArray(parsed.forms) ? parsed.forms : parsed.full_name != null ? [parsed] : null);
    if (!forms) return toast('النص الملصوق ليس ناتجًا صالحًا. الصق إجابة المساعد كاملة (تبدأ بـ { وتنتهي بـ }).', true);
    var item = { name: 'لصق يدوي', status: 'busy', msg: '', results: [], model: '' };
    ui.scan.items.push(item);
    await saveScannedForms(item, forms, !!ui.scan.dry);
    item.status = 'done';
    item.msg = item.results.length ? '' : 'لا استمارات في النص الملصوق';
    render();
  }

  function scanScreenHtml() {
    var scan = ui.scan, saved = 0;
    scan.items.forEach(function (it) { it.results.forEach(function (r) { if (r.state === 'saved' || r.state === 'merged') saved++; }); });
    var STATE = { wait: ['pending', 'بانتظار الدور'], busy: ['edit', 'تُقرأ الآن…'], done: ['published', 'تمت القراءة'], error: ['unpaid', 'تعذّرت'] };
    var items = scan.items.map(function (it) {
      return '<div class="scan-item"><div class="toolbar" style="align-items:center;margin:0"><b style="flex:1;overflow-wrap:anywhere">' + esc(it.name) +
        (it.model ? ' <span dir="ltr" style="font-weight:400;color:var(--muted);font-size:.85rem">' + esc(it.model) + '</span>' : '') + '</b>' +
        '<span class="badge ' + STATE[it.status][0] + '">' + STATE[it.status][1] + '</span></div>' +
        (it.msg ? '<div class="formhint">' + esc(it.msg) + '</div>' : '') +
        it.results.map(function (r) {
          return '<div class="cand"><span><b>' + esc(r.name) + '</b> <span class="badge ' + (r.state === 'saved' || r.state === 'merged' ? 'paid' : r.state === 'dup' ? 'part' : r.state === 'preview' ? 'pending' : 'unpaid') + '">' +
            (r.state === 'saved' ? 'أُضيف تسجيلًا مبدئيًا' : r.state === 'merged' ? 'أُكمل تسجيله المبدئي' : r.state === 'dup' ? 'مسجَّل نهائيًا' : r.state === 'preview' ? 'تجربة' : 'لم يُضف') + '</span>' +
            (r.note ? '<br><span class="meta">' + esc(r.note) + '</span>' : '') + (r.form ? scanReadingHtml(r.form) : '') + '</span>' +
            (r.id ? '<button type="button" class="btn' + (r.state === 'saved' || r.state === 'merged' ? ' primary' : '') + '" data-stedit="' + r.id + '">' + (r.state === 'dup' || r.state === 'error' ? 'فتح السجل' : 'مراجعة') + '</button>' : '') + '</div>';
        }).join('') + '</div>';
    }).join('');
    return '<button type="button" class="btn link" data-scanclose>→ العودة إلى تسجيل الطلاب</button>' +
      '<div class="card"><h2>إدخال من استمارات مصوّرة</h2>' +
        '<p class="hint">صوّر الاستمارة الورقية المعبأة (أو امسحها بالماسح) وارفعها. تُقرأ الخانات آليًا ويُنشأ لكل استمارة <b>تسجيل مبدئي</b> موسوم «مصوّرة» يحتاج مراجعة على الورقة، ولا يُعتمد شيء نهائيًا. الحقول التي لم يُقرأ خطها بثقة تُعلَّم عند المراجعة.</p>' +
        '<ul class="imp-list" style="margin-bottom:12px"><li>صورة واضحة مستقيمة للورقة كاملة، بإضاءة جيدة. صورة لكل استمارة، أو ملف PDF من الماسح كل صفحة فيه استمارة (حتى 60 صفحة).</li>' +
          '<li>صورة الاستمارة ببياناتها تُرسل إلى خدمة قراءة خارجية (نموذج ذكاء اصطناعي على DeepInfra) عبر حساب الأكاديمية. لا تُحفظ الصورة في البرنامج.</li>' +
          '<li>من له تسجيل مبدئي برقم الهوية نفسه لا يُضاف ثانية: تُملأ خاناته الفارغة من الورقة، وما يختلف يُعرض عند المراجعة دون استبدال. المسجَّل نهائيًا لا يُغيَّر.</li></ul>' +
        (isAdmin() ? '<div class="grid2" style="margin-bottom:10px"><div><label class="field" for="scan-model">نموذج القراءة (DeepInfra)</label>' +
          (function () {
            var cur = scanModel(), other = scan.otherModel || (!!cur && SCAN_MODELS.indexOf(cur) < 0);
            return '<select id="scan-model" dir="ltr"><option value="">افتراضي الخدمة</option>' + SCAN_MODELS.map(function (m) {
              return '<option value="' + m + '"' + (!other && m === cur ? ' selected' : '') + '>' + m + '</option>';
            }).join('') + '<option value="__other"' + (other ? ' selected' : '') + '>نموذج آخر…</option></select>' +
              (other ? '<input type="text" id="scan-model-other" dir="ltr" autocomplete="off" style="margin-top:6px" placeholder="اسم النموذج كما في DeepInfra" value="' + esc(SCAN_MODELS.indexOf(cur) < 0 ? cur : '') + '">' : '');
          })() +
          '<div class="day">يُحفظ اختيارك في هذا المتصفح.</div></div>' +
          '<div style="align-self:center"><label class="check"><input type="checkbox" id="scan-dry"' + (scan.dry ? ' checked' : '') + '>قراءة تجريبية للمقارنة: اعرض الناتج ولا تحفظ شيئًا</label></div></div>' : '') +
        '<div class="toolbar" style="align-items:center"><button type="button" class="btn primary" data-scanpick' + (scan.running ? ' disabled' : '') + '>' + (scan.running ? 'جارٍ القراءة…' : 'اختيار الصور أو ملفات PDF') + '</button>' +
          '<input type="file" id="scan-files" accept="image/*,.pdf,application/pdf" multiple hidden>' +
          (saved ? '<span class="st-count" style="margin:0">أُدخل في هذه الجلسة: ' + saved + ' — تجدهم في «تسجيل مبدئي» بمعيار «من استمارة مصوّرة».</span>' : '') + '</div>' +
        (items ? '<div style="margin-top:14px">' + items + '</div>' : '') + '</div>' +
      '<details class="card bank"' + (scan.manual ? ' open' : '') + '><summary>الطريقة اليدوية (إن لم تكن خدمة القراءة الآلية مفعّلة)</summary>' +
        '<p class="hint" style="margin:10px 0">افتح محادثة مع مساعد ذكاء اصطناعي يقرأ الصور، أرفق صورة الاستمارة، والصق التعليمات التالية. ثم انسخ إجابته كاملة والصقها هنا.</p>' +
        '<div class="actions" style="margin:0 0 10px"><button type="button" class="btn" data-scancopy>نسخ التعليمات</button></div>' +
        '<label class="field" for="scan-paste">إجابة المساعد</label><textarea id="scan-paste" rows="6" dir="ltr" placeholder=\'{"forms":[…]}\'></textarea>' +
        '<div class="actions"><button type="button" class="btn primary" data-scanpaste>إضافة من الإجابة الملصوقة</button></div></details>';
  }

  function renderStudents() {
    if (S.studentsMissing || S.regMissing) {
      app.innerHTML = tabs('students') + '<div class="card empty">لم تُجهَّز قاعدة البيانات لتسجيل الطلاب بعد.<br>' +
        'شغّل الملف <code dir="ltr">supabase/' + (S.studentsMissing ? 'students.sql ثم student_registration.sql' : 'student_registration.sql') + '</code> في محرر SQL ثم حدّث الصفحة.</div>';
      return;
    }
    var ed = ui.editStudent, st = ed && ed !== 'new' ? findStudent(ed) : null;
    // أثناء تعبئة النموذج لا تُرسم قائمة الطلاب تحته: رسم مئات الصفوف يؤخر فتح النموذج بلا فائدة
    if (ed && !ui.imp) {
      app.innerHTML = tabs('students') + studentFormHtml(st);
      syncStudentDeps();
      return;
    }
    if (ui.scan && !ui.imp) {
      app.innerHTML = tabs('students') + scanScreenHtml();
      return;
    }
    if (ui.check && !ui.imp) {
      app.innerHTML = tabs('students') + checkScreenHtml();
      return;
    }
    if (ui.sibFix && isAdmin() && !ui.imp) {
      app.innerHTML = tabs('students') + siblingFixHtml();
      return;
    }
    var counts = {}, byStatus = { pending: 0, reserve: 0, final: 0 };
    S.students.forEach(function (x) { counts[x.class_name || ''] = (counts[x.class_name || ''] || 0) + 1; byStatus[stStatus(x)]++; });
    var opt = function (value, label, current) { return '<option value="' + esc(value) + '"' + (current === value ? ' selected' : '') + '>' + label + '</option>'; };

    app.innerHTML = tabs('students') +
      (ui.imp ? importPreviewHtml() : ed ? studentFormHtml(st) :
        '<div class="toolbar">' +
          '<button type="button" class="btn primary" data-stedit="new">+ تسجيل طالب</button>' +
          '<button type="button" class="btn" data-checkopen>اكتشاف الأخطاء</button>' +
          menuHtml('أدوات', '<button type="button" class="btn" data-stblank>طباعة استمارة ورقية فارغة</button>' +
          '<button type="button" class="btn" data-scanopen>إدخال من استمارات مصوّرة</button>' +
          (isAdmin() ? '<hr><button type="button" class="btn" data-impopen>استيراد من Excel</button>' +
          '<button type="button" class="btn" data-imptemplate>تنزيل قالب Excel</button>' +
          '<input type="file" id="imp-file" accept=".xlsx,.xls,.csv" hidden>' +
          '<button type="button" class="btn" data-sibfixopen>تصحيح عدد الأبناء في المركز</button>' : '')) +
        '</div>') +
      '<nav class="pills no-print" aria-label="حالة التسجيل">' + [['pending', 'تسجيل مبدئي', byStatus.pending], ['reserve', 'احتياط', byStatus.reserve], ['final', 'تسجيل نهائي', byStatus.final], ['', 'الكل', S.students.length]].map(function (p) {
        return '<button type="button" data-ststatus="' + p[0] + '"' + (ui.stStatus === p[0] ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + p[1] + ' <b>' + p[2] + '</b></button>';
      }).join('') + '</nav>' +
      '<div class="card"><div class="toolbar">' +
        '<input type="search" id="st-search" placeholder="ابحث بالاسم أو رقم الهوية" aria-label="بحث" value="' + esc(ui.stSearch) + '">' +

        '<select id="st-class" aria-label="الصف">' + opt('', 'كل الصفوف', ui.stClass) + opt('-', 'بدون صف (' + (counts[''] || 0) + ')', ui.stClass) +
          schoolClasses().map(function (c) { return opt(c, esc(c) + ' (' + (counts[c] || 0) + ')', ui.stClass); }).join('') + '</select>' +
        '<select id="st-flag" aria-label="معيار إضافي">' + opt('', 'كل الطلاب', ui.stFlag) +
          Object.keys(ST_FLAGS).map(function (k) { return opt(k, ST_FLAGS[k].label, ui.stFlag); }).join('') + '</select>' +
        menuHtml('تصدير', '<button type="button" class="btn" data-stxlsx>تصدير Excel</button>' +
        '<button type="button" class="btn" data-stprint>تصدير PDF / طباعة</button>') +
      '</div><div id="st-table">' + studentsTableHtml() + '</div></div>';
    syncStudentDeps();
  }

  // إخوة الطالب بين كل المسجلين: هوية ولي الأمر نفسها، أو هاتفه، أو اسم الأب والجد والعائلة
  function siblingsOf(st) {
    var digits = function (v) { return String(v || '').replace(/\D/g, '').slice(-10); };
    var gid = String((st.details || {}).guardian_id || '').trim(), phone = digits(st.phone), fam = familyName(st);
    return S.students.filter(function (x) {
      if (x.id === st.id) return false;
      return (gid.length >= 5 && String((x.details || {}).guardian_id || '').trim() === gid) ||
        (phone.length >= 8 && digits(x.phone) === phone) || (fam.split(' ').length >= 3 && familyName(x) === fam);
    });
  }

  // «عدد الأبناء في المركز» يخص الأسرة لا الطالب: ما يُكتب في سجل أحد الإخوة يُعمَّم على سجلات إخوته،
  // فلا يبقى سجل الأخ الأول على «1» بعد تسجيل أخيه. يعيد عدد السجلات التي حُدِّثت
  async function syncSiblingCount(st) {
    var count = (st.details || {}).siblings_here;
    if (count == null || count === '') return 0;
    var changed = 0, list = siblingsOf(st).filter(function (x) { return Number((x.details || {}).siblings_here) !== Number(count); });
    for (var i = 0; i < list.length; i++) {
      var details = Object.assign({}, list[i].details, { siblings_here: count });
      var r = await sb.from('students').update({ details: details }).eq('id', list[i].id);
      if (!r.error) { list[i].details = details; changed++; }
    }
    return changed;
  }

  /* حذف سجل طالب. حذف السجل يحذف معه في القاعدة دفعات المواصلات وعضوية الباص المربوطة به،
     فلا يُحذف سجل له دفعات إلا بعد نقلها إلى سجله الآخر (السجل المكرر برقم الهوية نفسه) */
  async function deleteStudent(st) {
    if (!st) return;
    // الدفعات تُقرأ من القاعدة نفسها لا مما في الصفحة
    var pays = await fetchAll(function () { return sb.from('transport_payments').select('*').eq('student_id', st.id).order('month'); });
    if (!pays && !S.transportMissing) return toast('تعذر التحقق من دفعات الطالب؛ لم يُحذف شيء. أعد المحاولة.', true);
    pays = (pays || []).filter(function (p) { return Number(p.amount) > 0; });
    var member = S.tMembers.filter(function (m) { return m.student_id === st.id; })[0];
    var idKey = latinDigits(String(st.national_id || '')).replace(/\s/g, '');
    var twins = idKey ? S.students.filter(function (x) { return x.id !== st.id && latinDigits(String(x.national_id || '')).replace(/\s/g, '') === idKey; }) : [];
    // السجل الباقي: النهائي إن وُجد
    var keep = twins.filter(function (x) { return stStatus(x) === 'final'; })[0] || twins[0];

    if (pays.length) {
      var sum = pays.reduce(function (a, p) { return a + Number(p.amount); }, 0);
      var what = pays.length + ' دفعة مواصلات بمجموع ' + money(sum) + ' (' + pays.map(function (p) { return tLabel(p.month); }).join('، ') + ')';
      if (!keep) {
        return alert('لا يمكن حذف «' + st.full_name + '»: له ' + what + '.\n\nحذف السجل يحذف دفعاته. إن كان الحذف مقصودًا فاحذف إيصالاته أولًا من شاشة المواصلات (تُحفظ في أرشيف الإيصالات)، أو استردّها.');
      }
      if (!confirm('للطالب «' + st.full_name + '» ' + what + '.\n\nستُنقل الدفعات' + (member ? ' والباص' : '') + ' إلى سجله الآخر (' + ST_STATUS[stStatus(keep)] + (keep.class_name ? ' · ' + keep.class_name : '') + ') ثم يُحذف هذا السجل.\n\nمتابعة؟')) return;
      var theirs = await fetchAll(function () { return sb.from('transport_payments').select('month, amount').eq('student_id', keep.id).order('month'); });
      if (!theirs) return toast('تعذر التحقق من دفعات السجل الآخر؛ لم يُحذف شيء.', true);
      var clash = pays.filter(function (p) { return theirs.some(function (o) { return o.month === p.month; }); });
      if (clash.length) {
        return alert('لم يُحذف شيء: للسجلين دفعة عن الشهر نفسه (' + clash.map(function (p) { return tLabel(p.month); }).join('، ') + ').\nاحذف إيصال أحدهما أو استردّه أولًا ثم أعد المحاولة.');
      }
      var mv = await sb.from('transport_payments').update({ student_id: keep.id }).eq('student_id', st.id);
      if (mv.error) return fail(mv.error);
      await sb.from('transport_refunds').update({ student_id: keep.id }).eq('student_id', st.id); // سجل المستردات يتبع صاحبه إن وُجد
    } else if (!confirm('هل تريد حذف الطالب «' + st.full_name + '» نهائيًا؟' + (member && !keep ? '\n\nسيُزال أيضًا من باصه.' : ''))) {
      return;
    }
    // الباص ونقطة الركوب: ينتقلان إن لم يكن للسجل الباقي باص
    if (member && keep && !S.tMembers.some(function (m) { return m.student_id === keep.id; })) {
      var mm = await sb.from('transport_members').update({ student_id: keep.id }).eq('student_id', st.id);
      if (mm.error) return fail(mm.error);
      if (keep.wants_transport !== true && !S.wantsMissing) {
        var wt = await sb.from('students').update({ wants_transport: true }).eq('id', keep.id);
        if (!wt.error) keep.wants_transport = true;
      }
    }
    var r = await sb.from('students').delete().eq('id', st.id);
    // القاعدة نفسها ترفض حذف طالب له دفعات (supabase/protect_payments.sql)
    if (r.error && r.error.code === '23503') return alert('لم يُحذف «' + st.full_name + '»: له دفعات مواصلات مسجلة في القاعدة.\nاضغط «مزامنة البيانات» ثم احذف إيصالاته أو انقلها أولًا.');
    if (r.error) return fail(r.error);
    S.students = S.students.filter(function (x) { return x.id !== st.id; });
    await loadTransport();
    render();
    toast(pays.length ? 'حُذف السجل ونُقلت دفعاته إلى سجله الآخر' : 'تم الحذف');
  }

  /* ----- اكتشاف الأخطاء في سجلات الطلاب -----
     فحوص تقرأ السجلات ولا تغيّر شيئًا: «خطأ» لما هو خطأ إدخال شبه مؤكد، و«تنبيه» لما يستحق نظرة وقد يكون صحيحًا */

  var CHECKS = {
    age: 'العمر لا يناسب الصف',
    birth: 'تاريخ ميلاد غير معقول',
    dupid: 'رقم هوية مكرر بين طالبين',
    dupname: 'الاسم نفسه في أكثر من سجل (قد يكون الطالب مسجَّلًا مرتين)',
    sameid: 'هوية الطالب هي نفسها هوية ولي الأمر',
    gender: 'جنس الطالب يخالف جنس الشعبة',
    cls: 'شعبة غير موجودة في «إعداد الفصول»',
    grade: 'الشعبة تخالف مرحلة التسجيل',
    last: 'آخر مرحلة اجتازها لا تتسق مع المرحلة التي يسجل فيها',
    core: 'تسجيل نهائي وبيانات أساسية ناقصة',
    phone: 'رقم جوال غير سليم',
    idfmt: 'رقم هوية قصير',
    name: 'اسم غير مكتمل أو فيه أرقام',
    guardian: 'اسم ولي الأمر يختلف بين الإخوة (هوية ولي الأمر واحدة)',
    sibs: '«عدد الأبناء في المركز» أقل من المسجَّلين فعلًا',
    exit: 'تاريخ الخروج من غزة غير معقول',
    cap: 'شعبة فوق سعتها القصوى'
  };

  // الصف رقمًا من اسم شعبة أو مرحلة؛ الروضة و«لم يتم أي مرحلة» صفر
  function gradeNum(v) {
    v = String(v || '');
    return /kg|روض|تمهيد|لم يتم/i.test(v) ? 0 : gradeOf(v);
  }

  // بداية العام الدراسي الذي يجري التسجيل له: الأول من أكتوبر
  function schoolYearStart() {
    var now = new Date();
    return new Date(now.getFullYear() - (now.getMonth() < 5 ? 1 : 0), 9, 1);
  }

  // يعيد [{ sev: 'err' | 'warn', check, x (الطالب أو null), who, text }]
  function studentIssues() {
    var out = [], start = schoolYearStart(), today = todayISO();
    var add = function (sev, check, x, text, who) { out.push({ sev: sev, check: check, x: x, who: who || (x ? x.full_name : ''), text: text }); };
    var digits = function (v) { return latinDigits(String(v == null ? '' : v)).replace(/\D/g, ''); };
    var det = function (x, k) { return String((x.details || {})[k] == null ? '' : (x.details || {})[k]).trim(); };
    var known = classConfig().list, byId = {}, byName = {}, byGuardian = {};
    // المسجَّلون نهائيًا فقط: التسجيل المبدئي لم يُراجَع بعد
    var finals = S.students.filter(function (x) { return enrolled(x); });

    finals.forEach(function (x) {
      var fin = enrolled(x), cg = gradeNum(x.class_name), eg = gradeNum(det(x, 'enroll_grade')), lastText = det(x, 'last_grade');
      var g = cg || eg, where = cg ? 'الشعبة «' + x.class_name + '»' : 'مرحلة التسجيل «' + det(x, 'enroll_grade') + '»';

      // تاريخ الميلاد والعمر
      var b = String(x.birth_date || '').slice(0, 10);
      if (b) {
        var age = (start - new Date(b + 'T00:00')) / (365.25 * 864e5), shown = Math.floor(age * 10) / 10;
        if (b > today) add('err', 'birth', x, 'تاريخ الميلاد ' + dmy(b) + ' في المستقبل');
        else if (age < 3.5 || age > 21) add('err', 'birth', x, 'تاريخ الميلاد ' + dmy(b) + ' (العمر ' + shown + ' سنة عند بداية العام)');
        else if (g) {
          // العمر المعتاد للصف g: من g+5 إلى g+6 سنوات عند بداية العام
          var text = 'تاريخ الميلاد ' + dmy(b) + ' — العمر ' + shown + ' سنة، و' + where + ' (المعتاد ' + (g + 5) + '–' + (g + 6) + ')';
          if (age < g + 3.5 || age > g + 10) add('err', 'age', x, text);
          else if (age < g + 4.5 || age > g + 8) add('warn', 'age', x, text);
        }
      }

      // الهوية
      var id = String(x.national_id || '').replace(/\s/g, ''), idKey = latinDigits(id).toLowerCase(), gid = det(x, 'guardian_id').replace(/\s/g, '');
      if (idKey) (byId[idKey] || (byId[idKey] = [])).push(x);
      if (id && id.length < 6) add('warn', 'idfmt', x, 'رقم هوية الطالب: ' + id);
      if (idKey && latinDigits(gid).toLowerCase() === idKey) add('err', 'sameid', x, 'الرقم ' + id + ' مكتوب للطالب ولولي الأمر');
      if (digits(gid).length >= 5) (byGuardian[digits(gid)] || (byGuardian[digits(gid)] = [])).push(x);

      // الاسم
      var nm = norm(x.full_name || '');
      if (nm) (byName[nm] || (byName[nm] = [])).push(x);
      if (/\d/.test(latinDigits(x.full_name || ''))) add('err', 'name', x, 'في الاسم أرقام');
      else if (nm.split(' ').filter(Boolean).length < 3) add('warn', 'name', x, 'الاسم أقل من ثلاثة مقاطع');

      // الشعبة
      if (x.class_name) {
        var info = classInfo(x.class_name);
        if (!info && known.length && fin) add('warn', 'cls', x, 'الشعبة «' + x.class_name + '»');
        if (info && ((info.gender === 'boys' && x.gender === 'أنثى') || (info.gender === 'girls' && x.gender === 'ذكر'))) {
          add('err', 'gender', x, 'الطالب ' + x.gender + '، والشعبة «' + x.class_name + '» ' + (info.gender === 'boys' ? 'للذكور' : 'للإناث'));
        }
        if (cg && eg && cg !== eg) add('err', 'grade', x, 'الشعبة «' + x.class_name + '»، ومرحلة التسجيل «' + det(x, 'enroll_grade') + '»');
      }
      if (eg && lastText) {
        var lg = gradeNum(lastText);
        if (lg >= eg) add('err', 'last', x, 'اجتاز «' + lastText + '» ويسجل في «' + det(x, 'enroll_grade') + '»');
        else if (eg - lg > 2 && !(lg === 0 && eg <= 2)) add('warn', 'last', x, 'اجتاز «' + lastText + '» ويسجل في «' + det(x, 'enroll_grade') + '» (فرق ' + (eg - lg) + ' صفوف)');
      }

      // التسجيل النهائي
      if (fin) {
        var lacks = [['class_name', 'الشعبة'], ['national_id', 'رقم الهوية'], ['birth_date', 'تاريخ الميلاد'], ['gender', 'الجنس'], ['guardian_name', 'اسم ولي الأمر'], ['phone', 'جوال ولي الأمر']]
          .filter(function (p) { return !String(x[p[0]] == null ? '' : x[p[0]]).trim(); }).map(function (p) { return p[1]; });
        if (!gid) lacks.push('هوية ولي الأمر');
        if (lacks.length) add('err', 'core', x, 'ينقصه: ' + lacks.join('، '));
      }

      // أرقام الجوال: من 10 إلى 14 رقمًا
      [['phone', x.phone, 'جوال ولي الأمر'], ['alt', det(x, 'alt_phone'), 'الجوال البديل'], ['wa', x.whatsapp, 'الواتساب'], ['st', det(x, 'student_phone'), 'جوال الطالب']].forEach(function (p) {
        var raw = String(p[1] == null ? '' : p[1]).trim(), n = digits(raw).length;
        if (!raw || (!n && p[0] !== 'phone')) return; // «لا يوجد» في الخانات الاختيارية
        if (n < 10 || n > 14) add(p[0] === 'phone' ? 'err' : 'warn', 'phone', x, p[2] + ': ' + raw + ' (' + n + ' رقمًا)');
      });

      var exit = det(x, 'gaza_exit').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(exit) && (exit > today || exit < '2000-01-01')) add('err', 'exit', x, 'تاريخ الخروج: ' + dmy(exit));
    });

    Object.keys(byId).forEach(function (k) {
      var list = byId[k];
      if (list.length > 1) list.forEach(function (x) {
        add('err', 'dupid', x, 'الهوية ' + x.national_id + ' مسجلة أيضًا باسم: ' + list.filter(function (o) { return o !== x; }).map(function (o) { return o.full_name; }).join('، '));
      });
    });
    Object.keys(byName).forEach(function (k) {
      var list = byName[k];
      if (list.length > 1 && k.split(' ').length >= 3) list.forEach(function (x) {
        add('warn', 'dupname', x, 'هويته ' + (x.national_id || '—') + '، وميلاده ' + (x.birth_date ? dmy(x.birth_date) : '—') + ' · عدد السجلات بهذا الاسم: ' + list.length);
      });
    });
    Object.keys(byGuardian).forEach(function (k) {
      var list = byGuardian[k], names = {};
      list.forEach(function (x) { var n = norm(x.guardian_name || ''); if (n) names[n] = x.guardian_name; });
      if (Object.keys(names).length > 1) list.forEach(function (x) {
        add('warn', 'guardian', x, 'هوية ولي الأمر ' + k + ' — الاسم هنا: ' + (x.guardian_name || '—'));
      });
    });
    siblingFixPlan(true).changes.forEach(function (c) {
      if (enrolled(c.x) && c.from != null && c.from !== '' && Number(c.from) < c.to) add('warn', 'sibs', c.x, 'المكتوب ' + c.from + '، والمسجَّلون نهائيًا لولي الأمر نفسه ' + c.to);
    });
    var counts = classCounts();
    known.forEach(function (c) {
      if (c.capacity != null && (counts[c.name] || 0) > c.capacity) add('warn', 'cap', null, 'المسجلون نهائيًا ' + counts[c.name] + '، والسعة ' + c.capacity, c.name);
    });
    return out;
  }

  function checkScreenHtml() {
    var all = studentIssues(), sev = ui.check.sev, list = sev ? all.filter(function (i) { return i.sev === sev; }) : all;
    var nErr = all.filter(function (i) { return i.sev === 'err'; }).length, nWarn = all.length - nErr;
    var people = {};
    all.forEach(function (i) { if (i.x) people[i.x.id] = 1; });
    var chip = function (value, label, n) {
      return '<button type="button" class="btn' + (sev === value ? ' primary' : '') + '" data-checksev="' + value + '">' + label + ' (' + n + ')</button>';
    };
    var groups = Object.keys(CHECKS).map(function (k) {
      var rows = list.filter(function (i) { return i.check === k; });
      if (!rows.length) return '';
      rows.sort(function (a, b) { return (a.sev === b.sev ? 0 : a.sev === 'err' ? -1 : 1) || String(a.who).localeCompare(b.who, 'ar'); });
      var hasErr = rows.some(function (i) { return i.sev === 'err'; });
      return '<details class="bank"' + (hasErr ? ' open' : '') + '><summary><span class="badge ' + (hasErr ? 'unpaid' : 'part') + '">' + rows.length + '</span> ' + CHECKS[k] + '</summary>' +
        '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الطالب</th><th>الدرجة</th><th>التفاصيل</th></tr></thead><tbody>' + rows.map(function (i, n) {
          return '<tr><td>' + (n + 1) + '</td><td>' + (i.x
            ? '<button type="button" class="btn link" style="padding:0;text-align:right" data-stedit="' + esc(i.x.id) + '">' + esc(i.who) + '</button>' +
              '<br><span style="color:var(--muted);font-size:.85rem">' + ST_STATUS[stStatus(i.x)] + (i.x.class_name ? ' · ' + esc(i.x.class_name) : '') + '</span>'
            : '<b>' + esc(i.who) + '</b>') + '</td>' +
            '<td><span class="badge ' + (i.sev === 'err' ? 'unpaid' : 'part') + '">' + (i.sev === 'err' ? 'خطأ' : 'تنبيه') + '</span></td><td>' + esc(i.text) + '</td></tr>';
        }).join('') + '</tbody></table></div></details>';
    }).join('');
    return '<button type="button" class="btn link" data-checkclose>→ العودة إلى تسجيل الطلاب</button>' +
      '<div class="card"><h2>اكتشاف الأخطاء في التسجيل النهائي</h2>' +
        '<p class="hint">يُفحص المسجَّلون نهائيًا فقط. الفحص يقرأ السجلات ولا يغيّر شيئًا. «خطأ»: إدخال خاطئ في الغالب. «تنبيه»: يستحق نظرة وقد يكون صحيحًا. اضغط اسم الطالب لفتح سجله وتصحيحه، وبعد الحفظ تعود إلى هذه الشاشة.</p>' +
        '<p class="st-count" style="margin:10px 0">المسجَّلون نهائيًا المفحوصون: ' + S.students.filter(function (x) { return enrolled(x); }).length + ' · سجلات فيها ملاحظات: <b>' + Object.keys(people).length + '</b></p>' +
        '<div class="toolbar">' + chip('', 'الكل', all.length) + chip('err', 'الأخطاء', nErr) + chip('warn', 'التنبيهات', nWarn) +
          '<button type="button" class="btn" data-checkxlsx' + (all.length ? '' : ' disabled') + '>تصدير Excel</button></div>' +
        (groups || '<div class="empty">' + (all.length ? 'لا شيء في هذا التصنيف.' : 'لم يُعثر على أخطاء.') + '</div>') + '</div>';
  }

  async function exportIssuesXlsx() {
    var all = studentIssues();
    if (!all.length) return;
    try {
      await loadXlsx();
      var wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      var ws = XLSX.utils.aoa_to_sheet([[schoolName()], ['أخطاء وتنبيهات سجلات الطلاب — ' + dmy(todayISO())], [],
        ['م', 'الدرجة', 'نوع الملاحظة', 'الطالب', 'رقم الهوية', 'حالة التسجيل', 'الشعبة', 'التفاصيل']].concat(all.map(function (i, n) {
        return [n + 1, i.sev === 'err' ? 'خطأ' : 'تنبيه', CHECKS[i.check], i.who, i.x ? String(i.x.national_id || '') : '', i.x ? ST_STATUS[stStatus(i.x)] : '', i.x ? i.x.class_name || '' : i.who, i.text];
      })));
      ws['!cols'] = [5, 8, 44, 32, 16, 14, 14, 70].map(function (w) { return { wch: w }; });
      XLSX.utils.book_append_sheet(wb, ws, 'الملاحظات');
      XLSX.writeFile(wb, 'أخطاء-سجلات-الطلاب-' + todayISO() + '.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ----- تصحيح «عدد الأبناء في المركز» للسجلات القديمة (مدير النظام) -----
     يُجمع الطلاب برقم هوية ولي الأمر، ويُجعل العدد في سجل كل واحد منهم عدد أبناء ولي أمره المسجلين */

  // finalOnly: يُحتسب المسجلون نهائيًا فقط. يعيد السجلات التي سيتغير عددها، وعدد من لا هوية ولي أمر لهم
  function siblingFixPlan(finalOnly) {
    var groups = {}, missing = 0, changes = [], families = 0;
    S.students.forEach(function (x) {
      var gid = latinDigits(String((x.details || {}).guardian_id || '')).replace(/\D/g, '');
      if (gid.length < 5) { missing++; return; }
      (groups[gid] || (groups[gid] = [])).push(x);
    });
    Object.keys(groups).forEach(function (gid) {
      var list = groups[gid], n = finalOnly ? list.filter(function (x) { return enrolled(x); }).length : list.length;
      families++;
      if (!n) return; // لا أحد من أبنائه مسجَّل نهائيًا بعد
      list.forEach(function (x) {
        var cur = (x.details || {}).siblings_here;
        if (cur == null || cur === '' || Number(cur) !== n) changes.push({ x: x, gid: gid, from: cur, to: n });
      });
    });
    changes.sort(function (a, b) { return a.gid.localeCompare(b.gid) || a.x.full_name.localeCompare(b.x.full_name, 'ar'); });
    return { changes: changes, missing: missing, families: families };
  }

  function siblingFixHtml() {
    var fix = ui.sibFix, plan = siblingFixPlan(fix.finalOnly), prev = '';
    var rows = plan.changes.map(function (c, i) {
      var first = c.gid !== prev;
      prev = c.gid;
      return '<tr' + (first && i ? ' style="border-top:2px solid var(--line)"' : '') + '><td>' + (i + 1) + '</td><td dir="ltr" style="text-align:right">' + (first ? esc(c.gid) : '') + '</td>' +
        '<td><b>' + esc(c.x.full_name) + '</b><br><span style="color:var(--muted);font-size:.85rem">' + ST_STATUS[stStatus(c.x)] + (c.x.class_name ? ' · ' + esc(c.x.class_name) : '') + '</span></td>' +
        '<td>' + (c.from == null || c.from === '' ? '—' : esc(c.from)) + '</td><td><b>' + c.to + '</b></td></tr>';
    }).join('');
    return '<button type="button" class="btn link" data-sibfixclose>→ العودة إلى تسجيل الطلاب</button>' +
      '<div class="card"><h2>تصحيح «عدد الأبناء في المركز»</h2>' +
        '<p class="hint">يُجمع الطلاب برقم هوية ولي الأمر، ويُكتب في سجل كل طالب عدد أبناء ولي أمره المسجلين في البرنامج. لا يتغير أي حقل آخر. يُستحسن تنزيل نسخة احتياطية قبل التطبيق.</p>' +
        '<label class="check"><input type="checkbox" id="sibfix-final"' + (fix.finalOnly ? ' checked' : '') + (fix.busy ? ' disabled' : '') + '>احتسب المسجَّلين نهائيًا فقط (بدونه يُحتسب المبدئيون أيضًا)</label>' +
        '<p class="st-count" style="margin:10px 0">أولياء الأمور: ' + plan.families + ' · سجلات سيتغير عددها: <b>' + plan.changes.length + '</b>' +
          (plan.missing ? ' · طلاب بلا رقم هوية ولي أمر (لا يشملهم التصحيح): ' + plan.missing : '') + '</p>' +
        (fix.msg ? '<p class="formhint">' + esc(fix.msg) + '</p>' : '') +
        (rows
          ? '<div class="actions" style="margin:0 0 12px"><button type="button" class="btn primary" data-sibfixapply' + (fix.busy ? ' disabled' : '') + '>' + (fix.busy ? 'جارٍ التحديث…' : 'تطبيق التصحيح على ' + plan.changes.length + ' سجلًا') + '</button></div>' +
            '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>هوية ولي الأمر</th><th>الطالب</th><th>العدد الحالي</th><th>العدد الجديد</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
          : '<div class="empty">كل السجلات التي لها رقم هوية ولي أمر عددها صحيح.</div>') + '</div>';
  }

  async function applySiblingFix() {
    var fix = ui.sibFix, plan = siblingFixPlan(fix.finalOnly);
    if (!plan.changes.length) return;
    if (!confirm('تحديث «عدد الأبناء في المركز» في ' + plan.changes.length + ' سجلًا؟')) return;
    fix.busy = true; fix.msg = '';
    render();
    var done = 0, failed = 0;
    for (var i = 0; i < plan.changes.length; i++) {
      var c = plan.changes[i], details = Object.assign({}, c.x.details, { siblings_here: c.to });
      var r = await sb.from('students').update({ details: details }).eq('id', c.x.id);
      if (r.error) failed++; else { c.x.details = details; done++; }
    }
    fix.busy = false;
    fix.msg = 'حُدِّث ' + done + ' سجلًا' + (failed ? '، وتعذّر تحديث ' + failed + ' (تظهر في الجدول؛ أعد المحاولة)' : '') + '.';
    render();
    toast('حُدِّث ' + done + ' سجلًا', !!failed);
  }

  // mode: 'final' يعتمد التسجيل النهائي (بعد اكتمال البيانات والصف)، 'save' يحفظ فقط
  async function saveStudentForm(mode) {
    var st = ui.editStudent !== 'new' ? findStudent(ui.editStudent) : null, data = {};
    // الحقول الجديدة تُحفظ معًا في details؛ ما ليس في النموذج من قيمها السابقة يبقى
    data.details = Object.assign({}, st && st.details);
    ST_FIELDS.forEach(function (f) {
      var v = document.getElementById('sf-' + f.k).value.trim();
      v = f.type === 'date' ? (v || null) : f.type === 'number' ? (v === '' ? null : Number(v)) : f.num ? latinDigits(v) : v;
      if (f.x) data.details[f.k] = v; else data[f.k] = v;
    });
    if (data.details.housing !== 'يدفع') data.details.rent = '';
    delete data.details.neighborhood; // صار جزءًا من العنوان التفصيلي المحفوظ الآن
    data.memorizes_quran = data.quran_parts == null ? null : data.quran_parts > 0;
    data.documents = {};
    Array.prototype.forEach.call(app.querySelectorAll('[name="sf-doc"]:checked'), function (c) { data.documents[c.value] = true; });
    data.documents_note = document.getElementById('sf-docnote').value.trim();

    var wantsEl = document.getElementById('sf-wants'), rideEl = document.getElementById('sf-transport');
    if (wantsEl) data.wants_transport = rideEl.value || wantsEl.value === 'yes' ? true : wantsEl.value === 'no' ? false : null;

    if (!data.full_name) return toast('اكتب اسم الطالب.', true);
    var wasFinal = st && stStatus(st) === 'final';
    var welcomeEl = document.getElementById('sf-welcome'), sendWelcome = mode === 'final' && !wasFinal && !!(welcomeEl && welcomeEl.checked);
    // شعبة ممتلئة أو لجنس آخر: تنبيه، والمتابعة ممكنة
    var classChanged = !st || String(st.class_name || '') !== String(data.class_name || '');
    if ((mode === 'final' && (!wasFinal || classChanged) || mode === 'edit' && classChanged) && data.class_name && !confirmClass(data.class_name, st, data.gender)) return;
    if (mode === 'final' && !wasFinal) {
      var missing = ST_DOCS.filter(function (d) { return !data.documents[d[0]]; }).map(function (d) { return d[1]; });
      if (missing.length && !confirm('لم تُسجَّل هذه المستندات: ' + missing.join('، ') + '.\nهل تريد اعتماد التسجيل النهائي مع ذلك؟')) return;
      data.status = 'final';
      data.finalized_at = new Date().toISOString();
      delete data.details.scan; // روجع على الورقة
    } else if (mode === 'reserve' && !wasFinal) {
      // احتياط: قائمة انتظار، لا يُحتسب في الشعب ولا الباصات. يُحفظ وقت دخوله القائمة لترتيبها
      if (!(st && stStatus(st) === 'reserve')) data.details.reserve_at = new Date().toISOString();
      data.status = 'reserve';
    } else if (!st) {
      data.status = 'pending';
    }

    // الباصات للمسجَّلين نهائيًا فقط: لغيرهم يُحفظ الباص المختار في السجل حتى اعتماد التسجيل النهائي
    var willBeFinal = ['final', 'reserve'].indexOf(data.status || (st && st.status)) > -1, pickNow = document.getElementById('sf-transport');
    if (pickNow) {
      if (willBeFinal) delete data.details.bus_wish;
      else data.details.bus_wish = pickNow.value || '';
    }
    // تعديل سجل موجود: تُرسل الحقول التي تغيّرت فقط، فلا يُكتب فوق ما عدّله غيرك في الأثناء
    var changed = 0;
    if (st) {
      // الفارغ واحد: لا قيمة، أو نص فارغ، أو قائمة/كائن فارغ
      var blank = function (v) { return v == null || v === '' || (typeof v === 'object' && !Object.keys(v).length) ? '' : v; };
      var same = function (p, q) { return JSON.stringify(blank(p)) === JSON.stringify(blank(q)); }, diff = {}, old = st.details || {};
      Object.keys(data).forEach(function (k) {
        if (k === 'details') {
          var dk = Object.keys(Object.assign({}, data.details, old)).filter(function (key) { return !same(data.details[key], old[key]); });
          if (dk.length) { diff.details = data.details; changed += dk.length; }
        } else if (!same(data[k], st[k])) { diff[k] = data[k]; changed++; }
      });
      data = diff;
    }
    var r = st
      ? (changed ? await sb.from('students').update(data).eq('id', st.id) : { error: null })
      : await sb.from('students').insert(data).select().single();
    if (r.error) {
      return /duplicate|unique/i.test(r.error.message) ? toast('رقم الهوية مسجل نهائيًا لطالب آخر.', true) : fail(r.error);
    }
    if (st) Object.assign(st, data); else S.students.push(st = r.data);
    S.students.sort(function (a, b) { return a.full_name.localeCompare(b.full_name, 'ar'); });

    var pick = document.getElementById('sf-transport');
    if (pick) {
      var was = transportGroupOf()[st.id] || '', want = pick.value, tr = null;
      if (want && want !== was && !willBeFinal) {
        // لا يُضاف إلى الباص قبل التسجيل النهائي؛ اختياره محفوظ في السجل
      } else if (want && want !== was) {
        tr = await sb.from('transport_members').upsert(memberRow(st.id, want), { onConflict: 'student_id' });
      } else if (!want && was) {
        tr = await sb.from('transport_members').delete().eq('student_id', st.id);
      }
      if (tr && tr.error) {
        // بيانات الطالب حُفظت؛ المواصلات لم تتغير
        ui.editStudent = st.id;
        render();
        return fail(tr.error);
      }
      if (tr) {
        S.tMembers = S.tMembers.filter(function (m) { return m.student_id !== st.id; });
        if (want) S.tMembers.push({ student_id: st.id, group_id: want, share: null });
      }
    }
    var synced = await syncSiblingCount(st);
    ui.editStudent = null;
    render();
    if (sendWelcome) waSendWelcome(st);
    toast((data.status === 'final' ? 'تم اعتماد التسجيل النهائي' : st && mode !== 'final' ? (changed ? 'حُفظت التعديلات (' + changed + ')' : 'لا تعديلات للحفظ') : 'تم الحفظ') + (synced ? ' — حُدِّث «عدد الأبناء في المركز» في سجلات إخوته (' + synced + ')' : ''));
  }

  /* ----- الاستيراد من Excel ----- */

  // مكتبة قراءة Excel تُحمَّل عند الحاجة فقط
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      sc.onload = resolve;
      sc.onerror = function () { reject(new Error('تعذر تحميل مكتبة قراءة Excel')); };
      document.head.appendChild(sc);
    });
  }

  function parseYesNo(x) {
    x = norm(x);
    if (!x) return null;
    if (/^(نعم|yes|true|1|ايوه|اه)/.test(x)) return true;
    if (/^(لا|no|false|0)/.test(x)) return false;
    return null;
  }

  // يقبل 2015-03-21 أو 21/3/2015 (اليوم أولًا)، ويرفض السنوات غير المعقولة لطالب
  function parseDate(x) {
    x = latinDigits(x);
    var m = x.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/), y, mo, d;
    if (m) { y = m[1]; mo = m[2]; d = m[3]; }
    else if ((m = x.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/))) { d = m[1]; mo = m[2]; y = m[3]; }
    else return null;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > new Date().getFullYear() - 2) return null;
    return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
  }

  function parseOrphanOf(x) {
    x = norm(x);
    if (!x) return '';
    if (/اثنين|كلا|معا|ابوين|والدين/.test(x) || (/اب/.test(x) && /ام/.test(x))) return 'الاثنين معًا';
    if (/ام/.test(x)) return 'الأم';
    if (/اب/.test(x)) return 'الأب';
    return '';
  }

  function parseGender(x) {
    x = norm(x);
    return /^(ذكر|ولد|male|m$)/.test(x) ? 'ذكر' : /^(انثي|بنت|female|f$)/.test(x) ? 'أنثى' : '';
  }

  // Excel يحذف الصفر الأول من أرقام الجوال المخزّنة كأرقام
  function parsePhone(x) {
    x = latinDigits(x).replace(/[\s-]/g, '');
    // رقم فلسطيني 5xxxxxxxx أو مصري 1xxxxxxxxx
    return /^(5\d{8}|1[0125]\d{8})$/.test(x) ? '0' + x : x;
  }

  async function readImportFile(file) {
    try {
      await loadXlsx();
      var wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      var raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
      if (!raw.length) return toast('الملف لا يحتوي على بيانات.', true);

      // مطابقة عناوين الأعمدة مع حقول الاستمارة
      var headers = Object.keys(raw[0]), col = {}, used = {};
      ST_MATCH_ORDER.forEach(function (k) {
        if (col[k]) return;
        var f = stField(k);
        for (var i = 0; i < headers.length; i++) {
          var h = norm(headers[i]);
          if (!used[headers[i]] && f.match.some(function (w) { return h.indexOf(w) > -1; })) {
            col[k] = headers[i]; used[headers[i]] = true; break;
          }
        }
      });
      if (!col.full_name) return toast('لم يُعثر في الملف على عمود «اسم الطالب».', true);
      // ملفات ردود النماذج فيها طابع زمني لكل رد: يُعرَف به الرد عند إعادة الاستيراد
      var stamp = headers.filter(function (h) { return /timestamp|طابع زمني/.test(norm(h)); })[0];
      if (stamp) used[stamp] = true;

      var haveKey = {}, haveId = {};
      S.students.forEach(function (x) { if (x.form_key) haveKey[x.form_key] = true; if (x.national_id) haveId[x.national_id] = true; });

      var rows = [], flags = [], errors = [], seenId = {}, skipped = 0;
      raw.forEach(function (row, i) {
        var get = function (k) {
          var x = col[k] ? row[col[k]] : '';
          // خلايا التاريخ تصل ككائن Date (منتصف الليل UTC مع انحراف بسيط أحيانًا)
          if (x instanceof Date) return new Date(x.getTime() + 12 * 3600e3).toISOString().slice(0, 10);
          // تُحذف علامات الاتجاه غير المرئية التي تُلصق مع الأرقام المنسوخة
          return String(x).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
        };
        var answers = {};
        IMPORT_FIELDS.forEach(function (f) { var a = get(f.k); if (a) answers[f.k] = a; });
        // رقم الهوية: أرقام فقط إن أمكن، وإلا النص كما كُتب ليُصحَّح عند المراجعة
        var idDigits = latinDigits(get('national_id')).replace(/[\s-]/g, '');
        var validId = /^\d{5,20}$/.test(idDigits);
        var ts = stamp ? row[stamp] : '';
        var parts = parseFloat(latinDigits(get('quran_parts')));
        var d = {
          full_name: get('full_name').replace(/\s+/g, ' '),
          national_id: validId ? idDigits : '',
          gender: parseGender(get('gender')),
          phone: parsePhone(get('phone')),
          whatsapp: parsePhone(get('whatsapp')),
          email: get('email'),
          birth_date: parseDate(get('birth_date')),
          address: get('address'),
          class_name: '',
          requested_class: get('class_name'),
          has_prev_certificate: parseYesNo(get('has_prev_certificate')),
          prev_grade: get('prev_grade'),
          guardian_name: get('guardian_name'),
          guardian_relation: get('guardian_relation'),
          guardian_job: get('guardian_job'),
          has_health_condition: parseYesNo(get('has_health_condition')),
          takes_medication: parseYesNo(get('takes_medication')),
          has_special_needs: parseYesNo(get('has_special_needs')),
          is_orphan: parseYesNo(get('is_orphan')),
          orphan_of: parseOrphanOf(get('orphan_of')),
          memorizes_quran: parseYesNo(get('memorizes_quran')),
          quran_parts: !isNaN(parts) && parts >= 0 && parts <= 30 ? parts : null,
          status: 'pending',
          form_key: ts instanceof Date ? ts.toISOString() : (ts === '' ? null : String(ts)),
          form_answers: answers
        };
        if (!d.is_orphan) d.orphan_of = '';
        if (!d.full_name && !Object.keys(answers).length) return; // صف فارغ
        if (!d.full_name) return errors.push('الصف ' + (i + 2) + ': اسم الطالب ناقص');
        // لا تُعدَّل بيانات من سبق استيراده: يُعرَف برد الاستمارة، أو برقم الهوية في الملفات الأخرى
        if (d.form_key ? haveKey[d.form_key] : (d.national_id && haveId[d.national_id])) return skipped++;
        // known: رقم هويته موجود في البرنامج (يُتخطى أو يُضاف بحسب خيار المعاينة). dup: تكرر رقمه داخل الملف نفسه
        flags.push({ known: !!(d.national_id && haveId[d.national_id]), dup: !!(d.national_id && seenId[d.national_id]) });
        if (d.national_id) seenId[d.national_id] = true;
        rows.push(d);
      });

      ui.imp = {
        file: file.name, rows: rows, flags: flags, skipKnown: true, errors: errors, skipped: skipped,
        mapped: IMPORT_FIELDS.filter(function (f) { return col[f.k]; }).map(function (f) { return f.k; }),
        unmapped: headers.filter(function (h) { return !used[h]; })
      };
      render();
    } catch (err) {
      toast('تعذر قراءة الملف: ' + err.message, true);
    }
  }

  // الصفوف التي ستُستورد فعلًا بحسب خيار «تخطي من رقم هويته موجود»
  function importRows() {
    var p = ui.imp;
    return p.rows.filter(function (r, i) { return !(p.skipKnown && p.flags[i].known); });
  }

  async function runImport() {
    var rows = importRows();
    for (var i = 0; i < rows.length; i += 100) {
      var r = await sb.from('students').insert(rows.slice(i, i + 100));
      if (r.error) { await loadStudents(); render(); return fail(r.error); }
    }
    await loadStudents();
    ui.imp = null;
    ui.stStatus = 'pending';
    render();
    toast('تم استيراد الطلاب (' + rows.length + ') بحالة تسجيل مبدئي');
  }

  async function downloadTemplate() {
    try {
      await loadXlsx();
      var ws = XLSX.utils.aoa_to_sheet([IMPORT_FIELDS.map(function (f) { return f.label; })]);
      ws['!cols'] = IMPORT_FIELDS.map(function () { return { wch: 26 }; });
      var wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      XLSX.utils.book_append_sheet(wb, ws, 'الطلاب');
      XLSX.writeFile(wb, 'قالب-تسجيل-الطلاب.xlsx');
    } catch (err) {
      toast(err.message, true);
    }
  }

  document.addEventListener('click', async function (e) {
    if (!canStudents() || location.hash !== '#/students') return;
    var el, st, r;
    if ((el = e.target.closest('[data-checkopen]'))) {
      // الفحص على ما في القاعدة الآن، لا على ما كان عند فتح الصفحة
      el.disabled = true;
      syncData(true).then(function () {
        ui.check = { sev: '' };
        render();
        window.scrollTo(0, 0);
      });
    } else if (e.target.closest('[data-checkclose]')) {
      ui.check = null;
      render();
    } else if ((el = e.target.closest('[data-checksev]')) && ui.check) {
      ui.check.sev = el.getAttribute('data-checksev');
      render();
    } else if (e.target.closest('[data-checkxlsx]')) {
      exportIssuesXlsx();
    } else if (isAdmin() && e.target.closest('[data-sibfixopen]')) {
      ui.sibFix = { finalOnly: false, busy: false, msg: '' };
      render();
    } else if (e.target.closest('[data-sibfixclose]')) {
      if (ui.sibFix && ui.sibFix.busy) return;
      ui.sibFix = null;
      render();
    } else if (isAdmin() && e.target.closest('[data-sibfixapply]')) {
      applySiblingFix();
    } else if (e.target.closest('[data-scanopen]')) {
      ui.scan = ui.scan || { items: [], manual: false, running: false };
      render();
    } else if (e.target.closest('[data-scanclose]')) {
      if (ui.scan && ui.scan.running && !confirm('القراءة جارية. إغلاق الشاشة يوقف ما لم يُقرأ بعد. هل تريد الإغلاق؟')) return;
      ui.scan = null;
      ui.stStatus = 'pending';
      render();
    } else if (e.target.closest('[data-scanpick]')) {
      document.getElementById('scan-files').click();
    } else if (e.target.closest('[data-scancopy]')) {
      var promptText = scanPromptText();
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(promptText).then(function () { toast('نُسخت التعليمات'); }, function () { toast('تعذر النسخ', true); });
      else toast('تعذر النسخ في هذا المتصفح', true);
    } else if (e.target.closest('[data-scanpaste]')) {
      saveScanPaste();
    } else if ((el = e.target.closest('[data-sibcopy]'))) {
      copyFromSibling(el.getAttribute('data-sibcopy'));
    } else if ((el = e.target.closest('[data-sfnone]'))) {
      document.getElementById('sf-' + el.getAttribute('data-sfnone')).value = 'لا يوجد';
    } else if (e.target.closest('[data-stblank]')) {
      pendingBlank = true;
      printNow();
    } else if ((el = e.target.closest('[data-stedit]'))) {
      ui.sibSearch = '';
      ui.editStudent = el.getAttribute('data-stedit') || null;
      render();
      var first = document.getElementById('sf-full_name');
      if (first) { first.focus(); window.scrollTo(0, 0); }
    } else if ((el = e.target.closest('[data-ststatus]'))) {
      ui.stStatus = el.getAttribute('data-ststatus');
      render();
    } else if ((el = e.target.closest('[data-stprofile]'))) {
      pendingProfile = findStudent(el.getAttribute('data-stprofile'));
      printNow();
    } else if ((el = e.target.closest('[data-stunfinal]'))) {
      st = findStudent(el.getAttribute('data-stunfinal'));
      if (!confirm('إعادة تسجيل «' + st.full_name + '» إلى التسجيل المبدئي؟')) return;
      r = await sb.from('students').update({ status: 'pending', finalized_at: null }).eq('id', st.id);
      if (r.error) return fail(r.error);
      st.status = 'pending'; st.finalized_at = null;
      render();
    } else if (isAdmin() && (el = e.target.closest('[data-stdel]'))) {
      deleteStudent(findStudent(el.getAttribute('data-stdel')));
    } else if (e.target.closest('[data-stxlsx]')) {
      exportStudentsXlsx();
    } else if (e.target.closest('[data-stprint]')) {
      if (!filteredStudents().length) return toast('لا يوجد طلاب مطابقون للطباعة.', true);
      printNow();
    } else if (e.target.closest('[data-impopen]')) {
      document.getElementById('imp-file').click();
    } else if (e.target.closest('[data-imptemplate]')) {
      downloadTemplate();
    } else if (e.target.closest('[data-impcancel]')) {
      ui.imp = null;
      render();
    } else if ((el = e.target.closest('[data-impgo]'))) {
      el.disabled = true;
      el.textContent = 'جارٍ الاستيراد…';
      runImport();
    }
  });

  app.addEventListener('change', async function (e) {
    if (!canStudents() || location.hash !== '#/students') return;
    var el = e.target;
    if (el.id === 'sibfix-final' && ui.sibFix) {
      ui.sibFix.finalOnly = el.checked;
      ui.sibFix.msg = '';
      render();
    } else if (el.id === 'scan-model' && ui.scan) {
      ui.scan.otherModel = el.value === '__other';
      setScanModel(ui.scan.otherModel ? '' : el.value);
      render();
      var otherBox = document.getElementById('scan-model-other');
      if (otherBox) otherBox.focus();
    } else if (el.id === 'scan-model-other') {
      setScanModel(el.value);
    } else if (el.id === 'scan-dry' && ui.scan) {
      ui.scan.dry = el.checked;
    } else if (el.id === 'scan-files') {
      if (el.files.length) runScanQueue(el.files);
    } else if (el.id === 'imp-skipknown' && ui.imp) {
      ui.imp.skipKnown = el.checked;
      render();
    } else if (el.id === 'imp-file') {
      if (el.files[0]) readImportFile(el.files[0]);
    } else if (el.id === 'st-class' || el.id === 'st-flag') {
      ui[{ 'st-class': 'stClass', 'st-flag': 'stFlag' }[el.id]] = el.value;
      document.getElementById('st-table').innerHTML = studentsTableHtml();
    } else if (el.hasAttribute('data-stclass')) {
      var st = findStudent(el.getAttribute('data-stclass'));
      if (!el.value) { el.value = st.class_name; return toast('الطالب المسجل نهائيًا يجب أن يكون في صف.', true); }
      if (!confirmClass(el.value, st, st.gender)) { el.value = st.class_name; return; }
      var r = await sb.from('students').update({ class_name: el.value }).eq('id', st.id);
      if (r.error) { el.value = st.class_name; return fail(r.error); }
      st.class_name = el.value;
      toast('تم الحفظ');
    } else if (el.type === 'radio' && el.closest('#student-form')) {
      syncStudentDeps();
    } else if (el.id === 'sf-wants' || el.id === 'sf-transport') {
      // «لا يحتاج مواصلات» يلغي نقطة التجمع، واختيار نقطة تجمع يعني أنه يحتاجها
      var w = document.getElementById('sf-wants'), g = document.getElementById('sf-transport');
      if (el.id === 'sf-wants' && w.value === 'no') g.value = '';
      if (el.id === 'sf-transport' && g.value && w) w.value = 'yes';
    }
  });

  app.addEventListener('change', function (e) {
    if (!e.target.closest || !e.target.closest('#student-form')) return;
    syncStudentDeps();
    if (e.target.id === 'sf-class_name' || e.target.id === 'sf-gender') {
      var cur = ui.editStudent && ui.editStudent !== 'new' ? findStudent(ui.editStudent) : null;
      document.getElementById('sf-class-hint').innerHTML = classHintHtml(document.getElementById('sf-class_name').value, cur, document.getElementById('sf-gender').value);
    }
  });

  app.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.target.id !== 'sib-search') return;
    e.preventDefault();
    var only = document.querySelectorAll('#sib-results [data-sibcopy]');
    if (only.length === 1) copyFromSibling(only[0].getAttribute('data-sibcopy'));
  });

  app.addEventListener('input', function (e) {
    if (e.target.id === 'sib-search' && canStudents()) {
      ui.sibSearch = e.target.value;
      document.getElementById('sib-results').innerHTML = siblingListHtml(draftStudent());
      return;
    }
    if ((e.target.id === 'sf-full_name' || e.target.id === 'sf-phone' || e.target.id === 'sf-guardian_id') && canStudents()) return refreshSiblingBox();
    if (e.target.id !== 'st-search' || !canStudents()) return;
    ui.stSearch = e.target.value;
    document.getElementById('st-table').innerHTML = studentsTableHtml();
  });

  /* ---------- الطلاب حسب الشعب (مدير النظام) ---------- */

  // الشعبة المفتوحة كما في العنوان: #/classes/<الاسم>
  function currentClass() {
    var m = location.hash.match(/^#\/classes\/(.+)$/);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (err) { return null; }
  }

  // طلاب الشعبة المسجلون نهائيًا، مرتبين بالاسم
  function classStudents(name) {
    return S.students.filter(function (x) { return enrolled(x) && x.class_name === name; })
      .sort(function (a, b) { return a.full_name.localeCompare(b.full_name, 'ar'); });
  }

  function classTableHtml(name) {
    var q = norm(ui.clsSearch);
    var list = classStudents(name), shown = list.filter(function (x) {
      return !q || norm(x.full_name).indexOf(q) > -1 || String(x.national_id || '').indexOf(latinDigits(ui.clsSearch)) > -1;
    });
    var rows = shown.map(function (x) {
      return '<tr><td>' + (list.indexOf(x) + 1) + '</td><td><b>' + esc(x.full_name) + '</b>' + rsvMark(x) + '</td>' +
        '<td dir="ltr" style="text-align:right">' + esc(x.national_id || '—') + '</td><td>' + esc(x.gender || '—') + '</td>' +
        '<td dir="ltr" style="text-align:right">' + esc(x.phone || '—') + '</td><td>' + esc(x.guardian_name || '—') + '</td>' +
        '<td class="no-print"><select data-cmove="' + x.id + '" aria-label="نقل ' + esc(x.full_name) + ' إلى شعبة أخرى">' +
          schoolClasses().map(function (c) { return '<option' + (c === name ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></td>' +
        '<td class="no-print" style="white-space:nowrap"><button type="button" class="btn" data-cprofile="' + x.id + '">ملف الطالب</button> ' +
        '<button type="button" class="btn" data-cedit="' + x.id + '">تعديل</button></td></tr>';
    }).join('');
    return rows
      ? '<div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الاسم</th><th>رقم الهوية</th><th>الجنس</th><th>الهاتف</th><th>ولي الأمر</th>' +
        '<th class="no-print">الشعبة</th><th class="no-print"></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="empty">' + (list.length ? 'لا توجد نتائج مطابقة.' : 'لا يوجد طلاب مسجلون نهائيًا في هذه الشعبة بعد.') + '</div>';
  }

  function renderClasses() {
    if (S.studentsMissing || S.regMissing) return renderStudents();
    var name = currentClass(), classes = schoolClasses();
    var finals = S.students.filter(function (x) { return enrolled(x); });

    if (name && (classes.indexOf(name) > -1 || classStudents(name).length)) {
      var list = classStudents(name);
      var boys = list.filter(function (x) { return x.gender === 'ذكر'; }).length, girls = list.filter(function (x) { return x.gender === 'أنثى'; }).length;
      app.innerHTML = tabs('classes') +
        '<a class="btn link no-print" href="#/classes">→ العودة إلى الشعب</a>' +
        '<div class="eval-head"><div><h2>' + esc(name) + '</h2><div class="sub">عدد الطلاب: ' + list.length +
          (boys || girls ? ' · ذكور: ' + boys + ' · إناث: ' + girls : '') + '</div></div>' +
          '<div class="no-print"><button type="button" class="btn primary" data-cprint' + (list.length ? '' : ' disabled') + '>طباعة كشف الشعبة</button></div></div>' +
        '<div class="card"><div class="toolbar no-print"><input type="search" id="cls-search" placeholder="ابحث بالاسم أو رقم الهوية" aria-label="بحث" value="' + esc(ui.clsSearch) + '"></div>' +
        '<div id="cls-table">' + classTableHtml(name) + '</div></div>';
      return;
    }

    var counts = {};
    finals.forEach(function (x) { counts[x.class_name] = (counts[x.class_name] || 0) + 1; });
    // صفوف لم تعد في قائمة المدرسة لكن فيها طلاب تبقى ظاهرة
    var all = classes.concat(Object.keys(counts).filter(function (c) { return c && classes.indexOf(c) < 0; }));
    var pending = S.students.length - finals.length;
    app.innerHTML = tabs('classes') +
      '<div class="toolbar"><button type="button" class="btn" data-regbook' + (finals.length ? '' : ' disabled') + '>تصدير كشوف التسجيل (Excel)</button></div>' +
      '<p class="st-count">المسجلون نهائيًا: ' + finals.length + ' في ' + all.length + ' شعبة' +
        (pending ? ' · <a href="#/students">تسجيلات مبدئية بانتظار الاعتماد: ' + pending + '</a>' : '') + '</p>' +
      (all.length
        ? '<div class="stats">' + all.map(function (c) {
            var info = classInfo(c), n = counts[c] || 0, cap = info ? info.capacity : null;
            return '<a class="card stat" href="#/classes/' + encodeURIComponent(c) + '"><span class="lbl">' + esc(c) + '</span>' +
              '<span class="num"' + (cap != null && n > cap ? ' style="color:var(--red)"' : '') + '>' + n + (cap != null ? ' <small>/ ' + cap + '</small>' : '') + '</span>' +
              '<span class="sub">' + (info && info.gender ? CLASS_GENDERS[info.gender] + ' · ' : '') +
                (cap == null ? 'مسجلون نهائيًا' : n > cap ? 'تجاوز السعة بـ ' + (n - cap) : n === cap ? 'ممتلئة' : 'المتاح ' + (cap - n)) + '</span></a>';
          }).join('') + '</div>'
        : '<div class="card empty">لم تُعرَّف شعب المدرسة بعد. يعرّفها مدير النظام من «إعداد الفصول».</div>');
  }

  document.addEventListener('click', function (e) {
    if (!(canStudents() || (isSup() && !e.target.closest('[data-cedit]'))) || !/^#\/classes/.test(location.hash)) return;
    var el;
    if ((el = e.target.closest('[data-cprofile]'))) {
      pendingProfile = findStudent(el.getAttribute('data-cprofile'));
      printNow();
    } else if ((el = e.target.closest('[data-cedit]'))) {
      // التعديل في شاشة التسجيل نفسها
      ui.editStudent = el.getAttribute('data-cedit');
      go('#/students');
    } else if (e.target.closest('[data-cprint]')) {
      printNow();
    } else if ((el = e.target.closest('[data-regbook]'))) {
      exportRegistrationWorkbook(el);
    }
  });

  app.addEventListener('change', async function (e) {
    var el = e.target, name = currentClass();
    if (!canStudents() || !name || !el.hasAttribute('data-cmove')) return;
    var st = findStudent(el.getAttribute('data-cmove'));
    if (!confirm('نقل «' + st.full_name + '» من «' + name + '» إلى «' + el.value + '»؟') || !confirmClass(el.value, st, st.gender)) { el.value = name; return; }
    var r = await sb.from('students').update({ class_name: el.value }).eq('id', st.id);
    if (r.error) { el.value = name; return fail(r.error); }
    st.class_name = el.value;
    render();
    toast('تم نقل الطالب');
  });

  app.addEventListener('input', function (e) {
    var name = currentClass();
    if (e.target.id !== 'cls-search' || !name) return;
    ui.clsSearch = e.target.value;
    document.getElementById('cls-table').innerHTML = classTableHtml(name);
  });

