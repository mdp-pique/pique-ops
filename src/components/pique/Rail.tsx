"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  {
    href: "/",
    label: "Today",
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
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
    href: "/queue",
    label: "Queue",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 6h16M4 12h10M4 18h7" />
        <circle cx="18" cy="16" r="3" />
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

export function Rail({ initials }: { initials: string }) {
  const pathname = usePathname();

  return (
    <aside className="rail">
      <div className="logo">P</div>
      <nav className="nav" aria-label="Sections">
        {NAV.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} aria-current={isActive ? "page" : undefined}>
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="spacer" />
      <Link href="/admin/users" className="me" title="Team & account">
        {initials}
      </Link>
    </aside>
  );
}
