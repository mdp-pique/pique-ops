import { redirect } from "next/navigation";

// The single Queue was split into domain sections (PRD §7.1). Old links keep working.
const BY_OLD_TYPE: Record<string, string> = {
  review: "/tickets/reviews",
  maint: "/tickets/maintenance",
  claim: "/tickets/claims",
  vet: "/tickets/requests",
  msg: "/inbox",
};

export default async function QueueRedirect({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  redirect((type && BY_OLD_TYPE[type]) || "/tickets/reviews");
}
