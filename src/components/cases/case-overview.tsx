"use client";

import { FileText, FileCheck, Clock, Scale } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { CaseCaptionCard, type CaseCaption } from "./case-caption-card";
import { JURISDICTION_LABELS } from "@/lib/constants";

interface CaseOverviewProps {
  caseId: string;
  stage: { name: string; color: string; description: string } | null;
  stageChangedAt: Date | string | null;
  description: string | null;
  documentsCount: number;
  contractsCount: number;
  stageTaskTemplates: { title: string; priority: string }[];
  opposingParty: string | null;
  opposingCounsel: string | null;
  caption: CaseCaption;
  jurisdiction?: string | null;
}

export function CaseOverview({
  caseId,
  stage,
  stageChangedAt,
  description,
  documentsCount,
  contractsCount,
  stageTaskTemplates,
  opposingParty,
  opposingCounsel,
  caption,
  jurisdiction,
}: CaseOverviewProps) {
  const jurisdictionCode = jurisdiction ?? "FEDERAL";
  const jurisdictionLabel = JURISDICTION_LABELS[jurisdictionCode] ?? jurisdictionCode;
  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      {/* Current Stage */}
      {stage && (
        <div className="rounded-lg border border-zinc-800 p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
            Current Stage
          </p>
          <p className="text-lg font-semibold" style={{ color: stage.color }}>
            {stage.name}
          </p>
          <p className="mt-1 text-xs text-zinc-400">{stage.description}</p>
          {stageChangedAt && (
            <p className="mt-2 flex items-center gap-1 text-xs text-zinc-500">
              <Clock className="size-3" />
              Since {formatDistanceToNow(new Date(stageChangedAt), { addSuffix: true })}
            </p>
          )}
        </div>
      )}

      {/* Stage Task Templates */}
      <div className="rounded-lg border border-zinc-800 p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Stage Tasks
        </p>
        {stageTaskTemplates.length > 0 ? (
          <div className="space-y-1.5">
            {stageTaskTemplates.map((task, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="size-1.5 rounded-full bg-zinc-600" />
                <span className="text-zinc-300">{task.title}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No tasks for this stage</p>
        )}
      </div>

      {/* Description */}
      <div className="rounded-lg border border-zinc-800 p-4 md:col-span-2">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Description
        </p>
        <p className="text-sm text-zinc-300">
          {description || "No description provided."}
        </p>
      </div>

      {/* Opposing Parties */}
      <div className="rounded-lg border border-zinc-800 p-4 md:col-span-2">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Opposing Parties
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-zinc-500 mb-1">Opposing Party</p>
            <p className="text-sm text-zinc-300">{opposingParty || "\u2014"}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-1">Opposing Counsel</p>
            <p className="text-sm text-zinc-300">{opposingCounsel || "\u2014"}</p>
          </div>
        </div>
      </div>

      {/* Litigation Caption */}
      <CaseCaptionCard caseId={caseId} caption={caption} />

      {/* Quick Stats */}
      <div className="flex flex-wrap gap-4 md:col-span-2">
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 px-4 py-3">
          <FileText className="size-4 text-zinc-500" />
          <span className="text-sm font-medium">{documentsCount}</span>
          <span className="text-xs text-zinc-500">Documents</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 px-4 py-3">
          <FileCheck className="size-4 text-zinc-500" />
          <span className="text-sm font-medium">{contractsCount}</span>
          <span className="text-xs text-zinc-500">Contracts</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 px-4 py-3" title="Deadline rules and court calendar follow this jurisdiction.">
          <Scale className="size-4 text-zinc-500" />
          <span className="text-sm font-medium">{jurisdictionLabel}</span>
          <span className="text-xs text-zinc-500">({jurisdictionCode})</span>
        </div>
      </div>
    </div>
  );
}
