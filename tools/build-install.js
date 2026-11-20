// يبني supabase/install.sql: كل ملفات supabase/*.sql في ملف واحد بالترتيب الذي يُثبَّت به على مشروع Supabase جديد.
//   node tools/build-install.js            (بعد إضافة ملف sql أو تعديله، ثم ارفع install.sql معه)
//   node tools/build-install.js OUT.sql    (يكتب إلى ملف آخر؛ يستعمله tools/check.js ليتأكد أن install.sql محدَّث)
//
// لماذا هذا الترتيب:
// - schema.sql أولًا (profiles والأدوار و my_role)، ثم audit_log.sql لتُركّب الملفات التالية مشغّلات السجل على جداولها.
// - كل ملف بعد الملفات التي يحتاجها.
// - الملفات التي تضيف صلاحيات أو مشغّلات لجداول ملفات أخرى «إن وُجدت» (to_regclass / information_schema) تُعاد في
//   المجموعة الأخيرة بعد اكتمال الجداول، و audit_log.sql و outside_accounts.sql آخرها لأنهما يمرّان على كل الجداول.
// - بعض الدوال معرَّفة في أكثر من ملف (نسخة محصَّنة)، فالترتيب يحدد أي نسخة تبقى.
// جُرِّب على Postgres فارغ (مع محاكاة auth في Supabase): تشغيل الملف مرة واحدة يعطي الجداول والأعمدة والصلاحيات والمشغّلات
// والدوال نفسها التي يعطيها تشغيل كل الملفات مرارًا حتى لا يتغير شيء، وتشغيله مرة ثانية لا يغيّر شيئًا.
// ملف جديد: يوضع في FIRST بعد الملفات التي يحتاجها؛ وإن كان يلمس جداول ملفات أخرى فقط إن وُجدت، يُضاف إلى LAST أيضًا.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'supabase');

const FIRST = [
  'schema', 'audit_log', 'attendance_clerk', 'auto_backup', 'custody', 'general_supervisor', 'manager', 'orders',
  'outside_accounts', 'parent_links', 'payment_claims', 'payroll', 'principal_gender', 'report_settings',
  'school_contact', 'signatures', 'staff', 'staff_attendance', 'staff_files', 'staff_perms', 'staff_profiles',
  'staff_self', 'staff_shifts', 'staff_warnings', 'student_lists', 'students', 'substitutes', 'supervisor_name',
  'teacher_accounts', 'teacher_papers', 'teacher_self', 'timetable', 'timetable_plan', 'transport',
  'transport_buses', 'transport_cycles', 'transport_discount', 'transport_issuer', 'transport_refunds',
  'transport_staff', 'transport_topups', 'transport_unsubscribe', 'visits', 'whatsapp_messages', 'api', 'attendance',
  'attendance_supervisor', 'committees', 'discipline', 'parent_accounts', 'protect_payments', 'receipt_archive',
  'receipts_due', 'receipts_lock', 'registrar', 'registrar_transport', 'staff_cv', 'student_exits', 'student_leaves',
  'student_registration', 'student_suspensions', 'teacher_grades', 'visit_approval', 'attendance_links',
  'paper_files', 'reserve_and_exempt', 'staff_bot', 'student_dropout', 'setup_wizard'
];
const LAST = [
  'attendance_clerk', 'auto_backup', 'manager', 'payroll', 'registrar', 'registrar_transport', 'staff_self',
  'student_leaves', 'teacher_accounts', 'teacher_papers', 'transport_staff', 'api', 'audit_log', 'outside_accounts'
];

const order = FIRST.concat(LAST).map((n) => n + '.sql');
const onDisk = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql') && f !== 'install.sql');
const missing = onDisk.filter((f) => !order.includes(f)), gone = order.filter((f) => !onDisk.includes(f));
if (missing.length || gone.length) {
  console.error((missing.length ? 'ملفات sql غير مذكورة في tools/build-install.js: ' + missing.join('، ') + '\n' : '') +
    (gone.length ? 'مذكورة في tools/build-install.js وغير موجودة: ' + gone.join('، ') : ''));
  process.exit(1);
}

let out = '-- ملف التثبيت الكامل لقاعدة بيانات مدرسة جديدة على Supabase (انظر docs/NEW_SCHOOL.md).\n' +
  '-- يُشغَّل مرة واحدة في مشروع Supabase جديد: SQL Editor -> New query -> الصق الملف كله -> Run.\n' +
  '-- لا تعدّله باليد: يُولَّد من ملفات supabase/*.sql بالأمر  node tools/build-install.js\n' +
  '-- تشغيله مرة ثانية على المشروع نفسه آمن ولا يغيّر شيئًا.\n';
for (const f of order) {
  out += '\n\n-- ================================================================\n-- ' + f +
    '\n-- ================================================================\n' + fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n') + '\n';
}
const target = process.argv[2] || path.join(DIR, 'install.sql');
fs.writeFileSync(target, out);
if (!process.argv[2]) console.log('supabase/install.sql: ' + order.length + ' ملف، ' + Buffer.byteLength(out) + ' بايت');
