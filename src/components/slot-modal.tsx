"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CHECK_IN_WINDOW_EARLY_MINUTES } from "@/lib/config";
import type { Database } from "@/lib/supabase/types";

type Slot = Database["public"]["Tables"]["office_hours_slots"]["Row"];
type CheckIn = Database["public"]["Tables"]["check_ins"]["Row"];

const DATE_HEADER = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const TIME_LABEL = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

const GAP = 8;

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
  mine,
  myCheckIn,
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
  mine: Slot | undefined;
  myCheckIn: CheckIn | undefined;
  onClose: () => void;
  onClaim: (start: Date, repeatWeekly: boolean) => Promise<void>;
  onReleaseOne: (slot: Slot) => Promise<void>;
  onReleaseThisAndFuture: (slot: Slot) => Promise<void>;
  onCheckIn: (slot: Slot, latitude: number, longitude: number) => Promise<void>;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedIn, setCheckedIn] = useState(!!myCheckIn);

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

  const othersCount = claimants.length - (mine ? 1 : 0);
  // One-shot "is it check-in time" read for this popover instance (it's
  // freshly mounted per click, via the `key` in weekly-grid.tsx) — staleness
  // within a single open session is an acceptable tradeoff, not a live
  // countdown.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const checkInWindowOpen =
    now >= start.getTime() - CHECK_IN_WINDOW_EARLY_MINUTES * 60_000 && now <= end.getTime();

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
    if (!mine) return;
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
          await onCheckIn(mine, position.coords.latitude, position.coords.longitude);
          setCheckedIn(true);
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
      className="z-50 w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <h2 className="text-base font-semibold">{DATE_HEADER.format(start)}</h2>
      <p className="mt-0.5 text-sm text-zinc-500">
        {TIME_LABEL.format(start)} – {TIME_LABEL.format(end)}
      </p>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {!mine && (
          <>
            {othersCount > 0 && (
              <p className="text-sm text-zinc-500">
                {othersCount} {othersCount === 1 ? "person" : "people"} already signed up.
              </p>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={repeatWeekly}
                onChange={(e) => setRepeatWeekly(e.target.checked)}
              />
              Repeat weekly
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => onClaim(start, repeatWeekly))}
              className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {busy ? "Claiming…" : "Claim this slot"}
            </button>
          </>
        )}

        {mine && (
          <>
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              You&apos;re signed up for this slot
              {othersCount > 0 ? ` (+${othersCount} other${othersCount === 1 ? "" : "s"})` : ""}.
            </p>

            {mine.recurring_claim_id ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => onReleaseOne(mine))}
                  className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Release this occurrence
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => onReleaseThisAndFuture(mine))}
                  className="flex-1 rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                >
                  Release this and all future
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => onReleaseOne(mine))}
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Release
              </button>
            )}

            {checkInWindowOpen && (
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                {checkedIn ? (
                  <p className="text-sm text-emerald-600 dark:text-emerald-400">Checked in ✓</p>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleCheckIn}
                    className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {busy ? "Checking in…" : "Check In"}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default SlotModal;
