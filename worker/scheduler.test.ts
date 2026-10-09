import { describe, expect, it } from "vitest";
import type { Container } from "@/lib/containers";
import { nextCheckAt } from "./scheduler";

const container = { poll_interval_min: 60 } as Container;
const HOUR = 60 * 60_000;

describe("nextCheckAt", () => {
  it("schedules one interval ahead with ±10% jitter", () => {
    for (let i = 0; i < 100; i++) {
      const delay = nextCheckAt(container, 0, 0);
      expect(delay).toBeGreaterThanOrEqual(0.9 * HOUR);
      expect(delay).toBeLessThanOrEqual(1.1 * HOUR);
    }
  });

  it("backs off exponentially on failures, capped at 6h", () => {
    expect(nextCheckAt(container, 1, 0)).toBeGreaterThanOrEqual(1.8 * HOUR);
    expect(nextCheckAt(container, 10, 0)).toBeLessThanOrEqual(6.6 * HOUR);
  });

  it("never shortens intervals longer than the backoff cap", () => {
    const daily = { poll_interval_min: 24 * 60 } as Container;
    expect(nextCheckAt(daily, 3, 0)).toBeGreaterThanOrEqual(0.9 * 24 * HOUR);
  });
});
