import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  resolveCandidateBySlug,
  getCandidatePortalData,
  getPublishedTemplateBySlug,
  logPortalView,
} from '@/lib/portal-db';
import { render } from '@/lib/portal-template';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const candidate = await resolveCandidateBySlug(slug);
  if (!candidate) return { title: 'Not found', robots: { index: false, follow: false } };
  const data = await getCandidatePortalData(candidate.id);
  const name = data?.candidate?.first_name;
  return {
    title: name ? `${name}'s Assignment Hub` : 'Your Assignment Hub',
    robots: { index: false, follow: false },
  };
}

export default async function PortalPage({ params }: Props) {
  const { slug } = await params;

  const candidate = await resolveCandidateBySlug(slug);
  if (!candidate) notFound();

  const [data, template] = await Promise.all([
    getCandidatePortalData(candidate.id),
    getPublishedTemplateBySlug('candidate-portal'),
  ]);

  if (!data || !template) notFound();

  // Fire-and-forget view log — don't block render on it
  const hdrs = await headers();
  void logPortalView({
    candidate_id: candidate.id,
    template_id: template.template_id,
    user_agent: hdrs.get('user-agent') ?? null,
    referer: hdrs.get('referer') ?? null,
  }).catch(() => undefined);

  const renderedBody = render(
    template.template_html,
    data as unknown as Record<string, unknown>
  );

  // Inline full HTML — we want zero chrome from the app shell
  // on the candidate-facing page.
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        body { margin: 0; padding: 0; }
        ${template.template_css ?? ''}
      `}} />
      <div dangerouslySetInnerHTML={{ __html: renderedBody }} />
    </>
  );
}
