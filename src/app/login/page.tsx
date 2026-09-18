"use client";

import { Suspense, useState } from "react";
import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signUp, logIn, type AuthState } from "./actions";

const initialState: AuthState = { status: "idle" };

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900";

function AuthForm() {
  const params = useSearchParams();
  const redirectTo = params.get("redirectTo") ?? "/";
  const linkError = params.get("error") === "auth";
  const [mode, setMode] = useState<"login" | "signup">("login");

  const [signUpState, signUpAction, signUpPending] = useActionState(signUp, initialState);
  const [logInState, logInAction, logInPending] = useActionState(logIn, initialState);

  const state = mode === "signup" ? signUpState : logInState;
  const pending = mode === "signup" ? signUpPending : logInPending;
  const action = mode === "signup" ? signUpAction : logInAction;

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Office Hours</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {mode === "signup" ? "Create an account to sign up for office hours." : "Sign in to your account."}
      </p>

      <div className="mt-6 flex gap-1 rounded-md border border-zinc-300 p-1 text-sm dark:border-zinc-700">
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`flex-1 rounded px-3 py-1.5 transition-colors ${
            mode === "login"
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
          }`}
        >
          Log in
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`flex-1 rounded px-3 py-1.5 transition-colors ${
            mode === "signup"
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
          }`}
        >
          Sign up
        </button>
      </div>

      {linkError && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          Your session expired or was invalid. Please log in again.
        </p>
      )}

      <form action={action} className="mt-6 space-y-3">
        <input type="hidden" name="redirectTo" value={redirectTo} />

        {mode === "signup" && (
          <div>
            <label htmlFor="name" className="block text-sm font-medium">
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
              className={`mt-1 ${inputClass}`}
            />
          </div>
        )}

        <div>
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
            className={`mt-1 ${inputClass}`}
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            placeholder="••••••••"
            className={`mt-1 ${inputClass}`}
          />
        </div>

        {state.status === "error" && (
          <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {pending ? "…" : mode === "signup" ? "Sign up" : "Log in"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Suspense fallback={<div className="w-full max-w-sm text-sm text-zinc-500">Loading…</div>}>
        <AuthForm />
      </Suspense>
    </main>
  );
}
