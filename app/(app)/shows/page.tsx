import { Suspense } from "react";
import type { Metadata } from "next";
import { LibraryView } from "../_library/library-view";
import { LibrarySkeleton } from "../_library/skeletons";

export const metadata: Metadata = { title: "Shows" };

export default function ShowsPage({ searchParams }: PageProps<"/shows">) {
  return (
    <Suspense fallback={<LibrarySkeleton />}>
      <LibraryView type="show" searchParams={searchParams} />
    </Suspense>
  );
}
