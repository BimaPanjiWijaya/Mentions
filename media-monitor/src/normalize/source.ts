export interface NormalizedSource {
  slug: string;
  display: string;
}

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

function squash(value: string): string {
  let result = "";
  for (const ch of value.toLowerCase()) {
    if (isAsciiAlnum(ch)) result += ch;
  }
  return result;
}

function slugify(value: string): string {
  let result = "";
  let lastWasDash = true;

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
