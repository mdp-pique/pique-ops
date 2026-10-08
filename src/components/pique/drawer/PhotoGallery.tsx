"use client";

import { useEffect, useState } from "react";

const IMAGE = /\.(jpe?g|png|gif|webp|heic)(\?|$)/i;

/**
 * Photos and videos attached to an automation-made ticket (metadata.photos, e.g. a Connecteam
 * damage report). Thumbnails open full size in an overlay inside the app, because the
 * Connecteam CDN makes the browser download a photo opened in its own tab (Tammy, 10-08).
 * Videos and other files stay as links.
 */
export function PhotoGallery({ urls }: { urls: string[] }) {
  const images = urls.filter((u) => IMAGE.test(u));
  const others = urls.filter((u) => !IMAGE.test(u));
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : (i + 1) % images.length));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : (i - 1 + images.length) % images.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, images.length]);

  if (!urls.length) return null;
  const navBtn = {
    position: "absolute" as const,
    top: "50%",
    transform: "translateY(-50%)",
    background: "rgba(0,0,0,0.55)",
    color: "#fff",
    border: 0,
    borderRadius: 999,
    width: 44,
    height: 44,
    fontSize: 22,
    cursor: "pointer",
  };

  return (
    <div className="card">
      <h3>Photos ({urls.length})</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {images.map((url, i) => (
          <button
            key={url}
            type="button"
            onClick={() => setOpen(i)}
            aria-label={`View photo ${i + 1} of ${images.length}`}
            style={{ display: "block", width: 96, height: 96, padding: 0, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line-2)", cursor: "zoom-in", background: "none" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </button>
        ))}
      </div>
      {others.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 13, color: "var(--ink-2)" }}>
          Videos and files:{" "}
          {others.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>
              {i + 1}
            </a>
          ))}
        </div>
      )}

      {open !== null && images[open] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Photo ${open + 1} of ${images.length}`}
          onClick={() => setOpen(null)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.85)", display: "grid", placeItems: "center", padding: 16 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[open]}
            alt={`Photo ${open + 1} of ${images.length}`}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }}
          />
          <button type="button" aria-label="Close" onClick={() => setOpen(null)} style={{ ...navBtn, top: 16, right: 16, transform: "none" }}>
            ×
          </button>
          {images.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous photo"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen((open - 1 + images.length) % images.length);
                }}
                style={{ ...navBtn, left: 12 }}
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="Next photo"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen((open + 1) % images.length);
                }}
                style={{ ...navBtn, right: 12 }}
              >
                ›
              </button>
            </>
          )}
          <div style={{ position: "absolute", bottom: 16, color: "#fff", fontSize: 13 }}>
            {open + 1} / {images.length}
          </div>
        </div>
      )}
    </div>
  );
}
