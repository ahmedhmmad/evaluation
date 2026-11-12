// فحص سريع قبل كل رفع:   node tools/check.js
// (يشغّله git تلقائياً قبل push على هذا الجهاز عبر .git/hooks/pre-push؛ أي خطأ يوقف الرفع)
// 1) ملفات js: صياغة سليمة، وكل ملف مذكور في محمِّل index.html والعكس
// 2) لا اسم عام (function/var في أعلى الملف) معرَّف في ملفين، ولا اسم يطابق خاصية من خصائص المتصفح (window)
// 3) قاعدة البيانات: لا دالة «create or replace» معرَّفة في أكثر من ملف sql (إعادة تشغيل ملف قديم كانت تُرجِع نسخة أقدم)
// 4) وركفلو n8n: الملف المنشور n8n/absence-bot.json يطابق ما يبنيه n8n/src/build.js من مصادره
// لا يفتح الشاشات ولا يجرّب الحفظ: هذا يبقى للتجربة في المتصفح.
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os'), cp = require('child_process');
const ROOT = path.join(__dirname, '..') + path.sep;
const errs = [];
const bad = (m) => errs.push(m);

// ---- 1 و 2: ملفات الموقع
const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
const lm = /\[('core'[^\]]*)\]\.forEach/.exec(html);
const order = lm ? JSON.parse('[' + lm[1].replace(/'/g, '"') + ']') : [];
if (!order.length) bad('index.html: قائمة ملفات js في المحمِّل غير موجودة');
if (!/var APP_BUILD = '[^']+';/.test(html)) bad('index.html: سطر APP_BUILD غير موجود');
const onDisk = fs.readdirSync(ROOT + 'js').filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3));
order.forEach((n) => { if (!onDisk.includes(n)) bad('js/' + n + '.js مذكور في index.html وغير موجود'); });
onDisk.forEach((n) => { if (!order.includes(n)) bad('js/' + n + '.js موجود وغير مذكور في محمِّل index.html'); });
// أسماء لو عُرِّفت عامةً لغيّرت سلوك المتصفح أو فشلت (find مستثناة: معرَّفة هكذا منذ البداية ولا تُستعمل دالة المتصفح)
const WINDOW = ('top parent self window document location history navigator screen frames length name status closed opener origin event external ' +
  'alert confirm prompt print open close stop focus blur scroll scrollTo scrollBy moveTo resizeTo fetch postMessage setTimeout setInterval clearTimeout clearInterval ' +
  'requestAnimationFrame atob btoa getComputedStyle getSelection matchMedia localStorage sessionStorage indexedDB crypto performance caches console ' +
  'innerWidth innerHeight outerWidth outerHeight scrollX scrollY screenX screenY devicePixelRatio isSecureContext onload onerror onclick onchange ' +
  'Object Array String Number Boolean Date Math JSON Promise Map Set Error RegExp Symbol URL Blob File Image Audio Option Node Element Event Text Range Selection Notification').split(/\s+/);
const where = {};
for (const n of order) {
  if (!onDisk.includes(n)) continue;
  const code = fs.readFileSync(ROOT + 'js/' + n + '.js', 'utf8');
  try { new vm.Script(code, { filename: 'js/' + n + '.js' }); } catch (e) { bad('js/' + n + '.js: خطأ صياغة — ' + e.message + (e.stack ? ' ' + String(e.stack).split('\n')[0] : '')); continue; }
  if (!/^﻿?'use strict';/.test(code)) bad('js/' + n + ".js: يجب أن يبدأ بـ 'use strict';");
  // الأسماء العامة: التعريفات في أعلى الملف مكتوبة بإزاحة مسافتين
  const re = /^  (?:async function|function|var|let|const|class) +([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(code))) {
    const id = m[1];
    if (where[id] && where[id] !== n) bad('الاسم ' + id + ' معرَّف في ملفين: js/' + where[id] + '.js و js/' + n + '.js (الثاني يلغي الأول في كل الموقع)');
    where[id] = n;
    if (WINDOW.includes(id)) bad('js/' + n + '.js: الاسم ' + id + ' اسم خاصية في المتصفح؛ اختر اسماً آخر');
  }
}

// ---- 3: دوال القاعدة المكررة
const defs = {};
for (const f of fs.readdirSync(ROOT + 'supabase').filter((x) => x.endsWith('.sql'))) {
  const s = fs.readFileSync(ROOT + 'supabase/' + f, 'utf8');
  const re = /create or replace function public\.([a-z_0-9]+)\s*\(/g;
  let m;
  while ((m = re.exec(s))) {
    // نسخة محصَّنة (تُنشأ فقط إن لم تكن الدالة موجودة) لا تُحسب
    if (/execute \$fn\$\s*$/.test(s.slice(Math.max(0, m.index - 40), m.index))) continue;
    (defs[m[1]] = defs[m[1]] || new Set()).add(f);
  }
}
Object.keys(defs).sort().forEach((k) => { if (defs[k].size > 1) bad('دالة القاعدة ' + k + ' معرَّفة في أكثر من ملف: ' + [...defs[k]].join('، ') + ' — أبقِ نسخة واحدة وحصّن الباقي (انظر attendance_clerk.sql)'); });

// ---- 4: وركفلو n8n من مصادره
try {
  const tmp = path.join(os.tmpdir(), 'tpa-absence-bot-check.json');
  cp.execFileSync(process.execPath, [ROOT + 'n8n/src/build.js', tmp], { stdio: 'pipe' });
  const norm = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  if (norm(tmp) !== norm(ROOT + 'n8n/absence-bot.json')) bad('n8n/absence-bot.json لا يطابق مصادره في n8n/src: شغّل  node n8n/src/build.js  (ولا تعدّل الملف باليد)');
  fs.unlinkSync(tmp);
} catch (e) { bad('n8n/src/build.js فشل: ' + String(e.stderr || e.message).slice(0, 300)); }

if (errs.length) { console.error('✖ فحص ما قبل الرفع: ' + errs.length + ' مشكلة\n- ' + errs.join('\n- ')); process.exit(1); }
console.log('✔ الفحص سليم: ' + order.length + ' ملف js، ' + Object.keys(where).length + ' اسماً عاماً، ' + Object.keys(defs).length + ' دالة قاعدة، وركفلو n8n مطابق لمصادره');
