"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { changePassword, deleteAccount, type ActionState } from "@/app/account/actions";

const initialState: ActionState = { status: "idle" };

const fieldClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs outline-none transition-colors placeholder:text-ink-faint focus:border-brand-ring";

const labelClass = "block text-xs font-semibold uppercase tracking-wide text-ink-muted";

function ChangePasswordPanel({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState(changePassword, initialState);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 text-ink shadow-pop">
        <h2 className="font-display text-lg font-semibold tracking-tight">Change password</h2>

        {state.status === "success" ? (
          <>
            <p className="mt-3 rounded-lg border border-ok-soft-line bg-ok-soft px-3 py-2 text-sm text-ok">
              {state.message}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-lg bg-brand px-3 py-2.5 text-sm font-semibold text-brand-on transition-colors hover:bg-brand-hover"
            >
              Done
            </button>
          </>
        ) : (
          <form action={action} className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="password" className={labelClass}>
                New password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                placeholder="••••••••"
                className={fieldClass}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="confirmPassword" className={labelClass}>
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                placeholder="••••••••"
                className={fieldClass}
              />
            </div>

            {state.status === "error" && (
              <p className="rounded-lg border border-bad-soft-line bg-bad-soft px-3 py-2 text-sm text-bad">
                {state.message}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-sunken"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="flex-1 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-brand-on transition-colors hover:bg-brand-hover disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function DeleteAccountPanel({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState(deleteAccount, initialState);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 text-ink shadow-pop">
        <h2 className="font-display text-lg font-semibold tracking-tight text-bad">
          Delete account
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          This permanently deletes your account, your claimed office hours, and your check-in
          history. This can&apos;t be undone.
        </p>

        <form action={action} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="delete-password" className={labelClass}>
              Enter your password to confirm
            </label>
            <input
              id="delete-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              className={fieldClass}
            />
          </div>

          {state.status === "error" && (
            <p className="rounded-lg border border-bad-soft-line bg-bad-soft px-3 py-2 text-sm text-bad">
              {state.message}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-sunken"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="flex-1 rounded-lg bg-bad px-3 py-2 text-sm font-semibold text-bad-on transition-colors hover:bg-bad-hover disabled:opacity-60"
            >
              {pending ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AccountMenu({
  displayName,
  initial,
}: {
  displayName: string;
  initial: string;
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"password" | "delete" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 py-1 pl-1 pr-2 transition-colors hover:border-white/40 hover:bg-white/20 sm:pr-2.5"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold ring-1 ring-white/25">
          {initial}
        </span>
        <span className="hidden max-w-[16ch] truncate text-sm font-medium text-header-ink sm:inline">
          {displayName}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className={`hidden h-3.5 w-3.5 shrink-0 text-header-ink-soft transition-transform sm:block ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-surface py-1 text-ink shadow-pop"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setPanel("password");
              setOpen(false);
            }}
            className="block w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-surface-sunken"
          >
            Change password
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setPanel("delete");
              setOpen(false);
            }}
            className="block w-full px-4 py-2.5 text-left text-sm text-bad transition-colors hover:bg-bad-soft"
          >
            Delete account
          </button>
        </div>
      )}

      {panel === "password" && <ChangePasswordPanel onClose={() => setPanel(null)} />}
      {panel === "delete" && <DeleteAccountPanel onClose={() => setPanel(null)} />}
    </div>
  );
}

export default AccountMenu;
