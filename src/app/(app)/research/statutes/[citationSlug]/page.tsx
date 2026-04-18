"use client";

import { useParams } from "next/navigation";
import { StatuteViewer } from "@/components/research/statute-viewer";

export default function StatutePage() {
  const params = useParams<{ citationSlug: string }>();
  return <StatuteViewer citationSlug={params.citationSlug} />;
}
