# הפעלת Next Team (כ־15 דקות)

צריך שני חשבונות חינמיים: **Supabase** (מסד נתונים והתחברות) ו־**Cloudflare Pages** (האתר).

## 1. Supabase
1. ב־supabase.com: New project. שמרו את סיסמת מסד הנתונים.
2. Project Settings ← API: העתיקו את **Project URL** ואת **anon public key**.
3. העלאת הסכמה (בלי התקנות): בתפריט הצד ← **SQL Editor** ← New query. הדביקו את כל התוכן של הקובץ `supabase/all_migrations.sql` ולחצו **Run**. מצופה "Success. No rows returned". הקובץ יוצר את כל הטבלאות, ההרשאות, הרשימות ההתחלתיות והגדרת אחסון התמונות. מריצים פעם אחת בלבד, בפרויקט חדש.
   (חלופה למפתחים: `npx supabase link` ואחריו `npx supabase db push`.)
4. התחברות בטלפון: Authentication ← Providers ← Phone ← Enable.
   * **לבדיקה ראשונה בלי SMS:** באותו מסך, "Test Phone Numbers and OTPs": הוסיפו מספר וקוד, למשל `972500000000=123456`.
   * **לשימוש אמיתי:** חברו ספק SMS (Twilio וכד') באותו מסך.
5. Authentication ← URL Configuration: הכניסו את כתובת האתר (אחרי שלב 2) ב־Site URL.

## 2. Cloudflare Pages
1. Workers & Pages ← Create ← Pages ← Connect to Git ← הריפו `adi808/Next-Team`, ענף `main`.
2. Build command: `npm run build`. Build output directory: `dist`.
3. Environment variables:
   * `VITE_SUPABASE_URL` = ה־Project URL
   * `VITE_SUPABASE_ANON_KEY` = ה־anon key
   * `NODE_VERSION` = `20`
4. Save and Deploy. תקבלו כתובת כמו `https://next-team.pages.dev`. זה קישור ההפעלה (אפשר להתקין אותו בטלפון כאפליקציה).

## 3. מנהל מערכת ראשון
1. היכנסו לאתר עם המספר שלכם (מספר הבדיקה או מספר אמיתי). זה יוצר את הפרופיל.
2. ב־Supabase ← SQL Editor:
   ```sql
   update profiles set is_system_admin = true where phone = '+972500000000';
   ```
3. רעננו את האתר: מופיע מצב "מנהל מערכת". צרו מועדון (עם טלפון של מנהל המועדון), והמשיכו משם.
