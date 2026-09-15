"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import { SLOT_START_HOURS } from "@/lib/config";
import { addWeeks, slotStart, startOfWeek, weekDays } from "@/lib/week";
import type { Database } from "@/lib/supabase/types";

type Slot = Database["public"]["Tables"]["office_hours_slots"]["Row"];

const HOUR_LABEL = new Intl.DateTimeFormat(undefined, { hour: "numeric" });
const DAY_HEADER = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export function WeeklyGrid({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [weekOffset, setWeekOffset] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const weekStart = useMemo(() => addWeeks(startOfWeek(new Date()), weekOffset), [weekOffset]);
  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const weekEnd = useMemo(() => addWeeks(weekStart, 1), [weekStart]);

  const {
    data: slots = [],
    error: fetchError,
    isLoading,
    mutate,
  } = useSWR<Slot[]>(
    ["office_hours_slots", weekStart.toISOString(), weekEnd.toISOString()] as const,
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

  async function handleClick(start: Date, isPast: boolean, mine: Slot | undefined) {
    if (isPast) return;

    const startIso = start.toISOString();
    const end = new Date(start);
    end.setHours(end.getHours() + 1);

    setPendingKey(startIso);
    setActionError(null);

    if (!mine) {
      const { data, error } = await supabase
        .from("office_hours_slots")
        .insert({ user_id: userId, start_time: startIso, end_time: end.toISOString() })
        .select()
        .single();
      if (error) {
        setActionError(
          error.code === "23505"
            ? "You've already claimed that slot — refreshing."
            : error.message,
        );
        await mutate();
      } else if (data) {
        await mutate([...slots, data], { revalidate: false });
      }
    } else {
      const { error } = await supabase.from("office_hours_slots").delete().eq("id", mine.id);
      if (error) {
        setActionError(error.message);
      } else {
        await mutate(
          slots.filter((s) => s.id !== mine.id),
          { revalidate: false },
        );
      }
    }

    setPendingKey(null);
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

      {(actionError || fetchError) && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {actionError ?? "Couldn't load the schedule. Try refreshing."}
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
                  const key = start.toISOString();
                  const claimants = slotsByStart.get(key) ?? [];
                  const mine = claimants.find((s) => s.user_id === userId);
                  const othersCount = claimants.length - (mine ? 1 : 0);
                  const isPast = start.getTime() <= Date.now();
                  const isPending = pendingKey === key;

                  let label: string;
                  if (mine) label = othersCount > 0 ? `Yours +${othersCount}` : "Yours";
                  else if (othersCount > 0) label = `${othersCount} here`;
                  else label = "Open";

                  return (
                    <td key={key} className="p-1">
                      <button
                        type="button"
                        data-slot={key}
                        disabled={isPast || isPending}
                        onClick={() => handleClick(start, isPast, mine)}
                        className={cellClass(isPast, !!mine, othersCount > 0)}
                      >
                        {isPending ? "…" : label}
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
    "w-full rounded-md border px-1 py-2 text-[11px] transition-colors disabled:cursor-not-allowed sm:text-xs";

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
