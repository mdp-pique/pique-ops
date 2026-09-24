"use client";

import { useFormStatus } from "react-dom";

/** Disables itself while its form's server action runs, so a double-click can't submit twice. */
export function SubmitButton({ children, pendingText, className }: { children: React.ReactNode; pendingText?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={className}>
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}
