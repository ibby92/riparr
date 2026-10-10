import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { titleFormProps } from "../form-props";
import { TitleForm } from "../title-form";

export const metadata: Metadata = { title: "Add title" };

export default function NewTitlePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Add title</h1>
      <Suspense fallback={<div className="card h-96 max-w-2xl animate-pulse" />}>
        <Form />
      </Suspense>
    </div>
  );
}

async function Form() {
  await connection();
  return <TitleForm {...titleFormProps()} />;
}
