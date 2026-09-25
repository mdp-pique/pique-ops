import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { OPEN_STATUSES, ticketTypeLabel, isHiddenTicketType } from "@/lib/pique-ui/mappings";
import { domainForType } from "@/lib/pique-ui/domains";
import { edmontonDateTimeToISO } from "@/lib/pique-ui/dates";
import { ticketTitle } from "@/lib/pique-ui/ticket-display";

// Calendar (PRD §7.9): a read-only view over data the app already has.
// Reservations by day, cleans from Connecteam shifts, and tickets on the day
// they're due. Unfinished tickets from earlier days carry into an Overdue row
// instead of sitting on a past day.

export type LayerKey = "res" | "clean" | "maint" | "cs" | "rev";

export interface CalReservation {
  id: string;
  propertyName: string;
  guestName: string | null;
}

export interface CalClean {
  id: string;
  time: string | null;
  propertyName: string;
  cleaner: string | null;
  // ok | not_clocked_in | no_show | draft | unassigned
  state: string;
}

export interface CalTicket {
  id: string;
  layer: Exclude<LayerKey, "res" | "clean">;
  typeLabel: string;
  // Maintenance shows what's wrong ("Dryer not heating"); other layers read better by type.
  title: string;
  owner: string;
  propertyName: string;
  health: string | null;
  done: boolean;
}

export interface CalDay {
  date: string;
  checkIns: CalReservation[];
  checkOuts: CalReservation[];
  cleans: CalClean[];
  tickets: CalTicket[];
}

export interface OverdueGroup {
  layer: Exclude<LayerKey, "res">;
  typeLabel: string;
  count: number;
  // Where to see all of them: that section's Behind list.
  href: string;
  oldest: { id: string; propertyName: string; dueDate: string }[];
}

export interface CalendarData {
  start: string;
  today: string;
  days: CalDay[];
  overdue: OverdueGroup[];
}

const OVERDUE_SAMPLE = 5;

function layerForType(type: string): CalTicket["layer"] | null {
  const domain = domainForType(type);
  if (domain === "maintenance") return "maint";
  if (domain === "reviews") return "rev";
  if (domain === "requests" || domain === "claims" || type === "unanswered_message" || type === "missed_call") return "cs";
  return null;
}

export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function localDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton" }).format(new Date(iso));
}

function localTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

function propName(p: { property_name: string | null; public_name: string | null } | null | undefined): string {
  return (p?.public_name ?? p?.property_name ?? "Unknown property").replace(/\*+$/, "").trim();
}

type TicketRow = {
  id: string;
  type: string;
  status: string;
  due_at: string | null;
  closed_at: string | null;
  health: string | null;
  metadata: Record<string, unknown> | null;
  assignee: { display_name: string | null } | null;
  team: { name: string } | null;
  property: { property_name: string | null; public_name: string | null } | null;
  reservation: { property: { property_name: string | null; public_name: string | null } | null } | null;
};

const TICKET_SELECT = `id, type, status, due_at, closed_at, health, metadata,
  assignee:profiles!tickets_assignee_id_fkey(display_name),
  team:teams!tickets_assignee_team_id_fkey(name),
  property:properties(property_name, public_name),
  reservation:reservations(property:properties(property_name, public_name))`;

function ticketProp(t: TicketRow): string {
  return propName(t.reservation?.property ?? t.property);
}

