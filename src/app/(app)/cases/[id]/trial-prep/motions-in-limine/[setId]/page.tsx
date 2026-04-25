import { MilSetDetail } from "@/components/cases/trial-prep/mil-set-detail";

export default async function MilSetDetailPage({
  params,
}: {
  params: Promise<{ id: string; setId: string }>;
}) {
  const { id, setId } = await params;
  return <MilSetDetail caseId={id} setId={setId} />;
}
