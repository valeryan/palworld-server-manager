import { WorldWorkspace } from "@/components/world-workspace";

export const dynamic = "force-dynamic";
export default async function WorldPage({ params }: { params: Promise<{ id: string }> }) {
  return <WorldWorkspace worldId={(await params).id} />;
}
