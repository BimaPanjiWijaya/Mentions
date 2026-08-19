import { z } from "zod";

/**
 * Ingest validation is deliberately permissive.
 *
 * This endpoint's whole job is to accept messy upstream output.
 * Rejecting a batch because one record has a number where a string
 * was expected would defeat the purpose. We accept any array of
 * objects and let the normalisation layer decide what is usable;
 * unusable records are reported per-record, not fatally.
 */
export const bulkIngestSchema = z.union([
  z.array(z.record(z.string(), z.unknown())),
  z.object({ mentions: z.array(z.record(z.string(), z.unknown())) }),
]);
