"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

export const ASK_PIQUE_FOCUS_EVENT = "askpique:focus";
const PENDING_FOCUS_KEY = "pique:ask-focus-pending";

export function AskPiqueHotkey() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();

      if (pathname === "/") {
        window.dispatchEvent(new Event(ASK_PIQUE_FOCUS_EVENT));
      } else {
        sessionStorage.setItem(PENDING_FOCUS_KEY, "1");
        router.push("/");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pathname, router]);

  return null;
}

export function consumePendingAskFocus(): boolean {
  if (typeof window === "undefined") return false;
  const pending = sessionStorage.getItem(PENDING_FOCUS_KEY);
  if (pending) sessionStorage.removeItem(PENDING_FOCUS_KEY);
  return !!pending;
}
