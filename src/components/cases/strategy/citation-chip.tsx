"use client";
import { FileText, Calendar, Gavel, FileCheck, MessageSquare } from "lucide-react";
import Link from "next/link";

type Kind = "document" | "deadline" | "filing" | "motion" | "message";

interface Props {
  caseId: string;
  kind: Kind;
  id: string;
  excerpt?: string;
}

const ICON: Record<Kind, typeof FileText> = {
  document: FileText,
  deadline: Calendar,
  filing: FileCheck,
  motion: Gavel,
  message: MessageSquare,
};

const HREF: Record<Kind, (caseId: string, id: string) => string> = {
  document: (c, id) => `/cases/${c}/documents/${id}`,
  deadline: (c) => `/cases/${c}?tab=deadlines`,
  filing: (c) => `/cases/${c}?tab=filings`,
  motion: (c) => `/cases/${c}?tab=motions`,
  message: (c) => `/cases/${c}?tab=messages`,
};

export function CitationChip({ caseId, kind, id, excerpt }: Props) {
  const Icon = ICON[kind];
  const href = HREF[kind](caseId, id);
  return (
    <Link
      href={href}
      title={excerpt}
      className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700"
    >
      <Icon className="size-3" /> {kind}
    </Link>
  );
}
