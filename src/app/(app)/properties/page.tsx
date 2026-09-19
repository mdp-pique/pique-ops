import { TopBar } from "@/components/pique/TopBar";
import { StatusPill, Tag } from "@/components/pique/primitives";
import { getPropertyCards } from "@/lib/data/properties";

export default async function PropertiesPage() {
  const properties = await getPropertyCards();

  return (
    <>
      <TopBar title="Properties" subtitle="Locks, cameras, open items and recent reviews per unit." />
      <div className="grid">
        {properties.map((p) => (
          <div key={p.id} className="bubble" style={{ cursor: "default" }}>
            <div className="b-head">
              <div>
                <div className="b-prop">{p.name}</div>
                <div className="b-meta">{p.city}</div>
              </div>
              <StatusPill variant="neutral">Not connected</StatusPill>
            </div>
            <div className="b-issues">
              {p.openTicketCount > 0 ? (
                <Tag cls="maint">{p.openTicketCount} open</Tag>
              ) : (
                <Tag cls="none">Nothing open</Tag>
              )}
              <Tag cls="msg">Cameras: not connected</Tag>
            </div>
          </div>
        ))}
      </div>
      <p className="footer-note">
        Lock status (Hospitable device API) and camera status (nightly Wyze job) aren&apos;t wired up yet – open
        ticket counts are live.
      </p>
    </>
  );
}
