import { connection } from "next/server";
import { HEARTBEAT_INTERVAL_MS, workerHeartbeatAge } from "@/lib/settings";

/** Unauthenticated liveness for Docker/uptime monitors: web + DB + worker heartbeat. Reveals nothing else. */
export async function GET() {
  await connection();
  try {
    const age = workerHeartbeatAge();
    const worker = age !== null && age < HEARTBEAT_INTERVAL_MS * 3;
    return Response.json({ status: worker ? "ok" : "worker_down" }, { status: worker ? 200 : 503 });
  } catch {
    return Response.json({ status: "db_error" }, { status: 503 });
  }
}
