import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTitle } from "@/lib/titles";
import { removeTitle } from "../../actions";
import { titleFormProps } from "../../form-props";
import { TitleForm } from "../../title-form";

export default function EditTitlePage({ params }: PageProps<"/titles/[id]/edit">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Edit title</h1>
      <Suspense fallback={<div className="card h-96 max-w-2xl animate-pulse" />}>
        <EditForm params={params} />
      </Suspense>
    </div>
  );
}

async function EditForm({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const title = getTitle(Number((await params).id));
  if (!title) notFound();
  return (
    <>
      <TitleForm title={title} {...titleFormProps()} />
      <form action={removeTitle} className="card max-w-2xl space-y-3 border-red-500/40 p-5">
        <input type="hidden" name="id" value={title.id} />
        <p className="text-sm text-muted">
          Deleting removes the title, its sources and download history from Riparr. Files already downloaded stay on disk.
        </p>
        <button className="btn btn-danger">Delete title</button>
      </form>
    </>
  );
}
