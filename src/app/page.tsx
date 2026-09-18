import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WeeklyGrid } from "@/components/weekly-grid";
import { CrossGlyph } from "@/components/brand-mark";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already guards this, but re-check so the page never renders
  // without a user.
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("email, name")
    .eq("id", user.id)
    .maybeSingle();

  const displayName = profile?.name?.trim() || profile?.email || user.email;
  const initial = (displayName ?? "?").charAt(0).toUpperCase();
  const firstName = profile?.name?.trim().split(" ")[0];

  return (
    <>
      <header className="border-b border-[var(--gold-header)]/40 bg-header text-header-ink">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <span className="inline-flex shrink-0 items-center justify-center rounded-lg ring-1 ring-[var(--gold-header)]/50 p-1.5">
            <CrossGlyph className="h-5 w-5 text-gold-header" />
          </span>
          <div className="min-w-0">
            <p className="font-display truncate text-lg font-semibold leading-tight tracking-tight">
              Office Hours
            </p>
            <p className="truncate text-xs leading-tight text-header-ink-soft">
              All Saints Newman Center
            </p>
          </div>

          {/* Motto — thin gold rules flanking the Benedictine maxim, the one
              ornamental flourish kept from the reference. */}
          <div
            className="mx-6 hidden flex-1 items-center gap-4 lg:flex"
            title="Pray and work"
          >
            <span className="rule-gold-header h-px flex-1" />
            <span className="font-display whitespace-nowrap text-sm italic tracking-wide text-gold-header">
              Ora et Labora
            </span>
            <span className="rule-gold-header h-px flex-1" />
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3 lg:ml-0">
            <div className="hidden items-center gap-2 sm:flex">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-xs font-semibold ring-1 ring-white/25">
                {initial}
              </span>
              <span className="max-w-[16ch] truncate text-sm text-header-ink-soft">
                {displayName}
              </span>
            </div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-lg border border-white/30 px-3 py-1.5 text-sm font-medium transition-colors hover:border-white/60 hover:bg-white/10"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        {/* Motto gets its own line on narrow screens rather than being cut. */}
        <div className="flex items-center gap-3 px-4 pb-2.5 lg:hidden" title="Pray and work">
          <span className="rule-gold-header h-px flex-1" />
          <span className="font-display whitespace-nowrap text-xs italic tracking-wide text-gold-header">
            Ora et Labora
          </span>
          <span className="rule-gold-header h-px flex-1" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-7">
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Hi{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Pick the hours you&apos;ll be at the Newman Center, then check in when you arrive.
          </p>
        </div>

        <WeeklyGrid userId={user.id} />
      </main>

      <footer className="mt-4 border-t border-line py-5">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <CrossGlyph className="h-3.5 w-3.5 shrink-0 text-[var(--gold-strong)]/70" />
          <p className="text-xs text-ink-faint">
            All Saints Catholic Newman Center · 230 E University Dr, Tempe
          </p>
        </div>
      </footer>
    </>
  );
}
