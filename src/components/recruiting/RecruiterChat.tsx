"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import styles from "./RecruiterChat.module.css";

type CandidateCard = {
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
  license_states: string[];
  distance_miles: number | null;
  warnings: string[];
};

type ChatResponse = {
  conversation_id: string;
  summary: string;
  candidates: CandidateCard[];
  empty_reason?: "likely_data_gap" | "over_filtered" | "unknown";
  suggested_next_searches?: string[];
  diagnostics: {
    warning_count: number;
    missing_nova_id_count: number;
  };
};

type Turn = {
  id: string;
  input: string;
  response: ChatResponse | null;
  error: string | null;
};

const STORAGE_KEY = "ayaops.recruiterChat.v1";

function locationText(candidate: CandidateCard): string {
  const parts = [candidate.location.city, candidate.location.state].filter(Boolean);
  return parts.length ? parts.join(", ") : "Location unavailable";
}

function distanceText(candidate: CandidateCard): string {
  return candidate.distance_miles == null
    ? "Distance unavailable"
    : `${candidate.distance_miles} mi`;
}

function specialtyText(candidate: CandidateCard): string {
  return [candidate.profession, candidate.specialty].filter(Boolean).join(" / ") || "Specialty unavailable";
}

function hasDiagnostics(response: ChatResponse): boolean {
  return response.candidates.length === 0 || response.diagnostics.warning_count > 0;
}

