// يبني n8n/absence-bot.json (بوت الواتساب: الغياب + كشف الدوام + تنسيق الاختبارات) من مصادره في هذا المجلد.
// لا يُعدَّل absence-bot.json باليد: عدّل المصدر ثم شغّل:   node n8n/src/build.js
//   base.json       بوت الغياب والدوام الأصلي (العقد كلها عدا التنسيق)
//   fmt_router.js   عقدة «موجّه التنسيق»: تميّز «تنسيق» عن «دوام» وغيرها
//   fmt_main.js     عقدة «تنسيق الملف بقالب الأكاديمية»: قراءة الملف وبناء ملف Word
//   banner_ar.jpg / footer.jpg   ترويسة القالب وتذييله (يُضمَّنان داخل العقدة)
// لا مفاتيح هنا: المفاتيح تُكتب في n8n في عقدة «المفاتيح» مكان PUT_... بعد الاستيراد.
// اختياري: مسار ملف الناتج كوسيط أول (للتجربة دون المساس بالملف المنشور).
const fs = require('fs');
const path = require('path');
const D = __dirname + path.sep;
const OUT = process.argv[2] || path.join(__dirname, '..', 'absence-bot.json');
const wf = JSON.parse(fs.readFileSync(D + 'base.json', 'utf8'));
const node = (n) => wf.nodes.find((x) => x.name === n);

const img = (f) => JSON.stringify(fs.readFileSync(D + f).toString('base64'));
const main = fs.readFileSync(D + 'fmt_main.js', 'utf8').replace('__BANNER__', () => img('banner_ar.jpg')).replace('__FOOTER__', () => img('footer.jpg'));
const router = fs.readFileSync(D + 'fmt_router.js', 'utf8');
if (/__[A-Z]+__/.test(main)) throw new Error('placeholder left in fmt_main.js');

// عقدة المفاتيح: مفتاح OpenRouter بجانب المفتاحين الآخرين (يحتاجه التنسيق فقط)
const keys = node('المفاتيح');
let kc = keys.parameters.jsCode;
if (!kc.includes("const EVO = 'PUT_EVOLUTION_API_KEY';")) throw new Error('keys node changed');
kc = kc.replace("// EVO: مفتاح Evolution API (نفسه الذي في بوت الغياب القديم)\n", "// EVO: مفتاح Evolution API (نفسه الذي في بوت الغياب القديم)\n// OPENROUTER: مفتاح openrouter.ai لتنسيق الاختبارات (اختياري؛ بدونه يعمل البوت ويُعتذر عن التنسيق)\n")
  .replace("const EVO = 'PUT_EVOLUTION_API_KEY';", "const EVO = 'PUT_EVOLUTION_API_KEY';\nconst OPENROUTER = 'PUT_OPENROUTER_KEY';")
  .replace('keys: { BOT, EVO }', 'keys: { BOT, EVO, OPENROUTER }');
if (!kc.includes('OPENROUTER }')) throw new Error('keys patch');
keys.parameters.jsCode = kc;

// إزاحة العقد الأصلية يميناً لإفساح مكان بعد «المفاتيح»
wf.nodes.forEach((n) => { if (n.name !== 'رسالة واردة من Evolution' && n.name !== 'المفاتيح') n.position = [n.position[0] + 440, n.position[1]]; });
wf.nodes.push(
  { parameters: { jsCode: router }, id: 'b1a1c0de-0013-4000-8000-000000000013', name: 'موجّه التنسيق', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-880, 200] },
  { parameters: { conditions: { boolean: [{ value1: '={{ !!$json.fmt }}', value2: true }] } }, id: 'b1a1c0de-0014-4000-8000-000000000014', name: 'تنسيق؟', type: 'n8n-nodes-base.if', typeVersion: 1, position: [-660, 200] },
  { parameters: { jsCode: main }, id: 'b1a1c0de-0015-4000-8000-000000000015', name: 'تنسيق الملف بقالب الأكاديمية', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-440, -80] },
  { parameters: { content: '## تنسيق الاختبارات (OpenRouter مجاني)\nالمعلم يرسل «تنسيق» ثم الملف (Word أو PDF أو صورة)، فيعود إليه ملف Word بقالب الأكاديمية.\n1. ضع مفتاح openrouter.ai في عقدة «المفاتيح» مكان PUT_OPENROUTER_KEY.\n2. في openrouter.ai ← Settings ← Privacy: اسمح بالنماذج المجانية.\n3. اختياري: أرقام المعلمين المسموح لهم في أول عقدة «موجّه التنسيق».\n4. الصور الصعبة (خط اليد): إن لم تتفق قراءتان مجانيتان تُقرأ الصورة مرة واحدة بنموذج مدفوع رخيص من رصيدك. الحد اليومي PAID_PER_DAY في أول عقدة «تنسيق الملف» (0 = إيقاف المدفوع).', height: 340, width: 480 },
    id: 'b1a1c0de-0016-4000-8000-000000000016', name: 'تنسيق الاختبارات', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [-940, -360] },
);
// الصفحات المصوّرة: بعد كل صفحة تنتظر العملية دقيقة ثم تعود إلى عقدة التنسيق، فتبدأ القراءة إن لم تصل صفحة جديدة
wf.nodes.push(
  { parameters: { conditions: { boolean: [{ value1: '={{ $json.wait === true }}', value2: true }] } }, id: 'b1a1c0de-0017-4000-8000-000000000017', name: 'ينتظر صفحات؟', type: 'n8n-nodes-base.if', typeVersion: 1, position: [-220, -80] },
  { parameters: { amount: 60, unit: 'seconds' }, id: 'b1a1c0de-0018-4000-8000-000000000018', name: 'انتظار الصفحات', type: 'n8n-nodes-base.wait', typeVersion: 1, position: [0, -200], webhookId: 'b1a1c0de-0019-4000-8000-000000000019' },
);
const to = (n) => [{ node: n, type: 'main', index: 0 }];
wf.connections['تنسيق الملف بقالب الأكاديمية'] = { main: [to('ينتظر صفحات؟')] };
wf.connections['ينتظر صفحات؟'] = { main: [to('انتظار الصفحات'), []] };
wf.connections['انتظار الصفحات'] = { main: [to('تنسيق الملف بقالب الأكاديمية')] };
wf.connections['المفاتيح'] = { main: [to('موجّه التنسيق')] };
wf.connections['موجّه التنسيق'] = { main: [to('تنسيق؟')] };
wf.connections['تنسيق؟'] = { main: [to('تنسيق الملف بقالب الأكاديمية'), to('استخراج الرقم والنص')] };
wf.name = 'بوت الواتساب: تسجيل الغياب وكشف الدوام وتنسيق الاختبارات';

const names = new Set(wf.nodes.map((n) => n.name));
for (const [k, v] of Object.entries(wf.connections)) { if (!names.has(k)) throw new Error('src ' + k); v.main.flat().forEach((t) => { if (!names.has(t.node)) throw new Error('dst ' + t.node); }); }
// فحص صياغة العقدتين قبل الكتابة
const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
new AsyncFn('$input', '$', '$getWorkflowStaticData', router); new AsyncFn('$input', '$', main);
fs.writeFileSync(OUT, JSON.stringify(wf, null, 2) + '\n');
console.log('ok', wf.nodes.length, 'nodes', Math.round(fs.statSync(OUT).size / 1024) + 'KB', '->', OUT);
