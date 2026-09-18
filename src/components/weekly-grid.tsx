"use client";

import { useEffect, useMemo, useState } from "react";
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
const DAY_HEADER = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
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

export function WeeklyGrid({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [weekOffset, setWeekOffset] = useState(0);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ start: Date; end: Date; anchorRect: DOMRect } | null>(
    null,
  );

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

  if (!now || !days) {
    return (
      <section className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Weekly schedule
        </h2>
        <p className="mt-3 text-xs text-zinc-500">Loading…</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Weekly schedule
        </h2>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w - 1)}
            className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ← Prev
          </button>
          <span className="text-zinc-500">
            {DAY_HEADER.format(days[0])} – {DAY_HEADER.format(days[6])}
          </span>
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w + 1)}
            className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Next →
          </button>
        </div>
      </div>

      {(globalError || fetchError) && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {globalError ?? "Couldn't load the schedule. Try refreshing."}
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-16" />
              {days.map((day) => (
                <th
                  key={day.toISOString()}
                  className="p-2 text-center text-xs font-medium text-zinc-500 sm:text-sm"
                >
                  {DAY_HEADER.format(day)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SLOT_START_HOURS.map((hour) => (
              <tr key={hour}>
                <td className="p-1 text-xs text-zinc-500">
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

                  const claimantUserIds = claimants
                    .map((c) => c.user_id)
                    .filter((id): id is string => !!id);
                  const names = displayNames(claimantUserIds, namesByUserId);
                  const label =
                    names.length === 0
                      ? "Open"
                      : names.length <= MAX_NAMES_SHOWN
                        ? names.join(", ")
                        : `${names.slice(0, MAX_NAMES_SHOWN).join(", ")} +${names.length - MAX_NAMES_SHOWN}`;

                  return (
                    <td key={key} className="p-1">
                      <button
                        type="button"
                        data-slot={key}
                        disabled={isPast}
                        onClick={(e) =>
                          setSelected({ start, end, anchorRect: e.currentTarget.getBoundingClientRect() })
                        }
                        className={cellClass(isPast, !!mine, othersCount > 0)}
                      >
                        {label}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <LegendSwatch className="border-dashed border-zinc-300 dark:border-zinc-700" label="Open" />
        <LegendSwatch
          className="border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40"
          label="Others signed up"
        />
        <LegendSwatch
          className="border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40"
          label="Yours"
        />
      </div>

      {isLoading && <p className="mt-3 text-xs text-zinc-500">Loading…</p>}

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

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded-sm border ${className}`} />
      {label}
    </span>
  );
}

function cellClass(isPast: boolean, isMine: boolean, hasOthers: boolean) {
  const base =
    "w-full rounded-md border px-1 py-2 text-[11px] leading-tight transition-colors disabled:cursor-not-allowed sm:text-xs";

  if (isPast) {
    return `${base} border-transparent text-zinc-300 dark:text-zinc-700`;
  }
  if (isMine) {
    return `${base} border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300`;
  }
  if (hasOthers) {
    return `${base} border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300`;
  }
  return `${base} border-dashed border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:text-zinc-200`;
}

export default WeeklyGrid;
