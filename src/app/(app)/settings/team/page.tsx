"use client";

import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { TeamMembersTable } from "@/components/team/team-members-table";
import { PendingInvitesBanner } from "@/components/team/pending-invites-banner";
import { InviteMemberModal } from "@/components/team/invite-member-modal";

export default function TeamPage() {
  const { data: profile, isLoading } = trpc.users.getProfile.useQuery();
  const { data: members = [] } = trpc.team.list.useQuery(undefined, {
    enabled: !!profile?.orgId,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile?.orgId || !profile?.role || !["owner", "admin"].includes(profile.role)) {
    return (
      <div className="py-12 text-center text-zinc-500">
        You don&apos;t have permission to view this page.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team Members</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {members.length} of {profile.maxSeats ?? 5} seats used
          </p>
        </div>
        <InviteMemberModal
          currentUserRole={profile.role}
          seatCount={members.length}
          maxSeats={profile.maxSeats ?? 5}
        />
      </div>

      <PendingInvitesBanner />

      <TeamMembersTable currentUserRole={profile.role} currentUserId={profile.id} />
    </div>
  );
}
