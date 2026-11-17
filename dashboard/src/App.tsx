import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Device, HeatmapResponse, PageInfo, StatsResponse } from "../../shared/types";
import { Heatmap, type Layers } from "./components/Heatmap";
import { ClicksChart, Frustration, ScrollFunnel, StatTiles, TopElements } from "./components/Panels";
import { SnippetBox, SnippetTab } from "./components/Snippet";
import { Button, Card, Empty, Segmented, Select, ThemeSwitch, Toggle } from "./components/ui";
import { AuthError, api, filterParams, setToken, type Filters, type RangePreset } from "./lib/api";
import { fmtDate, fmtPct } from "./lib/format";
import { HEAT_STOPS } from "./lib/heat";
import { useTheme } from "./lib/theme";

interface AppConfig {
  publicUrl: string;
  production: boolean;
  authRequired: boolean;
  demo: boolean;
}
interface CaptureJob {
  id: string;
  status: "queued" | "running" | "done" | "error";
  errors: string[];
}

const PREFS = "hm_prefs";
function loadPrefs(): Partial<Filters> {
  try {
    return JSON.parse(localStorage.getItem(PREFS) || "{}");
  } catch {
    return {};
  }
}

/** Fetch with optional polling; keeps the previous data while refetching (no flicker). */
function useData<T>(key: string | null, fn: () => Promise<T>, pollMs: number | null, onAuth: () => void) {
  // Results are stored with the key they belong to, so a filter change shows the skeleton
  // (no stale data from another page) while a poll of the same key keeps the old data.
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({ key: "", data: null, error: null });
  const fnRef = useRef(fn);
  useLayoutEffect(() => {
    fnRef.current = fn;
  });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!key) return;
    const my = ++seq.current;
    try {
      const d = await fnRef.current();
      if (my === seq.current) setState({ key, data: d, error: null });
    } catch (e) {
      if (e instanceof AuthError) onAuth();
      else if (my === seq.current) setState((s) => ({ key, data: s.key === key ? s.data : null, error: (e as Error).message }));
    }
  }, [key, onAuth]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!pollMs || !key) return;
    const t = setInterval(() => void load(), pollMs);
    return () => clearInterval(t);
  }, [pollMs, key, load]);
  const current = state.key === key;
  return { data: current ? state.data : null, error: current ? state.error : null, reload: load };
}

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [needToken, setNeedToken] = useState(false);
  const [tab, setTab] = useState<"heatmap" | "snippet">("heatmap");
  const prefs = loadPrefs();
  const [storePref, setStore] = useState(prefs.store ?? "");
  const [pagePref, setPage] = useState(prefs.page ?? "");
  const [device, setDevice] = useState<Device>(prefs.device ?? "mobile");
  const [preset, setPreset] = useState<RangePreset>(prefs.preset ?? "30d");
  const [source, setSource] = useState("");
  const [auto, setAuto] = useState(false);
  const [layers, setLayers] = useState<Layers>({ clicks: true, frustration: false, scroll: false });
  const [highlight, setHighlight] = useState<string | null>(null);
  const [capture, setCapture] = useState<CaptureJob | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const onAuth = useCallback(() => setNeedToken(true), []);
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    api<AppConfig>("/api/config").then(setConfig, () => setConfig({ publicUrl: location.origin, production: false, authRequired: false, demo: false }));
  }, []);
  const pages = useData<PageInfo[]>("pages", () => api<PageInfo[]>("/api/pages"), auto ? 15_000 : null, onAuth);
  const stores = [...new Set((pages.data ?? []).map((p) => p.store))];
  // The saved preference wins when it still exists; otherwise fall back to the most recent page.
  const store = stores.includes(storePref) ? storePref : (stores[0] ?? "");
  const storePages = (pages.data ?? []).filter((p) => p.store === store);
  const page = storePages.some((p) => p.handle === pagePref) ? pagePref : (storePages[0]?.handle ?? "");

  useEffect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ store, page, device, preset }));
    } catch {}
  }, [store, page, device, preset]);

  const filters: Filters = { store, page, device, preset, source };
  const key = store && page ? JSON.stringify(filters) : null;
  const poll = auto ? 5000 : null;
  const heat = useData<HeatmapResponse>(key, () => api<HeatmapResponse>("/api/heatmap", filterParams(filters)), poll, onAuth);
  const reloadHeat = heat.reload;
  const stats = useData<StatsResponse>(key, () => api<StatsResponse>("/api/stats", filterParams(filters)), poll, onAuth);

  // No screenshot yet: watch for an automatic capture (first traffic triggers one on the server).
  const noShot = !!heat.data && !heat.data.screenshot;
  const autoJob = useData<CaptureJob | null>(
    noShot && key ? `job:${key}` : null,
    () => api<CaptureJob | null>("/api/capture/status", { store, page }),
    noShot ? 3000 : null,
    onAuth,
  );
  const autoRunning = autoJob.data?.status === "queued" || autoJob.data?.status === "running";
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !autoRunning) void reloadHeat();
    wasRunning.current = autoRunning;
  }, [autoRunning, reloadHeat]);

  // Poll a running capture job.
  useEffect(() => {
    if (!capture || capture.status === "done" || capture.status === "error") return;
    const t = setInterval(async () => {
      const job = await api<CaptureJob | null>("/api/capture/status", { store, page }).catch(() => null);
      if (job && job.id === capture.id) {
        setCapture(job);
        if (job.status === "done" || job.status === "error") void reloadHeat();
      }
    }, 1500);
    return () => clearInterval(t);
  }, [capture, store, page, reloadHeat]);

  async function startCapture() {
    try {
      const job = await api<CaptureJob>("/api/capture", undefined, { method: "POST", body: JSON.stringify({ store, page, device }) });
      setCapture(job);
    } catch (e) {
      setCapture({ id: "", status: "error", errors: [(e as Error).message] });
    }
  }

  async function seed() {
    setBusy("seed");
    try {
      await api("/api/seed", undefined, { method: "POST", body: JSON.stringify(store && page ? { store, page } : {}) });
      await pages.reload();
      await Promise.all([heat.reload(), stats.reload()]);
    } finally {
      setBusy(null);
    }
  }

  if (needToken) return <TokenGate onSave={() => location.reload()} theme={<ThemeSwitch value={theme} onChange={setTheme} />} />;

  const capturing = (capture && (capture.status === "queued" || capture.status === "running")) || autoRunning;
  const pageInfo = storePages.find((p) => p.handle === page);
  const h = heat.data;
  const s = stats.data;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-[var(--bg)]/70 backdrop-blur-xl">
        <div className="mx-auto max-w-[1500px] px-4">
          <div className="flex items-center gap-3 py-3">
            <div className="flex items-center gap-3">
              <span className="orb relative size-9 shrink-0 rounded-full" aria-hidden />
              <div className="hidden leading-none sm:block">
                <p className="text-thermal font-display text-lg font-extrabold tracking-tight">HEATMAPS</p>
                <p className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.28em] text-ink-3">thermal vision</p>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Segmented label="View" value={tab} onChange={setTab} options={[{ value: "heatmap", label: "Heatmap" }, { value: "snippet", label: "Snippet" }]} />
              <ThemeSwitch value={theme} onChange={setTheme} />
            </div>
          </div>
          {tab === "heatmap" && (pages.data?.length ?? 0) > 0 && (
            <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-3 lg:flex-wrap lg:overflow-visible">
              {stores.length > 1 && (
                <Select label="Store" value={store} onChange={(e) => setStore(e.target.value)} className="w-44">
                  {stores.map((st) => (
                    <option key={st}>{st}</option>
                  ))}
                </Select>
              )}
              <Select label="Page" value={page} onChange={(e) => setPage(e.target.value)} className="w-60" data-testid="page-picker">
                {storePages.map((p) => (
                  <option key={p.handle} value={p.handle}>
                    {p.handle} ({p.clicks})
                  </option>
                ))}
              </Select>
              <Segmented
                label="Device"
                value={device}
                onChange={setDevice}
                options={[{ value: "mobile", label: "Mobile" }, { value: "tablet", label: "Tablet" }, { value: "desktop", label: "Desktop" }]}
              />
              <Segmented
                label="Date range"
                value={preset}
                onChange={setPreset}
                options={[{ value: "today", label: "Today" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }]}
              />
              <Select label="Traffic source" value={source} onChange={(e) => setSource(e.target.value)} className="w-44">
                <option value="">All sources</option>
                {(s?.sources ?? []).map((x) => (
                  <option key={x.source} value={x.source}>
                    {x.source} ({x.sessions})
                  </option>
                ))}
                {source && !s?.sources.some((x) => x.source === source) && <option value={source}>{source}</option>}
              </Select>
              <span className="glass inline-flex shrink-0 items-center rounded-full px-3 py-1.5">
                <Toggle checked={auto} onChange={setAuto}>
                  <span className="flex items-center gap-1.5">
                    {auto && <span className="pulse-dot size-1.5 rounded-full bg-good" aria-hidden />}
                    Live
                  </span>
                </Toggle>
              </span>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-5">
        {tab === "snippet" ? (
          <SnippetTab publicUrl={config?.publicUrl ?? location.origin} />
        ) : pages.data && pages.data.length === 0 ? (
          <Onboarding config={config} onSeed={seed} busy={busy === "seed"} />
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
            <Card
              hud
              title={
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span className="truncate">{page || "…"}</span>
                  {h?.screenshot && (
                    <span className="font-mono text-[10.5px] font-normal tracking-normal text-ink-3">
                      screenshot v{h.screenshot.version} · {fmtDate(h.screenshot.capturedAt)}
                    </span>
                  )}
                </span>
              }
              right={
                h?.screenshot && (
                  <Button variant="ghost" onClick={startCapture} disabled={!!capturing} title="Take a fresh screenshot of the live page">
                    {capturing ? "Capturing…" : "⟳ Re-capture"}
                  </Button>
                )
              }
            >
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-4 py-2.5">
                <Toggle checked={layers.clicks} onChange={(v) => setLayers({ ...layers, clicks: v })}>
                  Clicks
                </Toggle>
                <Toggle checked={layers.frustration} onChange={(v) => setLayers({ ...layers, frustration: v })}>
                  Rage + dead
                </Toggle>
                <Toggle checked={layers.scroll} onChange={(v) => setLayers({ ...layers, scroll: v })}>
                  Scroll depth
                </Toggle>
                <Legend frustration={layers.frustration} />
              </div>
              <div className="p-3">
                {heat.error && <p className="mb-2 rounded-xl border border-rage/30 bg-rage/10 px-3 py-2 text-sm text-rage">Couldn't load heatmap: {heat.error}</p>}
                {!h ? (
                  <div className="skeleton h-[520px] rounded-xl" />
                ) : !h.screenshot ? (
                  <Empty icon={<span className="pulse-dot size-3 rounded-full bg-accent" />} title={`No ${device} screenshot of this page yet`}>
                    <p>
                      {h.total > 0 ? `${h.total} clicks are waiting to be drawn. ` : ""}A screenshot of <span className="break-all font-mono text-xs">{pageInfo?.url}</span>{" "}
                      is taken with a real {device} viewport, then clicks are placed on the exact elements.
                    </p>
                    <div className="mt-4 flex flex-col items-center gap-2">
                      <Button variant="primary" onClick={startCapture} disabled={!!capturing} data-testid="capture-btn">
                        {autoRunning ? "Taking screenshot automatically… (10–40 s)" : capturing ? "Capturing… (10–40 s)" : "Capture screenshot"}
                      </Button>
                      {capture?.status === "error" && <p className="text-rage">Capture failed: {capture.errors.join("; ")}</p>}
                      <p className="text-xs text-ink-3">
                        Or from a terminal: <code>npm run capture -- {pageInfo?.url}</code>
                      </p>
                    </div>
                  </Empty>
                ) : (
                  <>
                    {h.total === 0 && (
                      <div className="mb-3 rounded-xl border border-dashed border-accent/40 bg-accent/5 px-4 py-3 text-sm text-ink-2">
                        <p className="mb-2 font-medium text-ink">No {device} clicks in this range yet.</p>
                        <SnippetBox endpoint={config?.publicUrl ?? location.origin} />
                        {config?.demo && (
                          <Button className="mt-2" onClick={seed} disabled={busy === "seed"}>
                            {busy === "seed" ? "Generating…" : "Generate fake data"}
                          </Button>
                        )}
                      </div>
                    )}
                    {capture?.status === "error" && <p className="mb-2 text-sm text-rage">Capture failed: {capture.errors.join("; ")}</p>}
                    <Heatmap data={h} stats={s} layers={layers} highlight={highlight} onHover={setHighlight} />
                  </>
                )}
              </div>
              {h && h.total > 0 && (
                <p className="border-t border-line px-4 py-2.5 font-mono text-[11px] text-ink-3" data-testid="accuracy">
                  {h.total.toLocaleString()} clicks · <AccuracyBadge accuracy={h.accuracy} /> {fmtPct(h.accuracy, 0)} pinned to the exact element
                  {h.fallback > 0 && <> · {h.fallback.toLocaleString()} estimated from page position (element not found in this screenshot)</>}
                </p>
              )}
            </Card>

            <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">
              {stats.error && <p className="rounded-xl border border-rage/30 bg-rage/10 px-3 py-2 text-sm text-rage">Couldn't load stats: {stats.error}</p>}
              {s ? (
                <>
                  <StatTiles s={s} />
                  <Frustration s={s} highlight={highlight} onHover={setHighlight} />
                  <TopElements s={s} highlight={highlight} onHover={setHighlight} />
                  <ScrollFunnel s={s} />
                  <ClicksChart s={s} />
                </>
              ) : (
                <div className="skeleton h-64 rounded-2xl" />
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function AccuracyBadge({ accuracy }: { accuracy: number }) {
  const color = accuracy >= 0.9 ? "bg-good" : accuracy >= 0.7 ? "bg-[#eda100]" : "bg-rage";
  return <span className={`pulse-dot inline-block size-2 rounded-full ${color}`} aria-hidden />;
}

function Legend({ frustration }: { frustration: boolean }) {
  const gradient = `linear-gradient(90deg, ${HEAT_STOPS.map(([o, c]) => `${c} ${o * 100}%`).join(", ")})`;
  return (
    <div className="ml-auto flex flex-wrap items-center gap-3 font-mono text-[11px] text-ink-3">
      <span className="flex items-center gap-1.5">
        Fewer
        <span className="h-2.5 w-24 rounded-full shadow-[0_0_14px_-2px_rgb(255_122_26/0.6)]" style={{ background: gradient }} aria-hidden />
        More clicks
      </span>
      {frustration && (
        <>
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-full border-2 border-rage" aria-hidden /> Rage
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-full border-2 border-dead" aria-hidden /> Dead
          </span>
        </>
      )}
    </div>
  );
}

function Onboarding({ config, onSeed, busy }: { config: AppConfig | null; onSeed: () => void; busy: boolean }) {
  const endpoint = config?.publicUrl ?? location.origin;
  return (
    <div className="mx-auto max-w-2xl pt-6">
      <div className="rise mb-6 text-center">
        <span className="orb relative mx-auto mb-5 block size-16 rounded-full" aria-hidden />
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent">Awaiting first signal</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold text-ink sm:text-5xl">
          See where they <span className="text-thermal">click</span>.
        </h1>
      </div>
      <Card title="No data yet" hud>
        <div className="space-y-4 px-4 py-5 text-sm text-ink-2">
          <p>Paste this tag into your Shopify theme (before &lt;/head&gt; in theme.liquid), then open a product page and click around.</p>
          <SnippetBox endpoint={endpoint} />
          {config?.demo && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <a className="inline-flex min-h-9 items-center rounded-full border border-line-strong px-4 font-medium text-ink transition hover:border-accent hover:text-accent" href="/demo/products/demo-product" target="_blank" rel="noreferrer">
                Open the demo product page ↗
              </a>
              <Button onClick={onSeed} disabled={busy}>
                {busy ? "Generating…" : "Generate fake data"}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function TokenGate({ onSave, theme }: { onSave: () => void; theme: React.ReactNode }) {
  const [t, setT] = useState("");
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <div className="absolute right-4 top-4">{theme}</div>
      <div className="text-center">
        <span className="orb relative mx-auto mb-4 block size-14 rounded-full" aria-hidden />
        <p className="text-thermal font-display text-2xl font-extrabold">HEATMAPS</p>
      </div>
      <Card title="Dashboard token" className="w-full max-w-sm" hud>
        <form
          className="space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setToken(t.trim());
            onSave();
          }}
        >
          <p className="text-sm text-ink-2">This collector runs in production mode. Enter the DASHBOARD_TOKEN from its .env.</p>
          <input type="password" value={t} onChange={(e) => setT(e.target.value)} className="min-h-10 w-full rounded-xl border border-line-strong bg-panel px-3.5 font-mono text-sm text-ink transition focus:border-accent focus:outline-none" autoFocus />
          <Button variant="primary" type="submit" className="w-full">
            Continue
          </Button>
        </form>
      </Card>
    </div>
  );
}
