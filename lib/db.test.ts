import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "./db";
import { migrate } from "./db/migrations";
import { sendCommand, takeCommands } from "./commands";
import {
  containerInput,
  createContainer,
  dueContainers,
  findContainerByUrl,
  getContainer,
  listContainers,
  recordCheck,
} from "./containers";
import { logEvent, recentEvents } from "./events";

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-test-"));
  process.env.RIPARR_CONFIG_DIR = dir;
});

afterAll(() => {
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

const form = {
  name: "Show",
  url: "https://example.com/crate/abc",
  password: "",
  poll_interval_min: "30",
  target_dir: "tv/Show/",
  path_template: "{filename}",
  enabled: "on",
  poll: "on",
};

describe("containerInput", () => {
  it("parses form data", () => {
    expect(containerInput.parse(form)).toEqual({
      name: "Show",
      url: "https://example.com/crate/abc",
      password: null,
      poll_interval_min: 30,
      target_dir: "tv/Show",
      path_template: "{filename}",
      enabled: true,
      poll: true,
    });
  });

  it("treats a missing checkbox as disabled", () => {
    const { enabled, ...rest } = form;
    void enabled;
    expect(containerInput.parse(rest).enabled).toBe(false);
  });

  it.each([
    ["url", "ftp://example.com"],
    ["target_dir", "../escape"],
    ["poll_interval_min", "1"],
    ["path_template", "{container}"],
  ])("rejects bad %s", (field, value) => {
    const result = containerInput.safeParse({ ...form, [field]: value });
    expect(result.success).toBe(false);
  });
});

describe("database", () => {
  it("migrations are idempotent", () => {
    migrate(getDb());
    expect(getDb().prepare("PRAGMA user_version").get()).toEqual({ user_version: 3 });
  });

  it("creates containers that are immediately due", () => {
    const id = createContainer(containerInput.parse(form));
    expect(getContainer(id)).toMatchObject({ name: "Show", status: "pending", link_count: 0 });
    expect(findContainerByUrl(form.url)?.id).toBe(id);
    expect(dueContainers().map((c) => c.id)).toContain(id);

    recordCheck(id, { status: "ok", changed: false, nextCheckAt: Date.now() + 60_000 });
    expect(dueContainers().map((c) => c.id)).not.toContain(id);
    expect(listContainers()[0]).toMatchObject({ status: "ok", last_changed_at: null });
  });

  it("delivers each command once", () => {
    sendCommand({ type: "check_now", containerId: 1 });
    sendCommand({ type: "check_now", containerId: 2 });
    expect(takeCommands()).toEqual([
      { type: "check_now", containerId: 1 },
      { type: "check_now", containerId: 2 },
    ]);
    expect(takeCommands()).toEqual([]);
  });

  it("records events newest first", () => {
    logEvent("info", "first", 1);
    logEvent("error", "second", 1);
    expect(recentEvents(2, 1).map((e) => [e.message, e.container_name])).toEqual([
      ["second", "Show"],
      ["first", "Show"],
    ]);
  });
});
