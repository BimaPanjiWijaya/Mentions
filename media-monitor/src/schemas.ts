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

const isoOrDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "must be a parseable date, e.g. 2026-08-10 or 2026-08-10T00:00:00Z",
  })
  .transform((value) => new Date(value));

/**
 * Base object shape, WITHOUT `.refine()`, so it can still be `.extend()`-ed.
 *
 * `.refine()` wraps a schema in a way that no longer exposes `.extend()` -
 * it stops being a plain object schema. Deriving searchQuerySchema and
 * statsQuerySchema from this shared base (instead of chaining statsQuerySchema
 * off of searchQuerySchema directly) avoids relying on that at all.
 */
const searchQueryShape = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  source: z.string().trim().min(1).max(100).optional(),
  from: isoOrDate.optional(),
  to: isoOrDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum(["published_desc", "published_asc", "engagement_desc", "relevance"])
    .default("published_desc"),
});

const fromNotAfterTo = (value: { from?: Date; to?: Date }) =>
  !(value.from && value.to) || value.from <= value.to;

/**
 * Query validation is strict, because these values come from a
 * human or a dashboard and a silent misparse produces a wrong chart.
 */
export const searchQuerySchema = searchQueryShape.refine(fromNotAfterTo, {
  message: "`from` must not be after `to`",
  path: ["from"],
});

export const statsQuerySchema = searchQueryShape
  .extend({
    group_by: z.enum(["source", "day"]),
  })
  .refine(fromNotAfterTo, {
    message: "`from` must not be after `to`",
    path: ["from"],
  });
