// محوِّل Word ← PDF صغير يعمل على خادم n8n نفسه (بلا Docker)، يستعمله وركفلو تنسيق الاختبارات.
// يستمع على 127.0.0.1 فقط (لا يُفتح للإنترنت)، ويحوّل بـ LibreOffice:
//   POST /convert   {"docx":"<base64>"}   →   {"pdf":"<base64>","pages":2}
//   GET  /health                          →   {"ok":true,"soffice":"LibreOffice 7.x"}
// التركيب (مرة واحدة، بصلاحية root على الخادم) في n8n/pdf/README.md
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const PORT = +process.env.PDF_PORT || 3920;
const SOFFICE = process.env.SOFFICE || 'soffice';
const PROFILE = path.join(os.tmpdir(), 'tpa-lo-profile');
let chain = Promise.resolve();   // تحويل واحد في كل مرة: LibreOffice لا يعمل بنسختين على الملف الشخصي نفسه

function run(args, ms) {
  return new Promise((resolve, reject) => {
    cp.execFile(SOFFICE, args, { timeout: ms, env: Object.assign({}, process.env, { HOME: PROFILE }) }, (err, out, errOut) => err ? reject(new Error(String(errOut || err.message).slice(0, 300))) : resolve(String(out)));
  });
}
async function convert(docx) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpa-pdf-'));
  try {
    fs.writeFileSync(path.join(dir, 'in.docx'), docx);
    await run(['-env:UserInstallation=file://' + PROFILE, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, path.join(dir, 'in.docx')], 90000);
    const pdf = fs.readFileSync(path.join(dir, 'in.pdf'));
    const n = (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
    return { pdf: pdf.toString('base64'), pages: n || null };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET' && req.url === '/health') {
    return run(['--version'], 15000).then((v) => send(200, { ok: true, soffice: v.trim() }), (e) => send(500, { ok: false, error: e.message }));
  }
  if (req.method !== 'POST' || req.url !== '/convert') return send(404, { error: 'not found' });
  const parts = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > 20e6) req.destroy(); else parts.push(c); });
  req.on('end', () => {
    let docx;
    try { docx = Buffer.from(JSON.parse(Buffer.concat(parts).toString('utf8')).docx, 'base64'); } catch (e) { return send(400, { error: 'bad request' }); }
    if (docx.length < 100 || docx[0] !== 0x50 || docx[1] !== 0x4b) return send(400, { error: 'not a docx' });
    chain = chain.then(() => convert(docx)).then((r) => send(200, r), (e) => send(500, { error: e.message }));
  });
}).listen(PORT, '127.0.0.1', () => console.log('docx->pdf on 127.0.0.1:' + PORT));
