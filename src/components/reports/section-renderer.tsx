"use client";

import {
  Calendar,
  CheckCircle,
  AlertTriangle,
  Users,
  Scale,
  Shield,
  FileSearch,
  BookOpen,
  HelpCircle,
  Clock,
  XCircle,
  CircleDot,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SECTION_LABELS } from "@/lib/constants";
import type { AnalysisOutput } from "@/lib/schemas";
import { cn } from "@/lib/utils";

interface SectionRendererProps {
  sectionName: keyof AnalysisOutput;
  data: unknown;
  userEdits?: unknown;
}

export function SectionRenderer({
  sectionName,
  data,
  userEdits,
}: SectionRendererProps) {
  const displayData = userEdits ?? data;
  if (!displayData) return null;

  const label = SECTION_LABELS[sectionName] ?? sectionName;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <SectionIcon name={sectionName} />
        <h3 className="text-sm font-semibold">{label}</h3>
        {userEdits != null && (
          <Badge variant="secondary" className="text-[10px]">
            Edited
          </Badge>
        )}
      </div>
      <div className="pl-6">
        {renderSection(sectionName, displayData)}
      </div>
    </div>
  );
}

function SectionIcon({ name }: { name: string }) {
  const cls = "size-4 text-muted-foreground";
  switch (name) {
    case "timeline": return <Calendar className={cls} />;
    case "key_facts": return <CheckCircle className={cls} />;
    case "parties": return <Users className={cls} />;
    case "legal_arguments": return <Scale className={cls} />;
    case "weak_points": return <AlertTriangle className={cls} />;
    case "risk_assessment": return <Shield className={cls} />;
    case "evidence_inventory": return <FileSearch className={cls} />;
    case "applicable_laws": return <BookOpen className={cls} />;
    case "deposition_questions": return <HelpCircle className={cls} />;
    case "obligations": return <Clock className={cls} />;
    default: return <CircleDot className={cls} />;
  }
}

function renderSection(name: string, data: unknown): React.ReactNode {
  switch (name) {
    case "timeline": return <TimelineSection data={data as TimelineEntry[]} />;
    case "key_facts": return <KeyFactsSection data={data as KeyFact[]} />;
    case "parties": return <PartiesSection data={data as Party[]} />;
    case "legal_arguments": return <LegalArgumentsSection data={data as LegalArguments} />;
    case "weak_points": return <WeakPointsSection data={data as WeakPoint[]} />;
    case "risk_assessment": return <RiskAssessmentSection data={data as RiskAssessment} />;
    case "evidence_inventory": return <EvidenceSection data={data as EvidenceItem[]} />;
    case "applicable_laws": return <ApplicableLawsSection data={data as ApplicableLaw[]} />;
    case "deposition_questions": return <DepositionSection data={data as DepositionQuestion[]} />;
    case "obligations": return <ObligationsSection data={data as Obligation[]} />;
    default: return <pre className="text-xs">{JSON.stringify(data, null, 2)}</pre>;
  }
}

// --- Types ---

interface TimelineEntry { date: string; event: string; source_doc?: string; significance?: "high" | "medium" | "low" }
interface KeyFact { fact: string; source?: string; disputed?: boolean }
interface Party { name: string; role: string; description?: string }
interface LegalArgument { argument: string; strength: "strong" | "moderate" | "weak" }
interface LegalArguments { plaintiff: LegalArgument[]; defendant: LegalArgument[] }
interface WeakPoint { point: string; severity: "high" | "medium" | "low"; recommendation: string }
interface RiskAssessment { score: number; factors: string[] }
interface EvidenceItem { item: string; type: string; status: "available" | "missing" | "contested" }
interface ApplicableLaw { statute: string; relevance: string }
interface DepositionQuestion { question: string; target: string; purpose: string }
interface Obligation { description: string; deadline?: string; recurring?: boolean }

// --- Section Components ---

