/**
 * Engagement arrives as a number (412), a formatted string ("1,204"),
 * compact notation ("1.2k"), or missing. Always returns a non-negative
 * integer.
 */
export function parseEngagement(input: unknown): number {
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.max(0, Math.trunc(input)) : 0;
  }

  if (typeof input !== "string") return 0;

  const raw = input.trim().toLowerCase();
  if (raw === "") return 0;

  const lastChar = raw.charAt(raw.length - 1);
  if (lastChar === "k" || lastChar === "m") {
    const base = parseDecimal(raw.slice(0, -1));
    if (base === null) return 0;
    const factor = lastChar === "k" ? 1_000 : 1_000_000;
    return Math.max(0, Math.trunc(base * factor));
  }

  const digits = keepDigitsOnly(raw);
  if (digits === "") return 0;

  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** Keeps only characters '0'-'9', dropping commas, spaces, everything else. */
function keepDigitsOnly(value: string): string {
  let result = "";
  for (const ch of value) {
    if (ch >= "0" && ch <= "9") result += ch;
  }
  return result;
}

/** Keeps digits and at most one decimal point, e.g. for "1.2k" -> 1.2. */
function parseDecimal(value: string): number | null {
  let result = "";
  let sawDot = false;

  for (const ch of value) {
    if (ch >= "0" && ch <= "9") {
      result += ch;
    } else if (ch === "." && !sawDot) {
      result += ch;
      sawDot = true;
    }
    // commas and anything else are silently dropped
  }

  if (result === "" || result === ".") return null;
  const n = Number(result);
  return Number.isFinite(n) ? n : null;
}
