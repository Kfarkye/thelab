# QueryData Translation Validation Report

Generated: 2026-04-27T21:03:51.331Z

## Summary

- Queries run: 30
- Non-empty results: 24/30
- Latency under 2000ms: 30/30
- Flagged queries: 6/30

| # | Query | Results | Latency | Pass/Flag |
|---:|---|---:|---:|---|
| 1 | dietitians within 50 miles of Sacramento | 6 | 52ms | pass |
| 2 | dietitians near San Francisco | 8 | 57ms | pass |
| 3 | active dietitians within 30 miles of San Francisco with weekly gross over 2500 | 6 | 34ms | pass |
| 4 | dietitan near Sacramento | 8 | 28ms | pass |
| 5 | any dieticians in SF | 8 | 12ms | pass |
| 6 | RNs available before May 15 | 10 | 12ms | pass |
| 7 | registered nurses near Sacramento | 10 | 11ms | pass |
| 8 | RN within 100 miles of Sacramento | 10 | 50ms | pass |
| 9 | RNs not currently on assignment | 10 | 31ms | pass |
| 10 | nurses available next month near LA | 8 | 44ms | pass |
| 11 | Med Surg nurses with active status near LA | 10 | 12ms | pass |
| 12 | anyone good for Med Surg in LA | 10 | 23ms | pass |
| 13 | medsurg RN close to Los Angeles | 10 | 35ms | pass |
| 14 | active med surg nurses within 25 miles of LA | 10 | 36ms | pass |
| 15 | PT available next month | 0 | 14ms | zero results |
| 16 | physical therapists near Sacramento | 0 | 11ms | zero results |
| 17 | OT near San Francisco | 0 | 426ms | zero results |
| 18 | occupational therapist active candidates | 0 | 39ms | zero results |
| 19 | RT respiratory therapist within 100 miles of Sacramento | 0 | 62ms | zero results |
| 20 | respiratory therapy candidates near the bay | 0 | 17ms | zero results |
| 21 | candidates wrapping up in the next 3 weeks | 8 | 24ms | pass |
| 22 | who is close to Sacramento and active | 8 | 12ms | pass |
| 23 | active candidates near the bay | 8 | 10ms | pass |
| 24 | near San Francisco | 8 | 30ms | pass |
| 25 | Dietitian candidates with active status | 8 | 27ms | pass |
| 26 | RN candidates with active status | 10 | 21ms | pass |
| 27 | Med Surg active candidates | 10 | 20ms | pass |
| 28 | dietitians near the bay | 8 | 19ms | pass |
| 29 | RNs within 500 miles of San Francisco | 10 | 14ms | pass |
| 30 | Med Surg nurses within 500 miles of Sacramento | 10 | 12ms | pass |

## Per-Query Detail

### 1. dietitians within 50 miles of Sacramento

- Expected intent: specialty/location
- Notes: Map dietitians to Dietitian, Sacramento to coordinates, include SEARCH(search_tokens, @searchQuery), active status, distance ORDER BY, radius filter.
- Query ID: 37af2e65-a798-4a02-ba5f-91e7b1a6a2e0
- Result count: 6
- Latency: 52ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
       AND (c.latitude IS NULL OR c.longitude IS NULL OR (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) <= CAST(@radiusMiles AS FLOAT64))
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Tyler Arrington | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |
| Jacqueline Judie | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/1688790/new-profile/about |
| Anna Alfred | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/2960307/new-profile/about |

### 2. dietitians near San Francisco

- Expected intent: specialty/location
- Notes: Map San Francisco to coordinates and Dietitian specialty; order by relevance and distance.
- Query ID: c38c4cb3-5309-4299-a559-d98f48b05629
- Result count: 8
- Latency: 57ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 2087 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1588 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 3. active dietitians within 30 miles of San Francisco with weekly gross over 2500

- Expected intent: multi
- Notes: Should recognize Dietitian, active status, San Francisco radius, and ideally package/pay context. Current candidates table has no pay fields, so flag likely.
- Query ID: 703c49f6-3534-4b84-ad9a-91899dc1efa7
- Result count: 6
- Latency: 34ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
       AND (c.latitude IS NULL OR c.longitude IS NULL OR (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) <= CAST(@radiusMiles AS FLOAT64))
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Tyler Arrington | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |
| Jacqueline Judie | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/1688790/new-profile/about |
| Anna Alfred | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/2960307/new-profile/about |

