import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
    .select("email, created_at")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Office Hours</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Signed in as{" "}
            <span className="font-medium">{profile?.email ?? user.email}</span>
          </p>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Auth check
        </h2>
        <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-zinc-500">User ID</dt>
          <dd className="font-mono text-xs break-all">{user.id}</dd>
          <dt className="text-zinc-500">Email</dt>
          <dd>{user.email}</dd>
          <dt className="text-zinc-500">Profile row</dt>
          <dd>
            {profile
              ? `synced (created ${new Date(profile.created_at).toLocaleString()})`
              : "not found — check the on_auth_user_created trigger"}
          </dd>
        </dl>
      </section>

      <p className="text-sm text-zinc-500">
        Next up: the weekly scheduling grid and check-in flow.
      </p>
    </main>
  );
}
