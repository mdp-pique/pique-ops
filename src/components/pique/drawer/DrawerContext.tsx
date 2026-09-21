"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Panel = { kind: "res" | "ticket"; id: string };

interface DrawerState {
  panel: Panel | null;
  openRes: (id: string) => void;
  openTicket: (id: string) => void;
  close: () => void;
}

const DrawerCtx = createContext<DrawerState | null>(null);

export function useDrawer(): DrawerState {
  const ctx = useContext(DrawerCtx);
  if (!ctx) throw new Error("useDrawer must be used inside DrawerProvider");
  return ctx;
}

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Seed the initial panel from the URL once, on mount (deep links) - a lazy
  // initializer, not an effect, since this is first-render state derivation.
  const [panel, setPanel] = useState<Panel | null>(() => {
    const ticket = searchParams.get("ticket");
    const res = searchParams.get("res");
    if (ticket) return { kind: "ticket", id: ticket };
    if (res) return { kind: "res", id: res };
    return null;
  });

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("res");
    params.delete("ticket");
    if (panel) params.set(panel.kind, panel.id);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  const openRes = useCallback((id: string) => setPanel({ kind: "res", id }), []);
  const openTicket = useCallback((id: string) => setPanel({ kind: "ticket", id }), []);
  const close = useCallback(() => setPanel(null), []);

  return <DrawerCtx.Provider value={{ panel, openRes, openTicket, close }}>{children}</DrawerCtx.Provider>;
}
