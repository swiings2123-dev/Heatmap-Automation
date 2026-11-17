import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Device, ElementStat, PageInfo, StatsResponse, WireBatch } from "../../../shared/types";
import type {
  AnchoredBin,
  ClickKind,
  ElementCount,
  EventFilter,
  FallbackBin,
  ScreenshotRow,
  StatsOptions,
  Storage,
} from "./types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pages (
  store      TEXT NOT NULL,
  handle     TEXT NOT NULL,
  url        TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  clicks     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (store, handle)
);
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  visitor_id   TEXT NOT NULL,
  store        TEXT NOT NULL,
  device       TEXT NOT NULL,
  source       TEXT NOT NULL,
  utm_medium   TEXT,
  utm_campaign TEXT,
  referrer     TEXT,
  first_seen   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  store      TEXT NOT NULL,
  handle     TEXT NOT NULL,
  device     TEXT NOT NULL,
  ts         INTEGER NOT NULL,       -- epoch ms, UTC
  type       TEXT NOT NULL,          -- click | scroll | pageview
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  source     TEXT NOT NULL,
  vw INTEGER, vh INTEGER, page_w INTEGER, page_h INTEGER,
  x REAL, y REAL, vx REAL, vy REAL,
  selector TEXT, label TEXT, x_in_el REAL, y_in_el REAL,
  is_fixed INTEGER NOT NULL DEFAULT 0,
  is_rage  INTEGER NOT NULL DEFAULT 0,
  is_dead  INTEGER NOT NULL DEFAULT 0,
  is_atc   INTEGER NOT NULL DEFAULT 0,
  depth    INTEGER
);
CREATE INDEX IF NOT EXISTS events_page_device_ts ON events (store, handle, device, ts);
CREATE INDEX IF NOT EXISTS events_session ON events (session_id);
CREATE TABLE IF NOT EXISTS screenshots (
  id          INTEGER PRIMARY KEY,
  store       TEXT NOT NULL,
  handle      TEXT NOT NULL,
  device      TEXT NOT NULL,
  version     INTEGER NOT NULL,
  url         TEXT NOT NULL,
  path        TEXT NOT NULL,
  layout_path TEXT NOT NULL,
  page_width  INTEGER NOT NULL,
  page_height INTEGER NOT NULL,
  layout_hash TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  checked_at  INTEGER NOT NULL,
  UNIQUE (store, handle, device, version)
);
`;

interface ScreenshotDbRow {
  id: number;
  store: string;
  handle: string;
  device: Device;
  version: number;
  url: string;
  path: string;
  layout_path: string;
  page_width: number;
  page_height: number;
  layout_hash: string;
  captured_at: number;
  checked_at: number;
}

const toShot = (r: ScreenshotDbRow): ScreenshotRow => ({
  id: r.id,
  store: r.store,
  handle: r.handle,
  device: r.device,
  version: r.version,
  url: r.url,
  path: r.path,
  layoutPath: r.layout_path,
  pageWidth: r.page_width,
  pageHeight: r.page_height,
  layoutHash: r.layout_hash,
  capturedAt: r.captured_at,
  checkedAt: r.checked_at,
});

const DAY = 86_400_000;

export class SqliteStorage implements Storage {
  readonly db: Database.Database;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(SCHEMA);
    this.tx = this.buildInsertTx();
  }

  // ---------------------------------------------------------------- writes
  private readonly tx: (b: WireBatch, now: number) => number;

  private buildInsertTx() {
    const upsertPage = this.db.prepare(
      `INSERT INTO pages (store, handle, url, first_seen, last_seen, clicks) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (store, handle) DO UPDATE SET
         last_seen = MAX(last_seen, excluded.last_seen), url = excluded.url, clicks = clicks + excluded.clicks`,
    );
    const insertSession = this.db.prepare(
      `INSERT OR IGNORE INTO sessions (id, visitor_id, store, device, source, utm_medium, utm_campaign, referrer, first_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const ins = this.db.prepare(
      `INSERT INTO events (store, handle, device, ts, type, session_id, visitor_id, source, vw, vh,
         page_w, page_h, x, y, vx, vy, selector, label, x_in_el, y_in_el, is_fixed, is_rage, is_dead, is_atc, depth)
       VALUES (@store, @handle, @device, @ts, @type, @sid, @vid, @source, @vw, @vh,
         @pw, @ph, @x, @y, @vx, @vy, @sel, @lbl, @ex, @ey, @fx, @rg, @dd, @atc, @depth)`,
    );
    return this.db.transaction((b: WireBatch, now: number) => {
      const clicks = b.ev.filter((e) => e.t === "click").length;
      upsertPage.run(b.store, b.page, b.url, now, now, clicks);
      insertSession.run(b.sid, b.vid, b.store, b.dev, b.src, b.med ?? null, b.cmp ?? null, b.ref ?? null, now);
      const base = { store: b.store, handle: b.page, device: b.dev, sid: b.sid, vid: b.vid, source: b.src, vw: b.vw, vh: b.vh };
      const empty = { pw: null, ph: null, x: null, y: null, vx: null, vy: null, sel: null, lbl: null, ex: null, ey: null, fx: 0, rg: 0, dd: 0, atc: 0, depth: null };
      for (const e of b.ev) {
        if (e.t === "click") {
          ins.run({
            ...base, ...empty, ts: e.ts, type: "click", pw: e.pw, ph: e.ph, x: e.x, y: e.y, vx: e.vx, vy: e.vy,
            sel: e.sel, lbl: e.lbl, ex: e.ex, ey: e.ey, fx: e.fx ?? 0, rg: e.rg ?? 0, dd: e.dd ?? 0, atc: e.atc ?? 0,
          });
        } else if (e.t === "scroll") {
          ins.run({ ...base, ...empty, ts: e.ts, type: "scroll", depth: e.d });
        } else {
          ins.run({ ...base, ...empty, ts: e.ts, type: "pageview", pw: e.pw, ph: e.ph });
        }
      }
      return b.ev.length;
    });
  }

  async insertEvents(batch: WireBatch, receivedAt: number): Promise<number> {
    return this.tx(batch, receivedAt);
  }

  // ---------------------------------------------------------------- pages
  async listStores(): Promise<string[]> {
    return this.db
      .prepare(`SELECT store FROM pages GROUP BY store ORDER BY MAX(last_seen) DESC`)
      .pluck()
      .all() as string[];
  }

  async listPages(store?: string): Promise<PageInfo[]> {
    const sql = `SELECT store, handle, url, first_seen AS firstSeen, last_seen AS lastSeen, clicks FROM pages
                 ${store ? "WHERE store = ?" : ""} ORDER BY last_seen DESC`;
    return (store ? this.db.prepare(sql).all(store) : this.db.prepare(sql).all()) as PageInfo[];
  }

  async getPage(store: string, handle: string): Promise<PageInfo | null> {
    return (
      (this.db
        .prepare(
          `SELECT store, handle, url, first_seen AS firstSeen, last_seen AS lastSeen, clicks FROM pages WHERE store = ? AND handle = ?`,
        )
        .get(store, handle) as PageInfo | undefined) ?? null
    );
  }

  async upsertPage(store: string, handle: string, url: string, at: number): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO pages (store, handle, url, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (store, handle) DO UPDATE SET url = excluded.url`,
      )
      .run(store, handle, url, at, at);
  }

  // ---------------------------------------------------------------- aggregation
  private where(f: EventFilter, alias = "") {
    const p = alias ? `${alias}.` : "";
    let sql = `${p}store = @store AND ${p}handle = @handle AND ${p}device = @device AND ${p}ts >= @from AND ${p}ts < @to`;
    const params: Record<string, string | number> = { store: f.store, handle: f.handle, device: f.device, from: f.from, to: f.to };
    if (f.source) {
      sql += ` AND ${p}source = @source`;
      params.source = f.source;
    }
    return { sql, params };
  }

  private kindSql(kind: ClickKind) {
    return kind === "rage" ? " AND is_rage = 1" : kind === "dead" ? " AND is_dead = 1" : "";
  }

  async queryBins(f: EventFilter, known: string[], kind: ClickKind): Promise<AnchoredBin[]> {
    if (!known.length) return [];
    const w = this.where(f);
    return this.db
      .prepare(
        `SELECT selector, MIN(CAST(x_in_el * 20 AS INTEGER), 19) AS gx, MIN(CAST(y_in_el * 20 AS INTEGER), 19) AS gy, COUNT(*) AS n
         FROM events
         WHERE ${w.sql} AND type = 'click'${this.kindSql(kind)}
           AND selector IN (SELECT value FROM json_each(@known))
         GROUP BY 1, 2, 3`,
      )
      .all({ ...w.params, known: JSON.stringify(known) }) as AnchoredBin[];
  }

  async queryFallbackBins(f: EventFilter, known: string[], kind: ClickKind): Promise<FallbackBin[]> {
    const w = this.where(f);
    const rows = this.db
      .prepare(
        `SELECT is_fixed AS fixed,
           CASE WHEN is_fixed = 1 THEN CAST(vx * 200.0 / MAX(vw, 1) AS INTEGER)
                ELSE CAST(x * 200.0 / MAX(page_w, 1) AS INTEGER) END AS qx,
           CASE WHEN is_fixed = 1 THEN CAST(vy * 1000.0 / MAX(vh, 1) AS INTEGER)
                ELSE CAST(y * 1000.0 / MAX(page_h, 1) AS INTEGER) END AS qy,
           COUNT(*) AS n
         FROM events
         WHERE ${w.sql} AND type = 'click'${this.kindSql(kind)}
           AND (selector IS NULL OR selector NOT IN (SELECT value FROM json_each(@known)))
         GROUP BY 1, 2, 3`,
      )
      .all({ ...w.params, known: JSON.stringify(known) }) as (Omit<FallbackBin, "fixed"> & { fixed: number })[];
    return rows.map((r) => ({ ...r, fixed: r.fixed === 1 }));
  }

  async queryElementCounts(f: EventFilter, limit: number): Promise<ElementCount[]> {
    const w = this.where(f);
    return this.db
      .prepare(
        `SELECT selector, MAX(label) AS label, COUNT(*) AS clicks, COUNT(DISTINCT session_id) AS sessions
         FROM events WHERE ${w.sql} AND type = 'click' AND selector IS NOT NULL
         GROUP BY selector ORDER BY clicks DESC LIMIT @limit`,
      )
      .all({ ...w.params, limit }) as ElementCount[];
  }

  async queryStats(f: EventFilter, opts: StatsOptions): Promise<StatsResponse> {
    const w = this.where(f);
    const atcParams: Record<string, string> = {};
    const atcLike = opts.atcLabels.map((l, i) => {
      atcParams[`atc${i}`] = `%${l.replace(/[%_]/g, "")}%`;
      return `lower(label) LIKE @atc${i}`;
    });
    const atc = `(is_atc = 1${atcLike.length ? " OR " + atcLike.join(" OR ") : ""})`;

    const totals = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(type = 'click'), 0) AS clicks,
           COUNT(DISTINCT session_id) AS sessions,
           COUNT(DISTINCT visitor_id) AS visitors,
           COALESCE(SUM(is_rage), 0) AS rage,
           COALESCE(SUM(is_dead), 0) AS dead,
           COALESCE(SUM(type = 'click' AND ${atc}), 0) AS atcClicks,
           COUNT(DISTINCT CASE WHEN type = 'click' AND ${atc} THEN session_id END) AS atcSessions
         FROM events WHERE ${w.sql}`,
      )
      .get({ ...w.params, ...atcParams }) as {
      clicks: number;
      sessions: number;
      visitors: number;
      rage: number;
      dead: number;
      atcClicks: number;
      atcSessions: number;
    };

    const depthRows = this.db
      .prepare(
        `SELECT depth, COUNT(DISTINCT session_id) AS n FROM events WHERE ${w.sql} AND type = 'scroll' GROUP BY depth`,
      )
      .all(w.params) as { depth: number; n: number }[];
    const depthMap = new Map(depthRows.map((r) => [r.depth, r.n]));
    const pct = (n: number) => (totals.sessions ? n / totals.sessions : 0);
    const scroll = ([25, 50, 75, 100] as const).map((depth) => {
      const n = depthMap.get(depth) ?? 0;
      return { depth, sessions: n, pct: pct(n) };
    });

    type Row = { selector: string; label: string; clicks: number; sessions: number; rage: number; dead: number };
    const toStat = (r: Row): ElementStat => ({
      ...r,
      reach: pct(r.sessions),
      clicksPerSession: r.sessions ? r.clicks / r.sessions : 0,
    });
    const elementSql = (extra: string, order: string) =>
      `SELECT selector, MAX(label) AS label, COUNT(*) AS clicks, COUNT(DISTINCT session_id) AS sessions,
              SUM(is_rage) AS rage, SUM(is_dead) AS dead
       FROM events WHERE ${w.sql} AND type = 'click' AND selector IS NOT NULL${extra}
       GROUP BY selector ORDER BY ${order} LIMIT 25`;
    const topElements = (this.db.prepare(elementSql("", "clicks DESC")).all(w.params) as Row[]).map(toStat);
    const frustration = (
      this.db.prepare(elementSql(" AND (is_rage = 1 OR is_dead = 1)", "clicks DESC")).all(w.params) as Row[]
    ).map(toStat);

    const off = opts.tzOffset * 60_000;
    const dayRows = this.db
      .prepare(
        `SELECT CAST((ts - @off) / ${DAY} AS INTEGER) AS d, COALESCE(SUM(type = 'click'), 0) AS clicks,
                COUNT(DISTINCT session_id) AS sessions
         FROM events WHERE ${w.sql} GROUP BY d ORDER BY d`,
      )
      .all({ ...w.params, off }) as { d: number; clicks: number; sessions: number }[];
    const byDay = new Map(dayRows.map((r) => [r.d, r]));
    const perDay: StatsResponse["perDay"] = [];
    const firstDay = Math.floor((f.from - off) / DAY);
    const lastDay = Math.floor((Math.min(f.to, Date.now()) - 1 - off) / DAY);
    for (let d = firstDay; d <= lastDay && perDay.length < 400; d++) {
      const r = byDay.get(d);
      perDay.push({ day: new Date(d * DAY).toISOString().slice(0, 10), clicks: r?.clicks ?? 0, sessions: r?.sessions ?? 0 });
    }

    const { source: _ignored, ...noSource } = f;
    const ws = this.where(noSource);
    const sources = this.db
      .prepare(
        `SELECT source, COUNT(DISTINCT session_id) AS sessions FROM events WHERE ${ws.sql}
         GROUP BY source ORDER BY sessions DESC LIMIT 25`,
      )
      .all(ws.params) as { source: string; sessions: number }[];

    return {
      clicks: totals.clicks,
      sessions: totals.sessions,
      visitors: totals.visitors,
      clicksPerVisitor: totals.visitors ? totals.clicks / totals.visitors : 0,
      rageClicks: totals.rage,
      deadClicks: totals.dead,
      atcClicks: totals.atcClicks,
      atcSessions: totals.atcSessions,
      atcRate: pct(totals.atcSessions),
      scroll,
      topElements,
      frustration,
      perDay,
      sources,
    };
  }

  async recentSelectors(store: string, handle: string, device: Device, since: number, limit: number): Promise<string[]> {
    return this.db
      .prepare(
        `SELECT selector FROM events
         WHERE store = ? AND handle = ? AND device = ? AND ts >= ? AND type = 'click' AND selector IS NOT NULL
         GROUP BY selector ORDER BY COUNT(*) DESC LIMIT ?`,
      )
      .pluck()
      .all(store, handle, device, since, limit) as string[];
  }

  async devicesForPage(store: string, handle: string): Promise<Device[]> {
    return this.db
      .prepare(`SELECT DISTINCT device FROM events WHERE store = ? AND handle = ?`)
      .pluck()
      .all(store, handle) as Device[];
  }

  // ---------------------------------------------------------------- screenshots
  async addScreenshot(row: Omit<ScreenshotRow, "id" | "version">): Promise<ScreenshotRow> {
    const add = this.db.transaction(() => {
      const version =
        ((this.db
          .prepare(`SELECT MAX(version) FROM screenshots WHERE store = ? AND handle = ? AND device = ?`)
          .pluck()
          .get(row.store, row.handle, row.device) as number | null) ?? 0) + 1;
      const imagePath = row.path.replace("{version}", String(version));
      const layoutPath = row.layoutPath.replace("{version}", String(version));
      const info = this.db
        .prepare(
          `INSERT INTO screenshots (store, handle, device, version, url, path, layout_path, page_width, page_height,
             layout_hash, captured_at, checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(row.store, row.handle, row.device, version, row.url, imagePath, layoutPath, row.pageWidth, row.pageHeight,
          row.layoutHash, row.capturedAt, row.checkedAt);
      return { ...row, id: Number(info.lastInsertRowid), version, path: imagePath, layoutPath };
    });
    return add();
  }

  async getActiveScreenshot(store: string, handle: string, device: Device): Promise<ScreenshotRow | null> {
    const r = this.db
      .prepare(`SELECT * FROM screenshots WHERE store = ? AND handle = ? AND device = ? ORDER BY version DESC LIMIT 1`)
      .get(store, handle, device) as ScreenshotDbRow | undefined;
    return r ? toShot(r) : null;
  }

  async getScreenshot(id: number): Promise<ScreenshotRow | null> {
    const r = this.db.prepare(`SELECT * FROM screenshots WHERE id = ?`).get(id) as ScreenshotDbRow | undefined;
    return r ? toShot(r) : null;
  }

  async markScreenshotChecked(id: number, at: number): Promise<void> {
    this.db.prepare(`UPDATE screenshots SET checked_at = ? WHERE id = ?`).run(at, id);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
