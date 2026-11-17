import { expect, test } from "@playwright/test";
import type { HeatmapResponse } from "../shared/types";

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: MOBILE_UA });

test("a click on Add to cart shows up on the ATC button in the heatmap", async ({ page, request }) => {
  // The tracker ignores automation (navigator.webdriver); pretend to be a real shopper.
  await page.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
  await page.goto("/demo/products/demo-product?utm_source=facebook");
  await page.evaluate(() => document.getElementById("shopify-pc__banner")?.remove()); // no click: keep the data to one click
  const atc = page.locator("#ProductSubmitButton");
  await atc.scrollIntoViewIfNeeded();
  const box = (await atc.boundingBox())!;
  // Click near the left side of the button so we can check the in-element offset survives.
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.evaluate(() => window.__hm?.flush());

  // Collector stored it.
  await expect.poll(async () => (await (await request.get("/api/pages")).json()).length, { timeout: 10_000 }).toBe(1);

  // Capture a mobile screenshot of the page (layout.json gives the button's rect).
  const job = await (await request.post("/api/capture", { data: { store: "localhost", page: "demo-product", device: "mobile" } })).json();
  await expect
    .poll(async () => (await (await request.get("/api/capture/status?store=localhost&page=demo-product")).json())?.status, { timeout: 90_000 })
    .toBe("done");
  expect(job.id).toBeTruthy();

  const now = Date.now();
  const heat: HeatmapResponse = await (
    await request.get(`/api/heatmap?store=localhost&page=demo-product&device=mobile&from=${now - 3600_000}&to=${now + 60_000}`)
  ).json();
  expect(heat.screenshot).not.toBeNull();
  expect(heat.total).toBe(1);
  expect(heat.accuracy).toBe(1); // anchored to the element, not a fallback

  const el = heat.elements.find((e) => e.selector === "#ProductSubmitButton");
  expect(el?.rect).toBeTruthy();
  const r = el!.rect!;
  const [x, y, n] = heat.clicks.page[0]!;
  expect(n).toBe(1);
  expect(x).toBeGreaterThanOrEqual(r.x);
  expect(x).toBeLessThanOrEqual(r.x + r.w / 2); // left half, where we clicked
  expect(y).toBeGreaterThanOrEqual(r.y);
  expect(y).toBeLessThanOrEqual(r.y + r.h);

  // Never drawn on another device's screenshot.
  const desktop: HeatmapResponse = await (await request.get(`/api/heatmap?store=localhost&page=demo-product&device=desktop`)).json();
  expect(desktop.total).toBe(0);

  // And the dashboard renders it.
  await page.goto("/");
  await expect(page.getByTestId("heatmap-box")).toBeVisible();
  await expect(page.getByTestId("accuracy")).toContainText("100% pinned");
});
