import { NewTicketButton } from "./NewTicketButton";
import { SearchBox } from "./SearchBox";
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
        <SearchBox />
      </div>
    </div>
  );
}
