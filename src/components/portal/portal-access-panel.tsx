"use client";

import { useState } from "react";
import { Loader2, UserPlus, RotateCw, Ban, Check, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

export function PortalAccessPanel({ clientId }: { clientId: string }) {
  const utils = trpc.useUtils();
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");

  const { data: portalUsers, isLoading } = trpc.portalUsers.list.useQuery({ clientId });

  const invite = trpc.portalUsers.invite.useMutation({
    onSuccess: () => {
      utils.portalUsers.list.invalidate({ clientId });
      setShowInvite(false);
      setEmail("");
      setDisplayName("");
    },
  });

  const disable = trpc.portalUsers.disable.useMutation({
    onSuccess: () => utils.portalUsers.list.invalidate({ clientId }),
  });

  const enable = trpc.portalUsers.enable.useMutation({
    onSuccess: () => utils.portalUsers.list.invalidate({ clientId }),
  });

  const resend = trpc.portalUsers.resendInvite.useMutation();

  const deleteUser = trpc.portalUsers.delete.useMutation({
    onSuccess: () => utils.portalUsers.list.invalidate({ clientId }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Portal Access</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setShowInvite(!showInvite)}>
            <UserPlus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showInvite && (
          <div className="space-y-2 rounded border p-2">
            <Input
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-8 text-xs"
            />
            <Input
              placeholder="Display name (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              className="w-full"
              disabled={!email || invite.isPending}
              onClick={() => invite.mutate({ clientId, email, displayName: displayName || undefined })}
            >
              {invite.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Send Invite
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : !portalUsers?.length ? (
          <p className="text-xs text-muted-foreground">No portal users</p>
        ) : (
          portalUsers.map((pu) => (
            <div key={pu.id} className="flex items-center justify-between text-xs">
              <div>
                <p className="font-medium">{pu.displayName}</p>
                <p className="text-muted-foreground">{pu.email}</p>
              </div>
              <div className="flex items-center gap-1">
                <Badge variant="outline" className="text-[10px]">
                  {pu.status}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => resend.mutate({ portalUserId: pu.id })}
                  title="Resend invite"
                >
                  <RotateCw className="h-3 w-3" />
                </Button>
                {pu.status === "active" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => disable.mutate({ portalUserId: pu.id })}
                    title="Disable"
                  >
                    <Ban className="h-3 w-3" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => enable.mutate({ portalUserId: pu.id })}
                    title="Enable"
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive"
                  onClick={() => deleteUser.mutate({ portalUserId: pu.id })}
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