### 4. dietitan near Sacramento

- Expected intent: specialty/location
- Notes: Misspelling should still map dietitan to Dietitian.
- Query ID: 546b1627-e331-4939-b417-b71ee9690b8c
- Result count: 8
- Latency: 28ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 2021 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1545 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 5. any dieticians in SF

- Expected intent: specialty/location
- Notes: Common misspelling dieticians should map to Dietitian; SF should map to San Francisco.
- Query ID: 5509a8ee-32d5-4f12-96d9-513f7ebc4731
- Result count: 8
- Latency: 12ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 2087 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1588 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 6. RNs available before May 15

- Expected intent: specialty/availability
- Notes: Map RNs to RN. Availability fields are not in candidates, so good translation should at least preserve RN active candidate search and flag availability limitation.
- Query ID: 53c70139-8c01-4822-94d1-5edc6d0e3d2a
- Result count: 10
- Latency: 12ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Vonderrica Martin | 100 | 1238 | https://nova.ayahealthcare.com/#/recruiting/candidates/2838489/new-profile/about |
| Emily Welch | 100 | 1633 | https://nova.ayahealthcare.com/#/recruiting/candidates/1322428/new-profile/about |
| Amy McCully | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/3074536/new-profile/about |

### 7. registered nurses near Sacramento

- Expected intent: specialty/location
- Notes: Map registered nurses to RN and Sacramento to coordinates.
- Query ID: ebb8cedc-f385-4b31-b2a6-e204d0b58ef1
- Result count: 10
- Latency: 11ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Vonderrica Martin | 100 | 1438 | https://nova.ayahealthcare.com/#/recruiting/candidates/2838489/new-profile/about |
| Emily Welch | 100 | 1816 | https://nova.ayahealthcare.com/#/recruiting/candidates/1322428/new-profile/about |
| Amy McCully | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/3074536/new-profile/about |

### 8. RN within 100 miles of Sacramento

- Expected intent: specialty/location
- Notes: Map RN and radius. Should include Haversine and radius filter.
- Query ID: c70dcb17-683c-4022-97cd-12646d5bbaf2
- Result count: 10
- Latency: 50ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
       AND (c.latitude IS NULL OR c.longitude IS NULL OR (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) <= CAST(@radiusMiles AS FLOAT64))
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Amy McCully | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/3074536/new-profile/about |
| Christine Celella | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/431182/new-profile/about |
| Alana Carter | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/1655339/new-profile/about |

### 9. RNs not currently on assignment

- Expected intent: specialty/availability
- Notes: Negation and assignment status require assignment data not present in candidates. Expected to flag until context adds assignment joins.
- Query ID: 9e343ec1-2e3c-45dc-9311-8ed7f897b976
- Result count: 10
- Latency: 31ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CAST(NULL AS FLOAT64) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Amy McCully | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/3074536/new-profile/about |
| Christine Celella | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/431182/new-profile/about |
| Alana Carter | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/1655339/new-profile/about |

### 10. nurses available next month near LA

- Expected intent: specialty/availability/location
- Notes: Informal nurses should map to RN and LA to Los Angeles. Availability may flag.
- Query ID: 3e08dc4e-8c6b-4f07-bf1f-cd0d9a03f14e
- Result count: 8
- Latency: 44ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 1979 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1342 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 11. Med Surg nurses with active status near LA

- Expected intent: multi
- Notes: Map Med Surg nurses to Med Surg RN, active status, LA coordinates.
- Query ID: 4c931e29-547e-4328-a02c-1d4291f7c996
- Result count: 10
- Latency: 12ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Dallas Mechelle Bower-Franklin | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4119492/new-profile/about |
| Debora Smith | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/1660378/new-profile/about |
| Christine Celella | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/431182/new-profile/about |

### 12. anyone good for Med Surg in LA

- Expected intent: specialty/location
- Notes: Informal phrasing should map Med Surg to Med Surg RN and LA coordinates.
- Query ID: c766d6fa-75d5-401d-9cdc-316e59d49df3
- Result count: 10
- Latency: 23ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Dallas Mechelle Bower-Franklin | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4119492/new-profile/about |
| Debora Smith | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/1660378/new-profile/about |
| Christine Celella | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/431182/new-profile/about |

