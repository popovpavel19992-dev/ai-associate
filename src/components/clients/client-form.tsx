// src/components/clients/client-form.tsx
"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import type { CreateClientInput } from "@/lib/clients";

type Mode = "create";

interface Props {
  mode: Mode;
}

export function ClientForm({ mode }: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [clientType, setClientType] = useState<"individual" | "organization">("individual");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [ein, setEin] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");

  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [country, setCountry] = useState("US");

  const [notes, setNotes] = useState("");

  const [conflictName, setConflictName] = useState("");
  const conflictCheck = trpc.clients.checkConflict.useQuery(
    { name: conflictName },
    { enabled: conflictName.length >= 2 },
  );
  const conflictTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerConflictCheck = (name: string) => {
    if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current);
    conflictTimerRef.current = setTimeout(() => setConflictName(name), 500);
  };

  const create = trpc.clients.create.useMutation({
    onSuccess: ({ client }) => {
      utils.clients.list.invalidate();
      toast.success("Client created");
      router.push(`/clients/${client.id}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    const base = {
      country,
      addressLine1: addressLine1 || undefined,
      addressLine2: addressLine2 || undefined,
      city: city || undefined,
      state: state || undefined,
      zipCode: zipCode || undefined,
      notes: notes || undefined,
    };

    const input: CreateClientInput =
      clientType === "individual"
        ? {
            clientType: "individual",
            firstName,
            lastName,
            dateOfBirth: dateOfBirth || undefined,
            ...base,
          }
        : {
            clientType: "organization",
            companyName,
            ein: ein || undefined,
            industry: industry || undefined,
            website: website || undefined,
            ...base,
          };

    create.mutate(input);
  };

  const canSubmit =
    clientType === "individual"
      ? firstName.trim().length > 0 && lastName.trim().length > 0
      : companyName.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "create" ? "New Client" : "Edit Client"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={clientType === "individual" ? "default" : "outline"}
            onClick={() => setClientType("individual")}
          >
            Individual
          </Button>
          <Button
            type="button"
            variant={clientType === "organization" ? "default" : "outline"}
            onClick={() => setClientType("organization")}
          >
            Organization
          </Button>
        </div>

        {clientType === "individual" ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={100} onBlur={() => { const fullName = `${firstName} ${lastName}`.trim(); if (fullName.length >= 2) triggerConflictCheck(fullName); }} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="dob">Date of birth</Label>
              <Input id="dob" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <Label htmlFor="company">Company name</Label>
              <Input id="company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={200} onBlur={() => { if (companyName.trim().length >= 2) triggerConflictCheck(companyName.trim()); }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ein">EIN</Label>
              <Input id="ein" placeholder="12-3456789" value={ein} onChange={(e) => setEin(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Input id="industry" value={industry} onChange={(e) => setIndustry(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="website">Website</Label>
              <Input id="website" placeholder="https://" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Address</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Line 1" className="col-span-2" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
            <Input placeholder="Line 2" className="col-span-2" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} />
            <Input placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
            <Input placeholder="State" value={state} onChange={(e) => setState(e.target.value)} />
            <Input placeholder="ZIP" value={zipCode} onChange={(e) => setZipCode(e.target.value)} />
            <Input placeholder="Country" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
        </div>

        {conflictCheck.data?.matches && conflictCheck.data.matches.length > 0 && (
          <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
              <div className="space-y-1 text-sm">
                <p className="font-medium text-yellow-500">Potential conflict of interest</p>
                {conflictCheck.data.matches.map((m) => (
                  <p key={m.caseId} className="text-muted-foreground">
                    &ldquo;{m.opposingParty || m.opposingCounsel}&rdquo; in case{" "}
                    <span className="font-medium">{m.caseName}</span>
                    {m.clientDisplayName && <> (client: {m.clientDisplayName})</>}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}

        <Button onClick={submit} disabled={!canSubmit || create.isPending} className="w-full">
          {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create Client
        </Button>
      </CardContent>
    </Card>
  );
}
