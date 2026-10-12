"use client";

import { siteHint } from "@/lib/site-hints";
import { useId } from "react";
import { Plus, X } from "lucide-react";
import { Errors, Switch } from "./bits";

export type SourceRow = { key: number; url: string; password: string; interval: string; poll: boolean };

export const INTERVALS = [
  { value: "15", label: "Every 15 min" },
  { value: "30", label: "Every 30 min" },
  { value: "60", label: "Every hour" },
  { value: "180", label: "Every 3 hours" },
  { value: "360", label: "Every 6 hours" },
  { value: "720", label: "Every 12 hours" },
  { value: "1440", label: "Once a day" },
];

let nextKey = 1;
export function newSourceRow(url = ""): SourceRow {
  return { key: nextKey++, url, password: "", interval: "60", poll: true };
}

/**
 * Container pages for a new title. Fields are named `source_<field>_<index>` with a
 * `source_count`, so the server can read them (and report errors) row by row.
 */
export function SourcesFields({
  rows,
  onChange,
  errors,
}: {
  rows: SourceRow[];
  onChange: (rows: SourceRow[]) => void;
  errors: Record<string, string[] | undefined>;
}) {
  const id = useId();
  const update = (i: number, patch: Partial<SourceRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-[13px] font-medium text-fg-2">Sources</legend>
      <p className="-mt-1 text-xs text-muted">
        Container pages that list this title, e.g. on mkvdrama or viewcrate. Riparr checks each one for new links. You can also add sources later.
      </p>
      <input type="hidden" name="source_count" value={rows.length} />
      {rows.map((r, i) => {
        const err = errors[`source_url_${i}`];
        return (
          <div key={r.key} className="flex flex-col gap-2 rounded-sm border border-border p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <label htmlFor={`${id}-url-${i}`} className="sr-only">
                  Source {i + 1} URL
                </label>
                <input
                  id={`${id}-url-${i}`}
                  name={`source_url_${i}`}
                  type="url"
                  inputMode="url"
                  className="input input-mono"
                  placeholder="https://viewcrate.cc/c/…"
                  value={r.url}
                  onChange={(e) => update(i, { url: e.target.value })}
                  aria-invalid={!!err}
                  aria-describedby={err ? `${id}-err-${i}` : undefined}
                  autoComplete="off"
                />
                <Errors id={`${id}-err-${i}`} errors={err} />
                {siteHint(r.url) && <p className="mt-1 text-xs text-muted">{siteHint(r.url)}</p>}
              </div>
              <button
                type="button"
                className="btn btn-ghost min-h-[38px] px-2"
                aria-label={`Remove source ${i + 1}`}
                onClick={() => onChange(rows.length > 1 ? rows.filter((_, j) => j !== i) : [newSourceRow()])}
              >
                <X size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_170px]">
              <div>
                <label htmlFor={`${id}-pw-${i}`} className="sr-only">
                  Source {i + 1} password
                </label>
                <input
                  id={`${id}-pw-${i}`}
                  name={`source_password_${i}`}
                  className="input"
                  placeholder="Password (optional)"
                  value={r.password}
                  onChange={(e) => update(i, { password: e.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div>
                <label htmlFor={`${id}-int-${i}`} className="sr-only">
                  How often to check source {i + 1}
                </label>
                <select
                  id={`${id}-int-${i}`}
                  name={`source_interval_${i}`}
                  className="input"
                  value={r.interval}
                  disabled={!r.poll}
                  onChange={(e) => update(i, { interval: e.target.value })}
                >
                  {INTERVALS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {/* A disabled select isn't submitted; keep the value anyway. */}
                {!r.poll && <input type="hidden" name={`source_interval_${i}`} value={r.interval} />}
              </div>
            </div>
            <Switch
              id={`${id}-poll-${i}`}
              name={`source_poll_${i}`}
              label="Check the page for new links"
              hint={r.poll ? "Turn off for pages behind a captcha that you feed with Click'n'Load." : "Riparr won't open this page. Send links with Click'n'Load or add them by hand."}
              checked={r.poll}
              onChange={(v) => update(i, { poll: v })}
            />
          </div>
        );
      })}
      <div>
        <button type="button" className="btn min-h-8 text-[13px]" onClick={() => onChange([...rows, newSourceRow()])} disabled={rows.length >= 20}>
          <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
          Add another source
        </button>
      </div>
    </fieldset>
  );
}
