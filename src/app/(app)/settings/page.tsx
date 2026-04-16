"use client";

import { useState, useEffect } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ProfileImageUpload } from "@/components/settings/profile-image-upload";
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
  const [bio, setBio] = useState("");
  const [barNumber, setBarNumber] = useState("");
  const [barState, setBarState] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [signatureImageUrl, setSignatureImageUrl] = useState("");

  useEffect(() => {
    if (profile) {
      setName(profile.name ?? "");
      setState(profile.state ?? "");
      setJurisdiction(profile.jurisdiction ?? "");
      setPracticeAreas((profile.practiceAreas as string[]) ?? []);
      setCaseTypes((profile.caseTypes as string[]) ?? []);
      setBio(profile.bio ?? "");
      setBarNumber(profile.barNumber ?? "");
      setBarState(profile.barState ?? "");
      setAvatarUrl(profile.avatarUrl ?? "");
      setSignatureImageUrl(profile.signatureImageUrl ?? "");
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
      bio: bio.trim() || undefined,
      barNumber: barNumber.trim() || undefined,
      barState: barState ? (barState as (typeof US_STATES)[number]) : undefined,
      avatarUrl: avatarUrl || undefined,
      signatureImageUrl: signatureImageUrl || undefined,
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

      <Card>
        <CardHeader>
          <CardTitle>Professional Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <ProfileImageUpload
            label="Profile Photo"
            currentUrl={avatarUrl || null}
            category="avatar"
            previewClassName="h-20 w-20 rounded-full object-cover"
            onUploaded={setAvatarUrl}
          />

          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Brief professional bio visible to clients..."
            />
            <p className="text-xs text-muted-foreground">{bio.length}/2000</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="barNumber">Bar Number</Label>
              <Input
                id="barNumber"
                value={barNumber}
                onChange={(e) => setBarNumber(e.target.value)}
                placeholder="e.g. 12345"
                maxLength={50}
              />
            </div>
            <div className="space-y-2">
              <Label>Bar Admission State</Label>
              <Select value={barState} onValueChange={(v) => setBarState(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  {US_STATES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <ProfileImageUpload
            label="Signature Image"
            currentUrl={signatureImageUrl || null}
            category="signature"
            previewClassName="h-12 w-auto max-w-[200px] rounded border object-contain"
            onUploaded={setSignatureImageUrl}
          />

          <Button onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Changes
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