export async function getCalendarData(start: string, today: string, numDays = 7): Promise<CalendarData> {
  const supabase = await createClient();
  const end = addDays(start, numDays - 1);
  const dates = Array.from({ length: numDays }, (_, i) => addDays(start, i));
  const fromTs = edmontonDateTimeToISO(start, 0);
  const toTs = edmontonDateTimeToISO(addDays(end, 1), 0);
  const todayTs = edmontonDateTimeToISO(today, 0);
  const open = OPEN_STATUSES as unknown as string[];

  const resSelect = `id, check_in, check_out, property:properties(property_name, public_name), guest:guests(full_name)`;
  const [ins, outs, dueOpen, doneInRange, overdueRows, cleans] = await Promise.all([
    supabase.from("reservations").select(resSelect).eq("status", "accepted").gte("check_in", start).lte("check_in", end),
    supabase.from("reservations").select(resSelect).eq("status", "accepted").gte("check_out", start).lte("check_out", end),
    // Open tickets land on their due day - but only from today on; earlier ones are overdue.
    supabase.from("tickets").select(TICKET_SELECT).in("status", open).gte("due_at", fromTs > todayTs ? fromTs : todayTs).lt("due_at", toTs),
    // Finished tickets stay on the day they were closed.
    supabase.from("tickets").select(TICKET_SELECT).not("status", "in", `(${open.join(",")})`).gte("closed_at", fromTs).lt("closed_at", toTs),
    supabase.from("tickets").select(TICKET_SELECT).in("status", open).lt("due_at", todayTs).order("due_at"),
    getCleans(start, end, today),
  ]);

  const days: CalDay[] = dates.map((date) => ({ date, checkIns: [], checkOuts: [], cleans: [], tickets: [] }));
  const byDate = new Map(days.map((d) => [d.date, d]));

  type ResRow = { id: string; check_in: string; check_out: string; property: { property_name: string | null; public_name: string | null } | null; guest: { full_name: string | null } | null };
  for (const r of (ins.data ?? []) as unknown as ResRow[]) {
    byDate.get(r.check_in)?.checkIns.push({ id: r.id, propertyName: propName(r.property), guestName: r.guest?.full_name ?? null });
  }
  for (const r of (outs.data ?? []) as unknown as ResRow[]) {
    byDate.get(r.check_out)?.checkOuts.push({ id: r.id, propertyName: propName(r.property), guestName: r.guest?.full_name ?? null });
  }
  for (const d of days) {
    d.checkIns.sort((a, b) => a.propertyName.localeCompare(b.propertyName));
    d.checkOuts.sort((a, b) => a.propertyName.localeCompare(b.propertyName));
  }

  const place = (t: TicketRow, at: string | null, done: boolean) => {
    if (!at || isHiddenTicketType(t.type)) return;
    const layer = layerForType(t.type);
    if (!layer) return;
    const owner = t.assignee?.display_name ?? (t.team ? `${t.team.name} team` : "Unassigned");
    byDate.get(localDate(at))?.tickets.push({
      id: t.id,
      layer,
      typeLabel: ticketTypeLabel(t.type),
      title: ticketTitle({ type: t.type, metadata: t.metadata ?? {} }),
      owner,
      propertyName: ticketProp(t),
      health: done ? null : t.health,
      done,
    });
  };
  for (const t of (dueOpen.data ?? []) as unknown as TicketRow[]) place(t, t.due_at, false);
  for (const t of (doneInRange.data ?? []) as unknown as TicketRow[]) place(t, t.closed_at, true);

  for (const c of cleans) byDate.get(c.date)?.cleans.push(c.clean);

  const groups = new Map<string, OverdueGroup>();
  for (const t of (overdueRows.data ?? []) as unknown as TicketRow[]) {
    if (!t.due_at || isHiddenTicketType(t.type)) continue;
    const layer = layerForType(t.type);
    if (!layer) continue;
    const key = `${layer}|${t.type}`;
    const domain = domainForType(t.type);
    const href = domain ? `/tickets/${domain}?type=${t.type}&segment=breached` : "/inbox";
    const g = groups.get(key) ?? { layer, typeLabel: ticketTypeLabel(t.type), count: 0, href, oldest: [] };
    g.count++;
    if (g.oldest.length < OVERDUE_SAMPLE) g.oldest.push({ id: t.id, propertyName: ticketProp(t), dueDate: localDate(t.due_at) });
    groups.set(key, g);
  }

  return { start, today, days, overdue: [...groups.values()] };
}

/**
 * Cleans come from two places:
 * - today and earlier: cleaning_shift_check, the no-show checker's snapshot, which
 *   knows who actually clocked in;
 * - later days: connecteam_shifts, the hourly read-only copy of the Connecteam
 *   schedule (Pique-Connecteam-Shifts-Sync).
 * Both tables are read server-side with the admin client, only for a signed-in team
 * member, returning just what the calendar shows (never shift notes).
 */
