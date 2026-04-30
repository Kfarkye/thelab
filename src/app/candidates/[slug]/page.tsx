import { getDb } from "@/lib/spanner-pool";
import { JewelPill } from "@/components/ui/JewelPill";
import { ROUTE_LAWS } from "@/lib/contracts/laws";

export default async function CandidatePage({ params }: { params: { slug: string } }) {
  const db = getDb("aya-ops");
  const route = `/candidates/${params.slug}`;
  
  const [rows] = await db.run({
    sql: `SELECT * FROM EntityRoutes WHERE CanonicalRoute = @route`,
    params: { route }
  });

  if (!rows || rows.length === 0) {
    return <div className="p-12 font-serif text-[#050505]">Candidate not found.</div>;
  }

  const data = rows[0].toJSON();
  const envelope = {
    id: data.EntityId,
    type: ROUTE_LAWS.candidate.groundingType,
    actions: ROUTE_LAWS.candidate.allowedActions,
    commit: data.RulesetCommit
  };

  return (
    <main 
      id="work-surface" 
      data-envelope={JSON.stringify(envelope)}
      className="max-w-[920px] mx-auto p-12 bg-[#fdfdfc] min-h-screen"
    >
      <header className="flex justify-between items-baseline mb-12">
        <h1 className="text-4xl font-serif text-[#050505]">Candidate Profile</h1>
        <JewelPill url={`https://aya.ops${route}`} label={data.EntityId} />
      </header>
      
      <section className="liquid-glass-card p-8 rounded-[24px] border-t-white/[0.08] bg-white/[0.025] backdrop-blur-[24px]">
        <div className="mono-label mb-4 text-[10px] tracking-widest text-zinc-400">INTERNAL CONTEXT</div>
        <p className="text-lg text-[#050505] leading-relaxed font-sans">
          {data.BarTalkSummary.vibe}
        </p>
      </section>
      
      <div id="agent-output" className="mt-8 font-sans text-zinc-600" />
    </main>
  );
}
