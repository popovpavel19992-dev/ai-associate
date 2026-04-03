"use client";

import { useState, useEffect } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  PRACTICE_AREAS,
  PRACTICE_AREA_LABELS,
  CASE_TYPES,
  CASE_TYPE_LABELS,
  US_STATES,
} from "@/lib/constants";

export default function SettingsPage() {
  const { data: profile, isLoading } = trpc.users.getProfile.useQuery();
  const utils = trpc.useUtils();

  const [name, setName] = useState("");
  const [state, setState] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [practiceAreas, setPracticeAreas] = useState<string[]>([]);
  const [caseTypes, setCaseTypes] = useState<string[]>([]);

  useEffect(() => {
    if (profile) {
      setName(profile.name ?? "");
      setState(profile.state ?? "");
      setJurisdiction(profile.jurisdiction ?? "");
      setPracticeAreas((profile.practiceAreas as string[]) ?? []);
      setCaseTypes((profile.caseTypes as string[]) ?? []);
    }
  }, [profile]);

  const update = trpc.users.updateProfile.useMutation({
    onSuccess: () => {
      utils.users.getProfile.invalidate();
    },
  });

  const toggleItem = (list: string[], item: string, setter: (v: string[]) => void) => {
    setter(list.includes(item) ? list.filter((i) => i !== item) : [...list, item]);
  };

  const handleSave = () => {
    update.mutate({
      name: name.trim() || undefined,
      state: state ? (state as (typeof US_STATES)[number]) : undefined,
      jurisdiction: jurisdiction.trim() || undefined,
      practiceAreas:
        practiceAreas.length > 0
          ? (practiceAreas as (typeof PRACTICE_AREAS)[number][])
          : undefined,
      caseTypes:
        caseTypes.length > 0
          ? (caseTypes as (typeof CASE_TYPES)[number][])
          : undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your profile and preferences.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>State</Label>
              <Select value={state} onValueChange={(v) => setState(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  {US_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="jurisdiction">Jurisdiction</Label>
              <Input
                id="jurisdiction"
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                placeholder="e.g. Southern District of New York"
                maxLength={200}
              />
            </div>
          </div>

          <div className="space-y-3">
            <Label>Practice Areas</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PRACTICE_AREAS.map((area) => (
                <label
                  key={area}
                  className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  <input
                    type="checkbox"
                    checked={practiceAreas.includes(area)}
                    onChange={() => toggleItem(practiceAreas, area, setPracticeAreas)}
                    className="rounded border-zinc-300"
                  />
                  {PRACTICE_AREA_LABELS[area] ?? area}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Label>Typical Case Types</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CASE_TYPES.map((ct) => (
                <label
                  key={ct}
                  className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  <input
                    type="checkbox"
                    checked={caseTypes.includes(ct)}
                    onChange={() => toggleItem(caseTypes, ct, setCaseTypes)}
                    className="rounded border-zinc-300"
                  />
                  {CASE_TYPE_LABELS[ct] ?? ct}
                </label>
              ))}
            </div>
          </div>

          <Button onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Changes
          </Button>

          {update.isSuccess && (
            <p className="text-sm text-green-600">Profile updated.</p>
          )}
          {update.error && (
            <p className="text-sm text-red-500">{update.error.message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
