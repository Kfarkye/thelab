# QueryData Translation Validation Report

Generated: 2026-04-27T21:15:12.850Z

## Summary

- Queries run: 30
- Non-empty results: 26/30
- Latency under 2000ms: 30/30
- Flagged queries: 4/30

| # | Query | Results | Latency | Pass/Flag |
|---:|---|---:|---:|---|
| 1 | dietitians within 50 miles of Sacramento | 6 | 28ms | pass |
| 2 | dietitians near San Francisco | 8 | 14ms | pass |
| 3 | active dietitians within 30 miles of San Francisco with weekly gross over 2500 | 6 | 14ms | pass |
| 4 | dietitan near Sacramento | 8 | 15ms | pass |
| 5 | any dieticians in SF | 8 | 13ms | pass |
| 6 | RNs available before May 15 | 10 | 15ms | pass |
| 7 | registered nurses near Sacramento | 10 | 11ms | pass |
| 8 | RN within 100 miles of Sacramento | 10 | 35ms | pass |
| 9 | RNs not currently on assignment | 10 | 14ms | pass |
| 10 | nurses available next month near LA | 8 | 12ms | pass |
| 11 | Med Surg nurses with active status near LA | 10 | 18ms | pass |
| 12 | anyone good for Med Surg in LA | 10 | 18ms | pass |
| 13 | medsurg RN close to Los Angeles | 10 | 12ms | pass |
| 14 | active med surg nurses within 25 miles of LA | 10 | 19ms | pass |
| 15 | PT available next month | 0 | 31ms | zero results |
| 16 | physical therapists near Sacramento | 0 | 28ms | zero results |
| 17 | OT near San Francisco | 0 | 13ms | zero results |
| 18 | occupational therapist active candidates | 0 | 14ms | zero results |
| 19 | RT respiratory therapist within 100 miles of Sacramento | 10 | 10ms | pass |
| 20 | respiratory therapy candidates near the bay | 10 | 13ms | pass |
| 21 | candidates wrapping up in the next 3 weeks | 8 | 15ms | pass |
| 22 | who is close to Sacramento and active | 8 | 11ms | pass |
| 23 | active candidates near the bay | 8 | 13ms | pass |
| 24 | near San Francisco | 8 | 13ms | pass |
| 25 | Dietitian candidates with active status | 8 | 12ms | pass |
| 26 | RN candidates with active status | 10 | 28ms | pass |
| 27 | Med Surg active candidates | 10 | 12ms | pass |
| 28 | dietitians near the bay | 8 | 11ms | pass |
| 29 | RNs within 500 miles of San Francisco | 10 | 28ms | pass |
| 30 | Med Surg nurses within 500 miles of Sacramento | 10 | 13ms | pass |

## Per-Query Detail

### 1. dietitians within 50 miles of Sacramento

- Expected intent: specialty/location
- Notes: Map dietitians to Dietitian, Sacramento to coordinates, include SEARCH(search_tokens, @searchQuery), active status, distance ORDER BY, radius filter.
- Query ID: 2cacf889-ff61-49ec-b378-7784e3805d03
- Result count: 6
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
- Query ID: 96eb2f86-ed4a-495e-8576-fce85e077cb6
- Result count: 8
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
- Query ID: 0cc2e80b-5b6c-4de7-9ad5-9725f884a5d7
- Result count: 6
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
| Tyler Arrington | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |
| Jacqueline Judie | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/1688790/new-profile/about |
| Anna Alfred | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/2960307/new-profile/about |

### 4. dietitan near Sacramento

- Expected intent: specialty/location
- Notes: Misspelling should still map dietitan to Dietitian.
- Query ID: 7b585917-cd9e-45e1-ac37-dc94d134286d
- Result count: 8
- Latency: 15ms
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
- Query ID: 85dea51b-d6f1-4307-8a09-50cad93a9863
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
- Query ID: 77d9c9b1-2e98-4f27-8973-a0be3369272b
- Result count: 10
- Latency: 15ms
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
- Query ID: c83ec146-4d8b-4267-90ac-7512386ac4a6
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
- Query ID: 2efbec58-3c3e-4dde-9c90-42584cebd555
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
- Query ID: 65d4b952-9fcb-40ff-8ff7-f745e5bb6baa
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
- Query ID: 105c8f9c-1913-4052-b542-cf683376680f
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
| Taylor Burton | 100 | 1979 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1342 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 11. Med Surg nurses with active status near LA

