"use client";

import { useParams } from "next/navigation";
import { OpinionViewer } from "@/components/research/opinion-viewer";

export default function OpinionPage() {
  const params = useParams<{ opinionId: string }>();
  return <OpinionViewer opinionInternalId={params.opinionId} />;
}
