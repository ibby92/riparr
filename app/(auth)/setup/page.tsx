import type { Metadata } from "next";
import { SetupForm } from "../login/login-form";

export const metadata: Metadata = { title: "Set up" };

// The proxy only serves this page while no user exists, and the action refuses otherwise.
export default function SetupPage() {
  return <SetupForm />;
}
