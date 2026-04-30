# QueryData Translation Validation Report

Generated: 2026-04-27T20:10:07.433Z

## Summary

- Queries run: 30
- Non-empty results: 16/30
- Latency under 2000ms: 30/30
- Flagged queries: 14/30

| # | Query | Results | Latency | Pass/Flag |
|---:|---|---:|---:|---|
| 1 | dietitians within 50 miles of Sacramento | 0 | 94ms | zero results |
| 2 | dietitians near San Francisco | 2 | 45ms | pass |
| 3 | active dietitians within 30 miles of San Francisco with weekly gross over 2500 | 0 | 31ms | zero results |
| 4 | dietitan near Sacramento | 2 | 33ms | pass |
| 5 | any dieticians in SF | 2 | 21ms | pass |
| 6 | RNs available before May 15 | 2 | 30ms | pass |
| 7 | registered nurses near Sacramento | 2 | 23ms | pass |
| 8 | RN within 100 miles of Sacramento | 0 | 35ms | zero results |
| 9 | RNs not currently on assignment | 10 | 46ms | pass |
| 10 | nurses available next month near LA | 2 | 34ms | pass |
| 11 | Med Surg nurses with active status near LA | 0 | 40ms | zero results |
| 12 | anyone good for Med Surg in LA | 0 | 20ms | zero results |
| 13 | medsurg RN close to Los Angeles | 2 | 89ms | pass |
| 14 | active med surg nurses within 25 miles of LA | 0 | 27ms | zero results |
| 15 | PT available next month | 0 | 22ms | zero results |
| 16 | physical therapists near Sacramento | 0 | 30ms | zero results |
| 17 | OT near San Francisco | 0 | 15ms | zero results |
| 18 | occupational therapist active candidates | 0 | 26ms | zero results |
| 19 | RT respiratory therapist within 100 miles of Sacramento | 0 | 44ms | zero results |
| 20 | respiratory therapy candidates near the bay | 0 | 20ms | zero results |
| 21 | candidates wrapping up in the next 3 weeks | 8 | 23ms | pass |
| 22 | who is close to Sacramento and active | 2 | 13ms | pass |
| 23 | active candidates near the bay | 8 | 33ms | pass |
| 24 | near San Francisco | 2 | 12ms | pass |
| 25 | Dietitian candidates with active status | 8 | 13ms | pass |
| 26 | RN candidates with active status | 10 | 28ms | pass |
| 27 | Med Surg active candidates | 10 | 13ms | pass |
| 28 | dietitians near the bay | 8 | 17ms | pass |
| 29 | RNs within 500 miles of San Francisco | 0 | 29ms | zero results |
| 30 | Med Surg nurses within 500 miles of Sacramento | 0 | 20ms | zero results |

## Per-Query Detail

### 1. dietitians within 50 miles of Sacramento

- Expected intent: specialty/location
- Notes: Map dietitians to Dietitian, Sacramento to coordinates, include SEARCH(search_tokens, @searchQuery), active status, distance ORDER BY, radius filter.
- Query ID: b5af8ecb-c7c5-4265-bd4b-dc79dc8cf726
- Result count: 0
- Latency: 94ms
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
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

### 2. dietitians near San Francisco

- Expected intent: specialty/location
- Notes: Map San Francisco to coordinates and Dietitian specialty; order by relevance and distance.
- Query ID: 31d75f9b-83e1-42d2-92ae-7f88db766207
- Result count: 2
- Latency: 45ms
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 2087 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1588 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |

### 3. active dietitians within 30 miles of San Francisco with weekly gross over 2500

- Expected intent: multi
- Notes: Should recognize Dietitian, active status, San Francisco radius, and ideally package/pay context. Current candidates table has no pay fields, so flag likely.
- Query ID: 56a47507-5255-4876-85f7-b5075df6752f
- Result count: 0
- Latency: 31ms
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
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
- Query ID: 2c0ae053-1759-4136-83fe-32956ca9173c
- Result count: 2
- Latency: 33ms
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 2021 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1545 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |

### 5. any dieticians in SF

- Expected intent: specialty/location
- Notes: Common misspelling dieticians should map to Dietitian; SF should map to San Francisco.
- Query ID: 0e664a44-646d-4979-ba7b-222d923db4ef
- Result count: 2
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 2087 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1588 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |

### 6. RNs available before May 15

