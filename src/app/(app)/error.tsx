"use client";

import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="card" role="alert" style={{ maxWidth: 520, margin: "48px auto" }}>
      <h3>Something went wrong</h3>
      <p style={{ margin: "0 0 14px", color: "var(--ink-2)", fontSize: 13.5 }}>
        That action didn&apos;t finish. Nothing else was affected - try again, and if it keeps happening, send a screenshot.
        {error.digest && <span style={{ display: "block", color: "var(--ink-3)", fontSize: 12, marginTop: 6 }}>Reference: {error.digest}</span>}
      </p>
      <button className="btn primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
