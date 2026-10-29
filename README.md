# Next Team

Team management for kids' sports clubs (football, basketball and more; sports are rows in the `sports` table, each with its own icon). React + TypeScript (Vite, PWA), Supabase (Postgres, Auth, RLS), Cloudflare Pages. Hebrew, RTL, mobile first.

## Status

Built: everything in the business spec except features marked "proposed" there.

| Area | What it does |
|---|---|
| Login | Google or an emailed code (free, no SMS), role/mode picker (a user who is parent and club admin picks a mode, and can switch) |
| Install | banner inviting browser users to add the app to the home screen: one-tap install on Android Chrome, Share → Add to Home Screen steps on iPhone; hidden once installed, or for a month after closing |
| Clubs / teams | system admin creates clubs; club admin creates teams (with a sport) and invites staff by email |
| Players | first-class: name, birth date (mandatory), photo (parent consent per child). A child may have no email: the parent manages the profile |
| Events | type from a table (training / match / team building ...), attendance answers with a reason from a table and a note, last answer wins, no time limit |
| Match | opponent, result, format and formation (defaults from the team), goals / assists / cards (types per sport, in a table) |
| Parameters | generic, dynamic, with history and per-role visibility: ratings 1-10, medical info, team settings (minimum age to answer, ...) |
| Tasks | coach assigns to the squad or to individual players, and to parents; everyone sees only their own |
| Surveys | single / multiple choice / free text, one answer set per person (replaceable) |
| Chat | team channel (staff and parents write, players read) and personal coach-player chat (parents see all of it, club admin does not) |
| Home dashboards | coach, parent and player see the nearest event and, below it, the nearest event of another type (e.g. training, then a match) |
| Lineup | on a football match the staff see a pitch sketch: players placed by the formation and their position, with photo and shirt number; tap to swap, save (`event_lineups`) |
| Staff and parents | staff type per membership (list `staff_role`: team manager, head coach, assistant, fitness, secretary, medic; a label only, every team staff member has the coach's permissions), shown to the whole team; a parent's relation to the child (list `guardian_relation`: mom, dad, guardian) |
| League | team parameter `league_url` (the team's page on football.org.il); the team's "league" tab shows the league table and fixtures, read by the `league` Edge Function (`supabase/functions/league`) |
| Transport | staff turn on transport (הסעה) for an event; a parent answers per child "not interested" or the number of passengers, staff for themselves; everyone sees the total, staff see who travels (`event_transport`) |
| Contacts | phone (optional) and email for everyone: own profile (club admin, staff, parent), player (parent or staff edit; the player's own account email), club (phone, email, address, website; club admin edits). The team's "contacts" tab lists the club, its admins, the staff, the parents (with their children) and the players with call / WhatsApp / email buttons, for every member of the team (`team_contacts`) |
| Parents | both parents of a child with relation (mom / dad / guardian), phone and email. A parent or the staff add the second parent (also in the join form); without an account they are kept as a contact (`guardian_contacts`), and signing in with that email links them to the child |
| Roster | club admins (whole club, filter by team) and coaches (their team) see a table of every child with parents and contact details; search, edit a child and its parents, unlink a parent, delete a child (club admin), export to Excel (CSV) (`club_roster`) |
| Join link | one link per team (`join_links`); a signed-in member is recognised, anyone else picks coach / team manager / parent (with children) and sends a request; the club admin decides staff, the team's staff decide parents (`join_requests`, Requests screen) |
| Notifications | in-app list, Web Push (`send-push`) and, for join requests and their answers, email through Brevo (`send-email`, not enabled yet: production uses in-app and push only) |

### Generic by design
* `lookups` - every "choose from a list" value (event types, absence reasons, match formats, formations, stat types). New values and new lists need no code (`upsert_lookup`, Lists screen). Dependent lists use `parent_id`; sport- and club-specific values use `sport_id` / `club_id`.
* `attribute_defs` + `attribute_values` - one mechanism for ratings, medical info, team and event settings and anything added later. Types: text, number, scale, boolean, date, select, lookup. Each definition says who sees it and who edits it; every save is a new row, so history is kept.
* `sports` - table with an icon per sport.

### Demo
`npm run build:demo` writes `dist-demo/next-team-demo.html`: one self-contained page with the real UI and an in-browser sample backend (`src/demo/`), with a person picker. It is excluded from the production bundle. `node tests/demo-e2e.cjs` drives it (65 checks).

### Verified
* `supabase/tests/scenario.sql`: 192 role-by-role checks on Postgres 16 (against a stub `auth` schema). Run it with `supabase/tests/stub_auth.sql` first, then the migrations, then the scenario.
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
6. Still open: legal review of privacy (medical info, photos, chat with minors), reporting abusive content in personal chat, and a trademark / domain check for the name.
