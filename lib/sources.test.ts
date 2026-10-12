import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-sources-"));
process.env.RIPARR_CONFIG_DIR = tmp;

const { closeDb, run } = await import("./db");
const { addRootFolder } = await import("./root-folders");
const { createTitle, titleInput } = await import("./titles");
const { createSource, getSource, sourceInput, updateSource } = await import("./sources");

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("updateSource", () => {
  it("starts a source over when its URL changes, and keeps its state otherwise", () => {
    const rootId = addRootFolder(tmp);
    const titleId = createTitle(titleInput.parse({ type: "show", name: "S", root_folder_id: rootId, folder: "S", naming: "{filename}", monitored: true }));
    const id = createSource(titleId, sourceInput.parse({ url: "https://mkvdrama.net/c/old", password: "pw" }));
    run("UPDATE sources SET status = 'needs_attention', last_error = 'expired', next_check_at = 999999 WHERE id = ?", id);

    expect(updateSource(id, sourceInput.parse({ url: "https://mkvdrama.net/c/old", password: "pw", poll_interval_min: 120 }))).toEqual({ urlChanged: false });
    expect(getSource(id)).toMatchObject({ status: "needs_attention", last_error: "expired", poll_interval_min: 120, password: "pw" });

    expect(updateSource(id, sourceInput.parse({ url: "https://mkvdrama.net/c/new", password: "pw" }))).toEqual({ urlChanged: true });
    expect(getSource(id)).toMatchObject({ url: "https://mkvdrama.net/c/new", status: "pending", last_error: null, next_check_at: 0 });
  });
});
