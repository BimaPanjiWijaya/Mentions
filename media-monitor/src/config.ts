import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  useSsl: process.env.PGSSL === "require",
  port: Number(process.env.PORT ?? 3000),
  reportingTimezone: process.env.REPORTING_TZ ?? "Asia/Kuala_Lumpur",
} as const;
