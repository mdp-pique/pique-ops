"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { DOMAINS, type DomainKey } from "@/lib/pique-ui/domains";

const NAV = [
  {
    href: "/",
    label: "Dashboard",
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="9" rx="2" />
        <rect x="14" y="3" width="7" height="5" rx="2" />
        <rect x="14" y="12" width="7" height="9" rx="2" />
        <rect x="3" y="16" width="7" height="5" rx="2" />
      </svg>
    ),
  },
  {
    href: "/reservations",
    label: "Reservations",
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="5" width="18" height="16" rx="4" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    href: "/calendar",
    label: "Calendar",
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="17" rx="3" />
        <path d="M3 9h18M8 2v4M16 2v4" />
        <path d="M7.5 13h.01M12 13h.01M16.5 13h.01M7.5 17h.01M12 17h.01" strokeWidth="2.6" />
      </svg>
    ),
  },
  {
    href: "/properties",
    label: "Properties",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
      </svg>
    ),
  },
  {
    href: "/inbox",
    label: "Inbox",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 5h16v10H9l-5 4z" />
      </svg>
    ),
  },
];

const TICKETS_ICON = (
  <svg viewBox="0 0 24 24">
    <path d="M4 6h16M4 12h10M4 18h7" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

const MOBILE_QUERY = "(max-width: 760px)";
function subscribeMobile(cb: () => void) {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function NavLink({ item, pathname }: { item: (typeof NAV)[number]; pathname: string }) {
  const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
  return (
    <Link href={item.href} aria-current={isActive ? "page" : undefined}>
      {item.icon}
      {item.label}
    </Link>
  );
}

/**
 * Tickets opens on tap/click, never hover-only: hover doesn't exist on the
 * phones the team uses, and hover-only menus fail WCAG 2.1.1 / 1.4.13.
 * Desktop: expands inline and stays open inside any section. Phone (bottom
 * bar): pops up above the bar and closes after navigating.
 */
function TicketsNav({ pathname, counts }: { pathname: string; counts: Record<DomainKey, number> }) {
  const inTickets = pathname.startsWith("/tickets");
  const isMobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia(MOBILE_QUERY).matches, () => false);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setUserOpen(null);
  }
  const expanded = isMobile ? userOpen === true : (userOpen ?? inTickets);
  const total = DOMAINS.reduce((n, d) => n + (counts[d.key] ?? 0), 0);

  useEffect(() => {
    if (!isMobile || !expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setUserOpen(false);
    const onClick = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".nav-group")) setUserOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [isMobile, expanded]);

  return (
    <div className={`nav-group ${expanded ? "expanded" : ""}`}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="nav-tickets"
        aria-current={inTickets ? "page" : undefined}
        onClick={() => setUserOpen(!expanded)}
      >
        {TICKETS_ICON}
        <span className="nav-label">
          Tickets
          {total > 0 && <span className="nav-badge num">{total}</span>}
        </span>
      </button>
      <ul id="nav-tickets" className="subnav">
        {DOMAINS.map((d) => {
          const href = `/tickets/${d.key}`;
          return (
            <li key={d.key}>
              <Link href={href} aria-current={pathname.startsWith(href) ? "page" : undefined}>
                <span>{d.label}</span>
                <span className="cnt num">{counts[d.key] ?? 0}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Rail({ initials, ticketCounts }: { initials: string; ticketCounts: Record<DomainKey, number> }) {
  const pathname = usePathname();

  return (
    <aside className="rail">
      <Link href="/" className="logo" aria-label="Pique Properties">
        <Image src="/pique-logo.png" alt="" width={44} height={44} priority />
      </Link>
      <nav className="nav" aria-label="Sections">
        {NAV.slice(0, 3).map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
        <TicketsNav pathname={pathname} counts={ticketCounts} />
        {NAV.slice(3).map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>
      <div className="spacer" />
      <Link href="/admin/users" className="me" title="Team & account">
        {initials}
      </Link>
    </aside>
  );
}
