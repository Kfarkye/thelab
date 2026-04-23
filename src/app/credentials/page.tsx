"use client";

import { useAuth } from "@/context/AuthContext";
import { useState, useEffect, useCallback } from "react";

interface Credential {
  credential_id: string;
  credential_type: string;
  issuer: string | null;
  holder_name: string | null;
  issue_date: string | null;
  expiration_date: string;
  status: string;
  computed_status: string;
  days_until_expiry: number;
  notes: string | null;
}

export default function HomePage() {
  const { user, loading, logout } = useAuth();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loadingCreds, setLoadingCreds] = useState(false);

  const fetchCredentials = useCallback(async () => {
    if (!user) return;
    setLoadingCreds(true);
    try {
      const res = await fetch(`/api/credentials?firebase_uid=${user.uid}`);
      const data = await res.json();
      setCredentials(data.credentials || []);
    } catch (e) {
      console.error("Failed to fetch credentials:", e);
    }
    setLoadingCreds(false);
  }, [user]);

  useEffect(() => {
    if (user) fetchCredentials();
  }, [user, fetchCredentials]);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  const active = credentials.filter((c) => c.computed_status === "active");
  const expiringSoon = credentials.filter((c) => c.computed_status === "expiring_soon");
  const expired = credentials.filter((c) => c.computed_status === "expired");

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg></div>
          CredentialTrack
        </div>
        <div className="app-user">
          <span className="app-user-name">{user.displayName || user.email}</span>
          <button className="btn btn-secondary" onClick={logout} style={{ padding: "6px 14px", fontSize: "13px" }}>
            Sign out
          </button>
        </div>
      </header>

      <main className="app-main">
        {/* Stats */}
        <div className="stat-grid">
          <div className="stat-card green">
            <div className="stat-label">Active</div>
            <div className="stat-value">{active.length}</div>
          </div>
          <div className="stat-card yellow">
            <div className="stat-label">Expiring Soon</div>
            <div className="stat-value">{expiringSoon.length}</div>
          </div>
          <div className="stat-card red">
            <div className="stat-label">Expired</div>
            <div className="stat-value">{expired.length}</div>
          </div>
          <div className="stat-card blue">
            <div className="stat-label">Total</div>
            <div className="stat-value">{credentials.length}</div>
          </div>
        </div>

        {/* Credential list */}
        <div className="section-header">
          <h2 className="section-title">My Credentials</h2>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            + Add Credential
          </button>
        </div>

        {loadingCreds ? (
          <div className="loading" style={{ minHeight: "200px" }}>
            <div className="spinner" />
          </div>
        ) : credentials.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#71717a' }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg></div>
            <h3>No credentials yet</h3>
            <p>Add your BLS, ACLS, or PALS certification to start tracking expirations and get automated reminders.</p>
            <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
              + Add Your First Credential
            </button>
          </div>
        ) : (
          <div className="cred-list">
            {credentials.map((cred) => (
              <div key={cred.credential_id} className="cred-card">
                <div className="cred-left">
                  <div className={`cred-type-badge ${cred.credential_type}`}>
                    {cred.credential_type}
                  </div>
                  <div className="cred-info">
                    <h3>{cred.credential_type} Certification</h3>
                    <span className="cred-meta">
                      {cred.issuer || "Unknown issuer"}
                      {cred.holder_name ? ` · ${cred.holder_name}` : ""}
                    </span>
                  </div>
                </div>
                <div className="cred-right">
                  <div className="cred-expiry">
                    <strong>
                      {new Date(cred.expiration_date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </strong>
                    {cred.days_until_expiry > 0
                      ? `${cred.days_until_expiry} days left`
                      : cred.days_until_expiry === 0
                      ? "Expires today"
                      : `${Math.abs(cred.days_until_expiry)} days overdue`}
                  </div>
                  <span className={`status-pill ${cred.computed_status}`}>
                    {cred.computed_status === "active"
                      ? "✓ Active"
                      : cred.computed_status === "expiring_soon"
                      ? "⚠ Expiring"
                      : "✕ Expired"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Add modal */}
      {showAdd && (
        <AddCredentialModal
          firebaseUid={user.uid}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            fetchCredentials();
          }}
        />
      )}
    </div>
  );
}

/* ── Auth Page ─────────────────────────────────────────── */

function AuthPage() {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (isSignUp) {
        await signUp(email, password, name);
      } else {
        await signIn(email, password);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      setError(message.replace("Firebase: ", "").replace(/\(auth\/.*\)/, "").trim());
    }
    setSubmitting(false);
  };

  const handleGoogle = async () => {
    setError("");
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Google sign-in failed";
      setError(message);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="app-logo" style={{ marginBottom: "24px" }}>
          <div className="app-logo-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg></div>
          CredentialTrack
        </div>
        <h1>{isSignUp ? "Create account" : "Welcome back"}</h1>
        <p>Never miss a BLS, ACLS, or PALS expiration again.</p>

        <button className="btn btn-google" onClick={handleGoogle}>
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.348 6.175 0 7.547 0 9s.348 2.825.957 4.039l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z"/>
          </svg>
          Continue with Google
        </button>

        <div className="auth-divider">or</div>

        <form onSubmit={handleSubmit}>
          {isSignUp && (
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                required={isSignUp}
              />
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>
          {error && (
            <p style={{ color: "var(--red)", fontSize: "14px", marginBottom: "16px" }}>{error}</p>
          )}
          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: "100%", justifyContent: "center" }}>
            {submitting ? "..." : isSignUp ? "Create Account" : "Sign In"}
          </button>
        </form>

        <div className="auth-toggle">
          {isSignUp ? "Already have an account? " : "Don't have an account? "}
          <a onClick={() => { setIsSignUp(!isSignUp); setError(""); }}>
            {isSignUp ? "Sign in" : "Sign up"}
          </a>
        </div>
      </div>
    </div>
  );
}

/* ── Add Credential Modal ──────────────────────────────── */

function AddCredentialModal({
  firebaseUid,
  onClose,
  onSaved,
}: {
  firebaseUid: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState("BLS");
  const [issuer, setIssuer] = useState("American Heart Association");
  const [holderName, setHolderName] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firebase_uid: firebaseUid,
          credential_type: type,
          issuer: issuer || null,
          holder_name: holderName || null,
          issue_date: issueDate || null,
          expiration_date: expirationDate,
          notes: notes || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save credential");
      }

      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Save failed";
      setError(message);
    }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add Credential</h2>
        <form onSubmit={handleSave}>
          <div className="form-group">
            <label className="form-label">Credential Type</label>
            <select className="form-select" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="BLS">BLS — Basic Life Support</option>
              <option value="ACLS">ACLS — Advanced Cardiovascular Life Support</option>
              <option value="PALS">PALS — Pediatric Advanced Life Support</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Issuer</label>
            <select className="form-select" value={issuer} onChange={(e) => setIssuer(e.target.value)}>
              <option value="American Heart Association">American Heart Association (AHA)</option>
              <option value="American Red Cross">American Red Cross</option>
              <option value="National Safety Council">National Safety Council</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Holder Name</label>
            <input
              type="text"
              className="form-input"
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              placeholder="Name on the card"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Issue Date</label>
              <input
                type="date"
                className="form-input"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Expiration Date *</label>
              <input
                type="date"
                className="form-input"
                value={expirationDate}
                onChange={(e) => setExpirationDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Notes (optional)</label>
            <textarea
              className="form-textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Card number, renewal location, etc."
            />
          </div>

          {error && (
            <p style={{ color: "var(--red)", fontSize: "14px", marginBottom: "16px" }}>{error}</p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving..." : "Save Credential"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
