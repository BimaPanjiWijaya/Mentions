export function parsePublishedAt(input: unknown): Date | null {
  if (input === null || input === undefined) return null;

  if (typeof input === "number") {
    return parseEpoch(input);
  }

  if (typeof input !== "string") return null;

  const raw = input.trim();
  if (raw === "") return null;

  if (isAllDigits(raw) && (raw.length === 10 || raw.length === 13)) {
    return parseEpoch(Number(raw));
  }

  if (raw.includes("/")) {
    return parseSlashDate(raw);
  }

  if (raw.includes(" ") && !raw.includes("T")) {
    return parseNaiveSpaceDate(raw);
  }

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
  const ms = Math.abs(value) > 1e12 ? value : value * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

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