### 13. medsurg RN close to Los Angeles

- Expected intent: specialty/location
- Notes: medsurg abbreviation should map to Med Surg RN and Los Angeles coordinates.
- Query ID: e1f277c1-91d5-43c6-b1f4-f915c9d96b28
- Result count: 10
- Latency: 35ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Vonderrica Martin | 100 | 1238 | https://nova.ayahealthcare.com/#/recruiting/candidates/2838489/new-profile/about |
| Emily Welch | 100 | 1633 | https://nova.ayahealthcare.com/#/recruiting/candidates/1322428/new-profile/about |
| Amy McCully | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/3074536/new-profile/about |

### 14. active med surg nurses within 25 miles of LA

- Expected intent: specialty/location
- Notes: Map Med Surg RN, active status, radius, and LA coordinates.
- Query ID: 4fae6ce5-2d03-4e80-97a7-c1ef4b1dcd7d
- Result count: 10
- Latency: 36ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
       AND (c.latitude IS NULL OR c.longitude IS NULL OR (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) <= CAST(@radiusMiles AS FLOAT64))
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Dallas Mechelle Bower-Franklin | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4119492/new-profile/about |
| Debora Smith | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/1660378/new-profile/about |
| Christine Celella | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/431182/new-profile/about |

### 15. PT available next month

- Expected intent: specialty/availability
- Notes: Map PT to Physical Therapist/PT. Current data likely lacks PT candidates, so flag as zero-result or value coverage gap.
- Query ID: 114165fb-826f-4e7a-8234-72b1749c1bf5
- Result count: 0
- Latency: 14ms
- Flags: zero results

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

_No results._

### 16. physical therapists near Sacramento

- Expected intent: specialty/location
- Notes: Map physical therapists to PT. Current data likely zero until PT candidates loaded.
- Query ID: e15edb38-9860-4bec-b824-1f2139bc0288
- Result count: 0
- Latency: 11ms
- Flags: zero results

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

_No results._

### 17. OT near San Francisco

- Expected intent: specialty/location
- Notes: Map OT to Occupational Therapist/OT. Current data likely zero.
- Query ID: 48ec731d-7087-4616-8a8a-a5bfba53a502
- Result count: 0
- Latency: 426ms
- Flags: zero results

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

_No results._

### 18. occupational therapist active candidates

- Expected intent: specialty
- Notes: Map occupational therapist to OT and active status.
- Query ID: fbc2e572-c9e7-453a-a407-43916a1411ff
- Result count: 0
- Latency: 39ms
- Flags: zero results

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CAST(NULL AS FLOAT64) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

_No results._

### 19. RT respiratory therapist within 100 miles of Sacramento

- Expected intent: specialty/location
- Notes: Map RT/respiratory therapist to RT or Respiratory Therapy. Current data likely zero.
- Query ID: 56454fac-46c8-4033-a658-9d7156567c1f
- Result count: 0
- Latency: 62ms
- Flags: zero results

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
       AND (c.latitude IS NULL OR c.longitude IS NULL OR (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) <= CAST(@radiusMiles AS FLOAT64))
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

_No results._

### 20. respiratory therapy candidates near the bay

- Expected intent: specialty/location
- Notes: Geographic ambiguity: bay should resolve to Bay Area/San Francisco with low confidence or ask clarification.
- Query ID: 119f9266-47b7-4502-99c2-efaf8843ff2c
- Result count: 0
- Latency: 17ms
- Flags: zero results

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

_No results._

### 21. candidates wrapping up in the next 3 weeks

- Expected intent: availability
- Notes: Time-relative and assignment-end query requires assignment history not in candidates. Expected to flag until assignment joins are available.
- Query ID: f18a55d6-6855-4ecb-b4ae-740d9871dbfe
- Result count: 8
- Latency: 24ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CAST(NULL AS FLOAT64) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 22. who is close to Sacramento and active

- Expected intent: location
- Notes: No specialty mentioned. Good query should use active status and distance ordering without forcing Dietitian.
- Query ID: 58b1b44f-ee16-4b18-84bb-77aea9329ffd
- Result count: 8
- Latency: 12ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 2021 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1545 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 23. active candidates near the bay

