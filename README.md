*[Baca dalam Bahasa Indonesia](README.id.md)*

# Media Mentions Service

A small slice of a media monitoring pipeline: bulk ingest, search, and stats
over a deliberately messy dataset.

**Live instance:** not deployed yet — see "Running it locally" below.

**Stack:** Node.js 20+ · TypeScript · Express · PostgreSQL · raw SQL via `pg` · Vitest

---

## Running it locally

Requires Node 20+ and a PostgreSQL instance.

```bash
git clone https://github.com/BimaPanjiWijaya/Mentions.git
cd Mentions/media-monitor
npm install

cp env.example .env
# Edit .env: set DATABASE_URL to point at your Postgres instance
# (e.g. postgresql://postgres:<password>@localhost:5432/mentions — run
# `createdb mentions` first), leave PGSSL empty for a local database,
# and set PORT if 3000 is taken.

npm run migrate    # applies migrations/001_init.sql
npm run dev        # starts on http://localhost:3000

# In a second terminal — loads data/seed_mentions.json through the real endpoint:
npm run seed
```

Then open http://localhost:3000 for a small read-only dashboard, or:

```bash
curl "http://localhost:3000/mentions?q=ringgit&limit=5"
curl "http://localhost:3000/mentions/stats?group_by=source"
curl "http://localhost:3000/mentions/stats?group_by=day"
```

Run the tests with `npm test`.

---

## Endpoints

### `POST /internal/mentions/bulk`

Accepts either a bare array of records or `{ "mentions": [...] }`.

First run against `data/seed_mentions.json`:

```json
{
  "received": 15,
  "rejected": 0,
  "collapsed_within_batch": 3,
  "inserted": 12,
  "merged_into_existing": 0,
  "observations_recorded": 15,
  "total_mentions": 12
}
```

Second run, same file:

```json
{
  "received": 15,
  "rejected": 0,
  "collapsed_within_batch": 3,
  "inserted": 0,
  "merged_into_existing": 12,
  "observations_recorded": 0,
  "total_mentions": 12
}
```

`total_mentions` is unchanged and `observations_recorded` is zero, so
idempotency is verifiable from the response alone.

### `GET /mentions`

| Param | Type | Default | Notes |
|---|---|---|---|
| `q` | string | — | Full-text over title + cleaned content. Supports `"phrases"`, `-exclusion`, `or` |
| `source` | slug | — | `the-star`, `new-straits-times`, `malaysiakini`, `twitter`, `facebook`, `instagram` |
| `from` / `to` | ISO date | — | Inclusive. Mentions with an unknown date are excluded when either is set |
| `page` | int ≥ 1 | 1 | |
| `limit` | int 1–100 | 20 | Capped so the whole table cannot be pulled in one request |
| `sort` | enum | `published_desc` | `published_desc`, `published_asc`, `engagement_desc`, `relevance` |

**Sort order.** Every option ends with `id DESC` as a tiebreaker, and the
default is:

```sql
ORDER BY published_at DESC NULLS LAST, id DESC
```

Without the tiebreaker, rows sharing a `published_at` (or both NULL) can
appear on two pages or disappear between them.

### `GET /mentions/stats?group_by=source|day`

Accepts the same filters as `/mentions`, so a dashboard's chart and list
never disagree.

`group_by=day` buckets by **Asia/Kuala_Lumpur**, not UTC — a Malaysian PR
analyst asking "how many on Tuesday" means Tuesday local time. Configurable
via `REPORTING_TZ`. Mentions with no publication date land in an `"unknown"`
bucket rather than being dropped, so the buckets always sum to the total.

Real output against the seeded dataset:

```json
{
  "group_by": "source",
  "total": 12,
  "buckets": [
    { "key": "new-straits-times", "label": "New Straits Times", "count": 3, "total_engagement": 2024 },
    { "key": "the-star", "label": "The Star", "count": 3, "total_engagement": 2344 },
    { "key": "malaysiakini", "label": "Malaysiakini", "count": 2, "total_engagement": 668 },
    { "key": "twitter", "label": "Twitter", "count": 2, "total_engagement": 2950 },
    { "key": "facebook", "label": "Facebook", "count": 1, "total_engagement": 3402 },
    { "key": "instagram", "label": "Instagram", "count": 1, "total_engagement": 9821 }
  ]
}
```

```json
{
  "group_by": "day",
  "timezone": "Asia/Kuala_Lumpur",
  "total": 12,
  "buckets": [
    { "key": "2026-08-10", "count": 1, "total_engagement": 1204 },
    { "key": "2026-08-11", "count": 3, "total_engagement": 2554 },
    { "key": "2026-08-12", "count": 2, "total_engagement": 4309 },
    { "key": "2026-08-13", "count": 2, "total_engagement": 2515 },
    { "key": "2026-08-14", "count": 1, "total_engagement": 512 },
    { "key": "2026-08-15", "count": 3, "total_engagement": 10115 }
  ]
}
```

