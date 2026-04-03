"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CASE_TYPES,
  CASE_TYPE_LABELS,
  SECTION_LABELS,
} from "@/lib/constants";

const SYSTEM_PRESETS: Record<string, string[]> = {
  personal_injury: [
    "timeline", "key_facts", "parties", "legal_arguments",
    "weak_points", "risk_assessment", "evidence_inventory",
    "applicable_laws", "obligations",
  ],
  family_law: [
    "timeline", "key_facts", "parties", "legal_arguments",
    "obligations", "applicable_laws",
  ],
  traffic_defense: [
    "timeline", "key_facts", "parties", "evidence_inventory",
    "applicable_laws", "weak_points",
  ],
  contract_dispute: [
    "timeline", "key_facts", "parties", "legal_arguments",
    "obligations", "weak_points", "risk_assessment",
  ],
  criminal_defense: [
    "timeline", "key_facts", "parties", "legal_arguments",
    "evidence_inventory", "weak_points", "deposition_questions",
    "applicable_laws",
  ],
  employment_law: [
    "timeline", "key_facts", "parties", "legal_arguments",
    "obligations", "applicable_laws", "risk_assessment",
  ],
  general: [
    "timeline", "key_facts", "parties", "legal_arguments",
    "risk_assessment",
  ],
};

export default function TemplatesPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Analysis Templates
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Section presets for each case type. These determine which analysis
          sections are enabled by default when creating a case.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CASE_TYPES.map((type) => {
          const sections = SYSTEM_PRESETS[type] ?? [];
          return (
            <Card key={type}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  {CASE_TYPE_LABELS[type] ?? type}
                  <Badge variant="secondary" className="text-xs">
                    {sections.length} sections
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {sections.map((section) => (
                    <Badge key={section} variant="outline" className="text-xs">
                      {SECTION_LABELS[section] ?? section}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
