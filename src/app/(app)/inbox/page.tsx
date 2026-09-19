import { TopBar } from "@/components/pique/TopBar";
import { InboxRow } from "@/components/pique/InboxRow";
import { getInboxRows } from "@/lib/data/inbox";

export default async function InboxPage() {
  const rows = await getInboxRows();

  return (
    <>
      <TopBar title="Inbox" subtitle="Guest messages, with the reservation one tap away." />
      <div className="list">
        {rows.length === 0 && <div className="card">No recent messages.</div>}
        {rows.map((row) => (
          <InboxRow key={row.reservationId} row={row} />
        ))}
      </div>
      <p className="footer-note">
        Messages sync from Hospitable. Calls and voicemail (GoHighLevel) aren&apos;t wired up yet.
      </p>
    </>
  );
}
