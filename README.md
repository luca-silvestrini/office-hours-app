# Office Hours Self-Scheduling App

Self-service office-hours scheduling with email/password sign-up and login,
location-verified check-in, and email reminders.

- **Frontend + app backend:** Next.js (App Router, TypeScript), deployed on Vercel
- **Geolocation check-in + cron reminders:** Go serverless functions in `api-go/`, deployed on Vercel
- **Database + auth:** Supabase (Postgres + email/password auth)
- **Email:** Resend (reminder emails only — sign-in no longer depends on email deliverability)

## Status

| Step | Feature | State |
| --- | --- | --- |
| 1 | Next.js scaffold + Vercel config + `api-go/` | ✅ done |
| 2 | Supabase schema + row-level security | ✅ migration written (`supabase/migrations/0001_init.sql`) |
| 3 | Auth end to end | ✅ done — email/password (`0004` migration adds `name`; magic-link removed) |
| 4 | Weekly calendar UI | ✅ done — cell shows claimant names, 2 slots/week cap, back-to-back check-in merge |
| 5 | Go geolocation check-in + weekly-repeat claims | ✅ done (`api-go/checkin.go`, slot modal in the grid) |
| 6 | Vercel Cron + reminder emails | ✅ done (`api-go/reminders.go`, `0006` migration) — still needs a top-up job to keep recurring claims (`recurring_claims`) materialized past their initial `RECURRING_HORIZON_WEEKS` window |
| 6b | Weekly signup-reminder emails | ✅ done (`api-go/signup-reminders.go`, `0007` migration) — Monday cron nudges anyone short of `MAX_SLOTS_PER_USER_PER_WEEK` slots for the current week |
| 7 | Retroactive / manual check-in | ⬜ RLS in place, UI not started |

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project and apply the schema

Either paste each `supabase/migrations/000N_*.sql` file into the Supabase
Dashboard → **SQL Editor** and run them in order, or use the CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

`0001` creates `users`, `office_hours_slots`, `check_ins`, the enums, the
`auth.users` → `public.users` sync trigger, and all row-level-security
policies. `0002`–`0004` layer on multi-claim support, recurring weekly
claims, and names + the `member_names` view. `0005` fixes a bug present
since `0001`: deleting a user with any claimed slots used to fail outright
(a check constraint conflicted with the original `on delete set null`) — see
each file's own comments.

### 3. Configure Supabase Auth

In the Supabase Dashboard → **Authentication**:

- **Providers → Email:** enable "Email", then turn **off** "Confirm email".
  Sign-up creates an immediately-usable session with zero email round-trip —
  deliberate, so the app works without depending on transactional email
  deliverability (see the `RESEND_*` notes below).
- **Policies → minimum password length:** the default (6 characters, no
  complexity rules) is what this app expects; no change needed unless you
  want it stricter.
- No Redirect URLs or Site URL setup needed for auth itself — those were only
  ever required for magic-link email redirects, which this app no longer uses.

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
2. Switch to **Sign up**, enter a name/email/password → submitting signs you
   in immediately (no email involved).
