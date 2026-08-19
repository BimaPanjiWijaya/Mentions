import { describe, it, expect } from "vitest";
import { parsePublishedAt } from "../src/normalize/date.js";
import { parseEngagement } from "../src/normalize/engagement.js";
import { cleanContent } from "../src/normalize/html.js";
import { canonicalizeUrl } from "../src/normalize/url.js";
import { normalizeSource } from "../src/normalize/source.js";

describe("parsePublishedAt", () => {
  it("parses ISO with a UTC marker", () => {
    expect(parsePublishedAt("2026-08-10T08:15:00Z")?.toISOString()).toBe(
      "2026-08-10T08:15:00.000Z",
    );
  });

  it("converts an explicit offset to UTC", () => {
    expect(parsePublishedAt("2026-08-11T14:02:33+08:00")?.toISOString()).toBe(
      "2026-08-11T06:02:33.000Z",
    );
  });

  it("treats a naive timestamp as UTC, not local time", () => {
    // Regression guard: if this ever parses as MYT, nst-40021 would
    // land five hours BEFORE the article it is a re-scrape of.
    expect(parsePublishedAt("2026-08-10 08:20:00")?.toISOString()).toBe(
      "2026-08-10T08:20:00.000Z",
    );
  });

  it("parses unix epoch seconds", () => {
    expect(parsePublishedAt(1786435200)?.toISOString()).toBe(
      "2026-08-11T08:00:00.000Z",
    );
  });

  it("reads slash dates as day-first", () => {
    // 11 August, not 8 November. The whole dataset sits in August.
    expect(parsePublishedAt("11/08/2026")?.toISOString()).toBe(
      "2026-08-11T00:00:00.000Z",
    );
  });

  it("returns null instead of guessing", () => {
    expect(parsePublishedAt(null)).toBeNull();
    expect(parsePublishedAt("")).toBeNull();
    expect(parsePublishedAt("not a date")).toBeNull();
    expect(parsePublishedAt("31/02/2026")).toBeNull();
  });
});

describe("parseEngagement", () => {
  it("keeps plain numbers", () => {
    expect(parseEngagement(412)).toBe(412);
  });

  it("strips thousands separators from strings", () => {
    expect(parseEngagement("1,204")).toBe(1204);
    expect(parseEngagement("3,402")).toBe(3402);
  });

  it("expands compact notation", () => {
    expect(parseEngagement("1.2k")).toBe(1200);
  });

  it("defaults to zero for missing values", () => {
    expect(parseEngagement(null)).toBe(0);
    expect(parseEngagement(undefined)).toBe(0);
  });
});

describe("cleanContent", () => {
  it("removes script blocks together with their contents", () => {
    const input =
      '<p>Several roads were impassable.</p><script>alert(1)</script>';
    const output = cleanContent(input);
    expect(output).toBe("Several roads were impassable.");
    expect(output).not.toContain("alert");
  });

  it("decodes entities", () => {
    expect(cleanContent("<p>buoyed by&nbsp;improved sentiment.</p>")).toBe(
      "buoyed by improved sentiment.",
    );
    expect(cleanContent("citing &quot;balanced&quot; risks")).toBe(
      'citing "balanced" risks',
    );
  });

  it("does not resurrect markup hidden behind entities", () => {
    expect(cleanContent("&lt;script&gt;alert(1)&lt;/script&gt;")).toBe(
      "<script>alert(1)</script>",
    );
    // Decoded for display, but never re-parsed as HTML.
  });
});

describe("canonicalizeUrl", () => {
  it("drops scheme, www and tracking parameters", () => {
    expect(
      canonicalizeUrl(
        "https://www.thestar.com.my/business/2026/08/10/ringgit-strengthens?utm_source=fb",
      ),
    ).toBe("thestar.com.my/business/2026/08/10/ringgit-strengthens");
  });

  it("treats http and https as the same article", () => {
    expect(canonicalizeUrl("http://nst.com.my/a")).toBe(
      canonicalizeUrl("https://www.nst.com.my/a/"),
    );
  });

  it("returns null for unusable input", () => {
    expect(canonicalizeUrl(null)).toBeNull();
    expect(canonicalizeUrl("not-a-url")).toBeNull();
  });
});

describe("normalizeSource", () => {
  it("collapses casing, spacing and abbreviations", () => {
    expect(normalizeSource("The Star").slug).toBe("the-star");
    expect(normalizeSource("thestar").slug).toBe("the-star");
    expect(normalizeSource("malaysiakini ").slug).toBe("malaysiakini");
    expect(normalizeSource("TWITTER").slug).toBe("twitter");
    expect(normalizeSource("twitter").slug).toBe("twitter");
  });

  it("falls back to the URL host when the source field is empty", () => {
    expect(normalizeSource("", "nst.com.my/news/x").slug).toBe(
      "new-straits-times",
    );
  });
});
