// تنسيق الاختبارات: «تنسيق» ثم الملف (Word أو PDF أو صورة) خلال 30 دقيقة، أو الملف مع تعليق «تنسيق».
// ما عدا ذلك يمر كما هو إلى بوت الغياب والدوام دون أي تغيير، وأي أمر نصي آخر بعد «تنسيق» يلغي انتظار الملف.
// اختياري: أرقام المسموح لهم بالتنسيق بصيغة دولية مفصولة بفواصل، مثل '201012345678,201098765432'. فارغ = الجميع.
const ALLOWED = '';

const item = $input.first().json;
const pass = () => [{ json: item }];
const body = item.body || item;
const d = body.data || {};
const key = d.key || {};
if (key.fromMe) return pass();
let jid = key.remoteJid || '';
if (jid.endsWith('@g.us') || jid === 'status@broadcast') return pass();
if (jid.endsWith('@lid')) jid = key.senderPn || key.remoteJidAlt || key.participantAlt || d.senderPn || d.remoteJidAlt || jid;
const phone = String(jid).split('@')[0].replace(/[^0-9]/g, '');
if (!phone || String(jid).endsWith('@lid')) return pass();
const allow = ALLOWED.split(',').map((s) => s.trim()).filter(Boolean);
if (allow.length && !allow.includes(phone)) return pass();

let m = d.message || {};
for (let i = 0; i < 4; i++) {
  const inner = (m.ephemeralMessage || m.viewOnceMessage || m.viewOnceMessageV2 || m.documentWithCaptionMessage || {}).message;
  if (!inner) break;
  m = inner;
}
const doc = m.documentMessage, img = m.imageMessage, file = doc || img;
const text = String(m.conversation || (m.extendedTextMessage && m.extendedTextMessage.text) || (file && file.caption) || '').trim();

const sd = $getWorkflowStaticData('global');
sd.fmt = sd.fmt || {};
const now = Date.now();
for (const k of Object.keys(sd.fmt)) if (now - sd.fmt[k].ts > 30 * 60000) delete sd.fmt[k];

const hintOf = (t) => /ورقة/.test(t) ? 'ورقة عمل' : /(اختبار|امتحان)/.test(t) ? 'اختبار' : '';
const isCmd = /^تنسيق/.test(text);
// «تنسيق اختبار pdf»: يُرسل مع ملف Word نسخة PDF (ورقة العمل تُرسل PDF دائماً)
const wantPdf = (t) => /pdf|بي\s*دي\s*[إا]ف/i.test(t);
const instance = body.instance || 'ThirdPillar';
const base = { phone, instance, keys: item.keys, msgId: key.id || '', msgKey: key };

if (isCmd && !file) {
  sd.fmt[phone] = { ts: now, hint: hintOf(text), pdf: wantPdf(text) };
  return [{ json: Object.assign(base, { fmt: 'start' }) }];
}
// أي رسالة نصية أخرى (دوام، غياب، إلغاء…) تعني أن صاحبها انتقل إلى أمر آخر: يُلغى انتظار ملف التنسيق،
// فلا تؤخذ صورة كشف الدوام التالية على أنها اختبار. وكذلك ملف تعليقه «دوام»
if (!isCmd && text && (!file || /^دوام/.test(text))) {
  delete sd.fmt[phone];
  return pass();
}
if (file && (isCmd || sd.fmt[phone])) {
  const hint = isCmd ? hintOf(text) : sd.fmt[phone].hint || '', pdf = isCmd ? wantPdf(text) : !!sd.fmt[phone].pdf;
  delete sd.fmt[phone];
  return [{ json: Object.assign(base, { fmt: 'process', hint, pdf,
    fileName: (doc && doc.fileName) || '', mimetype: String(file.mimetype || '').split(';')[0],
    base64: (d.message && d.message.base64) || m.base64 || '' }) }];
}
return pass();
