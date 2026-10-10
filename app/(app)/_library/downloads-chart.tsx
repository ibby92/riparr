import { Table2 } from "lucide-react";
import { Card, formatBytes } from "../_kit";
import type { DayRow } from "../_data/dashboard";

const HOST_COLOR: Record<string, string> = {
  gofile: "var(--host-gofile)",
  pixeldrain: "var(--host-pixeldrain)",
  mega: "var(--host-mega)",
};
const HOST_LABEL: Record<string, string> = { mega: "MEGA" };
const color = (h: string) => HOST_COLOR[h] ?? "var(--host-other)";
const label = (h: string) => HOST_LABEL[h] ?? h;

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** 1, 2, 2.5, 5 × 10^n at or above `v`. */
function niceStep(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function fmt(v: number) {
  return v >= 100 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1);
}

/** Stacked bars per day by host, drawn to scale in SVG, with a table fallback. */
export function DownloadsChart({ days, hosts }: { days: DayRow[]; hosts: string[] }) {
  const max = Math.max(0, ...days.map((d) => d.total));
  const total = days.reduce((n, d) => n + d.total, 0);
  const [unit, div] = max >= GB ? ["GB", GB] : ["MB", MB];
  const step = max > 0 ? niceStep(max / div / 3) : 1;
  const top = max > 0 ? Math.ceil(max / div / step) * step : 3;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  const H = 200;
  const PAD_T = 8;
  const PAD_B = 24;
  const ih = H - PAD_T - PAD_B;
  const y = (v: number) => PAD_T + ih - (v / top) * ih;
  const band = 100 / days.length;
  const bw = band * 0.56;
  const perHost = hosts.map((h) => ({ host: h, bytes: days.reduce((n, d) => n + (d.byHost[h] ?? 0), 0) }));

  return (
    <Card
      title={
        <>
          Downloads, last {days.length} days
          <span className="mt-0.5 block font-sans text-[13px] font-normal text-muted">
            {unit} per day by host · <span className="tabular-nums">{formatBytes(total)}</span> total
          </span>
        </>
      }
      action={
        hosts.length > 0 && (
          <div className="hidden flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-fg-2 md:flex">
            {perHost.map(({ host, bytes }) => (
              <span key={host} className="inline-flex items-center gap-1.5">
                <i className="size-2.5 rounded-[3px]" style={{ background: color(host) }} aria-hidden="true" />
                {label(host)} <b className="font-medium tabular-nums text-fg">{formatBytes(bytes)}</b>
              </span>
            ))}
          </div>
        )
      }
    >
      {hosts.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-fg-2 md:hidden">
          {perHost.map(({ host, bytes }) => (
            <span key={host} className="inline-flex items-center gap-1.5">
              <i className="size-2.5 rounded-[3px]" style={{ background: color(host) }} aria-hidden="true" />
              {label(host)} <b className="font-medium tabular-nums text-fg">{formatBytes(bytes)}</b>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        {/* y-axis labels in HTML so they don't stretch with the plot */}
        <div className="relative w-9 shrink-0 text-right text-[11px] tabular-nums text-muted" style={{ height: H }} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: y(t) }}>
              {fmt(t)}
              {t === top ? ` ${unit}` : ""}
            </span>
          ))}
        </div>
        <svg
          className="block min-w-0 flex-1 overflow-visible"
          height={H}
          role="img"
          aria-label={`${unit} downloaded per day over the last ${days.length} days, stacked by host. ${formatBytes(total)} in total.`}
        >
          {ticks.map((t) => (
            <line key={t} x1="0" x2="100%" y1={y(t)} y2={y(t)} strokeWidth={1} style={{ stroke: t === 0 ? "var(--border-strong)" : "var(--grid)" }} />
          ))}
          {days.map((d, i) => {
            const x = band * i + (band - bw) / 2;
            let acc = 0;
            const present = hosts.filter((h) => (d.byHost[h] ?? 0) > 0);
            const tip = [
              d.label === "Today" ? "Today" : d.label,
              ...present.map((h) => `${label(h)}: ${formatBytes(d.byHost[h])}`),
              `Total: ${formatBytes(d.total)}`,
            ].join("\n");
            return (
              <g key={d.key}>
                <title>{tip}</title>
                {present.map((h, k) => {
                  const v = d.byHost[h] / div;
                  const y0 = y(acc);
                  const y1 = y(acc + v);
                  const gap = acc > 0 ? 2 : 0;
                  const hgt = Math.max(1, y0 - y1 - gap);
                  acc += v;
                  const fill = { fill: color(h) };
                  if (k !== present.length - 1) return <rect key={h} x={`${x}%`} y={y1} width={`${bw}%`} height={hgt} style={fill} />;
                  // Top segment: rounded top corners (a rounded rect plus a square-cornered base).
                  const r = Math.min(4, hgt / 2);
                  return (
                    <g key={h} style={fill}>
                      <rect x={`${x}%`} y={y1} width={`${bw}%`} height={hgt} rx={r} />
                      {hgt > r && <rect x={`${x}%`} y={y1 + r} width={`${bw}%`} height={hgt - r} />}
                    </g>
                  );
                })}
                <text
                  x={`${band * i + band / 2}%`}
                  y={H - 6}
                  textAnchor="middle"
                  className={`text-[11px] tabular-nums ${(days.length - 1 - i) % 2 ? "max-md:hidden" : ""}`}
                  style={{ fill: i === days.length - 1 ? "var(--fg)" : "var(--muted)", fontWeight: i === days.length - 1 ? 500 : 400 }}
                >
                  {d.label}
                </text>
                {/* full-height hit area so the tooltip shows anywhere in the day's column */}
                <rect x={`${band * i}%`} y={PAD_T} width={`${band}%`} height={ih} fill="transparent" />
              </g>
            );
          })}
        </svg>
      </div>
      {total === 0 && <p className="mt-2 text-center text-sm text-muted">Nothing downloaded in the last {days.length} days.</p>}
      <details className="mt-3 text-sm">
        <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-[13px] text-muted hover:text-fg">
          <Table2 size={14} strokeWidth={1.75} aria-hidden="true" />
          Show as table
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2 text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Day</th>
                {hosts.map((h) => (
                  <th key={h} className="px-3 py-2 text-right font-medium">
                    {label(h)}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {days.map((d) => (
                <tr key={d.key}>
                  <td className="whitespace-nowrap px-3 py-1.5">{d.label}</td>
                  {hosts.map((h) => (
                    <td key={h} className="px-3 py-1.5 text-right tabular-nums">
                      {d.byHost[h] ? formatBytes(d.byHost[h]) : "–"}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{d.total ? formatBytes(d.total) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}
