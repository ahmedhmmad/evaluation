# واجهة تطبيق الموبايل (API) — أكاديمية الركيزة الثالثة

التطبيق يتصل بقاعدة البيانات نفسها التي يعمل عليها الموقع (Supabase)، بالحسابات والصلاحيات نفسها.
كل العمليات **دوال** في القاعدة تُستدعى بـ `rpc`، تعيد JSON، وتتحقق كل دالة بنفسها من صلاحية صاحب الحساب.
منطق الحساب فيها هو منطق الموقع نفسه، فتتطابق الأرقام بين الموقع والتطبيق.

> قبل الاستعمال: يُشغَّل الملف `supabase/api.sql` مرة في محرر SQL في Supabase (بعد ملفات SQL السابقة كلها، ومنها `substitutes.sql` و`parent_links.sql`).

---

## 1. الإعداد في Flutter

```yaml
# pubspec.yaml
dependencies:
  supabase_flutter: ^2.5.0
```

```dart
import 'package:supabase_flutter/supabase_flutter.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Supabase.initialize(
    url: 'https://wvklhyjtzqomiyhzsfuf.supabase.co',
    anonKey: '<المفتاح العام نفسه الموجود في config.js>', // المفتاح العام (publishable) فقط، لا المفتاح السري أبدًا
  );
  runApp(const App());
}

final sb = Supabase.instance.client;
```

## 2. الدخول

اسم المستخدم في الموقع يُحوَّل إلى بريد داخلي: إن لم يحتوِ على `@` يُضاف إليه `@ahmedhmmad.github.io`.

```dart
String toEmail(String login) {
  final l = login.trim().toLowerCase();
  return l.contains('@') ? l : '$l@ahmedhmmad.github.io';
}

Future<Map<String, dynamic>> signIn(String login, String password) async {
  await sb.auth.signInWithPassword(email: toEmail(login), password: password);
  // الدور واسم صاحب الحساب
  return await sb.from('profiles').select('role, full_name, teacher_id, must_change_password')
      .eq('id', sb.auth.currentUser!.id).single();
}
```

- **الأدوار:** `superadmin` (المدير العام)، `manager` (المدير)، `supervisor` (المشرف التربوي)، `teacher` (المعلم)، `registrar` (المسجّل)، `pending` (بانتظار التفعيل، لا يرى شيئًا).
- **كلمة مرور مؤقتة:** إن كان `must_change_password = true` يُطلب من المستخدم كلمة مرور جديدة، ثم:

```dart
await sb.auth.updateUser(UserAttributes(password: newPassword));
await sb.rpc('finish_password_change');
```

## 3. الاستدعاء والأخطاء

```dart
try {
  final data = await sb.rpc('api_dashboard');           // بلا وسائط
  final late = await sb.rpc('api_late_payers', params: {'p_month': '2026-10'});
} on PostgrestException catch (e) {
  showError(e.message); // رسائل الخطأ بالعربية، مثل: «ليس لديك صلاحية لهذه العملية»
}
```

- التواريخ بصيغة `YYYY-MM-DD`، والأشهر بصيغة `YYYY-MM`.
- «اليوم» هو تاريخ مصر (Africa/Cairo).
- المبالغ بالجنيه المصري.
- `method` وسيلة الدفع: `cash` نقدًا، `instapay` إنستاباي، `vodafone` فودافون كاش، `other` أخرى.

---

## 4. المدير العام والمدير

### `api_dashboard()` — لوحة المؤشرات
**الصلاحية:** المدير العام، المدير، المشرف (المشرف يأخذ `attendance` فقط).

```json
{
  "day": "2026-10-19",
  "attendance": { "school_day": true, "weekday": "الاثنين", "taken": 240, "absent": 12, "classes_missing": 2 },
  "collected_today": { "total": 3500, "cash": 3200, "count": 9 },
  "collected_month": { "total": 41200, "cash": 30100, "count": 98 },
  "late": { "count": 14, "owed": 8400, "suspended": 1, "deadline": "2026-10-05" },
  "new_students": { "month": 6, "week": 2, "pending": 4 },
  "classes": { "full": ["الأول أ"], "over": [] }
}
```

