// تنسيق ملف المعلم بقالب الأكاديمية: قراءة الملف ← نموذج مجاني من OpenRouter ← ملف Word بالقالب ← إرساله واتساب.
// اختياري: نماذج بعينها مفصولة بفواصل (مثل 'اسم/نموذج:free'). فارغ = أفضل النماذج المجانية المتاحة الآن تلقائياً.
const MODELS = '';
// القراءة المدفوعة للصور الصعبة (خط اليد): تُستخدم فقط إذا لم تتفق قراءتان مجانيتان، بطلب واحد لكل صورة.
// PAID_PER_DAY: أقصى عدد صور في اليوم تُقرأ بالنموذج المدفوع (0 = إيقافها تماماً والبقاء على المجاني).
// PAID_MODEL: نموذج بعينه من openrouter.ai، أو فارغ ليُختار تلقائياً أحدث نموذج رخيص قوي (Gemini Flash وما شابه).
// PAID_MAX_PRICE: لا يُختار تلقائياً نموذج سعر إدخاله أعلى من هذا (دولار لكل مليون رمز).
const PAID_PER_DAY = 10;
const PAID_MODEL = '';
const PAID_MAX_PRICE = 1;
// سقف زمني: مهلة عقدة Code في n8n ٣٠٠ ثانية، فتُنهى الخطوات قبلها بهامش
const STRUCT_UNTIL = 160000;
// نسخة PDF (تُفتح صحيحة على الهاتف): محوِّل صغير على الخادم نفسه (n8n/pdf في المستودع). فارغ = لا PDF.
// PDF_AUTO: الأنواع التي يُرسل معها PDF دائماً؛ غيرها يُرسل معه PDF إن كتب المعلم «تنسيق اختبار pdf».
// إن لم يكن المحوِّل يعمل يُرسل ملف Word وحده كما كان.
const PDF_URL = 'http://127.0.0.1:3920';
const PDF_AUTO = ['ورقة عمل'];
// السطر الذي يظهر أسفل عنوان الاختبار (غيّره مع كل فصل)
const TERM = 'الفصل الدراسي الأول 2026/2027';

const H = this.helpers;
const src = $input.first().json;
const K = src.keys || {};
const EVO = 'https://evolution.ahmedhammad.page';
// مهلة حقيقية لكل طلب: OpenRouter يرسل إشارات «ما زلت أعمل» أثناء انتظار النموذج، فلا تنقطع مهلة الاتصال العادية
const race = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('انتهت المهلة (' + Math.round(ms / 1000) + ' ث)' + (what ? ' ' + what : ''))), ms))]);
const say = (text) => Promise.race([H.httpRequest({ method: 'POST', url: EVO + '/message/sendText/' + encodeURIComponent(src.instance),
  headers: { apikey: K.EVO, 'Content-Type': 'application/json' }, body: { number: src.phone, text }, json: true, timeout: 20000 }),
  new Promise((_, rej) => setTimeout(() => rej(new Error('انتهت مهلة إرسال الرسالة')), 20000))]);

if (src.fmt === 'start') {
  await say('أهلاً بك 👋\nأرسل الآن ملف الاختبار أو ورقة العمل (Word أو PDF أو صورة) وسأنسقه بقالب أكاديمية الركيزة الثالثة.\nيمكنك كتابة: تنسيق اختبار  أو  تنسيق ورقة عمل  لتحديد النوع.\nورقة العمل تصلك PDF مع ملف Word. للاختبار اكتب: تنسيق اختبار pdf');
  return [{ json: { done: 'طُلب الملف من المعلم' } }];
}
const OR_KEY = String(K.OPENROUTER || '').trim();
if (!OR_KEY || OR_KEY.indexOf('PUT_') === 0) {
  await say('خدمة التنسيق غير مفعّلة بعد. تواصل مع الإدارة.');
  throw new Error('ضع مفتاح OpenRouter في عقدة «المفاتيح»');
}
const started = Date.now();
await say('⏳ تم استلام الملف، جارٍ التنسيق... (قد يستغرق دقيقة أو اثنتين)').catch(() => {});

// ---------- 1) الملف ----------
let b64 = src.base64, mime = src.mimetype || '';
if (b64 && /^image\//.test(mime) && String(b64).length < 8000) b64 = '';
if (!b64) {
  const media = await race(H.httpRequest({ method: 'POST', url: EVO + '/chat/getBase64FromMediaMessage/' + encodeURIComponent(src.instance),
    headers: { apikey: K.EVO, 'Content-Type': 'application/json' }, body: { message: { key: { id: src.msgId } }, convertToMp4: false }, json: true, timeout: 30000 }), 30000, 'جلب الملف').catch(() => ({}));
  b64 = media.base64 || '';
  if (media.mimetype) mime = String(media.mimetype).split(';')[0];
}
if (!b64) { await say('تعذر استلام الملف. أرسله مرة أخرى.'); throw new Error('لم يُجلب الملف من Evolution'); }
const ext = (String(src.fileName).split('.').pop() || '').toLowerCase();
const raw = Buffer.from(String(b64).replace(/^data:[^,]+,/, ''), 'base64');
let input;   // { kind: 'text' | 'pdf' | 'image', ... }
if (/^image\//.test(mime)) {
  input = { kind: 'image', url: 'data:' + (/(jpeg|png|webp|gif)/.test(mime) ? mime : 'image/jpeg') + ';base64,' + raw.toString('base64') };
} else if (mime === 'application/pdf' || ext === 'pdf') {
  input = { kind: 'pdf', url: 'data:application/pdf;base64,' + raw.toString('base64') };
} else if (ext === 'docx' || /officedocument\.wordprocessingml/.test(mime) || (raw[0] === 0x50 && raw[1] === 0x4b)) {
  let lines = [];
  try { lines = docxLines(raw); } catch (e) { lines = []; }
  if (lines.map((l) => l.text || '').join('').replace(/\s/g, '').length < 20) { await say('❌ لم أستطع قراءة نص ملف Word. أرسله بصيغة PDF أو صورة واضحة.'); return [{ json: { skipped: 'docx بلا نص مقروء' } }]; }
  input = { kind: 'word', lines: lines.slice(0, 600) };
} else {
  await say('❌ صيغة الملف غير مدعومة. أرسل ملف Word (docx) أو PDF أو صورة.\nإن كان الملف بصيغة doc القديمة: افتحه في Word واحفظه باسم docx.');
  return [{ json: { skipped: 'صيغة غير مدعومة: ' + (mime || ext) } }];
}

// ---------- 2) النماذج ----------
const elapsed = () => Date.now() - started;
let candidates = MODELS.split(',').map((s) => s.trim()).filter(Boolean), readers = candidates.slice(), paidModels = PAID_MODEL ? [PAID_MODEL] : [];
try {
  const r = await race(H.httpRequest({ method: 'GET', url: 'https://openrouter.ai/api/v1/models', json: true, timeout: 15000 }), 15000);
  const all = r.data || [], ins = (x) => ((x.architecture && x.architecture.input_modalities) || []);
  if (!candidates.length) {
    const free = all.filter((x) => /:free$/.test(x.id));
    // عائلات معروفة بجودة قراءة النص العربي من الصور تُقدَّم، ثم الأكبر سياقاً
    const RANK = [/gemini/i, /qwen.*(vl|2\.5|3)/i, /llama-4/i, /mistral-(small|medium)/i, /gemma-3/i, /kimi|glm.*v/i];
    const rank = (x) => { const i = RANK.findIndex((re) => re.test(x.id)); return i < 0 ? RANK.length : i; };
    const order = (a, b) => rank(a) - rank(b) || (b.context_length || 0) - (a.context_length || 0);
    const vision = free.filter((x) => ins(x).includes('image')).sort(order).map((x) => x.id);
    const textual = free.filter((x) => !ins(x).includes('image')).sort((a, b) => (b.context_length || 0) - (a.context_length || 0)).map((x) => x.id);
    // قارئ واحد من كل عائلة: التطابق بين عائلتين مختلفتين هو التأكيد
    const seen = new Set();
    const sdb = $getWorkflowStaticData('global'), now0 = Date.now();
    sdb.badModels = sdb.badModels || {};
    for (const k of Object.keys(sdb.badModels)) if (now0 - sdb.badModels[k] > 7 * 864e5) delete sdb.badModels[k];
    readers = vision.filter((id) => !sdb.badModels[id]).filter((id) => { const f = id.split('/')[0]; if (seen.has(f)) return false; seen.add(f); return true; }).slice(0, 3);
    candidates = textual.filter((id) => !sdb.badModels[id]).slice(0, 2).concat(vision.filter((id) => !sdb.badModels[id]).slice(0, 2));    // لترتيب الأسطر (نص فقط)
  }
  if (!paidModels.length && PAID_PER_DAY > 0) {
    // نموذج مدفوع رخيص وقوي في قراءة الصور وخط اليد: الأحدث من عائلة مفضلة بسعر إدخال لا يتجاوز PAID_MAX_PRICE دولار لكل مليون
    const PREF = [/gemini.*flash(?!.*lite)/i, /gemini.*flash/i, /gpt.*mini/i, /claude.*haiku/i, /qwen.*vl/i];
    const pr = (x) => { const i = PREF.findIndex((re) => re.test(x.id)); return i < 0 ? 99 : i; };
    paidModels = all.filter((x) => !/:free$/.test(x.id) && ins(x).includes('image') && x.pricing && +x.pricing.prompt > 0 && +x.pricing.prompt * 1e6 <= PAID_MAX_PRICE &&
      pr(x) < 99 && !/image-|audio|tts|live|embedding|guard/i.test(x.id))
      .sort((a, b) => pr(a) - pr(b) || (b.created || 0) - (a.created || 0)).map((x) => x.id).slice(0, 2);
  }
} catch (e) { if (!candidates.length) { await say('❌ تعذر الاتصال بخدمة الذكاء الاصطناعي الآن. أعد المحاولة بعد قليل بإرسال: تنسيق').catch(() => {}); throw e; } }

function pickJson(s) {
  s = String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (_) {}
  try { return JSON.parse(s.slice(a, b + 1).replace(/,\s*([}\]])/g, '$1')); } catch (_) { return null; }
}
const errors = [];
let limited = 0, paidCost = null;
// نماذج توقفت قراءتها عند حد الرموز قبل آخر الورقة (نسختها ناقصة)
const cut = new Set();
// نموذج واحد: نص الرد، أو null مع تسجيل السبب. ms مهلة حقيقية لهذا الطلب
async function callModel(model, system, content, plugins, ms, maxTokens, extra) {
  let res;
  try {
    res = await race(H.httpRequest({
      method: 'POST', url: 'https://openrouter.ai/api/v1/chat/completions', json: true,
      headers: { Authorization: 'Bearer ' + OR_KEY, 'Content-Type': 'application/json', 'X-Title': 'TPA Formatter' },
      body: Object.assign({ model, temperature: 0, max_tokens: maxTokens || 6000, usage: { include: true }, messages: [{ role: 'system', content: system }, { role: 'user', content }] }, plugins ? { plugins } : {}, extra || {}),
      timeout: ms, returnFullResponse: true, ignoreHttpStatusErrors: true,
    }), ms);
  } catch (e) { errors.push(model + ': ' + String(e.message || e).slice(0, 120)); return null; }
  const body = res.body || {};
  if (res.statusCode === 429 || (body.error && body.error.code === 429)) { limited++; errors.push(model + ': 429'); return null; }
  const code = +(res.statusCode >= 400 ? res.statusCode : body.error && body.error.code) || 0;
  if (code === 403 || code === 404) { const sdb = $getWorkflowStaticData('global'); (sdb.badModels = sdb.badModels || {})[model] = Date.now(); }
  if (res.statusCode >= 400 || body.error) { errors.push(model + ': ' + res.statusCode + ' ' + JSON.stringify(body.error || body).slice(0, 150)); return null; }
  if (body.usage && body.usage.cost != null && !/:free$/.test(model)) paidCost = (paidCost || 0) + (+body.usage.cost || 0);
  const ch0 = (body.choices || [])[0] || {}, msg = ch0.message || {};
  if (ch0.finish_reason === 'length' || ch0.native_finish_reason === 'MAX_TOKENS') cut.add(model); else cut.delete(model);
  return String(msg.content || '').replace(/<think>[\s\S]*?<\/think>/g, '');
}
// ترتيب الأسطر: يجرّب النماذج المجانية بالترتيب حتى يقبل check الرد، ضمن الوقت المتاح (بعده يُرتَّب الملف دون نموذج)
async function askModels(system, content, plugins, check) {
  for (const model of candidates) {
    if (elapsed() > STRUCT_UNTIL) { errors.push(model + ': لا وقت'); break; }
    const text = await callModel(model, system, content, plugins, 35000, 3000);
    if (text == null) continue;
    const r = check(pickJson(text));
    if (r.value) return { value: r.value, model };
    errors.push(model + ': ' + r.reject);
  }
  return null;
}

