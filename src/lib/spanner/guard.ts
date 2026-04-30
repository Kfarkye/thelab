import { requireEnv } from '@/lib/env';

/**
 * Validates SQL/DDL against destructive patterns.
 * Rule: Backwards-compatibility assessment [Ver: 740fe83]
 */
export const isSafeMutation = (content: string, overrideToken?: string): boolean => {
  const forbidden = [
    /\bDROP\s+TABLE\b/i,
    /\bDELETE\s+FROM[\s\S]*\bWHERE\s+1\s*=\s*1\b/i,
    /\bTRUNCATE\b/i,
  ];

  if (overrideToken) {
    const secret = requireEnv('SPANNER_MUTATION_OVERRIDE_TOKEN');
    if (overrideToken === secret) {
      return true;
    }
  }

  const isSql = /\b(CREATE\s+TABLE|ALTER\s+TABLE|DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(content);
  
  if (!isSql) return true;

  return !forbidden.some(regex => regex.test(content));
};
