import type { ReactNode } from "react";

/** The card holding a settings page's sections (sections draw the dividers between them). */
export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="-mt-px">{children}</div>
    </div>
  );
}

/**
 * One settings section: heading and explanation on the left, fields on the right
 * (from 1000px), stacked on narrower screens.
 */
export function Section({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-border px-4 py-5 md:px-6 md:py-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-6">
      <div>
        <h2 className="font-display text-lg font-medium text-fg">{title}</h2>
        {intro && <div className="mt-1 text-sm text-muted">{intro}</div>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}
