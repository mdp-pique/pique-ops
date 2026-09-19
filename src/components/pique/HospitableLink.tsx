/** Small external-link icon that jumps to the guest's message thread in Hospitable's own inbox. Renders nothing if there's no thread id to link to. */
export function HospitableLink({ href, label }: { href: string | null; label: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="icon-btn"
      aria-label={label}
      title={label}
      onClick={(e) => e.stopPropagation()}
      style={{ width: 28, height: 28, flexShrink: 0 }}
    >
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path d="M14 4h6v6M10 14L20 4M19 13v6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" />
      </svg>
    </a>
  );
}
