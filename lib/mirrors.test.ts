import { describe, expect, it } from "vitest";
import type { FileStatus, LinkStatus } from "./links";
import { groupMirrors, hostRank, planMirrors, type MirrorCandidate, type MirrorPlan } from "./mirrors";

const NOW = 1_000_000;
const PRIO = ["pixeldrain", "gofile", "mega"];

let nextId = 1;
function f(fileId: number, host: string, over: Partial<MirrorCandidate> = {}): MirrorCandidate {
  return {
    fileId,
    linkId: over.linkId ?? fileId,
    host,
    name: "Show.S01E01.mkv",
    dir: "",
    size: 1000,
    fileStatus: "standby",
    linkStatus: "queued",
    linkDiscoveredAt: nextId++,
    linkRetryAt: null,
    ...over,
  };
}

const plan = (promote: number[] = [], standby: number[] = [], covered: number[] = []): MirrorPlan => ({
  promote,
  standby,
  covered,
});

function apply(files: MirrorCandidate[], p: MirrorPlan): MirrorCandidate[] {
  return files.map((x) =>
    p.promote.includes(x.fileId)
      ? { ...x, fileStatus: "queued" }
      : p.standby.includes(x.fileId)
        ? { ...x, fileStatus: "standby" }
        : x,
  );
}

describe("hostRank", () => {
  it.each([
    ["pixeldrain", 0],
    ["GoFile", 1],
    ["MEGA", 2],
    ["rapidgator", 3],
    ["other", 3],
  ])("%s -> %i", (host, rank) => {
    expect(hostRank(host, PRIO)).toBe(rank);
  });

  it("matches priority entries case-insensitively and ranks everything 0 with an empty list", () => {
    expect(hostRank("gofile", ["PixelDrain", "GOFILE"])).toBe(1);
    expect(hostRank("gofile", [])).toBe(0);
  });
});

describe("planMirrors: selection", () => {
  it.each<[string, MirrorCandidate[], MirrorPlan]>([
    [
      "promotes the most preferred standby copy and parks a queued less-preferred one",
      [f(1, "gofile", { fileStatus: "queued" }), f(2, "pixeldrain"), f(3, "mega")],
      plan([2], [1]),
    ],
    [
      "keeps the preferred copy queued when it already is",
      [f(1, "pixeldrain", { fileStatus: "queued" }), f(2, "gofile"), f(3, "mega")],
      plan(),
    ],
    [
      "parks all queued non-primary copies",
      [f(1, "mega", { fileStatus: "queued" }), f(2, "gofile", { fileStatus: "queued" }), f(3, "pixeldrain", { fileStatus: "queued" })],
      plan([], [1, 2]),
    ],
    [
      "ranks unlisted hosts after listed ones",
      [f(1, "rapidgator", { fileStatus: "queued" }), f(2, "mega")],
      plan([2], [1]),
    ],
    [
      "breaks host ties by link discovery time",
      [f(1, "gofile", { fileStatus: "queued", linkDiscoveredAt: 50 }), f(2, "gofile", { linkDiscoveredAt: 10 })],
      plan([2], [1]),
    ],
    [
      "breaks unlisted-host ties by discovery time",
      [f(1, "zzz", { fileStatus: "queued", linkDiscoveredAt: 50 }), f(2, "aaa", { linkDiscoveredAt: 10 })],
      plan([2], [1]),
    ],
    [
      "breaks full ties by file id",
      [f(7, "gofile", { fileStatus: "queued", linkDiscoveredAt: 5 }), f(3, "gofile", { linkDiscoveredAt: 5 })],
      plan([3], [7]),
    ],
  ])("%s", (_, files, expected) => {
    expect(planMirrors(files, PRIO, NOW)).toEqual(expected);
  });
});

