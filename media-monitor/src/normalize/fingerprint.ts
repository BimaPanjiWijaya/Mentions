import { createHash } from "node:crypto";

/**
 * Content shorter than this is not fingerprinted. Short posts
 * ("MRT3 at 40%??", "Banjir kilat lagi") collide far too easily,
 * and collapsing two genuinely different social posts loses a
 * real mention - which is the thing this product counts.
 */
export const MIN_FINGERPRINT_LENGTH = 80;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Punctuation and symbols commonly found in scraped article text. */
const PUNCTUATION = new Set([
  ".", ",", "!", "?", ";", ":", '"', "'", "`", "(", ")", "[", "]", "{", "}",
  "<", ">", "/", "\\", "|", "@", "#", "$", "%", "^", "&", "*", "_", "+", "=",
  "~", "-", "—", "–", "…", "‘", "’", "“", "”", "«", "»",
]);

/** Rough code-point ranges for emoji and pictographic symbols. */
function isEmojiOrSymbol(codePoint: number): boolean {
  return (
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) || // emoji blocks
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||    // misc symbols, dingbats
    (codePoint >= 0x2190 && codePoint <= 0x21ff) ||    // arrows
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f)       // variation selectors
  );
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/**
 * Lowercases, drops punctuation and emoji, collapses whitespace.
 *
 * Scans code points rather than using a `\p{L}\p{N}` Unicode regex. This
 * is less complete for scripts outside Latin (accented letters pass
 * through fine via NFKD normalisation; some other scripts might not be
 * perfectly handled), which is an acceptable trade-off for this dataset's
 * English/Malay content and is noted in the README.
 */
export function normalizeText(value: string): string {
  const lowered = value.toLowerCase().normalize("NFKD");
  let result = "";
  let lastWasSpace = true; // suppresses a leading space

  for (const ch of lowered) {
    const codePoint = ch.codePointAt(0) ?? 0;
    const isSeparator = PUNCTUATION.has(ch) || isEmojiOrSymbol(codePoint) || isWhitespace(ch);

    if (isSeparator) {
      if (!lastWasSpace) {
        result += " ";
        lastWasSpace = true;
      }
      continue;
    }

    result += ch;
    lastWasSpace = false;
  }

  return result.trim();
}

/**
 * Fingerprint is SCOPED PER SOURCE by design.
 *
 * Two outlets covering the same story are two mentions, and both
 * are valuable to a PR analyst. Only near-identical text from the
 * SAME outlet is treated as a re-scrape.
 *
 * Requires both a title and a long-enough body, so a source that
 * publishes boilerplate stubs cannot collapse its whole feed.
 */
export function contentFingerprint(
  sourceSlug: string,
  title: string | null,
  contentClean: string,
): string | null {
  if (contentClean.length < MIN_FINGERPRINT_LENGTH) return null;

  const normalizedTitle = normalizeText(title ?? "");
  const normalizedContent = normalizeText(contentClean);

  if (normalizedTitle === "" || normalizedContent === "") return null;

  return sha256(`${sourceSlug}::${normalizedTitle}::${normalizedContent}`);
}
