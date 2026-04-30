import React from 'react';
import styles from './ComplianceShield.module.css';

export const ComplianceShield = ({ status }: { status: 'pending' | 'verified' | 'failed' }) => {
  const configs = {
    pending: { className: styles.pending, label: 'Audit in progress' },
    verified: { className: styles.verified, label: 'Ready to update' },
    failed: { className: styles.failed, label: 'Action restricted' },
  };

  return (
    <div className={`${styles.shield} ${configs[status].className}`}>
      <div className={styles.dot} />
      {configs[status].label}
    </div>
  );
};