---

## Schema

Two tables. `migrations/001_init.sql` is the source of truth.

### `mentions` — canonical rows

One row per distinct piece of coverage, after deduplication.

Raw and normalised values are stored side by side: `source_raw` / `source`,
`content_raw` / `content_clean`, `published_at_raw` / `published_at`.
Normalisation is lossy and my rules may be wrong; keeping the original means
a mistake is recoverable without re-scraping.

`published_at` is nullable and stays NULL when the date is unknown. Filling
it with the ingest time would silently corrupt every time-series chart.

`search_vector` is a stored generated column over title + cleaned content,
with a GIN index.

Three partial unique indexes enforce the dedup rule at the database level,
independently of the application:

```sql
(source, external_id)         WHERE external_id IS NOT NULL
(url_canonical)                WHERE url_canonical IS NOT NULL
(source, content_fingerprint)  WHERE content_fingerprint IS NOT NULL
```

### `mention_observations` — raw ingest log

Every accepted input record is logged here, including ones that merged into
an existing mention. Deduplication throws information away; this table keeps
it. It gives three things:

1. **Auditability** — an analyst can ask why two records were merged.
2. **Recoverability** — if the dedup rule turns out to be wrong, canonical
   rows can be re-derived without re-scraping.
3. **Idempotency proof** — `raw_hash` is unique, so re-posting the same file
   inserts nothing new.

---

## Duplicate detection

### The principle

This is a media monitoring product. What it sells is *counts of coverage*.
That single fact drives the whole rule:

- Two outlets covering the same story are **two mentions**. Both are
  valuable to a PR analyst, and collapsing them destroys the number the
  product exists to report.
- The same article scraped twice is **one mention**.

So: **aggressive within a source, conservative across sources.**

### The rule

Three layers, checked in priority order:

| Layer | Key | Confidence |
|---|---|---|
| 1 | `(source, external_id)` | High — the pipeline's own identity for the record |
| 2 | `url_canonical` | High — a URL is where an article lives |
| 3 | `(source, content_fingerprint)` | Medium — a heuristic, so it is fenced in |

**Canonical URL** drops the scheme, `www.`/`m.`/`amp.` prefixes, trailing
slashes and tracking parameters (`utm_*`, `fbclid`, …), and sorts what
remains. `x.com` is folded into `twitter.com`.

**Content fingerprint** is `sha256(source :: normalised title :: normalised
content)`, where normalisation lowercases, strips punctuation and emoji, and
collapses whitespace. It is deliberately fenced:

- **Scoped per source.** This is what keeps the two tourism-arrivals
  articles (The Star and NST) as two separate mentions.
- **Requires ≥ 80 characters of cleaned content.** Short social posts
  collide too easily, and merging two genuinely different posts loses a real
  mention.
- **Requires a non-empty title.** A source publishing boilerplate stubs
  cannot collapse its own feed.

### On the seed file

15 records become **12 mentions**, verified by `tests/dedupe.test.ts` and by
a live run of the actual endpoint (see the ingest response above):

| Records | Outcome | Layer |
|---|---|---|
| `str-99120` × 2 | one mention | `external_id` |
| `nst-40021` (same URL as `str-99120`, different id) | folded in | `url` |
| `mkn-1201` + `mkn-1202` (identical body, different URL, same outlet) | one mention | `fingerprint` |
| `str-99502` + `nst-40199` (same story, two outlets) | **kept separate** | — |

### Merge, not skip

A duplicate is merged, not discarded — skipping loses information that
arrived late:

- `mkn-1201` has no date; `mkn-1202` supplies `11/08/2026`.
- `str-99120` is seen with engagement 412, then 415, then `"1,204"` — the
  merged mention ends up at engagement 1204 (confirmed via `GET /mentions?q=ringgit`).

Merge policy: never overwrite a known value with NULL; `engagement` keeps
the highest value observed, because engagement rises monotonically and each
scrape is a snapshot; `ingest_count` and `last_seen_at` always update.

---

## Assumptions

Where the brief was silent, I chose and recorded the following.

**`"11/08/2026"` is 11 August, not 8 November.** The dataset spans 10–15
August 2026; reading it month-first makes this record a lone November
outlier. The platform is Malaysian, which uses day-first dates.

**Timestamps without a timezone are UTC, not MYT.** `nst-40021`
(`2026-08-10 08:20:00`) is a re-scrape of an article published at
`2026-08-10T08:15:00Z`. Read as MYT it would predate its own source by five
hours; read as UTC it lands five minutes later.

**`external_id` prefixes are opaque.** `nst-40021` carries `source:
"thestar"` and a `thestar.com.my` URL — the field and the URL agree, only
the scraper's id prefix disagrees. I treat ids as arbitrary strings and
trust the source field, falling back to the URL host.

**Empty string and null titles mean the same thing.** Social posts carry
`null`; one Facebook record carries `""`. Both become NULL.

