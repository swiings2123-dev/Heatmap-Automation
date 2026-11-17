// tracker.js — paste ONE tag into your Shopify theme:
//   <script src="https://YOUR-COLLECTOR/tracker.js" async></script>
// Everything is wrapped in try/catch: the tracker must never break or slow the storefront.

import type { Device, WireBatch, WireClick, WireEvent } from "../../shared/types";
import { EventQueue, RageDetector, DEAD_WAIT_MS, inferSource, isDeadClick, milestones } from "./core";
import { ATC_SELECTOR, actionableTarget, cssSelector, isInteractive, labelFor, positionMode } from "./dom";

declare global {
  interface Window {
    HEATMAP_ENDPOINT?: string;
    HEATMAP_OPTOUT?: boolean;
    __hm?: { flush(): void };
  }
}

const SESSION_MS = 30 * 60 * 1000;
const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|pingdom|gtmetrix|facebookexternalhit|bingpreview|prerender|phantom/i;

(function () {
  try {
    const w = window;
    const d = document;
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (w.__hm) return;
    const script = d.currentScript as HTMLScriptElement | null;
    const ds: DOMStringMap = (script && script.dataset) || {};

    // Privacy + bots
    if (
      w.HEATMAP_OPTOUT ||
      nav.doNotTrack === "1" ||
      (w as unknown as { doNotTrack?: string }).doNotTrack === "1" ||
      nav.globalPrivacyControl === true ||
      nav.webdriver ||
      BOT_UA.test(nav.userAgent)
    )
      return;

    const match = location.pathname.match(/\/products\/([^/?#]+)/);
    if (!match && ds.allPages !== "true") return;
    const page = match ? decodeURIComponent(match[1]!).toLowerCase() : location.pathname.replace(/\/+$/, "") || "/";

    let endpoint = w.HEATMAP_ENDPOINT || ds.endpoint || "";
    if (!endpoint && script && script.src) endpoint = new URL(script.src).origin;
    endpoint = (endpoint || "http://localhost:3000").replace(/\/+$/, "");

    // --- storage with in-memory fallback (Safari private mode, blocked storage) ---
    const mem: Record<string, string> = {};
    const get = (k: string): string | null => {
      try {
        return localStorage.getItem(k);
      } catch {
        return mem[k] ?? null;
      }
    };
    const set = (k: string, v: string) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        mem[k] = v;
      }
    };
    const rid = () =>
      w.crypto && crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);

    let vid = get("hm_vid");
    if (!vid) set("hm_vid", (vid = rid()));

    // --- session + first-touch attribution ---
    interface Sess {
      id: string;
      last: number;
      src: string;
      med?: string;
      cmp?: string;
      ref?: string;
    }
    const params = new URLSearchParams(location.search);
    let refHost = "";
    try {
      refHost = d.referrer ? new URL(d.referrer).hostname : "";
    } catch {}
    let sess: Sess | null = null;
    try {
      sess = JSON.parse(get("hm_sess") || "null");
    } catch {}
    const utm = params.get("utm_source");
    if (!sess || Date.now() - sess.last > SESSION_MS || (utm && utm.toLowerCase() !== sess.src)) {
      sess = {
        id: rid(),
        last: 0,
        src: inferSource(params, refHost, location.hostname),
        med: params.get("utm_medium")?.slice(0, 60) || undefined,
        cmp: params.get("utm_campaign")?.slice(0, 100) || undefined,
        ref: refHost && refHost !== location.hostname ? refHost : undefined,
      };
    }
    const session = sess;
    const touch = () => {
      session.last = Date.now();
      set("hm_sess", JSON.stringify(session));
    };
    touch();

    const deviceOf = (): Device => (w.innerWidth < 768 ? "mobile" : w.innerWidth < 1024 ? "tablet" : "desktop");
    const de = d.documentElement;
    const r = Math.round;

    // --- batching ---
    const url = endpoint + "/api/collect";
    const send = (body: string) => {
      if (nav.sendBeacon && nav.sendBeacon(url, new Blob([body], { type: "text/plain" }))) return;
      fetch(url, { method: "POST", body, keepalive: true, credentials: "omit", headers: { "Content-Type": "text/plain" } }).catch(
        () => {},
      );
    };
    const queue = new EventQueue<WireEvent>(
      (ev): WireBatch => ({
        v: 1,
        sid: session.id,
        vid: vid!,
        store: location.hostname,
        page,
        url: location.origin + location.pathname,
        dev: deviceOf(),
        vw: w.innerWidth,
        vh: w.innerHeight,
        src: session.src,
        med: session.med,
        cmp: session.cmp,
        ref: session.ref,
        ev,
      }),
      send,
    );
    const push = (e: WireEvent) => {
      queue.push(e);
      touch();
    };
    const flush = () => {
      try {
        queue.flush();
      } catch {}
    };
    w.__hm = { flush };

    // --- dead-click watching: observe DOM only while a check is pending ---
    // Counted as "something happened": nodes added/removed anywhere (drawer, modal, toast),
    // or attribute/text changes on the clicked element's own branch. Unrelated attribute
    // churn (sticky bars toggling on scroll, carousels) is ignored.
    let mutations = 0;
    const pending = new Map<WireClick, Element>();
    const related = (n: Node) => {
      for (const el of pending.values()) if (el.contains(n) || n.contains(el)) return true;
      return false;
    };
    const observer = w.MutationObserver
      ? new MutationObserver((recs) => {
          for (const m of recs) if (m.type === "childList" || related(m.target)) mutations++;
        })
      : null;
    let observing = false;
    const watchDead = (ev: WireClick, el: Element) => {
      pending.set(ev, el);
      if (observer && !observing) {
        observer.observe(de, { childList: true, subtree: true, attributes: true, characterData: true });
        observing = true;
      }
      const before = { mutations, url: location.href };
      setTimeout(() => {
        try {
          if (!pending.delete(ev)) return;
          if (isDeadClick(false, before, { mutations, url: location.href })) ev.dd = 1;
          if (!pending.size && observer) {
            observer.disconnect();
            observing = false;
          }
          push(ev);
        } catch {}
      }, DEAD_WAIT_MS);
    };
    const releasePending = () => {
      pending.forEach((_el, ev) => push(ev));
      pending.clear();
    };

    // --- clicks: attached immediately, capture phase (theme stopPropagation can't hide them) ---
    const rage = new RageDetector();
    // Clicking a <label> makes the browser dispatch a second, synthetic click on its control.
    let labelControl: Element | null = null;
    let labelTs = 0;
    // NaN (zero-size element) -> centre; otherwise clamp to 0..1, 3 decimals.
    const frac = (v: number) => (isFinite(v) ? r(Math.min(1, Math.max(0, v)) * 1000) / 1000 : 0.5);
    d.addEventListener(
      "click",
      (e: MouseEvent) => {
        try {
          const target = e.target as Element | null;
          const el = actionableTarget(target);
          if (!el || !target || el === de || el === d.body) return;
          if (el === labelControl && e.timeStamp - labelTs < 100) return;
          if (el.tagName === "LABEL") {
            labelControl = (el as HTMLLabelElement).control;
            labelTs = e.timeStamp;
          }
          const rect = el.getBoundingClientRect();
          // Keyboard-activated clicks have no pointer position: use the element centre.
          const keyboard = e.detail === 0 && !e.clientX && !e.clientY;
          const cx = keyboard ? rect.left + rect.width / 2 : e.clientX;
          const cy = keyboard ? rect.top + rect.height / 2 : e.clientY;
          const ts = Date.now();
          const ev: WireClick = {
            t: "click",
            ts,
            x: r(cx + w.scrollX),
            y: r(cy + w.scrollY),
            pw: de.scrollWidth,
            ph: de.scrollHeight,
            vx: r(cx),
            vy: r(cy),
            sel: cssSelector(el),
            lbl: labelFor(el),
            ex: frac((cx - rect.left) / rect.width),
            ey: frac((cy - rect.top) / rect.height),
          };
          if (positionMode(el)) ev.fx = 1;
          if (rage.hit(ev.x, ev.y, ts)) ev.rg = 1;
          try {
            if (el.matches(ATC_SELECTOR) || el.closest(ATC_SELECTOR)) ev.atc = 1;
          } catch {}
          if (isInteractive(target, el)) push(ev);
          else watchDead(ev, el);
        } catch {}
      },
      { capture: true, passive: true },
    );

    // --- scroll depth milestones ---
    const reached = new Set<number>();
    let ticking = false;
    const checkScroll = () => {
      ticking = false;
      try {
        for (const m of milestones(w.scrollY + w.innerHeight, de.scrollHeight)) {
          if (!reached.has(m)) {
            reached.add(m);
            push({ t: "scroll", ts: Date.now(), d: m });
          }
        }
      } catch {}
    };
    w.addEventListener(
      "scroll",
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(checkScroll);
        }
      },
      { passive: true },
    );
    w.addEventListener("load", () => setTimeout(checkScroll, 1500));

    // --- pageview + flushing ---
    push({ t: "pageview", ts: Date.now(), pw: de.scrollWidth, ph: de.scrollHeight });
    setInterval(flush, 3000);
    d.addEventListener("visibilitychange", () => {
      if (d.visibilityState === "hidden") flush();
    });
    w.addEventListener("pagehide", () => {
      releasePending();
      flush();
    });
  } catch {}
})();
