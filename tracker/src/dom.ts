// DOM helpers shared by tracker.js (in the shopper's browser) and the
// screenshot worker's layout probe (in Playwright). Both MUST compute the same
// selector for the same element, which is why they live in one module.

/** Elements a shopper can meaningfully click. */
export const ACTIONABLE =
  "button,a,[role=button],input,select,label,summary,textarea,[data-heatmap-label]";

/** Elements that count as an add-to-cart click, matched in the browser. */
export const ATC_SELECTOR =
  '[name=add],form[action*="/cart/add"] [type=submit],[data-heatmap-atc],.shopify-payment-button__button';

const MAX_DEPTH = 6;
const HARD_MAX_DEPTH = 14;
const STABLE_ATTRS = ["data-heatmap-label", "data-testid", "data-test-id", "name", "for", "data-section-id", "data-block-id"];
const FORM_FIELDS = /^(input|textarea|select|option)$/;

function esc(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/([^\w-])/g, "\\$1");
}

/** Class string that is safe for SVG elements (className is an SVGAnimatedString there). */
export function classOf(el: Element): string {
  return el.getAttribute("class") || "";
}

/** Ids generated at runtime (React/uuid/etc.) change between page loads. */
export function isStableId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= 80 &&
    !/^\d/.test(id) &&
    !/[:\s]/.test(id) &&
    !/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)
  );
}

/**
 * Selector for an id. Shopify section ids embed a theme-specific number
 * ("Quantity-template--28679080870169__main") that changes whenever a theme is
 * duplicated or published, so those become prefix/suffix attribute selectors
 * ([id^="Quantity-template--"][id$="__main"]) that survive theme changes.
 */
const quoteAttr = (s: string) => s.replace(/["\\]/g, "\\$&");

export function idSelector(id: string): string {
  const m = /^(.*?template--)\d+(.*)$/.exec(id);
  if (!m) return "#" + esc(id);
  return `[id^="${quoteAttr(m[1]!)}"]` + (m[2] ? `[id$="${quoteAttr(m[2])}"]` : "");
}

/** Nearest ancestor-or-self a shopper actually meant to click (e.g. the <button> around an SVG <path>). */
export function actionableTarget(target: EventTarget | null): Element | null {
  let el = target as Element | null;
  if (el && el.nodeType !== 1) el = (el as Node).parentElement;
  if (!el || !el.closest) return null;
  return el.closest(ACTIONABLE) || el;
}

function isUnique(doc: Document, sel: string, el: Element): boolean {
  try {
    const found = doc.querySelectorAll(sel);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

/**
 * Stable CSS selector for an element: stops at a stable id, otherwise prefers
 * stable attributes, otherwise tag:nth-of-type. Walks up ~6 levels, further
 * only if needed to make the selector unique.
 */
export function cssSelector(el: Element): string {
  const doc = el.ownerDocument;
  const parts: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; node && depth < HARD_MAX_DEPTH; depth++) {
    const tag = node.tagName.toLowerCase();
    if (tag === "html") break;
    if (tag === "body") {
      parts.unshift("body");
      break;
    }
    const id = node.id;
    if (id && isStableId(id)) {
      parts.unshift(idSelector(id));
      const sel = parts.join(" > ");
      if (isUnique(doc, sel, el)) return sel;
    } else {
      let part = tag;
      let attrPart = "";
      for (const a of STABLE_ATTRS) {
        const v = node.getAttribute(a);
        if (v && v.length <= 60) {
          attrPart = `${tag}[${a}="${v.replace(/["\\]/g, "\\$&")}"]`;
          break;
        }
      }
      if (attrPart) {
        part = attrPart;
      } else {
        const parent: Element | null = node.parentElement;
        if (parent) {
          let index = 0;
          let count = 0;
          for (const sib of Array.from(parent.children)) {
            if (sib.tagName === node.tagName) {
              count++;
              if (sib === node) index = count;
            }
          }
          if (count > 1) part += `:nth-of-type(${index})`;
        }
      }
      parts.unshift(part);
      if (attrPart && isUnique(doc, parts.join(" > "), el)) return parts.join(" > ");
    }
    if (depth >= MAX_DEPTH - 1 && isUnique(doc, parts.join(" > "), el)) break;
    node = node.parentElement;
  }
  return parts.join(" > ");
}

function clean(text: string | null | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, 40);
}

/**
 * Human-readable label. Never reads values or text from form fields.
 * Order: data-heatmap-label > aria-label > alt > title > visible text > tag.class
 */
export function labelFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const attr = (n: string) => clean(el.getAttribute(n));
  const fromAttrs = attr("data-heatmap-label") || attr("aria-label") || attr("alt") || attr("title");
  if (fromAttrs) return fromAttrs;
  if (FORM_FIELDS.test(tag) || (el as HTMLElement).isContentEditable) {
    const type = el.getAttribute("type");
    return clean(`${tag}${type ? `[${type}]` : ""}${el.getAttribute("name") ? ` ${el.getAttribute("name")}` : ""}`);
  }
  const img = el.querySelector && el.querySelector("img[alt]");
  // textContent (no forced layout); skip big containers whose text is meaningless as a label.
  const text = el.childElementCount <= 12 ? clean(el.textContent) : "";
  if (text) return text;
  if (img) return clean(img.getAttribute("alt"));
  const cls = classOf(el).trim().split(/\s+/)[0];
  return cls ? `${tag}.${cls}` : tag;
}

/** "fixed" if the element or an ancestor is position:fixed, else "sticky" if one is sticky, else "". */
export function positionMode(el: Element): "fixed" | "sticky" | "" {
  let node: Element | null = el;
  let mode: "sticky" | "" = "";
  const view = el.ownerDocument.defaultView;
  if (!view) return "";
  while (node && node.tagName !== "BODY" && node.tagName !== "HTML") {
    const pos = view.getComputedStyle(node).position;
    if (pos === "fixed") return "fixed";
    if (pos === "sticky") mode = "sticky";
    node = node.parentElement;
  }
  return mode;
}

/** Does this element look clickable to a shopper? (for dead-click detection) */
export function isInteractive(target: Element, actionable: Element): boolean {
  if (actionable !== target || actionable.matches(ACTIONABLE)) return true;
  if (target.hasAttribute("onclick") || target.hasAttribute("tabindex")) return true;
  const view = target.ownerDocument.defaultView;
  return !!view && view.getComputedStyle(target).cursor === "pointer";
}
