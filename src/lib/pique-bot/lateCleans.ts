import { createAdminClient } from "@/lib/supabase/admin";
import { CUSTOMER_SERVICE, mention } from "./config";
import { edmontonToday } from "./data";
import { redrawForTicket } from "./posts";
import { slackApi } from "./slack";

type Admin = ReturnType<typeof createAdminClient>;

/** One clock-in on Connecteam's time clock, as n8n Pique-Cleaning-Clock sends it (unix seconds). */
export type ClockActivity = { userId: number; jobId?: string | null; schedulerShiftId?: string | null; start: number; end?: number | null };

export const LATE_CLEAN_TYPE = "clean_running_late";

const TZ = "America/Edmonton";
/** Check-in is 4 PM at every property (MDP 10-13). */
const CHECK_IN_MIN = 16 * 60;
/** The "likely late" warning starts at 2:30 PM (MDP / Katrina 10-13). */
const WARN_FROM_MIN = 14 * 60 + 30;
/** Nothing new after 8 PM; the day's leftovers close the next day. */
const STOP_AFTER_MIN = 20 * 60;
/** When a property has fewer cleans on record than this, use DEFAULT_MINUTES. */
const MIN_SAMPLES = 3;
const DEFAULT_MINUTES = 270;
const HISTORY_DAYS = 60;

const OPEN = ["open", "in_progress", "blocked"];

function localDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

function localMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** The instant of a local (Edmonton) wall-clock time on a date, DST-safe. */
function localInstant(date: string, minutes: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess - (wall - guess));
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Saves the day's clock-ins (one row per cleaner per clock-in) with the property they were for:
 * the scheduled shift's property first, else the Connecteam job's. For the dates sent, clock-ins
 * no longer in Connecteam (edited or deleted there) are removed, so an edited clock-in can't stay
 * "open" forever.
 */
async function saveSessions(admin: Admin, acts: ClockActivity[], dates: string[], now: Date) {
  const valid = acts.filter((a) => Number.isFinite(a.start) && a.start > 0);
  const shiftIds = [...new Set(valid.map((a) => a.schedulerShiftId).filter((s): s is string => !!s))];
  const jobIds = [...new Set(valid.map((a) => a.jobId).filter((j): j is string => !!j))];
  const [{ data: shifts }, { data: jobs }] = await Promise.all([
    shiftIds.length ? admin.from("connecteam_shifts").select("shift_id, property_id").in("shift_id", shiftIds) : Promise.resolve({ data: [] }),
    jobIds.length ? admin.from("cleaning_job_map").select("connecteam_job_id, property_id").in("connecteam_job_id", jobIds) : Promise.resolve({ data: [] }),
  ]);
  const byShift = new Map((shifts ?? []).filter((s) => s.property_id).map((s) => [s.shift_id, s.property_id as string]));
  const byJob = new Map((jobs ?? []).filter((j) => j.property_id).map((j) => [j.connecteam_job_id, j.property_id as string]));

  const rows = valid.map((a) => {
    const started = new Date(a.start * 1000);
    return {
      user_id: a.userId,
      started_at: started.toISOString(),
      ended_at: a.end ? new Date(a.end * 1000).toISOString() : null,
      job_id: a.jobId ?? null,
      scheduler_shift_id: a.schedulerShiftId ?? null,
      property_id: (a.schedulerShiftId && byShift.get(a.schedulerShiftId)) || (a.jobId && byJob.get(a.jobId)) || null,
      work_date: localDate(started),
      last_synced_at: now.toISOString(),
    };
  });
  if (rows.length) {
    const { error } = await admin.from("cleaning_clock_sessions").upsert(rows, { onConflict: "user_id,started_at" });
    if (error) throw new Error(`saving clock-ins failed: ${error.message}`);
  }

  // Clock-ins that disappeared from Connecteam for the dates we were sent.
  if (dates.length) {
    const keep = new Set(rows.map((r) => `${r.user_id}|${new Date(r.started_at).getTime()}`));
    const { data: existing } = await admin.from("cleaning_clock_sessions").select("user_id, started_at").in("work_date", dates);
    for (const e of existing ?? []) {
      if (!keep.has(`${e.user_id}|${new Date(e.started_at).getTime()}`)) {
        await admin.from("cleaning_clock_sessions").delete().eq("user_id", e.user_id).eq("started_at", e.started_at);
      }
    }
  }
  return rows.length;
}

