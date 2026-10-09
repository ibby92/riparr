import { closeDb, getDb } from "@/lib/db";
import { pruneCommands, takeCommands, type Command } from "@/lib/commands";
import { getContainer, scheduleCheckNow } from "@/lib/containers";
import { recoverInterrupted } from "@/lib/links";
import { logEvent, pruneEvents } from "@/lib/events";
import { HEARTBEAT_INTERVAL_MS, writeHeartbeat } from "@/lib/settings";
import { cancelContainer, cancelLink, scheduleDownloads } from "./pipeline";
import { runDueChecks } from "./scheduler";

const TICK_MS = 2_000;
const DAY = 24 * 60 * 60 * 1000;

const shutdown = new AbortController();

function handle(command: Command) {
  switch (command.type) {
    case "check_now": {
      const container = getContainer(command.containerId);
      if (!container) return;
      scheduleCheckNow(container.id);
      logEvent("info", "Manual check requested", container.id);
      break;
    }
    case "cancel_link":
      cancelLink(command.linkId);
      break;
    case "cancel_container":
      cancelContainer(command.containerId);
      break;
  }
}

function tick() {
  for (const command of takeCommands()) handle(command);
  runDueChecks(shutdown.signal);
  scheduleDownloads(shutdown.signal);
}

function main() {
  getDb(); // open and migrate before anything else
  recoverInterrupted();
  writeHeartbeat();
  logEvent("info", "Worker started");
  console.log("[riparr] worker started");

  const timers = [
    setInterval(() => {
      try {
        tick();
      } catch (err) {
        console.error("[riparr] tick failed", err);
      }
    }, TICK_MS),
    setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS),
    setInterval(() => {
      pruneEvents(30 * DAY);
      pruneCommands(DAY);
    }, 60 * 60 * 1000),
  ];
  tick();

  const stop = (signal: string) => {
    console.log(`[riparr] ${signal} received, stopping worker`);
    timers.forEach(clearInterval);
    shutdown.abort();
    logEvent("info", "Worker stopped");
    closeDb();
    process.exit(0);
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
}

main();
