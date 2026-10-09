import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div className="mx-auto mt-16 max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <Suspense fallback={<div className="card h-56 animate-pulse" />}>
        <Form searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

// Read on the server so the form renders (and works) without JavaScript.
async function Form({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = (await searchParams).next;
  return <LoginForm next={typeof next === "string" ? next : "/"} />;
}