export function RecruiterChat() {
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [profileWarning, setProfileWarning] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const updateKeyboardOffset = () => {
      const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty("--keyboard-offset", `${offset}px`);
    };

    updateKeyboardOffset();
    viewport.addEventListener("resize", updateKeyboardOffset);
    viewport.addEventListener("scroll", updateKeyboardOffset);

    return () => {
      viewport.removeEventListener("resize", updateKeyboardOffset);
      viewport.removeEventListener("scroll", updateKeyboardOffset);
      document.documentElement.style.removeProperty("--keyboard-offset");
    };
  }, []);

  useEffect(() => {
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { conversationId?: string | null; turns?: Turn[] };
      const savedTurns = Array.isArray(parsed.turns) ? parsed.turns : [];
      const usefulTurns = savedTurns.filter((turn) => turn.response || !turn.error);
      setConversationId(parsed.conversationId || null);
      setTurns(usefulTurns);
    } catch {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ conversationId, turns }));
  }, [conversationId, turns]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns, isSending]);

  const latestSuggestions = useMemo(() => {
    const latest = [...turns].reverse().find((turn) => turn.response?.suggested_next_searches?.length);
    return latest?.response?.suggested_next_searches || [];
  }, [turns]);

  async function submitSearch(value: string): Promise<void> {
    const clean = value.trim();
    if (!clean || isSending) return;
    if (!user) {
      setAuthError("Sign in first, then search candidates.");
      return;
    }

    const turnId = crypto.randomUUID();
    setInput("");
    setProfileWarning(null);
    setTurns((current) => [...current, { id: turnId, input: clean, response: null, error: null }]);
    setIsSending(true);

    try {
      const token = user ? await user.getIdToken() : null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch("/api/recruiting/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({ input: clean, conversation_id: conversationId }),
      });
      const data = await res.json() as ChatResponse | { error?: { code?: string } };
      if (!res.ok || !("summary" in data)) {
        throw new Error("Search failed. Try a broader query.");
      }
      setConversationId(data.conversation_id);
      setTurns((current) => current.map((turn) => turn.id === turnId
        ? { ...turn, response: data, error: null }
        : turn));
    } catch (error) {
      setTurns((current) => current.map((turn) => turn.id === turnId
        ? { ...turn, error: error instanceof Error ? error.message : "Search failed." }
        : turn));
    } finally {
      setIsSending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    navigator.vibrate?.(4);
    void submitSearch(input);
  }

  async function handleSignIn(): Promise<void> {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch {
      setAuthError("Sign in did not complete. Try again from this page or the main app.");
    }
  }

  function resetSearch(): void {
    setInput("");
    setConversationId(null);
    setTurns([]);
    setProfileWarning(null);
    setAuthError(null);
    window.sessionStorage.removeItem(STORAGE_KEY);
  }

  return (
    <main className={styles.surface}>
      <section className={styles.shell} aria-label="Recruiter candidate search">
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <p className={styles.eyebrow}>Candidate search</p>
            {turns.length ? (
              <button className={styles.reset} type="button" onClick={resetSearch}>
                Reset
              </button>
            ) : null}
          </div>
          <h1 className={styles.title}>Find the right clinician fast.</h1>
        </header>

        <div className={styles.messages} ref={listRef}>
          {turns.length === 0 ? (
            <div className={styles.turn}>
              <div className={styles.empty}>
                <h2 className={styles.emptyTitle}>Search your current recruiter book.</h2>
                <p className={styles.emptyText}>
                  Try Med Surg RNs near LA, respiratory therapists near the Bay, or active RN candidates.
                </p>
              </div>
            </div>
          ) : null}

          {turns.map((turn) => (
            <article className={styles.turn} key={turn.id}>
              <div className={styles.userBubble}>{turn.input}</div>
              <div className={styles.answer}>
                {turn.error ? <p className={styles.emptyText}>{turn.error}</p> : null}
                {turn.response ? (
                  <>
                    <h2 className={styles.summary}>{turn.response.summary}</h2>
                    {turn.response.candidates.length === 0 ? (
                      <div className={styles.empty}>
                        <h3 className={styles.emptyTitle}>No matching candidates found in the current recruiter book.</h3>
                        <p className={styles.emptyText}>
                          Broaden the specialty, remove the location filter, or check whether this discipline is loaded.
                        </p>
                      </div>
                    ) : (
                      <div className={styles.candidateList}>
                        {turn.response.candidates.map((candidate) => (
                          <section className={styles.card} key={candidate.candidate_id}>
                            <div className={styles.cardTop}>
                              {candidate.nova_url ? (
                                <a className={styles.name} href={candidate.nova_url} target="_blank" rel="noreferrer">
                                  {candidate.candidate_name}
                                </a>
                              ) : (
                                <button
                                  className={styles.nameButton}
                                  type="button"
                                  onClick={() => setProfileWarning(`${candidate.candidate_name} is missing a profile link.`)}
                                >
                                  {candidate.candidate_name}
                                </button>
                              )}
                              {candidate.status ? <span className={styles.status}>{candidate.status}</span> : null}
                            </div>
                            <div className={styles.meta}>
                              <span>{specialtyText(candidate)}</span>
                              <span>{locationText(candidate)}</span>
                              <span className={styles.number}>{distanceText(candidate)}</span>
                            </div>
                            <div className={styles.actions}>
                              {candidate.nova_url ? (
                                <a className={styles.linkButton} href={candidate.nova_url} target="_blank" rel="noreferrer">
                                  Open profile
                                </a>
                              ) : (
                                <span className={styles.chip}>Profile link unavailable</span>
                              )}
                            </div>
                          </section>
                        ))}
                      </div>
                    )}

                    {hasDiagnostics(turn.response) ? (
                      <details className={styles.diagnostics}>
                        <summary>Diagnostics</summary>
                        <p>Warnings: {turn.response.diagnostics.warning_count}</p>
                        <p>Missing profile links: {turn.response.diagnostics.missing_nova_id_count}</p>
                        {turn.response.empty_reason ? <p>Empty reason: {turn.response.empty_reason}</p> : null}
                      </details>
                    ) : null}
                  </>
                ) : null}
              </div>
            </article>
          ))}
        </div>

        <footer className={styles.composerWrap}>
          {authLoading ? <p className={styles.notice}>Sign-in check in progress.</p> : null}
          {!authLoading && !user ? (
            <div className={styles.authPrompt}>
              <span>Sign in to search candidates.</span>
              <button className={styles.signIn} type="button" onClick={() => void handleSignIn()}>
                Sign in with Google
              </button>
            </div>
          ) : null}
          {authError ? <p className={styles.notice}>{authError}</p> : null}
          {profileWarning ? <p className={styles.notice}>{profileWarning}</p> : null}
          {latestSuggestions.length ? (
            <div className={styles.suggestions} aria-label="Suggested searches">
              {latestSuggestions.map((suggestion) => (
                <button
                  className={styles.suggestion}
                  key={suggestion}
                  type="button"
                  onClick={() => void submitSearch(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
          <form className={styles.composer} onSubmit={onSubmit}>
            <input
              className={styles.input}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Search candidates by specialty, location, or status"
              disabled={isSending || authLoading || !user}
            />
            <button className={styles.send} type="submit" disabled={isSending || authLoading || !user || !input.trim()}>
              Search
            </button>
          </form>
        </footer>
      </section>
    </main>
  );
}
