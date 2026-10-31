# הפעלת Next Team (כ־15 דקות)

צריך שני חשבונות חינמיים: **Supabase** (מסד נתונים והתחברות) ו־**Cloudflare Pages** (האתר).

## 1. Supabase
1. ב־supabase.com: New project. שמרו את סיסמת מסד הנתונים.
2. Project Settings ← API: העתיקו את **Project URL** ואת **anon public key**.
3. העלאת הסכמה (בלי התקנות): בתפריט הצד ← **SQL Editor** ← New query. הדביקו את כל התוכן של הקובץ `supabase/all_migrations.sql` ולחצו **Run**. מצופה "Success. No rows returned". הקובץ יוצר את כל הטבלאות, ההרשאות, הרשימות ההתחלתיות והגדרת אחסון התמונות. מריצים פעם אחת בלבד, בפרויקט חדש.
   (חלופה למפתחים: `npx supabase link` ואחריו `npx supabase db push`.)
   **עדכון פרויקט קיים:** לא מריצים שוב את `all_migrations.sql`. מריצים ב־SQL Editor רק את הקבצים החדשים מתוך `supabase/migrations`, לפי הסדר. למשל: `0027_contacts.sql` (פרטי קשר ואנשי קשר לקבוצה), ואחריו `0028_second_parent_and_roster.sql` (הורה שני וטבלת שחקנים והורים).
4. התחברות (חינמית, בלי SMS): Google וקוד במייל.
   * **Google:** ב־Google Cloud Console ← APIs & Services ← Credentials ← Create Credentials ← OAuth client ID ← Web application. ב־Authorized redirect URIs הדביקו את ה־Callback URL שמופיע ב־Supabase ← Authentication ← Sign In / Providers ← Google. העתיקו את Client ID ו־Client Secret ל־Supabase, הפעילו את Google ושמרו.
   * **קוד במייל:** Email מופעל כברירת מחדל. ב־Authentication ← Emails ← Templates ← Magic Link הוסיפו לתבנית את `{{ .Token }}` כדי שהמייל יכלול גם קוד (הקישור במייל עובד גם בלעדיו).
   * **Apple:** לא נתמך בשלב זה. כניסה עם Apple מחייבת חשבון Apple Developer בתשלום (99$ לשנה). משתמשי אייפון נכנסים עם Google או עם קוד במייל.
   * **שליחת מיילים בחינם (חובה לפני השקה):** שירות המייל המובנה של Supabase מוגבל לכמה מיילים בשעה. מגדירים את Brevo (חינם, עד 300 מיילים ביום):
     1. נרשמים ב־brevo.com. ב־Senders, Domains & Dedicated IPs ← Domains מוסיפים את הדומיין של המועדון ומעתיקים אליו את רשומות ה־DNS שמופיעות (קוד Brevo, DKIM ו־DMARC), ואז מאמתים. שולחים מכתובת על הדומיין (למשל `no-reply@הדומיין`), ולא מכתובת Gmail, אחרת המיילים יגיעו לספאם.
     2. ב־Brevo ← SMTP & API ← SMTP: מעתיקים את שרת ה־SMTP (`smtp-relay.brevo.com`, פורט 587) ואת שם המשתמש, ויוצרים מפתח SMTP.
     3. ב־Supabase ← Authentication ← Emails ← SMTP Settings: מפעילים Custom SMTP ומזינים כתובת שולח, שם שולח (Next Team), השרת, הפורט, שם המשתמש והמפתח כסיסמה.
     4. ב־Authentication ← Emails ← Templates מוסיפים `{{ .Token }}` גם לתבנית Magic Link וגם לתבנית Confirm signup (משתמש חדש מקבל את השנייה).
     5. ב־Authentication ← Rate Limits מעלים את מגבלת המיילים לשעה.
5. Authentication ← URL Configuration: הכניסו את כתובת האתר (אחרי שלב 2) ב־Site URL וגם ב־Redirect URLs.

## 2. Cloudflare Pages
**דרך א (אוטומטית, דרך GitHub Actions):** ב־GitHub ← Settings ← Secrets and variables ← Actions ← Secrets, הוסיפו `CLOUDFLARE_API_TOKEN` (טוקן עם הרשאת Account ← Cloudflare Pages ← Edit) ו־`CLOUDFLARE_ACCOUNT_ID`. כל דחיפה ל־`main` מעלה את האתר לפרויקט `next-team`; כתובת הפרויקט ומפתח ה־anon כתובים ב־`.github/workflows/deploy.yml`.

**דרך ב (חיבור Git ב־Cloudflare):**
1. Workers & Pages ← Create ← Pages ← Connect to Git ← הריפו `adi808/Next-Team`, ענף `main`.
2. Build command: `npm run build`. Build output directory: `dist`.
3. Environment variables:
   * `VITE_SUPABASE_URL` = ה־Project URL
   * `VITE_SUPABASE_ANON_KEY` = ה־anon key
   * `NODE_VERSION` = `20`
4. Save and Deploy. תקבלו כתובת כמו `https://next-team.pages.dev`. זה קישור ההפעלה (אפשר להתקין אותו בטלפון כאפליקציה).

## 3. מנהל מערכת ראשון
1. היכנסו לאתר עם Google או עם קוד במייל. זה יוצר את הפרופיל.
2. ב־Supabase ← SQL Editor:
   ```sql
   update profiles set is_system_admin = true where email = 'you@example.com';
   ```
3. רעננו את האתר: מופיע מצב "מנהל מערכת". צרו מועדון (עם המייל של מנהל המועדון), והמשיכו משם.

## 4. לשונית ליגה (Edge Function)
לשונית "ליגה" של הקבוצה קוראת את אתר ההתאחדות דרך ה־Edge Function בשם `league` (הדפדפן לא יכול לקרוא את האתר ישירות).
פורסים אותה פעם אחת, ושוב אחרי כל שינוי בה: `npx supabase functions deploy league --project-ref <project-ref>`
(בדיקת ה־JWT נשארת פעילה: רק משתמשים מחוברים יכולים לקרוא לה, והיא קוראת רק כתובות של football.org.il).
אחר כך המאמן מדביק בלשונית הליגה (או בהגדרות הקבוצה) את כתובת דף הקבוצה, למשל `https://www.football.org.il/team-details/?team_id=8776&season_id=28`.

## מיילים לאישור בקשות הצטרפות (Brevo, חינמי)
1. ב־brevo.com: הרשמה, ואז Senders, Domains & Dedicated IPs ← Senders: אמתו את כתובת השולח.
2. SMTP & API ← API Keys: צרו מפתח.
3. ב־Supabase ← Edge Functions ← Secrets הוסיפו: `BREVO_API_KEY` (המפתח), `MAIL_FROM` (כתובת השולח המאומתת), `APP_URL` (כתובת האתר, למשל `https://next-team.pages.dev`).
4. פעם אחת, ב־SQL Editor: `select vault.create_secret('https://<project>.supabase.co/functions/v1/send-email', 'email_hook_url');`
בלי המפתח הבקשות עדיין מגיעות בהתראה באפליקציה וב־Push.
