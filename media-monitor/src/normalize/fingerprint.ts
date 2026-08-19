import { createHash } from "node:crypto";

export const MIN_FINGERPRINT_LENGTH = 80;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const PUNCTUATION = new Set([
  ".", ",", "!", "?", ";", ":", '"', "'", "`", "(", ")", "[", "]", "{", "}",
  "<", ">", "/", "\\", "|", "@", "#", "$", "%", "^", "&", "*", "_", "+", "=",
  "~", "-", "—", "–", "…", "‘", "’", "“", "”", "«", "»",
]);

function isEmojiOrSymbol(codePoint: number): boolean {
  return (
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    (codePoint >= 0x2190 && codePoint <= 0x21ff) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
  );
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

export function normalizeText(value: string): string {
  const lowered = value.toLowerCase().normalize("NFKD");
  let result = "";
  let lastWasSpace = true;

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
