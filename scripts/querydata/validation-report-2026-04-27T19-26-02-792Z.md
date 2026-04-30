# QueryData Translation Validation Report

Generated: 2026-04-27T19:26:02.792Z

## Summary

- Queries run: 30
- Non-empty results: 23/30
- Latency under 2000ms: 30/30
- Flagged queries: 7/30

| # | Query | Results | Latency | Pass/Flag |
|---:|---|---:|---:|---|
| 1 | dietitians within 50 miles of Sacramento | 1 | 151ms | pass |
| 2 | dietitians near San Francisco | 2 | 46ms | pass |
| 3 | active dietitians within 30 miles of San Francisco with weekly gross over 2500 | 0 | 34ms | zero results |
| 4 | dietitan near Sacramento | 2 | 32ms | pass |
| 5 | any dieticians in SF | 2 | 40ms | pass |
| 6 | RNs available before May 15 | 2 | 27ms | pass |
| 7 | registered nurses near Sacramento | 2 | 11ms | pass |
| 8 | RN within 100 miles of Sacramento | 1 | 38ms | pass |
| 9 | RNs not currently on assignment | 2 | 40ms | pass |
| 10 | nurses available next month near LA | 2 | 9ms | pass |
| 11 | Med Surg nurses with active status near LA | 1 | 10ms | pass |
| 12 | anyone good for Med Surg in LA | 1 | 9ms | pass |
| 13 | medsurg RN close to Los Angeles | 2 | 11ms | pass |
| 14 | active med surg nurses within 25 miles of LA | 1 | 40ms | pass |
| 15 | PT available next month | 0 | 16ms | zero results |
| 16 | physical therapists near Sacramento | 0 | 9ms | zero results |
| 17 | OT near San Francisco | 0 | 12ms | zero results |
| 18 | occupational therapist active candidates | 0 | 22ms | zero results |
| 19 | RT respiratory therapist within 100 miles of Sacramento | 0 | 10ms | zero results |
| 20 | respiratory therapy candidates near the bay | 0 | 8ms | zero results |
| 21 | candidates wrapping up in the next 3 weeks | 2 | 19ms | pass |
| 22 | who is close to Sacramento and active | 2 | 9ms | pass |
| 23 | active candidates near the bay | 2 | 9ms | pass |
| 24 | near San Francisco | 2 | 9ms | pass |
| 25 | Dietitian candidates with active status | 2 | 21ms | pass |
| 26 | RN candidates with active status | 2 | 14ms | pass |
| 27 | Med Surg active candidates | 1 | 19ms | pass |
| 28 | dietitians near the bay | 2 | 10ms | pass |
| 29 | RNs within 500 miles of San Francisco | 2 | 10ms | pass |
| 30 | Med Surg nurses within 500 miles of Sacramento | 1 | 10ms | pass |

## Per-Query Detail

### 1. dietitians within 50 miles of Sacramento

- Expected intent: specialty/location
- Notes: Map dietitians to Dietitian, Sacramento to coordinates, include SEARCH(search_tokens, @searchQuery), active status, distance ORDER BY, radius filter.
- Query ID: 5c45be51-d980-42f7-a4d5-064478005cdc
- Result count: 1
- Latency: 151ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
       AND (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) <= CAST(@radiusMiles AS FLOAT64)
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Azjah Brown | 100 | 31 | https://nova.ayahealthcare.com/#/recruiting/candidates/9b9d384c/new-profile/about |

### 2. dietitians near San Francisco

- Expected intent: specialty/location
- Notes: Map San Francisco to coordinates and Dietitian specialty; order by relevance and distance.
- Query ID: 4680eb0e-ec55-4916-8f7f-9a4b1a88f0c1
- Result count: 2
- Latency: 46ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Distance Tester | 100 | 142 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000100/new-profile/about |
| Azjah Brown | 100 | 47 | https://nova.ayahealthcare.com/#/recruiting/candidates/9b9d384c/new-profile/about |

### 3. active dietitians within 30 miles of San Francisco with weekly gross over 2500

