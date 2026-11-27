'use strict';
  /* ---------- الاختبارات والدرجات: شاشة واحدة بتبويبات ----------
     رصد الدرجات، رصد الاختبارات (المعلم)، الاختبارات، الأوائل، متابعة الرصد. كل تبويب هو الشاشة نفسها بمسارها ومفتاح صلاحيتها كما كانت،
     فلا تتغير الصلاحيات الممنوحة؛ يتغير العرض فقط: بند واحد في القائمة الجانبية، وشريط تبويبات أعلى كل شاشة منها يظهر منه ما يحق للمستخدم. */
  var ASSESS_TABS = [['grades', 'رصد الدرجات'], ['examgrades', 'رصد الاختبارات'], ['exams', 'الاختبارات'], ['toppers', 'الأوائل'], ['gradestatus', 'متابعة الرصد']];
  function assessKey(k) { return ASSESS_TABS.some(function (t) { return t[0] === k; }); }
  // البنود المتاحة للمستخدم من القائمة: [مسار، مفتاح، عنوان التبويب] بترتيب التبويبات
  function assessTabs(groups) {
    var have = {};
    (groups || navModel()).forEach(function (g) { g.items.forEach(function (it) { have[it[1]] = it[0]; }); });
    return ASSESS_TABS.filter(function (t) { return have[t[0]]; }).map(function (t) { return [have[t[0]], t[0], t[1]]; });
  }
  // القائمة الجانبية: تُدمج بنود الاختبارات والدرجات في بند واحد يفتح أول تبويب متاح
  function assessCollapse(groups) {
    var tabs = assessTabs(groups), put = false;
    if (!tabs.length) return groups;
    var out = groups.map(function (g) {
      var items = [];
      g.items.forEach(function (it) {
        if (!assessKey(it[1])) return items.push(it);
        if (!put) { put = true; items.push([tabs[0][0], 'assess', tabs.length > 1 ? 'الاختبارات والدرجات' : tabs[0][2]]); }
      });
      return Object.assign({}, g, { items: items });
    });
    return out;
  }
  function assessBar() {
    var tabs = assessTabs(), h = location.hash;
    if (tabs.length < 2 || !tabs.some(function (t) { return t[0] === h; })) return '';
    return '<nav class="tabs no-print" data-assess-bar style="margin-bottom:12px;border-bottom:1px solid var(--line)">' + tabs.map(function (t) {
      return '<button type="button" data-assess-go="' + t[0] + '" data-ro-ok' + (t[0] === h ? ' class="on" aria-current="page"' : '') + '>' + t[2] + '</button>';
    }).join('') + '</nav>';
  }
  // كل شاشة تعيد بناء محتواها كاملًا؛ يُضاف الشريط في أولها بعد كل بناء
  new MutationObserver(function () {
    var bar = assessBar(), cur = app.firstElementChild;
    if (!bar || (cur && cur.hasAttribute('data-assess-bar'))) return;
    app.insertAdjacentHTML('afterbegin', bar);
  }).observe(app, { childList: true });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-assess-go]');
    if (b) go(b.getAttribute('data-assess-go'));
  });
