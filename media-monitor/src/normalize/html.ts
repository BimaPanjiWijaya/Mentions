const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

const BLOCK_TAGS = new Set([
  "p", "div", "li", "tr", "br",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "section", "article",
]);

const STRIP_CONTENT_TAGS = new Set(["script", "style"]);

export function stripHtml(input: string): string {
  let result = "";
  let i = 0;
  const lower = input.toLowerCase();

  while (i < input.length) {
    const ch = input[i];

    if (ch !== "<") {
      result += ch;
      i++;
      continue;
    }

    if (input.startsWith("<!--", i)) {
      const end = input.indexOf("-->", i + 4);
      i = end === -1 ? input.length : end + 3;
      result += " ";
      continue;
    }

    const closeIdx = input.indexOf(">", i);
    if (closeIdx === -1) {
      break;
    }

    const tagName = readTagName(input.slice(i + 1, closeIdx));

    if (STRIP_CONTENT_TAGS.has(tagName)) {
      const closingTag = `</${tagName}`;
      const closingIdx = lower.indexOf(closingTag, closeIdx + 1);
      if (closingIdx === -1) {
        i = input.length;
      } else {
        const closingTagEnd = input.indexOf(">", closingIdx);
        i = closingTagEnd === -1 ? input.length : closingTagEnd + 1;
      }
      result += " ";
      continue;
    }

    if (BLOCK_TAGS.has(tagName)) {
      result += " ";
    }

    i = closeIdx + 1;
  }

  return result;
}

function readTagName(rawTag: string): string {
  let trimmed = rawTag.trim();
  if (trimmed.startsWith("/")) trimmed = trimmed.slice(1);

  let name = "";
  for (const ch of trimmed) {
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "/") break;
    name += ch;
  }
  return name.toLowerCase();
}

export function decodeEntities(input: string): string {
  let result = "";
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === "&") {
      const semiIdx = input.indexOf(";", i);
      if (semiIdx !== -1 && semiIdx - i <= 10) {
        const entity = input.slice(i + 1, semiIdx);
        const decoded = decodeEntity(entity);
        if (decoded !== null) {
          result += decoded;
          i = semiIdx + 1;
          continue;
        }
      }
    }

    result += ch;
    i++;
  }

  return result;
}

function decodeEntity(entity: string): string | null {
  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    const hex = entity.slice(2);
    return isHexDigits(hex) ? String.fromCodePoint(Number.parseInt(hex, 16)) : null;
  }

  if (entity.startsWith("#")) {
    const dec = entity.slice(1);
    return isDigits(dec) ? String.fromCodePoint(Number.parseInt(dec, 10)) : null;
  }

  return NAMED_ENTITIES[entity.toLowerCase()] ?? null;
}

function isDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (const ch of value) {
    if (ch < "0" || ch > "9") return false;
  }
  return true;
}

function isHexDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (const ch of value.toLowerCase()) {
    const isDigit = ch >= "0" && ch <= "9";
    const isHexLetter = ch >= "a" && ch <= "f";
    if (!isDigit && !isHexLetter) return false;
  }
  return true;
}

function collapseWhitespace(input: string): string {
  let result = "";
  let lastWasSpace = false;

  for (const ch of input) {
    const isSpace = ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
    if (isSpace) {
      if (!lastWasSpace) result += " ";
      lastWasSpace = true;
    } else {
      result += ch;
      lastWasSpace = false;
    }
  }

  return result.trim();
}

export function cleanContent(input: unknown): string {
  if (typeof input !== "string") return "";
  return collapseWhitespace(decodeEntities(stripHtml(input)));
}
