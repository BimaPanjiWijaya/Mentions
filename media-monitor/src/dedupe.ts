import { parsePublishedAt } from "./normalize/date.js";
import { parseEngagement } from "./normalize/engagement.js";
import { cleanContent } from "./normalize/html.js";
import { canonicalizeUrl } from "./normalize/url.js";
import { normalizeSource } from "./normalize/source.js";
import { contentFingerprint, sha256 } from "./normalize/fingerprint.js";
import type {
  CanonicalMention,
  DedupeResult,
  RawMention,
  RejectedRecord,
} from "./types.js";

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function normalizeRecord(raw: RawMention): CanonicalMention {
  const urlRaw = asTrimmedString(raw.url);
  const urlCanonical = canonicalizeUrl(raw.url);
  const { slug, display } = normalizeSource(raw.source, urlCanonical);

  const contentRaw = typeof raw.content === "string" ? raw.content : null;
  const contentClean = cleanContent(raw.content);
  const title = asTrimmedString(raw.title);

  const publishedAtRaw =
    raw.published_at === null || raw.published_at === undefined
      ? null
      : String(raw.published_at);

  return {
    source: slug,
    source_display: display,
    source_raw: asTrimmedString(raw.source),
    external_id: asTrimmedString(raw.external_id),
    url_raw: urlRaw,
    url_canonical: urlCanonical,
    title,
    content_raw: contentRaw,
    content_clean: contentClean === "" ? null : contentClean,
    author: asTrimmedString(raw.author),
    published_at: parsePublishedAt(raw.published_at),
    published_at_raw: publishedAtRaw,
    engagement: parseEngagement(raw.engagement),
    content_fingerprint: contentFingerprint(slug, title, contentClean),
    observations: [
      {
        raw_hash: sha256(stableStringify(raw)),
        source_raw: asTrimmedString(raw.source),
        external_id: asTrimmedString(raw.external_id),
        url_raw: urlRaw,
        published_at_raw: publishedAtRaw,
        engagement: parseEngagement(raw.engagement),
      },
    ],
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function mergeInto(
  existing: CanonicalMention,
  incoming: CanonicalMention,
): void {
  existing.title ??= incoming.title;
  existing.content_raw ??= incoming.content_raw;
  existing.content_clean ??= incoming.content_clean;
  existing.author ??= incoming.author;
  existing.published_at ??= incoming.published_at;
  existing.published_at_raw ??= incoming.published_at_raw;
  existing.external_id ??= incoming.external_id;
  existing.url_raw ??= incoming.url_raw;
  existing.url_canonical ??= incoming.url_canonical;
  existing.content_fingerprint ??= incoming.content_fingerprint;

  existing.engagement = Math.max(existing.engagement, incoming.engagement);

  existing.observations.push(...incoming.observations);
}

export function dedupeBatch(records: RawMention[]): DedupeResult {
  const canonical: CanonicalMention[] = [];
  const rejected: RejectedRecord[] = [];

  const byExternalId = new Map<string, CanonicalMention>();
  const byUrl = new Map<string, CanonicalMention>();
  const byFingerprint = new Map<string, CanonicalMention>();

  records.forEach((raw, index) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      rejected.push({ index, reason: "not_an_object" });
      return;
    }

    const record = normalizeRecord(raw);

    if (!record.external_id && !record.url_canonical && !record.content_clean) {
      rejected.push({ index, reason: "no_identity_and_no_content" });
      return;
    }

    const externalKey = record.external_id
      ? `${record.source}::${record.external_id}`
      : null;
    const fingerprintKey = record.content_fingerprint
      ? `${record.source}::${record.content_fingerprint}`
      : null;

    const existing =
      (externalKey ? byExternalId.get(externalKey) : undefined) ??
      (record.url_canonical ? byUrl.get(record.url_canonical) : undefined) ??
      (fingerprintKey ? byFingerprint.get(fingerprintKey) : undefined);

    if (existing) {
      mergeInto(existing, record);
      indexRecord(existing);
      return;
    }

    canonical.push(record);
    indexRecord(record);
  });

  function indexRecord(record: CanonicalMention): void {
    if (record.external_id) {
      byExternalId.set(`${record.source}::${record.external_id}`, record);
    }
    if (record.url_canonical) {
      byUrl.set(record.url_canonical, record);
    }
    if (record.content_fingerprint) {
      byFingerprint.set(`${record.source}::${record.content_fingerprint}`, record);
    }
  }

  return {
    canonical,
    rejected,
    received: records.length,
    collapsed: records.length - canonical.length - rejected.length,
  };
}
