import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-notify-"));
process.env.RIPARR_CONFIG_DIR = tmp;

const { notify } = await import("./notify");
const { saveSettings } = await import("./settings");
const { closeDb } = await import("./db");

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function recorder(status = 200) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(null, { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const subject = { id: 7, name: "Show", password: "hunter2", url: "https://secret.example/x" };

describe("notify", () => {
  it("does nothing when unconfigured or the event is off", async () => {
    const { calls, fetchImpl } = recorder();
    expect(await notify({ event: "download_done", message: "x" }, fetchImpl)).toEqual([]);
    saveSettings({ notifyWebhookUrl: "http://hooks.local/x", notifyEvents: ["download_failed"] });
    await notify({ event: "download_done", message: "x" }, fetchImpl);
    expect(calls).toHaveLength(0);
  });

  it("posts JSON to the webhook without leaking secrets", async () => {
    saveSettings({ notifyWebhookUrl: "http://hooks.local/x", notifyEvents: ["download_done"] });
    const { calls, fetchImpl } = recorder();
    await notify({ event: "download_done", message: "Downloaded a.mkv", subject }, fetchImpl);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      event: "download_done",
      title: "Riparr: Download finished",
      message: "Downloaded a.mkv",
      media: { id: 7, name: "Show" },
    });
    expect(JSON.stringify(calls[0].body)).not.toContain("hunter2");
    expect(JSON.stringify(calls[0].body)).not.toContain("secret.example");
  });

  it("formats Discord webhooks and Apprise, and reports failures per target", async () => {
    saveSettings({
      notifyWebhookUrl: "https://discord.com/api/webhooks/1/abc",
      notifyAppriseUrl: "http://apprise:8000/notify/riparr",
      notifyEvents: ["needs_attention"],
    });
    const { calls, fetchImpl } = recorder();
    await notify({ event: "needs_attention", message: "Captcha", subject }, fetchImpl);
    expect(calls.map((c) => c.body)).toEqual([
      { username: "Riparr", content: "**Riparr: Needs attention**\nShow: Captcha" },
      { title: "Riparr: Needs attention", body: "Show: Captcha", type: "warning" },
    ]);

    const failing = recorder(500);
    const errors = await notify({ event: "test", message: "hi" }, failing.fetchImpl);
    expect(errors).toEqual(["HTTP 500 from discord.com", "HTTP 500 from apprise:8000"]);
  });
});
