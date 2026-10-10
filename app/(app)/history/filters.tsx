"use client";

import Form from "next/form";
import type { ReactNode } from "react";

/** GET filter bar for History: submits (client-side navigation) whenever a select changes. */
export function HistoryFilters({ children }: { children: ReactNode }) {
  return (
    <Form
      action="/history"
      replace
      scroll={false}
      className="mb-4 flex flex-wrap items-center gap-2"
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
