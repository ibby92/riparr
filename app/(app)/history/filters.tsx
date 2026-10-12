"use client";

import Form from "next/form";
import type { ReactNode } from "react";

/** GET filter bar (History, Logs): submits (client-side navigation) whenever a select changes; text fields on Enter. */
export function HistoryFilters({ children, action = "/history", className = "" }: { children: ReactNode; action?: string; className?: string }) {
  return (
    <Form
      action={action}
      replace
      scroll={false}
      className={`flex flex-wrap items-center gap-2 ${className}`}
      onChange={(e) => {
        if (e.target instanceof HTMLSelectElement) e.currentTarget.requestSubmit();
      }}
    >
      {children}
      <noscript>
        <button className="btn">Apply</button>
      </noscript>
    </Form>
  );
}
