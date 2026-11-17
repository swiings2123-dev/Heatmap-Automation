// TEMPORARY one-time data import (laptop -> hosted disk). Remove after the migration.
// Active only when IMPORT_ENABLED=1, and every request needs the dashboard token.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Config } from "./config";

// Only screenshot files, or the database snapshot staged for the next start.
const ALLOWED = /^(screenshots\/[A-Za-z0-9._\-/]+\.(jpg|json)|import\/heatmap\.db)$/;

export async function registerImport(
  app: FastifyInstance,
  cfg: Config,
  requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) {
  await app.register(async (r) => {
    r.addHook("preHandler", requireAuth);
    r.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: 50 * 1024 * 1024 }, (_req, body, done) =>
      done(null, body),
    );
    r.put("/api/admin/import-file", async (req, reply) => {
      const rel = String((req.query as { path?: string }).path ?? "");
      if (!ALLOWED.test(rel) || rel.split("/").includes("..")) return reply.code(400).send({ error: "path not allowed" });
      const abs = path.join(cfg.dataDir, ...rel.split("/"));
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, req.body as Buffer);
      return { ok: true, path: rel, bytes: (req.body as Buffer).length };
    });
  });
}