describe("planMirrors: done / downloading copies", () => {
  it.each<[string, MirrorCandidate[], MirrorPlan]>([
    [
      "a done copy covers every queued/standby copy",
      [f(1, "mega", { fileStatus: "done" }), f(2, "pixeldrain", { fileStatus: "queued" }), f(3, "gofile")],
      plan([], [2], [2, 3]),
    ],
    [
      "a skipped copy counts as done",
      [f(1, "mega", { fileStatus: "skipped" }), f(2, "pixeldrain")],
      plan([], [], [2]),
    ],
    [
      "covered includes copies on dead links; failed copies are left alone",
      [
        f(1, "gofile", { fileStatus: "done" }),
        f(2, "pixeldrain", { fileStatus: "queued", linkStatus: "offline" }),
        f(3, "mega", { fileStatus: "failed" }),
      ],
      plan([], [2], [2]),
    ],
    [
      "a downloading copy blocks starting another one",
      [f(1, "mega", { fileStatus: "downloading" }), f(2, "pixeldrain", { fileStatus: "queued" }), f(3, "gofile")],
      plan([], [2]),
    ],
    [
      "done beats downloading (covered, downloading untouched)",
      [f(1, "mega", { fileStatus: "downloading" }), f(2, "gofile", { fileStatus: "done" }), f(3, "pixeldrain")],
      plan([], [], [3]),
    ],
    [
      "failed copies are never revived and do not block the next one",
      [f(1, "pixeldrain", { fileStatus: "failed" }), f(2, "gofile"), f(3, "mega")],
      plan([2]),
    ],
  ])("%s", (_, files, expected) => {
    expect(planMirrors(files, PRIO, NOW)).toEqual(expected);
  });
});

describe("planMirrors: failover", () => {
  it.each<LinkStatus>(["offline", "failed", "ignored"])("promotes the next copy when the primary's link is %s", (status) => {
    const files = [f(1, "pixeldrain", { fileStatus: "queued", linkStatus: status }), f(2, "gofile"), f(3, "mega")];
    // The dead copy keeps its status; the worker marks it via the link.
    expect(planMirrors(files, PRIO, NOW)).toEqual(plan([2]));
  });

  it("changes nothing when no copy is usable", () => {
    const files = [
      f(1, "pixeldrain", { linkStatus: "offline" }),
      f(2, "gofile", { fileStatus: "queued", linkStatus: "failed" }),
      f(3, "mega", { fileStatus: "failed" }),
    ];
    expect(planMirrors(files, PRIO, NOW)).toEqual(plan());
  });

  it("treats mirror/resolving/done link statuses as usable", () => {
    expect(planMirrors([f(1, "pixeldrain", { linkStatus: "mirror" }), f(2, "gofile", { fileStatus: "queued" })], PRIO, NOW)).toEqual(
      plan([1], [2]),
    );
  });
});

describe("planMirrors: waiting links (linkRetryAt)", () => {
  it.each<[string, MirrorCandidate[], MirrorPlan]>([
    [
      "a rate-limited preferred copy yields to the next host",
      [f(1, "pixeldrain", { fileStatus: "queued", linkRetryAt: NOW + 60_000 }), f(2, "gofile"), f(3, "mega")],
      plan([2], [1]),
    ],
    [
      "a waiting standby copy is skipped in favour of a ready one",
      [f(1, "pixeldrain", { linkRetryAt: NOW + 1 }), f(2, "gofile"), f(3, "mega")],
      plan([2]),
    ],
    [
      "all copies waiting: the best-ranked queued one stays primary",
      [
        f(1, "pixeldrain", { fileStatus: "queued", linkRetryAt: NOW + 10 }),
        f(2, "gofile", { linkRetryAt: NOW + 5 }),
      ],
      plan(),
    ],
    [
      "all copies waiting and all standby: the best-ranked one is promoted",
      [f(1, "gofile", { linkRetryAt: NOW + 5 }), f(2, "pixeldrain", { linkRetryAt: NOW + 10 })],
      plan([2]),
    ],
    [
      "retryAt in the past is not waiting",
      [f(1, "pixeldrain", { linkRetryAt: NOW - 1 }), f(2, "gofile", { fileStatus: "queued" })],
      plan([1], [2]),
    ],
    [
      "retryAt equal to now is not waiting",
      [f(1, "pixeldrain", { linkRetryAt: NOW }), f(2, "gofile", { fileStatus: "queued" })],
      plan([1], [2]),
    ],
    [
      "a waiting copy never overrides a downloading one",
      [f(1, "pixeldrain", { fileStatus: "queued" }), f(2, "gofile", { fileStatus: "downloading" })],
      plan([], [1]),
    ],
  ])("%s", (_, files, expected) => {
    expect(planMirrors(files, PRIO, NOW)).toEqual(expected);
  });

  it("returns to the preferred host once its retry time passes, if nothing started yet", () => {
    const files = [f(1, "pixeldrain", { fileStatus: "queued", linkRetryAt: NOW + 10 }), f(2, "gofile")];
    const applied = apply(files, planMirrors(files, PRIO, NOW));
    expect(planMirrors(applied, PRIO, NOW)).toEqual(plan());
    expect(planMirrors(applied, PRIO, NOW + 10)).toEqual(plan([1], [2]));
  });
});

