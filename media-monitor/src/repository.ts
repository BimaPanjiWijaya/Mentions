import { pool } from "./db.js";
import type { CanonicalMention, MatchLayer } from "./types.js";

/**
 * Advisory lock key for bulk ingest. Any constant works; it just
 * has to be the same across processes.
 */
const INGEST_LOCK_KEY = 8_812_340_091;

export interface IngestSummary {
  inserted: number;
  merged: number;
  observations_recorded: number;
  total_mentions: number;
}

interface ExistingRow {
  id: number;
  match_layer: Exclude<MatchLayer, "new">;
}

/**
 * Finds an existing mention using the three-layer rule, in priority
 * order, in a single round trip.
 */
async function findExisting(
  client: import("pg").PoolClient,
  record: CanonicalMention,
): Promise<ExistingRow | null> {
  const sql = `
    SELECT
      id,
      CASE
        WHEN $2::text IS NOT NULL AND external_id = $2 THEN 'external_id'
        WHEN $3::text IS NOT NULL AND url_canonical = $3 THEN 'url'
        ELSE 'fingerprint'
      END AS match_layer,
      CASE
        WHEN $2::text IS NOT NULL AND external_id = $2 THEN 1
        WHEN $3::text IS NOT NULL AND url_canonical = $3 THEN 2
        ELSE 3
      END AS match_rank
    FROM mentions
    WHERE
         (source = $1 AND $2::text IS NOT NULL AND external_id = $2)
      OR ($3::text IS NOT NULL AND url_canonical = $3)
      OR (source = $1 AND $4::text IS NOT NULL AND content_fingerprint = $4)
    ORDER BY match_rank ASC, id ASC
    LIMIT 1
  `;

  const { rows } = await client.query(sql, [
    record.source,
    record.external_id,
    record.url_canonical,
    record.content_fingerprint,
  ]);

  return rows[0] ? { id: rows[0].id, match_layer: rows[0].match_layer } : null;
}

async function insertMention(
  client: import("pg").PoolClient,
  record: CanonicalMention,
): Promise<number> {
  const sql = `
    INSERT INTO mentions (
      source, source_display, source_raw, external_id,
      url_raw, url_canonical,
      title, content_raw, content_clean, author,
      published_at, published_at_raw,
      engagement, content_fingerprint,
      ingest_count
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6,
      $7, $8, $9, $10,
      $11, $12,
      $13, $14,
      $15
    )
    RETURNING id
  `;

  const { rows } = await client.query(sql, [
    record.source,
    record.source_display,
    record.source_raw,
    record.external_id,
    record.url_raw,
    record.url_canonical,
    record.title,
    record.content_raw,
    record.content_clean,
    record.author,
    record.published_at,
    record.published_at_raw,
    record.engagement,
    record.content_fingerprint,
    record.observations.length,
  ]);

  return rows[0].id as number;
}

/**
 * Merge policy, mirrored from dedupe.mergeInto:
 *   - never overwrite a known value with NULL
 *   - engagement keeps the highest value observed
 */
async function mergeMention(
  client: import("pg").PoolClient,
  id: number,
  record: CanonicalMention,
): Promise<void> {
  const sql = `
    UPDATE mentions SET
      title               = COALESCE(title, $2),
      content_raw         = COALESCE(content_raw, $3),
      content_clean       = COALESCE(content_clean, $4),
      author              = COALESCE(author, $5),
      published_at        = COALESCE(published_at, $6),
      published_at_raw    = COALESCE(published_at_raw, $7),
      external_id         = COALESCE(external_id, $8),
      url_raw             = COALESCE(url_raw, $9),
      url_canonical       = COALESCE(url_canonical, $10),
      content_fingerprint = COALESCE(content_fingerprint, $11),
      engagement          = GREATEST(engagement, $12),
      ingest_count        = ingest_count + $13,
      last_seen_at        = now()
    WHERE id = $1
  `;

  await client.query(sql, [
    id,
    record.title,
    record.content_raw,
    record.content_clean,
    record.author,
    record.published_at,
    record.published_at_raw,
    record.external_id,
    record.url_raw,
    record.url_canonical,
    record.content_fingerprint,
    record.engagement,
    record.observations.length,
  ]);
}

async function recordObservations(
  client: import("pg").PoolClient,
  mentionId: number,
  record: CanonicalMention,
  matchLayer: MatchLayer,
): Promise<number> {
  let recorded = 0;

  for (const observation of record.observations) {
    const { rowCount } = await client.query(
      `INSERT INTO mention_observations (
         mention_id, raw_hash, source_raw, external_id,
         url_raw, published_at_raw, engagement, match_layer
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (raw_hash) DO NOTHING`,
      [
        mentionId,
        observation.raw_hash,
        observation.source_raw,
        observation.external_id,
        observation.url_raw,
        observation.published_at_raw,
        observation.engagement,
        matchLayer,
      ],
    );
    recorded += rowCount ?? 0;
  }

  return recorded;
}

/**
 * Writes a batch of already-deduplicated records.
 *
 * The whole batch runs in one transaction behind a transaction-scoped
 * advisory lock. The lock serialises concurrent bulk ingests, which
 * removes a read-then-write race: two workers could otherwise both
 * find no match and both insert.
 *
 * Trade-off: bulk ingest cannot run in parallel. Acceptable here,
 * because this is an internal pipeline endpoint that runs on a
 * schedule, not a user-facing write path.
 */
export async function ingestCanonical(
  records: CanonicalMention[],
): Promise<IngestSummary> {
  const client = await pool.connect();

  let inserted = 0;
  let merged = 0;
  let observationsRecorded = 0;

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [INGEST_LOCK_KEY]);

    for (const record of records) {
      const existing = await findExisting(client, record);

      if (existing) {
        await mergeMention(client, existing.id, record);
        observationsRecorded += await recordObservations(
          client,
          existing.id,
          record,
          existing.match_layer,
        );
        merged++;
      } else {
        const id = await insertMention(client, record);
        observationsRecorded += await recordObservations(client, id, record, "new");
        inserted++;
      }
    }

    const { rows } = await client.query("SELECT count(*)::int AS total FROM mentions");
    await client.query("COMMIT");

    return {
      inserted,
      merged,
      observations_recorded: observationsRecorded,
      total_mentions: rows[0].total as number,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
