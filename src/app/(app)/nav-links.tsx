"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={`text-xs ${isActive ? "font-medium text-white" : "text-gray-400 hover:text-white"}`}
    >
      {children}
    </Link>
  );
}

export function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  return (
    <>
      <NavLink href="/reservations">Reservations</NavLink>
      {isAdmin && <NavLink href="/admin/users">Team</NavLink>}
    </>
  );
}
