import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server/src/app";
import { loadConfig } from "../server/src/config";
import { SqliteStorage } from "../server/src/storage/sqlite";
import { batch, click } from "./helpers";

const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

async function make(env: Record<string, string> = {}) {
  const cfg = loadConfig({ DATA_DIR: "data-test", ...env } as NodeJS.ProcessEnv);
  const storage = new SqliteStorage(":memory:");
  const app = await buildApp({ cfg, storage });
  apps.push(app);
  return { app, storage };
}

describe("API", () => {
  it("collects a text/plain beacon batch and exposes the page", async () => {
    const { app } = await make();
    const res = await app.inject({ method: "POST", url: "/api/collect", headers: { "content-type": "text/plain", origin: "https://shop.test" }, payload: JSON.stringify(batch([click()])) });
    expect(res.statusCode).toBe(204);
    const pages = (await app.inject("/api/pages")).json();
    expect(pages[0]).toMatchObject({ store: "shop.test", handle: "tee", clicks: 1 });
    const heat = (await app.inject("/api/heatmap?store=shop.test&page=tee&device=mobile")).json();
    expect(heat).toMatchObject({ screenshot: null, total: 1 });
  });

  it("rejects invalid batches", async () => {
    const { app } = await make();
    const res = await app.inject({ method: "POST", url: "/api/collect", headers: { "content-type": "text/plain" }, payload: "{}" });
    expect(res.statusCode).toBe(400);
  });

  it("answers Private Network Access preflights", async () => {
    const { app } = await make();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/collect",
      headers: { origin: "https://shop.test", "access-control-request-method": "POST", "access-control-request-private-network": "true" },
    });
    expect(res.headers["access-control-allow-private-network"]).toBe("true");
    expect(res.headers["access-control-allow-origin"]).toBe("https://shop.test");
  });

  it("enforces the CORS allow-list", async () => {
    const { app } = await make({ ALLOWED_ORIGINS: "https://shop.test" });
    const ok = await app.inject({ method: "OPTIONS", url: "/api/collect", headers: { origin: "https://shop.test", "access-control-request-method": "POST" } });
    const bad = await app.inject({ method: "OPTIONS", url: "/api/collect", headers: { origin: "https://evil.test", "access-control-request-method": "POST" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("https://shop.test");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    // ...and beacons from other sites are rejected server-side (sendBeacon ignores CORS).
    const post = (origin: string) =>
      app.inject({ method: "POST", url: "/api/collect", headers: { "content-type": "text/plain", origin }, payload: JSON.stringify(batch([click()])) });
    expect((await post("https://evil.test")).statusCode).toBe(403);
    expect((await post("https://shop.test")).statusCode).toBe(204);
  });

  it("rate-limits the collector per IP", async () => {
    const { app } = await make({ COLLECT_RATE_LIMIT: "3" });
    const send = () => app.inject({ method: "POST", url: "/api/collect", headers: { "content-type": "text/plain" }, payload: JSON.stringify(batch([click()])) });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await send()).statusCode);
    expect(codes).toEqual([204, 204, 204, 429, 429]);
  });

  it("requires DASHBOARD_TOKEN for reads in production, never for collecting", async () => {
    expect(() => loadConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/DASHBOARD_TOKEN/);
    const { app } = await make({ NODE_ENV: "production", DASHBOARD_TOKEN: "s3cret-token" });
    expect((await app.inject("/api/pages")).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/pages", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/pages", headers: { authorization: "Bearer s3cret-token" } })).statusCode).toBe(200);
    expect((await app.inject("/api/pages?token=s3cret-token")).statusCode).toBe(200);
    const collect = await app.inject({ method: "POST", url: "/api/collect", headers: { "content-type": "text/plain" }, payload: JSON.stringify(batch([click()])) });
    expect(collect.statusCode).toBe(204);
    // dev-only endpoints are gone in production
    expect((await app.inject({ method: "POST", url: "/api/seed?token=s3cret-token", payload: {} })).statusCode).toBe(404);
    expect((await app.inject("/demo/products/demo-product")).body).not.toContain("Demo Store");
  });

  it("seeds fake data in dev", async () => {
    const { app } = await make();
    const res = await app.inject({ method: "POST", url: "/api/seed", payload: { sessions: 50 } });
    expect(res.statusCode).toBe(200);
    const stats = (await app.inject("/api/stats?store=localhost&page=demo-product&device=mobile")).json();
    expect(stats.sessions).toBeGreaterThan(10);
  });
});
