import { createClient } from "@/lib/supabase/server";
import { OPEN_STATUSES, isHiddenTicketType } from "@/lib/pique-ui/mappings";

export interface PropertyCard {
  id: string;
  name: string;
  city: string | null;
  openTicketCount: number;
}

export async function getPropertyCards(): Promise<PropertyCard[]> {
  const supabase = await createClient();

  const [{ data: properties, error }, { data: openTickets }] = await Promise.all([
    supabase.from("properties").select("id, property_name, public_name, city").eq("is_active", true).order("property_name"),
    supabase.from("tickets").select("property_id, type").in("status", OPEN_STATUSES as unknown as string[]).not("property_id", "is", null),
  ]);

  if (error) {
    console.error("getPropertyCards:", error);
    return [];
  }

  const countByProperty = new Map<string, number>();
  for (const t of openTickets ?? []) {
    if (!t.property_id || isHiddenTicketType(t.type)) continue;
    countByProperty.set(t.property_id, (countByProperty.get(t.property_id) ?? 0) + 1);
  }

  return (properties ?? []).map((p) => ({
    id: p.id,
    name: p.public_name ?? p.property_name,
    city: p.city,
    openTicketCount: countByProperty.get(p.id) ?? 0,
  }));
}
