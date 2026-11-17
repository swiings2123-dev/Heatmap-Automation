import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Device, HeatmapResponse, LayoutFile, PointSet } from "../../shared/types";
import { ROOT, type Config } from "./config";
import { checkPageHtml } from "./check";
import { demoImageSvg, demoPageHtml } from "./demo";
import { resolvePoints } from "./lib/resolve";
import { seedPage } from "./lib/seed";
import { parseBatch } from "./lib/validate";
import type { ClickKind, EventFilter, ScreenshotRow, Storage } from "./storage/types";
import { PROFILES } from "./worker/capture";
import type { CaptureRunner } from "./worker/runner";
import { registerExport } from "./exporter";

export interface AppDeps {
  cfg: Config;
  storage: Storage;
  runner?: CaptureRunner;
  logger?: boolean;
}

const deviceSchema = z.enum(["mobile", "tablet", "desktop"]);
const filterSchema = z.object({
  store: z.string().min(1),
  page: z.string().min(1),
  device: deviceSchema.default("mobile"),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().positive().optional(),
  source: z.string().optional(),
  tz: z.coerce.number().int().min(-900).max(900).default(0),
});

function toFilter(q: z.infer<typeof filterSchema>): EventFilter {
  const to = q.to ?? Date.now() + 60_000;
  return {
    store: q.store,
    handle: q.page,
    device: q.device,
    from: q.from ?? to - 30 * 86_400_000,
    to,
    source: q.source || undefined,
  };
}

const layoutCache = new Map<string, LayoutFile>();
function loadLayout(cfg: Config, shot: ScreenshotRow): LayoutFile | null {
  const file = path.join(cfg.dataDir, shot.layoutPath);
  const hit = layoutCache.get(file);
  if (hit) return hit;
  if (!existsSync(file)) return null;
  const layout = JSON.parse(readFileSync(file, "utf8")) as LayoutFile;
  layout.viewport ??= { w: PROFILES[shot.device].viewport!.width, h: PROFILES[shot.device].viewport!.height };
  layoutCache.set(file, layout);
  if (layoutCache.size > 64) layoutCache.delete(layoutCache.keys().next().value!);
  return layout;
}

