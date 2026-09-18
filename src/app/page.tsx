import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WeeklyGrid } from "@/components/weekly-grid";
import { BrandMark } from "@/components/brand-mark";

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

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <BrandMark />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight tracking-tight">
              Office Hours
            </p>
            <p className="truncate text-xs leading-tight text-ink-muted">
              All Saints Newman Center
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-soft-ink">
                {initial}
              </span>
              <span className="max-w-[16ch] truncate text-sm text-ink-muted">{displayName}</span>
            </div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:border-line-strong hover:bg-surface-sunken hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-7">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Hi{profile?.name ? `, ${profile.name.split(" ")[0]}` : ""} 👋
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Pick the hours you&apos;ll be at the Newman Center, then check in when you arrive.
          </p>
        </div>

        <WeeklyGrid userId={user.id} />
      </main>

      <footer className="border-t border-line py-5">
        <p className="mx-auto w-full max-w-6xl px-4 text-xs text-ink-faint sm:px-6">
          All Saints Catholic Newman Center · 230 E University Dr, Tempe
        </p>
      </footer>
    </>
  );
}
