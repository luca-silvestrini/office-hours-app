"use client";

import { Suspense, useState } from "react";
import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signUp, logIn, type AuthState } from "./actions";
import { BrandMark } from "@/components/brand-mark";

const initialState: AuthState = { status: "idle" };

const fieldClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink shadow-xs outline-none transition-colors placeholder:text-ink-faint focus:border-brand-ring";

const labelClass = "block text-xs font-medium uppercase tracking-wide text-ink-muted";

function AuthForm() {
  const params = useSearchParams();
  const redirectTo = params.get("redirectTo") ?? "/";
  const sessionError = params.get("error") === "auth";
  const [mode, setMode] = useState<"login" | "signup">("login");

  const [signUpState, signUpAction, signUpPending] = useActionState(signUp, initialState);
  const [logInState, logInAction, logInPending] = useActionState(logIn, initialState);

  const state = mode === "signup" ? signUpState : logInState;
  const pending = mode === "signup" ? signUpPending : logInPending;
  const action = mode === "signup" ? signUpAction : logInAction;

  return (
    <div className="w-full max-w-[26rem]">
      <div className="mb-6 flex flex-col items-center text-center">
        <BrandMark className="h-14 w-14" />
        <h1 className="font-display mt-4 text-3xl font-semibold tracking-tight">Office Hours</h1>
        <p className="mt-1 text-sm text-ink-muted">All Saints Catholic Newman Center</p>
        <div className="mt-4 flex w-full items-center gap-3" title="Pray and work">
          <span className="rule-gold h-px flex-1" />
          <span className="font-display whitespace-nowrap text-sm italic tracking-wide text-gold">
            Ora et Labora
          </span>
          <span className="rule-gold h-px flex-1" />
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-7">
        <div className="flex rounded-lg bg-surface-sunken p-1 text-sm">
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
                mode === m
                  ? "bg-surface text-ink shadow-xs"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {m === "login" ? "Log in" : "Sign up"}
            </button>
          ))}
        </div>

        <p className="mt-5 text-sm text-ink-muted">
          {mode === "signup"
            ? "Create an account to start signing up for office hours."
            : "Welcome back — sign in to manage your hours."}
        </p>

        {sessionError && (
          <p className="mt-4 rounded-lg border border-bad-soft-line bg-bad-soft px-3 py-2 text-sm text-bad">
            Your session expired. Please log in again.
          </p>
        )}

        <form action={action} className="mt-5 space-y-4">
          <input type="hidden" name="redirectTo" value={redirectTo} />

          {mode === "signup" && (
            <div className="space-y-1.5">
              <label htmlFor="name" className={labelClass}>
                Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                required
                defaultValue={state.name}
                placeholder="Jane Doe"
                className={fieldClass}
              />
              <p className="text-xs text-ink-faint">
                Shown to others on the schedule so people know who&apos;s covering each hour.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="email" className={labelClass}>
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={state.email}
              placeholder="you@asu.edu"
              className={fieldClass}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className={labelClass}>
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              placeholder="••••••••"
              className={fieldClass}
            />
            {mode === "signup" && (
              <p className="text-xs text-ink-faint">At least 6 characters.</p>
            )}
          </div>

          {state.status === "error" && (
            <p className="rounded-lg border border-bad-soft-line bg-bad-soft px-3 py-2 text-sm text-bad">
              {state.message}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-brand px-3 py-2.5 text-sm font-semibold text-brand-on shadow-card transition-colors hover:bg-brand-hover disabled:opacity-60"
          >
            {pending ? "Just a moment…" : mode === "signup" ? "Create account" : "Log in"}
          </button>
        </form>
      </div>

      <p className="mt-5 text-center text-xs text-ink-faint">
        {mode === "signup" ? "Already have an account?" : "Don't have an account yet?"}{" "}
        <button
          type="button"
          onClick={() => setMode(mode === "signup" ? "login" : "signup")}
          className="font-medium text-brand-soft-ink underline-offset-2 hover:underline"
        >
          {mode === "signup" ? "Log in" : "Sign up"}
        </button>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12 sm:py-16">
      <Suspense
        fallback={<div className="w-full max-w-[26rem] text-sm text-ink-muted">Loading…</div>}
      >
        <AuthForm />
      </Suspense>
    </main>
  );
}