- Expected intent: multi
- Notes: Map Med Surg nurses to Med Surg RN, active status, LA coordinates.
- Query ID: 2fd0c0db-d8f1-45ba-a27b-b14076e34703
- Result count: 10
- Latency: 18ms
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
- Query ID: 489170a3-f2d8-4478-905e-b5ee83138f0c
- Result count: 10
- Latency: 18ms
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
- Query ID: bedccb0a-7630-4850-ac21-80ccbe5faa09
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

### 14. active med surg nurses within 25 miles of LA

- Expected intent: specialty/location
- Notes: Map Med Surg RN, active status, radius, and LA coordinates.
- Query ID: a2dbe9b1-b305-46c3-8010-53aa28531b4d
- Result count: 10
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
- Query ID: a3138bfc-41b5-4432-9496-7a7eafc43187
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
- Query ID: 7fbadcb4-3b5a-46be-b791-d3fa09c86caa
- Result count: 0
- Latency: 28ms
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
- Query ID: b692ef8b-6083-4b40-bc71-03ef92a5f479
- Result count: 0
- Latency: 13ms
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
- Query ID: fc1c8ed0-ca86-4982-80a5-3ddaf188382f
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
- Query ID: af6299a8-af2b-4508-a9b3-eadf2ee0ca89
- Result count: 10
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
| Matthew Harbawi | 100 | 39 |  |
| Bianca Hicks | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/1374541/new-profile/about |
| Jane Turner | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/2638910/new-profile/about |

### 20. respiratory therapy candidates near the bay

- Expected intent: specialty/location
- Notes: Geographic ambiguity: bay should resolve to Bay Area/San Francisco with low confidence or ask clarification.
- Query ID: aab1670d-afe0-4f73-8378-79b724e84ad7
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
| Matthew Harbawi | 100 | 110 |  |
| Bianca Hicks | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/1374541/new-profile/about |
| Jane Turner | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/2638910/new-profile/about |

### 21. candidates wrapping up in the next 3 weeks

- Expected intent: availability
- Notes: Time-relative and assignment-end query requires assignment history not in candidates. Expected to flag until assignment joins are available.
- Query ID: 4698a470-39f9-434a-9bb7-e10b781d6f4a
- Result count: 8
- Latency: 15ms
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
- Query ID: 6c60532d-0b41-4f2e-8867-4784bacdd625
- Result count: 8
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
| Taylor Burton | 100 | 2021 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1545 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 23. active candidates near the bay

- Expected intent: location
- Notes: Geographic ambiguity should map or flag the bay phrase; should not invent a specialty.
- Query ID: 01335041-3bdb-4ba2-991e-c7de00ca963e
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
- Query ID: c4726f29-0520-4347-a787-78f48be8e810
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
- Query ID: aa85a144-d00f-4116-81e5-aa7c5cb7172b
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
- Query ID: f2ea091f-a908-4308-a146-9f205d348a92
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
- Query ID: b2b37507-5b1f-4b7a-acd3-c717e44fb1ef
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
- Query ID: 75e4070c-0a74-4228-b03c-5d65abe6564c
- Result count: 8
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
| Taylor Burton | 100 | 2087 | https://nova.ayahealthcare.com/#/recruiting/candidates/4932099/new-profile/about |
| Kimberly Shante Brown | 100 | 1588 | https://nova.ayahealthcare.com/#/recruiting/candidates/4047746/new-profile/about |
| Tyler Arrington | 100 | null | https://nova.ayahealthcare.com/#/recruiting/candidates/4156652/new-profile/about |

### 29. RNs within 500 miles of San Francisco

- Expected intent: specialty/location
- Notes: Large radius should include RN candidates if coordinates exist.
- Query ID: 21d3452d-16a2-4d9b-ae9a-cbd282a21c1c
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
- Query ID: 8f7a958c-bab4-427b-92b0-ff0c99d49a57
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

- Add assignment/availability tables to the QueryData context set or document that candidate availability is unavailable in candidates.
- Backfill PT, OT, and RT candidate examples or add value searches that surface zero-data specialty coverage gaps.
- Add templates for location-only questions so the agent does not force a default specialty.

