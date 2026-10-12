import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-archive-"));
process.env.RIPARR_CONFIG_DIR = tmp;

const { closeDb, run } = await import("./db");
const { addRootFolder } = await import("./root-folders");
const { createTitle, getTitle, setTitleArchived, titleInput } = await import("./titles");
const { createSource, dueSources, sourceInput } = await import("./sources");
const { activeLinks, downloadableLinks } = await import("./links");
const { staleScans } = await import("./disk-scan");

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("archiving a title", () => {
  it("keeps the title but stops checks, downloads, scans and queue entries; unarchiving brings them back", () => {
    const rootId = addRootFolder(tmp);
    const id = createTitle(titleInput.parse({ type: "show", name: "Done Show", root_folder_id: rootId, folder: "D", naming: "{filename}", monitored: true }));
    createSource(id, sourceInput.parse({ url: "https://viewcrate.cc/c/abc" }));
    run("INSERT INTO links (title_id, url, fingerprint, host, status, discovered_at, resolved_at) VALUES (?, 'https://gofile.io/d/x', 'fp', 'gofile', 'queued', 1, 1)", id);
    run("INSERT INTO files (link_id, key, remote_name, status, updated_at) SELECT id, 'k', 'Done.S01E01.mkv', 'queued', 1 FROM links WHERE title_id = ?", id);
    const now = Date.now();
    expect(dueSources(now + 1).map((s) => s.title_id)).toContain(id);
    expect(activeLinks()).toHaveLength(1);
    expect(downloadableLinks(now)).toHaveLength(1);
    expect(staleScans(0, 10, now + 1)).toContain(id);

    setTitleArchived(id, true, 1000);
    expect(getTitle(id)).toMatchObject({ archived_at: 1000, monitored: 0, status: "archived", name: "Done Show" });
    expect(dueSources(now + 1)).toEqual([]);
    expect(activeLinks()).toEqual([]);
    expect(downloadableLinks(now)).toEqual([]);
    expect(staleScans(0, 10, now + 1)).not.toContain(id);

    setTitleArchived(id, false);
    expect(getTitle(id)).toMatchObject({ archived_at: null, monitored: 1 });
    expect(getTitle(id)!.status).not.toBe("archived");
    expect(dueSources(now + 1).map((s) => s.title_id)).toContain(id);
    expect(activeLinks()).toHaveLength(1);
  });
});
