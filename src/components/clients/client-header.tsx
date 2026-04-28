"use client";

import { Archive, ArchiveRestore, MessageSquare } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { ClientTypeBadge } from "./client-type-badge";
import { ClientStatusPill } from "./client-status-pill";

interface Props {
  client: {
    id: string;
    displayName: string;
    clientType: "individual" | "organization";
    status: "active" | "archived";
  };
  canManage: boolean;
}

export function ClientHeader({ client, canManage }: Props) {
  const utils = trpc.useUtils();
  const archive = trpc.clients.archive.useMutation({
    onSuccess: () => {
      utils.clients.getById.invalidate({ id: client.id });
      utils.clients.list.invalidate();
      toast.success("Client archived");
    },
    onError: (err) => toast.error(err.message),
  });
  const restore = trpc.clients.restore.useMutation({
    onSuccess: () => {
      utils.clients.getById.invalidate({ id: client.id });
      utils.clients.list.invalidate();
      toast.success("Client restored");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="flex items-start justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{client.displayName}</h1>
        <div className="flex items-center gap-2">
          <ClientTypeBadge type={client.clientType} />
          <ClientStatusPill status={client.status} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link href={`/clients/${client.id}/comms`}>
          <Button variant="outline" size="sm">
            <MessageSquare className="mr-2 h-4 w-4" />
            Comms
          </Button>
        </Link>
        {canManage ? (
          client.status === "active" ? (
            <Button variant="outline" size="sm" onClick={() => archive.mutate({ id: client.id })}>
              <Archive className="mr-2 h-4 w-4" />
              Archive
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => restore.mutate({ id: client.id })}>
              <ArchiveRestore className="mr-2 h-4 w-4" />
              Restore
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}
