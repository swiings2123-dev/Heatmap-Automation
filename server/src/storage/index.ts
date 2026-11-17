import path from "node:path";
import type { Config } from "../config";
import { SqliteStorage } from "./sqlite";
import type { Storage } from "./types";

/**
 * The only place that knows which database is used. To move to hosted
 * Postgres/Supabase later: implement `Storage` in ./postgres.ts and return it
 * here when DATABASE_URL is set. Nothing else changes.
 */
export function createStorage(cfg: Config): Storage {
  if (process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is set but no Postgres adapter is implemented yet (see server/src/storage/types.ts).");
  }
  return new SqliteStorage(path.join(cfg.dataDir, "heatmap.db"));
}

export type { Storage } from "./types";