- `school_day = false`: اليوم ليس من أيام الدراسة في الجدول.
- `late.owed`: المتبقي على المتأخرين فقط، كما في رئيسية الموقع.

### `api_late_payers(p_month)` — المتأخرون في المواصلات
**الصلاحية:** المدير العام، المدير. `p_month` اختياري (الافتراضي الشهر الحالي).

```json
{
  "month": "2026-10", "deadline": "2026-10-05", "days_late": 14,
  "counts": { "late": 14, "extended": 2, "suspended": 1, "grace": 0 },
  "owed": 9900,
  "students": [
    { "student_id": "…", "name": "…", "class_name": "الأول أ", "bus": "دوار المحافظة", "guardian": "…",
      "phone": "010…", "whatsapp": "…", "share": 700, "paid": 300, "left": 400, "state": "late", "grace_until": null }
  ]
}
```

- **قيم `state`:** `late` متأخر، `extended` مهلة إضافية، `suspended` موقوف عن الركوب، `grace` ضمن المهلة.
- **`owed`:** مجموع المتبقي على الجميع عدا من هم ضمن المهلة، كما في شاشة «المتأخرون» في الموقع.

### `api_ledger(p_from, p_to)` — سجل الدفعات
**الصلاحية:** المدير العام، المدير.

```json
{
  "from": "2026-10-01", "to": "2026-10-19", "total": 41200, "count": 98,
  "by_method": { "cash": 30100, "instapay": 11100 },
  "by_day": [ { "day": "2026-10-19", "count": 9, "total": 3500, "cash": 3200 } ],
  "receipts": [
    { "receipt_no": 161, "kind": "main", "student_id": "…", "student": "…", "class_name": "…", "bus": "…",
      "month": "2026-10", "amount": 300, "method": "cash", "ref": "", "issued_by": "…", "paid_on": "2026-10-18", "issued_at": "…" }
  ]
}
```

- كل إيصال يظهر بتاريخ سداده.
- `kind`:
  - `main`: الإيصال الأول، بمبلغه الأول.
  - `topup`: إيصال الدفعة المكمِّلة.
- لا يُحسب أي مبلغ مرتين.

### `api_students(p_q, p_class, p_status, p_limit, p_offset)` — بحث في الطلاب
**الصلاحية:** المدير العام، المدير. كل الوسائط اختيارية.

| الوسيط | المعنى |
|---|---|
| `p_q` | جزء من الاسم أو اسم ولي الأمر، أو 3 أرقام فأكثر من الهوية أو الهاتف |
| `p_class` | اسم الشعبة |
| `p_status` | `final` نهائي، `reserve` احتياط، `pending` مبدئي |
| `p_limit` / `p_offset` | للصفحات (الافتراضي 50، والأقصى 500) |

```json
{ "total": 11, "students": [ { "id": "…", "full_name": "…", "class_name": "…", "status": "final", "guardian_name": "…", "phone": "…", "whatsapp": "…", "bus": "…" } ] }
```

### `api_student_file(p_id)` — ملف الطالب
**الصلاحية:** المدير العام، المدير.

```json
{
  "student": { "id": "…", "full_name": "…", "class_name": "…", "details": { } },
  "attendance": { "since": "2026-09-01", "recorded_days": 30, "absences": [ { "day": "2026-10-19", "note": "" } ] },
  "transport": { "bus": "…", "pickup": "…", "left_from": null, "exempt_from": null, "exempt_to": null, "suspended_month": null, "grace_until": null,
                 "this_month": { "share": 700, "paid": 700, "left_amount": 0, "exempt": false, "status": "paid", "state": "ok", "family_rank": 1, "family_size": 2 } },
  "receipts": [ { "receipt_no": 161, "kind": "main", "month": "2026-10", "amount": 300, "method": "cash", "paid_on": "2026-10-18" } ]
}
```

- `transport` يكون `null` إن لم يكن الطالب مشتركًا في المواصلات.
- `family_rank`: ترتيبه بين إخوته المشتركين. الأول بمبلغ، ومن بعده بمبلغ أقل.

