import { Suspense } from "react";
import type { Metadata } from "next";
import { LibraryView } from "../_library/library-view";
import { LibrarySkeleton } from "../_library/skeletons";

export const metadata: Metadata = { title: "Movies" };

export default function MoviesPage({ searchParams }: PageProps<"/movies">) {
  return (
    <Suspense fallback={<LibrarySkeleton />}>
      <LibraryView type="movie" searchParams={searchParams} />
    </Suspense>
  );
}
