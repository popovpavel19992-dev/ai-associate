// src/app/(app)/clients/[id]/page.tsx
"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { ClientHeader } from "@/components/clients/client-header";
import { ClientInfoSection } from "@/components/clients/client-info-section";
import { ClientAddressSection } from "@/components/clients/client-address-section";
import { ClientNotes } from "@/components/clients/client-notes";
import { ContactsList } from "@/components/clients/contacts-list";
import { ClientCasesList } from "@/components/clients/client-cases-list";
import { PortalAccessPanel } from "@/components/portal/portal-access-panel";

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, error } = trpc.clients.getById.useQuery({ id });
  const profile = trpc.users.getProfile.useQuery();

  if (isLoading) return <div className="p-6 text-sm text-zinc-500">Loading…</div>;
  if (error || !data) return notFound();

  const role = profile.data?.role;
  const canManage =
    data.client.orgId === null
      ? data.client.userId === profile.data?.id
      : role === "owner" || role === "admin";

  return (
    <div className="space-y-6 p-6">
      <ClientHeader
        client={{
          id: data.client.id,
          displayName: data.client.displayName,
          clientType: data.client.clientType,
          status: data.client.status,
        }}
        canManage={canManage}
      />
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <ClientInfoSection client={data.client} />
          <ClientAddressSection client={data.client} />
          <ContactsList clientId={data.client.id} contacts={data.contacts.map((c) => ({ ...c, clientId: data.client.id }))} />
        </div>
        <aside className="space-y-4">
          <ClientCasesList clientId={data.client.id} />
          <PortalAccessPanel clientId={data.client.id} />
          <ClientNotes client={data.client} />
        </aside>
      </div>
    </div>
  );
}
