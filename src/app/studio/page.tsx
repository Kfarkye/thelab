import type { Metadata } from 'next';
import StudioClient from './StudioClient';

export const metadata: Metadata = {
  title: 'Portal Studio',
  robots: { index: false, follow: false },
};

export default function StudioPage() {
  return <StudioClient />;
}
