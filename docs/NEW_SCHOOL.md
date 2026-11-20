# تشغيل النظام لمدرسة جديدة بقاعدة بيانات مستقلة (Supabase)

كل مدرسة لها مشروع Supabase خاص بها (حساب جديد أو مشروع جديد في الحساب نفسه)، ونسخة من الموقع على GitHub Pages.
كل صفحات الموقع (`index.html` و`parent.html` و`absence.html` و`bells.html` و`cv.html` و`verify.html`) تقرأ عنوان القاعدة
من `config.js` فقط، فربط القاعدة الجديدة يكون بتعديل هذا الملف.

## 1. إنشاء القاعدة

1. أنشئ حسابًا في supabase.com، ثم **New project**: اسم المشروع، وكلمة مرور قوية للقاعدة (احفظها)، والمنطقة الأقرب (مثل Frankfurt).
2. افتح **SQL Editor → New query**، والصق محتوى الملف `supabase/install.sql` كاملًا، ثم **Run**.
   - الملف يحوي كل ملفات `supabase/*.sql` بالترتيب الصحيح، وتشغيله مرة ثانية آمن.
   - لا تشغّل الملفات المنفردة بترتيب آخر على قاعدة جديدة: بعضها يضيف صلاحيات لجداول ملفات أخرى فقط إن وُجدت،
     وبعض الدوال معرَّفة في أكثر من ملف.

## 2. إعدادات الدخول في Supabase

في **Authentication → URL Configuration**:
- **Site URL**: رابط موقع المدرسة، مثل `https://USER.github.io/REPO/`
- **Redirect URLs**: الرابط نفسه.

بدون ذلك يوجّه رابط تأكيد البريد بعد التسجيل إلى `localhost`.

## 3. نسخة الموقع

1. أنشئ مستودعًا جديدًا على GitHub وانسخ إليه ملفات هذا المستودع، ثم فعّل **Settings → Pages → Deploy from a branch → main / (root)**.
2. من **Supabase → Project Settings → API** انسخ **Project URL** والمفتاح العام **anon / publishable**، وضعهما في `config.js`:

```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://PROJECT-REF.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_...'
};
```

> المفتاح العام فقط. لا تضع المفتاح السري (service_role / secret) في الموقع أبدًا.

3. استبدل الصور بصور المدرسة بالأسماء نفسها: `logo.png` (الشعار)، `banner.jpg` (ترويسة التقارير)، `banner-payroll.png`،
   `paper-header.png` و`paper-footer.png` و`paper-wm.png` (أوراق الامتحانات والأوراق الرسمية).
4. اسم المدرسة مكتوب في الكود ويُغيَّر يدويًا:
   - `index.html`: `<title>` و`brand-name` والاسم الإنجليزي بجانبه.
   - `js/print.js`: ثابت `REPORT` (`nameAr` و`nameEn`).
   - `bells.html`: العنوان.
   - الاسم الاحتياطي في `supabase/parent_links.sql` و`supabase/auto_backup.sql` و`supabase/staff_cv.sql`
     (يُستعمل فقط إن كان اسم المدرسة في الإعدادات فارغًا).

## 4. أول مدير عام

1. افتح موقع المدرسة وأنشئ حسابًا ببريدك.
2. في **SQL Editor** شغّل (ببريدك):

```sql
update public.profiles set role = 'superadmin' where email = 'you@example.com';
```

3. ادخل من جديد، ثم من الإعدادات: اسم المدرسة، العام الدراسي، سطر المرحلة، بيانات التذييل، اسم المدير، مواعيد الدوام.
4. استورد الطلاب (شاشة الطلاب → استيراد Excel، على نموذج `registration-template.xlsx`) ثم العاملين (استيراد من Excel / CSV)،
   ثم أنشئ حسابات المستخدمين وأسند الصلاحيات.

## 5. الإضافات الاختيارية (دوال Supabase وأسرارها)

تُنشر الدوال من `supabase/functions/` بالأمر `supabase functions deploy NAME --project-ref PROJECT-REF`،
وتوضع أسرارها في **Supabase → Edge Functions → Secrets**.

| الميزة | الدالة | الأسرار |
|---|---|---|
| قراءة استمارات التسجيل الممسوحة | `read-registration-form` | `DEEPINFRA_API_KEY` |
| قراءة كشوف دوام الموظفين المصوّرة | `read-staff-sheet` | `DEEPINFRA_API_KEY` |
| قراءة السير الذاتية والشهادات | `read-staff-cv` | `DEEPINFRA_API_KEY` و`DEEPINFRA_MODEL` (اختياري) |
| ملفات العاملين (Cloudflare R2) | `staff-files` | `R2_ACCOUNT_ID` و`R2_ACCESS_KEY_ID` و`R2_SECRET_ACCESS_KEY` و`R2_BUCKET` |
| رسائل الواتساب وإشعارات الغياب (SendWhats) | `send-whatsapp` و`send-absence-whatsapp` | `SENDWHATS_API_KEY` و`SENDWHATS_API_URL` |
| نقاط تجمع المواصلات | `cluster-addresses` | `ANTHROPIC_API_KEY` |

- النشر التلقائي: في `.github/workflows/deploy-functions.yml` غيّر `PROJECT_REF` إلى رقم المشروع الجديد، وأضف في المستودع الجديد
  الأسرار `SUPABASE_ACCESS_TOKEN` و`DEEPINFRA_API_KEY` (هذا الملف ينشر دالتي القراءة الأوليين فقط).
- n8n (بوت الغياب، رسالة الصباح، النسخ الاحتياطي): في `n8n/src` و`n8n/*.json` غيّر رابط Supabase ورابط الموقع وخادم Evolution
  ورقم الواتساب وحساب Google Drive، ثم أعد بناء `n8n/absence-bot.json` بالأمر `node n8n/src/build.js`.

## عند إضافة ملف SQL جديد للمشروع

أضف اسمه إلى `FIRST` في `tools/build-install.js` بعد الملفات التي يحتاجها (وإلى `LAST` أيضًا إن كان يلمس جداول ملفات أخرى
فقط إن وُجدت)، ثم شغّل `node tools/build-install.js` لإعادة توليد `supabase/install.sql`. الفحص `node tools/check.js` ينبّه إن نُسي ذلك.
ولتحديث قاعدة مدرسة قائمة يكفي تشغيل الملف الجديد أو المعدَّل وحده في محرر SQL لتلك المدرسة.
