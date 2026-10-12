import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { listSources } from "@/lib/sources";
import { getTitle } from "@/lib/titles";
import { Card, PageHeader } from "../../../_kit";
import { AddSourceForm } from "../../../_library/add-source-form";
import { SourcesList } from "../../../_library/title-panels";
import { titleFormProps } from "../../form-props";
import { DeleteTitle, EditTitleForm } from "../../title-form";

export const metadata: Metadata = { title: "Edit title" };

export default function EditTitlePage({ params }: PageProps<"/titles/[id]/edit">) {
  return (
    <div className="mx-auto w-full max-w-[760px]">
      <Suspense fallback={<div className="card h-96 animate-pulse" />}>
        <EditTitle params={params} />
      </Suspense>
    </div>
  );
}

async function EditTitle({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const title = getTitle(Number((await params).id));
  if (!title) notFound();
  const { roots, defaults, tmdbReady } = titleFormProps();
  const sources = listSources(title.id);
  // Request-time render (after connection()): one clock reading per request is intended.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  return (
    <>
      <PageHeader
        title={`Edit ${title.name}`}
        subtitle={
          <>
            Match, folder, naming and the pages Riparr reads.{" "}
            <Link href={`/titles/${title.id}`} className="link">
              Back to the title
            </Link>
          </>
        }
      />
      <div className="flex flex-col gap-3.5">
        <EditTitleForm title={title} roots={roots} defaults={defaults} tmdbReady={tmdbReady} />
        <Card title="Sources" bodyClassName="">
          <SourcesList title={title} sources={sources} now={now} />
          <div className="border-t border-border p-4 md:p-5">
            <h3 className="mb-3 text-sm font-medium text-fg">Add a source</h3>
            <AddSourceForm titleId={title.id} />
          </div>
        </Card>
        <DeleteTitle id={title.id} name={title.name} />
      </div>
    </>
  );
}