- Expected intent: multi
- Notes: Should recognize Dietitian, active status, San Francisco radius, and ideally package/pay context. Current candidates table has no pay fields, so flag likely.
- Query ID: d2f289b2-04c1-4d90-90af-76490d8b806f
- Result count: 0
- Latency: 34ms
- Flags: zero results

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
       AND (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) <= CAST(@radiusMiles AS FLOAT64)
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

_No results._

### 4. dietitan near Sacramento

- Expected intent: specialty/location
- Notes: Misspelling should still map dietitan to Dietitian.
- Query ID: 09762d85-e4b1-44a8-bc9e-2ea574ff1243
- Result count: 2
- Latency: 32ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Distance Tester | 100 | 89 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000100/new-profile/about |
| Azjah Brown | 100 | 31 | https://nova.ayahealthcare.com/#/recruiting/candidates/9b9d384c/new-profile/about |

### 5. any dieticians in SF

- Expected intent: specialty/location
- Notes: Common misspelling dieticians should map to Dietitian; SF should map to San Francisco.
- Query ID: 1f411181-8af8-4470-9b5b-b720d13e0e85
- Result count: 2
- Latency: 40ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Distance Tester | 100 | 142 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000100/new-profile/about |
| Azjah Brown | 100 | 47 | https://nova.ayahealthcare.com/#/recruiting/candidates/9b9d384c/new-profile/about |

### 6. RNs available before May 15

- Expected intent: specialty/availability
- Notes: Map RNs to RN. Availability fields are not in candidates, so good translation should at least preserve RN active candidate search and flag availability limitation.
- Query ID: 74595164-f1f0-4b4d-8d91-248c5d7ef4a2
- Result count: 2
- Latency: 27ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Ask RN | 100 | 361 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000101/new-profile/about |
| Ask MedSurg | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000102/new-profile/about |

### 7. registered nurses near Sacramento

- Expected intent: specialty/location
- Notes: Map registered nurses to RN and Sacramento to coordinates.
- Query ID: b5a07675-3b0c-42c8-a08c-e2fc0d046fe8
- Result count: 2
- Latency: 11ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Ask RN | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000101/new-profile/about |
| Ask MedSurg | 100 | 361 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000102/new-profile/about |

### 8. RN within 100 miles of Sacramento

- Expected intent: specialty/location
- Notes: Map RN and radius. Should include Haversine and radius filter.
- Query ID: 12d54c7f-1416-4d6e-8f8d-80478a66311f
- Result count: 1
- Latency: 38ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
       AND (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) <= CAST(@radiusMiles AS FLOAT64)
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Ask RN | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000101/new-profile/about |

### 9. RNs not currently on assignment

- Expected intent: specialty/availability
- Notes: Negation and assignment status require assignment data not present in candidates. Expected to flag until context adds assignment joins.
- Query ID: 74765776-e4fa-46a6-b375-04b4b12844f2
- Result count: 2
- Latency: 40ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      0 AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Ask RN | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000101/new-profile/about |
| Ask MedSurg | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000102/new-profile/about |

### 10. nurses available next month near LA

- Expected intent: specialty/availability/location
- Notes: Informal nurses should map to RN and LA to Los Angeles. Availability may flag.
- Query ID: d3e67cca-7401-4341-b932-2dfff65dc568
- Result count: 2
- Latency: 9ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Distance Tester | 100 | 448 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000100/new-profile/about |
| Azjah Brown | 100 | 363 | https://nova.ayahealthcare.com/#/recruiting/candidates/9b9d384c/new-profile/about |

### 11. Med Surg nurses with active status near LA

- Expected intent: multi
- Notes: Map Med Surg nurses to Med Surg RN, active status, LA coordinates.
- Query ID: 1578ba2c-3aa2-40ce-9084-d02d36d65103
- Result count: 1
- Latency: 10ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Ask MedSurg | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000102/new-profile/about |

### 12. anyone good for Med Surg in LA

- Expected intent: specialty/location
- Notes: Informal phrasing should map Med Surg to Med Surg RN and LA coordinates.
- Query ID: c35da756-a6d2-4553-8b4a-e5cf388c3fc7
- Result count: 1
- Latency: 9ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Ask MedSurg | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000102/new-profile/about |

