"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { PublicIntakeFieldDef } from "@/server/db/schema/public-intake-templates";

interface PublicIntakeFormProps {
  orgSlug: string;
  templateSlug: string;
  fields: PublicIntakeFieldDef[];
  thankYouMessage: string | null | undefined;
}

const CONTACT_NAME_KEYS = ["name", "full_name", "fullname", "your_name"];
const CONTACT_EMAIL_KEYS = ["email", "email_address"];
const CONTACT_PHONE_KEYS = ["phone", "phone_number", "telephone"];

function pickContactValue(answers: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = answers[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

export function PublicIntakeForm({ orgSlug, templateSlug, fields, thankYouMessage }: PublicIntakeFormProps) {
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [submitterName, setSubmitterName] = React.useState("");
  const [submitterEmail, setSubmitterEmail] = React.useState("");
  const [submitterPhone, setSubmitterPhone] = React.useState("");
  const [honeypot, setHoneypot] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState<{ message: string | null } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function setValue(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client-side required check.
    const missing = fields.filter((f) => {
      if (!f.required) return false;
      const v = values[f.key];
      if (v === undefined || v === null) return true;
      if (typeof v === "string" && v.trim().length === 0) return true;
      if (Array.isArray(v) && v.length === 0) return true;
      return false;
    });
    if (missing.length > 0) {
      setError(`Please fill in: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }

    setSubmitting(true);
    try {
      // Derive contact info from explicit fields if user left top-level blank.
      const finalName = submitterName.trim() || pickContactValue(values, CONTACT_NAME_KEYS) || "";
      const finalEmail = submitterEmail.trim() || pickContactValue(values, CONTACT_EMAIL_KEYS) || "";
      const finalPhone = submitterPhone.trim() || pickContactValue(values, CONTACT_PHONE_KEYS) || "";

      const res = await fetch("/api/public-intake/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgSlug,
          templateSlug,
          submitterName: finalName,
          submitterEmail: finalEmail,
          submitterPhone: finalPhone,
          answers: values,
          honeypot,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Submission failed");
        setSubmitting(false);
        return;
      }
      setDone({ message: json.thankYouMessage ?? thankYouMessage ?? null });
    } catch (err) {
      setError((err as Error).message ?? "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
        <p className="font-medium">Thank you — your submission has been received.</p>
        {done.message ? <p className="mt-2 whitespace-pre-wrap">{done.message}</p> : null}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="submitter-name">Your name</Label>
          <Input
            id="submitter-name"
            value={submitterName}
            onChange={(e) => setSubmitterName(e.target.value)}
            autoComplete="name"
          />
        </div>
        <div>
          <Label htmlFor="submitter-email">Email</Label>
          <Input
            id="submitter-email"
            type="email"
            value={submitterEmail}
            onChange={(e) => setSubmitterEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="submitter-phone">Phone (optional)</Label>
          <Input
            id="submitter-phone"
            type="tel"
            value={submitterPhone}
            onChange={(e) => setSubmitterPhone(e.target.value)}
            autoComplete="tel"
          />
        </div>
      </div>

      {fields.map((field) => (
        <FieldRenderer
          key={field.id}
          field={field}
          value={values[field.key]}
          onChange={(v) => setValue(field.key, v)}
        />
      ))}

      {/* Honeypot — visible to bots, hidden from humans by absolute off-screen positioning + aria-hidden. */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", top: "auto", width: "1px", height: "1px", overflow: "hidden" }}
      >
        <label htmlFor="website_url">Website</label>
        <input
          id="website_url"
          name="website_url"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </form>
  );
}

function FieldRenderer({
  field,
  value,
  onChange,
}: {
  field: PublicIntakeFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `field-${field.id}`;
  const labelEl = (
    <Label htmlFor={id}>
      {field.label}
      {field.required ? <span className="ml-1 text-red-500">*</span> : null}
    </Label>
  );
  const help = field.helpText ? (
    <p className="mt-1 text-xs text-zinc-500">{field.helpText}</p>
  ) : null;

  switch (field.type) {
    case "textarea":
      return (
        <div>
          {labelEl}
          <Textarea
            id={id}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
          />
          {help}
        </div>
      );
    case "select":
      return (
        <div>
          {labelEl}
          <select
            id={id}
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">— Select —</option>
            {(field.options ?? []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          {help}
        </div>
      );
    case "multiselect": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div>
          {labelEl}
          <div className="mt-1 space-y-1">
            {(field.options ?? []).map((opt) => (
              <label key={opt} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={arr.includes(opt)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...arr, opt]
                      : arr.filter((x) => x !== opt);
                    onChange(next);
                  }}
                />
                {opt}
              </label>
            ))}
          </div>
          {help}
        </div>
      );
    }
    case "yes_no":
      return (
        <div>
          {labelEl}
          <div className="mt-1 flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={id}
                checked={value === "yes"}
                onChange={() => onChange("yes")}
              />
              Yes
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={id}
                checked={value === "no"}
                onChange={() => onChange("no")}
              />
              No
            </label>
          </div>
          {help}
        </div>
      );
    case "number":
      return (
        <div>
          {labelEl}
          <Input
            id={id}
            type="number"
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          />
          {help}
        </div>
      );
    case "date":
      return (
        <div>
          {labelEl}
          <Input
            id={id}
            type="date"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
          {help}
        </div>
      );
    case "email":
      return (
        <div>
          {labelEl}
          <Input
            id={id}
            type="email"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
          {help}
        </div>
      );
    case "phone":
      return (
        <div>
          {labelEl}
          <Input
            id={id}
            type="tel"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
          {help}
        </div>
      );
    case "text":
    default:
      return (
        <div>
          {labelEl}
          <Input
            id={id}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
          {help}
        </div>
      );
  }
}
