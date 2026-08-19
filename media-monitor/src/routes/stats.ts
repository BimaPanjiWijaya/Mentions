import { Router } from "express";
import { statsQuerySchema } from "../schemas.js";
import { statsBySource, statsByDay } from "../repository.js";
import { config } from "../config.js";

export const statsRouter = Router();

statsRouter.get("/mentions/stats", async (req, res, next) => {
  const parsed = statsQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_query",
      message: "`group_by` must be either `source` or `day`.",
      details: parsed.error.issues,
    });
  }

  const params = parsed.data;

  try {
    const buckets =
      params.group_by === "source"
        ? await statsBySource(params)
        : await statsByDay(params);

    res.json({
      group_by: params.group_by,
      timezone: params.group_by === "day" ? config.reportingTimezone : undefined,
      total: buckets.reduce((sum, b) => sum + Number(b.count), 0),
      buckets,
    });
  } catch (error) {
    next(error);
  }
});
