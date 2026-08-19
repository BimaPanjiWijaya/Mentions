import express from "express";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestRouter } from "./routes/ingest.js";
import { pool } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  // The seed file is ~30 KB, but real batches are much larger.
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok", database: "up" });
    } catch {
      res.status(503).json({ status: "degraded", database: "down" });
    }
  });

  app.use(ingestRouter);

  // Optional read-only dashboard
  app.use(express.static(join(__dirname, "..", "public")));

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  // Centralised error handler. Four arguments are required for
  // Express to recognise this as an error handler.
  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error("[error]", error.message);
      res.status(500).json({ error: "internal_error" });
    },
  );

  return app;
}