### `api_attendance_day(p_day)` — الغياب في يوم
**الصلاحية:** المدير العام، المدير، المشرف. `p_day` اختياري (الافتراضي اليوم).

```json
{ "day": "2026-10-19", "students": 240, "absent": 12,
  "classes": [ { "class_name": "الأول أ", "students": 28, "recorded": true, "recorded_by": "…",
                 "absent": [ { "student_id": "…", "name": "…", "note": "" } ] } ] }
```

---

## 5. المشرف والمعلمون

### `api_timetable(p_teacher, p_class)` — جدول معلم أو شعبة
**الصلاحية:** المدير العام، المدير، المشرف، المعلم.
- **المعلم:**
  - بلا وسائط يأخذ جدوله هو.
  - يمكنه عرض جدول أي شعبة بـ `p_class`.
  - لا يرى جدول معلم آخر.
- **غيره:** يحدّد `p_teacher` (معرّف المعلم) أو `p_class`.

```json
{ "days": ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"],
  "lessons": [ { "day": 1, "day_name": "الاثنين", "period": 1, "time": { "from": "8:00", "to": "8:40" },
                 "class_name": "الأول أ", "subject": "رياضيات", "teacher_id": "…", "teacher": "…" } ] }
```

- `day`: ترتيب اليوم في `days` (يبدأ من 0).
- `time` من «مواعيد الدوام» لمرحلة الشعبة، وقد يكون `null` إن لم تُضبط المواعيد.
- تُعرض الفترة الزمنية من اليمين: البداية ثم النهاية.

### `api_my_substitutes(p_from, p_days)` — حصص الاحتياط المطلوبة مني
**الصلاحية:** المعلم (والمشرف والمدير العام إن كان حسابهم مرتبطًا بمعلم). الافتراضي من اليوم لسبعة أيام.

```json
[ { "day": "2026-10-19", "period": 3, "time": { "from": "9:50", "to": "10:30" }, "class_name": "الأول أ", "subject": "رياضيات", "absent_teacher": "…" } ]
```

### `api_subs_day(p_day)` — الاحتياط في يوم
**الصلاحية:** المدير العام، المدير، المشرف.

```json
{ "day": "2026-10-19", "school_day": true,
  "absences": [ { "id": "…", "teacher_id": "…", "teacher": "…", "periods": null, "reason": "إجازة" } ],
  "lessons": [ { "period": 1, "time": { "from": "8:00", "to": "8:40" }, "class_name": "الأول أ", "subject": "رياضيات",
                 "absent_teacher_id": "…", "absent_teacher": "…", "substitute_id": null, "substitute": null,
                 "candidates": [ { "teacher_id": "…", "name": "…", "on_site": true, "quran": false, "today_count": 0, "month_count": 2,
                                   "teaches_class": true, "same_subject": false, "load": 4 } ] } ] }
```

- **`periods`:** قيمته `null` إن كان الغياب لليوم كله، وإلا فهي أرقام الحصص التي يغيبها.
- **`candidates`:** أفضل 5 بدلاء بترتيب الموقع نفسه:
  1. المتاح في تلك الحصة فقط.
  2. ثم من هو في المدرسة ذلك اليوم.
  3. ثم غير محفّظي القرآن.
  4. ثم الأقل احتياطًا اليوم، ثم في الشهر.
  5. ثم من يدرّس الشعبة، ثم من يدرّس المادة نفسها.
  6. ثم الأخف يومًا.

### `api_teacher_absence(p_day, p_teacher, p_periods, p_reason, p_remove)` — تسجيل غياب معلم
**الصلاحية:** المدير العام، المشرف. تعيد نتيجة `api_subs_day` لذلك اليوم.
- `p_periods`: اتركه فارغًا لليوم كله، أو مرّر أرقام الحصص مثل `[2, 3]`.
- `p_remove: true` يلغي الغياب، ويحذف ما وُزّع عنه من احتياط.

