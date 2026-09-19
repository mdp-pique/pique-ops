"use client";

import type { ReservationCard } from "@/lib/data/reservations";
import { Spine } from "./Spine";
import { StatusPill, Tag } from "./primitives";
import { statusPillFor } from "@/lib/pique-ui/status-pill";
import { worstOf } from "@/lib/pique-ui/mappings";
import { formatShortDate } from "@/lib/pique-ui/dates";
import { useDrawer } from "./drawer/DrawerContext";

function initials(name: string): string {
  return name
    .split(" ")
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ReservationBubble({ card }: { card: ReservationCard }) {
  const { openRes } = useDrawer();
  const worst = worstOf(card.stages);
  const pill = statusPillFor(card.bucket, card.stages);

  return (
    <button className="bubble" data-worst={worst} aria-label={`Open ${card.propertyName}`} onClick={() => openRes(card.id)}>
      <div className="b-head">
        <div>
          <div className="b-prop">{card.propertyName}</div>
          <div className="b-meta">
            {card.city ? `${card.city} · ` : ""}
            {formatShortDate(card.checkIn)} – {formatShortDate(card.checkOut)}
          </div>
        </div>
        <StatusPill variant={pill.variant}>{pill.label}</StatusPill>
      </div>
      <div className="b-guest">
        <span className="avatar">{initials(card.guestName)}</span>
        {card.guestName}
        {card.reviewStars != null && <span className="num"> &middot; {"★".repeat(card.reviewStars)}</span>}
      </div>
      <Spine stages={card.stages} />
      <div className="b-issues">
        {card.tags.length === 0 ? (
          <span className="tag none">Nothing open</span>
        ) : (
          card.tags.map((t) => (
            <Tag key={t.label} cls={t.cls}>
              {t.label}
            </Tag>
          ))
        )}
      </div>
    </button>
  );
}
