import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getContainer } from "@/lib/containers";
import { ContainerForm } from "../../container-form";
import { removeContainer } from "../../actions";

export default function EditContainerPage({ params }: PageProps<"/containers/[id]/edit">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Edit container</h1>
      <Suspense fallback={<div className="card h-96 max-w-2xl animate-pulse" />}>
        <EditForm params={params} />
      </Suspense>
    </div>
  );
}

async function EditForm({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const container = getContainer(Number((await params).id));
  if (!container) notFound();

  const { id, name, url, password, poll_interval_min, enabled, poll, target_dir, path_template } = container;
  return (
    <>
      <ContainerForm container={{ id, name, url, password, poll_interval_min, enabled, poll, target_dir, path_template }} />
      <form action={removeContainer} className="card max-w-2xl space-y-3 border-red-500/40 p-5">
        <input type="hidden" name="id" value={id} />
        <p className="text-sm text-muted">
          Deleting stops watching this container and forgets its link history. Downloaded files are kept.
        </p>
        <button className="btn btn-danger">Delete container</button>
      </form>
    </>
  );
}
