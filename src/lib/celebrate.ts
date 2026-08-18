"use client";

/**
 * Celebration moments for the 3-layer ("nextgen2") theme — the first piece
 * of the engagement layer. A geometric confetti burst plus an optional
 * headline banner, rendered straight into document.body with zero
 * dependencies and cleaned up after itself.
 *
 * Rules of engagement (owner decisions 2026-08-18):
 * - Fires ONLY when the tenant is on the 3-layer theme — callers gate with
 *   useIsNextgen3Layer() so every other theme renders exactly as before.
 * - Reserved for genuine wins (quote won, full shift completed). Never wire
 *   it to routine saves, or the moment stops meaning anything.
 * - Respects prefers-reduced-motion: the banner still shows (it carries the
 *   information), the particle storm does not.
 */

const COLORS = ["#8b6cff", "#ff6fae", "#f4b740", "#3ecf8e", "#4c8dff"];

let styleInjected = false;
function ensureStyles() {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  const s = document.createElement("style");
  s.textContent = `
    .bpm-cf { position: fixed; top: -18px; width: 9px; height: 14px; border-radius: 2px;
      z-index: 9999; pointer-events: none;
      transition: transform 1.9s cubic-bezier(.2,.6,.4,1), opacity 1.9s; }
    .bpm-cheer { position: fixed; left: 50%; top: 18%; transform: translateX(-50%) scale(.92);
      z-index: 10000; pointer-events: none; opacity: 0;
      background: linear-gradient(135deg, #8b6cff, #ff6fae); color: #fff;
      padding: 14px 26px; border-radius: 14px; text-align: center;
      box-shadow: 0 18px 50px rgba(124,92,255,.4);
      font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
      transition: opacity .25s, transform .25s; }
    .bpm-cheer.on { opacity: 1; transform: translateX(-50%) scale(1); }
    .bpm-cheer .t { font-size: 17px; font-weight: 800; letter-spacing: -.01em; }
    .bpm-cheer .s { font-size: 12.5px; font-weight: 500; opacity: .92; margin-top: 3px; }
  `;
  document.head.appendChild(s);
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Rain ~n geometric confetti pieces across the viewport. */
export function confettiBurst(pieces = 60) {
  if (typeof document === "undefined" || reducedMotion()) return;
  ensureStyles();
  const h = window.innerHeight;
  for (let i = 0; i < pieces; i++) {
    const p = document.createElement("span");
    p.className = "bpm-cf";
    p.style.left = `${(i * 37 + Math.floor(Math.random() * 23)) % 100}%`;
    p.style.background = COLORS[i % COLORS.length];
    p.style.transitionDelay = `${(i % 12) * 28}ms`;
    document.body.appendChild(p);
    requestAnimationFrame(() => {
      const drift = (i % 2 ? 1 : -1) * (20 + ((i * 13) % 70));
      const spin = (i % 2 ? 1 : -1) * (160 + ((i * 29) % 340));
      p.style.transform = `translate(${drift}px, ${h + 60}px) rotate(${spin}deg)`;
      p.style.opacity = "0";
    });
    setTimeout(() => p.remove(), 2400);
  }
}

/**
 * Full celebration: confetti + a headline banner that names the win.
 * The banner shows even under reduced motion (it's information, not motion).
 */
export function celebrate(title: string, subtitle?: string) {
  if (typeof document === "undefined") return;
  ensureStyles();
  confettiBurst();
  const b = document.createElement("div");
  b.className = "bpm-cheer";
  const t = document.createElement("div");
  t.className = "t";
  t.textContent = title;
  b.appendChild(t);
  if (subtitle) {
    const s = document.createElement("div");
    s.className = "s";
    s.textContent = subtitle;
    b.appendChild(s);
  }
  document.body.appendChild(b);
  requestAnimationFrame(() => b.classList.add("on"));
  setTimeout(() => {
    b.classList.remove("on");
    setTimeout(() => b.remove(), 300);
  }, 2800);
}
