import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Device } from "../../shared/types";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// HEATMAP_NO_DOTENV=1 isolates test runs from your real (production) .env.
if (!process.env.HEATMAP_NO_DOTENV && existsSync(path.join(ROOT, ".env"))) {
  try {
    process.loadEnvFile(path.join(ROOT, ".env"));
  } catch {}
}

const list = (v: string | undefined, fallback: string[]) =>
  v === undefined || v.trim() === "" ? fallback : v.split(",").map((s) => s.trim()).filter(Boolean);

export interface Config {
  port: number;
  host: string;
  publicUrl: string;
  production: boolean;
  dashboardToken: string;
  allowedOrigins: string[];
  collectRateLimit: number;
  trustProxy: boolean;
  dataDir: string;
  atcLabels: string[];
  hideSelectors: string[];
  captureDevices: Device[];
  captureIntervalHours: number;
  /** Screenshot a page/device automatically the first time it gets traffic, and re-check all pages periodically. */
  autoCapture: boolean;
  demo: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const port = Number(env.PORT || 3000);
  const cfg: Config = {
    port,
    host: env.HOST || "127.0.0.1",
    publicUrl: (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
    production,
    dashboardToken: env.DASHBOARD_TOKEN || "",
    allowedOrigins: list(env.ALLOWED_ORIGINS, ["*"]),
    collectRateLimit: Number(env.COLLECT_RATE_LIMIT || 120),
    trustProxy: env.TRUST_PROXY === "true",
    dataDir: path.resolve(ROOT, env.DATA_DIR || "data"),
    atcLabels: list(env.ATC_LABELS, ["add to cart", "buy now", "add to bag", "buy it now"]).map((s) => s.toLowerCase()),
    hideSelectors: list(env.CAPTURE_HIDE_SELECTORS, []),
    captureDevices: list(env.CAPTURE_DEVICES, ["mobile", "desktop"]).filter((d): d is Device =>
      ["mobile", "tablet", "desktop"].includes(d),
    ),
    captureIntervalHours: Number(env.CAPTURE_INTERVAL_HOURS || 6),
    autoCapture: env.AUTO_CAPTURE !== "false",
    demo: !production || env.DEMO === "1",
  };
  if (production && !cfg.dashboardToken) {
    throw new Error("NODE_ENV=production requires DASHBOARD_TOKEN (protects the read APIs).");
  }
  return cfg;
}
