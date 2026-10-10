/** Where a signed-out visitor was going; set by src/proxy.ts, read once by /auth/callback. */
export const NEXT_COOKIE = "pique_next";

/** Only a path on this site: never another origin (e.g. "//evil.com" or "/\evil.com"). */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
