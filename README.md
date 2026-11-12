# Next Team

Team management for kids' sports clubs (football, basketball and more; sports are rows in the `sports` table, each with its own icon). React + TypeScript (Vite, PWA), Supabase (Postgres, Auth, RLS), Cloudflare Pages. Hebrew, RTL, mobile first.

## Status

Built: everything in the business spec except features marked "proposed" there.

| Area | What it does |
|---|---|
| Login | Google or an emailed code (free, no SMS); an account with no name yet (code sign-in, added ahead by email) gives name and phone once, role/mode picker (a user who is parent and club admin picks a mode, and can switch). With several roles the picker opens every entry: at the site root, and also when the app comes back after 30 minutes or more on an inner screen (restored tab, app resumed from the background); a link opened from outside (WhatsApp) still goes straight to its screen |
| Install | banner inviting browser users to add the app to the home screen: one-tap install on Android Chrome, Share → Add to Home Screen steps on iPhone; hidden once installed, or for a month after closing |
| Clubs / teams | system admin creates clubs; club admin creates teams (with a sport) and invites staff by email |
| Players | first-class: name, birth date (mandatory), photo (parent consent per child). A child may have no email: the parent manages the profile |
| Events | type from a table (training / match / team building ...), attendance answers with a reason from a table and a note, last answer wins, no time limit. Staff cancel an event with a reason (list `cancel_reason`): it stays on the board marked cancelled, answers close, and the team is told; a cancelled event can be restored |
| Match | opponent, result, format and formation (defaults from the team), goals / assists / cards (types per sport, in a table) |
| Parameters | generic, dynamic, with history and per-role visibility: ratings 1-10, medical info, team settings (minimum age to answer, ...) |
| Tasks | coach assigns to the squad or to individual players, and to parents; everyone sees only their own |
| Surveys | single / multiple choice / free text, one answer set per person (replaceable) |
| Chat | team channel (staff and parents write, players read) and personal coach-player chat (parents see all of it, club admin does not) |
| Home dashboards | coach, parent and player see the nearest event and, below it, the nearest event of another type (e.g. training, then a match) |
| Week schedule | "My week" card (Sunday to Saturday in Israel, arrows to other weeks): every training and match of the coach's team, or of all the teams of a parent's children / the player, each edged in its kit colours, with time, place, kit and transport. Personal for a parent or player: each child's answer (coming / not coming / not answered) on the event. Staff turn the week into a poster (a card per event in its kit colours, the club logo, the week's equipment) and a WhatsApp message to share |
| Lineup | on a football match the staff see a pitch sketch: players placed by the formation and their position, with photo and shirt number; tap to swap, save (`event_lineups`) |
| Staff and parents | staff type per membership (list `staff_role`: team manager, head coach, assistant, fitness, secretary, medic; a label only, every team staff member has the coach's permissions), shown to the whole team; a parent's relation to the child (list `guardian_relation`: mom, dad, guardian) |
| League | team parameter `league_url` (the team's page on football.org.il); the team's "league" tab shows the league table and fixtures, read by the `league` Edge Function (`supabase/functions/league`) |
| Transport | the transport card shows the team bus: a photo-like coach on a stadium background (template in `public/bus`, built once by `scripts/make-bus-template.py` from a reference picture), repainted in the browser in the colours of the event's kit (body and brush strokes in the shirt colour, swoosh in the shorts or socks colour; the team's first kit when the event has none), with the club name, team name and logo on its side, the logo in the corner and the passenger count; it can be shared or downloaded, and tops the event's WhatsApp banner when the event has transport. Staff turn on transport (הסעה) for an event; a parent answers per child "not interested" or the number of passengers, staff for themselves; everyone sees the total, staff see who travels (`event_transport`) |
| Contacts | phone (optional) and email for everyone: own profile (club admin, staff, parent), player (parent or staff edit; the player's own account email), club (phone, email, address, website; club admin edits). The team's "contacts" tab lists the club, its admins, the staff, the parents (with their children) and the players with call / WhatsApp / email buttons, for every member of the team (`team_contacts`) |
| Parents | both parents of a child with relation (mom / dad / guardian), phone and email. A parent or the staff add the second parent (also in the join form); without an account they are kept as a contact (`guardian_contacts`), and signing in with that email links them to the child |
| Roster | club admins (whole club, filter by team) and coaches (their team) see a table of every child with parents and contact details; search, edit a child and its parents, unlink a parent, delete a child (club admin), export to Excel (CSV) (`club_roster`) |
| Join link | one link per team (`join_links`); a signed-in member is recognised, anyone else picks coach / team manager / parent (with children) and sends a request; the club admin decides staff, the team's staff decide parents (`join_requests`, Requests screen) |
| Notifications | in-app list, Web Push (`send-push`) and email through Brevo (`send-email`). Join requests and their answers always go by email; event notices (cancelled, restored, a changed time or place, bulk edits, reminders) go by email only to people with no push subscription. Reminder: every 15 minutes (`pg_cron`, `send_event_reminders`) the parents of children with no answer, and players who answer for themselves, get one reminder per event, `reminder_hours` before it (team parameter, default 24, 0 = off); the staff get a count of missing answers |
| Match clock | on a match page a digital stopwatch for minutes played: a "match started" switch (pause at half time, end of match), and the whole squad with shirt numbers, a start / stop button and a timer per player (in and out any number of times; minutes count only while the match runs), goals / assists / yellow / red with + and −. Team settings: minimum minutes per player (0 = none), match length, and how many minutes before the end to alert; a bar per player turns green at the minimum, an alert lists who is still below it, and the end of the match gives a minutes report to share. Run by the staff or by parents the staff allow per team (Settings tab, `match_operators`); everyone else sees only their own child's minutes (`play_intervals` RLS). Without reception every tap is kept on the phone with its time and sent in order later; the server ignores a repeated action (`match_periods`, `play_intervals`, `event_stats.client_id`) |
| Nutrition | a "nutrition" tab for parents and players. A suggestion for the day that follows the child's schedule (match, training or rest; a morning match changes the evening before), the age and the allergies on the profile: meals with times, before / after the activity, drinks and a tip. "What did you eat today?" in free text gets a compliment (great / good / room to improve), what was good, what to improve and the next meal. Written by the `nutrition` Edge Function (Groq, same `GROQ_API_KEY` as the assistant). No weight and no calories; every screen says it is general information, not medical advice. Kept per child and day for the child and the parents only, the staff do not see it (`nutrition_entries`) |
| Assistant | a floating chat button on every screen (all modes) opens the Next Team assistant (`assistant` Edge Function, a model on Groq's free tier; `GROQ_MODEL` picks the model, default `openai/gpt-oss-120b`). It answers from the data (events, who is coming, transport, tasks, contacts), explains how to use the app, and prepares actions: attendance, transport seats, marking a task done, and for staff creating or cancelling an event. It runs with the person's own token, so it sees and does only what they may, and every action waits for a confirm card in the chat. When the free daily quota runs out it says it is busy until it resets. Off in the offline demo |

### Generic by design
* `lookups` - every "choose from a list" value (event types, absence reasons, match formats, formations, stat types). New values and new lists need no code (`upsert_lookup`, Lists screen). Dependent lists use `parent_id`; sport- and club-specific values use `sport_id` / `club_id`.
* `attribute_defs` + `attribute_values` - one mechanism for ratings, medical info, team and event settings and anything added later. Types: text, number, scale, boolean, date, select, lookup. Each definition says who sees it and who edits it; every save is a new row, so history is kept.
* `sports` - table with an icon per sport.

### Demo
`npm run build:demo` writes `dist-demo/next-team-demo.html`: one self-contained page with the real UI and an in-browser sample backend (`src/demo/`), with a person picker. It is excluded from the production bundle. `node tests/demo-e2e.cjs` drives it (124 checks).

### Verified
* `supabase/tests/scenario.sql`: 256 role-by-role checks on Postgres 16 (against a stub `auth` schema). Run it with `supabase/tests/stub_auth.sql` first, then the migrations, then the scenario.
* `tests/api-integration.cjs`: 29 checks over HTTP through a real PostgREST 12 with signed JWTs per role: table and function exposure, grants, RLS, RPCs with named parameters, error responses.
* `tests/ui-e2e.cjs`: 44 checks with the built UI in a real browser against that PostgREST and database, one session per role (coach, parent, player, club admin, system admin, outsider), including saving an attendance answer and posting a message.
* `tests/ui-smoke.cjs`: the same screens against a mocked API (this found and fixed a reload loop).
* `npm run typecheck` and `npm run build` pass.

### Not verified
Supabase's own services: Google / email login (GoTrue), photo upload to Storage, and the Supabase gateway (the tests use a minimal stand-in). `supabase start` could not run in the build environment (image downloads were blocked), so run the "First run" steps below once on a machine with Docker.

First run:

```bash
npm install
npx supabase start          # needs Docker
npx supabase db reset       # applies supabase/migrations/*
cp .env.example .env        # fill in the local anon key printed by `supabase start`
npm run dev
```

Login is Google or an emailed code (identity is the email address; see DEPLOY.md for the Google and SMTP setup).
Locally, `supabase start` serves the emails in Inbucket (http://127.0.0.1:54324).
Set a system admin by hand: `update profiles set is_system_admin = true where id = '<uuid>';`

## Decisions
1. Parent-child link: either side may ask by the other's email (only when the child has an account); the coach of the child's team approves. A coach or club admin who adds a parent links them at once.
2. A coach adds players and parents to their own team; a club admin may invite staff (coaches, club admins); only a system admin creates clubs.
3. Team channel: staff and parents write, players read. Personal chat: coach <-> player, parents see all of it, club admin and system admin do not.
4. Medical info: parent, coach, club admin, system admin. Ratings: also the player. Each parent / player sees only their own child.
5. Players may answer attendance only when the team allows it and the player is at least the team's minimum age.
6. Team colours on artwork (bus, week cards and poster) come from the event's kit, not a separate club colour.
7. Match clock: parents run it only when the staff allow them, per team; goals on the clock are statistics only (the result stays manual); a parent sees only their own child's minutes.
8. Nutrition: free text (no photos), tuned by age, allergies and the kind of day; no weight or calories; only the child and the parents see it.
9. Still open: legal review of privacy (medical info, photos, chat with minors), reporting abusive content in personal chat, and a trademark / domain check for the name.
