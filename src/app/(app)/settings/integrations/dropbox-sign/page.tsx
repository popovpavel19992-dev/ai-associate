"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function DropboxSignSettingsPage() {
  const utils = trpc.useUtils();
  const [apiKey, setApiKey] = React.useState("");
  const [senderName, setSenderName] = React.useState("");

  const testConn = trpc.caseSignatures.testConnection.useMutation();
  const save = trpc.caseSignatures.saveApiKey.useMutation({
    onSuccess: () => {
      toast.success("Dropbox Sign connected");
      setApiKey("");
      utils.caseSignatures.listTemplates.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const disconnect = trpc.caseSignatures.disconnectApiKey.useMutation({
    onSuccess: () => toast.success("Disconnected"),
  });

  async function onTest() {
    if (!apiKey) return;
    const res = await testConn.mutateAsync({ apiKey });
    if (res.ok) toast.success(`Connected as ${res.email}`);
    else toast.error(res.error ?? "Test failed");
  }

  return (
    <div className="p-6 max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">Dropbox Sign</h1>
      <p className="text-sm text-muted-foreground">
        Paste your Dropbox Sign API key. Find it at app.hellosign.com → API → Production API Key.
      </p>

      <div className="space-y-2">
        <Label>API key</Label>
        <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
      </div>

      <div className="space-y-2">
        <Label>Sender name (optional)</Label>
        <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Your Firm Name" maxLength={200} />
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onTest} disabled={!apiKey || testConn.isPending}>
          Test connection
        </Button>
        <Button onClick={() => save.mutate({ apiKey, senderName: senderName || undefined })} disabled={!apiKey || save.isPending}>
          Save
        </Button>
        <Button variant="destructive" onClick={() => { if (confirm("Disconnect?")) disconnect.mutate(); }}>
          Disconnect
        </Button>
      </div>
    </div>
  );
}
