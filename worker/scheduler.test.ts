import { describe, expect, it } from "vitest";
import type { SourceWithTitle } from "@/lib/sources";
import { nextCheckAt } from "./scheduler";

const source = { poll_interval_min: 60 } as SourceWithTitle;
const HOUR = 60 * 60_000;

describe("nextCheckAt", () => {
  it("schedules one interval ahead with ±10% jitter", () => {
    for (let i = 0; i < 100; i++) {
      const delay = nextCheckAt(source, 0, 0);
      expect(delay).toBeGreaterThanOrEqual(0.9 * HOUR);
      expect(delay).toBeLessThanOrEqual(1.1 * HOUR);
    }
  });

  it("backs off exponentially on failures, capped at 6h", () => {
    expect(nextCheckAt(source, 1, 0)).toBeGreaterThanOrEqual(1.8 * HOUR);
    expect(nextCheckAt(source, 10, 0)).toBeLessThanOrEqual(6.6 * HOUR);
  });

  it("never shortens intervals longer than the backoff cap", () => {
    const daily = { poll_interval_min: 24 * 60 } as SourceWithTitle;
    expect(nextCheckAt(daily, 3, 0)).toBeGreaterThanOrEqual(0.9 * 24 * HOUR);
  });
});
