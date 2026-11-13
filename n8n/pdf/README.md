# محوِّل Word ← PDF لوركفلو التنسيق

يعمل على خادم n8n نفسه (CloudPanel، بلا Docker). الوركفلو يطلبه على `http://127.0.0.1:3920`، وإن لم يكن يعمل يرسل البوت ملف Word فقط كما كان.

## التركيب (مرة واحدة، بحساب root عبر SSH)

1. LibreOffice والخطوط (Times New Roman للقالب، وخطوط الرموز ✔ ✖):

```bash
apt update && apt install -y libreoffice-writer-nogui ttf-mscorefonts-installer fonts-liberation fonts-dejavu fonts-noto-core && fc-cache -f
```

2. ملف المحوِّل: انسخ `server.js` من هذا المجلد إلى الخادم:

```bash
mkdir -p /opt/tpa-pdf && nano /opt/tpa-pdf/server.js
```

3. تشغيله كخدمة تبدأ مع الخادم (غيّر مسار node إن اختلف: `which node`):

```bash
cat > /etc/systemd/system/tpa-pdf.service <<'EOF'
[Unit]
Description=TPA docx to pdf
After=network.target
[Service]
ExecStart=/usr/bin/node /opt/tpa-pdf/server.js
Restart=always
User=nobody
Group=nogroup
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now tpa-pdf
```

4. التحقق (يجب أن يظهر `"ok":true` واسم LibreOffice):

```bash
curl -s http://127.0.0.1:3920/health
```

بعدها أعد استيراد `n8n/absence-bot.json` في n8n.

## ملاحظات
- المنفذ 3920 يستمع على 127.0.0.1 فقط، فلا يحتاج فتحاً في الجدار الناري ولا يصل إليه أحد من الخارج.
- لتغيير العنوان أو إيقاف PDF: الثابتان `PDF_URL` و`PDF_AUTO` في أول عقدة «تنسيق الملف بقالب الأكاديمية».
- إن كان n8n يعمل بمستخدم لا يجد node في `/usr/bin/node` فاستعمل المسار الذي يطبعه `which node`.