export async function buildApp({ cfg, storage, runner, logger }: AppDeps) {
  const app = Fastify({
    logger: logger ? { level: cfg.production ? "info" : "warn" } : false,
    trustProxy: cfg.trustProxy,
    bodyLimit: 256 * 1024,
  });

  // Chrome Private/Local Network Access: an https storefront calling http://localhost needs this on preflight.
  // Registered BEFORE cors, which answers preflights itself.
  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "OPTIONS" && req.headers["access-control-request-private-network"]) {
      reply.header("Access-Control-Allow-Private-Network", "true");
    }
  });
  // CORS for the collector (and tracker.js). Read APIs are same-origin + token-protected in production.
  const anyOrigin = cfg.allowedOrigins.includes("*");
  await app.register(cors, {
    origin: anyOrigin ? true : cfg.allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    maxAge: 86_400,
  });
  await app.register(rateLimit, { global: false });

  const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!cfg.production) return;
    const header = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const query = (req.query as { token?: string } | undefined)?.token ?? "";
    const given = Buffer.from(header || query);
    const want = Buffer.from(cfg.dashboardToken);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  };
  const devOnly = async (_req: FastifyRequest, reply: FastifyReply) => {
    if (cfg.production) return reply.code(404).send({ error: "not found" });
  };

  // TEMPORARY one-time data export (see exporter.ts).
  if (cfg.production) await registerExport(app, cfg, requireAuth);

  // ------------------------------------------------------------------ public
  app.get("/api/health", async () => ({ ok: true, time: Date.now(), mode: cfg.production ? "production" : "development" }));

  app.get("/api/config", async () => ({
    publicUrl: cfg.publicUrl,
    production: cfg.production,
    authRequired: cfg.production,
    demo: cfg.demo,
    atcLabels: cfg.atcLabels,
  }));

  app.get("/tracker.js", async (_req, reply) => {
    const file = path.join(ROOT, "dist", "tracker.js");
    if (!existsSync(file)) return reply.code(503).type("text/plain").send("// tracker not built: npm run build:tracker");
    return reply
      .header("Cache-Control", "public, max-age=300")
      .header("Access-Control-Allow-Origin", "*")
      .header("Cross-Origin-Resource-Policy", "cross-origin")
      .type("application/javascript; charset=utf-8")
      .send(readFileSync(file));
  });

  app.post(
    "/api/collect",
    {
      config: {
        rateLimit: {
          max: cfg.collectRateLimit,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) =>
            (cfg.trustProxy && (req.headers["cf-connecting-ip"] as string | undefined)) || req.ip,
        },
      },
    },
    async (req, reply) => {
      // /check page connectivity probe: proves requests reach us, stores nothing.
      if ((req.query as { probe?: string } | undefined)?.probe === "1") return reply.code(204).send();
      // CORS headers alone don't stop sendBeacon (it ignores the response), so enforce the
      // allow-list here too: data from other sites is dropped, not just hidden from them.
      const origin = req.headers.origin;
      if (origin && !anyOrigin && !cfg.allowedOrigins.includes(origin)) {
        return reply.code(403).send({ error: "origin not allowed" });
      }
      let originHost: string | undefined;
      try {
        if (origin) originHost = new URL(origin).hostname;
      } catch {}
      const result = parseBatch(req.body, Date.now(), originHost);
      if (!result.ok) return reply.code(400).send({ error: result.error });
      const b = result.batch;
      await storage.insertEvents(b, Date.now());
      // First traffic for this page on this device -> screenshot it automatically (async, deduplicated).
      if (cfg.autoCapture && runner) void runner.autoCapture(b.store, b.page, b.url, b.dev).catch(() => {});
      return reply.code(204).send();
    },
  );

  // ------------------------------------------------------------------ read APIs (token in production)
  app.register(async (api) => {
    api.addHook("preHandler", requireAuth);

    api.get("/api/stores", async () => storage.listStores());

    api.get("/api/pages", async (req) => {
      const q = z.object({ store: z.string().optional() }).parse(req.query);
      return storage.listPages(q.store || undefined);
    });

    api.get("/api/heatmap", async (req, reply) => {
      const parsed = filterSchema.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
      const filter = toFilter(parsed.data);
      const shot = await storage.getActiveScreenshot(filter.store, filter.handle, filter.device);
      const layout = shot ? loadLayout(cfg, shot) : null;
      const empty: PointSet = { page: [], fixed: [] };

      if (!shot || !layout) {
        const total = (await storage.queryFallbackBins(filter, [], "all")).reduce((s, b) => s + b.n, 0);
        const res: HeatmapResponse = {
          screenshot: null, clicks: empty, rage: empty, dead: empty, elements: [],
          total, anchored: 0, fallback: total, accuracy: total ? 0 : 1,
        };
        return res;
      }
      const known = Object.keys(layout.elements);
      const resolve = async (kind: ClickKind) =>
        resolvePoints(
          await storage.queryBins(filter, known, kind),
          await storage.queryFallbackBins(filter, known, kind),
          layout,
        );
      const [clicks, rage, dead, counts] = await Promise.all([
        resolve("all"), resolve("rage"), resolve("dead"), storage.queryElementCounts(filter, 300),
      ]);
      const total = clicks.anchored + clicks.fallback;
      const res: HeatmapResponse = {
        screenshot: {
          id: shot.id,
          version: shot.version,
          device: shot.device,
          imageUrl: `/api/screenshots/${shot.id}.jpg`,
          width: layout.width,
          height: layout.height,
          viewport: layout.viewport,
          capturedAt: shot.capturedAt,
          checkedAt: shot.checkedAt,
        },
        clicks: { page: clicks.page, fixed: clicks.fixed },
        rage: { page: rage.page, fixed: rage.fixed },
        dead: { page: dead.page, fixed: dead.fixed },
        elements: counts.map((c) => {
          const rect = layout.elements[c.selector];
          return {
            ...c,
            rect: rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null,
            fixed: !!rect?.fixed,
          };
        }),
        total,
        anchored: clicks.anchored,
        fallback: clicks.fallback,
        accuracy: total ? clicks.anchored / total : 1,
      };
      return res;
    });

    api.get("/api/stats", async (req, reply) => {
      const parsed = filterSchema.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
      return storage.queryStats(toFilter(parsed.data), { atcLabels: cfg.atcLabels, tzOffset: parsed.data.tz });
    });

    api.get("/api/screenshots/:file", async (req, reply) => {
      const id = Number(/^(\d+)\.jpg$/.exec((req.params as { file: string }).file)?.[1]);
      const shot = id ? await storage.getScreenshot(id) : null;
      const file = shot ? path.join(cfg.dataDir, shot.path) : "";
      if (!shot || !existsSync(file)) return reply.code(404).send({ error: "not found" });
      return reply
        .header("Cache-Control", "private, max-age=31536000, immutable") // versions are immutable
        .header("Content-Length", statSync(file).size)
        .type("image/jpeg")
        .send(createReadStream(file));
    });

    const captureBody = z.object({
      store: z.string().min(1),
      page: z.string().min(1),
      device: deviceSchema.optional(),
      force: z.boolean().optional(),
    });
    api.post("/api/capture", async (req, reply) => {
      if (!runner) return reply.code(503).send({ error: "capture worker not available" });
      const parsed = captureBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
      const { store, page, device, force } = parsed.data;
      const info = await storage.getPage(store, page);
      if (!info) return reply.code(404).send({ error: "unknown page" });
      const devices: Device[] = device ? [device] : await runner.devicesFor(store, page);
      const job = runner.enqueue({ store, handle: page, url: info.url, devices, force: force ?? true });
      return reply.code(202).send(job);
    });

    api.get("/api/capture/status", async (req) => {
      const q = z.object({ store: z.string(), page: z.string() }).parse(req.query);
      return runner?.latestFor(q.store, q.page) ?? null;
    });

    // -------------------------------------------------------------- dev only
    const seedBody = z.object({
      store: z.string().min(1).default("localhost"),
      page: z.string().min(1).default("demo-product"),
      url: z.string().url().optional(),
      sessions: z.number().int().min(1).max(20_000).default(400),
      days: z.number().int().min(1).max(365).default(14),
    });
    api.post("/api/seed", { preHandler: devOnly }, async (req, reply) => {
      const parsed = seedBody.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
      const { store, page, sessions, days } = parsed.data;
      const existing = await storage.getPage(store, page);
      const url = parsed.data.url ?? existing?.url ?? `${cfg.publicUrl}/demo/products/${page}`;
      const layouts: Partial<Record<Device, LayoutFile>> = {};
      for (const d of ["mobile", "tablet", "desktop"] as const) {
        const shot = await storage.getActiveScreenshot(store, page, d);
        const layout = shot && loadLayout(cfg, shot);
        if (layout) layouts[d] = layout;
      }
      const result = await seedPage(storage, { store, handle: page, url, sessions, days, layouts });
      return { ...result, store, page, usedLayouts: Object.keys(layouts) };
    });
  });

  app.get("/check", async (_req, reply) => reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(checkPageHtml()));

  // ------------------------------------------------------------------ demo product page
  if (cfg.demo) {
    app.get("/demo/products/:handle", async (req, reply) =>
      reply.type("text/html; charset=utf-8").send(demoPageHtml((req.params as { handle: string }).handle)),
    );
    app.get("/demo/img/:n", async (req, reply) =>
      reply
        .header("Cache-Control", "public, max-age=3600")
        .type("image/svg+xml")
        .send(demoImageSvg(Number.parseInt((req.params as { n: string }).n, 10) || 1)),
    );
  }

  // ------------------------------------------------------------------ dashboard (built SPA)
  const dashDir = path.join(ROOT, "dashboard", "dist");
  if (existsSync(dashDir)) {
    // wildcard mode: files added by a rebuild are served without restarting the server.
    await app.register(fastifyStatic, { root: dashDir, prefix: "/", index: ["index.html"] });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api/") && existsSync(path.join(dashDir, "index.html"))) {
      return reply.type("text/html").send(readFileSync(path.join(dashDir, "index.html")));
    }
    if (req.method === "GET" && req.url === "/") {
      return reply.type("text/plain").send("Dashboard not built yet: run `npm run build:dashboard`.");
    }
    return reply.code(404).send({ error: "not found" });
  });

  return app;
}
