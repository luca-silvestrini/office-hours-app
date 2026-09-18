"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  status: "idle" | "error";
  message?: string;
  name?: string;
  email?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

function safeNext(value: FormDataEntryValue | null): string {
  const s = String(value ?? "/");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("redirectTo"));

  if (!name) {
    return { status: "error", message: "Enter your name.", name, email };
  }
  if (!EMAIL_RE.test(email)) {
    return { status: "error", message: "Enter a valid email address.", name, email };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      status: "error",
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      name,
      email,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });

  if (error) {
    return { status: "error", message: error.message, name, email };
  }

  redirect(next);
}

export async function logIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("redirectTo"));

  if (!EMAIL_RE.test(email) || !password) {
    return { status: "error", message: "Invalid email or password.", email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { status: "error", message: "Invalid email or password.", email };
  }

  redirect(next);
}
