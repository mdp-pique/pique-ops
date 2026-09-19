"use client";

import { useId, useState } from "react";
import type { Sparkline as SparklineData } from "@/lib/data/dashboard";

const W = 300;
const H = 62;
const PAD = 7;

export function Sparkline({
  title,
  qualifier,
  data,
  decimals = 0,
  threshold,
}: {
  title: string;
  qualifier: string;
  data: SparklineData;
  decimals?: number;
  threshold?: { value: number; label: string };
}) {
  const gradientId = useId();
  const [tip, setTip] = useState<{ x: number; y: number; label: string; value: string } | null>(null);

  const values = data.points.map((p) => p.value);
  const min = Math.min(...values, threshold?.value ?? Infinity);
  const max = Math.max(...values, threshold?.value ?? -Infinity);
  const span = max - min || 1;

  const x = (i: number) => PAD + (i / Math.max(data.points.length - 1, 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2);

  const linePath = data.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(data.points.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;

  const last = data.points.at(-1);
  const deltaLabel = data.delta === 0 ? "flat" : `${data.delta > 0 ? "+" : ""}${data.delta.toFixed(decimals)}`;

  return (
    <div className="spark">
      <div className="sh">
        <span className="sv num">{data.current.toFixed(decimals)}</span>
        <span className={`sd ${data.deltaGood ? "good" : "bad"}`}>{deltaLabel}</span>
      </div>
      <div className="sl">
        {title} &middot; {qualifier}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        onMouseLeave={() => setTip(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.max(0, Math.min(data.points.length - 1, Math.round(((relX - PAD) / (W - PAD * 2)) * (data.points.length - 1))));
          const p = data.points[i];
          if (!p) return;
          setTip({ x: e.clientX, y: e.clientY, label: p.label, value: p.value.toFixed(decimals) });
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {threshold && (
          <>
            <line
              x1={PAD}
              x2={W - PAD}
              y1={y(threshold.value)}
              y2={y(threshold.value)}
              stroke="var(--ink-3)"
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.7}
            />
            <text x={PAD} y={y(threshold.value) - 4} textAnchor="start" fontFamily="var(--font-plex-mono)" fontSize={9} fill="var(--ink-3)">
              {threshold.label}
            </text>
          </>
        )}

        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {last && (
          <circle cx={x(data.points.length - 1)} cy={y(last.value)} r={4.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
        )}

        {data.points.map((p, i) => (
          <g key={i} className="hot">
            <line className="crosshair" x1={x(i)} x2={x(i)} y1={PAD} y2={H - PAD} stroke="var(--line-2)" strokeWidth={1} />
            <circle className="hot-dot" cx={x(i)} cy={y(p.value)} r={4} fill="var(--accent)" />
            <rect
              x={x(i) - (W - PAD * 2) / data.points.length / 2}
              y={0}
              width={(W - PAD * 2) / data.points.length}
              height={H}
              fill="transparent"
            />
          </g>
        ))}
      </svg>

      {tip && (
        <div className="sp-tip show" style={{ left: tip.x, top: tip.y }}>
          {tip.label} &middot; {tip.value}
        </div>
      )}
    </div>
  );
}
