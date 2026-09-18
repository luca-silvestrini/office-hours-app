"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CHECK_IN_WINDOW_EARLY_MINUTES, MAX_SLOTS_PER_USER_PER_WEEK } from "@/lib/config";
import { displayNames } from "@/lib/names";
import type { Database } from "@/lib/supabase/types";

type Slot = Database["public"]["Tables"]["office_hours_slots"]["Row"];
type CheckIn = Database["public"]["Tables"]["check_ins"]["Row"];

const DATE_HEADER = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const TIME_LABEL = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

const GAP = 10;

/** Where to place the popover relative to the clicked cell, clamped on-screen. */
function computePosition(anchor: DOMRect, popover: { width: number; height: number }) {
  let left = anchor.right + GAP;
  if (left + popover.width > window.innerWidth - GAP) {
    left = anchor.left - popover.width - GAP;
  }
  left = Math.max(GAP, Math.min(left, window.innerWidth - popover.width - GAP));

  let top = anchor.top;
  top = Math.max(GAP, Math.min(top, window.innerHeight - popover.height - GAP));

  return { top, left };
}

export function SlotModal({
  anchorRect,
  start,
  end,
  claimants,
  mineSlots,
  namesByUserId,
  checkInsBySlotId,
  atCap,
  onClose,
  onClaim,
  onReleaseOne,
  onReleaseThisAndFuture,
  onCheckIn,
}: {
  anchorRect: DOMRect;
  start: Date;
  end: Date;
  claimants: Slot[];
  /** 0 = not yours, 1 = a single claim, 2 = back-to-back — checked in together. */
  mineSlots: Slot[];
  namesByUserId: Map<string, string>;
  checkInsBySlotId: Map<string, CheckIn>;
  atCap: boolean;
  onClose: () => void;
  onClaim: (start: Date, repeatWeekly: boolean) => Promise<void>;
  onReleaseOne: (slot: Slot) => Promise<void>;
  onReleaseThisAndFuture: (slot: Slot) => Promise<void>;
  onCheckIn: (slots: Slot[], latitude: number, longitude: number) => Promise<void>;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    setPosition(computePosition(anchorRect, { width: el.offsetWidth, height: el.offsetHeight }));
  }, [anchorRect]);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const mineIds = new Set(mineSlots.map((s) => s.id));
  const otherUserIds = claimants
    .filter((c) => !mineIds.has(c.id))
    .map((c) => c.user_id)
    .filter((id): id is string => !!id);
  const otherNames = displayNames(otherUserIds, namesByUserId);

  // Back-to-back slots share one check-in covering their combined span, so the
  // window and "already checked in" state are computed across all of them.
  const windowStart = mineSlots.length
    ? new Date(Math.min(...mineSlots.map((s) => new Date(s.start_time).getTime())))
    : start;
  const windowEnd = mineSlots.length
    ? new Date(Math.max(...mineSlots.map((s) => new Date(s.end_time).getTime())))
    : end;
  // One-shot "is it check-in time" read for this popover instance (it's
  // freshly mounted per click, via the `key` in weekly-grid.tsx) — staleness
  // within a single open session is an acceptable tradeoff, not a live
  // countdown.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const checkInWindowOpen =
    mineSlots.length > 0 &&
    now >= windowStart.getTime() - CHECK_IN_WINDOW_EARLY_MINUTES * 60_000 &&
    now <= windowEnd.getTime();
  const allCheckedIn = mineSlots.length > 0 && mineSlots.every((s) => checkInsBySlotId.has(s.id));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function handleCheckIn() {
    if (!mineSlots.length) return;
    setBusy(true);
    setError(null);
    if (!("geolocation" in navigator)) {
      setError("Your browser doesn't support location.");
      setBusy(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await onCheckIn(mineSlots, position.coords.latitude, position.coords.longitude);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Check-in failed.");
        } finally {
          setBusy(false);
        }
      },
      (geoError) => {
        setError(
          geoError.code === geoError.PERMISSION_DENIED
            ? "Location access denied — enable it in your browser settings and try again."
            : "Couldn't get your location. Try again.",
        );
        setBusy(false);
      },
    );
  }

  const secondaryBtn =
    "flex-1 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-sunken disabled:opacity-60";

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="false"
      style={{
        position: "fixed",
        top: position?.top ?? anchorRect.top,
        left: position?.left ?? anchorRect.left,
        visibility: position ? "visible" : "hidden",
      }}
      className="z-50 w-[min(22rem,calc(100vw-1.25rem))] overflow-hidden rounded-xl border border-line bg-surface text-ink shadow-pop"
    >
      <div className="border-b border-line bg-surface-sunken px-4 py-3">
        <p className="font-display text-lg font-semibold tracking-tight">{DATE_HEADER.format(start)}</p>
        <p className="mt-0.5 text-xs tabular-nums text-ink-muted">
          {TIME_LABEL.format(start)} – {TIME_LABEL.format(end)}
        </p>
      </div>

      <div className="space-y-3 px-4 py-4">
        {error && (
          <p className="rounded-lg border border-bad-soft-line bg-bad-soft px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}

        {otherNames.length > 0 && (
          <div className="rounded-lg border border-brand-soft-line bg-brand-soft px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-brand-soft-ink/80">
              Also signed up
            </p>
            <p className="mt-0.5 text-sm text-brand-soft-ink">{otherNames.join(", ")}</p>
          </div>
        )}

        {mineSlots.length === 0 &&
          (atCap ? (
            <p className="rounded-lg border border-gold-soft-line bg-gold-soft px-3 py-2 text-sm text-gold-soft-ink">
              You already have {MAX_SLOTS_PER_USER_PER_WEEK} slots this week. Release one to sign up
              for a different hour.
            </p>
          ) : (
            <>
              <label className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5 text-sm transition-colors hover:bg-surface-sunken">
                <input
                  type="checkbox"
                  checked={repeatWeekly}
                  onChange={(e) => setRepeatWeekly(e.target.checked)}
                  className="h-4 w-4 accent-[var(--brand)]"
                />
                <span>
                  Repeat weekly
                  <span className="block text-xs text-ink-muted">Same hour every week</span>
                </span>
              </label>

              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => onClaim(start, repeatWeekly))}
                className="w-full rounded-lg bg-brand px-3 py-2.5 text-sm font-semibold text-brand-on transition-colors hover:bg-brand-hover disabled:opacity-60"
              >
                {busy ? "Signing up…" : "Sign up for this hour"}
              </button>
            </>
          ))}

        {mineSlots.map((slot) => (
          <div key={slot.id} className="rounded-lg border border-gold-soft-line bg-gold-soft p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium tabular-nums text-gold-soft-ink">
                {TIME_LABEL.format(new Date(slot.start_time))} –{" "}
                {TIME_LABEL.format(new Date(slot.end_time))}
              </p>
              {slot.recurring_claim_id && (
                <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                  Weekly
                </span>
              )}
            </div>
            {slot.recurring_claim_id ? (
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => onReleaseOne(slot))}
                  className={secondaryBtn}
                >
                  Just this one
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => onReleaseThisAndFuture(slot))}
                  className="flex-1 rounded-lg bg-bad px-3 py-2 text-sm font-medium text-bad-on transition-colors hover:bg-bad-hover disabled:opacity-60"
                >
                  This &amp; future
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => onReleaseOne(slot))}
                className={`mt-2.5 w-full ${secondaryBtn}`}
              >
                Release this hour
              </button>
            )}
          </div>
        ))}

        {checkInWindowOpen && (
          <div className="rounded-lg border border-line bg-surface-sunken p-3">
            {mineSlots.length === 2 && (
              <p className="mb-2 text-xs text-ink-muted">
                Back-to-back — one check-in covers {TIME_LABEL.format(windowStart)} –{" "}
                {TIME_LABEL.format(windowEnd)}.
              </p>
            )}
            {allCheckedIn ? (
              <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-ok">
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                  <path
                    d="M20 6L9 17l-5-5"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Checked in
              </p>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={handleCheckIn}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-ok px-3 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                  <path
                    d="M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="2" />
                </svg>
                {busy ? "Checking in…" : "Check in"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SlotModal;
