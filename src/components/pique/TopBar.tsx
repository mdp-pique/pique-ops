import { NewTicketButton } from "./NewTicketButton";
import type { DomainKey } from "@/lib/pique-ui/domains";

export function TopBar({ title, subtitle, newTicketDomain }: { title: string; subtitle: string; newTicketDomain?: DomainKey }) {
  return (
    <div className="topbar">
      <div>
        <h1>{title}</h1>
        <div className="sub">{subtitle}</div>
      </div>
      <div className="topbar-actions">
        <NewTicketButton domain={newTicketDomain} />
        <label className="search">
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input placeholder="Search guest, property, ticket…" aria-label="Search" />
        </label>
      </div>
    </div>
  );
}
