export type TrackRecordData = {
  sample_size: number;
  wins: number;
  losses: number;
  pushes: number;
  units: number;
};

export function TrackRecordStrip({
  stats,
  onAudit,
}: {
  stats: TrackRecordData;
  onAudit?: () => void;
}) {
  const isThin = stats.sample_size < 50;
  const isWinning = stats.units > 0;
  const unitsLabel = `${stats.units > 0 ? "+" : ""}${Math.round(stats.units * 100) / 100}u`;

  return (
    <section className={`pick-track-strip ${isWinning && !isThin ? "is-winning" : "is-neutral"}`}>
      <div>
        <span className="pick-track-kicker">
          {isThin ? "Data Maturity: Thin" : "System Performance"}
        </span>
        <div className="pick-track-record">
          {isThin
            ? `${stats.sample_size} Graded`
            : `${stats.wins} to ${stats.losses} to ${stats.pushes} (${unitsLabel})`}
        </div>
      </div>
      <button type="button" className="pick-track-audit" onClick={onAudit}>
        Audit All Receipts
      </button>
      {isThin && (
        <p className="pick-track-note">
          Track record becomes statistically significant at 50 graded picks.
        </p>
      )}
    </section>
  );
}
