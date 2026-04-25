import { DepositionOutlineDetail } from "@/components/cases/trial-prep/deposition-outline-detail";

export default async function DepositionOutlineDetailPage({
  params,
}: {
  params: Promise<{ id: string; outlineId: string }>;
}) {
  const { id, outlineId } = await params;
  return <DepositionOutlineDetail caseId={id} outlineId={outlineId} />;
}