- Expected intent: location
- Notes: Geographic ambiguity should map or flag the bay phrase; should not invent a specialty.
- Query ID: 4dfda41f-0bce-4221-8ebe-4fcc0b819b60
- Result count: 8
- Latency: 10ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 2087 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1588 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 24. near San Francisco

- Expected intent: location
- Notes: No specialty. Should return active candidates ordered by distance, not default specialty if QueryData understands pure location.
- Query ID: a89abe32-d78a-4657-b3da-ef8f415e9aa3
- Result count: 8
- Latency: 30ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 2087 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1588 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 25. Dietitian candidates with active status

- Expected intent: specialty
- Notes: Simple specialty and status query. Should include SEARCH(search_tokens, @searchQuery).
- Query ID: 85c0121a-6046-4c18-9209-48e3b764ebc1
- Result count: 8
- Latency: 27ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CAST(NULL AS FLOAT64) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 26. RN candidates with active status

- Expected intent: specialty
- Notes: Simple RN active query. Should include SEARCH(search_tokens, @searchQuery).
- Query ID: d30f57c0-a201-49ca-ab5a-463b9ed3b7e4
- Result count: 10
- Latency: 21ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CAST(NULL AS FLOAT64) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Amy McCully | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/3074536/new-profile/about |
| Christine Celella | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/431182/new-profile/about |
| Alana Carter | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/1655339/new-profile/about |

### 27. Med Surg active candidates

- Expected intent: specialty
- Notes: Simple Med Surg active query. Should include SEARCH(search_tokens, @searchQuery).
- Query ID: 30b3f309-8e60-4115-92e9-7f9875e2aad4
- Result count: 10
- Latency: 20ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CAST(NULL AS FLOAT64) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Dallas Mechelle Bower-Franklin | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4119492/new-profile/about |
| Debora Smith | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/1660378/new-profile/about |
| Christine Celella | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/431182/new-profile/about |

### 28. dietitians near the bay

- Expected intent: specialty/location
- Notes: Bay Area ambiguity with a supported specialty. Should map to San Francisco/Oakland area or ask clarification.
- Query ID: efe828c4-a7dc-4131-8737-3b4bfdc990a2
- Result count: 8
- Latency: 19ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 2087 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1588 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 29. RNs within 500 miles of San Francisco

- Expected intent: specialty/location
- Notes: Large radius should include RN candidates if coordinates exist.
- Query ID: 659793ad-d9f0-469c-81d6-34a8cd745393
- Result count: 10
- Latency: 14ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
       AND (c.latitude IS NULL OR c.longitude IS NULL OR (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) <= CAST(@radiusMiles AS FLOAT64))
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Amy McCully | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/3074536/new-profile/about |
| Christine Celella | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/431182/new-profile/about |
| Alana Carter | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/1655339/new-profile/about |

### 30. Med Surg nurses within 500 miles of Sacramento

- Expected intent: specialty/location
- Notes: Large radius should include Med Surg candidates if coordinates exist.
- Query ID: c2b29f13-d326-43b6-ab57-a2063be02737
- Result count: 10
- Latency: 12ms
- Flags: none

Generated SQL:

```sql
SELECT
      c.id AS candidate_id,
      TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS candidate_name,
      CASE
        WHEN c.nova_id IS NULL THEN ''
        ELSE CONCAT('https://nova.ayahealthcare.com/#/recruiting/candidates/', c.nova_id, '/new-profile/about')
      END AS nova_url,
      SCORE(c.search_tokens, @searchQuery) AS relevance,
      CASE
        WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL
        ELSE (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        )))
      END AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
       AND (c.latitude IS NULL OR c.longitude IS NULL OR (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) <= CAST(@radiusMiles AS FLOAT64))
    ORDER BY relevance DESC, CASE WHEN miles IS NULL THEN 1 ELSE 0 END ASC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Dallas Mechelle Bower-Franklin | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4119492/new-profile/about |
| Debora Smith | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/1660378/new-profile/about |
| Christine Celella | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/431182/new-profile/about |

## Recommendations

- Add a geographic alias for 'the bay' / 'Bay Area' with San Francisco or Oakland coordinates, or require clarification.
- Add assignment/availability tables to the QueryData context set or document that candidate availability is unavailable in candidates.
- Backfill PT, OT, and RT candidate examples or add value searches that surface zero-data specialty coverage gaps.
- Add templates for location-only questions so the agent does not force a default specialty.

