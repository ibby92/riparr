import { describe, expect, it } from "vitest";
import { addDays, calendarRange, dayParts, isDayKey, rangeLabel, startOfWeek } from "./calendar";

describe("calendar ranges", () => {
  it("starts weeks on Monday and steps a week at a time", () => {
    expect(startOfWeek("2026-10-12")).toBe("2026-10-12"); // a Monday
    expect(startOfWeek("2026-10-18")).toBe("2026-10-12"); // Sunday
    const w = calendarRange("week", "2026-10-15");
    expect([w.from, w.to, w.days.length, w.prev, w.next]).toEqual(["2026-10-12", "2026-10-18", 7, "2026-10-05", "2026-10-19"]);
    expect(rangeLabel("week", w)).toBe("12 – 18 Oct 2026");
    expect(rangeLabel("week", calendarRange("week", "2026-10-28"))).toBe("26 Oct – 1 Nov 2026");
  });

  it("pads a month to whole weeks and steps a month at a time, across years", () => {
    const m = calendarRange("month", "2026-10-15");
    expect([m.from, m.to, m.days.length % 7, m.month]).toEqual(["2026-09-28", "2026-11-01", 0, "2026-10"]);
    expect([m.prev, m.next]).toEqual(["2026-09-01", "2026-11-01"]);
    expect(rangeLabel("month", m)).toBe("October 2026");
    const dec = calendarRange("month", "2026-12-31");
    expect([dec.next, calendarRange("month", "2027-01-05").prev]).toEqual(["2027-01-01", "2026-12-01"]);
  });

  it("validates day keys and names days", () => {
    expect(isDayKey("2026-10-12")).toBe(true);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("12/10/2026")).toBe(false);
    expect(isDayKey(undefined)).toBe(false);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(dayParts("2026-10-12")).toEqual({ weekday: "Mon", day: 12, long: "Monday 12 October" });
  });
});
