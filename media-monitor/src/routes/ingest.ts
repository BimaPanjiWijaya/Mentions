import { Router } from "express";
import { bulkIngestSchema } from "../schemas.js";
import { dedupeBatch } from "../dedupe.js";
import { ingestCanonical } from "../repository.js";
import type { RawMention } from "../types.js";

export const ingestRouter = Router();

ingestRouter.post("/internal/mentions/bulk", async (req, res, next) => {
  const parsed = bulkIngestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_payload",
      message: "Body must be an array of objects, or { mentions: [...] }.",
      details: parsed.error.issues,
    });
  }

  const records = (
    Array.isArray(parsed.data) ? parsed.data : parsed.data.mentions
  ) as RawMention[];

  try {
    const deduped = dedupeBatch(records);
    const summary = await ingestCanonical(deduped.canonical);

    res.status(200).json({
      received: deduped.received,
      rejected: deduped.rejected.length,
      rejected_details: deduped.rejected,
      collapsed_within_batch: deduped.collapsed,
      inserted: summary.inserted,
      merged_into_existing: summary.merged,
      observations_recorded: summary.observations_recorded,
      total_mentions: summary.total_mentions,
    });
  } catch (error) {
    next(error);
  }
});
