"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "./format";

/** Live "resumes in 42m 05s" countdown to `until` (epoch ms); `done` shows once it passes. */
export function Countdown({ until, prefix = "resumes in", done = "resuming now" }: { until: number; prefix?: string; done?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // Server render and first paint show the absolute time, so nothing shifts or mismatches.
  if (now === null) {
    return <span className="tabular-nums">{`${prefix} ${new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</span>;
  }
  const left = (until - now) / 1000;
  return <span className="tabular-nums">{left > 0 ? `${prefix} ${formatDuration(left)}` : done}</span>;
}
