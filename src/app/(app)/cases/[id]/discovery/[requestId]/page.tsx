import { DiscoveryRequestDetail } from "@/components/cases/discovery/discovery-request-detail";

export default async function DiscoveryRequestPage({
  params,
}: {
  params: Promise<{ id: string; requestId: string }>;
}) {
  const { id, requestId } = await params;
  return <DiscoveryRequestDetail caseId={id} requestId={requestId} />;
}
