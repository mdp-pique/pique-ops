"use client";

import type { DomainKey } from "@/lib/pique-ui/domains";
import { useDrawer } from "./drawer/DrawerContext";

export function NewTicketButton({ domain }: { domain?: DomainKey }) {
  const { openNew } = useDrawer();
  return (
    <button className="btn primary new-ticket" onClick={() => openNew({ domain })}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
      New ticket
    </button>
  );
}
