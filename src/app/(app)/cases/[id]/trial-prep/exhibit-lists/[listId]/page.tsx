import { ExhibitListDetail } from "@/components/cases/trial-prep/exhibit-list-detail";

export default async function ExhibitListDetailPage({
  params,
}: {
  params: Promise<{ id: string; listId: string }>;
}) {
  const { id, listId } = await params;
  return <ExhibitListDetail caseId={id} listId={listId} />;
}
