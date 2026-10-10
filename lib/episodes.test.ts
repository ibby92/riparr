import { describe, expect, it } from "vitest";
import { parseEpisode } from "./episodes";

describe("parseEpisode", () => {
  it.each([
    ["Doctor.X.S01E05.NF.1080p.mkv", { season: 1, episode: 5 }],
    ["show s2.e14 720p", { season: 2, episode: 14 }],
    ["Show 1x03 HDTV", { season: 1, episode: 3 }],
    ["Show Season 2 Episode 7", { season: 2, episode: 7 }],
    ["Irreplaceable.E05.1080p.mkv", { season: 1, episode: 5 }],
    ["Some Drama EP12 [720p].mp4", { season: 1, episode: 12 }],
    ["S01E01", { season: 1, episode: 1 }],
    ["Parasite.2019.1080p.mkv", null],
    ["Movie.Ep1c.Name.mkv", null],
    ["", null],
    [null, null],
  ])("%j", (name, expected) => {
    expect(parseEpisode(name)).toEqual(expected);
  });
});
