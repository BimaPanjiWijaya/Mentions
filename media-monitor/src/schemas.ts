import { z } from "zod";

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
