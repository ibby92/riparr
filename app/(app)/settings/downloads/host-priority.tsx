"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { KNOWN_HOSTS } from "@/lib/host-ids";
import { HostChip } from "../../_kit";

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
 * the saved order so local state resets after a save; the form's Discard (reset) restores it too.
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

  useEffect(() => {
    const form = listRef.current?.closest("form");
    if (!form) return;
    const onReset = () => setOrder(orderedHosts(initial));
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [initial]);

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    setRefocus({ id: order[index], dir: delta < 0 ? "up" : "down" });
  }

  return (
    <ol ref={listRef} aria-label="Preferred hosts, best first" className="m-0 divide-y divide-border rounded-sm border border-border p-0">
      {order.map((id, i) => {
        const label = LABELS[id] ?? id;
        return (
          <li key={id} data-host={id} className="flex items-center gap-2.5 py-1.5 pl-3 pr-2 text-sm">
            <span className="w-5 text-sm tabular-nums text-muted">{i + 1}</span>
            <HostChip host={id} />
            <span className="flex-1" />
            <input type="hidden" name="hostPriority" value={id} />
            <button
              type="button"
              data-dir="up"
              className="btn btn-ghost px-2"
              aria-label={`Move ${label} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ArrowUp size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-dir="down"
              className="btn btn-ghost px-2"
              aria-label={`Move ${label} down`}
              disabled={i === order.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown size={16} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