let exam = null, usedModel = '', doubt = '', readBy = [];
if (input.kind !== 'word') {
  const SYSTEM_OCR = 'أنت أداة نسخ نص فقط. انسخ كل النص الظاهر في الملف حرفياً كما هو، سطراً سطراً، بالترتيب من الأعلى إلى الأسفل. قد يكون النص مطبوعاً أو بخط اليد.\n' +
    '- لا تصحح ولا تترجم ولا تلخص ولا تضف أي كلمة أو شرح أو عنوان من عندك، ولا تستخدم تنسيق Markdown.\n' +
    '- الجداول: كل صف في سطر، والخلايا مفصولة بعلامة | .\n' +
    '- الفراغات التي يملؤها الطالب انسخها نقاطاً أو شرطات كما تظهر.\n' +
    '- علامة الصح وعلامة الخطأ انسخهما بالرمزين ✔ و ✖ ، والمربع الفارغ بالرمز □ ، والأقواس الفارغة ( ) كما هي.\n' +
    '- إن لم يصلك ملف أو صورة، أو كان غير مقروء، فاكتب فقط: NO_IMAGE';
  const part = input.kind === 'image' ? { type: 'image_url', image_url: { url: input.url } } : { type: 'file', file: { filename: 'exam.pdf', file_data: input.url } };
  const content = [{ type: 'text', text: 'انسخ نص هذا الملف حرفياً.' }, part];
  const plugins = input.kind === 'pdf' ? [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }] : null;
  const pool = (input.kind === 'image' ? readers : readers.concat(candidates.filter((m) => !readers.includes(m)))).slice(0, 3);
  // تطابق نسختين: نسبة الكلمات المشتركة (بعد تبسيط الهمزات والتشكيل)
  const nw = (t) => new Set(String(t).replace(/[ً-ْٰـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase()
    .split(/[^؀-ۿa-z0-9٠-٩]+/).filter((w) => w.length > 1));
  const sim = (a, b) => { const A = nw(a), B = nw(b); let k = 0; for (const w of A) if (B.has(w)) k++; return A.size + B.size ? 2 * k / (A.size + B.size) : 0; };
  const clean = (t) => String(t || '').replace(/```[a-z]*\n?|```/gi, '').replace(/^\s*#+\s*/gm, '').replace(/\*\*/g, '').trim();
  const readable = (t) => t && !/NO_IMAGE/.test(t) && (t.match(/[؀-ۿA-Za-z]/g) || []).length >= 15;
  // أ) القراءات المجانية معاً في وقت واحد (لا واحدة بعد أخرى)
  const OCR_EXTRA = { reasoning: { effort: 'low', exclude: true } };
  const sdp = $getWorkflowStaticData('global'), todayP = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  if (!sdp.paid || sdp.paid.day !== todayP) sdp.paid = { day: todayP, n: 0 };
  let paidEarly = null;
  if (input.kind === 'image' && paidModels.length && PAID_PER_DAY > 0 && sdp.paid.n < PAID_PER_DAY) {
    const pm = paidModels[0];
    paidEarly = callModel(pm, SYSTEM_OCR, content, plugins, 110000, 8000, OCR_EXTRA).then((t) => ({ model: pm, raw: t }));
  }
  const texts = await Promise.all(pool.map((m) => callModel(m, SYSTEM_OCR, content, plugins, 90000, 12000, OCR_EXTRA)));
  let paidRead = null;
  if (paidEarly) {
    const pr = await paidEarly;
    if (pr.raw != null) {
      sdp.paid.n++;
      const t = clean(pr.raw);
      if (readable(t) && !cut.has(pr.model)) paidRead = { model: pr.model, text: t, fam: 'paid:' + pr.model.split('/')[0], paid: true };
      else errors.push(pr.model + ': ' + (cut.has(pr.model) ? 'توقفت القراءة قبل آخر الورقة' : 'لم يقرأ الملف'));
    }
  }
  const reads = [], partial = [];
  pool.forEach((model, i) => { const t = clean(texts[i]); if (texts[i] == null) return; if (!readable(t)) { errors.push(model + ': لم يقرأ الملف'); return; }
    // نسخة مقطوعة لا تُعتمد وحدها (آخر الورقة سقط منها)، لكنها تؤكد أول قراءة كاملة إن طابقتها
    if (cut.has(model)) { errors.push(model + ': توقفت القراءة قبل آخر الورقة (' + t.length + ' حرفاً)'); partial.push({ model, text: t, fam: model.split('/')[0] }); return; }
    reads.push({ model, text: t, fam: model.split('/')[0] }); });
  if (paidRead) reads.push(paidRead);
  let agreed = null;
  for (let i = 0; i < reads.length && !agreed; i++) for (let j = i + 1; j < reads.length; j++) {
    const sc = sim(reads[i].text, reads[j].text);
    if (reads[i].fam !== reads[j].fam && sc >= 0.5) { agreed = reads[j].text.length > reads[i].text.length * 1.1 ? reads[j] : reads[i]; readBy = [agreed.model, (agreed === reads[i] ? reads[j] : reads[i]).model]; break; }
    errors.push(reads[j].model + ': نسخته تختلف عن ' + reads[i].model + ' (' + Math.round(sc * 100) + '%)');
  }
  // أ٢) قراءة كاملة واحدة، وقراءة مقطوعة من عائلة أخرى تطابق أولها: تُعتمد الكاملة، وما بعد موضع القطع قرأه نموذج واحد
  for (let i = 0; i < reads.length && !agreed; i++) for (const p of partial) {
    if (p.fam === reads[i].fam || p.text.length < 120) continue;
    const head = reads[i].text.slice(0, Math.round(p.text.length * 1.15)), sc = sim(p.text, head);
    if (sc >= 0.5) {
      agreed = reads[i]; readBy = [reads[i].model, p.model + ' (أول الورقة فقط)'];
      doubt += '\nℹ️ أول الورقة تطابقت فيه قراءتان، وآخرها قرأه نموذج واحد: راجع الجزء الأخير جيداً.';
      break;
    }
    errors.push(p.model + ': أول نسخته يختلف عن ' + reads[i].model + ' (' + Math.round(sc * 100) + '%)');
  }
  // ب) لم تتفق قراءتان مجانيتان (خط يد أو صورة صعبة): قراءة واحدة بنموذج مدفوع، ضمن الحد اليومي
  let paidNote = '';
  if (!agreed && paidRead) {
    agreed = paidRead; readBy = [paidRead.model + ' (مدفوع، ' + sdp.paid.n + '/' + PAID_PER_DAY + ' اليوم)'];
  } else if (!agreed && !paidEarly && paidModels.length && PAID_PER_DAY > 0) {
    const sd = $getWorkflowStaticData('global');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    if (!sd.paid || sd.paid.day !== today) sd.paid = { day: today, n: 0 };
    if (sd.paid.n >= PAID_PER_DAY) paidNote = 'بلغ اليوم حد القراءة المتقدمة (' + PAID_PER_DAY + ' صورة).';
    else for (const model of paidModels) {
      if (elapsed() > 120000) break;
      const raw = await callModel(model, SYSTEM_OCR, content, plugins, 110000, 8000, OCR_EXTRA);
      if (raw == null) continue;
      sd.paid.n++;                                  // كل طلب مدفوع ناجح يُحسب، حتى لو لم يُقرأ النص
      const t = clean(raw);
      if (!readable(t)) { errors.push(model + ': لم يقرأ الملف'); break; }
      if (cut.has(model)) doubt += '\n⚠️ قد يكون آخر الورقة لم يُقرأ كاملاً: قارن الملف بالورقة الأصلية.';
      agreed = { model, text: t, paid: true }; readBy = [model + ' (مدفوع، ' + sd.paid.n + '/' + PAID_PER_DAY + ' اليوم)'];
      break;
    }
  }
  if (!agreed && reads.length === 1) {
    agreed = reads[0]; readBy = [reads[0].model + ' (قراءة واحدة)'];
  }
  if (!agreed) {
    await say(limited && !reads.length
      ? '⏳ تم بلوغ حد الاستخدام المجاني لخدمة الذكاء الاصطناعي حالياً. أعد المحاولة بعد قليل بإرسال: تنسيق'
      : '❌ لم أستطع قراءة ' + (input.kind === 'image' ? 'الصورة' : 'الملف') + ' بثقة' + (paidNote ? ' (' + paidNote + ')' : '') + '.\n' +
        'أرسل الملف بصيغة Word إن أمكن، أو صورة أوضح: الورقة كاملة ومستقيمة، بإضاءة جيدة، وبدون ظل.').catch(() => {});
    return [{ json: { failed: true, seconds: Math.round(elapsed() / 1000), errors, paidModels, pool, reads: reads.concat(partial).map((r) => ({ model: r.model, cut: partial.includes(r), chars: r.text.length, text: r.text.slice(0, 400) })) } }];
  }
  // قراءة واحدة لم تؤكدها ثانية (مدفوعة أو مجانية)؛ إن طابقتها قراءة أخرى فهي مؤكَّدة
  if (readBy.length < 2) doubt += '\nℹ️ الصورة صعبة القراءة (خط يد أو تصوير غير واضح)، فقُرئت بقراءة واحدة متقدمة غير مؤكَّدة بقراءة ثانية: راجع كل كلمة قبل الاعتماد.';
  // أسطر النص المتفق عليه؛ الأسطر المتتالية التي فيها | جدول
  const lines = [];
  for (const raw of agreed.text.split(/\r?\n/)) {
    const t = raw.trim(), id = lines.length + 1;
    if (!t) { lines.push({ id, empty: true }); continue; }
    if (/\|/.test(t) && !/^[|\s:-]+$/.test(t)) {
      const cells = t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const prev = lines[lines.length - 1];
      if (prev && prev.table) { prev.table.push(cells); continue; }
      lines.push({ id, table: [cells] }); continue;
    }
    if (/^[|\s:-]+$/.test(t)) continue;
    lines.push({ id, text: t });
  }
  lines.forEach((l, i) => { l.id = i + 1; });
  input = { kind: 'word', lines, from: input.kind, paid: readBy.length < 2 };
}
if (input.kind === 'word') {
  // ===== ملف Word: النص يُنقل من الملف حرفياً، والنموذج يرتّب الأسطر بأرقامها فقط ولا يكتب نصاً =====
  const L = input.lines;
  const show = (l) => 'L' + l.id + ': ' + (l.table ? '[جدول] ' + l.table.map((r) => r.join(' | ')).join(' ؛ ') : l.image ? '[صورة]' : l.empty ? '[سطر فارغ]' : l.text);
  const SYSTEM_WORD = 'أنت تنظّم ملف اختبار أو ورقة عمل كتبه معلم، لوضعه في قالب أكاديمية الركيزة الثالثة.\n' +
    'ستصلك أسطر الملف مرقمة (L1، L2، ...). لا تكتب أي نص من عندك ولا تنسخ النصوص: أشر إلى الأسطر بأرقامها فقط، فالنص يؤخذ من الملف كما هو.\n' +
    'أعد كائن JSON واحداً فقط بلا شرح:\n' +
    '{"kind":"اختبار" أو "ورقة عمل","subject":"المادة","grade":"الصف ...","total":"الدرجة الكلية كما في الملف أو \'\'","drop":[أرقام],"heads":[أرقام],"types":{"رقم":"h|center|passage"}}\n' +
    '- drop: أسطر ترويسة المدرسة الأخرى فقط: اسم المدرسة أو الجهة، الشعار، خانات اسم الطالب والصف والشعبة والدرجة والتاريخ والزمن، وسطر عنوان الاختبار/المادة/الصف في الأعلى (القالب يكتبها). لا تحذف البسملة ولا التعليمات العامة ولا أي سؤال.\n' +
    '- heads: أرقام أسطر عناوين الأسئلة الرئيسية بالترتيب، مثل «السؤال الأول: ...» أو «س1: ...» أو «أولاً: ...» أو «النشاط الأول: ...» أو «تدريب 1: ...»، وفي الاختبارات الإنجليزية مثل «Question 1: ...» أو «First Question» أو «Q1.» أو «Part A». الفروع (١- ، أ- ...) ليست عناوين.\n' +
    '- types (اختياري): h لعنوان فرعي داخل السؤال، center لسطر في المنتصف مثل بنك الكلمات، passage لفقرة قراءة طويلة. باقي الأسطر عادية فلا تذكرها.\n' +
    '- subject وgrade مثل "اللغة العربية" و"الصف الثالث". إن لم يُذكر الصف اكتب "الصف .........".';
  const note = src.hint ? 'نوع الملف حسب رسالة المعلم: ' + src.hint : 'استنتج نوع الملف من محتواه.';
  const ids = new Set(L.map((l) => l.id));
  const okPlan = (p) => {
    if (!p || !Array.isArray(p.heads)) return { reject: 'رد غير صالح' };
    const heads = p.heads.map(Number).filter((n) => ids.has(n) && L[n - 1].text);
    if (!heads.length) return { reject: 'لم يحدد عناوين الأسئلة' };
    return { value: Object.assign({}, p, { heads, drop: (p.drop || []).map(Number).filter((n) => ids.has(n) && !heads.includes(n)) }) };
  };
  const got = await askModels(SYSTEM_WORD, note + '\n\n' + L.map(show).join('\n'), null, okPlan);
  const isHead = (t) => /^[\s\u200E\u200F]*(السؤال|س\s*[0-9٠-٩]|(?:ال)?(?:نشاط|تدريب|تمرين|مهمة)\s*\(?\s*(?:[0-9٠-٩]+|ال[أا]ول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)|[أا]ولاً|[أا]ولا\s*[:：]|ثانياً|ثالثاً|رابعاً|خامساً|سادساً)/.test(t || '') ||
    new RegExp('^\\s*(?:(?:Question|Q)\\s*\\.?\\s*(?:\\d+|[IVX]+)|(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth)\\s+Question|Question\\s+(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)|(?:Part|Section|Activity|Exercise|Task)\\s+(?:\\d+|[A-Z]|[IVX]+))\\b|^\\s*[IVX]+\\s*[:\\-–.)]', 'i').test(t || '');
  let regexHeads = L.filter((l) => isHead(l.text)).map((l) => l.id);
  if (!regexHeads.length) {
    const VERB = /^[\s\u200E\u200F]*(?:[0-9٠-٩]+\s*[-.)]\s*)?(?:[أا]كمل[ي]?|اختر|اختاري|ضع[ي]?|صل[ي]?|اكتب[ي]?|[أا]جب|[أا]جيبي|رتب[ي]?|استخرج[ي]?|حل[ي]?|[أا]وجد[ي]?|علل[ي]?|اذكر[ي]?|صحح[ي]?|صنف[ي]?|اقر[أئ]ي?|لون[ي]?|ارسم[ي]?|حو[ّ]?ط[ي]?|املأ|[أا]عد|قارن[ي]?|عر[ّ]?ف[ي]?|Choose|Complete|Read|Write|Circle|Match|Put|Answer|Re-?arrange|Correct|Fill|Look|Listen|Classify|Underline|Tick|Colou?r|Draw|Order|Unscramble)(?=[\s:：,،]|$)/i;
    const auto = L.filter((l) => l.text && l.text.length < 120 && VERB.test(l.text) && (l.bold || l.box || /[:：]\s*$/.test(l.text))).map((l) => l.id);
    if (auto.length && auto.length <= 10) regexHeads = auto;
  }
  let plan;
  if (got) { plan = got.value; usedModel = got.model; }
  else {
    // دون نموذج: عناوين الأسئلة من صيغتها، وما قبل أول سؤال ترويسة (إلا البسملة).
    // لا عناوين أسئلة معروفة (ورقة تبدأ بـ«أكمل الفراغ» مثلاً): تُوضع الورقة كلها في سؤال واحد بدل رفضها
    plan = { kind: src.hint || 'اختبار', subject: '', grade: '', total: '', heads: regexHeads,
      drop: regexHeads.length ? L.filter((l) => l.id < regexHeads[0] && !/بسم\s*الله/.test(l.text || '')).map((l) => l.id) : [], types: {} };
    usedModel = 'بدون نموذج';
  }
  // المادة والصف والدرجة الكلية من ترويسة الملف نفسها إن لم يحددها النموذج
  const first = plan.heads.length ? Math.min.apply(null, plan.heads) : 0;
  const top = L.filter((l) => (first ? l.id < first : l.id <= 8)).map((l) => l.text || (l.table ? l.table.map((r) => r.join(' ')).join(' ') : '')).join('\n');
  if (!src.hint && /ورقة\s*عمل|work\s*sheet/i.test(top)) plan.kind = 'ورقة عمل';
  const blank = (v) => !String(v || '').replace(/[\s.…_\-–]|الصف|الأساسي/g, '');
  if (blank(plan.subject)) {
    let sub = (/(اللغة\s+ال[إاأ]نجليزية|اللغة\s+العربية|اللغة\s+الفرنسية|الرياضيات|العلوم|التربية\s+ال[إا]سلامية|القر[آا]ن\s+الكريم|الدراسات\s+الاجتماعية|الاجتماعيات|التنشئة\s+\S+|الحاسوب|التكنولوجيا|التربية\s+الفنية|التربية\s+الوطنية)/.exec(top) || [])[1] || '';
    if (!sub) { const m = /(?:اختبار|امتحان|ورقة\s+عمل|تقييم)\s+(?:في\s+)?(?:مادة\s+)?([^\n\-–:(\d.]{3,40})/.exec(top); if (m) sub = m[1].split(/\s+(?:الصف|للصف|الفصل|للفصل)/)[0].trim(); }
    if (!sub) { const e = /\b(English|Math(?:s|ematics)?|Science)\b/i.exec(top); if (e) sub = /eng/i.test(e[1]) ? 'اللغة الإنجليزية' : /math/i.test(e[1]) ? 'الرياضيات' : 'العلوم'; }
    plan.subject = sub.replace(/\s+/g, ' ');
  }
  if (blank(plan.grade)) { const g = /(?:الصف|للصف)\s+(الأول|الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)/.exec(top); plan.grade = g ? 'الصف ' + g[1] : ''; }
  if (blank(plan.total)) { const t = /(?:الدرجة|العلامة|المجموع|Marks?|Total|Score)[^\n0-9٠-٩]{0,40}\/\s*([0-9٠-٩]{1,3})/i.exec(top); plan.total = t ? t[1] : ''; }
  if (!got && (!regexHeads.length || blank(plan.subject)))
    doubt += '\n⚠️ لم تتوفر خدمة الترتيب الآلي، فوُضع الملف في القالب كما هو: اكتب المادة والصف، واحذف ترويسة المدرسة الأخرى إن وُجدت.';
  // تُحذف دائماً: اسم الأكاديمية وخانة اسم الطالب قبل أول سؤال، وسطر الختام («بالتوفيق») لأن القالب يكتبها
  const extra = L.filter((l) => l.text && first && l.id < first && /أكاديمية\s+الركيزة|(?:اسم\s+الطالبة?|الاسم|Name)\s*\)?\s*[:：]?\s*[._…]{4,}/i.test(l.text)).map((l) => l.id);
  const lastLine = L.slice().reverse().find((l) => l.text || l.table);
  if (lastLine && lastLine.text && lastLine.text.length < 90 && !plan.heads.includes(lastLine.id) &&
    /بالتوفيق|التوفيق\s+والنجاح|انتهت\s+ال[أا]سئلة|End\s+of\s+(?:the\s+)?(?:Test|Exam|Questions)|Good\s+luck|Best\s+wishes/i.test(lastLine.text)) extra.push(lastLine.id);
  // تجميع القالب من أسطر الملف نفسها
  const drop = new Set(plan.drop.concat(extra)), heads = [...new Set(plan.heads)].sort((a, b) => a - b), types = plan.types || {};
  const PREFIX = new RegExp('^[\\s\\u200E\\u200F]*(?:السؤال\\s+\\S+|(?:ال)?(?:نشاط|تدريب|تمرين|مهمة)\\s*\\(?\\s*(?:[0-9٠-٩]+|ال\\S+)\\s*\\)?|س\\s*[0-9٠-٩]+|[أا]ولاً|ثانياً|ثالثاً|رابعاً|خامساً|سادساً|سابعاً|ثامناً|(?:Question|Q)\\s*\\.?\\s*(?:\\d+|[IVX]+)|(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth)\\s+Question|Question\\s+(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)|(?:Part|Section|Activity|Exercise|Task)\\s+(?:\\d+|[A-Z]|[IVX]+)|[IVX]+(?=\\s*[:\\-–.)]))\\s*[:：\\-–.)]?\\s*', 'i');
  // درجة السؤال في آخر عنوانه، مثل «(10 Marks)» أو «(٥ درجات)»: تُكتب في خانة مستقلة في طرف العنوان
  const MARKS = /\s*(?:[\[(（]\s*[0-9٠-٩]+(?:[.,][0-9٠-٩]+)?\s*(?:marks?|mks?|points?|pts?|درجات|درجة|درجتان|علامات|علامة|علامتان)\s*[\])）]|[\[(（][\s.…_]*\/\s*[0-9٠-٩]+\s*[\])）]|[\s:：\-–][0-9٠-٩]+\s*(?:marks?|درجات|درجة))\s*$/i;
  // الغامق في الملف يُنقل غامقاً ما دام يميّز بعض الأسطر (ملف كله غامق لا يُعدّ تمييزاً)
  const kept = L.filter((l) => l.text && !drop.has(l.id) && !heads.includes(l.id));
  const boldOn = kept.filter((l) => l.bold).length <= kept.length * 0.6;
  // فراغات الإجابة (نقاط متتالية) تُكتب بخط أصغر، ويُقلَّل عددها إن كان السطر سيلتف إلى سطر ثانٍ
  const W_IN = 11906 - 2 * 794 - 460;
  const dotParts = (text, avail, bold) => {
    const segs = String(text).split(/(\.{4,})/).filter((x) => x !== ''), isDots = (x) => /^\.{4,}$/.test(x);
    if (!segs.some(isDots)) return bold ? [{ b: String(text) }] : [String(text)];
    let chars = 0, dots = 0;
    segs.forEach((x) => { if (isDots(x)) dots += x.length + 2; else chars += x.length; });
    const room = (avail * 0.95 - chars * 125) / 60, f = dots > room ? Math.max(0, room / dots) : 1;
    return segs.map((x) => isDots(x) ? { d: Math.max(8, Math.floor(x.length * f)) } : bold ? { b: x } : x);
  };
  const BANK = /^\s*[\[(（][^\[\]()（）]+(?:\s[—–\-,،|\/]\s[^\[\]()（）]+)+[\])）]\s*$/;
  const toItem = (l) => {
    if (l.table) {
      const n = Math.max.apply(null, l.table.map((r) => r.length)), cw = Math.floor((W_IN - 200) / n) - 140;
      const flat = [].concat.apply([], (l.tb || []).map((r, i) => r.filter((b, j) => l.table[i][j])));
      const someBold = flat.some(Boolean) && !flat.every(Boolean);
      return { t: 'grid', rows: l.table.map((r, i) => r.map((c, j) => dotParts(c, cw, someBold && l.tb[i][j]))), h: 400 };
    }
    if (l.image) return { t: 'gap', h: 1200 };
    if (l.empty) return { t: 'gap', h: 280 };
    const ty = types[l.id] || types[String(l.id)], txt = l.text;
    if (/^[.\s]{30,}$/.test(txt)) return { t: 'line' };
    if (ty === 'passage' || (!ty && l.box && txt.length >= 80)) return { t: 'passage', text: txt };
    if (ty === 'center' || (!ty && ((l.center && (l.box || l.bold)) || (BANK.test(txt) && txt.length < 140)))) return { t: 'center', lines: [txt] };
    return { t: 'p', parts: dotParts(txt, W_IN, ty === 'h' || (l.bold && boldOn) || !!l.box) };
  };
  // أسطر فارغة متتالية: فراغ واحد بحد أقصى ٣ أسطر، ولا فراغ في أول السؤال، ولا سطر فارغ مفرد حول جدول أو صندوق
  const tidy = (items) => {
    const out = [];
    for (const it of items) {
      const prev = out[out.length - 1];
      if (it.t === 'gap' && it.h === 280) { if (!out.length) continue; if (prev.t === 'gap' && prev.h < 1200) { prev.h = Math.min(840, prev.h + 280); continue; } }
      out.push(it);
    }
    while (out.length && out[out.length - 1].t === 'gap' && out[out.length - 1].h < 1200) out.pop();
    return out.filter((it, i) => !(it.t === 'gap' && it.h <= 280 && [out[i - 1], out[i + 1]].some((x) => x && /^(grid|passage|center)$/.test(x.t))));
  };
  const pre = heads.length ? tidy(L.filter((l) => l.id < heads[0] && !drop.has(l.id)).map(toItem)) : [];
  const sections = !heads.length ? [{ num: '', title: [], items: tidy(L.filter((l) => !drop.has(l.id)).map(toItem)) }] : heads.map((h, i) => {
    const full = L[h - 1].text, marks = (MARKS.exec(full) || [''])[0].trim(), head = marks ? full.replace(MARKS, '').replace(/[\s\-–]+$/, '') : full, instr = head.replace(PREFIX, '').trim();
    const body = L.filter((l) => l.id > h && (i + 1 < heads.length ? l.id < heads[i + 1] : true) && !drop.has(l.id)).map(toItem);
    return { num: '', title: ['', instr === head ? head : instr], marks, items: tidy(body) };
  });
  exam = { kind: src.hint || plan.kind, subject: String(plan.subject || ''), grade: String(plan.grade || ''), total: String(plan.total || ''), pre, sections };
  if (input.from && !input.paid) doubt += '\nℹ️ قُرئ نص ' + (input.from === 'image' ? 'الصورة' : 'الملف') + ' آلياً وتطابقت قراءتان مستقلتان له، لكن راجعه جيداً، خاصة التشكيل والأرقام. ملف Word يُنقل نصه كما هو تماماً.';
  const images = L.filter((l) => l.image && !drop.has(l.id)).length;
  if (images) doubt += '\n🖼️ في الملف ' + images + ' صورة/شكل لم يُنسخ؛ تُرك مكانه فارغاً لتضيفه.';
}
if (src.hint) exam.kind = src.hint;

// ---------- 3) ملف Word بالقالب ----------
const built = buildDocx(exam);
const fname = [built.kind, built.subject, (/\.{2,}/.test(built.grade) ? '' : built.grade)].filter((x) => x && !/^[\s.]*$/.test(x)).join('_').replace(/[\s.\/\\:*?"<>|]+/g, '_').slice(0, 80) + '.docx';
// نسخة PDF من المحوِّل. «اقلب الصفحة» فيها نص ثابت (المحوِّل لا يحسب حقل Word) بعدد صفحاتها الفعلي: إن خالف التقدير يُعاد بناؤها بالعدد الصحيح
let pdf = null, pdfNote = '';
if (PDF_URL && (PDF_AUTO.includes(built.kind) || src.pdf)) {
  const toPdf = async (docx) => {
    const r = await race(H.httpRequest({ method: 'POST', url: PDF_URL + '/convert', headers: { 'Content-Type': 'application/json' }, body: { docx: docx.toString('base64') }, json: true, timeout: 100000 }), 100000, 'تحويل PDF');
    if (!r || !r.pdf) throw new Error('رد المحوِّل بلا ملف');
    return r;
  };
  try {
    pdf = await toPdf(buildDocx(Object.assign({}, exam, { staticTurn: true })).docx);
    if (pdf.pages && (pdf.pages > 1) !== (built.pages > 1) && elapsed() < 200000) pdf = await toPdf(buildDocx(Object.assign({}, exam, { staticTurn: true, forcePages: pdf.pages })).docx);
  } catch (e) { pdf = null; errors.push('PDF: ' + String(e.message || e).slice(0, 150)); pdfNote = '\nℹ️ تعذر تجهيز نسخة PDF الآن، فأُرسل ملف Word وحده.'; }
}
let caption = '✅ تم التنسيق بقالب الأكاديمية.\nراجع الملف قبل اعتماده، خاصة الجداول والأشكال.' + (pdf ? '' : '\nلنسخة PDF: افتحه في Word ← حفظ باسم ← PDF.');
if ((pdf && pdf.pages ? pdf.pages : built.pages) > 2) caption += '\n⚠️ الملف طويل وقد يزيد عن صفحتين.';
caption += doubt + pdfNote;
if (pdf) {
  await race(H.httpRequest({ method: 'POST', url: EVO + '/message/sendMedia/' + encodeURIComponent(src.instance),
    headers: { apikey: K.EVO, 'Content-Type': 'application/json' }, json: true, timeout: 60000,
    body: { number: src.phone, mediatype: 'document', mimetype: 'application/pdf', fileName: fname.replace(/\.docx$/, '.pdf'), caption, media: pdf.pdf } }), 60000, 'إرسال PDF');
  caption = '📝 نسخة Word من الملف نفسه، للتعديل إن لزم.';
}
await race(H.httpRequest({ method: 'POST', url: EVO + '/message/sendMedia/' + encodeURIComponent(src.instance),
  headers: { apikey: K.EVO, 'Content-Type': 'application/json' }, json: true, timeout: 60000,
  body: { number: src.phone, mediatype: 'document', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: fname, caption, media: built.docx.toString('base64') } }), 60000, 'إرسال الملف');
return [{ json: { sent: fname, pdf: !!pdf, pdfPages: pdf ? pdf.pages : null, seconds: Math.round(elapsed() / 1000), model: usedModel, readBy, paidCostUSD: paidCost, estimatedPages: built.pages, tried: errors } }];

// ======================================================================
// قراءة نص docx: فك ضغط ZIP (inflate) ثم استخراج النص من word/document.xml
function inflateRaw(srcb) {
  let pos = 0, bitbuf = 0, bitcnt = 0, out = new Uint8Array(srcb.length * 4 + 1024), olen = 0;
  const put = (v) => { if (olen >= out.length) { const n = new Uint8Array(out.length * 2); n.set(out); out = n; } out[olen++] = v; };
  const bits = (n) => { while (bitcnt < n) { if (pos >= srcb.length) throw new Error('eof'); bitbuf |= srcb[pos++] << bitcnt; bitcnt += 8; } const v = bitbuf & ((1 << n) - 1); bitbuf >>>= n; bitcnt -= n; return v; };
  const build = (lens, n) => {
    const count = new Uint16Array(16), offs = new Uint16Array(16), symbol = new Uint16Array(n);
    for (let i = 0; i < n; i++) count[lens[i]]++;
    count[0] = 0;
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
    for (let i = 0; i < n; i++) if (lens[i]) symbol[offs[lens[i]]++] = i;
    return { count, symbol };
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new Error('bad code');
  };
  const LB = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LE = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DB = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DE = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const codes = (lc, dc) => {
    for (;;) {
      let sym = decode(lc);
      if (sym < 256) put(sym);
      else if (sym === 256) return;
      else {
        sym -= 257;
        const len = LB[sym] + bits(LE[sym]);
        const ds = decode(dc);
        const dist = DB[ds] + bits(DE[ds]);
        for (let i = 0; i < len; i++) put(out[olen - dist]);
      }
    }
  };
  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitbuf = 0; bitcnt = 0;
      const len = srcb[pos] | (srcb[pos + 1] << 8); pos += 4;
      for (let i = 0; i < len; i++) put(srcb[pos++]);
    } else if (type === 1) {
      const l = new Uint8Array(288);
      for (let i = 0; i < 144; i++) l[i] = 8; for (let i = 144; i < 256; i++) l[i] = 9; for (let i = 256; i < 280; i++) l[i] = 7; for (let i = 280; i < 288; i++) l[i] = 8;
      const dl = new Uint8Array(30).fill(5);
      codes(build(l, 288), build(dl, 30));
    } else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      const ORD = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      const cl = new Uint8Array(19);
      for (let i = 0; i < ncode; i++) cl[ORD[i]] = bits(3);
      const clh = build(cl, 19);
      const lens = new Uint8Array(nlen + ndist);
      for (let idx = 0; idx < nlen + ndist;) {
        let sym = decode(clh);
        if (sym < 16) lens[idx++] = sym;
        else {
          let len = 0, rep;
          if (sym === 16) { len = lens[idx - 1]; rep = 3 + bits(2); } else if (sym === 17) rep = 3 + bits(3); else rep = 11 + bits(7);
          while (rep--) lens[idx++] = len;
        }
      }
      codes(build(lens.subarray(0, nlen), nlen), build(lens.subarray(nlen), ndist));
    } else throw new Error('bad block');
  } while (!last);
  return Buffer.from(out.subarray(0, olen));
}
function unzipEntry(buf, wanted) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip');
  let p = buf.readUInt32LE(e + 16);
  const n = buf.readUInt16LE(e + 10);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    if (name === wanted) {
      const ds = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
      const data = buf.slice(ds, ds + csize);
      return method === 0 ? data : inflateRaw(data);
    }
    p += 46 + nl + xl + cl;
  }
  throw new Error('missing ' + wanted);
}
// أسطر ملف Word بالترتيب، بنصها كما هو: { id, text } أو { id, table: [[خلية...]] } أو { id, empty } أو { id, image }
// الترقيم التلقائي في Word (١- ، أ- ، 1)) ليس جزءاً من النص، فيُحسب من numbering.xml ويُضاف في أول السطر كما يظهر في Word
function docxLines(buf) {
  let xml = unzipEntry(buf, 'word/document.xml').toString('utf8');
  xml = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '')
    .replace(/<w:txbxContent>([\s\S]*?)<\/w:txbxContent>/g, (m, inner) => '<w:t> </w:t>' + inner.replace(/<w:p(?=[\s>])[^>]*>|<\/w:p>|<w:pPr>[\s\S]*?<\/w:pPr>/g, '<w:t> </w:t>'));
  xml = symFix(xml);
  const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const textOf = (frag) => {
    let out = '', m;
    const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br[^>]*\/>/g;
    while ((m = re.exec(frag))) out += m[0].indexOf('<w:t') === 0 && m[0] !== '<w:tab/>' ? ent(m[1]) : m[0] === '<w:tab/>' ? '   ' : ' ';
    return out.replace(/[\u200B\uFEFF]/g, '').replace(/\s+$/, '').replace(/^\s+/, '');
  };
  // الترقيم التلقائي
  const nums = {}, abs = {}, counters = {};
  try {
    const nx = unzipEntry(buf, 'word/numbering.xml').toString('utf8');
    for (const a of nx.match(/<w:abstractNum [\s\S]*?<\/w:abstractNum>/g) || []) {
      const id = (/w:abstractNumId="(\d+)"/.exec(a) || [])[1], lv = {};
      for (const l of a.match(/<w:lvl [\s\S]*?<\/w:lvl>/g) || []) {
        const g = (re) => (re.exec(l) || [])[1];
        lv[g(/w:ilvl="(\d+)"/)] = { fmt: g(/<w:numFmt w:val="([^"]+)"/) || 'decimal', text: ent(g(/<w:lvlText w:val="([^"]*)"/) || ''), start: +(g(/<w:start w:val="(\d+)"/) || 1) };
      }
      abs[id] = lv;
    }
    for (const n of nx.match(/<w:num [\s\S]*?<\/w:num>/g) || []) nums[(/w:numId="(\d+)"/.exec(n) || [])[1]] = (/<w:abstractNumId w:val="(\d+)"/.exec(n) || [])[1];
  } catch (_) {}
  const HINDI = '٠١٢٣٤٥٦٧٨٩', ABJAD = 'أبجدهوزحطيكلمنسعفصقرشتثخذضظغ', ALPHA = 'أبتثجحخدذرزسشصضطظعغفقكلمنهوي';
  const fmtNum = (n, f) => f === 'bullet' ? '•' : f === 'none' ? '' : /hindi|arabicIndic/i.test(f) ? String(n).replace(/\d/g, (d) => HINDI[d])
    : f === 'arabicAbjad' ? ABJAD[(n - 1) % ABJAD.length] : f === 'arabicAlpha' ? ALPHA[(n - 1) % ALPHA.length]
    : /lowerLetter/.test(f) ? String.fromCharCode(96 + ((n - 1) % 26) + 1) : /upperLetter/.test(f) ? String.fromCharCode(64 + ((n - 1) % 26) + 1) : String(n);
  const label = (pXml) => {
    const numId = (/<w:numId w:val="(\d+)"/.exec(pXml) || [])[1];
    if (!numId || numId === '0' || !nums[numId] || !abs[nums[numId]]) return '';
    const aid = nums[numId], lv = abs[aid], il = +((/<w:ilvl w:val="(\d+)"/.exec(pXml) || [])[1] || 0);
    const c = counters[aid] || (counters[aid] = {});
    c[il] = c[il] == null ? (lv[il] ? lv[il].start : 1) : c[il] + 1;
    for (const k of Object.keys(c)) if (+k > il) delete c[k];
    if (!lv[il]) return '';
    const t = lv[il].text.replace(/%(\d)/g, (_, k) => { const L = +k - 1; return fmtNum(c[L] != null ? c[L] : (lv[L] ? lv[L].start : 1), (lv[L] || {}).fmt || 'decimal'); });
    return t ? t + ' ' : '';
  };
  // غامق: كل مقاطع الفقرة التي فيها نص غامقة. وسط: محاذاة الفقرة في المنتصف
  const isBold = (p) => { const rs = (p.match(/<w:r[\s>][\s\S]*?<\/w:r>/g) || []).filter((r) => /<w:t[\s>][^<]*\S[^<]*<\/w:t>|<w:t>[^<]*\S[^<]*<\/w:t>/.test(r)); return rs.length > 0 && rs.every((r) => /<w:b(?:\/>| w:val="(?:1|true|on)"\/>)/.test(r)); };
  const isCenter = (p) => /<w:jc w:val="center"\/>/.test((/<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p) || [''])[0]);
  const body = xml.slice(xml.indexOf('<w:body>') + 8, xml.lastIndexOf('<w:sectPr') > 0 ? xml.lastIndexOf('<w:sectPr') : xml.indexOf('</w:body>'));
  const lines = [];
  const add = (o) => { o.id = lines.length + 1; lines.push(o); };
  let pos = 0;
  while (pos < body.length) {
    const nt = body.indexOf('<w:tbl>', pos), np = body.slice(pos).search(/<w:p(?=[\s>\/])/);
    const pAt = np < 0 ? -1 : pos + np;
    if (nt < 0 && pAt < 0) break;
    if (nt >= 0 && (pAt < 0 || nt < pAt)) {
      let depth = 0, i = nt, end = -1;
      const re = /<w:tbl>|<\/w:tbl>/g; re.lastIndex = nt;
      let m;
      while ((m = re.exec(body))) { depth += m[0] === '<w:tbl>' ? 1 : -1; if (!depth) { end = re.lastIndex; break; } }
      if (end < 0) break;
      const tbl = body.slice(nt, end);
      const trs = (tbl.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || []).map((tr) => tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []);
      const parasOf = (tc) => (tc.match(/<w:p(?=[\s>])[\s\S]*?<\/w:p>/g) || []).filter((p) => textOf(p));
      // صندوق: جدول من عمود واحد (حتى ٣ صفوف) يستعمله المعلم إطاراً لعنوان سؤال أو فقرة قراءة أو بنك كلمات
      if (trs.length && trs.length <= 3 && trs.every((r) => r.length === 1) && tbl.indexOf('<w:tbl>', 7) < 0) {
        for (const [tc] of trs) {
          const ps = parasOf(tc), text = ps.map((p) => (label(p) + textOf(p)).trim()).join(' ');
          const fill = ((/<w:shd [^>]*w:fill="([0-9A-Fa-f]{6})"/.exec(tc) || [])[1] || '').toUpperCase();
          if (text) add({ text, box: true, fill: fill && fill !== 'FFFFFF' ? fill : '', bold: ps.every(isBold), center: ps.every(isCenter) });
        }
      } else {
        const rows = trs.map((r) => r.map((tc) => parasOf(tc).map((p) => (label(p) + textOf(p)).trim()).join(' ')));
        const tb = trs.map((r) => r.map((tc) => { const ps = parasOf(tc); return ps.length > 0 && ps.every(isBold); }));
        if (rows.some((r) => r.some(Boolean))) add({ table: rows.filter((r) => r.length), tb: tb.filter((r) => r.length) });
      }
      pos = end;
    } else {
      if (body.substr(pAt, 6) === '<w:p/>') { add({ empty: true }); pos = pAt + 6; continue; }
      const end = body.indexOf('</w:p>', pAt);
      if (end < 0) break;
      const p = body.slice(pAt, end + 6);
      const text = textOf(p), lab = text ? label(p) : '';
      if (text) add({ text: lab + text, bold: isBold(p), center: isCenter(p) });
      if (/<w:drawing|<w:pict|<w:object/.test(p)) add({ image: true });
      else if (!text) add({ empty: true });
      pos = end + 6;
    }
  }
  return lines;
}