async function getCleans(start: string, end: string, today: string): Promise<{ date: string; clean: CalClean }[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (!profile) return [];

  const admin = createAdminClient();
  type Row = { id: string; date: string; start: string | null; jobId: string | null; propertyId: string | null; userIds: string[]; state: string };
  const ids = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

  const [{ data: checked }, { data: scheduled }] = await Promise.all([
    start <= today
      ? admin
          .from("cleaning_shift_check")
          .select("shift_id, check_date, shift_start, connecteam_job_id, assigned_user_ids, flag")
          .gte("check_date", start)
          .lte("check_date", end < today ? end : today)
          .order("shift_start")
      : Promise.resolve({ data: [] as never[] }),
    end > today
      ? admin
          .from("connecteam_shifts")
          .select("shift_id, shift_date, start_at, job_id, property_id, assigned_user_ids, is_published")
          .is("gone_at", null)
          .gt("shift_date", today > start ? today : addDays(start, -1))
          .lte("shift_date", end)
          .order("start_at")
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const rows: Row[] = [
    ...(checked ?? []).map((s) => {
      let state = s.flag ?? "ok";
      if (state === "no_show" && s.check_date >= today) state = "not_clocked_in";
      return { id: s.shift_id, date: s.check_date, start: s.shift_start, jobId: s.connecteam_job_id, propertyId: null, userIds: ids(s.assigned_user_ids), state };
    }),
    // Upcoming shifts start as unpublished open shifts until a coordinator publishes
    // them - normal, so "open" is shown without a warning.
    ...(scheduled ?? []).map((s) => ({
      id: s.shift_id,
      date: s.shift_date ?? "",
      start: s.start_at,
      jobId: s.job_id,
      propertyId: s.property_id,
      userIds: ids(s.assigned_user_ids),
      state: ids(s.assigned_user_ids).length ? "ok" : "open",
    })),
  ];
  if (!rows.length) return [];

  const jobIds = [...new Set(rows.map((r) => r.jobId).filter((x): x is string => !!x))];
  const userIds = [...new Set(rows.map((r) => r.userIds[0]).filter((x): x is string => !!x))];

  const [{ data: jobs }, { data: users }] = await Promise.all([
    jobIds.length
      ? admin.from("cleaning_job_map").select("connecteam_job_id, property_id, property_name").in("connecteam_job_id", jobIds)
      : Promise.resolve({ data: [] as { connecteam_job_id: string; property_id: string | null; property_name: string | null }[] }),
    userIds.length ? admin.from("connecteam_users").select("user_id, first_name").in("user_id", userIds.map(Number)) : Promise.resolve({ data: [] as never[] }),
  ]);
  const propIds = [...new Set([...(jobs ?? []).map((j) => j.property_id), ...rows.map((r) => r.propertyId)].filter((x): x is string => !!x))];
  const { data: props } = propIds.length
    ? await supabase.from("properties").select("id, property_name, public_name").in("id", propIds)
    : { data: [] as { id: string; property_name: string | null; public_name: string | null }[] };
  const propById = new Map((props ?? []).map((p) => [p.id, propName(p)]));
  const jobName = new Map(
    (jobs ?? []).map((j) => [
      j.connecteam_job_id,
      (j.property_id && propById.get(j.property_id)) || (j.property_name ?? "Unmatched Connecteam job").replace(/\*+$/, "").trim(),
    ]),
  );
  const userName = new Map((users ?? []).map((u) => [String(u.user_id), u.first_name]));

  return rows.map((r) => ({
    date: r.date,
    clean: {
      id: r.id,
      time: localTime(r.start),
      propertyName: (r.propertyId && propById.get(r.propertyId)) || (r.jobId && jobName.get(r.jobId)) || "Unknown property",
      cleaner: r.userIds[0] ? (userName.get(r.userIds[0]) ?? null) : null,
      state: r.state,
    },
  }));
}
