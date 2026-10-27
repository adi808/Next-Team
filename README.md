# Next Team

Team management for kids' sports clubs (football, basketball and more; sports are rows in the `sports` table, each with its own icon). React + TypeScript (Vite, PWA), Supabase (Postgres, Auth, RLS), Cloudflare Pages. Hebrew, RTL, mobile first.

## Status

Built: everything in the business spec except features marked "proposed" there.

| Area | What it does |
|---|---|
| Login | phone + SMS code, role/mode picker (a user who is parent and club admin picks a mode, and can switch) |
| Clubs / teams | system admin creates clubs; club admin creates teams (with a sport) and invites staff by phone |
| Players | first-class: name, birth date (mandatory), photo (parent consent per child). A child may have no phone: the parent manages the profile |
| Events | type from a table (training / match / team building ...), attendance answers with a reason from a table and a note, last answer wins, no time limit |
| Match | opponent, result, format and formation (defaults from the team), goals / assists / cards (types per sport, in a table) |
| Parameters | generic, dynamic, with history and per-role visibility: ratings 1-10, medical info, team settings (minimum age to answer, ...) |
| Tasks | coach assigns to the squad or to individual players, and to parents; everyone sees only their own |
| Surveys | single / multiple choice / free text, one answer set per person (replaceable) |
| Chat | team channel (staff and parents write, players read) and personal coach-player chat (parents see all of it, club admin does not) |

### Generic by design
* `lookups` - every "choose from a list" value (event types, absence reasons, match formats, formations, stat types). New values and new lists need no code (`upsert_lookup`, Lists screen). Dependent lists use `parent_id`; sport- and club-specific values use `sport_id` / `club_id`.
* `attribute_defs` + `attribute_values` - one mechanism for ratings, medical info, team and event settings and anything added later. Types: text, number, scale, boolean, date, select, lookup. Each definition says who sees it and who edits it; every save is a new row, so history is kept.
* `sports` - table with an icon per sport.

### Demo
`npm run build:demo` writes `dist-demo/next-team-demo.html`: one self-contained page with the real UI and an in-browser sample backend (`src/demo/`), with a person picker. It is excluded from the production bundle. `node tests/demo-e2e.cjs` drives it (33 checks).

### Verified
* `supabase/tests/scenario.sql`: 90 role-by-role checks on Postgres 16 (against a stub `auth` schema). Run it with `supabase/tests/stub_auth.sql` first, then the migrations, then the scenario.
* `tests/api-integration.cjs`: 29 checks over HTTP through a real PostgREST 12 with signed JWTs per role: table and function exposure, grants, RLS, RPCs with named parameters, error responses.
* `tests/ui-e2e.cjs`: 44 checks with the built UI in a real browser against that PostgREST and database, one session per role (coach, parent, player, club admin, system admin, outsider), including saving an attendance answer and posting a message.
* `tests/ui-smoke.cjs`: the same screens against a mocked API (this found and fixed a reload loop).
* `npm run typecheck` and `npm run build` pass.

### Not verified
Supabase's own services: phone login with a real SMS (GoTrue), photo upload to Storage, and the Supabase gateway (the tests use a minimal stand-in). `supabase start` could not run in the build environment (image downloads were blocked), so run the "First run" steps below once on a machine with Docker.

First run:

```bash
npm install
npx supabase start          # needs Docker
npx supabase db reset       # applies supabase/migrations/*
cp .env.example .env        # fill in the local anon key printed by `supabase start`
npm run dev
```

SMS login needs a provider configured in `supabase/config.toml` (`[auth.sms]`, e.g. Twilio).
For local development `[auth.sms.test_otp]` maps test number `+972500000000` to code `123456`.
Set a system admin by hand: `update profiles set is_system_admin = true where id = '<uuid>';`

## Decisions
1. Parent-child link: either side may ask by the other's phone (only when the child has an account); the coach of the child's team approves. A coach or club admin who adds a parent links them at once.
2. A coach adds players and parents to their own team; a club admin may invite staff (coaches, club admins); only a system admin creates clubs.
3. Team channel: staff and parents write, players read. Personal chat: coach <-> player, parents see all of it, club admin and system admin do not.
4. Medical info: parent, coach, club admin, system admin. Ratings: also the player. Each parent / player sees only their own child.
5. Players may answer attendance only when the team allows it and the player is at least the team's minimum age.
6. Still open: legal review of privacy (medical info, photos, chat with minors), reporting abusive content in personal chat, and a trademark / domain check for the name.