- Expected intent: specialty/availability
- Notes: Map RNs to RN. Availability fields are not in candidates, so good translation should at least preserve RN active candidate search and flag availability limitation.
- Query ID: 5e9286ab-5672-49ac-829f-f78a406c7009
- Result count: 2
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Vonderrica Martin | 100 | 1238 | https://nova.ayahealthcare.com/#/recruiting/candidates/2838489/new-profile/about |
| Emily Welch | 100 | 1633 | https://nova.ayahealthcare.com/#/recruiting/candidates/1322428/new-profile/about |

### 7. registered nurses near Sacramento

- Expected intent: specialty/location
- Notes: Map registered nurses to RN and Sacramento to coordinates.
- Query ID: 04221b15-f9db-4676-8472-b308addc7f0f
- Result count: 2
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Vonderrica Martin | 100 | 1438 | https://nova.ayahealthcare.com/#/recruiting/candidates/2838489/new-profile/about |
| Emily Welch | 100 | 1816 | https://nova.ayahealthcare.com/#/recruiting/candidates/1322428/new-profile/about |

### 8. RN within 100 miles of Sacramento

- Expected intent: specialty/location
- Notes: Map RN and radius. Should include Haversine and radius filter.
- Query ID: d2041ba0-b07b-4019-b50f-e4499681bb31
- Result count: 0
- Latency: 35ms
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
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

### 9. RNs not currently on assignment

- Expected intent: specialty/availability
- Notes: Negation and assignment status require assignment data not present in candidates. Expected to flag until context adds assignment joins.
- Query ID: 3bd502a8-8326-41ce-b8a3-a23c60bd6b08
- Result count: 10
- Latency: 46ms
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
      0 AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Amy McCully | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/3074536/new-profile/about |
| Christine Celella | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/431182/new-profile/about |
| Alana Carter | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/1655339/new-profile/about |

### 10. nurses available next month near LA

- Expected intent: specialty/availability/location
- Notes: Informal nurses should map to RN and LA to Los Angeles. Availability may flag.
- Query ID: d5848b71-e0a3-44f9-8a46-6abb903188f5
- Result count: 2
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 1979 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1342 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |

### 11. Med Surg nurses with active status near LA

- Expected intent: multi
- Notes: Map Med Surg nurses to Med Surg RN, active status, LA coordinates.
- Query ID: e6181333-4d9b-4ab3-94fd-792218ef2557
- Result count: 0
- Latency: 40ms
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

_No results._

### 12. anyone good for Med Surg in LA

- Expected intent: specialty/location
- Notes: Informal phrasing should map Med Surg to Med Surg RN and LA coordinates.
- Query ID: f8146097-6b95-4e6a-9a38-4ea945ea1c39
- Result count: 0
- Latency: 20ms
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

_No results._

### 13. medsurg RN close to Los Angeles

- Expected intent: specialty/location
- Notes: medsurg abbreviation should map to Med Surg RN and Los Angeles coordinates.
- Query ID: cd004698-cc99-4bfe-87d4-a97e4f01b494
- Result count: 2
- Latency: 89ms
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Vonderrica Martin | 100 | 1238 | https://nova.ayahealthcare.com/#/recruiting/candidates/2838489/new-profile/about |
| Emily Welch | 100 | 1633 | https://nova.ayahealthcare.com/#/recruiting/candidates/1322428/new-profile/about |

### 14. active med surg nurses within 25 miles of LA

- Expected intent: specialty/location
- Notes: Map Med Surg RN, active status, radius, and LA coordinates.
- Query ID: b6a1bdb1-af96-48c1-a953-227a8132d0eb
- Result count: 0
- Latency: 27ms
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
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

### 15. PT available next month

- Expected intent: specialty/availability
- Notes: Map PT to Physical Therapist/PT. Current data likely lacks PT candidates, so flag as zero-result or value coverage gap.
- Query ID: 67c2c680-ed9d-490c-9ce8-a0d7f9cc07c2
- Result count: 0
- Latency: 22ms
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
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
- Query ID: 2053cf13-d642-496a-b576-5b742bdc1fd9
- Result count: 0
- Latency: 30ms
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
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
- Query ID: 1cc91f39-893b-4a92-ad8e-945aee92b2d7
- Result count: 0
- Latency: 15ms
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
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
- Query ID: 43d6668c-837e-4925-8506-fc8c2f3ff165
- Result count: 0
- Latency: 26ms
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
      0 AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
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
- Query ID: e6e4379c-dde7-4dbf-aa01-b1aa4c9cb347
- Result count: 0
- Latency: 44ms
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
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
- Query ID: f0aeabaf-2ef3-45ee-86bf-ae583b67b10f
- Result count: 0
- Latency: 20ms
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
      0 AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
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
- Query ID: 0a6a68ae-e577-43c6-9bff-d6b850bfe168
- Result count: 8
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
      0 AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 22. who is close to Sacramento and active

