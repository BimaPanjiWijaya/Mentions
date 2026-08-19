import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dedupeBatch } from "../src/dedupe.js";
import type { RawMention } from "../src/types.js";

const seed = JSON.parse(
  readFileSync(join(process.cwd(), "data", "seed_mentions.json"), "utf8"),
) as RawMention[];

describe("dedupeBatch on the real seed file", () => {
  const result = dedupeBatch(seed);

  it("collapses 15 records into 12 mentions", () => {
    expect(result.received).toBe(15);
    expect(result.canonical).toHaveLength(12);
    expect(result.rejected).toHaveLength(0);
  });

  it("merges the exact duplicate and the same-URL-different-id record", () => {
    const ringgit = result.canonical.find(
      (m) => m.url_canonical?.includes("ringgit-strengthens"),
    );
    expect(ringgit).toBeDefined();
    expect(ringgit!.observations).toHaveLength(3);
    expect(ringgit!.engagement).toBe(1204);
  });

  it("merges near-identical articles from the same source", () => {
    const gdp = result.canonical.filter((m) =>
      m.title?.toLowerCase().includes("gdp outlook"),
    );
    expect(gdp).toHaveLength(1);
    expect(gdp[0]!.published_at?.toISOString()).toBe("2026-08-11T00:00:00.000Z");
  });

  it("keeps the same story from two different outlets as two mentions", () => {
    const tourism = result.canonical.filter((m) =>
      m.title?.toLowerCase().includes("tourism arrivals"),
    );
    expect(tourism).toHaveLength(2);
    expect(new Set(tourism.map((m) => m.source))).toEqual(
      new Set(["the-star", "new-straits-times"]),
    );
  });

  it("keeps short social posts separate", () => {
    const social = result.canonical.filter((m) =>
      ["twitter", "facebook", "instagram"].includes(m.source),
    );
    expect(social).toHaveLength(4);
  });

  it("is stable when the same batch is processed twice", () => {
    const again = dedupeBatch([...seed, ...seed]);
    expect(again.canonical).toHaveLength(12);
  });
});
