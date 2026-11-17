import { existsSync, renameSync, rmSync } from "node:fs";
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
  const file = path.join(cfg.dataDir, "heatmap.db");
  // TEMPORARY (one-time migration): a database uploaded via /api/admin/import-file replaces the
  // current one on the next start. Remove together with server/src/importer.ts.
  const staged = path.join(cfg.dataDir, "import", "heatmap.db");
  if (existsSync(staged)) {
    for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
    renameSync(staged, file);
    console.log("[import] replaced database with the uploaded snapshot");
  }
  return new SqliteStorage(file);
}

export type { Storage } from "./types";
