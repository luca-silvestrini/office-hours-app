/**
 * App-wide configuration constants.
 *
 * The office location is the "configurable constant" from the spec. It is also
 * mirrored in the Go geolocation function (api-go/geo/geo.go); keep the two in
 * sync, or set OFFICE_LATITUDE / OFFICE_LONGITUDE in the environment so both
 * read the same values.
 */
export const OFFICE_LOCATION = {
  latitude: Number(process.env.OFFICE_LATITUDE ?? 37.8679),
  longitude: Number(process.env.OFFICE_LONGITUDE ?? -122.25548),
} as const;

/** A geolocation check-in is only accepted within this radius of the office. */
export const CHECK_IN_RADIUS_MILES = 1;

/**
 * Weekly grid shape: Sunday–Saturday columns, one-hour rows.
 * Slots start on the hour from 09:00 through 20:00 (the last slot ends at 21:00).
 */
export const GRID = {
  firstSlotHour: 9,
  /** exclusive — last slot starts at lastSlotHour - 1 */
  lastSlotHour: 21,
  slotMinutes: 60,
} as const;

/** Hours a slot can start at, e.g. [9, 10, ..., 20]. */
export const SLOT_START_HOURS: number[] = Array.from(
  { length: GRID.lastSlotHour - GRID.firstSlotHour },
  (_, i) => GRID.firstSlotHour + i,
);

/**
 * How many weekly occurrences a "repeat weekly" claim materializes up front.
 * Not truly infinite — a year reads as indefinite to a user. True
 * never-ending continuation belongs to a step-6 cron job that tops up any
 * still-active recurring_claims row as its horizon runs low.
 */
export const RECURRING_HORIZON_WEEKS = 52;

/**
 * A geolocation check-in can be submitted starting this many minutes before a
 * slot's start_time, through its end_time. Mirrored independently in
 * api-go/checkin.go — the frontend only uses this to decide whether to show
 * the button; the Go function is the actual source of truth.
 */
export const CHECK_IN_WINDOW_EARLY_MINUTES = 10;

/**
 * Soft, client-side-only cap — enforced in weekly-grid.tsx's claim() before
 * it ever calls Supabase, not a DB constraint. See the "repeat weekly" batch
 * insert: a DB-level trigger would fail an entire 52-week series atomically
 * over one unrelated future week already being at cap, so this is checked
 * only against the currently-viewed week's already-fetched data.
 */
export const MAX_SLOTS_PER_USER_PER_WEEK = 2;
