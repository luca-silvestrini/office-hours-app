import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WeeklyGrid } from "@/components/weekly-grid";
import Image from "next/image";
import { CrossGlyph } from "@/components/brand-mark";
import { SideDevotion } from "@/components/side-devotion";

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
      <SideDevotion />

      <header className="relative z-20 border-b border-[var(--gold-header)]/40 bg-header text-header-ink">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          {/* Fixed height, automatic width — the crest renders correctly
              whatever exact dimensions the source file has. */}
          <Image
            src="/brand/crest.png"
            alt="All Saints Newman Center"
            width={140}
            height={160}
            priority
            className="h-9 w-auto shrink-0"
          />
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

      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
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

      {/* Bookends the page — same blue bar and gold rule treatment as the header. */}
      <footer className="relative z-20 mt-8 border-t border-[var(--gold-header)]/40 bg-header text-header-ink">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-5 sm:px-6">
          <span className="rule-gold-header hidden h-px flex-1 sm:block" />
          <div className="flex items-center gap-2.5">
            <CrossGlyph className="h-4 w-4 shrink-0 text-gold-header" />
            <p className="text-xs text-header-ink-soft">
              All Saints Catholic Newman Center · 230 E University Dr, Tempe
            </p>
          </div>
          <span className="rule-gold-header hidden h-px flex-1 sm:block" />
        </div>
      </footer>
    </>
  );
}
