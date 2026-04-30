'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ComplianceShield } from './ComplianceShield';
import styles from './PatchPreview.module.css';

interface PatchFile {
  path: string;
  content: string;
}

export const PatchPreview = ({ patch }: { patch: { files: PatchFile[] } }) => {
  const [status, setStatus] = useState<'pending' | 'verified' | 'failed'>('pending');
  const [isApplying, setIsApplying] = useState(false);
  const [overrideToken, setOverrideToken] = useState('');
  const [guardMessage, setGuardMessage] = useState<string | null>(null);

  const onVerify = async (): Promise<void> => {
    setStatus('pending');
    setGuardMessage(null);
    const res = await fetch('/api/verify', {
      method: 'POST',
      body: JSON.stringify({ patch })
    });
    setStatus(res.ok ? 'verified' : 'failed');
  };

  const onExecute = async (): Promise<void> => {
    setIsApplying(true);
    setGuardMessage(null);
    navigator.vibrate?.(4);

    const res = await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch, overrideToken: overrideToken.trim() || undefined })
    });
    const data = await res.json().catch(() => ({})) as { error?: string; message?: string };
    if (!res.ok) {
      setStatus('failed');
      setGuardMessage(
        data.error === 'UNSAFE_MUTATION'
          ? 'Action restricted: This change would delete existing data.'
          : data.message || 'Action restricted: The files were not updated.'
      );
    }
    setIsApplying(false);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 450, damping: 45, mass: 0.5 }}
      className={styles.panel}
    >
      <div className={styles.toolbar}>
        <ComplianceShield status={status} />
        <div className={styles.actions}>
          <button 
            onClick={onVerify} 
            className={styles.button}
          >
            Run Audit
          </button>
          <button 
            disabled={status !== 'verified' || isApplying}
            onClick={onExecute} 
            className={`${styles.button} ${styles.primary}`}
          >
            {isApplying ? 'Updating files...' : 'Update Files'}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {guardMessage ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className={styles.guard}
            exit={{ opacity: 0, y: -6 }}
            initial={{ opacity: 0, y: -6 }}
            transition={{ type: "spring", stiffness: 450, damping: 45, mass: 0.5 }}
          >
            <h3 className={styles.guardTitle}>Action restricted</h3>
            <p className={styles.guardText}>{guardMessage}</p>
            <input
              className={styles.overrideInput}
              onChange={(event) => setOverrideToken(event.target.value)}
              placeholder="OVERRIDE TOKEN"
              type="password"
              value={overrideToken}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className={styles.fileList}>
        {patch.files.map((file) => (
          <div key={file.path} className={styles.fileCard}>
            <p className={styles.label}>{file.path}</p>
            <pre className={styles.code}>
              <code>{file.content}</code>
            </pre>
          </div>
        ))}
      </div>
    </motion.div>
  );
};