const significanceColors = {
  high: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  low: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function TimelineSection({ data }: { data: TimelineEntry[] }) {
  if (!Array.isArray(data)) return null;
  return (
    <div className="relative space-y-0 border-l-2 border-muted pl-4">
      {data.map((entry, i) => (
        <div key={i} className="relative pb-4 last:pb-0">
          <div className="absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-background bg-muted-foreground" />
          <div className="flex items-start gap-2">
            <span className="shrink-0 text-xs font-mono text-muted-foreground">{entry.date}</span>
            {entry.significance && (
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", significanceColors[entry.significance])}>
                {entry.significance}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm">{entry.event}</p>
          {entry.source_doc && (
            <span className="text-xs text-muted-foreground">Source: {entry.source_doc}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function KeyFactsSection({ data }: { data: KeyFact[] }) {
  if (!Array.isArray(data)) return null;
  return (
    <ul className="space-y-2">
      {data.map((fact, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <CheckCircle className="mt-0.5 size-3.5 shrink-0 text-green-600" />
          <div>
            <span>{fact.fact}</span>
            {fact.disputed && (
              <Badge variant="destructive" className="ml-2 text-[10px]">Disputed</Badge>
            )}
            {fact.source && (
              <span className="ml-1 text-xs text-muted-foreground">[{fact.source}]</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PartiesSection({ data }: { data: Party[] }) {
  if (!Array.isArray(data)) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {data.map((party, i) => (
        <Card key={i} className="gap-1 p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{party.name}</span>
            <Badge variant="outline" className="text-[10px]">{party.role}</Badge>
          </div>
          {party.description && (
            <p className="text-xs text-muted-foreground">{party.description}</p>
          )}
        </Card>
      ))}
    </div>
  );
}

const strengthColors = {
  strong: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  moderate: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  weak: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

function LegalArgumentsSection({ data }: { data: LegalArguments }) {
  if (!data?.plaintiff && !data?.defendant) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Plaintiff</h4>
        <ul className="space-y-2">
          {(data.plaintiff ?? []).map((arg, i) => (
            <li key={i} className="text-sm">
              <span className={cn("mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", strengthColors[arg.strength])}>
                {arg.strength}
              </span>
              {arg.argument}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Defendant</h4>
        <ul className="space-y-2">
          {(data.defendant ?? []).map((arg, i) => (
            <li key={i} className="text-sm">
              <span className={cn("mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", strengthColors[arg.strength])}>
                {arg.strength}
              </span>
              {arg.argument}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const severityColors = {
  high: "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950",
  medium: "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950",
  low: "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900",
};

function WeakPointsSection({ data }: { data: WeakPoint[] }) {
  if (!Array.isArray(data)) return null;
  return (
    <div className="space-y-2">
      {data.map((wp, i) => (
        <div key={i} className={cn("rounded-lg border p-3", severityColors[wp.severity])}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="text-sm font-medium">{wp.point}</span>
            <Badge variant="outline" className="ml-auto text-[10px]">{wp.severity}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{wp.recommendation}</p>
        </div>
      ))}
    </div>
  );
}

function RiskAssessmentSection({ data }: { data: RiskAssessment }) {
  if (!data?.score) return null;
  const pct = (data.score / 10) * 100;
  const color = data.score >= 7 ? "bg-red-500" : data.score >= 4 ? "bg-amber-500" : "bg-green-500";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative h-3 w-32 overflow-hidden rounded-full bg-muted">
          <div className={cn("absolute inset-y-0 left-0 rounded-full", color)} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-lg font-bold">{data.score}/10</span>
      </div>
      <ul className="space-y-1">
        {(data.factors ?? []).map((factor, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
            {factor}
          </li>
        ))}
      </ul>
    </div>
  );
}

const evidenceStatusIcons = {
  available: <CheckCircle className="size-3.5 text-green-600" />,
  missing: <XCircle className="size-3.5 text-red-500" />,
  contested: <AlertTriangle className="size-3.5 text-amber-500" />,
};

function EvidenceSection({ data }: { data: EvidenceItem[] }) {
  if (!Array.isArray(data)) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="pb-2 pr-4">Item</th>
            <th className="pb-2 pr-4">Type</th>
            <th className="pb-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="py-2 pr-4">{item.item}</td>
              <td className="py-2 pr-4 text-muted-foreground">{item.type}</td>
              <td className="py-2">
                <div className="flex items-center gap-1.5">
                  {evidenceStatusIcons[item.status]}
                  <span className="capitalize">{item.status}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApplicableLawsSection({ data }: { data: ApplicableLaw[] }) {
  if (!Array.isArray(data)) return null;
  return (
    <ul className="space-y-2">
      {data.map((law, i) => (
        <li key={i} className="text-sm">
          <span className="font-medium">{law.statute}</span>
          <span className="ml-1 text-muted-foreground">— {law.relevance}</span>
        </li>
      ))}
    </ul>
  );
}

function DepositionSection({ data }: { data: DepositionQuestion[] }) {
  if (!Array.isArray(data)) return null;

  const grouped = data.reduce<Record<string, DepositionQuestion[]>>((acc, q) => {
    const key = q.target || "General";
    if (!acc[key]) acc[key] = [];
    acc[key].push(q);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([target, questions]) => (
        <div key={target}>
          <h4 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">{target}</h4>
          <ul className="space-y-1.5">
            {questions.map((q, i) => (
              <li key={i} className="text-sm">
                <p>{q.question}</p>
                <p className="text-xs text-muted-foreground">Purpose: {q.purpose}</p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ObligationsSection({ data }: { data: Obligation[] }) {
  if (!Array.isArray(data)) return null;
  return (
    <ul className="space-y-2">
      {data.map((ob, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div>
            <span>{ob.description}</span>
            {ob.deadline && (
              <Badge variant="outline" className="ml-2 text-[10px]">{ob.deadline}</Badge>
            )}
            {ob.recurring && (
              <Badge variant="secondary" className="ml-1 text-[10px]">Recurring</Badge>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
