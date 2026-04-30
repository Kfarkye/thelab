"use client";

import React from "react";
import styles from "./CandidateCard.module.css";

interface Candidate {
  candidate_id: string;
  candidate_name: string;
  nova_url: string | null;
  profession: string | null;
  specialty: string | null;
  status: string | null;
  location: {
    city: string | null;
    state: string | null;
  };
  distance_miles: number | null;
}

interface CandidateCardProps {
  candidates: Candidate[];
  summary: string;
  backend: string;
}

export function CandidateCard({ candidates, summary, backend }: CandidateCardProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.top}>
        <span className={styles.label}>
          {backend} / Candidate book
        </span>
        <span className={styles.count}>
          {candidates.length} result{candidates.length === 1 ? "" : "s"}
        </span>
      </div>
      
      <p className={styles.summary}>{summary}</p>

      <div className={styles.list}>
        {candidates.map((c) => (
          <div 
            key={c.candidate_id}
            className={styles.card}
          >
            <div className={styles.cardTop}>
              <div>
                <h3 className={styles.name}>{c.candidate_name}</h3>
                <div className={styles.meta}>
                  <span>
                    {c.profession} {c.specialty ? `• ${c.specialty}` : ""}
                  </span>
                  {c.location.city && (
                    <span>
                      {c.location.city}, {c.location.state}
                    </span>
                  )}
                  {c.distance_miles !== null && (
                    <span className={styles.number}>
                      {c.distance_miles} mi
                    </span>
                  )}
                </div>
              </div>
              
              {c.status && (
                <span className={styles.status}>
                  {c.status}
                </span>
              )}
            </div>

            {c.nova_url && (
              <a 
                href={c.nova_url}
                target="_blank"
                rel="noreferrer"
                className={styles.link}
                aria-label={`View ${c.candidate_name} in Nova`}
              />
            )}
          </div>
        ))}
      </div>
      
      {candidates.length === 0 && (
        <div className={styles.empty}>
          <p>No matching candidates in your book.</p>
        </div>
      )}
    </div>
  );
}
