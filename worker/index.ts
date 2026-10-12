import { closeDb, getDb } from "@/lib/db";
import { pruneCommands, takeCommands, type Command } from "@/lib/commands";
import { getSource, scheduleCheckNow, scheduleTitleCheckNow } from "@/lib/sources";
import { recoverInterrupted } from "@/lib/links";
import { debugLogging, logDebug, logEvent, logThrottled, pruneEvents } from "@/lib/events";
import { getSettings, HEARTBEAT_INTERVAL_MS, writeHeartbeat } from "@/lib/settings";
import { startCnlServer } from "./cnl-server";
import { linkSettled, resetFailedExtractions, stopExtraction } from "./extract-runner";
import { checkAllRoots } from "./disk";
import { externalDiskFiles, scanTitle, staleScans } from "@/lib/disk-scan";
import { timeZone } from "@/lib/time";
import { syncStaleSchedules } from "@/lib/schedule";
import { cancelLink, cancelTitle, scheduleDownloads, selectAndSettle } from "./pipeline";
import { runDueChecks } from "./scheduler";
import { sweepPartials } from "./partials";
import { listRootFolders } from "@/lib/root-folders";

const TICK_MS = 2_000;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** Title folders are rescanned this often, a few per tick, to notice files added by hand. */
const RESCAN_MS = 30 * 60 * 1000;

const shutdown = new AbortController();

function handle(command: Command) {
  const { type, ...args } = command;
  logDebug("worker", `Command ${type} ${JSON.stringify(args)}`, "titleId" in command ? command.titleId : null);
  switch (command.type) {
    case "check_now": {
      const source = getSource(command.sourceId);
      if (!source) return;
      scheduleCheckNow(source.id);
      logEvent("info", `Manual check requested: ${source.url}`, source.title_id, "check");
      break;
    }
    case "check_title":
      scheduleTitleCheckNow(command.titleId);
      logEvent("info", "Manual check of every source requested", command.titleId, "check");
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
          "scan",
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
    logThrottled("partials", HOUR, "warn", `Partial download cleanup failed: ${errorText(err)}`, null, "disk");
  }
}

function rescanStale() {
  for (const titleId of staleScans(RESCAN_MS, 3)) {
    try {
      scanTitle(titleId);
    } catch (err) {
      logThrottled(`scan:${titleId}`, HOUR, "warn", `Folder scan failed: ${errorText(err)}`, titleId, "scan");
    }
  }
}

function tick() {
  timeZone(); // applies a changed Settings → General zone to this process
  syncStaleSchedules(); // calendar air dates from TMDB, a couple of titles at a time
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
    logEvent("info", `Click'n'Load listening on port ${port}`, null, "cnl");
    return server;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent("error", `Click'n'Load listener could not start on port ${port}: ${message}`, null, "cnl");
    return null;
  }
}

async function main() {
  getDb(); // open and migrate before anything else
  recoverInterrupted();
  writeHeartbeat();
  logEvent("info", `Worker started (Node ${process.version}${debugLogging() ? ", debug logging on" : ""})`, null, "worker");

  const timers = [
    setInterval(() => {
      try {
        tick();
      } catch (err) {
        // A bug or a database problem would repeat every tick: log it every 10 minutes at most.
        if (logThrottled("tick", 10 * 60_000, "error", `Worker loop failed: ${errorText(err)}`, null, "worker") && err instanceof Error && err.stack) {
          logDebug("worker", `Stack: ${err.stack}`);
        }
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
    logEvent("info", `${signal} received, stopping`, null, "worker");
    timers.forEach(clearInterval);
    cnl?.close();
    stopExtraction();
    shutdown.abort();
    logEvent("info", "Worker stopped", null, "worker");
    closeDb();
    process.exit(0);
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
}

void main();
