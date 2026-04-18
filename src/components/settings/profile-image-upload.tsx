"use client";

import { useState, useRef } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Props {
  label: string;
  currentUrl: string | null;
  category: "avatar" | "signature";
  /** CSS class for the preview container */
  previewClassName?: string;
  onUploaded: (url: string) => void;
}

export function ProfileImageUpload({ label, currentUrl, category, previewClassName, onUploaded }: Props) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const res = await fetch("/api/upload/presign-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          filename: file.name,
          contentType: file.type,
          fileSize: file.size,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Upload failed");
      }

      const { uploadUrl, s3Key } = await res.json();

      await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      // Construct the public URL from the S3 key
      const publicUrl = `https://${process.env.NEXT_PUBLIC_AWS_S3_BUCKET}.s3.amazonaws.com/${s3Key}`;
      setPreview(publicUrl);
      onUploaded(publicUrl);
      toast.success(`${label} uploaded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-4">
        {preview ? (
          <div className="relative">
            <img
              src={preview}
              alt={label}
              className={previewClassName ?? "h-16 w-16 rounded-full object-cover"}
            />
            <button
              type="button"
              onClick={() => { setPreview(null); onUploaded(""); }}
              className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className={previewClassName ?? "flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/25"}>
            <Upload className="h-5 w-5 text-muted-foreground/50" />
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          {preview ? "Change" : "Upload"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
