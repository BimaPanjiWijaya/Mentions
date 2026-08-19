import { Router } from "express";
import { searchQuerySchema } from "../schemas.js";
import { searchMentions } from "../repository.js";

export const mentionsRouter = Router();

mentionsRouter.get("/mentions", async (req, res, next) => {
  const parsed = searchQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_query",
      details: parsed.error.issues,
    });
  }

  try {
    const result = await searchMentions(parsed.data);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
