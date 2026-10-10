import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Suspense fallback={<div className="card h-[340px] animate-pulse" />}>
      <Form searchParams={searchParams} />
    </Suspense>
  );
}

// Read on the server so the form renders (and works) without JavaScript.
// The action re-checks `next` (same-site paths only) before redirecting.
async function Form({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = (await searchParams).next;
  return <LoginForm next={typeof next === "string" ? next : "/"} />;
}
