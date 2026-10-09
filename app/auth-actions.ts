"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  apiKey,
  checkCredentials,
  clearLoginFailures,
  loginBlocked,
  needsSetup,
  recordLoginFailure,
  setCredentials,
} from "@/lib/auth";
import { credentialsInput } from "@/lib/credentials";
import { clientIp, endSession, startSession } from "@/lib/session";

export type AuthFormState = { error?: string; errors?: Record<string, string[] | undefined>; username?: string };

/** Only same-site relative paths, so `?next=` can't be an open redirect. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const ip = await clientIp();

  if (loginBlocked(ip)) return { error: "Too many failed attempts. Try again in a few minutes.", username };
  if (!checkCredentials(username, password)) {
    recordLoginFailure(ip);
    return { error: "Wrong username or password", username };
  }
  clearLoginFailures(ip);
  await startSession(username);
  redirect(safeNext(formData.get("next")));
}

export async function setup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  // Only the very first user can be created this way.
  if (!needsSetup()) redirect("/login");
  const parsed = credentialsInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { errors: z.flattenError(parsed.error).fieldErrors, username: String(formData.get("username") ?? "") };
  }
  setCredentials(parsed.data.username, parsed.data.password);
  apiKey(); // create it now so it's ready in Settings
  await startSession(parsed.data.username);
  redirect("/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
