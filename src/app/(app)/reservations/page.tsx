import { TopBar } from "@/components/pique/TopBar";
import { Segmented, ChipLink } from "@/components/pique/primitives";
import { ReservationBubble } from "@/components/pique/ReservationBubble";
import { getReservationBucketCounts, getReservationCards } from "@/lib/data/reservations";
import type { Bucket } from "@/lib/pique-ui/dates";

const HINTS: Record<Bucket, string> = {
  past: "Accountability stage: reviews, removal cases, claims, cleaner attribution.",
  current: "Stay stage: messages, maintenance, access.",
  future: "Pre-arrival: vetting, ID, pets, pack-n-play, codes.",
};

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string; city?: string; attention?: string }>;
}) {
  const sp = await searchParams;
  const bucket: Bucket = sp.bucket === "past" || sp.bucket === "future" ? sp.bucket : "current";

  const [counts, cards] = await Promise.all([getReservationBucketCounts(), getReservationCards(bucket)]);

  const cities = [...new Set(cards.map((c) => c.city).filter((c): c is string => !!c))].sort();

  let filtered = cards;
  if (sp.city) filtered = filtered.filter((c) => c.city === sp.city);
  if (sp.attention === "1") filtered = filtered.filter((c) => c.tags.length > 0);

  const paramsWithout = (key: string) => {
    const params = new URLSearchParams();
    if (bucket !== "current") params.set("bucket", bucket);
    if (sp.city && key !== "city") params.set("city", sp.city);
    if (sp.attention === "1" && key !== "attention") params.set("attention", "1");
    return params;
  };

  return (
    <>
      <TopBar title="Reservations" subtitle={HINTS[bucket]} />
      <div className="toolbar">
        <Segmented
          active={bucket}
          options={[
            { key: "past", label: "Past", count: counts.past },
            { key: "current", label: "Current", count: counts.current },
            { key: "future", label: "Future", count: counts.future },
          ]}
          hrefFor={(key) => {
            const params = paramsWithout("bucket");
            if (key !== "current") params.set("bucket", key);
            const qs = params.toString();
            return qs ? `/reservations?${qs}` : "/reservations";
          }}
        />
        <div className="chips">
          <ChipLink
            href={(() => {
              const params = paramsWithout("attention");
              if (sp.attention !== "1") params.set("attention", "1");
              const qs = params.toString();
              return qs ? `/reservations?${qs}` : "/reservations";
            })()}
            active={sp.attention === "1"}
          >
            <span className="dot" style={{ color: "var(--warn)" }} />
            Needs attention
          </ChipLink>
          {cities.map((city) => (
            <ChipLink
              key={city}
              href={(() => {
                const params = paramsWithout("city");
                if (sp.city !== city) params.set("city", city);
                const qs = params.toString();
                return qs ? `/reservations?${qs}` : "/reservations";
              })()}
              active={sp.city === city}
            >
              {city}
            </ChipLink>
          ))}
        </div>
      </div>
      <div className="grid">
        {filtered.map((card) => (
          <ReservationBubble key={card.id} card={card} />
        ))}
        {filtered.length === 0 && <div className="card">No reservations match this view.</div>}
      </div>
    </>
  );
}
