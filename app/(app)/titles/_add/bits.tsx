"use client";

import { useState, type ReactNode } from "react";
import { Poster } from "../../_kit";

/** A TMDB poster straight from image.tmdb.org, or the generated tile when there's none. */
export function TmdbPoster({
  src,
  seed,
  name,
  year,
  className = "",
}: {
  src: string | null;
  seed: number;
  name: string;
  year: number | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <Poster id={seed} name={name} year={year} hasPoster={false} className={className} />;
  return (
    <div className={`relative aspect-[2/3] max-w-full overflow-hidden rounded-sm bg-surface-3 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 size-full object-cover" />
    </div>
  );
}

const SWITCH =
  "relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-pill bg-border-strong transition-colors before:absolute before:left-0.5 before:top-0.5 before:size-4 before:rounded-full before:bg-surface before:shadow-xs before:transition-transform checked:bg-accent checked:before:translate-x-4";

/** Controlled version of the kit's SwitchRow (the forms need live values for the path preview). */
export function Switch({
  id,
  name,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-4 py-2">
      <label htmlFor={id} className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </label>
      <input id={id} name={name} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className={SWITCH} />
    </div>
  );
}

/** Field errors under a control. */
export function Errors({ id, errors }: { id?: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <div id={id} className="space-y-0.5">
      {errors.map((e) => (
        <p key={e} className="text-xs text-critical">
          {e}
        </p>
      ))}
    </div>
  );
}

/** Two-option segmented control (radio group), keyboard-operable with arrow keys. */
export function Segmented<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="inline-flex rounded-sm border border-border-strong bg-surface-2 p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className="cursor-pointer rounded-[6px] px-3 py-1 text-[13px] font-medium text-fg-2 has-[:checked]:bg-surface has-[:checked]:text-fg has-[:checked]:shadow-xs has-[:focus-visible]:[outline:2px_solid_var(--focus)]"
        >
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}
