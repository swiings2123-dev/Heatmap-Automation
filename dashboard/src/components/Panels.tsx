import { memo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ElementStat, StatsResponse } from "../../../shared/types";
import { fmtDec, fmtInt, fmtPct } from "../lib/format";
import { Card, Segmented } from "./ui";

const TONES = {
  base: { bar: "var(--thermal)", glow: "rgb(0 200 255 / 0.18)" },
  accent: { bar: "linear-gradient(90deg, #8dff4f, #ffd23d)", glow: "rgb(141 255 79 / 0.2)" },
  rage: { bar: "linear-gradient(90deg, #ff7a1a, #ff1f6b)", glow: "rgb(255 31 107 / 0.22)" },
  dead: { bar: "linear-gradient(90deg, #6d3fe0, #c4b5fd)", glow: "rgb(167 139 250 / 0.22)" },
};

function Tile({ label, value, sub, tone = "base", i = 0 }: { label: string; value: string; sub?: string; tone?: keyof typeof TONES; i?: number }) {
  const t = TONES[tone];
  return (
    <div
      className="glass rise group relative overflow-hidden rounded-2xl px-4 pt-3.5 pb-3 transition-transform duration-300 hover:-translate-y-0.5"
      style={{ animationDelay: `${i * 50}ms` }}
    >
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: t.bar }} aria-hidden />
      <span
        className="pointer-events-none absolute -right-8 -top-10 size-28 rounded-full blur-2xl transition-opacity duration-500 group-hover:opacity-100 opacity-70"
        style={{ background: t.glow }}
        aria-hidden
      />
      <p className="relative font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-ink-3">{label}</p>
      <p className="tabular relative mt-1 font-display text-[26px] leading-tight font-bold text-ink">{value}</p>
      {sub && <p className="tabular relative mt-0.5 text-xs text-ink-3">{sub}</p>}
    </div>
  );
}

export const StatTiles = memo(function StatTiles({ s }: { s: StatsResponse }) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-2" data-testid="stat-tiles">
      <Tile i={0} label="Clicks" value={fmtInt(s.clicks)} />
      <Tile i={1} label="Visitors" value={fmtInt(s.visitors)} sub={`${fmtInt(s.sessions)} sessions`} />
      <Tile i={2} label="Clicks / visitor" value={fmtDec(s.clicksPerVisitor, 1)} />
      <Tile i={3} label="ATC click rate" value={fmtPct(s.atcRate)} sub={`${fmtInt(s.atcSessions)} of ${fmtInt(s.sessions)} sessions`} tone="accent" />
      <Tile i={4} label="Rage clicks" value={fmtInt(s.rageClicks)} sub={s.clicks ? `${fmtPct(s.rageClicks / s.clicks)} of clicks` : undefined} tone="rage" />
      <Tile i={5} label="Dead clicks" value={fmtInt(s.deadClicks)} sub={s.clicks ? `${fmtPct(s.deadClicks / s.clicks)} of clicks` : undefined} tone="dead" />
    </div>
  );
});

