import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getSettings } from "@/lib/settings";
import { NotificationsForm } from "./notifications-form";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationSettingsPage() {
  return (
    <Suspense fallback={<div className="card h-96 animate-pulse" />}>
      <Notifications />
    </Suspense>
  );
}

async function Notifications() {
  await connection();
  const s = getSettings();
  return (
    <NotificationsForm
      settings={{ notifyWebhookUrl: s.notifyWebhookUrl, notifyAppriseUrl: s.notifyAppriseUrl, notifyEvents: s.notifyEvents }}
    />
  );
}
