/** A record exactly as it arrives from the pipeline. */
export interface RawMention {
  external_id?: unknown;
  source?: unknown;
  title?: unknown;
  content?: unknown;
  url?: unknown;
  author?: unknown;
  published_at?: unknown;
  engagement?: unknown;
  [key: string]: unknown;
}

/** One accepted raw record, kept for audit. */
export interface Observation {
  raw_hash: string;
  source_raw: string | null;
  external_id: string | null;
  url_raw: string | null;
  published_at_raw: string | null;
  engagement: number;
}

/** A deduplicated mention, ready to be written to the database. */
export interface CanonicalMention {
  source: string;
  source_display: string;
  source_raw: string | null;
  external_id: string | null;
  url_raw: string | null;
  url_canonical: string | null;
  title: string | null;
  content_raw: string | null;
  content_clean: string | null;
  author: string | null;
  published_at: Date | null;
  published_at_raw: string | null;
  engagement: number;
  content_fingerprint: string | null;
  observations: Observation[];
}

export interface RejectedRecord {
  index: number;
  reason: string;
}

export interface DedupeResult {
  canonical: CanonicalMention[];
  rejected: RejectedRecord[];
  received: number;
  collapsed: number;
}

export type MatchLayer = "new" | "external_id" | "url" | "fingerprint";
