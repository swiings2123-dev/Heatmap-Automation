import { useState } from "react";
import { Button, Card } from "./ui";

const KEY = "hm_endpoint";

export function snippetFor(endpoint: string) {
  return `<script src="${endpoint.replace(/\/+$/, "")}/tracker.js" async></script>`;
}

export function SnippetBox({ endpoint }: { endpoint: string }) {
  const [copied, setCopied] = useState(false);
  const code = snippetFor(endpoint);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl border border-line bg-[#0b0b12] p-4 pr-24 font-mono text-xs text-[#ffd23d] shadow-[inset_0_0_30px_rgb(255_122_26/0.08)]" data-testid="snippet">
        {code}
      </pre>
      <Button
        className="absolute right-2 top-2" variant="primary"
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "✓ Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function SnippetTab({ publicUrl }: { publicUrl: string }) {
  const [endpoint, setEndpoint] = useState(() => {
    try {
      return localStorage.getItem(KEY) || publicUrl;
    } catch {
      return publicUrl;
    }
  });
  const [test, setTest] = useState<{ state: "idle" | "testing" | "ok" | "fail"; msg?: string }>({ state: "idle" });

  const save = (v: string) => {
    setEndpoint(v);
    setTest({ state: "idle" });
    try {
      localStorage.setItem(KEY, v);
    } catch {}
  };

  async function testConnection() {
    setTest({ state: "testing" });
    const base = endpoint.replace(/\/+$/, "");
    try {
      const t0 = performance.now();
      const res = await fetch(`${base}/api/health`, { cache: "no-store" });
      const js = res.ok ? await res.json() : null;
      const tr = await fetch(`${base}/tracker.js`, { cache: "no-store" });
      if (!js?.ok) throw new Error(`health returned HTTP ${res.status}`);
      if (!tr.ok) throw new Error("tracker.js not served (run npm run build:tracker)");
      setTest({ state: "ok", msg: `Reachable in ${Math.round(performance.now() - t0)} ms · ${js.mode} mode` });
    } catch (e) {
      setTest({ state: "fail", msg: (e as Error).message });
    }
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <div className="rise pt-2 pb-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">Mission briefing</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-ink sm:text-4xl">
          Connect your <span className="text-thermal">store</span>
        </h1>
      </div>
      <Card title="1. Paste this into your Shopify theme">
        <div className="space-y-3 px-4 py-4 text-sm text-ink-2">
          <label className="block">
            <span className="mb-1.5 block font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-ink-3">Collector URL (change this when you use a tunnel or deploy)</span>
            <input
              value={endpoint}
              onChange={(e) => save(e.target.value)}
              className="min-h-10 w-full rounded-xl border border-line-strong bg-panel px-3.5 font-mono text-sm text-ink transition focus:border-accent focus:outline-none"
              spellCheck={false}
            />
          </label>
          <SnippetBox endpoint={endpoint} />
          <ol className="list-decimal space-y-1.5 pl-5 marker:font-display marker:text-accent">
            <li>Shopify admin → Online Store → Themes → ⋯ on your theme → <b>Edit code</b> (use a duplicate theme for testing).</li>
            <li>
              Open <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[12px] text-accent">layout/theme.liquid</code> and paste the tag just before{" "}
              <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[12px] text-accent">&lt;/head&gt;</code>. It only tracks <code>/products/…</code> pages.
            </li>
            <li>Preview the theme, open a product page, click around. Clicks show up here within ~3 seconds.</li>
          </ol>
        </div>
      </Card>
      <Card title="2. Test the connection">
        <div className="flex flex-wrap items-center gap-3 px-4 py-4 text-sm">
          <Button variant="primary" onClick={testConnection} disabled={test.state === "testing"}>
            {test.state === "testing" ? "Testing…" : "Test connection"}
          </Button>
          {test.state === "ok" && <span className="inline-flex items-center gap-2 font-medium text-good"><span className="pulse-dot size-2 rounded-full bg-good" aria-hidden />✓ {test.msg}</span>}
          {test.state === "fail" && <span className="font-medium text-rage">✕ Not reachable: {test.msg}</span>}
        </div>
        <p className="border-t border-line px-4 py-3 text-xs text-ink-3">
          Testing on your real store with <code>http://localhost</code>: works only in Chrome on this same computer. Chrome may ask to allow
          the store to access devices on your local network: click Allow. For real visitor traffic, expose the collector over https
          (cloudflared / ngrok / a deploy) and put that URL above. See README → "Testing on your real store".
        </p>
      </Card>
      <Card title="Optional attributes">
        <ul className="space-y-1.5 px-4 py-4 text-sm text-ink-2">
          <li>
            <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[12px] text-accent">data-all-pages="true"</code>: also track non-product pages.
          </li>
          <li>
            <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[12px] text-accent">data-heatmap-label="…"</code> on any element: give it a friendly name.
          </li>
          <li>
            <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[12px] text-accent">data-heatmap-atc</code> on a custom button: count it as add-to-cart.
          </li>
          <li>
            <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[12px] text-accent">window.HEATMAP_OPTOUT = true</code>: disable tracking (e.g. until cookie consent).
          </li>
        </ul>
      </Card>
    </div>
  );
}
