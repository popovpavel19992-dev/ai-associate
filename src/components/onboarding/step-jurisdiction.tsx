"use client";

import { US_STATES } from "@/lib/constants";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StepJurisdictionProps {
  state: string;
  jurisdiction: string;
  onStateChange: (state: string) => void;
  onJurisdictionChange: (jurisdiction: string) => void;
}

export function StepJurisdiction({
  state,
  jurisdiction,
  onStateChange,
  onJurisdictionChange,
}: StepJurisdictionProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold">Where do you practice?</h2>
      <p className="mt-1 text-sm text-zinc-500">
        This helps us apply the right legal framework to your analyses.
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <Label htmlFor="state">State</Label>
          <Select
            value={state || undefined}
            onValueChange={(val) => {
              if (val) onStateChange(val);
            }}
          >
            <SelectTrigger id="state" className="mt-1.5 w-full">
              <SelectValue placeholder="Select a state" />
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

        <div>
          <Label htmlFor="jurisdiction">Jurisdiction / Court</Label>
          <Input
            id="jurisdiction"
            className="mt-1.5"
            placeholder="e.g., Southern District of New York"
            value={jurisdiction}
            onChange={(e) => onJurisdictionChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
