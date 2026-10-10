/** Loading placeholders that roughly match the final layout, so nothing jumps. */
export function LibrarySkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <div className="h-10 w-40 animate-pulse rounded-sm bg-surface-3" />
      <div className="h-8 w-full max-w-md animate-pulse rounded-pill bg-surface-3" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="aspect-[2/3] animate-pulse rounded-[10px] bg-surface-3" />
        ))}
      </div>
    </div>
  );
}

export function TitleSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <div className="card h-64 animate-pulse" />
      <div className="h-10 w-72 animate-pulse rounded-sm bg-surface-3" />
      <div className="card h-80 animate-pulse" />
    </div>
  );
}
