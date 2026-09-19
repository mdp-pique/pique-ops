import Link from "next/link";

export function Segmented({
  options,
  active,
  hrefFor,
}: {
  options: { key: string; label: string; count?: number }[];
  active: string;
  hrefFor: (key: string) => string;
}) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <Link key={o.key} href={hrefFor(o.key)} aria-pressed={active === o.key}>
          {o.label}
          {o.count != null && <span className="cnt num">{o.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function ChipLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="chip" aria-pressed={active}>
      {children}
    </Link>
  );
}

export function StatusPill({ variant, children }: { variant: "ok" | "warn" | "crit" | "neutral"; children: React.ReactNode }) {
  return <span className={`status ${variant}`}>{children}</span>;
}

export function Tag({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`tag ${cls}`}>{children}</span>;
}

export function Tile({
  href,
  variant,
  eyebrow,
  value,
  label,
}: {
  href: string;
  variant: "warn" | "crit" | "ok" | "accent";
  eyebrow: string;
  value: number;
  label: string;
}) {
  return (
    <Link href={href} className={`tile ${variant}`}>
      <div className="mono">{eyebrow}</div>
      <div className="k num">{value}</div>
      <div className="l">{label}</div>
    </Link>
  );
}

export function Btn({
  variant,
  children,
  onClick,
  type = "button",
}: {
  variant?: "primary";
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button type={type} className={`btn ${variant ?? ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

export function IconBtn({ label, onClick, children }: { label: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button className="icon-btn" aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}
