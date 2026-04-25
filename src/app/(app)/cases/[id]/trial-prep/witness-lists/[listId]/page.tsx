import { WitnessListDetail } from "@/components/cases/trial-prep/witness-list-detail";

export default async function WitnessListDetailPage({
  params,
}: {
  params: Promise<{ id: string; listId: string }>;
}) {
  const { id, listId } = await params;
  return <WitnessListDetail caseId={id} listId={listId} />;
}
