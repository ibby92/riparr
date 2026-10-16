import { all, one, run } from "./db";
import { getSetting } from "./settings";
import type { HostAccount } from "./hosts/types";

export type AccountField = { key: string; label: string; secret: boolean; hint?: string };

/** Credential fields each resolver understands (see lib/hosts/*). */
export const ACCOUNT_FIELDS: Record<string, { label: string; fields: AccountField[] }> = {
  pixeldrain: {
    label: "pixeldrain",
    fields: [{ key: "apiKey", label: "API key", secret: true, hint: "From pixeldrain.com/user/api_keys; raises limits" }],
  },
  gofile: {
    label: "gofile",
    fields: [
      { key: "token", label: "Account token", secret: true, hint: "Premium token; leave empty to use a guest account" },
      {
        key: "wtSalt",
        label: "Website token salt",
        secret: false,
        hint: "Only set this if gofile changes its salt and folders start failing",
      },
    ],
  },
};

/** Setting holding gofile's website-token salt as last read from gofile (lib/hosts/gofile-salt.ts). */
export const GOFILE_SALT_KEY = "gofile.wt_salt";

/**
 * Stored credentials for a host, or null if none are set or the account is disabled. For gofile,
 * the refreshed salt fills in when the account has no `wtSalt` of its own.
 */
export function hostAccount(host: string): HostAccount | null {
  const row = one<{ credentials: string }>(
    "SELECT credentials FROM host_accounts WHERE host = ? AND enabled = 1",
    host,
  );
  const account = row ? (JSON.parse(row.credentials) as HostAccount) : null;
  const learned = host === "gofile" ? getSetting(GOFILE_SALT_KEY) : undefined;
  return learned && !account?.wtSalt ? { ...account, wtSalt: learned } : account;
}

export function listHostAccounts(): Record<string, HostAccount> {
  return Object.fromEntries(
    all<{ host: string; credentials: string }>("SELECT host, credentials FROM host_accounts").map((r) => [
      r.host,
      JSON.parse(r.credentials) as HostAccount,
    ]),
  );
}

/** Saves non-empty fields for a host; removes the account when every field is empty. */
export function saveHostAccount(host: string, values: HostAccount) {
  const credentials = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
  if (Object.keys(credentials).length === 0) {
    run("DELETE FROM host_accounts WHERE host = ?", host);
    return;
  }
  run(
    `INSERT INTO host_accounts (host, credentials, enabled) VALUES (?, ?, 1)
     ON CONFLICT(host) DO UPDATE SET credentials = excluded.credentials`,
    host,
    JSON.stringify(credentials),
  );
}
