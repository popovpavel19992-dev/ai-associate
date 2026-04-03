"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CASE_TYPES, CASE_TYPE_LABELS } from "@/lib/constants";

interface CaseTypeSelectorProps {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

export function CaseTypeSelector({
  value,
  onChange,
  disabled,
}: CaseTypeSelectorProps) {
  return (
    <Select value={value ?? "auto"} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select case type" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">Auto-detect</SelectItem>
        {CASE_TYPES.map((type) => (
          <SelectItem key={type} value={type}>
            {CASE_TYPE_LABELS[type] ?? type}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
