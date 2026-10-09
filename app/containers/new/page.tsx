import type { Metadata } from "next";
import { ContainerForm } from "../container-form";

export const metadata: Metadata = { title: "Add container" };

export default function NewContainerPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Add container</h1>
      <ContainerForm />
    </div>
  );
}
