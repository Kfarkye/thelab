import type { ReactNode } from 'react';
import type { Metadata } from 'next';

/**
 * Layout override for the public candidate portal.
 * Intentionally sparse — no header, no nav, no app chrome.
 * Candidate sees the rendered template and nothing else.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
