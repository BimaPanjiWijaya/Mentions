export interface NormalizedSource {
  slug: string;
  display: string;
}

/**
 * Known outlets. The key is the raw value squashed to [a-z0-9].
 * "The Star", "thestar", "THE  STAR" all squash to "thestar".
 */
const ALIASES: Record<string, NormalizedSource> = {
  thestar: { slug: "the-star", display: "The Star" },
  thestarcommy: { slug: "the-star", display: "The Star" },
  star: { slug: "the-star", display: "The Star" },

  newstraitstimes: { slug: "new-straits-times", display: "New Straits Times" },
  nst: { slug: "new-straits-times", display: "New Straits Times" },
  nstcommy: { slug: "new-straits-times", display: "New Straits Times" },

  malaysiakini: { slug: "malaysiakini", display: "Malaysiakini" },
  malaysiakinicom: { slug: "malaysiakini", display: "Malaysiakini" },

  twitter: { slug: "twitter", display: "Twitter" },
  x: { slug: "twitter", display: "Twitter" },
  twittercom: { slug: "twitter", display: "Twitter" },

  facebook: { slug: "facebook", display: "Facebook" },
  fb: { slug: "facebook", display: "Facebook" },
  facebookcom: { slug: "facebook", display: "Facebook" },

  instagram: { slug: "instagram", display: "Instagram" },
  ig: { slug: "instagram", display: "Instagram" },
  instagramcom: { slug: "instagram", display: "Instagram" },
};

function isAsciiAlnum(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9");
}

/** "The  Star!" -> "thestar" - used as a lookup key, spacing/casing-proof. */
function squash(value: string): string {
  let result = "";
  for (const ch of value.toLowerCase()) {
    if (isAsciiAlnum(ch)) result += ch;
  }
  return result;
}

/** "The  Star!" -> "the-star" - used as a stable, readable identifier. */
function slugify(value: string): string {
  let result = "";
  let lastWasDash = true; // suppresses a leading dash

  for (const ch of value.toLowerCase().trim()) {
    if (isAsciiAlnum(ch)) {
      result += ch;
      lastWasDash = false;
    } else if (!lastWasDash) {
      result += "-";
      lastWasDash = true;
    }
  }

  while (result.endsWith("-")) result = result.slice(0, -1);
  return result;
}

/**
 * Resolves the source field to a stable slug.
 *
 * Precedence:
 *   1. the `source` field, matched against the alias table
 *   2. the URL host, matched against the alias table
 *   3. a slug derived from the raw source field
 *   4. "unknown"
 *
 * Note: we deliberately IGNORE the external_id prefix as evidence.
 * In the seed data, record `nst-40021` carries source "thestar" and
 * a thestar.com.my URL. The field and the URL agree; only the
 * scraper-assigned id prefix disagrees. Ids are opaque strings, not
 * a source of truth.
 */
export function normalizeSource(
  rawSource: unknown,
  canonicalUrl?: string | null,
): NormalizedSource {
  const raw = typeof rawSource === "string" ? rawSource.trim() : "";

  const bySource = ALIASES[squash(raw)];
  if (bySource) return bySource;

  if (canonicalUrl) {
    const host = canonicalUrl.split("/")[0] ?? "";
    const byHost = ALIASES[squash(host)];
    if (byHost) return byHost;

    if (raw === "" && host !== "") {
      return { slug: slugify(host), display: host };
    }
  }

  if (raw !== "") {
    return { slug: slugify(raw), display: raw };
  }

  return { slug: "unknown", display: "Unknown" };
}
