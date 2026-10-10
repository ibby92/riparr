import { closeDb, getDb } from "@/lib/db";
import { pruneCommands, takeCommands, type Command } from "@/lib/commands";
import { getSource, scheduleCheckNow, scheduleTitleCheckNow } from "@/lib/sources";
import { recoverInterrupted } from "@/lib/links";
import { logEvent, pruneEvents } from "@/lib/events";
import { getSettings, HEARTBEAT_INTERVAL_MS, writeHeartbeat } from "@/lib/settings";
import { startCnlServer } from "./cnl-server";
import { linkSettled, resetFailedExtractions, stopExtraction } from "./extract-runner";
import { checkAllRoots } from "./disk";
import { externalDiskFiles, scanTitle, staleScans } from "@/lib/disk-scan";
import { cancelLink, cancelTitle, scheduleDownloads, selectAndSettle } from "./pipeline";
import { runDueChecks } from "./scheduler";
import { sweepPartials } from "./partials";
import { listRootFolders } from "@/lib/root-folders";

const TICK_MS = 2_000;
const DAY = 24 * 60 * 60 * 1000;
/** Title folders are rescanned this often, a few per tick, to notice files added by hand. */
const RESCAN_MS = 30 * 60 * 1000;

const shutdown = new AbortController();

function handle(command: Command) {
  switch (command.type) {
    case "check_now": {
      const source = getSource(command.sourceId);
      if (!source) return;
      scheduleCheckNow(source.id);
      logEvent("info", "Manual check requested", source.title_id);
      break;
    }
    case "check_title":
      scheduleTitleCheckNow(command.titleId);
      logEvent("info", "Manual check requested", command.titleId);
      break;
    case "cancel_link":
      cancelLink(command.linkId);
      break;
    case "cancel_title":
      cancelTitle(command.titleId);
      break;
    case "extract_title":
      resetFailedExtractions(command.titleId);
      linkSettled(command.titleId); // rescans now, or when its downloads finish
      break;
    case "scan_title": {
      const found = scanTitle(command.titleId);
      if (command.manual) {
        // Riparr's own downloads are tracked already; what matters is what else is in the folder.
        const external = found ? externalDiskFiles(command.titleId) : [];
        const episodes = new Set(external.filter((f) => f.episode != null).map((f) => `${f.season ?? 1}x${f.episode}`));
        logEvent(
          found ? "info" : "warn",
          !found
            ? "Couldn't rescan the folder: its root folder isn't reachable"
            : external.length
              ? `Rescanned the folder: ${external.length} video file(s) not downloaded by Riparr${episodes.size ? ` (${episodes.size} episode(s))` : ""}`
              : `Rescanned the folder: nothing besides Riparr's own downloads (${found.length} file(s))`,
          command.titleId,
        );
      }
      // Pending copies of episodes that turned up on disk aren't needed any more.
      selectAndSettle(command.titleId);
      break;
    }
  }
}

/** Removes partial downloads nothing will resume (e.g. of deleted titles). */
function cleanPartials() {
  try {
    sweepPartials(listRootFolders().map((r) => r.path));
  } catch (err) {
    console.error("[riparr] partial cleanup failed", err);
  }
}

function rescanStale() {
  for (const titleId of staleScans(RESCAN_MS, 3)) {
    try {
      scanTitle(titleId);
    } catch (err) {
      console.error(`[riparr] folder scan of title ${titleId} failed`, err);
    }
  }
}

function tick() {
  for (const command of takeCommands()) handle(command);
  runDueChecks(shutdown.signal);
  rescanStale();
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
    // Free space per root folder, for the dashboard (downloads also check before starting).
    setInterval(() => checkAllRoots(), 60_000),
    setInterval(() => {
      pruneEvents(30 * DAY);
      pruneCommands(DAY);
      cleanPartials();
    }, 60 * 60 * 1000),
  ];
  cleanPartials();
  tick();
  checkAllRoots();
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