type Session = { user_id: number; started_at: string; ended_at: string | null; property_id: string | null };
type State = "on_track" | "at_risk" | "still_working" | "finished" | "no_clock_in";

/**
 * Late-clean alerts (MDP 10-13). On a turnover day (a guest checks out and another checks in at
 * 4 PM at the same property), from 2:30 PM: a cleaner still clocked in whose usual time for that
 * property puts them past 4 PM opens a clean_running_late ticket, which Pique-a-choo posts in
 * #cleaning-health-check tagging @customerservice (rule clean_running_late). At 4 PM, still clocked
 * in: one thread reply tagging @customerservice again and the ticket goes urgent. Clocking out
 * resolves it (with a thread reply). Turnovers with no clock-in at all are left to the existing
 * 11 AM / noon no-show check, since about half the cleans aren't on the time clock.
 */
export async function runLateCleans(admin: Admin, opts: { activities: ClockActivity[]; dates: string[]; dry: boolean; now?: Date }) {
  const now = opts.now ?? new Date();
  const today = edmontonToday(now);
  const minutes = localMinutes(now);
  const results: Record<string, unknown>[] = [];

  // Saved even on a dry run: it is only a copy of the time clock, and lets a dry run show what it would flag.
  const saved = await saveSessions(admin, opts.activities, opts.dates, now);

  // Yesterday's leftovers (e.g. a cleaner who never clocked out): closed the next day.
  const { data: stale } = await admin.from("tickets").select("id, metadata").eq("type", LATE_CLEAN_TYPE).in("status", OPEN);
  for (const t of stale ?? []) {
    const day = (t.metadata as Record<string, unknown> | null)?.day;
    if (typeof day !== "string" || day >= today) continue;
    results.push({ ticket: t.id, closed: "next day" });
    if (opts.dry) continue;
    await admin.from("tickets").update({ status: "resolved", closed_at: now.toISOString() }).eq("id", t.id);
    await admin.from("ticket_events").insert({
      ticket_id: t.id, event_type: "status_change", to_value: "resolved",
      note: "Closed automatically the next day", payload: { source: "pique_bot", kind: LATE_CLEAN_TYPE },
    });
    await redrawForTicket(admin, t.id);
  }

  if (minutes < WARN_FROM_MIN || minutes > STOP_AFTER_MIN) return { saved, today, evaluated: false, results };

  // Turnovers today: an accepted checkout and an accepted check-in at the same property.
  const { data: departures } = await admin.from("reservations").select("property_id").eq("status", "accepted").eq("check_out", today);
  const departing = [...new Set((departures ?? []).map((r) => r.property_id).filter((p): p is string => !!p))];
  if (!departing.length) return { saved, today, evaluated: true, turnovers: 0, results };
  const { data: arrivals } = await admin
    .from("reservations")
    .select("id, property_id, guest_id")
    .eq("status", "accepted")
    .eq("check_in", today)
    .in("property_id", departing);
  const arrivingBy = new Map((arrivals ?? []).map((r) => [r.property_id as string, r]));
  const turnovers = [...arrivingBy.keys()];
  if (!turnovers.length) return { saved, today, evaluated: true, turnovers: 0, results };

  const guestIds = [...new Set((arrivals ?? []).map((r) => r.guest_id).filter((g): g is string => !!g))];
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [{ data: guests }, { data: props }, { data: todays }, { data: history }, { data: tickets }] = await Promise.all([
    guestIds.length ? admin.from("guests").select("id, full_name").in("id", guestIds) : Promise.resolve({ data: [] }),
    admin.from("properties").select("id, property_name, public_name").in("id", turnovers),
    admin.from("cleaning_clock_sessions").select("user_id, started_at, ended_at, property_id").eq("work_date", today).in("property_id", turnovers),
    admin
      .from("cleaning_clock_sessions")
      .select("property_id, started_at, ended_at")
      .in("property_id", turnovers)
      .gte("work_date", since)
      .lt("work_date", today)
      .not("ended_at", "is", null),
    admin.from("tickets").select("id, status, priority, metadata, external_ref").in("external_ref", turnovers.map((p) => `late_clean:${p}:${today}`)),
  ]);
  const guestName = new Map((guests ?? []).map((g) => [g.id, g.full_name as string | null]));
  const unitName = new Map((props ?? []).map((p) => [p.id, (p.property_name || p.public_name || "the unit").replace(/\*+$/, "").trim()]));
  const ticketByRef = new Map((tickets ?? []).map((t) => [t.external_ref as string, t]));

  const userIds = [...new Set((todays ?? []).map((s) => s.user_id))];
  const { data: users } = userIds.length ? await admin.from("connecteam_users").select("user_id, full_name").in("user_id", userIds) : { data: [] };
  const userName = new Map((users ?? []).map((u) => [Number(u.user_id), (u.full_name ?? "").replace(/\s+/g, " ").trim()]));

  const checkIn = localInstant(today, CHECK_IN_MIN);
  for (const propertyId of turnovers) {
    const sessions = ((todays ?? []) as Session[]).filter((s) => s.property_id === propertyId);
    const durations = (history ?? [])
      .filter((h) => h.property_id === propertyId && h.ended_at)
      .map((h) => (new Date(h.ended_at as string).getTime() - new Date(h.started_at).getTime()) / 60_000)
      .filter((m) => m >= 30 && m <= 720);
    const typical = durations.length >= MIN_SAMPLES ? Math.round(median(durations)) : DEFAULT_MINUTES;

    const open = sessions.filter((s) => !s.ended_at);
    let state: State;
    let expected: Date | null = null;
    if (!sessions.length) state = "no_clock_in";
    else if (open.length) {
      const earliest = Math.min(...open.map((s) => new Date(s.started_at).getTime()));
      expected = new Date(earliest + typical * 60_000);
      state = minutes >= CHECK_IN_MIN ? "still_working" : expected > checkIn ? "at_risk" : "on_track";
    } else state = "finished";

    const working = open.length ? open : sessions;
    const cleaners = [...new Set(working.map((s) => userName.get(Number(s.user_id)) || "The cleaner"))];
    const clockedIn = working.length ? new Date(Math.min(...working.map((s) => new Date(s.started_at).getTime()))).toISOString() : null;
    const finishedAt = state === "finished" ? new Date(Math.max(...sessions.map((s) => new Date(s.ended_at as string).getTime()))).toISOString() : null;
    const arrival = arrivingBy.get(propertyId)!;
    const unit = unitName.get(propertyId) ?? "the unit";
    const guest = arrival.guest_id ? (guestName.get(arrival.guest_id) ?? null) : null;
    const ref = `late_clean:${propertyId}:${today}`;
    const existing = ticketByRef.get(ref);
    const prev = (existing?.metadata ?? {}) as Record<string, unknown>;
    const metadata = {
      ...prev,
      day: today,
      unit,
      state,
      cleaners,
      clocked_in: clockedIn,
      typical_minutes: typical,
      typical_samples: durations.length,
      expected_finish: expected?.toISOString() ?? null,
      finished_at: finishedAt,
    };
    const result: Record<string, unknown> = { property: unit, state, cleaners, typical, expected: expected?.toISOString() ?? null };
    results.push(result);
    if (opts.dry) continue;

    if (!existing) {
      if (state !== "at_risk" && state !== "still_working") continue;
      const { data: created, error } = await admin
        .from("tickets")
        .upsert(
          {
            type: LATE_CLEAN_TYPE,
            status: "open",
            priority: state === "still_working" ? "urgent" : "high",
            source: "automation",
            stage: "turnover",
            property_id: propertyId,
            reservation_id: arrival.id,
            guest_name: guest,
            external_ref: ref,
            due_at: checkIn.toISOString(),
            // Opened at or after 4 PM: the post itself already says "still clocked in" and tags @customerservice.
            metadata: { ...metadata, escalated_at: state === "still_working" ? now.toISOString() : null },
          },
          { onConflict: "external_ref", ignoreDuplicates: true },
        )
        .select("id")
        .maybeSingle();
      if (error || !created) {
        result.error = error?.message ?? "not created";
        continue;
      }
      await admin.from("ticket_items").insert([
        { ticket_id: created.id, label: "Checked in with the cleaner", sort_order: 0 },
        { ticket_id: created.id, label: "Guest updated if needed", sort_order: 1 },
      ]);
      await admin.from("ticket_events").insert({
        ticket_id: created.id, event_type: "status_change", to_value: "open",
        note: `${cleaners.join(", ")} clocked in ${clockedIn ? clock(clockedIn) : ""}; ${unit} usually takes ${Math.round(typical / 6) / 10} h`,
        payload: { source: "pique_bot", kind: LATE_CLEAN_TYPE, state },
      });
      result.ticket = created.id;
      continue;
    }

    if (!OPEN.includes(existing.status)) continue;
    result.ticket = existing.id;
    const changed = prev.state !== state;
    if (changed || prev.expected_finish !== metadata.expected_finish) {
      await admin.from("tickets").update({ metadata }).eq("id", existing.id);
    }

    const post = await alertPost(admin, existing.id);
    if (state === "finished") {
      await admin.from("tickets").update({ status: "resolved", closed_at: now.toISOString() }).eq("id", existing.id);
      await admin.from("ticket_events").insert({
        ticket_id: existing.id, event_type: "status_change", to_value: "resolved",
        note: `Clocked out at ${clock(finishedAt as string)}`, payload: { source: "pique_bot", kind: LATE_CLEAN_TYPE },
      });
      if (post) await reply(post, `:white_check_mark: ${cleaners.join(" and ")} clocked out at ${clock(finishedAt as string)}.`, result);
      await redrawForTicket(admin, existing.id);
      result.resolved = true;
      continue;
    }
    if (state === "still_working" && !prev.escalated_at) {
      // Wait for the alerts run to post it first; the reply goes in its thread.
      if (!post) continue;
      const who = cleaners.length > 1 ? `${cleaners.join(" and ")} are` : `${cleaners[0]} is`;
      const ok = await reply(
        post,
        `:rotating_light: ${mention(CUSTOMER_SERVICE)} It's 4 PM and ${who} still clocked in at *${unit}*.${guest ? ` ${guest} checks in now -` : ""} please give the guest a heads-up.`,
        result,
      );
      if (ok) {
        await admin.from("tickets").update({ priority: "urgent", metadata: { ...metadata, escalated_at: now.toISOString() } }).eq("id", existing.id);
        result.escalated = true;
      }
    }
    if (changed) await redrawForTicket(admin, existing.id);
  }
  return { saved, today, evaluated: true, turnovers: turnovers.length, results };
}

async function alertPost(admin: Admin, ticketId: string): Promise<{ channel: string; ts: string } | null> {
  const { data } = await admin
    .from("pique_bot_posts")
    .select("channel_id, slack_ts")
    .eq("kind", "alert")
    .contains("ticket_ids", [ticketId])
    .not("slack_ts", "is", null)
    .limit(1)
    .maybeSingle();
  return data?.slack_ts ? { channel: data.channel_id, ts: data.slack_ts } : null;
}

async function reply(post: { channel: string; ts: string }, text: string, result: Record<string, unknown>): Promise<boolean> {
  const sent = await slackApi("chat.postMessage", { channel: post.channel, thread_ts: post.ts, text, unfurl_links: false });
  if (!sent.ok) result.error = sent.error ?? "reply failed";
  return sent.ok;
}
