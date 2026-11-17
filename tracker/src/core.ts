// Pure tracker logic (no DOM access) so it can be unit-tested.

export const RAGE_COUNT = 3;
export const RAGE_WINDOW_MS = 1000;
export const RAGE_RADIUS_PX = 40;
export const DEAD_WAIT_MS = 700;

/** Rage click = 3+ clicks within 1 s, all within 40 px (page coordinates) of the latest click. */
export class RageDetector {
  private recent: { x: number; y: number; ts: number }[] = [];

  hit(x: number, y: number, ts: number): boolean {
    this.recent = this.recent.filter((c) => ts - c.ts <= RAGE_WINDOW_MS);
    this.recent.push({ x, y, ts });
    if (this.recent.length > 20) this.recent.shift();
    let near = 0;
    for (const c of this.recent) {
      if (Math.hypot(c.x - x, c.y - y) <= RAGE_RADIUS_PX) near++;
    }
    return near >= RAGE_COUNT;
  }
}

/**
 * A click on a non-interactive element is "dead" when neither the DOM nor the
 * URL changed within DEAD_WAIT_MS. `mutationsAt` / `urlAt` are counters read at
 * click time and again after the wait.
 */
export function isDeadClick(
  interactive: boolean,
  before: { mutations: number; url: string },
  after: { mutations: number; url: string },
): boolean {
  return !interactive && before.mutations === after.mutations && before.url === after.url;
}

/** Scroll milestones reached for a given scroll position (all passed milestones, not just the max). */
export function milestones(scrollBottom: number, docHeight: number): (25 | 50 | 75 | 100)[] {
  if (docHeight <= 0) return [];
  const pct = (scrollBottom / docHeight) * 100;
  const out: (25 | 50 | 75 | 100)[] = [];
  for (const m of [25, 50, 75, 100] as const) if (pct >= (m === 100 ? 98 : m)) out.push(m);
  return out;
}

export interface Transport {
  /** Send one serialized batch. Must not throw. */
  (body: string): void;
}

/**
 * In-memory event queue. Events are flushed in chunks of `maxBatch`; when
 * the queue exceeds `maxQueue` (endpoint down) the oldest events are dropped.
 */
export class EventQueue<E> {
  private items: E[] = [];

  constructor(
    private readonly wrap: (events: E[]) => unknown,
    private readonly send: Transport,
    private readonly maxBatch = 40,
    private readonly maxQueue = 400,
  ) {}

  get size(): number {
    return this.items.length;
  }

  push(event: E): void {
    this.items.push(event);
    if (this.items.length > this.maxQueue) this.items.splice(0, this.items.length - this.maxQueue);
  }

  /** Returns the number of requests sent. */
  flush(): number {
    let sent = 0;
    while (this.items.length) {
      const chunk = this.items.splice(0, this.maxBatch);
      try {
        this.send(JSON.stringify(this.wrap(chunk)));
      } catch {}
      sent++;
    }
    return sent;
  }
}

const UTM_SOURCES: [RegExp, string][] = [
  [/(^|\.)(facebook|fb)\.com$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)google\./, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)youtube\.com$/, "youtube"],
];

/** First-touch source: utm_source, else click-id/referrer inference, else "direct". */
export function inferSource(params: URLSearchParams, referrerHost: string, ownHost: string): string {
  const utm = params.get("utm_source");
  if (utm) return utm.toLowerCase().slice(0, 60);
  if (params.has("fbclid")) return "facebook";
  if (params.has("gclid") || params.has("gbraid") || params.has("wbraid")) return "google";
  if (params.has("ttclid")) return "tiktok";
  if (referrerHost && referrerHost !== ownHost) {
    for (const [re, name] of UTM_SOURCES) if (re.test(referrerHost)) return name;
    return referrerHost.slice(0, 60);
  }
  return "direct";
}