### 13. medsurg RN close to Los Angeles

- Expected intent: specialty/location
- Notes: medsurg abbreviation should map to Med Surg RN and Los Angeles coordinates.
- Query ID: 098ccf43-a486-4de4-9254-6d95006c6371
- Result count: 2
- Latency: 11ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Ask RN | 100 | 361 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000101/new-profile/about |
| Ask MedSurg | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000102/new-profile/about |

### 14. active med surg nurses within 25 miles of LA

- Expected intent: specialty/location
- Notes: Map Med Surg RN, active status, radius, and LA coordinates.
- Query ID: 3d6af2b2-2dc2-4217-beb5-a1d61fe9909d
- Result count: 1
- Latency: 40ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
       AND (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) <= CAST(@radiusMiles AS FLOAT64)
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Ask MedSurg | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000102/new-profile/about |

### 15. PT available next month

- Expected intent: specialty/availability
- Notes: Map PT to Physical Therapist/PT. Current data likely lacks PT candidates, so flag as zero-result or value coverage gap.
- Query ID: 3e352757-aef8-40bf-b8b9-7c0940803a0b
- Result count: 0
- Latency: 16ms
- Flags: zero results

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

_No results._

### 16. physical therapists near Sacramento

- Expected intent: specialty/location
- Notes: Map physical therapists to PT. Current data likely zero until PT candidates loaded.
- Query ID: 158b702f-53ec-4542-854e-db452a961a02
- Result count: 0
- Latency: 9ms
- Flags: zero results

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

_No results._

### 17. OT near San Francisco

- Expected intent: specialty/location
- Notes: Map OT to Occupational Therapist/OT. Current data likely zero.
- Query ID: e75e96d5-f28b-4de3-8df5-7bb3b82f4bcd
- Result count: 0
- Latency: 12ms
- Flags: zero results

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

_No results._

### 18. occupational therapist active candidates

- Expected intent: specialty
- Notes: Map occupational therapist to OT and active status.
- Query ID: 83ccad7a-802b-44f7-a164-a541edb600ac
- Result count: 0
- Latency: 22ms
- Flags: zero results

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      0 AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

_No results._

### 19. RT respiratory therapist within 100 miles of Sacramento

- Expected intent: specialty/location
- Notes: Map RT/respiratory therapist to RT or Respiratory Therapy. Current data likely zero.
- Query ID: ba658bb3-261c-4640-9068-f72a9402ffc4
- Result count: 0
- Latency: 10ms
- Flags: zero results

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
       AND (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) <= CAST(@radiusMiles AS FLOAT64)
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

_No results._

### 20. respiratory therapy candidates near the bay

- Expected intent: specialty/location
- Notes: Geographic ambiguity: bay should resolve to Bay Area/San Francisco with low confidence or ask clarification.
- Query ID: fe857738-a713-45d5-93a4-3cd0430247ef
- Result count: 0
- Latency: 8ms
- Flags: zero results

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      0 AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

_No results._

### 21. candidates wrapping up in the next 3 weeks

- Expected intent: availability
- Notes: Time-relative and assignment-end query requires assignment history not in candidates. Expected to flag until assignment joins are available.
- Query ID: 2e5c1c40-c6b9-42e8-986d-732853c23bc1
- Result count: 2
- Latency: 19ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      0 AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Distance Tester | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000100/new-profile/about |
| Azjah Brown | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/9b9d384c/new-profile/about |

### 22. who is close to Sacramento and active

- Expected intent: location
- Notes: No specialty mentioned. Good query should use active status and distance ordering without forcing Dietitian.
- Query ID: 7ecdd788-6044-4c79-87c1-0e89a8ff8446
- Result count: 2
- Latency: 9ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Distance Tester | 100 | 89 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000100/new-profile/about |
| Azjah Brown | 100 | 31 | https://nova.ayahealthcare.com/#/recruiting/candidates/9b9d384c/new-profile/about |

