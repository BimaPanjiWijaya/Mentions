BEGIN;

CREATE TABLE IF NOT EXISTS mentions (
    id                  BIGSERIAL PRIMARY KEY,

    source              TEXT        NOT NULL,
    source_display      TEXT        NOT NULL,
    source_raw          TEXT,

    external_id         TEXT,

    url_raw             TEXT,
    url_canonical       TEXT,

    title               TEXT,
    content_raw         TEXT,
    content_clean       TEXT,
    author              TEXT,

    published_at        TIMESTAMPTZ,
    published_at_raw    TEXT,

    engagement          INTEGER     NOT NULL DEFAULT 0,

    content_fingerprint TEXT,

    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    ingest_count        INTEGER     NOT NULL DEFAULT 1,

    search_vector       TSVECTOR GENERATED ALWAYS AS (
        to_tsvector(
            'english',
            coalesce(title, '') || ' ' || coalesce(content_clean, '')
        )
    ) STORED,

    CONSTRAINT engagement_non_negative CHECK (engagement >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS mentions_source_external_id_uniq
    ON mentions (source, external_id)
    WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mentions_url_canonical_uniq
    ON mentions (url_canonical)
    WHERE url_canonical IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mentions_source_fingerprint_uniq
    ON mentions (source, content_fingerprint)
    WHERE content_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS mentions_published_at_idx
    ON mentions (published_at DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS mentions_source_idx
    ON mentions (source);

CREATE INDEX IF NOT EXISTS mentions_search_vector_idx
    ON mentions USING GIN (search_vector);

CREATE TABLE IF NOT EXISTS mention_observations (
    id               BIGSERIAL PRIMARY KEY,
    mention_id       BIGINT      NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,

    raw_hash         TEXT        NOT NULL,
    source_raw       TEXT,
    external_id      TEXT,
    url_raw          TEXT,
    published_at_raw TEXT,
    engagement       INTEGER,

    match_layer      TEXT        NOT NULL,

    observed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mention_observations_raw_hash_uniq
    ON mention_observations (raw_hash);

CREATE INDEX IF NOT EXISTS mention_observations_mention_id_idx
    ON mention_observations (mention_id);

COMMIT;
