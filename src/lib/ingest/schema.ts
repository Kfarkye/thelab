// src/lib/ingest/schema.ts
import { z } from 'zod';

const normalizeIntent = (tag: string): string => {
  const normalized = tag.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return normalized || 'unknown';
};

export const IngestPayloadSchema = z.object({
  threads: z.array(
    z.object({
      thread_id: z.string().min(1).max(128),
      thread_url: z.string().url().optional(),
      candidate_name: z.string().optional(),
      candidate_phone: z.string().optional(),
      location: z.string().optional(),
      facility_name: z.string().optional(),
      intent_tags: z.array(z.string()).transform(tags => tags.map(normalizeIntent)).default([]),
      recommended_next_step: z.string().optional(),
    })
  ).max(50)
});

export type IngestPayload = z.infer<typeof IngestPayloadSchema>;
