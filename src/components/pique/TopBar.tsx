export function TopBar({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="topbar">
      <div>
        <h1>{title}</h1>
        <div className="sub">{subtitle}</div>
      </div>
      <label className="search">
        <svg viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input placeholder="Search guest, property, ticket…" aria-label="Search" />
      </label>
    </div>
  );
}
