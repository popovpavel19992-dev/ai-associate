"use client";

import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { MapPin, Scale } from "lucide-react";
import { PRACTICE_AREA_LABELS } from "@/lib/constants";

export function LawyerProfileCard() {
  const { data: lawyer } = trpc.portalLawyer.getProfile.useQuery();

  if (!lawyer) return null;

  return (
    <Card>
      <CardContent className="flex items-start gap-4 pt-6">
        {lawyer.avatarUrl ? (
          <img
            src={lawyer.avatarUrl}
            alt={lawyer.name}
            className="h-16 w-16 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
            {lawyer.name.charAt(0)}
          </div>
        )}
        <div className="min-w-0 space-y-1">
          <h3 className="text-lg font-semibold">{lawyer.name}</h3>
          {lawyer.bio && (
            <p className="text-sm text-muted-foreground line-clamp-3">{lawyer.bio}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {lawyer.jurisdiction && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {lawyer.jurisdiction}
              </span>
            )}
            {lawyer.barNumber && (
              <span className="flex items-center gap-1">
                <Scale className="h-3 w-3" /> Bar #{lawyer.barNumber}
                {lawyer.barState && ` (${lawyer.barState})`}
              </span>
            )}
          </div>
          {lawyer.practiceAreas && (lawyer.practiceAreas as string[]).length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {(lawyer.practiceAreas as string[]).slice(0, 4).map((area) => (
                <span key={area} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {PRACTICE_AREA_LABELS[area] ?? area}
                </span>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