export const ScrollFunnel = memo(function ScrollFunnel({ s }: { s: StatsResponse }) {
  return (
    <Card title="How far visitors scroll">
      <ul className="space-y-3 px-4 py-4">
        {s.scroll.map((d) => {
          const w = Math.max(d.pct * 100, d.pct > 0 ? 2 : 0);
          return (
            <li key={d.depth} className="grid grid-cols-[3rem_1fr_3rem] items-center gap-3 text-sm">
              <span className="font-mono text-xs text-ink-3">{d.depth}%</span>
              <span className="relative h-3 overflow-hidden rounded-full bg-surface" title={`${fmtInt(d.sessions)} sessions`}>
                {/* Gradient sized to the full track, so short bars stay "cold" and full ones run hot. */}
                <span
                  className="block h-full rounded-full transition-[width] duration-700"
                  style={{ width: `${w}%`, background: "var(--thermal)", backgroundSize: `${w ? 10000 / w : 100}% 100%` }}
                />
              </span>
              <span className="tabular text-right font-display text-[13px] font-semibold text-ink">{fmtPct(d.pct, 0)}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
});

function ElementRow({ e, onHover, active, right, share }: { e: ElementStat; onHover: (s: string | null) => void; active: boolean; right: React.ReactNode; share?: number }) {
  return (
    <li
      onMouseEnter={() => onHover(e.selector)}
      onMouseLeave={() => onHover(null)}
      className={`relative cursor-default px-4 py-2.5 text-sm transition-colors ${active ? "bg-accent/10" : "hover:bg-surface/70"}`}
      title={e.selector}
    >
      {active && <span className="bg-hot absolute inset-y-1.5 left-0 w-[3px] rounded-r-full" aria-hidden />}
      <div className="flex items-center justify-between gap-3">
        <span className={`min-w-0 truncate ${e.label ? "font-medium text-ink" : "italic text-ink-3"}`}>{e.label || "Unlabelled element"}</span>
        <span className="tabular shrink-0 text-[13px] text-ink-2">{right}</span>
      </div>
      {share !== undefined && (
        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface">
          <span className="block h-full rounded-full" style={{ width: `${Math.max(share * 100, 2)}%`, background: "var(--hot)" }} />
        </span>
      )}
    </li>
  );
}

export function TopElements({ s, highlight, onHover }: { s: StatsResponse; highlight: string | null; onHover: (sel: string | null) => void }) {
  const [sort, setSort] = useState<"clicks" | "cps">("clicks");
  const rows = [...s.topElements].sort((a, b) => (sort === "clicks" ? b.clicks - a.clicks : b.clicksPerSession - a.clicksPerSession)).slice(0, 10);
  const max = Math.max(1e-9, ...rows.map((r) => (sort === "clicks" ? r.clicks : r.clicksPerSession)));
  return (
    <Card
      title="Top elements"
      right={<Segmented label="Sort top elements" value={sort} onChange={setSort} options={[{ value: "clicks", label: "Clicks" }, { value: "cps", label: "Per session" }]} />}
    >
      {rows.length ? (
        <ol className="divide-y divide-line py-1">
          {rows.map((e) => (
            <ElementRow
              key={e.selector}
              e={e}
              onHover={onHover}
              active={highlight === e.selector}
              share={(sort === "clicks" ? e.clicks : e.clicksPerSession) / max}
              right={
                sort === "clicks" ? (
                  <>
                    <b className="font-semibold text-ink">{fmtInt(e.clicks)}</b> <span className="text-ink-3">· {fmtPct(e.reach, 0)} of visitors</span>
                  </>
                ) : (
                  <>
                    <b className="font-semibold text-ink">{fmtDec(e.clicksPerSession)}</b> <span className="text-ink-3">· {fmtInt(e.sessions)} sessions</span>
                  </>
                )
              }
            />
          ))}
        </ol>
      ) : (
        <p className="px-4 py-6 text-sm text-ink-3">No clicks in this range.</p>
      )}
    </Card>
  );
}

export function Frustration({ s, highlight, onHover }: { s: StatsResponse; highlight: string | null; onHover: (sel: string | null) => void }) {
  const rows = s.frustration.slice(0, 8);
  return (
    <Card title="Where you're doing badly">
      {rows.length ? (
        <>
          <ul className="divide-y divide-line py-1">
            {rows.map((e) => (
              <ElementRow
                key={e.selector}
                e={e}
                onHover={onHover}
                active={highlight === e.selector}
                right={
                  <span className="flex items-center gap-1.5">
                    {e.rage > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rage/15 px-2 py-0.5 text-xs font-semibold text-rage">
                        <span className="size-1.5 rounded-full bg-rage" aria-hidden />
                        {fmtInt(e.rage)} rage
                      </span>
                    )}
                    {e.dead > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-dead/15 px-2 py-0.5 text-xs font-semibold text-dead">
                        <span className="size-1.5 rounded-full bg-dead" aria-hidden />
                        {fmtInt(e.dead)} dead
                      </span>
                    )}
                  </span>
                }
              />
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2.5 text-xs leading-relaxed text-ink-3">
            Rage = 3+ fast clicks in the same spot. Dead = click on something that did nothing. Often a non-zoomable image, text that looks
            like a link, or a broken button.
          </p>
        </>
      ) : (
        <p className="px-4 py-6 text-sm text-ink-3">No rage or dead clicks. Nice. 🧊</p>
      )}
    </Card>
  );
}

export const ClicksChart = memo(function ClicksChart({ s }: { s: StatsResponse }) {
  const data = s.perDay.map((d) => ({
    ...d,
    label: new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  }));
  return (
    <Card title="Clicks per day">
      <div className="h-48 px-2 py-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }} barCategoryGap={3}>
            <defs>
              <linearGradient id="hm-bar" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#ff1f6b" />
                <stop offset="55%" stopColor="#ff7a1a" />
                <stop offset="100%" stopColor="#ffd23d" />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 4" />
            <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: "var(--ink-3)", fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={{ fontSize: 10.5, fill: "var(--ink-3)", fontFamily: "var(--font-mono)" }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "var(--accent)", fillOpacity: 0.08 }}
              contentStyle={{ background: "var(--panel-solid)", border: "1px solid var(--line-strong)", borderRadius: 12, fontSize: 12, color: "var(--ink)", boxShadow: "var(--glow)" }}
              labelStyle={{ color: "var(--ink-3)", fontFamily: "var(--font-mono)", fontSize: 11 }}
              itemStyle={{ color: "var(--ink)" }}
              formatter={(v) => [fmtInt(Number(v)), "Clicks"]}
            />
            <Bar dataKey="clicks" fill="url(#hm-bar)" radius={[6, 6, 2, 2]} maxBarSize={26} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
});
