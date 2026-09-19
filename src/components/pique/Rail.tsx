"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

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
      <Link href="/" className="logo" aria-label="Pique Properties">
        <Image src="/pique-logo.png" alt="" width={44} height={44} priority />
      </Link>
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
