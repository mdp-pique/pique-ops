import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function ReservationsSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  let results: {
    id: string;
    confirmation_code: string | null;
    check_in: string;
    check_out: string;
    status: string | null;
    property: { property_name: string | null; public_name: string | null } | null;
    guest: { full_name: string | null } | null;
  }[] = [];

  if (q && q.trim().length > 1) {
    const { data } = await supabase
      .from("reservations")
      .select(
        `id, confirmation_code, check_in, check_out, status,
         property:properties(property_name, public_name),
         guest:guests(full_name)`
      )
      .or(`confirmation_code.ilike.%${q}%`)
      .order("check_in", { ascending: false })
      .limit(25);
    results = data ?? [];

    if (results.length === 0) {
      const { data: byGuest } = await supabase
        .from("reservations")
        .select(
          `id, confirmation_code, check_in, check_out, status,
           property:properties(property_name, public_name),
           guest:guests!inner(full_name)`
        )
        .ilike("guest.full_name", `%${q}%`)
        .order("check_in", { ascending: false })
        .limit(25);
      results = byGuest ?? [];
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-4 text-lg font-semibold">Reservations</h1>
      <form className="mb-6 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Confirmation code or guest name…"
          className="flex-1 rounded border border-gray-700 bg-black px-3 py-2 text-sm"
        />
        <button className="rounded border border-gray-700 px-4 py-2 text-sm hover:bg-gray-900">Search</button>
      </form>

      {q && results.length === 0 && <p className="text-sm text-gray-500">No matches for &quot;{q}&quot;.</p>}

      <ul className="space-y-2">
        {results.map((r) => (
          <li key={r.id}>
            <Link
              href={`/reservations/${r.id}`}
              className="flex items-center justify-between rounded border border-gray-800 p-3 text-sm hover:bg-gray-900"
            >
              <span>
                {r.guest?.full_name ?? "Unknown guest"} ·{" "}
                {r.property?.public_name ?? r.property?.property_name ?? "Unknown property"}
              </span>
              <span className="text-gray-500">
                {r.check_in} → {r.check_out} · {r.confirmation_code ?? "no code"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
