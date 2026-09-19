import { TopBar } from "@/components/pique/TopBar";
import { Segmented, ChipLink } from "@/components/pique/primitives";
import { ReservationBubble } from "@/components/pique/ReservationBubble";
import { getReservationBucketCounts, getReservationCards } from "@/lib/data/reservations";
import type { ReservationStage } from "@/lib/pique-ui/dates";

const DEFAULT_STAGE: ReservationStage = "staying";

const HINTS: Record<ReservationStage, string> = {
  booked: "Pre-arrival: vetting, ID, pets, pack-n-play, codes.",
  checkingin: "Arriving today - make sure access, messages, and pre-arrival items are clear.",
  staying: "Stay stage: messages, maintenance, access.",
  checkedout: "Accountability stage: reviews, removal cases, claims, cleaner attribution.",
};

const STAGE_LABELS: Record<ReservationStage, string> = {
  booked: "Booked",
  checkingin: "Checking in",
  staying: "Staying",
  checkedout: "Checked out",
};

function parseStage(value: string | undefined): ReservationStage {
  if (value === "booked" || value === "checkingin" || value === "checkedout" || value === "staying") return value;
  return DEFAULT_STAGE;
}

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string; city?: string; attention?: string }>;
}) {
  const sp = await searchParams;
  const stage = parseStage(sp.bucket);

  const [counts, cards] = await Promise.all([getReservationBucketCounts(), getReservationCards(stage)]);

  const cities = [...new Set(cards.map((c) => c.city).filter((c): c is string => !!c))].sort();

  let filtered = cards;
  if (sp.city) filtered = filtered.filter((c) => c.city === sp.city);
  if (sp.attention === "1") filtered = filtered.filter((c) => c.tags.length > 0);

  const paramsWithout = (key: string) => {
    const params = new URLSearchParams();
    if (stage !== DEFAULT_STAGE) params.set("bucket", stage);
    if (sp.city && key !== "city") params.set("city", sp.city);
    if (sp.attention === "1" && key !== "attention") params.set("attention", "1");
    return params;
  };

  return (
    <>
      <TopBar title="Reservations" subtitle={HINTS[stage]} />
      <div className="toolbar">
        <Segmented
          active={stage}
          options={[
            { key: "booked", label: STAGE_LABELS.booked, count: counts.booked },
            { key: "checkingin", label: STAGE_LABELS.checkingin, count: counts.checkingin },
            { key: "staying", label: STAGE_LABELS.staying, count: counts.staying },
            { key: "checkedout", label: STAGE_LABELS.checkedout, count: counts.checkedout },
          ]}
          hrefFor={(key) => {
            const params = paramsWithout("bucket");
            if (key !== DEFAULT_STAGE) params.set("bucket", key);
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
