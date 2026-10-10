import { redirect } from "next/navigation";

/** The old library list; the library now lives at /shows and /movies. */
export default function TitlesPage() {
  redirect("/shows");
}
