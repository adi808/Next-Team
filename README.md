# Next Kick

Football team management for kids' clubs. React + TypeScript (Vite, PWA), Supabase (Postgres, Auth, RLS), Cloudflare Pages. Hebrew, RTL, mobile first.

## Status

Stage C1 (foundations): database schema, RLS policies, RPCs, phone + SMS login, role shell.

Verified here: `npm run typecheck` and `npm run build` pass, and the three migrations apply cleanly on Postgres 16
(against a stub `auth` schema) with a per-role scenario test (club creation, invites, coach limits, player cannot post,
parent sees messages only after coach approval, outsider sees nothing).
**Not verified:** real Supabase (`supabase start`), real SMS delivery, and the UI in a browser.

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

Decisions made while implementing: only a system admin creates clubs (optionally naming the first club admin by phone);
phones are stored as E.164 and a leading `0` is read as Israel (`+972`).

## Open points to confirm
1. Who starts a parent-child link: either side, by the other's phone number; the child's team coach approves (implemented that way).
2. A coach may invite players and parents to his own team; a club admin may invite any role.
3. v1 messages are one channel per team (no private chat); players read only.
4. Set a system admin by hand: `update profiles set is_system_admin = true where id = '<uuid>';`

## Next (C2)
Clubs/teams admin screens, invite by phone, guardianship request and approval, RLS test script per role.
