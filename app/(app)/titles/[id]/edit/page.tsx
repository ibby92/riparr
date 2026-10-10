import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTitle } from "@/lib/titles";
import { PageHeader } from "../../../_kit";
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
  return (
    <>
      <PageHeader
        title={`Edit ${title.name}`}
        subtitle={
          <>
            Match, folder and naming. Sources are managed on the{" "}
            <Link href={`/titles/${title.id}`} className="link">
              title page
            </Link>
            .
          </>
        }
      />
      <div className="flex flex-col gap-3.5">
        <EditTitleForm title={title} roots={roots} defaults={defaults} tmdbReady={tmdbReady} />
        <DeleteTitle id={title.id} name={title.name} />
      </div>
    </>
  );
}
