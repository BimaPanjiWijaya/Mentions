-- ============================================================
-- 001_init.sql
-- Media monitoring: canonical mentions + raw observation log
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Canonical mentions
-- One row = one distinct piece of coverage, after deduplication.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mentions (
    id                  BIGSERIAL PRIMARY KEY,

    -- Source identity
    source              TEXT        NOT NULL,   -- normalised slug, e.g. "the-star"
    source_display      TEXT        NOT NULL,   -- human label, e.g. "The Star"
    source_raw          TEXT,                   -- first raw value we saw

    -- Upstream identity
    external_id         TEXT,                   -- scraper-assigned id, may be null

    -- Location
    url_raw             TEXT,
    url_canonical       TEXT,                   -- host + path + filtered query, no scheme

    -- Payload
    title               TEXT,
    content_raw         TEXT,                   -- exactly as ingested (may contain HTML)
    content_clean       TEXT,                   -- tags stripped, entities decoded
    author              TEXT,

    -- Time
    published_at        TIMESTAMPTZ,            -- NULL is meaningful: date unknown
    published_at_raw    TEXT,                   -- original value, for debugging

    -- Metrics
    engagement          INTEGER     NOT NULL DEFAULT 0,

    -- Dedup support
    content_fingerprint TEXT,                   -- sha256(source::title::content), nullable

    -- Provenance
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    ingest_count        INTEGER     NOT NULL DEFAULT 1,

    -- Full-text search over title + cleaned content
    search_vector       TSVECTOR GENERATED ALWAYS AS (
        to_tsvector(
            'english',
            coalesce(title, '') || ' ' || coalesce(content_clean, '')
        )
    ) STORED,

    CONSTRAINT engagement_non_negative CHECK (engagement >= 0)
);

-- ------------------------------------------------------------
-- Dedup constraints (see README: three-layer rule)
-- Partial indexes: NULLs never collide.
-- ------------------------------------------------------------

-- Layer 1: upstream natural key
CREATE UNIQUE INDEX IF NOT EXISTS mentions_source_external_id_uniq
    ON mentions (source, external_id)
    WHERE external_id IS NOT NULL;

-- Layer 2: canonical URL is a global identity for an article
CREATE UNIQUE INDEX IF NOT EXISTS mentions_url_canonical_uniq
    ON mentions (url_canonical)
    WHERE url_canonical IS NOT NULL;

-- Layer 3: content fingerprint, SCOPED PER SOURCE on purpose
CREATE UNIQUE INDEX IF NOT EXISTS mentions_source_fingerprint_uniq
    ON mentions (source, content_fingerprint)
    WHERE content_fingerprint IS NOT NULL;

-- ------------------------------------------------------------
-- Query indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS mentions_published_at_idx
    ON mentions (published_at DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS mentions_source_idx
    ON mentions (source);

CREATE INDEX IF NOT EXISTS mentions_search_vector_idx
    ON mentions USING GIN (search_vector);

-- ------------------------------------------------------------
-- Raw observation log
-- Every accepted input record lands here, even when it merges
-- into an existing mention. This makes dedup auditable and
-- lets us re-derive canonical rows if the rule changes.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mention_observations (
    id               BIGSERIAL PRIMARY KEY,
    mention_id       BIGINT      NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,

    raw_hash         TEXT        NOT NULL,   -- sha256 of the raw JSON record
    source_raw       TEXT,
    external_id      TEXT,
    url_raw          TEXT,
    published_at_raw TEXT,
    engagement       INTEGER,

    -- which dedup layer matched: 'new' | 'external_id' | 'url' | 'fingerprint'
    match_layer      TEXT        NOT NULL,

    observed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Re-posting the exact same record is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS mention_observations_raw_hash_uniq
    ON mention_observations (raw_hash);

CREATE INDEX IF NOT EXISTS mention_observations_mention_id_idx
    ON mention_observations (mention_id);

COMMIT;
