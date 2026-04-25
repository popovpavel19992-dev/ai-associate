import { VoirDireSetDetail } from "@/components/cases/trial-prep/voir-dire-set-detail";

export default async function VoirDireSetDetailPage({
  params,
}: {
  params: Promise<{ id: string; setId: string }>;
}) {
  const { id, setId } = await params;
  return <VoirDireSetDetail caseId={id} setId={setId} />;
}
