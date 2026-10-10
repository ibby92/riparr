import { KNOWN_HOSTS } from "@/lib/host-ids";

/** "MEGA" for "mega"; unknown hosts keep their id. Client-safe. */
export function hostLabelOf(host: string): string {
  return KNOWN_HOSTS.find((h) => h.id === host)?.label ?? host;
}
