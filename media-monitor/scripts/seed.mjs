import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

const file = join(__dirname, "..", "data", "seed_mentions.json");
const body = await readFile(file, "utf8");

const response = await fetch(`${BASE_URL}/internal/mentions/bulk`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});

const result = await response.json();
console.log(`POST /internal/mentions/bulk -> ${response.status}`);
console.log(JSON.stringify(result, null, 2));

if (!response.ok) process.exit(1);