describe("planMirrors: fresh standby groups", () => {
  it("promotes exactly one copy when every copy of a new group is standby", () => {
    const files = [f(1, "mega"), f(2, "gofile"), f(3, "pixeldrain"), f(4, "rapidgator")];
    expect(planMirrors(files, PRIO, NOW)).toEqual(plan([3]));
  });
});

describe("planMirrors: singletons", () => {
  it.each<[FileStatus, LinkStatus, MirrorPlan]>([
    ["standby", "mirror", plan([1])],
    ["standby", "queued", plan([1])],
    ["standby", "ignored", plan()],
    ["standby", "offline", plan()],
    ["queued", "queued", plan()],
    ["done", "done", plan()],
    ["failed", "failed", plan()],
  ])("%s file on %s link", (fileStatus, linkStatus, expected) => {
    expect(planMirrors([f(1, "gofile", { fileStatus, linkStatus })], PRIO, NOW)).toEqual(expected);
  });
});

describe("grouping", () => {
  it("matches names case-insensitively, after NFC and trim", () => {
    const nfd = "Amélie.mkv"; // decomposed é
    const files = [
      f(1, "gofile", { name: "Amélie.MKV ", fileStatus: "queued" }),
      f(2, "pixeldrain", { name: nfd }),
      f(3, "mega", { name: "  AMÉLIE.mkv" }),
    ];
    expect(groupMirrors(files)).toHaveLength(1);
    expect(planMirrors(files, PRIO, NOW)).toEqual(plan([2], [1]));
  });

  it("ignores the dir", () => {
    const files = [
      f(1, "gofile", { dir: "Release/Sub", fileStatus: "queued" }),
      f(2, "pixeldrain", { dir: "" }),
    ];
    expect(planMirrors(files, PRIO, NOW)).toEqual(plan([2], [1]));
  });

  it("keeps different sizes apart", () => {
    const files = [f(1, "gofile", { size: 1000, fileStatus: "queued" }), f(2, "pixeldrain", { size: 999 })];
    expect(groupMirrors(files)).toHaveLength(2);
    expect(planMirrors(files, PRIO, NOW)).toEqual(plan([2]));
  });

  it("keeps different names apart", () => {
    const files = [f(1, "gofile", { fileStatus: "queued" }), f(2, "pixeldrain", { name: "Show.S01E02.mkv" })];
    expect(planMirrors(files, PRIO, NOW)).toEqual(plan([2]));
  });

  it.each<[string, (number | null)[], number[][]]>([
    ["unknown joins the single known size", [1000, null, 1000], [[1, 2, 3]]],
    ["all unknown sizes group together", [null, null], [[1, 2]]],
    ["unknown stays alone when the name has two known sizes", [1000, null, 999], [[1], [2], [3]]],
    ["several unknowns all stay alone with ambiguous sizes", [null, 5, null, 6], [[1], [2], [3], [4]]],
  ])("%s", (_, sizes, expected) => {
    const files = sizes.map((size, i) => f(i + 1, "gofile", { size }));
    const ids = groupMirrors(files)
      .map((g) => g.map((x) => x.fileId).sort((a, b) => a - b))
      .sort((a, b) => a[0] - b[0]);
    expect(ids).toEqual(expected);
  });

  it("an unknown-size copy acts as a mirror when unambiguous", () => {
    const files = [f(1, "gofile", { size: 1000, fileStatus: "queued" }), f(2, "pixeldrain", { size: null })];
    expect(planMirrors(files, PRIO, NOW)).toEqual(plan([2], [1]));
  });
});

