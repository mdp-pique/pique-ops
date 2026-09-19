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

/** Finer-grained lifecycle stage for the Reservations screen's top-level filter - splits the old "current" bucket into arriving-today vs already-in-stay. */
export type ReservationStage = "booked" | "checkingin" | "staying" | "checkedout";

export function reservationStageFor(checkIn: string, checkOut: string, today = todayLocal()): ReservationStage {
  if (checkIn > today) return "booked";
  if (checkIn === today) return "checkingin";
  if (checkOut <= today) return "checkedout";
  return "staying";
}

/** Which of book/checkin/stay/checkout is "now" for a current-bucket reservation. */
export function currentStageIndex(checkIn: string, checkOut: string, today = todayLocal()): number {
  if (today === checkIn) return 1; // checkin
  if (today === checkOut) return 3; // checkout
  return 2; // stay
}

export function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
