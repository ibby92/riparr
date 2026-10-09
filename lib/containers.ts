import { z } from "zod";
import { all, one, run } from "./db";
import { normalizeTargetDir } from "./paths";

export type ContainerStatus = "pending" | "ok" | "needs_attention" | "error";

export type Container = {
  id: number;
  name: string;
  url: string;
  password: string | null;
  poll_interval_min: number;
  enabled: number;
  /** 0 = never fetch the page; links arrive only via Click'n'Load. */
  poll: number;
  target_dir: string;
  path_template: string;
  status: ContainerStatus;
  last_error: string | null;
  last_checked_at: number | null;
  last_changed_at: number | null;
  next_check_at: number;
  created_at: number;
};

export type ContainerWithCounts = Container & { link_count: number; done_count: number };

export const containerInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  url: z
    .string()
    .trim()
    .pipe(z.url({ protocol: /^https?$/, error: "Must be an http(s) URL" })),
  password: z
    .string()
    .trim()
    .transform((v) => v || null),
  poll_interval_min: z.coerce
    .number<string>()
    .int()
    .min(5, "Poll at most every 5 minutes")
    .max(7 * 24 * 60, "Poll at least once a week"),
  target_dir: z
    .string()
    .transform((v, ctx) => {
      const dir = normalizeTargetDir(v);
      if (dir === null) {
        ctx.addIssue({ code: "custom", message: "Must be a relative path inside the downloads folder" });
        return z.NEVER;
      }
      return dir;
    }),
  path_template: z
    .string()
    .trim()
    .min(1, "Template is required")
    .refine((v) => v.includes("{filename}") || v.includes("{name}"), "Template must include {filename} or {name}"),
  enabled: z.preprocess((v) => v === "on" || v === true, z.boolean()),
  poll: z.preprocess((v) => v === "on" || v === true, z.boolean()),
});

export type ContainerInput = z.infer<typeof containerInput>;

const COUNTS = `
  SELECT c.*,
         (SELECT COUNT(*) FROM links l WHERE l.container_id = c.id) AS link_count,
         (SELECT COUNT(*) FROM links l WHERE l.container_id = c.id AND l.status = 'done') AS done_count
    FROM containers c`;

export function listContainers(): ContainerWithCounts[] {
  return all<ContainerWithCounts>(`${COUNTS} ORDER BY c.name COLLATE NOCASE`);
}

export function getContainer(id: number): ContainerWithCounts | undefined {
  return one<ContainerWithCounts>(`${COUNTS} WHERE c.id = ?`, id);
}

export function findContainerByUrl(url: string): Container | undefined {
  return one<Container>("SELECT * FROM containers WHERE url = ?", url);
}

export function createContainer(input: ContainerInput): number {
  const result = run(
    `INSERT INTO containers (name, url, password, poll_interval_min, enabled, poll, target_dir, path_template, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.name,
    input.url,
    input.password,
    input.poll_interval_min,
    input.enabled ? 1 : 0,
    input.poll ? 1 : 0,
    input.target_dir,
    input.path_template,
    Date.now(),
  );
  return Number(result.lastInsertRowid);
}

export function updateContainer(id: number, input: ContainerInput) {
  run(
    `UPDATE containers
        SET name = ?, url = ?, password = ?, poll_interval_min = ?, enabled = ?, poll = ?, target_dir = ?, path_template = ?
      WHERE id = ?`,
    input.name,
    input.url,
    input.password,
    input.poll_interval_min,
    input.enabled ? 1 : 0,
    input.poll ? 1 : 0,
    input.target_dir,
    input.path_template,
    id,
  );
}

export function deleteContainer(id: number) {
  run("DELETE FROM containers WHERE id = ?", id);
}

export function setContainerEnabled(id: number, enabled: boolean) {
  run("UPDATE containers SET enabled = ? WHERE id = ?", enabled ? 1 : 0, id);
}

/** Enabled, polled containers whose next check is due, oldest first. */
export function dueContainers(now = Date.now()): Container[] {
  return all<Container>(
    "SELECT * FROM containers WHERE enabled = 1 AND poll = 1 AND next_check_at <= ? ORDER BY next_check_at",
    now,
  );
}

export function scheduleCheckNow(id: number) {
  run("UPDATE containers SET next_check_at = 0 WHERE id = ?", id);
}

export function recordCheck(
  id: number,
  result: { status: ContainerStatus; error?: string | null; changed: boolean; nextCheckAt: number },
) {
  const now = Date.now();
  run(
    `UPDATE containers
        SET status = ?, last_error = ?, last_checked_at = ?, next_check_at = ?,
            last_changed_at = CASE WHEN ? THEN ? ELSE last_changed_at END
      WHERE id = ?`,
    result.status,
    result.error ?? null,
    now,
    result.nextCheckAt,
    result.changed ? 1 : 0,
    now,
    id,
  );
}