### 23. active candidates near the bay

- Expected intent: location
- Notes: Geographic ambiguity should map or flag the bay phrase; should not invent a specialty.
- Query ID: a29ba2cb-4c45-41ff-9e5b-780a1664e91d
- Result count: 2
- Latency: 9ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      0 AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Distance Tester | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000100/new-profile/about |
| Azjah Brown | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/9b9d384c/new-profile/about |

### 24. near San Francisco

- Expected intent: location
- Notes: No specialty. Should return active candidates ordered by distance, not default specialty if QueryData understands pure location.
- Query ID: a086ecb7-e2bb-4416-9aee-479073609bac
- Result count: 2
- Latency: 9ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Distance Tester | 100 | 142 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000100/new-profile/about |
| Azjah Brown | 100 | 47 | https://nova.ayahealthcare.com/#/recruiting/candidates/9b9d384c/new-profile/about |

### 25. Dietitian candidates with active status

- Expected intent: specialty
- Notes: Simple specialty and status query. Should include SEARCH(search_tokens, @searchQuery).
- Query ID: 8011f2b1-7379-429e-a971-943066ad03ee
- Result count: 2
- Latency: 21ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      0 AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Distance Tester | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000100/new-profile/about |
| Azjah Brown | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/9b9d384c/new-profile/about |

### 26. RN candidates with active status

- Expected intent: specialty
- Notes: Simple RN active query. Should include SEARCH(search_tokens, @searchQuery).
- Query ID: af8951c8-92ff-416d-aaa6-4cfd7f0ed506
- Result count: 2
- Latency: 14ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      0 AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Ask RN | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000101/new-profile/about |
| Ask MedSurg | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000102/new-profile/about |

### 27. Med Surg active candidates

- Expected intent: specialty
- Notes: Simple Med Surg active query. Should include SEARCH(search_tokens, @searchQuery).
- Query ID: c1b765be-fbce-4971-9bd3-dc028d1d07b9
- Result count: 1
- Latency: 19ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      0 AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Ask MedSurg | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000102/new-profile/about |

### 28. dietitians near the bay

- Expected intent: specialty/location
- Notes: Bay Area ambiguity with a supported specialty. Should map to San Francisco/Oakland area or ask clarification.
- Query ID: 52eca4b0-f2ea-4e8b-ad22-7d5c77bd82c1
- Result count: 2
- Latency: 10ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      0 AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Distance Tester | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000100/new-profile/about |
| Azjah Brown | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/9b9d384c/new-profile/about |

### 29. RNs within 500 miles of San Francisco

- Expected intent: specialty/location
- Notes: Large radius should include RN candidates if coordinates exist.
- Query ID: c0d2b47c-7752-40b1-a3f9-aca74e1093e7
- Result count: 2
- Latency: 10ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
       AND (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) <= CAST(@radiusMiles AS FLOAT64)
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Ask RN | 100 | 75 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000101/new-profile/about |
| Ask MedSurg | 100 | 347 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000102/new-profile/about |

### 30. Med Surg nurses within 500 miles of Sacramento

- Expected intent: specialty/location
- Notes: Large radius should include Med Surg candidates if coordinates exist.
- Query ID: ac4892cb-6d26-431b-8cb8-98c5f175068b
- Result count: 1
- Latency: 10ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.candidate_id,
      c.candidate_name,
      c.nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM candidates@{FORCE_INDEX=CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
       AND (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) <= CAST(@radiusMiles AS FLOAT64)
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Ask MedSurg | 100 | 361 | https://nova.ayahealthcare.com/#/recruiting/candidates/000000000102/new-profile/about |

## Recommendations

- Add a geographic alias for 'the bay' / 'Bay Area' with San Francisco or Oakland coordinates, or require clarification.
- Add assignment/availability tables to the QueryData context set or document that candidate availability is unavailable in candidates.
- Backfill PT, OT, and RT candidate examples or add value searches that surface zero-data specialty coverage gaps.
- Add Packages pay fields to context templates for pay-based candidate/package questions.
- Add templates for location-only questions so the agent does not force a default specialty.