3. The dashboard shows your user id, email, and **Profile row: synced** — this
   confirms the `on_auth_user_created` trigger populated `public.users`
   (including `name`, from `0004`'s trigger update).
4. In the Supabase Dashboard → Table editor → `users`, your row is present.
5. Click **Sign out**, then use **Log in** with the same email/password to
   confirm the other half of the flow.

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
    login/                     # email/password log in + sign up (one page, mode toggle)
    auth/signout/route.ts      # sign out
api-go/
  go.mod
  health.go                    # GET /api-go/health — proves the Go pipeline
  checkin.go                   # POST /api-go/checkin — geolocation check-in
  reminders.go                 # GET /api-go/reminders — Vercel Cron, sends check-in-window emails
  signup-reminders.go          # GET /api-go/signup-reminders — Vercel Cron, Monday signup nudges
  geo/geo.go                   # haversine + office location — NOT under internal/:
                                #   Vercel's Go builder isolates each function into
                                #   its own build sandbox, which breaks Go's internal/
                                #   import-visibility rule the moment more than one
                                #   function needs the shared package
supabase/
  migrations/0001-0007_*.sql
vercel.json                    # polyglot build: @vercel/next + @vercel/go
```

## Reminder emails

`api-go/reminders.go` runs once a day via Vercel Cron (`vercel.json`'s
`crons` entry, `0 14 * * *` — 7:00 AM in `America/Phoenix`, which doesn't
observe DST) — daily rather than tied to each slot's own check-in window, so
it works on Vercel's Hobby plan (per-minute schedules need Pro). Each run
sends one "office hours today" digest email per user with a claimed slot that
day, listing every slot (merging back-to-back ones the same way `checkin.go`
lets one check-in cover multiple contiguous hours) and when its check-in
window opens (`CHECK_IN_WINDOW_EARLY_MINUTES` / `checkInEarlyGraceMinutes`,
10 minutes before `start_time`). `office_hours_slots.reminder_sent_at`
(`0006` migration) makes each send idempotent across cron runs.

To change the send time, edit the cron schedule in `vercel.json` (it's UTC,
so account for `America/Phoenix` being fixed at UTC-7 year-round).

`api-go/signup-reminders.go` runs every Monday via the same Vercel Cron
mechanism (`0 14 * * 1` — also 7:00 AM `America/Phoenix`). It looks at the
week already under way (Sunday–Saturday, matching `src/lib/week.ts`'s
`startOfWeek`) and emails anyone who hasn't claimed all
`MAX_SLOTS_PER_USER_PER_WEEK` slots yet — tailored copy for "0 slots claimed"
vs. "missing your second slot." `signup_reminder_log` (`0007` migration,
unique on `(user_id, week_start)`) makes each week's send idempotent per
user, the same way `reminder_sent_at` does for the daily digest. Two cron
entries total stays within Vercel Hobby's 2-cron-job limit; adding a third
scheduled job needs a Pro plan.

**Sending domain:** emails send from `RESEND_FROM_EMAIL`. This project's
domain (`updates.asucatholic.org`) was verified in Resend via the three DNS
records IT added on 2026-09-18 (TXT DKIM + two CNAMEs) — confirm that domain
still shows "Verified" in the Resend dashboard before relying on
deliverability.

## Deploy notes

`vercel.json` uses `builds` to run the Next.js app and the Go functions side by
side. Each Go function is listed explicitly by path (`api-go/health.go` →
`/api-go/health`, `api-go/checkin.go` → `/api-go/checkin`) rather than via a
recursive glob — Vercel's Go builder treats every matched `*.go` file as its
own function requiring an exported `Handler`, which breaks as soon as a
shared package (`api-go/geo/`) or a `_test.go` file gets swept up too. Add new
functions to both `vercel.json`'s `builds` array and this list. Also note:
shared Go packages used by more than one function **must not** live under
`internal/` — Vercel's per-function isolated build relocates the importing
file outside that package's module namespace, which breaks Go's internal-import
visibility rule the moment two functions need the same shared code.

`vercel.json` also needs an explicit `routes` array mapping each `/api-go/*`
path to its build source (e.g. `/api-go/checkin` → `/api-go/checkin.go`),
plus a catch-all `{ "src": "/(.*)", "dest": "/$1" }` for everything else.
Without it, `@vercel/next`'s own router claims every path — including
`/api-go/*` — before the Go functions ever run, so they 404 even though the
build succeeded. Add a new `routes` entry alongside each new function.

Set the same environment variables in Vercel → Project Settings, including
`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `CRON_SECRET` for step 6. Vercel
injects `CRON_SECRET` into the request it sends `/api-go/reminders`
automatically — the value you set in Project Settings just has to match what
`reminders.go` checks against.
