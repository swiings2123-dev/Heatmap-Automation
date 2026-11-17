import { describe, expect, it } from "vitest";
import { buildApp } from "../server/src/app";
import { loadConfig } from "../server/src/config";
import { SqliteStorage } from "../server/src/storage/sqlite";
import { CaptureRunner, type CaptureRequest } from "../server/src/worker/runner";
import { batch, click } from "./helpers";

/** Runner whose enqueue only records requests (no browser). */
class FakeRunner extends CaptureRunner {
  queued: CaptureRequest[] = [];
  override enqueue(request: CaptureRequest) {
    this.queued.push(request);
    return { id: String(this.queued.length), request, status: "queued" as const, results: [], errors: [], createdAt: Date.now() };
  }
}

async function setup() {
  const cfg = loadConfig({ DATA_DIR: "data-test" } as NodeJS.ProcessEnv);
  const storage = new SqliteStorage(":memory:");
  const runner = new FakeRunner(storage, cfg);
  const app = await buildApp({ cfg, storage, runner });
  const send = (over = {}) =>
    app.inject({ method: "POST", url: "/api/collect", headers: { "content-type": "text/plain" }, payload: JSON.stringify(batch([click()], over)) });
  return { app, storage, runner, send };
}

describe("auto-capture", () => {
  it("queues one screenshot per page+device on first traffic, not one per batch", async () => {
    const { app, runner, send } = await setup();
    for (let i = 0; i < 5; i++) expect((await send()).statusCode).toBe(204);
    await send({ dev: "desktop", vw: 1440 });
    await new Promise((r) => setTimeout(r, 20));
    expect(runner.queued.map((q) => q.devices[0])).toEqual(["mobile", "desktop"]);
    expect(runner.queued[0]).toMatchObject({ store: "shop.test", handle: "tee", url: "https://shop.test/products/tee" });
    await app.close();
  });

  it("skips pages that already have a screenshot for that device", async () => {
    const { app, storage, runner, send } = await setup();
    await storage.addScreenshot({
      store: "shop.test", handle: "tee", device: "mobile", url: "u", path: "a/{version}.jpg", layoutPath: "a/{version}.json",
      pageWidth: 390, pageHeight: 1000, layoutHash: "h", capturedAt: Date.now(), checkedAt: Date.now(),
    });
    await send();
    await new Promise((r) => setTimeout(r, 20));
    expect(runner.queued).toEqual([]);
    await app.close();
  });

  it("serves the phone check page and a probe that stores nothing", async () => {
    const { app, storage } = await setup();
    expect((await app.inject("/check")).body).toContain("Heatmap tracker check");
    const probe = await app.inject({ method: "POST", url: "/api/collect?probe=1", headers: { "content-type": "text/plain", origin: "https://evil.test" }, payload: "{}" });
    expect(probe.statusCode).toBe(204);
    expect(await storage.listPages()).toEqual([]);
    await app.close();
  });
});
