/**
 * App-wide configuration constants.
 *
 * The office location is the "configurable constant" from the spec. It is also
 * mirrored in the Go geolocation function (api-go/internal/geo/geo.go); keep the
 * two in sync, or set OFFICE_LATITUDE / OFFICE_LONGITUDE in the environment so
 * both read the same values.
 */
export const OFFICE_LOCATION = {
  latitude: Number(process.env.OFFICE_LATITUDE ?? 37.8679),
  longitude: Number(process.env.OFFICE_LONGITUDE ?? -122.25548),
} as const;

/** A geolocation check-in is only accepted within this radius of the office. */
export const CHECK_IN_RADIUS_MILES = 2;

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
