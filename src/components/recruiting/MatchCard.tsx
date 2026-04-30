import styles from "./MatchCard.module.css";
import type { CandidateMatchResult } from "@/lib/recruiting/types";

export function MatchCard({ match }: { match: CandidateMatchResult }) {
  const candidate = match.candidate;

  return (
    <article className={styles.glassCard}>
      <div className={styles.microLabel}>{match.match_bucket.replace(/_/g, " ")}</div>
      {candidate.nova_url ? (
        <a className={styles.novaLink} href={candidate.nova_url} target="_blank" rel="noreferrer">
          Open in Nova
        </a>
      ) : null}
      <h3 className={styles.serifTitle}>{candidate.candidate_name}</h3>
      <div className={styles.score}>{match.match_score}/100</div>
      {match.reasons.length > 0 ? (
        <div className={styles.reasonList}>
          {match.reasons.map((reason) => (
            <span className={styles.reason} key={reason}>
              {reason}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
