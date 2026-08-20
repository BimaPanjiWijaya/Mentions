import { describe, it, expect, afterAll } from "vitest";
import { pool } from "../src/db.js";
import { ingestCanonical } from "../src/repository.js";
import { dedupeBatch } from "../src/dedupe.js";
import type { RawMention } from "../src/types.js";

const TEST_EXTERNAL_ID = "itest-ingest-count-regression";

const fixture: RawMention[] = [
  {
    external_id: TEST_EXTERNAL_ID,
    source: "test-harness",
    title: "Regression fixture for ingest_count idempotency",
    content:
      "This row exists only to prove that re-posting an unchanged batch leaves ingest_count untouched.",
    url: "https://example.com/itest-ingest-count-regression",
    published_at: "2026-08-20T00:00:00Z",
    engagement: 1,
  },
];

describe("ingestCanonical against a real database", () => {
  afterAll(async () => {
    await pool.query("DELETE FROM mentions WHERE external_id = $1", [TEST_EXTERNAL_ID]);
    await pool.end();
  });

  it("does not inflate ingest_count when the same batch is posted twice", async () => {
    const first = dedupeBatch(fixture);
    await ingestCanonical(first.canonical);

    const second = dedupeBatch(fixture);
    const summary = await ingestCanonical(second.canonical);

    expect(summary.merged).toBe(1);
    expect(summary.observations_recorded).toBe(0);

    const { rows } = await pool.query(
      "SELECT ingest_count FROM mentions WHERE external_id = $1",
      [TEST_EXTERNAL_ID],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].ingest_count).toBe(1);
  });
});
