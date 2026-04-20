"use client";

import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Upload, FileText } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { FieldSpec } from "@/server/services/intake-forms/schema-validation";

export interface FieldRendererProps {
  field: FieldSpec;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
  caseId: string;
}

export function FieldRenderer({
  field,
  value,
  onChange,
  disabled,
  caseId,
}: FieldRendererProps) {
  switch (field.type) {
    case "short_text":
      return (
        <Input
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          maxLength={500}
        />
      );
    case "long_text":
      return (
        <Textarea
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          maxLength={5000}
          rows={4}
        />
      );
    case "number":
      return (
        <Input
          type="number"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
          disabled={disabled}
          min={field.min}
          max={field.max}
        />
      );
    case "date":
      return (
        <Input
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
          min={field.minDate}
          max={field.maxDate}
        />
      );
    case "yes_no":
      return (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={value === true ? "default" : "outline"}
            onClick={() => onChange(true)}
            disabled={disabled}
          >
            Yes
          </Button>
          <Button
            type="button"
            size="sm"
            variant={value === false ? "default" : "outline"}
            onClick={() => onChange(false)}
            disabled={disabled}
          >
            No
          </Button>
        </div>
      );
    case "select":
      return (
        <Select
          value={(value as string) ?? ""}
          onValueChange={(v) => onChange(v)}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose one…" />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "multi_select": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="space-y-1">
          {field.options?.map((o) => (
            <div key={o.value} className="flex items-center gap-2">
              <input
                id={`${field.id}-${o.value}`}
                type="checkbox"
                className="h-4 w-4"
                checked={arr.includes(o.value)}
                onChange={(e) => {
                  if (e.target.checked) onChange([...arr, o.value]);
                  else onChange(arr.filter((x) => x !== o.value));
                }}
                disabled={disabled}
              />
              <label htmlFor={`${field.id}-${o.value}`}>{o.label}</label>
            </div>
          ))}
        </div>
      );
    }
    case "file_upload":
      return (
        <FileUploadField
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
          caseId={caseId}
        />
      );
  }
}

function FileUploadField({
  value,
  onChange,
  disabled,
  caseId,
}: FieldRendererProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const upload = trpc.portalDocuments.upload.useMutation();
  const confirm = trpc.portalDocuments.confirmUpload.useMutation();

  const currentDocId =
    (value as { documentId?: string } | null)?.documentId ?? null;

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const fileType: "pdf" | "docx" | "image" =
        ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : "image";
      const { uploadUrl, documentId } = await upload.mutateAsync({
        caseId,
        filename: file.name,
        fileType,
      });
      const putResp = await fetch(uploadUrl, { method: "PUT", body: file });
      if (!putResp.ok) {
        toast.error("Upload failed");
        return;
      }
      await confirm.mutateAsync({ documentId });
      setFilename(file.name);
      onChange({ documentId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {currentDocId || filename ? (
        <span className="text-sm inline-flex items-center gap-1 text-muted-foreground">
          <FileText className="w-4 h-4" /> {filename ?? "File attached"}
        </span>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        onClick={() => ref.current?.click()}
        disabled={disabled || uploading}
      >
        <Upload className="w-4 h-4 mr-1" />{" "}
        {uploading ? "Uploading…" : currentDocId ? "Replace" : "Upload"}
      </Button>
      <input
        type="file"
        ref={ref}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          if (ref.current) ref.current.value = "";
        }}
      />
    </div>
  );
}
