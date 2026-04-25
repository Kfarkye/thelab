import { OpsDraftingQueue } from "@/components/picks/OpsDraftingQueue";

export const dynamic = "force-dynamic";

export default function OpsDraftingPage() {
  return (
    <main className="ops-draft-page">
      <OpsDraftingQueue />
    </main>
  );
}