describe("planMirrors: multi-file links", () => {
  // gofile folder (link 10) holds E01-E03 nested in a dir; pixeldrain list (link 20) holds E02-E04.
  const ep = (n: number) => `Show.S01E0${n}.mkv`;
  const build = (): MirrorCandidate[] => [
    ...[1, 2, 3].map((n) =>
      f(100 + n, "gofile", { linkId: 10, name: ep(n), dir: "Show S01", fileStatus: "queued", linkDiscoveredAt: 1 }),
    ),
    ...[2, 3, 4].map((n) =>
      f(200 + n, "pixeldrain", { linkId: 20, name: ep(n), fileStatus: "queued", linkDiscoveredAt: 2 }),
    ),
  ];

  it("takes overlapping files from the preferred host and the rest from whoever has them", () => {
    expect(planMirrors(build(), PRIO, NOW)).toEqual(plan([], [102, 103]));
    expect(planMirrors(build(), ["gofile"], NOW)).toEqual(plan([], [202, 203]));
  });

  it("fails over the overlapping files when the preferred link dies", () => {
    let files = apply(build(), planMirrors(build(), PRIO, NOW));
    files = files.map((x) => (x.linkId === 20 ? { ...x, linkStatus: "offline" as const } : x));
    expect(planMirrors(files, PRIO, NOW)).toEqual(plan([102, 103]));
  });

  it("covers the standby copies once the preferred ones finish", () => {
    let files = apply(build(), planMirrors(build(), PRIO, NOW));
    files = files.map((x) => (x.linkId === 20 ? { ...x, fileStatus: "done" as const } : x));
    expect(planMirrors(files, PRIO, NOW)).toEqual(plan([], [], [102, 103]));
  });
});

describe("planMirrors: idempotency (property)", () => {
  function prng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const HOSTS = ["pixeldrain", "gofile", "mega", "rapidgator", "PixelDrain"];
  const NAMES = ["a.mkv", "A.MKV", " a.mkv", "b.mkv", "c.rar", "Amélie.mkv", "Amélie.mkv"];
  const SIZES = [null, 100, 100, 200];
  const FILE_STATUSES: FileStatus[] = ["queued", "queued", "standby", "standby", "downloading", "done", "failed", "skipped"];
  const LINK_STATUSES: LinkStatus[] = ["queued", "queued", "mirror", "downloading", "done", "failed", "offline", "ignored"];

  it("re-planning the applied plan changes nothing, and each live group has one active copy", () => {
    const rnd = prng(42);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    for (let run = 0; run < 2000; run++) {
      const priority = HOSTS.slice(0, Math.floor(rnd() * 4));
      const n = 1 + Math.floor(rnd() * 10);
      const files: MirrorCandidate[] = Array.from({ length: n }, (_, i) => ({
        fileId: n - i, // reverse order to exercise sorting
        linkId: Math.floor(rnd() * 4),
        host: pick(HOSTS),
        name: pick(NAMES),
        dir: pick(["", "x", "x/y"]),
        size: pick(SIZES),
        fileStatus: pick(FILE_STATUSES),
        linkStatus: pick(LINK_STATUSES),
        linkDiscoveredAt: Math.floor(rnd() * 3),
        linkRetryAt: pick([null, null, NOW - 1, NOW, NOW + 1]),
      }));

      const first = planMirrors(files, priority, NOW);
      for (const arr of [first.promote, first.standby, first.covered]) {
        expect(arr).toEqual([...new Set(arr)].sort((a, b) => a - b));
      }
      // Only legal transitions.
      for (const id of first.promote) expect(files.find((x) => x.fileId === id)!.fileStatus).toBe("standby");
      for (const id of first.standby) expect(files.find((x) => x.fileId === id)!.fileStatus).toBe("queued");

      const applied = apply(files, first);
      const second = planMirrors(applied, priority, NOW);
      expect(second.promote).toEqual([]);
      expect(second.standby).toEqual([]);
      expect(second.covered).toEqual(first.covered);
      // Shuffled input order gives the same plan.
      expect(planMirrors([...applied].reverse(), priority, NOW)).toEqual(second);

      for (const group of groupMirrors(applied)) {
        const satisfied = group.some((x) => ["done", "skipped", "downloading"].includes(x.fileStatus));
        const usable = group.filter(
          (x) => ["queued", "standby"].includes(x.fileStatus) && !["failed", "offline", "ignored"].includes(x.linkStatus),
        );
        const usableQueued = usable.filter((x) => x.fileStatus === "queued");
        if (satisfied) {
          const live = group.filter((x) => x.fileStatus === "queued" && !["failed", "offline", "ignored"].includes(x.linkStatus));
          expect(live).toEqual([]);
        } else if (usable.length > 0) {
          expect(usableQueued).toHaveLength(1);
        }
      }
    }
  });
});
