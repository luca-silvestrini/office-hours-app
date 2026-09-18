"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import { MAX_SLOTS_PER_USER_PER_WEEK, RECURRING_HORIZON_WEEKS, SLOT_START_HOURS } from "@/lib/config";
import { addWeeks, slotStart, startOfWeek, weekDays } from "@/lib/week";
import { displayNames } from "@/lib/names";
import type { Database } from "@/lib/supabase/types";
import { SlotModal } from "@/components/slot-modal";

type Slot = Database["public"]["Tables"]["office_hours_slots"]["Row"];
type CheckIn = Database["public"]["Tables"]["check_ins"]["Row"];

const HOUR_LABEL = new Intl.DateTimeFormat(undefined, { hour: "numeric" });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const DAY_NUM = new Intl.DateTimeFormat(undefined, { day: "numeric" });
const RANGE_LABEL = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const ONE_HOUR_MS = 60 * 60 * 1000;
const MAX_NAMES_SHOWN = 3;

/** The user's other slot this week adjacent (±1hr) to the given one, if any. */
function findAdjacentMineSlot(slot: Slot, mineSlots: Slot[]): Slot | undefined {
  const t = new Date(slot.start_time).getTime();
  return mineSlots.find((s) => {
    if (s.id === slot.id) return false;
    const st = new Date(s.start_time).getTime();
    return st === t - ONE_HOUR_MS || st === t + ONE_HOUR_MS;
  });
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function WeeklyGrid({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [weekOffset, setWeekOffset] = useState(0);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ start: Date; end: Date; anchorRect: DOMRect } | null>(
    null,
  );
  const scrollerRef = useRef<HTMLDivElement>(null);
  const todayColRef = useRef<HTMLTableCellElement>(null);

  // "Now" must never be computed during Next.js's server pre-render (Vercel's
  // functions run in UTC) — the week grid's hours are relative to the
  // *browser's* local timezone, and a server-computed value here would bake
  // wrong UTC offsets straight into every slot's start_time, since claim()
  // reuses these same Date objects. Deferring to an effect guarantees this
  // only ever runs client-side, after hydration.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // This is the deliberate fix, not an anti-pattern: `now` must only ever
    // exist as a client-computed value, never a server-rendered one, so it
    // has to be set from inside an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
  }, []);

  // On narrow screens the 7-day grid overflows horizontally; without this you
  // land on Sunday and have to scroll past days that already happened.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const col = todayColRef.current;
    if (!scroller || !col) return;
    scroller.scrollLeft = Math.max(
      0,
      col.offsetLeft - scroller.clientWidth / 2 + col.clientWidth / 2,
    );
  }, [weekOffset, now]);

  const weekStart = useMemo(() => (now ? addWeeks(startOfWeek(now), weekOffset) : null), [now, weekOffset]);
  const days = useMemo(() => (weekStart ? weekDays(weekStart) : null), [weekStart]);
  const weekEnd = useMemo(() => (weekStart ? addWeeks(weekStart, 1) : null), [weekStart]);

  const {
    data: slots = [],
    error: fetchError,
    isLoading,
    mutate,
  } = useSWR<Slot[]>(
    weekStart && weekEnd
      ? (["office_hours_slots", weekStart.toISOString(), weekEnd.toISOString()] as const)
      : null,
    async ([, startIso, endIso]) => {
      const { data, error } = await supabase
        .from("office_hours_slots")
        .select("*")
        .gte("start_time", startIso)
        .lt("start_time", endIso);
      if (error) throw error;
      return data;
    },
  );

  // Every member's display name, fetched once — not scoped to the visible
  // week, since claimants shown in a cell come from that week's slots but the
  // name lookup itself is small and week-independent.
  const { data: members = [] } = useSWR<Database["public"]["Views"]["member_names"]["Row"][]>(
    ["member_names"] as const,
    async () => {
      const { data, error } = await supabase.from("member_names").select("*");
      if (error) throw error;
      return data;
    },
  );

  const namesByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) if (m.id) map.set(m.id, m.name ?? "Someone");
    return map;
  }, [members]);

  const mySlots = useMemo(() => slots.filter((s) => s.user_id === userId), [slots, userId]);
  const mySlotIds = useMemo(() => mySlots.map((s) => s.id), [mySlots]);

  const { data: checkIns = [], mutate: mutateCheckIns } = useSWR<CheckIn[]>(
    mySlotIds.length ? (["check_ins", ...mySlotIds] as const) : null,
    async (key) => {
      const ids = key.slice(1) as string[];
      const { data, error } = await supabase.from("check_ins").select("*").in("slot_id", ids);
      if (error) throw error;
      return data;
    },
  );

  const checkInsBySlotId = useMemo(() => {
    const map = new Map<string, CheckIn>();
    for (const c of checkIns) map.set(c.slot_id, c);
    return map;
  }, [checkIns]);

  // Multiple people can claim the same hour, so each start_time maps to a list.
  // Postgres serializes timestamptz as "...+00:00"; Date#toISOString() (used for
  // lookups below) produces "...Z" — same instant, different string. Normalize
  // through Date here so both sides compare in the same format.
  const slotsByStart = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const slot of slots) {
      const key = new Date(slot.start_time).toISOString();
      const existing = map.get(key);
      if (existing) existing.push(slot);
      else map.set(key, [slot]);
    }
    return map;
  }, [slots]);

  async function claim(start: Date, repeatWeekly: boolean) {
    if (mySlotIds.length >= MAX_SLOTS_PER_USER_PER_WEEK) {
      throw new Error(
        `You can only sign up for ${MAX_SLOTS_PER_USER_PER_WEEK} slots per week — release one first.`,
      );
    }

    const startIso = start.toISOString();
    const end = new Date(start);
    end.setHours(end.getHours() + 1);

    if (!repeatWeekly) {
      const { data, error } = await supabase
        .from("office_hours_slots")
        .insert({ user_id: userId, start_time: startIso, end_time: end.toISOString() })
        .select()
        .single();
      if (error) throw new Error(error.code === "23505" ? "You've already claimed that slot." : error.message);
      await mutate([...slots, data], { revalidate: false });
      return;
    }

    const { data: series, error: seriesError } = await supabase
      .from("recurring_claims")
      .insert({ user_id: userId })
      .select()
      .single();
    if (seriesError) throw new Error(seriesError.message);

    const rows = Array.from({ length: RECURRING_HORIZON_WEEKS }, (_, i) => {
      const occurrenceStart = addWeeks(start, i);
      const occurrenceEnd = new Date(occurrenceStart);
      occurrenceEnd.setHours(occurrenceEnd.getHours() + 1);
      return {
        user_id: userId,
        start_time: occurrenceStart.toISOString(),
        end_time: occurrenceEnd.toISOString(),
        recurring_claim_id: series.id,
      };
    });

    const { error } = await supabase
      .from("office_hours_slots")
      .upsert(rows, { onConflict: "user_id,start_time", ignoreDuplicates: true });
    if (error) {
      await supabase.from("recurring_claims").delete().eq("id", series.id);
      throw new Error(error.message);
    }
    await mutate();
  }

  async function releaseOne(slot: Slot) {
    const { error } = await supabase.from("office_hours_slots").delete().eq("id", slot.id);
    if (error) throw new Error(error.message);
    await mutate(
      slots.filter((s) => s.id !== slot.id),
      { revalidate: false },
    );
  }

  async function releaseThisAndFuture(slot: Slot) {
    if (!slot.recurring_claim_id) return releaseOne(slot);
    const { error } = await supabase
      .from("office_hours_slots")
      .delete()
      .eq("recurring_claim_id", slot.recurring_claim_id)
      .gte("start_time", slot.start_time);
    if (error) throw new Error(error.message);
    await supabase.from("recurring_claims").delete().eq("id", slot.recurring_claim_id);
    await mutate();
  }

  async function checkIn(slotsToCheckIn: Slot[], latitude: number, longitude: number) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("You're signed out — refresh and sign in again.");

    const res = await fetch("/api-go/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ slot_ids: slotsToCheckIn.map((s) => s.id), latitude, longitude }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Check-in failed (${res.status}).`);
    const created = (body.check_ins ?? []) as CheckIn[];
    await mutateCheckIns((prev = []) => [...prev, ...created], { revalidate: false });
  }

  const selectedClaimants = selected ? slotsByStart.get(selected.start.toISOString()) ?? [] : [];
  const selectedMine = selectedClaimants.find((s) => s.user_id === userId);
  const selectedAdjacent = selectedMine ? findAdjacentMineSlot(selectedMine, mySlots) : undefined;
  const selectedMineSlots = selectedMine
    ? [selectedMine, ...(selectedAdjacent ? [selectedAdjacent] : [])].sort((a, b) =>
        a.start_time.localeCompare(b.start_time),
      )
    : [];

  if (!now || !days || !weekStart) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-card">
        <div className="h-5 w-40 animate-pulse rounded bg-surface-sunken" />
        <div className="mt-5 grid grid-cols-7 gap-2">
          {Array.from({ length: 28 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-surface-sunken" />
          ))}
        </div>
      </section>
    );
  }

  const claimedCount = mySlotIds.length;
  const atCap = claimedCount >= MAX_SLOTS_PER_USER_PER_WEEK;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      {/* Card header: title + this-week status, then week navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold tracking-tight">Weekly schedule</h2>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              atCap
                ? "bg-gold-soft text-gold-soft-ink"
                : "bg-surface-sunken text-ink-muted"
            }`}
          >
            {claimedCount} of {MAX_SLOTS_PER_USER_PER_WEEK} this week
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {weekOffset !== 0 && (
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className="mr-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-brand-soft-ink transition-colors hover:bg-brand-soft"
            >
              Today
            </button>
          )}
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => setWeekOffset((w) => w - 1)}
            className="rounded-lg border border-line p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:bg-surface-sunken hover:text-ink"
          >
            <ChevronIcon direction="left" />
          </button>
          <span className="min-w-[8.5rem] text-center text-sm font-medium tabular-nums">
            {RANGE_LABEL.format(days[0])} – {RANGE_LABEL.format(days[6])}
          </span>
          <button
            type="button"
            aria-label="Next week"
            onClick={() => setWeekOffset((w) => w + 1)}
            className="rounded-lg border border-line p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:bg-surface-sunken hover:text-ink"
          >
            <ChevronIcon direction="right" />
          </button>
        </div>
      </div>

      {(globalError || fetchError) && (
        <p className="mx-4 mt-4 rounded-lg border border-bad-soft-line bg-bad-soft px-3 py-2 text-sm text-bad sm:mx-5">
          {globalError ?? "Couldn't load the schedule. Try refreshing."}
        </p>
      )}

      <div ref={scrollerRef} className="overflow-x-auto px-2 pb-2 pt-3 sm:px-3">
        <table className="w-full min-w-[42rem] table-fixed border-separate border-spacing-x-1 border-spacing-y-1">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-12 bg-surface sm:w-16" />
              {days.map((day) => {
                const today = isSameDay(day, now);
                return (
                  <th
                    key={day.toISOString()}
                    ref={today ? todayColRef : undefined}
                    className="pb-1 text-center align-bottom"
                  >
                    <span
                      className={`text-[11px] font-medium uppercase tracking-wide ${
                        today ? "text-brand-soft-ink" : "text-ink-faint"
                      }`}
                    >
                      {WEEKDAY.format(day)}
                    </span>
                    <span
                      className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums ${
                        today ? "bg-brand text-brand-on shadow-card" : "text-ink"
                      }`}
                    >
                      {DAY_NUM.format(day)}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {SLOT_START_HOURS.map((hour) => (
              <tr key={hour}>
                <td className="sticky left-0 z-10 bg-surface pr-2 text-right align-middle text-[11px] font-medium tabular-nums text-ink-faint">
                  {HOUR_LABEL.format(slotStart(days[0], hour))}
                </td>
                {days.map((day) => {
                  const start = slotStart(day, hour);
                  const end = new Date(start);
                  end.setHours(end.getHours() + 1);
                  const key = start.toISOString();
                  const claimants = slotsByStart.get(key) ?? [];
                  const mine = claimants.find((s) => s.user_id === userId);
                  const othersCount = claimants.length - (mine ? 1 : 0);
                  // A slot stays interactive through its end_time, not just its
                  // start_time — it's still "now" for the person checking in
                  // partway through the hour.
                  const isPast = end.getTime() <= now.getTime();
                  const checkedIn = mine ? checkInsBySlotId.has(mine.id) : false;

                  const claimantUserIds = claimants
                    .map((c) => c.user_id)
                    .filter((id): id is string => !!id);
                  const names = displayNames(claimantUserIds, namesByUserId);
                  const label =
                    names.length === 0
                      ? isPast
                        ? ""
                        : "Open"
                      : names.length <= MAX_NAMES_SHOWN
                        ? names.join(", ")
                        : `${names.slice(0, MAX_NAMES_SHOWN).join(", ")} +${names.length - MAX_NAMES_SHOWN}`;

                  return (
                    <td key={key}>
                      <button
                        type="button"
                        data-slot={key}
                        disabled={isPast}
                        onClick={(e) =>
                          setSelected({ start, end, anchorRect: e.currentTarget.getBoundingClientRect() })
                        }
                        className={cellClass(isPast, !!mine, othersCount > 0)}
                      >
                        <span className="line-clamp-2">{label}</span>
                        {checkedIn && !isPast && (
                          <span className="mt-0.5 flex items-center justify-center gap-0.5 text-[10px] font-semibold text-ok">
                            <CheckIcon /> in
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3 text-xs text-ink-muted sm:px-5">
        <LegendSwatch className="border-dashed border-line-strong" label="Open" />
        <LegendSwatch
          className="border-brand-soft-line bg-brand-soft"
          label="Someone signed up"
        />
        <LegendSwatch className="border-gold-soft-line bg-gold-soft" label="Yours" />
        {isLoading && <span className="ml-auto text-ink-faint">Loading…</span>}
      </div>

      {selected && (
        <SlotModal
          key={selected.start.toISOString()}
          anchorRect={selected.anchorRect}
          start={selected.start}
          end={selected.end}
          claimants={selectedClaimants}
          mineSlots={selectedMineSlots}
          namesByUserId={namesByUserId}
          checkInsBySlotId={checkInsBySlotId}
          atCap={atCap}
          onClose={() => setSelected(null)}
          onClaim={async (start, repeatWeekly) => {
            setGlobalError(null);
            try {
              await claim(start, repeatWeekly);
            } catch (err) {
              setGlobalError(err instanceof Error ? err.message : "Something went wrong.");
              throw err;
            }
          }}
          onReleaseOne={releaseOne}
          onReleaseThisAndFuture={releaseThisAndFuture}
          onCheckIn={checkIn}
        />
      )}
    </section>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3" aria-hidden="true">
      <path
        d="M20 6L9 17l-5-5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded border ${className}`} />
      {label}
    </span>
  );
}

function cellClass(isPast: boolean, isMine: boolean, hasOthers: boolean) {
  const base =
    "flex w-full flex-col items-center justify-center rounded-lg border px-1 py-2 text-[11px] font-medium leading-tight transition-colors disabled:cursor-not-allowed sm:text-xs";

  if (isPast) {
    // Recessive, but still a visible box — an entirely blank column reads as
    // broken rather than "already happened".
    return `${base} border-line/70 bg-surface-sunken/60 text-ink-faint`;
  }
  if (isMine) {
    return `${base} border-gold-soft-line bg-gold-soft text-gold-soft-ink hover:border-gold-strong`;
  }
  if (hasOthers) {
    return `${base} border-brand-soft-line bg-brand-soft text-brand-soft-ink hover:border-brand-ring`;
  }
  return `${base} border-dashed border-line-strong text-ink-faint hover:border-brand-ring hover:bg-brand-soft hover:text-brand-soft-ink`;
}

export default WeeklyGrid;