// رموز خطوط الرموز (Wingdings وأخواته) إلى حروفها العادية: ✔ ✖ ☑ ☒ □ → ...
function symFix(xml) {
  const MAP = {
    wingdings: { 0xFC: '✔', 0xFB: '✖', 0xFE: '☑', 0xFD: '☒', 0xA8: '□', 0x6F: '□', 0x71: '□', 0x72: '□', 0xE0: '→', 0xDF: '←', 0xE8: '→', 0xD8: '➢', 0xF0: '→', 0xEF: '←', 0x6C: '●', 0x6E: '■', 0xA7: '▪', 0x9F: '•', 0xA1: '○', 0x4A: '☺', 0x4C: '☹', 0x46: '☞', 0xAB: '★', 0x76: '❖' },
    'wingdings 2': { 0x50: '✔', 0x4F: '✖', 0x51: '☒', 0x52: '☑', 0x53: '☒', 0x54: '☒', 0xA3: '□', 0x2A: '□', 0x30: '□', 0x97: '●', 0x98: '○' },
    webdings: { 0x61: '✔', 0x72: '✖', 0x63: '□', 0x3D: '●' },
    symbol: { 0xD6: '√', 0xB4: '×', 0xB8: '÷', 0xAE: '→', 0xAC: '←', 0xB7: '•', 0xA3: '≤', 0xB3: '≥', 0xB9: '≠', 0xB1: '±', 0xBB: '≈', 0xB0: '°' },
  };
  const conv = (font, code) => { const m = MAP[String(font || '').toLowerCase()]; if (!m) return null; if (code >= 0xF000 && code <= 0xF0FF) code -= 0xF000; return m[code] || null; };
  xml = xml.replace(/<w:sym\b[^>]*\/>/g, (t) => {
    const ch = conv((/w:font="([^"]+)"/.exec(t) || [])[1], parseInt((/w:char="([0-9A-Fa-f]+)"/.exec(t) || [])[1] || '0', 16));
    return ch ? '<w:t>' + ch + '</w:t>' : t;
  });
  return xml.replace(/<w:r[\s>][\s\S]*?<\/w:r>/g, (r) => {
    const font = (/<w:rFonts [^>]*w:(?:ascii|hAnsi)="(Wingdings(?: 2)?|Webdings|Symbol)"/i.exec(r) || [])[1];
    if (!font) return r;
    return r.replace(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g, (m, a, txt, z) => a + Array.from(txt).map((c) => conv(font, c.codePointAt(0)) || c).join('') + z);
  });
}

