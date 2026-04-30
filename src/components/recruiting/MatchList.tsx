import styles from "./MatchList.module.css";
import type { CandidateMatch } from "@/lib/recruiting/matcher";

export function MatchList({ matches }: { matches: CandidateMatch[] }) {
  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Who&apos;s nearby and has the right background?</h2>
      {matches.map((match) => (
        <div key={match.candidate_id} className={styles.card}>
          <div>
            <div className={styles.dataLabel}>Candidate</div>
            <a
              href={match.nova_url}
              target="_blank"
              rel="noreferrer"
              className={styles.candidateName}
            >
              {match.candidate_name}
            </a>
          </div>
          <div className={styles.metrics}>
            <div className={styles.metricBlock}>
              <div className={styles.dataLabel}>Match Quality</div>
              <span className={styles.number}>{match.fit_score}%</span>
            </div>
            <div className={styles.metricBlock}>
              <div className={styles.dataLabel}>Distance</div>
              <span className={styles.number}>{match.distance_miles} miles</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