### `api_assign_substitute(p_day, p_class, p_period, p_teacher)` — تعيين بديل
**الصلاحية:** المدير العام، المشرف. `p_teacher: null` يلغي التعيين.
تُرفض العملية إن لم يكن المعلم متاحًا في تلك الحصة (عنده حصة، أو غائب، أو يغطي حصة أخرى). تعيد نتيجة `api_subs_day`.

### تسجيل الغياب من حساب المعلم
**الصلاحية:** المعلم (والمدير العام). القيود نفسها التي في رابط الغياب: ليوم اليوم فقط، وأسماء الطلاب فقط، ويُكتب اسم المعلم في السجل.

| الدالة | ما تعيده |
|---|---|
| `api_att_classes()` | `{ teacher, day, classes: [ { name, students, recorded } ] }` |
| `api_att_roll(p_class)` | `{ day, recorded, students: [ { id, name, absent } ] }` |
| `api_att_submit(p_class, p_absent)` | `{ saved, absent: [أسماء الغائبين] }`؛ `p_absent` قائمة معرّفات الغائبين (فارغة: حضر الجميع) |

```dart
final roll = await sb.rpc('api_att_roll', params: {'p_class': 'الأول أ'});
await sb.rpc('api_att_submit', params: {'p_class': 'الأول أ', 'p_absent': absentIds});
```

---

## 6. أولياء الأمور (بلا حساب)

ولي الأمر يُعرف برابطه السري الذي يرسله المدير العام من «روابط أولياء الأمور»:
`https://ahmedhmmad.github.io/evaluation/parent.html?t=<الرمز>`

يستخرج التطبيق الرمز (`t`) مرة واحدة: بفتح الرابط في التطبيق (deep link) أو بلصقه. ثم يحفظه في تخزين آمن على الجهاز، مثل `flutter_secure_storage`.

### `api_parent_view(p_token)`
**الصلاحية:** أي أحد معه رمز صالح (بلا تسجيل دخول).

```json
{ "school": "أكاديمية الركيزة الثالثة", "since": "2026-09-01", "days": ["الأحد", "…"], "bells": { "stages": [ ] },
  "children": [ { "name": "…", "class_name": "…", "bus": "…", "recorded_days": 30, "absences": ["2026-10-19"],
                  "months": [ { "month": "2026-10", "paid": 600, "due": 600, "receipts": [ { "no": 161, "amount": 300, "on": "2026-10-18" } ] } ],
                  "timetable": [ { "day": 1, "period": 1, "subject": "قرآن", "teacher": "…" } ] } ] }
```

إن كان الرابط غير صالح أو موقوفًا تعيد `{ "error": "…" }`، فيُطلب من ولي الأمر التواصل مع الأكاديمية.

### `api_register_device(p_token, p_device, p_platform)` / `api_unregister_device(p_device)`
تسجيل جهاز ولي الأمر (معرّف الإشعارات من Firebase، و`p_platform` قيمته `android` أو `ios`)، تمهيدًا لإشعارات الغياب.
**ملاحظة:** إرسال الإشعارات نفسه غير مُعدّ بعد؛ يحتاج حساب Firebase وخطوة إرسال (n8n مثلًا) تُضاف لاحقًا.

---

## 7. ملاحظات للمطوّر

- **لا يوضع المفتاح السري (service_role) في التطبيق أبدًا.** المفتاح العام وحده يكفي، والصلاحيات تفرضها القاعدة.
- يمكن أيضًا قراءة الجداول مباشرة (`sb.from('students').select()`) بالصلاحيات نفسها. لكن الأرقام المحسوبة يجب أن تؤخذ من دوال `api_` لا أن يُعاد حسابها في التطبيق:
  - المطلوب من الطالب.
  - المتأخرون.
  - الحصيلة.
  - البدلاء.
- العمليات التي تكتب ليست في هذه الواجهة بعد، وتبقى من الموقع. منها:
  - إصدار الإيصالات.
  - تسجيل الطلاب.
  - تعديل الجدول.

  تُضاف إلى الواجهة عند الحاجة، بالأسلوب نفسه.
