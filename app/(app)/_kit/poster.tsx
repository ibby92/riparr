"use client";

import { useState } from "react";

/**
 * A title's poster (2:3). Shows the cached TMDB poster when the title has one,
 * otherwise (or if it fails to load) a generated tile: a hue from the id, the
 * name in the display face and the year.
 */
export function Poster({
  id,
  name,
  year,
  hasPoster,
  className = "",
}: {
  id: number;
  name: string;
  year?: number | null;
  hasPoster: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const hue = (id * 137.508) % 360;
  return (
    <div
      className={`@container relative aspect-[2/3] max-w-full overflow-hidden rounded-sm bg-surface-3 ${className}`}
      style={{
        backgroundImage: `linear-gradient(160deg, hsl(${hue} var(--poster-sat, 35%) var(--poster-l1, 46%)), hsl(${(hue + 40) % 360} var(--poster-sat, 35%) var(--poster-l2, 26%)))`,
      }}
    >
      {hasPoster && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/v1/titles/${id}/poster`}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col justify-end p-[8%] text-on-poster">
          {/* Thumbnails are too narrow for a name: show its initial instead. */}
          <span aria-hidden className="font-display text-[40cqw] leading-none @min-[5rem]:hidden">
            {name.trim().charAt(0).toUpperCase()}
          </span>
          <span className="hidden font-display text-[clamp(11px,13cqw,22px)] leading-tight [overflow-wrap:anywhere] @min-[5rem]:line-clamp-4">
            {name}
          </span>
          {year && <span className="mt-0.5 hidden text-[10px] opacity-75 @min-[5rem]:block">{year}</span>}
        </div>
      )}
    </div>
  );
}
