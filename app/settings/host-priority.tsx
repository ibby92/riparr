"use client";

import { useEffect, useRef, useState } from "react";
import { KNOWN_HOSTS } from "@/lib/host-ids";

const LABELS: Record<string, string> = Object.fromEntries(KNOWN_HOSTS.map((h) => [h.id, h.label]));

/** Saved order first (known hosts only), then any known hosts not listed yet. */
export function orderedHosts(saved: string[]): string[] {
  const known = KNOWN_HOSTS.map((h) => h.id as string);
  const head = [...new Set(saved.filter((id) => known.includes(id)))];
  return [...head, ...known.filter((id) => !head.includes(id))];
}

/**
 * Ordered host list. Renders hidden `hostPriority` inputs in the current order, so the
 * enclosing form submits it (also without JS, in the saved order). Key this component on
 * the saved order so local state resets after a save.
 */
export function HostPriority({ initial }: { initial: string[] }) {
  const [order, setOrder] = useState(() => orderedHosts(initial));
  const listRef = useRef<HTMLOListElement>(null);
  // After a move the pressed button travels with its row; if it became disabled (row now at
  // an end), keep keyboard focus in that row by moving it to the other arrow.
  const [refocus, setRefocus] = useState<{ id: string; dir: "up" | "down" } | null>(null);
  useEffect(() => {
    if (!refocus) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-host="${refocus.id}"]`);
    const pressed = row?.querySelector<HTMLButtonElement>(`[data-dir="${refocus.dir}"]`);
    const other = row?.querySelector<HTMLButtonElement>(`[data-dir="${refocus.dir === "up" ? "down" : "up"}"]`);
    if (pressed?.disabled) other?.focus();
  }, [refocus]);

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    setRefocus({ id: order[index], dir: delta < 0 ? "up" : "down" });
  }

  return (
    <div className="space-y-1">
      <span id="host-priority-label" className="text-sm font-medium">
        Preferred hosts
      </span>
      <ol ref={listRef} aria-labelledby="host-priority-label" className="max-w-sm divide-y divide-border rounded border border-border">
        {order.map((id, i) => {
          const label = LABELS[id] ?? id;
          return (
            <li key={id} data-host={id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="w-5 text-xs tabular-nums text-muted">{i + 1}.</span>
              <span className="flex-1">{label}</span>
              <input type="hidden" name="hostPriority" value={id} />
              <button
                type="button"
                data-dir="up"
                className="btn px-2 py-0.5"
                aria-label={`Move ${label} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                data-dir="down"
                className="btn px-2 py-0.5"
                aria-label={`Move ${label} down`}
                disabled={i === order.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted">
        Identical files on several hosts are downloaded from the highest host on this list; the others are kept as
        fallbacks.
      </p>
    </div>
  );
}
