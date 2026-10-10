import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { AddTitle } from "../_add/add-title";
import { titleFormProps } from "../form-props";

export const metadata: Metadata = { title: "Add title" };

export default function NewTitlePage() {
  return (
    <div className="-mx-4 md:mx-0 md:py-4">
      <Suspense fallback={<div className="card mx-auto h-96 w-full max-w-[720px] animate-pulse rounded-lg" />}>
        <AddTitleLoader />
      </Suspense>
    </div>
  );
}

async function AddTitleLoader() {
  await connection();
  return <AddTitle {...titleFormProps()} />;
}
