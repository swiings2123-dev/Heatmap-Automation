// TEMPORARY one-time data export (hosted disk -> laptop). Remove after the migration.
// Every request needs the dashboard token.
import Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Config } from "./config";

export async function registerExport(
  app: FastifyInstance,
  cfg: Config,
  requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) {
  await app.register(async (r) => {
    r.addHook("preHandler", requireAuth);
    // Consistent snapshot of the live database (safe while the server keeps writing).
    r.get("/api/admin/export-db", async (_req, reply) => {
      const tmp = path.join(os.tmpdir(), `export-${Date.now()}.db`);
      const db = new Database(path.join(cfg.dataDir, "heatmap.db"), { readonly: true });
      await db.backup(tmp);
      db.close();
      const buf = readFileSync(tmp);
      rmSync(tmp, { force: true });
      return reply.type("application/octet-stream").send(buf);
    });
    r.get("/api/admin/export-file", async (req, reply) => {
      const rel = String((req.query as { path?: string }).path ?? "");
      if (!/^screenshots\/[A-Za-z0-9._\-/]+\.(jpg|json)$/.test(rel) || rel.split("/").includes("..")) {
        return reply.code(400).send({ error: "path not allowed" });
      }
      const abs = path.join(cfg.dataDir, ...rel.split("/"));
      if (!existsSync(abs)) return reply.code(404).send({ error: "missing" });
      return reply.type("application/octet-stream").send(readFileSync(abs));
    });
  });
}