// ======================================================================
// بناء ملف Word بقالب الأكاديمية (نفس قالب خدمة التنسيق السابقة) دون مكتبات
function buildDocx(exIn) {
  const S = (v, d) => (typeof v === 'string' && v.trim() ? v : d).slice(0, 300);
  const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن'];
  const OK = ['h', 'p', 'line', 'passage', 'pair', 'opts', 'poem2', 'center', 'gap', 'grid', 'boxes'];
  const ex = {
    kind: exIn.kind === 'ورقة عمل' ? 'ورقة عمل' : 'اختبار',
    subject: S(exIn.subject, '.........'), grade: S(exIn.grade, 'الصف .........'), total: S(String(exIn.total || ''), ''),
    pre: (exIn.pre || []).filter((it) => it && OK.includes(it.t)).slice(0, 30),
    sections: (exIn.sections || []).slice(0, 12).map((s, i) => ({
      num: S(s.num, ORD[i]), title: (Array.isArray(s.title) ? s.title : [s.title]).filter((t) => typeof t === 'string' && t).slice(0, 2),
      marks: typeof s.marks === 'string' ? s.marks.slice(0, 30) : '',
      items: (s.items || []).filter((it) => it && OK.includes(it.t)).slice(0, 200),
    })),
  };
  ex.sections.forEach((s, i) => { if (!s.title.length) s.title = ['السؤال ' + (ORD[i] || '')]; });
  // الصف دائماً بكلمة «الأساسي»: «الصف الخامس الأساسي»
  if (!/الأساسي/.test(ex.grade)) ex.grade = ex.grade.trim() + ' الأساسي';

  const PAGE_W = 11906, PAGE_H = 16838, M = 794, CW = PAGE_W - 2 * M;
  const HDR_CM = 21.0 * 318 / 3500, FTR_CM = 1.8;
  const TOP = Math.round((HDR_CM + 0.3) / 2.54 * 1440), BOT = Math.round((FTR_CM + 0.3) / 2.54 * 1440);
  const BODY_H = PAGE_H - TOP - BOT;
  const INNER = CW - 200 - 260, TXT = 23, DOT_TW = 0.29 * 11 * 20, GOLD = 'C6A668', LINE = 'D6DDE6', CREAM = 'FFFCF4';
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // تقدير الطول لتصغير المسافات إن زاد عن صفحتين
  const plain = (parts) => (Array.isArray(parts) ? parts : [parts]).map((x) => typeof x === 'string' ? x : x && (x.b || x.u || (x.d ? '.'.repeat(x.d / 3) : '')) || '').join('');
  const estItem = (it, k) => {
    const lines = (t, per) => Math.max(1, Math.ceil(String(t).length / per));
    switch (it.t) {
      case 'h': return 460;
      case 'p': return 380 * lines(plain(it.parts), 95);
      case 'line': return (it.h || 520) * k + 40;
      case 'passage': return 320 * lines(it.text || '', 85) + 260;
      case 'pair': case 'opts': return 420;
      case 'poem2': return 420 * ((it.rows || []).length || 1) + 60;
      case 'center': return 330 * ((it.lines || []).length || 1) + 100;
      case 'grid': return Math.max((it.h || 400) * k, 400) * ((it.rows || []).length || 1) + 80;
      case 'boxes': return 1000;
      case 'gap': return (it.h || 300) * k;
      default: return 300;
    }
  };
  // المعامل 1.3 من مقارنة التقدير بصفحات Word الفعلية (التقدير الخام كان أقل من الحقيقة)
  const estimate = (k) => 1.3 * (1500 + 700 + ex.pre.reduce((b, it) => b + estItem(it, k), 0) + ex.sections.reduce((a, s) => a + 850 + s.items.reduce((b, it) => b + estItem(it, k), 0), 0));
  let k = 1;
  if (estimate(1) > 2 * BODY_H) k = estimate(0.8) <= 2 * BODY_H ? 0.8 : 0.65;
  const pages = +exIn.forcePages || Math.ceil(estimate(k) / BODY_H);
  const sc = (v, d) => Math.round((v || d) * k);

  // عناصر WordprocessingML
  // LTR: العنصر الجاري إنجليزي (من اليسار لليمين)
  let LTR = false;
  const R = (text, o = {}) => {
    const sz = o.raw || Math.round((o.size || TXT) * 1.12);
    return '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>' + (o.bold ? '<w:b/><w:bCs/>' : '') +
      '<w:color w:val="000000"/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/>' + (o.u ? '<w:u w:val="single" w:color="000000"/>' : '') +
      (o.ltr || (LTR && o.ltr !== false) ? '<w:rtl w:val="0"/>' : '<w:rtl/>') + '</w:rPr><w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>';
  };
  const DOTS = (n) => R(' ' + '.'.repeat(Math.max(3, Math.min(160, Math.round(n)))) + ' ', { raw: 20 });
  const P = (runs, o = {}) => '<w:p><w:pPr>' + (o.keepNext ? '<w:keepNext/>' : '') +
    (o.bottom ? '<w:pBdr><w:bottom w:val="' + (o.bottom.val || 'single') + '" w:sz="' + o.bottom.sz + '" w:space="1" w:color="' + o.bottom.color + '"/></w:pBdr>' : '') +
    (o.ltr || (LTR && o.ltr !== false) ? '<w:bidi w:val="0"/>' : '<w:bidi/>') + '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after || 0) + '" w:line="' + (o.line || 240) + '" w:lineRule="auto"/>' +
    (o.indent ? '<w:ind w:start="' + o.indent + '"/>' : '') + '<w:jc w:val="' + (o.align || 'start') + '"/></w:pPr>' + (runs || '') + '</w:p>';
  const NIL = { val: 'nil' };
  const bd = (tag, b) => b && b.val !== 'nil' ? '<w:' + tag + ' w:val="' + (b.val || 'single') + '" w:sz="' + b.sz + '" w:space="0" w:color="' + b.color + '"/>' : '<w:' + tag + ' w:val="nil"/>';
  const L = (color, sz = 6, val = 'single') => ({ color, sz, val });
  const C = (content, w, o = {}) => {
    const b = Object.assign({ top: NIL, left: NIL, bottom: NIL, right: NIL }, o.b || {});
    const m = o.m || { top: 40, bottom: 40, left: 100, right: 100 };
    if (!/<\/w:p>$/.test(content)) content += P('', { line: 120 });
    return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + (o.span ? '<w:gridSpan w:val="' + o.span + '"/>' : '') +
      '<w:tcBorders>' + bd('top', b.top) + bd('left', b.left) + bd('bottom', b.bottom) + bd('right', b.right) + '</w:tcBorders>' +
      (o.fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + o.fill + '"/>' : '') +
      '<w:tcMar><w:top w:w="' + m.top + '" w:type="dxa"/><w:left w:w="' + m.left + '" w:type="dxa"/><w:bottom w:w="' + m.bottom + '" w:type="dxa"/><w:right w:w="' + m.right + '" w:type="dxa"/></w:tcMar>' +
      '<w:vAlign w:val="' + (o.v || 'center') + '"/></w:tcPr>' + content + '</w:tc>';
  };
  const TR = (cells, o = {}) => '<w:tr><w:trPr>' + (o.cantSplit ? '<w:cantSplit/>' : '') + (o.h ? '<w:trHeight w:val="' + o.h + '" w:hRule="' + (o.rule || 'atLeast') + '"/>' : '') + '</w:trPr>' + cells.join('') + '</w:tr>';
  const T = (rows, widths, B, ind) => '<w:tbl><w:tblPr>' + (LTR ? '' : '<w:bidiVisual/>') + '<w:tblW w:w="' + widths.reduce((a, b) => a + b, 0) + '" w:type="dxa"/>' + (ind ? '<w:tblInd w:w="' + ind + '" w:type="dxa"/>' : '') + '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((t) => bd(t, B || NIL)).join('') + '</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' +
    widths.map((w) => '<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>' + rows.join('') + '</w:tbl>';
  const SPACER = P(R(' ', { size: 6 }), { after: 40 });

  const runs = (parts) => (Array.isArray(parts) ? parts : [parts]).map((x) =>
    typeof x === 'string' || typeof x === 'number' ? R(String(x))
      : !x ? '' : x.d ? DOTS(x.d) : x.u ? R(x.u, { u: true, bold: true }) : x.b ? R(x.b, { bold: true }) : x.text ? R(x.text) : '').join('');
  const SP = { line: 310, after: 70 };

  // لغة النص: إنجليزي إن كانت حروفه اللاتينية أكثر من العربية (null إن لم يكن فيه حروف)
  const valText = (v) => typeof v === 'string' ? v : Array.isArray(v) ? v.map(valText).join(' ') : v && typeof v === 'object' ? Object.keys(v).filter((k) => k !== 't').map((k) => valText(v[k])).join(' ') : '';
  const isLatin = (v) => { const t = valText(v), a = (t.match(/[\u0600-\u06FF]/g) || []).length, l = (t.match(/[A-Za-z]/g) || []).length; return a + l < 2 ? null : l > a; };
  function item(it) { const prev = LTR, lang = isLatin(it); if (lang !== null) LTR = lang; try { return itemInner(it); } finally { LTR = prev; } }
  function itemInner(it) {
    switch (it.t) {
      case 'h': return P(R(String(it.text || ''), { bold: true }) + (it.colon === false ? '' : R(':', { bold: true })), { before: 110, after: 60, bottom: L(GOLD, 4) });
      case 'p': return P(runs(it.parts), Object.assign({}, SP, it.indent ? { indent: 240 } : {}));
      case 'line': return P(DOTS(Math.floor((INNER - 300) / DOT_TW)), { line: sc(it.h, 520), after: 40 });
      case 'passage':
        return T([TR([C(P(R(String(it.text || ''), { bold: true }), { line: 320, align: 'both' }), INNER,
          { fill: CREAM, b: LTR ? { left: L(GOLD, 24), top: L('EFE4CC', 4), bottom: L('EFE4CC', 4), right: L('EFE4CC', 4) } : { right: L(GOLD, 24), top: L('EFE4CC', 4), bottom: L('EFE4CC', 4), left: L('EFE4CC', 4) }, m: { top: 90, bottom: 90, left: 200, right: 220 } })])], [INNER]) + SPACER;
      case 'pair': {
        const w = Math.floor(INNER / 2), cell = (parts) => C(P(runs(parts || ['']), { line: 330 }), w, { m: { top: 50, bottom: 70, left: 60, right: 0 } });
        return T([TR([cell(it.a), cell(it.b)], { cantSplit: true })], [w, w]);
      }
      case 'opts': {
        const list = (it.items || []).slice(0, 6); if (!list.length) return '';
        const w = Math.floor((INNER - 300) / list.length);
        return T([TR(list.map((x) => C(P(runs(x), { line: 300 }), w, { m: { top: 20, bottom: 60, left: 60, right: 300 } })))], list.map(() => w));
      }
      case 'poem2': {
        const w = Math.floor(INNER / 2), rows = (it.rows || []).filter(Array.isArray); if (!rows.length) return '';
        return T(rows.map(([a, b]) => TR([C(P(R(String(a || ''), { bold: true }), { align: 'center', line: 320 }), w, { fill: CREAM }),
          C(P(R(String(b || ''), { bold: true }), { align: 'center', line: 320 }), w, { fill: CREAM })])), [w, w]) + SPACER;
      }
      case 'center': {
        const ls = (it.lines || []).map(String);
        return ls.map((l, i) => P(R(l, { bold: true }), { align: 'center', line: 320, after: i === ls.length - 1 ? 100 : 0 })).join('');
      }
      case 'grid': {
        const rows = (it.rows || []).filter(Array.isArray); if (!rows.length) return '';
        const n = Math.max.apply(null, rows.map((r) => r.length)), tot = INNER - 200;
        let ws = Array.isArray(it.w) && it.w.length === n && it.w.every((x) => +x > 0) ? it.w.map(Number) : Array(n).fill(Math.floor(tot / n));
        const sum = ws.reduce((a, b) => a + b, 0); ws = ws.map((x) => Math.floor(x * tot / sum));
        const B = L('000000', 6), h = Math.max(300, sc(it.h, 400));
        return T(rows.map((row) => TR(ws.map((w, i) => C(P(runs(row[i] == null ? '' : row[i]), { align: 'center', line: 300 }), w,
          { b: { top: B, bottom: B, left: B, right: B }, m: { top: 40, bottom: 40, left: 60, right: 60 } })), { cantSplit: true, h })), ws, B) + SPACER;
      }
      case 'boxes': {
        const list = (it.items || []).slice(0, 4); if (!list.length) return '';
        const wi = Math.floor((INNER - 200) / list.length), B = L('000000', 6);
        return T([TR(list.map((x) => {
          const cnt = Math.max(1, Math.min(10, +x.n || 4)), bw = Math.min(520, Math.floor((wi - 160) / cnt));
          const inner = T([TR(Array.from({ length: cnt }, () => C(P(R(' ')), bw, { b: { top: B, bottom: B, left: B, right: B } })), { h: 480, rule: 'exact' })], Array(cnt).fill(bw), B);
          return C(P(R(String(x.label || ''), { bold: true, size: 25 }), { after: 50 }) + inner, wi, { m: { top: 40, bottom: 80, left: 60, right: 60 } });
        }))], list.map(() => wi)) + SPACER;
      }
      case 'gap': return P(R(' '), { line: Math.max(240, sc(it.h, 300)) });
      default: return '';
    }
  }
  // رأس السؤال: «السؤال الأول» في خانة، والتعليمة بجانبها، والسطر كله مظلل بحدود
  // اسم السؤال من ترتيبه دائماً («السؤال الثاني»)، لا من النموذج الذي قد ينقل ترقيم الملف الأصلي (II أو 2 أو ب)
  const ORD_ALL = ORD.concat(['التاسع', 'العاشر']);
  const ORD_EN = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth'];
  const EN = isLatin(ex.sections.map((s) => [s.title.slice(1), s.items])) === true;
  const HEAD_ONLY = new RegExp('^[\\s\\u200E\\u200F]*(?:السؤال\\s+\\S+|(?:ال)?(?:نشاط|تدريب|تمرين|مهمة)\\s*\\(?\\s*(?:[0-9٠-٩]+|ال\\S+)\\s*\\)?|(?:Question|Q)\\s*\\.?\\s*(?:\\d+|[IVX]+)|(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth)\\s+Question|Question\\s+(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)|(?:Part|Section|Activity|Exercise|Task)\\s+(?:\\d+|[A-Z]|[IVX]+)|[IVX]+(?=\\s*[:\\-–.)]))\\s*[:：\\-–.)]?\\s*', 'i');
  function section(s, i) { const prev = LTR; LTR = EN; try { return sectionInner(s, i); } finally { LTR = prev; } }
  function sectionInner(s, i) {
    const NB2 = L('000000', 8), BOX = L(LINE, 8), MW = s.marks ? 1700 : 0, QW = MW ? [2300, CW - 2300 - MW, MW] : [2300, CW - 2300], ALL = { top: NB2, bottom: NB2, right: NB2, left: NB2 }, SHADE = 'E3E3E3';
    const qname = EN ? (ORD_EN[i] ? ORD_EN[i] + ' Question' : 'Question ' + (i + 1)) : 'السؤال ' + (ORD_ALL[i] || String(i + 1));
    // التعليمة: إن كان العنوان الأول اسم السؤال فقط («السؤال الأول» أو «First Question») فالتعليمة هي الثاني
    const t0 = String(s.title[0] || ''), instr = String((s.title.length > 1 && !t0.replace(HEAD_ONLY, '').trim() ? s.title[1] : t0) || '').replace(HEAD_ONLY, '').trim();
    s = Object.assign({}, s, { title: [qname, instr] });   // s.marks يبقى كما هو
    let body = s.items.map(item).join('');
    return P(R(' ', { size: 6 }), { before: 100, keepNext: true }) + T([
      TR([C(P(R(qname, { size: 23, bold: true }), { align: 'center', keepNext: true }), QW[0], { fill: SHADE, b: ALL }),
        C(P(s.title[1] ? R(s.title[1], { size: 22, bold: true, ltr: isLatin(s.title[1]) === null ? undefined : isLatin(s.title[1]) }) : '', { keepNext: true, ltr: isLatin(s.title[1]) === null ? undefined : isLatin(s.title[1]) }), QW[1],
          { fill: SHADE, b: ALL, m: { top: 60, bottom: 60, left: 120, right: 200 } })].concat(MW ? [C(P(R(s.marks, { size: 22, bold: true, ltr: isLatin(s.marks) === null ? undefined : isLatin(s.marks) }), { align: 'center', keepNext: true, ltr: isLatin(s.marks) === null ? undefined : isLatin(s.marks) }), MW, { fill: SHADE, b: ALL })] : []), { cantSplit: true, h: 520 }),
      TR([C(body, CW, { span: QW.length, v: 'top', b: { left: BOX, right: BOX, bottom: BOX }, m: { top: 100, bottom: 60, left: 200, right: 260 } })]),
    ], QW, null, EN ? 200 : 0);
  }

  // العنوان: خطان ذهبيان على الجانبين (بدل صورتي الفاصل) والنوع والمادة في الوسط
  const sw = [1700, CW - 3400, 1700];
  const sep = C(P('', { bottom: L(GOLD, 12), line: 120 }), 1700, { m: { top: 0, bottom: 0, left: 40, right: 40 } });
  let body = T([TR([sep, C(P(R(ex.kind + ': ', { size: 22, bold: true }) + R(ex.subject + ' – ' + ex.grade, { size: 28, bold: true }), { align: 'center' }), sw[1], { m: { top: 0, bottom: 0, left: 40, right: 40 } }), sep])], sw);
  // السنة «2026/2027» في مقطع مستقل من اليسار لليمين حتى لا تنقلب إلى 2027/2026 في السطر العربي
  if (TERM) body += P(TERM.split(/(\d+\s*\/\s*\d+)/).filter(Boolean).map((t) => R(t, { size: 22, bold: true, ltr: /^\d/.test(t) })).join(''), { align: 'center', before: 40 });
  body += P(R(' ', { size: 2 }), { after: 50, line: 120 });
  const iw = [1700, CW - 4400, 1100, 1600], BOX = L('000000', 8), DOT = L('000000', 6, 'dotted');
  const lab = (t, w, b) => C(P(R(t, { size: 22, bold: true })), w, { b, m: { top: 90, bottom: 90, left: 60, right: 150 } });
  const val = (t, w, b) => C(P(R(t, { size: 22, bold: true }), { bottom: DOT }), w, { b, m: { top: 90, bottom: 90, left: 160, right: 60 } });
  body += T([TR([lab('اسم الطالب', iw[0], { top: BOX, bottom: BOX, left: L(GOLD, 30) }), val('', iw[1], { top: BOX, bottom: BOX, right: BOX }),
    lab('الدرجة', iw[2], { top: BOX, bottom: BOX }), val('        / ' + ex.total, iw[3], { top: BOX, bottom: BOX, right: BOX })])], iw);
  if (ex.pre.length) body += P(R(' ', { size: 6 }), { before: 80 }) + ex.pre.map(item).join('');
  body += ex.sections.map((s, i) => section(s, i)).join('');
  body += P(R('بالتوفيق والنجاح', { size: 26, bold: true }), { align: 'center', before: 200 });

  const EMU = 360000, WEMU = Math.round(21.0 * EMU);
  let pid = 1;
  const pic = (rid, hcm, ycm) => { const id = pid++, cy = Math.round(hcm * EMU);
    return '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="' + id + '" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
      '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>' + Math.round(ycm * EMU) + '</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="' + WEMU + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="' + id + '" name="img' + id + '"/><wp:cNvGraphicFramePr/>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="img' + id + '.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + WEMU + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'; };
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const header = X + '<w:hdr ' + NS + '>' + P(pic('rImg', HDR_CM, 0), { ltr: true }) + '</w:hdr>';
  const footer = X + '<w:ftr ' + NS + '>' + P(pic('rImg', FTR_CM, 29.7 - FTR_CM), { ltr: true }) + '</w:ftr>';
  const footerFirst = X + '<w:ftr ' + NS + '>' + P(pic('rImg', FTR_CM, 29.7 - FTR_CM) + (() => {
    if (exIn.staticTurn) return pages > 1 ? R('اقلب الصفحة  ⟵', { size: 22, bold: true }) : '';
    const o = { size: 22, bold: true }, rp = (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(R('', o)) || [''])[0], run = (x) => '<w:r>' + rp + x + '</w:r>';
    const ch = (t) => run('<w:fldChar w:fldCharType="' + t + '"/>'), code = (t) => run('<w:instrText xml:space="preserve">' + t + '</w:instrText>');
    return ch('begin') + code(' IF ') + ch('begin') + code(' NUMPAGES ') + ch('separate') + run('<w:t>' + pages + '</w:t>') + ch('end') +
      code(' &gt; 1 "اقلب الصفحة  ⟵" "" ') + ch('separate') + (pages > 1 ? R('اقلب الصفحة  ⟵', o) : '') + ch('end');
  })(), { ltr: true, align: 'left', after: 1020 }) + '</w:ftr>';
  const doc = X + '<w:document ' + NS + '><w:body>' + body +
    '<w:sectPr><w:headerReference w:type="default" r:id="rHdr"/><w:headerReference w:type="first" r:id="rHdr"/><w:footerReference w:type="default" r:id="rFtr"/><w:footerReference w:type="first" r:id="rFtr1"/>' +
    '<w:pgSz w:w="' + PAGE_W + '" w:h="' + PAGE_H + '"/><w:pgMar w:top="' + TOP + '" w:right="' + M + '" w:bottom="' + BOT + '" w:left="' + M + '" w:header="0" w:footer="0" w:gutter="0"/>' +
    '<w:titlePg/><w:bidi/></w:sectPr></w:body></w:document>';
  const rel = (id, type, target) => '<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + type + '" Target="' + target + '"/>';
  const rels = (x) => X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + x + '</Relationships>';
  const files = [
    ['[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'],
    ['_rels/.rels', rels(rel('rDoc', 'officeDocument', 'word/document.xml') + '<Relationship Id="rCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>')],
    ['docProps/core.xml', X + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + esc(ex.kind + ' – ' + ex.subject + ' – ' + ex.grade) + '</dc:title><dc:creator>Third Pillar Academy</dc:creator></cp:coreProperties>'],
    ['word/document.xml', doc],
    ['word/_rels/document.xml.rels', rels(rel('rStyles', 'styles', 'styles.xml') + rel('rHdr', 'header', 'header1.xml') + rel('rFtr', 'footer', 'footer1.xml') + rel('rFtr1', 'footer', 'footer2.xml'))],
    ['word/styles.xml', X + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="23"/><w:szCs w:val="23"/><w:rtl/><w:lang w:val="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>'],
    ['word/header1.xml', header],
    ['word/_rels/header1.xml.rels', rels(rel('rImg', 'image', 'media/banner.jpg'))],
    ['word/footer1.xml', footer],
    ['word/_rels/footer1.xml.rels', rels(rel('rImg', 'image', 'media/footer.jpg'))],
    ['word/footer2.xml', footerFirst],
    ['word/_rels/footer2.xml.rels', rels(rel('rImg', 'image', 'media/footer.jpg'))],
    ['word/media/banner.jpg', Buffer.from(__BANNER__, 'base64')],
    ['word/media/footer.jpg', Buffer.from(__FOOTER__, 'base64')],
  ];
  return { docx: zipStore(files), pages, kind: ex.kind, subject: ex.subject, grade: ex.grade };
}
// ZIP بلا ضغط (Word يقبله)
function zipStore(files) {
  const T = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c; }
  const crc = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const locals = [], centrals = [];
  let off = 0;
  for (const [name, content] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'), nb = Buffer.from(name, 'utf8'), c = crc(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(33, 12);
    lh.writeUInt32LE(c, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(33, 14);
    ch.writeUInt32LE(c, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, data); centrals.push(ch, nb);
    off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat(locals.concat([cd, end]));
}
