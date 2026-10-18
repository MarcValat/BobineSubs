import type { Page } from "@playwright/test";

/** What's wrong with the page as drawn now, by kind (the redesign's rules):
 * - an icon off its button's center, or on a half pixel;
 * - a control of a fractional height (they're whole pixels: 34, 24, 20...);
 *   both for controls only (at most CONTROL_MAX px high), not the cards
 *   and drop zones, icon above text and stretched with the window;
 * - a rounded box in a rounded box, evenly inset, not concentric;
 * - text cut without an ellipsis, or reaching out of the window;
 * - buttons side by side of different heights, or controls side by side
 *   off each other's center;
 * - text under 4.5:1 contrast on its background (3:1 when large), over a
 *   gradient against its worst color. */
export function inspect(page: Page): Promise<[string, string][]> {
  return page.evaluate((CONTROL_MAX) => {
    const out: [string, string][] = [];
    const visible = (e: Element) =>
      e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden" && +getComputedStyle(e).opacity !== 0;
    const name = (e: Element) =>
      (e.getAttribute("aria-label") || e.textContent?.trim() || e.getAttribute("class") || e.tagName).replace(/\s+/g, " ").slice(0, 40);
    const px = (v: string) => parseFloat(v) || 0;

    for (const svg of document.querySelectorAll("button svg, .info-tip svg")) {
      if (!visible(svg)) continue;
      const b = svg.closest("button, .info-tip")!;
      const br = b.getBoundingClientRect();
      if (br.height > CONTROL_MAX) continue;
      const sr = svg.getBoundingClientRect();
      const iconOnly = !b.textContent?.trim();
      const dy = sr.top + sr.height / 2 - (br.top + br.height / 2);
      const dx = sr.left + sr.width / 2 - (br.left + br.width / 2);
      if (Math.abs(dy) > 0.51 || (iconOnly && Math.abs(dx) > 0.51))
        out.push(["icon off-center", `${name(b)} dx ${dx.toFixed(1)} dy ${dy.toFixed(1)}`]);
      if (iconOnly && (Math.abs((sr.left - br.left) % 1) > 0.01 || Math.abs((sr.top - br.top) % 1) > 0.01))
        out.push(["icon on a half pixel", `${name(b)} ${br.width.toFixed(2)}x${br.height.toFixed(2)}`]);
    }

    for (const b of document.querySelectorAll("button, input, .dropdown-button, .pill-switch, .list-badge, .engine-status")) {
      if (!visible(b)) continue;
      const r = b.getBoundingClientRect();
      if (r.height <= CONTROL_MAX && Math.abs(r.height - Math.round(r.height)) > 0.01)
        out.push(["fractional height", `${name(b)} ${r.height.toFixed(2)}`]);
    }

    for (const c of document.querySelectorAll("*")) {
      const p = c.parentElement;
      if (!p || !visible(c)) continue;
      const r = px(getComputedStyle(c).borderTopLeftRadius);
      const R = px(getComputedStyle(p).borderTopLeftRadius);
      if (!r || !R || r >= 900 || R >= 900) continue;
      const cr = c.getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      const bw = px(getComputedStyle(p).borderTopWidth);
      const insets = [cr.left - pr.left - bw, cr.top - pr.top - bw, pr.right - cr.right - bw, pr.bottom - cr.bottom - bw];
      if (Math.max(...insets) > 12 || Math.min(...insets) < -0.5) continue; // not a frame in a frame
      if (Math.max(...insets) - Math.min(...insets) >= 0.6) continue;
      const want = Math.max(0, R - bw - insets[0]);
      if (Math.abs(r - want) > 0.6)
        out.push(["not concentric", `${c.getAttribute("class")} r ${r} in ${p.getAttribute("class")} -> ${want.toFixed(1)}`]);
    }

    /** Whether `r` goes past a scrolling (or clipping) frame around `e`:
     * scrolled out of view there, not out of the window (Bobine Subs: the
     * detail's body scrolls). */
    const inFrame = (e: Element, r: DOMRect) => {
      for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
        const nr = n.getBoundingClientRect();
        if (r.bottom > nr.bottom + 0.5 || r.right > nr.right + 0.5) return true;
      }
      return false;
    };

    for (const e of document.querySelectorAll("body *")) {
      if (!visible(e) || e.closest("svg") || !e.textContent?.trim()) continue;
      const cs = getComputedStyle(e);
      if (
        e.scrollWidth > e.clientWidth + 1 &&
        cs.overflowX !== "visible" &&
        cs.textOverflow !== "ellipsis" &&
        !["auto", "scroll"].includes(cs.overflowX)
      )
        out.push(["text cut, no ellipsis", `${e.tagName.toLowerCase()}.${e.getAttribute("class")} "${e.textContent.trim().slice(0, 30)}"`]);
      const r = e.getBoundingClientRect();
      if (
        r.width &&
        (r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) &&
        cs.position !== "fixed" &&
        !e.closest(".dialog-closing") &&
        !inFrame(e, r)
      )
        out.push([
          "outside the window",
          `${e.tagName.toLowerCase()}.${e.getAttribute("class")} right ${r.right.toFixed(0)} bottom ${r.bottom.toFixed(0)}`,
        ]);
    }

    /** A control among its siblings: a button (a Tooltip's, unwrapped), a
     * dropdown, a text field. */
    const control = (e: Element): Element | null => {
      if (e.classList.contains("tooltip-anchor")) e = e.firstElementChild ?? e;
      if (e.tagName === "BUTTON" || e.classList.contains("dropdown")) return e;
      if (e.tagName === "INPUT" && !["checkbox", "radio", "range"].includes((e as HTMLInputElement).type)) return e;
      return null;
    };
    for (const p of document.querySelectorAll("*")) {
      const cs = [...p.children].map(control).filter((c): c is Element => !!c && visible(c));
      for (let i = 1; i < cs.length; i++) {
        const a = cs[i - 1].getBoundingClientRect();
        const b = cs[i].getBoundingClientRect();
        if (a.height > CONTROL_MAX || b.height > CONTROL_MAX) continue;
        if (a.top >= b.bottom || b.top >= a.bottom) continue; // not on one line (wrapped)
        const dy = b.top + b.height / 2 - (a.top + a.height / 2);
        if (Math.abs(dy) > 0.51)
          out.push(["neighbour controls off each other's center", `${name(cs[i - 1])} vs ${name(cs[i])} dy ${dy.toFixed(1)}`]);
        const button = (e: Element) => e.tagName === "BUTTON" || e.classList.contains("dropdown");
        if (button(cs[i - 1]) && button(cs[i]) && Math.abs(a.height - b.height) > 0.5)
          out.push([
            "neighbour buttons differ in height",
            `${name(cs[i - 1])} ${a.height.toFixed(0)} vs ${name(cs[i])} ${b.height.toFixed(0)}`,
          ]);
      }
    }

    type Rgba = number[];
    /** Every color in a computed style value: rgb(a)() and color(srgb ...). */
    const colors = (value: string): Rgba[] =>
      [...value.matchAll(/(rgba?|color)\(([^)]*)\)/g)].map(([, kind, args]) => {
        const n = (args.match(/-?[\d.]+/g) || []).map(Number);
        return kind === "color" ? [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1] : [n[0], n[1], n[2], n[3] ?? 1];
      });
    const lum = ([r, g, b]: Rgba) =>
      [r, g, b]
        .map((v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const blend = (top: Rgba, bottom: Rgba): Rgba => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1);
    /** The colors text over `e` can stand on: its own background and those
     * under it, a gradient counting as each of its colors. */
    const backgrounds = (e: Element): Rgba[] => {
      const layers: Rgba[][] = [];
      for (let n: Element | null = e; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const layer = [...colors(cs.backgroundImage), ...colors(cs.backgroundColor)].filter((c) => c[3] > 0);
        if (!layer.length) continue;
        layers.push(layer);
        if (layer.every((c) => c[3] >= 1) && cs.backgroundImage === "none") break;
      }
      let under: Rgba[] = [[255, 255, 255, 1]];
      for (const layer of layers.reverse()) under = layer.flatMap((top) => under.map((bottom) => blend(top, bottom))).slice(0, 64);
      return under;
    };
    for (const e of document.querySelectorAll("body *")) {
      if (!visible(e) || e.closest("svg, button:disabled, [disabled], .placeholder")) continue;
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue;
      let opacity = 1;
      for (let n: Element | null = e; n; n = n.parentElement) opacity *= +getComputedStyle(n).opacity;
      if (opacity < 0.99) continue; // fading in or out
      const cs = getComputedStyle(e);
      const [color] = colors(cs.color);
      if (!color) continue;
      const large = px(cs.fontSize) >= 18.66 || (px(cs.fontSize) >= 14 && +cs.fontWeight >= 700);
      const worst = Math.min(
        ...backgrounds(e).map((bg) => {
          const [l1, l2] = [lum(blend(color, bg)), lum(bg)].sort((a, b) => b - a);
          return (l1 + 0.05) / (l2 + 0.05);
        }),
      );
      if (worst < (large ? 3 : 4.5))
        out.push([
          "low contrast",
          `${e.tagName.toLowerCase()}.${e.getAttribute("class")} "${e.textContent?.trim().slice(0, 24)}" ${worst.toFixed(2)}`,
        ]);
    }
    return out;
  }, CONTROL_MAX);
}

/** The tallest control: a list row (58 px). */
const CONTROL_MAX = 60;
