const HOST_PREFIXES_TO_STRIP = ["www.", "m.", "mobile.", "amp."];

const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "igshid", "mc_cid", "mc_eid",
  "ref", "ref_src", "si", "s", "_ga",
]);

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

function stripHostPrefix(host: string): string {
  for (const prefix of HOST_PREFIXES_TO_STRIP) {
    if (host.startsWith(prefix)) return host.slice(prefix.length);
  }
  return host;
}

function stripTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path.charAt(end - 1) === "/") end--;
  return path.slice(0, end);
}

/**
 * Produces a comparable identity for a URL.
 *
 *   https://www.thestar.com.my/business/2026/08/10/ringgit-strengthens?utm_source=fb
 *   -> thestar.com.my/business/2026/08/10/ringgit-strengthens
 *
 * The scheme is dropped entirely so http/https variants of the same
 * article collapse. Tracking parameters are removed; remaining
 * parameters are sorted so ordering does not affect identity.
 */
export function canonicalizeUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;

  const raw = input.trim();
  if (raw === "") return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  let host = stripHostPrefix(parsed.hostname.toLowerCase());
  if (host === "x.com") host = "twitter.com"; // same platform, two domains

  let path = stripTrailingSlashes(parsed.pathname);
  if (path === "") path = "/";

  const params = [...parsed.searchParams.entries()]
    .filter(([key]) => !isTrackingParam(key))
    .sort(([a], [b]) => a.localeCompare(b));

  const query = params.length
    ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&")
    : "";

  return `${host}${path}${query}`;
}
