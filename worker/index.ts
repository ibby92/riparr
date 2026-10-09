import { closeDb, getDb } from "@/lib/db";
import { pruneCommands, takeCommands, type Command } from "@/lib/commands";
import { getContainer, scheduleCheckNow } from "@/lib/containers";
import { recoverInterrupted } from "@/lib/links";
import { logEvent, pruneEvents } from "@/lib/events";
import { getSettings, HEARTBEAT_INTERVAL_MS, writeHeartbeat } from "@/lib/settings";
import { startCnlServer } from "./cnl-server";
import { linkSettled, resetFailedExtractions, stopExtraction } from "./extract-runner";
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
    case "extract_container":
      resetFailedExtractions(command.containerId);
      linkSettled(command.containerId); // rescans now, or when its downloads finish
      break;
  }
}

function tick() {
  for (const command of takeCommands()) handle(command);
  runDueChecks(shutdown.signal);
  scheduleDownloads(shutdown.signal);
}

async function startClickNLoad() {
  if (!getSettings().cnlEnabled) return null;
  const port = Number(process.env.RIPARR_CNL_PORT ?? 9666);
  try {
    const server = await startCnlServer(port);
    console.log(`[riparr] click'n'load listening on :${port}`);
    return server;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent("error", `Click'n'Load listener could not start on port ${port}: ${message}`);
    return null;
  }
}

async function main() {
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
  const cnl = await startClickNLoad();

  const stop = (signal: string) => {
    console.log(`[riparr] ${signal} received, stopping worker`);
    timers.forEach(clearInterval);
    cnl?.close();
    stopExtraction();
    shutdown.abort();
    logEvent("info", "Worker stopped");
    closeDb();
    process.exit(0);
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
}

void main();
