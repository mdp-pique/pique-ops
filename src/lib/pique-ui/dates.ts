export type Bucket = "past" | "current" | "future";

/** "Today" in the property's operating timezone (America/Edmonton), as YYYY-MM-DD - matches the plain `date` type of check_in/check_out. */
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton" }).format(new Date());
}

export function bucketFor(checkIn: string, checkOut: string, today = todayLocal()): Bucket {
  if (checkIn > today) return "future";
  if (checkOut <= today) return "past";
  return "current";
}

/** Finer-grained lifecycle stage for the Reservations screen's top-level filter - splits the old "current" bucket into arriving-today, in-stay, and departing-today, and keeps historical checkouts separate from today's. */
export type ReservationStage = "booked" | "checkingin" | "staying" | "checkingout" | "checkedout";

/** Which of book/checkin/stay/checkout is "now" for a current-bucket reservation. */
export function currentStageIndex(checkIn: string, checkOut: string, today = todayLocal()): number {
  if (today === checkIn) return 1; // checkin
  if (today === checkOut) return 3; // checkout
  return 2; // stay
}

export function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** A property-local (America/Edmonton) date + hour as a UTC ISO timestamp, DST-correct for that date. */
export function edmontonDateTimeToISO(isoDate: string, hour = 12): string {
  const guess = new Date(`${isoDate}T${String(hour).padStart(2, "0")}:00:00Z`);
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "America/Edmonton", timeZoneName: "shortOffset" })
    .formatToParts(guess)
    .find((p) => p.type === "timeZoneName")?.value; // e.g. "GMT-6"
  const offsetHours = Number(tz?.replace("GMT", "") || 0);
  return new Date(guess.getTime() - offsetHours * 3600_000).toISOString();
}