**Engagement is a monotonic counter.** Treated as a snapshot of a value that
only rises, which is why merges keep the maximum.

**Date filters exclude undated mentions.** `from`/`to` on a NULL
`published_at` is not answerable; excluding is more honest than guessing.

---

## Trade-offs I knowingly accepted

**No ORM.** The brief asked for a visible schema. Raw SQL also suits the
work here: few queries, but complicated ones (three-layer dedup lookup,
full-text search, timezone-aware aggregation). The cost is manual parameter
indexing in `buildWhere`, which is easy to get wrong; it is centralised in
one function and shared by search and stats so both stay consistent.

**Bulk ingest is serialised behind a transaction-scoped advisory lock.**
Dedup is a read-then-write, so two concurrent batches could both find no
match and both insert. The lock removes the race at the cost of parallelism.
Acceptable because this is a scheduled internal endpoint. The partial unique
indexes remain as a database-level backstop.

**In-batch deduplication happens in memory before any SQL runs.** This is
not an optimisation. Records 1 and 2 of the seed file are duplicates of each
other, and sending both into one `ON CONFLICT DO UPDATE` statement raises
*"command cannot affect row a second time"*. Keeping it as a pure function
also makes the riskiest logic testable without a database.

**`OFFSET` pagination.** Simple and correct for this dataset size, but it
degrades on large tables and can shift under concurrent writes. Keyset
pagination is the fix; see below.

**One English text-search configuration for a bilingual corpus.** The data
mixes English and Malay. The English stemmer does not stem Malay correctly,
though unstemmed Malay tokens still match exactly. Per-record language
detection is the proper fix and was out of scope.

**The source alias table lives in code.** Fine for six outlets, wrong for
six hundred. A `sources` table with an alias column, editable by an analyst,
is the production shape.

**Migrations are forward-only.** No `down` scripts. Roll-forward is what I
would do in production anyway, but a larger team would want `node-pg-migrate`
or `dbmate` rather than my 40-line runner.

**Numeric parsing strips all non-digits.** `"1,204"` → `1204`. This cannot
distinguish European-style `"1.204"` from a genuine decimal. The dataset uses
comma separators, so it is safe here.

**`env.example` ships with empty values, not sample defaults.** It documents
the three required variables (`DATABASE_URL`, `PGSSL`, `PORT`) without a
copy-pasteable fake credential sitting in the repo.

---

## Time spent

Roughly **10 hours across 3 sessions**, 18–20 August 2026:

- **Session 1** (~1.5h, 18 Aug): project scaffold — repo structure, TypeScript
  + Express setup, dependency versions pinned, seed data committed.
- **Session 2** (~5h, 19–20 Aug): the core of the system — schema migration,
  the six-function normalisation layer (dates, engagement, HTML, URLs,
  sources, fingerprinting) written without regex per the brief's constraint,
  the three-layer deduplication rule, and the three endpoints (bulk ingest,
  search, stats), plus the test suite covering that logic.
- **Session 3** (~3.5h, 20 Aug): read-only dashboard, verification against a
  real local PostgreSQL instance (migration, seed, every endpoint hit by
  hand), cleaning up the commit history into logical steps, and this README.

Built with Claude Code under close review — the brief explicitly allows this
("Use them. We do. There is no penalty"). The hours above are my own time:
reading the seed data and deciding the dedup rule, reviewing every function
Claude wrote, verifying results against the database, and rewriting sections
I wasn't satisfied with — not the time Claude spent generating text.

---

## With another week, I would…

1. **Split canonicalisation from storage.** Right now the dedup rule is
   applied at write time, so changing it means re-ingesting. With
   `mention_observations` already capturing every raw record, I would make
   canonical rows a derived view that can be rebuilt on demand. That turns
   the dedup rule from a one-way decision into a tunable parameter.

2. **Add fuzzy near-duplicate detection.** Exact fingerprints miss articles
   that differ by one edited sentence. SimHash or trigram similarity
   (`pg_trgm`) over the cleaned content, with a tunable threshold and a
   review queue for borderline pairs, rather than auto-merging.

3. **Move to keyset pagination** on `(published_at, id)`, and add a
   `Link`-style cursor to the response.

4. **Per-record language detection** feeding the right text-search
   configuration, so Malay content stems correctly.

5. **A merge audit endpoint** — `GET /mentions/:id/observations` — so an
   analyst can see exactly which raw records produced a mention and why.
   The data is already there; only the route is missing.

6. **An integration test against a real Postgres** via Testcontainers,
   covering the idempotency claim end to end rather than only at the
   in-memory dedup layer.

---

## Questions I would have asked

Two ambiguities I resolved by choosing, but would rather have confirmed:

1. On `nst-40021`, the `source` field and `external_id` prefix disagree.
   Which does your pipeline consider authoritative?
2. When an article is re-scraped and its title or body has been edited, do
   you want the record overwritten, or a version history kept? I chose
   overwrite-if-empty, which preserves the first version — a versioned model
   would be a different schema.