- Expected intent: location
- Notes: No specialty mentioned. Good query should use active status and distance ordering without forcing Dietitian.
- Query ID: 0db3f950-f19b-47dd-af3b-6b8b0d64a03d
- Result count: 2
- Latency: 13ms
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 2021 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1545 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |

### 23. active candidates near the bay

- Expected intent: location
- Notes: Geographic ambiguity should map or flag the bay phrase; should not invent a specialty.
- Query ID: 4d9350d3-f0c2-43bc-8549-54b400aa9298
- Result count: 8
- Latency: 33ms
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
      0 AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 24. near San Francisco

- Expected intent: location
- Notes: No specialty. Should return active candidates ordered by distance, not default specialty if QueryData understands pure location.
- Query ID: 4b3cf92b-b042-48da-8659-fd64b9abf63e
- Result count: 2
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 2087 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1588 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |

### 25. Dietitian candidates with active status

- Expected intent: specialty
- Notes: Simple specialty and status query. Should include SEARCH(search_tokens, @searchQuery).
- Query ID: 1567ea86-d05d-40c1-b4c2-ffc5158a754c
- Result count: 8
- Latency: 13ms
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
      0 AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 26. RN candidates with active status

- Expected intent: specialty
- Notes: Simple RN active query. Should include SEARCH(search_tokens, @searchQuery).
- Query ID: db721df4-1a35-42a2-b0a4-e1ecb1108846
- Result count: 10
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
      0 AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Amy McCully | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/3074536/new-profile/about |
| Christine Celella | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/431182/new-profile/about |
| Alana Carter | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/1655339/new-profile/about |

### 27. Med Surg active candidates

- Expected intent: specialty
- Notes: Simple Med Surg active query. Should include SEARCH(search_tokens, @searchQuery).
- Query ID: 1a778fb7-424e-400a-aab8-14563e4a3137
- Result count: 10
- Latency: 13ms
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
      0 AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Dallas Mechelle Bower-Franklin | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/4119492/new-profile/about |
| Debora Smith | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/1660378/new-profile/about |
| Christine Celella | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/431182/new-profile/about |

### 28. dietitians near the bay

- Expected intent: specialty/location
- Notes: Bay Area ambiguity with a supported specialty. Should map to San Francisco/Oakland area or ask clarification.
- Query ID: e7b2f937-b3f0-4c89-80a1-e3f84f58e9e1
- Result count: 8
- Latency: 17ms
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
      0 AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
    WHERE SEARCH(c.search_tokens, @searchQuery)
      AND c.status = 'ACTIVE'
      
      
    ORDER BY relevance DESC, miles ASC
    LIMIT @limit
```

First 3 results:

| Candidate | Score | Distance | Nova |
|---|---:|---:|---|
| Taylor Burton | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | 0 | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 29. RNs within 500 miles of San Francisco

- Expected intent: specialty/location
- Notes: Large radius should include RN candidates if coordinates exist.
- Query ID: 1957cb4d-f36f-4a2d-950e-335d971c0cfd
- Result count: 0
- Latency: 29ms
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
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

### 30. Med Surg nurses within 500 miles of Sacramento

- Expected intent: specialty/location
- Notes: Large radius should include Med Surg candidates if coordinates exist.
- Query ID: fa0f55c5-55b5-4360-bb52-2f008cedab71
- Result count: 0
- Latency: 20ms
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
      (2 * 3958.7613 * ASIN(SQRT(
          POW(SIN((c.latitude - @lat) * 3.141592653589793 / 360), 2) +
          COS(c.latitude * 3.141592653589793 / 180) * COS(@lat * 3.141592653589793 / 180) *
          POW(SIN((c.longitude - @lng) * 3.141592653589793 / 360), 2)
        ))) AS miles
    FROM hc_candidates@{FORCE_INDEX=hc_CandidatesSearchIndex} AS c
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

## Recommendations

- Add a geographic alias for 'the bay' / 'Bay Area' with San Francisco or Oakland coordinates, or require clarification.
- Add assignment/availability tables to the QueryData context set or document that candidate availability is unavailable in candidates.
- Backfill PT, OT, and RT candidate examples or add value searches that surface zero-data specialty coverage gaps.
- Add Packages pay fields to context templates for pay-based candidate/package questions.
- Add templates for location-only questions so the agent does not force a default specialty.

