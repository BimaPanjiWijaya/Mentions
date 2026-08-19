/**
 * Parses the five date shapes present in the seed data:
 *
 *   "2026-08-10T08:15:00Z"        ISO with UTC marker
 *   "2026-08-11T14:02:33+08:00"   ISO with offset
 *   "2026-08-10 08:20:00"         naive, no timezone  -> assumed UTC
 *   1786435200                    unix epoch seconds
 *   "11/08/2026"                  DD/MM/YYYY
 *   null / "" / garbage           -> null
 *
 * Returns null rather than guessing. A wrong date is worse than
 * a missing one: it silently corrupts every time-series chart.
 */
export function parsePublishedAt(input: unknown): Date | null {
  if (input === null || input === undefined) return null;

  if (typeof input === "number") {
    return parseEpoch(input);
  }

  if (typeof input !== "string") return null;

  const raw = input.trim();
  if (raw === "") return null;

  // --- Unix epoch encoded as a string, e.g. "1786435200" ---
  if (isAllDigits(raw) && (raw.length === 10 || raw.length === 13)) {
    return parseEpoch(Number(raw));
  }

  // --- DD/MM/YYYY ---
  if (raw.includes("/")) {
    return parseSlashDate(raw);
  }

  // --- Naive timestamp with a space separator and no timezone marker ---
  // "2026-08-10 08:20:00"
  if (raw.includes(" ") && !raw.includes("T")) {
    return parseNaiveSpaceDate(raw);
  }

  // --- Anything else: let the engine try. It natively understands
  //     "Z" and "+08:00" offsets, so ISO strings pass straight through. ---
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isAllDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (const ch of value) {
    if (ch < "0" || ch > "9") return false;
  }
  return true;
}

function parseEpoch(value: number): Date | null {
  if (!Number.isFinite(value)) return null;
  // Heuristic: values above 1e12 are already milliseconds.
  const ms = Math.abs(value) > 1e12 ? value : value * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * "11/08/2026" -> 11 August 2026.
 * Assumed day-first, not month-first. See README for the reasoning.
 */
function parseSlashDate(raw: string): Date | null {
  const parts = raw.split("/");
  if (parts.length !== 3) return null;

  const [dayPart, monthPart, yearPart] = parts as [string, string, string];
  if (!isAllDigits(dayPart) || !isAllDigits(monthPart) || !isAllDigits(yearPart)) {
    return null;
  }
  if (yearPart.length !== 4) return null;

  const day = Number(dayPart);
  const month = Number(monthPart);
  const year = Number(yearPart);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject impossible dates like 31/02/2026 that JS would otherwise roll over
  // into March.
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

/** "2026-08-10 08:20:00" or "2026-08-10 08:20" -> treated as UTC. */
function parseNaiveSpaceDate(raw: string): Date | null {
  const [datePart, timePart] = raw.split(" ");
  if (!datePart || !timePart) return null;

  const dateSegments = datePart.split("-");
  if (dateSegments.length !== 3 || dateSegments.some((seg) => !isAllDigits(seg))) {
    return null;
  }

  const timeSegments = timePart.split(":");
  if (timeSegments.length < 2 || timeSegments.some((seg) => !isAllDigits(seg))) {
    return null;
  }

  const normalizedTime =
    timeSegments.length === 2 ? `${timePart}:00` : timePart;

  const d = new Date(`${datePart}T${normalizedTime}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
