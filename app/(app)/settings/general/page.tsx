import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { chosenTimeZone, serverTimeZone, timeZones } from "@/lib/time";
import { GeneralForm } from "./general-form";

export const metadata: Metadata = { title: "General" };

export default function GeneralSettingsPage() {
  return (
    <Suspense fallback={<div className="card h-96 animate-pulse" />}>
      <General />
    </Suspense>
  );
}

async function General() {
  await connection();
  return <GeneralForm timeZone={chosenTimeZone()} serverZone={serverTimeZone()} zones={timeZones()} />;
}
