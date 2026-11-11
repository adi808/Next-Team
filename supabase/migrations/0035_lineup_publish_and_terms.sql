-- Next Team: (1) the coach publishes an approved lineup to the team's parents and players;
-- (2) terms of use that every user accepts (again whenever a new version is published).

-- ---------------------------------------------------------------- lineup publishing
-- Published only while approved: saving a change deletes the state row, so the lineup is a draft (and hidden) again.
alter table event_lineup_state add column published_at timestamptz;

create policy event_lineup_state_select_published on event_lineup_state for select
  using (published_at is not null and is_team_member(event_team(event_id)));
create policy event_lineups_select_published on event_lineups for select
  using (is_team_member(event_team(event_id))
         and exists (select 1 from event_lineup_state s where s.event_id = event_lineups.event_id and s.published_at is not null));

-- Publishes the approved lineup and tells the team (push, else email).
create function publish_event_lineup(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_team uuid := event_team(p_event);
begin
  if v_team is null or not can_manage_team(v_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from event_lineup_state where event_id = p_event) then
    raise exception 'approve the lineup first' using errcode = '22023';
  end if;
  update event_lineup_state set published_at = now() where event_id = p_event;
  perform notify_team_event(p_event, '📋 ההרכב פורסם: ' || event_label(p_event), 'ההרכב למשחק מחכה לכם בדף המשחק.', v_uid);
end $$;

revoke execute on function publish_event_lineup(uuid) from public, anon;
grant execute on function publish_event_lineup(uuid) to authenticated;

-- ---------------------------------------------------------------- terms of use
create table app_terms (
  version int primary key,
  body text not null check (length(btrim(body)) > 0),
  published_at timestamptz not null default now(),
  published_by uuid references profiles (id)
);
alter table app_terms enable row level security;
create policy app_terms_select on app_terms for select using (true);
grant select on app_terms to authenticated, anon;

-- Every acceptance is kept (who, which version, when).
create table terms_acceptances (
  user_id uuid not null references profiles (id) on delete cascade,
  version int not null references app_terms (version),
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);
alter table terms_acceptances enable row level security;
create policy terms_acceptances_select on terms_acceptances for select using (user_id = auth.uid() or is_system_admin());
grant select on terms_acceptances to authenticated;

alter table profiles add column terms_version int;

create function accept_terms(p_version int) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth();
begin
  if p_version is distinct from (select max(version) from app_terms) then
    raise exception 'not the current terms' using errcode = '22023';
  end if;
  insert into terms_acceptances (user_id, version) values (v_uid, p_version) on conflict do nothing;
  update profiles set terms_version = p_version where id = v_uid;
end $$;

-- A new version (system admin): everyone is asked to accept it on their next visit.
create function publish_terms(p_body text) returns int
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := require_auth(); v_version int;
begin
  if not is_system_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(max(version), 0) + 1 into v_version from app_terms;
  insert into app_terms (version, body, published_by) values (v_version, btrim(p_body), v_uid);
  return v_version;
end $$;

revoke execute on function accept_terms(int), publish_terms(text) from public, anon;
grant execute on function accept_terms(int), publish_terms(text) to authenticated;

-- First version. "## " starts a heading; an empty line starts a paragraph; "- " is a list item.
insert into app_terms (version, body) values (1, $terms$
## תקנון ותנאי שימוש – Next Team

ברוכים הבאים ל־Next Team, אפליקציה לניהול קבוצות ספורט של ילדים ונוער: אירועים ואישורי הגעה, הרכבים, הסעות, משימות, סקרים והודעות. השימוש באפליקציה מותנה בהסכמה לתקנון הזה. אם אינכם מסכימים, אל תשתמשו באפליקציה.

## מי משתמש באפליקציה
- מנהלי מועדון, מאמנים ואנשי צוות של הקבוצה.
- הורים ואפוטרופוסים של שחקנים.
- שחקנים, כשהמועדון מאפשר להם חשבון משלהם.

הורה שרושם ילד מצהיר שהוא ההורה או האפוטרופוס של הילד, ושיש לו הרשות לרשום אותו ולמסור את פרטיו. שחקן מתחת לגיל 18 משתמש באפליקציה בהסכמת הוריו ובליווים.

## איזה מידע נשמר
- פרטי חשבון: שם, מייל, טלפון (לא חובה) ותמונת פרופיל (לא חובה).
- פרטי שחקן: שם, תאריך לידה, תמונה (רק בהסכמת ההורה), מספר חולצה, תפקיד, דירוגים מקצועיים, יעדים ומידע רפואי שההורה או הצוות הזינו.
- פעילות: אישורי הגעה וסיבות היעדרות, הסעות, תשובות לסקרים, משימות, הודעות בצ'אט ותוצאות משחקים.

## מי רואה מה – פרסום מידע באפליקציה
בהסכמה לתקנון אתם מאשרים שהמידע יוצג לחברי הקבוצה כך:
- לכל חברי הקבוצה (צוות, הורים ושחקנים): שם השחקן, תמונתו (רק אם ההורה אישר), מקומו בהרכב שהמאמן פרסם, לוח האירועים, תוצאות ואירועי משחק (שערים, בישולים, כרטיסים), ופרטי הקשר של הצוות ושל ההורים ברשימת אנשי הקשר של הקבוצה.
- לצוות ולמנהלי המועדון בלבד: אישורי ההגעה של כל השחקנים וסיבות ההיעדרות, טיוטות הרכב, טבלת השחקנים וההורים.
- להורה ולצוות בלבד: המידע הרפואי של הילד.
- לשחקן, להורה ולצוות: הדירוגים המקצועיים, היעדים, מספר החולצה והתפקיד של השחקן.
- כל הורה רואה את אישורי ההגעה, המשימות והתשובות של הילדים שלו בלבד.

## תמונות
העלאת תמונה של ילד והצגתה לחברי הקבוצה מותנות באישור ההורה, שאפשר לבטל בכל עת בפרופיל הילד. אין להעלות תמונות של אחרים בלי רשותם.

## הודעות והתנהגות
- ערוץ הקבוצה פתוח לצוות ולהורים. שחקנים קוראים בו.
- שיחה אישית מתקיימת בין המאמן לשחקן, וההורים רואים אותה במלואה.
- אסור לפרסם תוכן פוגעני, מעליב, מיני, אלים או מפלה, ואסור לפרסם מידע אישי של אחרים. הצוות והמועדון רשאים להסיר תוכן ולהשעות משתמש.

## התראות ומיילים
האפליקציה שולחת התראות ומיילים שקשורים לפעילות הקבוצה: תזכורות לאישור הגעה, שינויים וביטולים של אירועים, בקשות הצטרפות ופרסום הרכב. אפשר לכבות התראות בהגדרות הטלפון.

## העוזר החכם
העוזר עונה על שאלות מתוך המידע שאתם מורשים לראות, ופעולות שהוא מציע מתבצעות רק אחרי אישור שלכם. התשובות שלו עלולות להיות לא מדויקות.

## שמירה, אבטחה ומחיקה
- המידע נשמר בשירותי ענן מאובטחים, והגישה אליו מוגבלת לפי התפקיד בקבוצה.
- אפשר לבקש תיקון או מחיקה של מידע ממנהל המועדון. ילד שנמחק מהמועדון נמחק עם המידע שלו.
- המועדון אחראי על המידע של חברי המועדון שלו.

## שינויים בתקנון
כשהתקנון מתעדכן, תתבקשו לאשר את הגרסה החדשה בכניסה הבאה לאפליקציה.

## יצירת קשר
לשאלות על התקנון ועל המידע שלכם פנו למנהל המועדון שלכם.
$terms$);
