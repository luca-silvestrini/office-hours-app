# Office Hours Self-Scheduling App

Self-service office-hours scheduling with passwordless (magic-link) sign-in,
location-verified check-in, and email reminders.

- **Frontend + app backend:** Next.js (App Router, TypeScript), deployed on Vercel
- **Geolocation check-in + cron reminders:** Go serverless functions in `api-go/`, deployed on Vercel
- **Database + auth:** Supabase (Postgres + magic-link auth)
- **Email:** Resend

## Status

| Step | Feature | State |
| --- | --- | --- |
| 1 | Next.js scaffold + Vercel config + `api-go/` | ✅ done |
| 2 | Supabase schema + row-level security | ✅ migration written (`supabase/migrations/0001_init.sql`) |
| 3 | Magic-link auth end to end | ✅ done |
| 4 | Weekly calendar UI | ✅ done |
| 5 | Go geolocation check-in + weekly-repeat claims | ✅ done (`api-go/checkin.go`, slot modal in the grid) |
| 6 | Vercel Cron + reminder emails | ⬜ not started — also needs a top-up job to keep recurring claims (`recurring_claims`) materialized past their initial `RECURRING_HORIZON_WEEKS` window |
| 7 | Retroactive / manual check-in | ⬜ RLS in place, UI not started |

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project and apply the schema

Either paste `supabase/migrations/0001_init.sql` into the Supabase Dashboard →
**SQL Editor** and run it, or use the CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

This creates `users`, `office_hours_slots`, `check_ins`, the enums, the
`auth.users` → `public.users` sync trigger, and all row-level-security policies.

### 3. Configure Supabase Auth

In the Supabase Dashboard → **Authentication**:

- **URL Configuration → Site URL:** `http://localhost:3000` (and your Vercel URL in prod)
- **URL Configuration → Redirect URLs:** add
  `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/confirm`
  (plus the production equivalents).
- **Providers → Email:** enable "Email", keep "Confirm email" on. Magic links
  work with the default email template (`{{ .ConfirmationURL }}`), which routes
  to `/auth/callback?code=...`.
  - Optional: to use the token-hash flow instead, change the template to
    `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`.
    Both routes are implemented.

### 4. Environment variables

```bash
cp .env.local.example .env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Dashboard →
Project Settings → API), and `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.
`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_*`, and `OFFICE_*` are only needed for
steps 5–6.

### 5. Run

```bash
npm run dev
```

## Verifying steps 1–3

1. Open `http://localhost:3000` → you are redirected to `/login` (proxy guard).
2. Enter your email → "Check your email for a sign-in link".
3. Click the link in the email → redirected back to `/` and signed in.
4. The dashboard shows your user id, email, and **Profile row: synced** — this
   confirms the `on_auth_user_created` trigger populated `public.users`.
5. In the Supabase Dashboard → Table editor → `users`, your row is present.
6. Click **Sign out** → back to `/login`.

RLS smoke test (SQL Editor, as an authenticated user via the API, or with
`supabase` impersonation): a user can `select` only their own `users` row, can
`insert` into `office_hours_slots` only with `user_id = auth.uid()`, and cannot
`delete` another user's slot.

## Project layout

```
src/
  proxy.ts                     # session refresh + auth gate (Next 16 "proxy", formerly middleware)
  lib/
    config.ts                  # office coordinates + grid constants (mirrors api-go/geo)
    supabase/
      client.ts                # browser client
      server.ts                # server client (cookies)
      middleware.ts            # updateSession() helper used by proxy.ts
      types.ts                 # Database types (matches the migration)
  app/
    page.tsx                   # protected dashboard
    login/                     # magic-link sign-in (page + server action)
    auth/callback/route.ts     # PKCE code exchange
    auth/confirm/route.ts      # token-hash verification
    auth/signout/route.ts      # sign out
api-go/
  go.mod
  health.go                    # GET /api-go/health — proves the Go pipeline
  checkin.go                   # POST /api-go/checkin — geolocation check-in
  geo/geo.go                   # haversine + office location — NOT under internal/:
                                #   Vercel's Go builder isolates each function into
                                #   its own build sandbox, which breaks Go's internal/
                                #   import-visibility rule the moment more than one
                                #   function needs the shared package
supabase/
  migrations/0001-0003_*.sql
vercel.json                    # polyglot build: @vercel/next + @vercel/go
```

## Deploy notes

`vercel.json` uses `builds` to run the Next.js app and the Go functions side by
side. Go files map to routes by path: `api-go/health.go` → `/api-go/health`.
Set the same environment variables in Vercel → Project Settings. Vercel Cron
(step 6) will be added to `vercel.json` as a `crons` entry pointing at the
reminders Go function.
