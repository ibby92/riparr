import { redirect } from "next/navigation";

/** Settings has one page per category; the first is Media Management. */
export default function SettingsIndex() {
  redirect("/settings/media");
}
