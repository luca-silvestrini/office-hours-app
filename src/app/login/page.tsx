"use client";

import { Suspense } from "react";
import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { sendMagicLink, type LoginState } from "./actions";

const initialState: LoginState = { status: "idle" };

function LoginForm() {
  const params = useSearchParams();
  const redirectTo = params.get("redirectTo") ?? "/";
  const linkError = params.get("error") === "auth";

  const [state, formAction, pending] = useActionState(sendMagicLink, initialState);

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Office Hours</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Sign in with your email. We&apos;ll send you a magic link — no password.
      </p>

      {linkError && state.status === "idle" && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          That sign-in link was invalid or expired. Request a new one below.
        </p>
      )}

      {state.status === "sent" ? (
        <div className="mt-6 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          Check <span className="font-medium">{state.email}</span> for a sign-in
          link. You can close this tab.
        </div>
      ) : (
        <form action={formAction} className="mt-6 space-y-3">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={state.email}
            placeholder="you@example.com"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          {state.status === "error" && (
            <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {pending ? "Sending…" : "Send magic link"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Suspense fallback={<div className="w-full max-w-sm text-sm text-zinc-500">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
