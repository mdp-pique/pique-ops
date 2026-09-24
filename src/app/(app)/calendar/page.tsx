import { TopBar } from "@/components/pique/TopBar";
import { CalendarView } from "@/components/pique/CalendarView";
import { getCalendarData } from "@/lib/data/calendar";
import { todayLocal } from "@/lib/pique-ui/dates";

function parseStart(value: string | undefined, today: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : today;
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const sp = await searchParams;
  const today = todayLocal();
  const start = parseStart(sp.start, today);
  const data = await getCalendarData(start, today);

  return (
    <>
      <TopBar title="Calendar" subtitle="Everything scheduled across the portfolio. Turn layers on and off to see just what you need." />
      <CalendarView data={data} />
    </>
  );
}
