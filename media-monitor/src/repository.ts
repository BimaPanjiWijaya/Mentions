import { pool } from "./db.js";
import type { CanonicalMention, MatchLayer } from "./types.js";
import { config } from "./config.js";

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

export interface SearchParams {
  q?: string;
  source?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
  sort: "published_desc" | "published_asc" | "engagement_desc" | "relevance";
}

interface WhereClause {
  sql: string;
  values: unknown[];
}

function buildWhere(params: SearchParams): WhereClause {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.q) {
    values.push(params.q);
    conditions.push(`search_vector @@ websearch_to_tsquery('english', $${values.length})`);
  }

  if (params.source) {
    values.push(params.source.toLowerCase());
    conditions.push(`source = $${values.length}`);
  }

  if (params.from) {
    values.push(params.from);
    conditions.push(`published_at >= $${values.length}`);
  }

  if (params.to) {
    values.push(params.to);
    conditions.push(`published_at <= $${values.length}`);
  }

  return {
    sql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    values,
  };
}

function buildOrderBy(params: SearchParams, qParamIndex: number | null): string {
  switch (params.sort) {
    case "published_asc":
      return "ORDER BY published_at ASC NULLS LAST, id DESC";
    case "engagement_desc":
      return "ORDER BY engagement DESC, published_at DESC NULLS LAST, id DESC";
    case "relevance":
      return qParamIndex
        ? `ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', $${qParamIndex})) DESC, published_at DESC NULLS LAST, id DESC`
        : "ORDER BY published_at DESC NULLS LAST, id DESC";
    case "published_desc":
    default:
      return "ORDER BY published_at DESC NULLS LAST, id DESC";
  }
}

export async function searchMentions(params: SearchParams) {
  const where = buildWhere(params);
  const qParamIndex = params.q ? 1 : null;
  const orderBy = buildOrderBy(params, qParamIndex);

  const offset = (params.page - 1) * params.limit;
  const limitIndex = where.values.length + 1;
  const offsetIndex = where.values.length + 2;

  const dataSql = `
    SELECT
      id, source, source_display, external_id,
      title, content_clean AS content, author,
      url_raw AS url, published_at, engagement,
      first_seen_at, last_seen_at, ingest_count
    FROM mentions
    ${where.sql}
    ${orderBy}
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
  `;

  const countSql = `SELECT count(*)::int AS total FROM mentions ${where.sql}`;

  const [dataResult, countResult] = await Promise.all([
    pool.query(dataSql, [...where.values, params.limit, offset]),
    pool.query(countSql, where.values),
  ]);

  const total = countResult.rows[0].total as number;

  return {
    data: dataResult.rows,
    meta: {
      page: params.page,
      limit: params.limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / params.limit)),
      sort: params.sort,
    },
  };
}

export async function statsBySource(params: SearchParams) {
  const where = buildWhere(params);

  const sql = `
    SELECT
      source            AS key,
      max(source_display) AS label,
      count(*)::int     AS count,
      sum(engagement)::bigint AS total_engagement
    FROM mentions
    ${where.sql}
    GROUP BY source
    ORDER BY count DESC, source ASC
  `;

  const { rows } = await pool.query(sql, where.values);
  return rows;
}

export async function statsByDay(params: SearchParams) {
  const where = buildWhere(params);
  const values = [...where.values, config.reportingTimezone];
  const tzIndex = values.length;

  const sql = `
    SELECT
      COALESCE(
        to_char((published_at AT TIME ZONE $${tzIndex})::date, 'YYYY-MM-DD'),
        'unknown'
      ) AS key,
      count(*)::int AS count,
      sum(engagement)::bigint AS total_engagement
    FROM mentions
    ${where.sql}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  const { rows } = await pool.query(sql, values);
  return rows;
}
