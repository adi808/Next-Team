# Next Kick

Football team management for kids' clubs. React + TypeScript (Vite, PWA), Supabase (Postgres, Auth, RLS), Cloudflare Pages. Hebrew, RTL, mobile first.

## Status

Stage C1 (foundations): database schema, RLS policies, RPCs, phone + SMS login, role shell.
These files were written but **not executed** (no Postgres or npm access in the authoring environment). First run:

```bash
npm install
npx supabase start          # needs Docker
npx supabase db reset       # applies supabase/migrations/*
cp .env.example .env        # fill in the local anon key printed by `supabase start`
npm run dev
```

SMS login needs a provider configured in `supabase/config.toml` (`[auth.sms]`, e.g. Twilio).
For local development use `[auth.sms.test_otp]` with a test number and fixed code.

## Open points to confirm
1. Who starts a parent-child link: either side, by the other's phone number; the child's team coach approves (implemented that way).
2. A coach may invite players and parents to his own team; a club admin may invite any role.
3. v1 messages are one channel per team (no private chat); players read only.
4. Set a system admin by hand: `update profiles set is_system_admin = true where id = '<uuid>';`

## Next (C2)
Clubs/teams admin screens, invite by phone, guardianship request and approval, RLS test script per role.
