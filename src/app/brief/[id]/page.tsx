import Link from "next/link";
import { notFound } from "next/navigation";
import { computeTrackRecord, listResolvedPicks } from "@/lib/sports/picks-ledger";
import { PickCard } from "@/components/picks/PickCard";
import { TrackRecordStrip } from "@/components/picks/TrackRecordStrip";

export const dynamic = "force-dynamic";

export default async function BriefPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: briefIdRaw } = await params;
  const briefId = String(briefIdRaw || "").trim();
  if (!briefId) notFound();

  const picks = await listResolvedPicks({ briefId, limit: 100, tier: "PUBLIC" });
  if (picks.length === 0) notFound();

  const track = await computeTrackRecord(30);
  const briefCanonicalUrl = `/brief/${encodeURIComponent(briefId)}`;
  const pickGraph = picks.map((pick: any) => ({
    "@type": "BettingPick",
    "@id": String(pick.public_url || `${briefCanonicalUrl}#pick-${String(pick.id)}`),
    identifier: String(pick.id),
    name: String(pick.display || "Pick"),
    marketType: String(pick.market_type || ""),
    selection: String(pick.side || ""),
    line: typeof pick.line === "number" ? pick.line : null,
    priorityBand: String(pick.priority || "STANDARD"),
    gradingStatus: String(pick.grading_status || "PENDING"),
    unitsResult: typeof pick.result === "number" ? pick.result : null,
    about: {
      "@type": "SportsEvent",
      identifier: String(pick.game_id || ""),
    },
    url: String(pick.public_url || `${briefCanonicalUrl}#pick-${String(pick.id)}`),
    author: {
      "@type": "Organization",
      name: "The Drip Desk",
    },
  }));
  const briefJsonLd = {
    "@context": "https://drip.market/schema",
    "@graph": [
      {
        "@type": "CreativeWork",
        "@id": briefCanonicalUrl,
        name: `Daily Picks Brief ${briefId}`,
        author: {
          "@type": "Organization",
          name: "The Drip Desk",
        },
      },
      {
        "@type": "ItemList",
        name: "Daily Picks",
        itemListOrder: "https://schema.org/ItemListOrderAscending",
        numberOfItems: pickGraph.length,
        itemListElement: pickGraph.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item,
        })),
      },
    ],
  };

  return (
    <main style={{ background: "#FAF6EE", minHeight: "100vh", padding: "26px 16px 42px" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(briefJsonLd) }}
      />
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <nav style={{ marginBottom: 14, fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8C8576" }}>
          <Link href="/chat" style={{ color: "#8C8576", textDecoration: "none" }}>The Lab</Link>
          <span style={{ margin: "0 8px" }}>/</span>
          <span>Brief {briefId}</span>
        </nav>

        <h1 style={{ margin: "0 0 14px", fontFamily: "var(--serif)", fontSize: 34, lineHeight: 1.1, color: "#1A1A1A" }}>
          Daily Picks Brief
        </h1>

        <TrackRecordStrip
          stats={{
            sample_size: track.sample_size,
            wins: track.wins,
            losses: track.losses,
            pushes: track.pushes,
            units: track.units,
          }}
        />

        <section className="picks-shell-grid" aria-label="Top picks">
          {picks.map((pick: any) => (
            <PickCard
              key={String(pick.id)}
              pick={{
                id: String(pick.id),
                display: String(pick.display || "Pick"),
                priority: (pick.priority as string | null) || "STANDARD",
                kicker: (pick.kicker as string | null) || null,
                rationale: (pick.rationale as string | null) || "",
                event_status: (pick.event_status as string | null) || "SCHEDULED",
                grading_status: (pick.grading_status as string | null) || "PENDING",
                result: (pick.result as number | null) ?? null,
                live: (pick.live as { current_score?: string | null; pace_summary?: string | null; progress?: string | null } | null) || null,
                is_live_stale: Boolean(pick.is_live_stale),
                ticker: (pick.ticker as string | null) || null,
                public_url: (pick.public_url as string | null) || null,
              }}
            />
          ))}
        </section>
      </div>
    </main>
  );
}
