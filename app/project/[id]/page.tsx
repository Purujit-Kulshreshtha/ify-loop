"use client";

import Looper from "@/components/Looper";
import { useParams, useSearchParams } from "next/navigation";
import type { ProjectSource } from "@/lib/projects";

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const source = search.get("source") === "folder" ? "folder" : "opfs";
  return <Looper projectId={params.id} source={source as ProjectSource} />;
}
