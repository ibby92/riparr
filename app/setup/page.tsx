import type { Metadata } from "next";
import { SetupForm } from "../login/login-form";

export const metadata: Metadata = { title: "Set up" };

export default function SetupPage() {
  return (
    <div className="mx-auto mt-16 max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold">Welcome to Riparr</h1>
      <p className="text-sm text-muted">Create the account you&apos;ll use to sign in.</p>
      <SetupForm />
    </div>
  );
}
