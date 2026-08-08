/**
 * Arcade of how/when games on every concept card.
 * Multiple mini-games with modern canvas FX — playable without leaving Atlas.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./concept-use-arena.css";

export type ConceptUseLike = {
  id: string;
  title: string;
  summary?: string;
  whyItMatters?: string;
  howToApply?: string[];
  useCases?: string[];
  commonMistakes?: string[];
  domainId?: string;
  designTradeoffs?: {
    axis?: string;
    optionA?: string;
    optionB?: string;
    whenChooseA?: string;
    whenChooseB?: string;
    risk?: string;
  }[];
};

type ArcadeId = "radar" | "pipeline" | "blast" | "theater" | "scales" | "pulse";

const ARCADES: {
  id: ArcadeId;
  label: string;
  blurb: string;
  teach: "when" | "how" | "trap" | "scenario" | "compare";
  emoji: string;
}[] = [
  { id: "radar", label: "Timing Radar", blurb: "When to engage", teach: "when", emoji: "⏱" },
  { id: "pipeline", label: "How Pipeline", blurb: "Order the apply", teach: "how", emoji: "⚙" },
  { id: "blast", label: "Blast Arena", blurb: "Reject misuse", teach: "trap", emoji: "⚠" },
  { id: "theater", label: "Scene Theater", blurb: "Story trigger", teach: "scenario", emoji: "🎬" },
  { id: "scales", label: "Trade Scales", blurb: "This vs defer", teach: "compare", emoji: "⚖" },
  { id: "pulse", label: "Signal Pulse", blurb: "Spot the signal", teach: "when", emoji: "◈" },
];

type QPack = {
  prompt: string;
  options: { id: string; label: string; ok: boolean; why: string }[];
};

function buildPack(c: ConceptUseLike, arcade: ArcadeId): QPack {
  const uc = c.useCases?.[0] || `Use ${c.title} when the landscape decision depends on it.`;
  const uc1 = c.useCases?.[1] || `Incident bridge: classify with ${c.title} before changing config.`;
  const how = c.howToApply?.[0] || `Apply ${c.title} on the active hop, then verify.`;
  const how1 = c.howToApply?.[1] || `Document owner and negative-test the control for ${c.title}.`;
  const trap =
    c.commonMistakes?.[0] || `Treating “${c.title}” as optional decoration instead of a control.`;
  const why = c.whyItMatters || "Silent debt becomes customer-facing failure.";
  const t0 = c.designTradeoffs?.[0];
  const chooseA = t0?.whenChooseA || `Choose ${c.title} when risk/impact is material.`;
  const chooseB =
    t0?.whenChooseB || `Defer ${c.title} only with residual risk, owner, and date.`;

  switch (arcade) {
    case "radar":
      return {
        prompt: `Timing Radar: when do you lock in “${c.title}”?`,
        options: [
          { id: "a", label: uc, ok: true, why: "Correct engagement window." },
          {
            id: "b",
            label: "Only after production has been broken for weeks",
            ok: false,
            why: "Too late — design-time / early ops is cheaper.",
          },
          {
            id: "c",
            label: "Every stand-up, even with zero risk signal",
            ok: false,
            why: "Cargo-cult timing burns capacity.",
          },
        ],
      };
    case "pipeline":
      return {
        prompt: `How Pipeline: first correct move for “${c.title}”?`,
        options: [
          { id: "a", label: how, ok: true, why: "Correct first apply step." },
          {
            id: "b",
            label: "Skip verify and ship with no owner",
            ok: false,
            why: "How without evidence is incomplete.",
          },
          {
            id: "c",
            label: "Grant Admin.All so you never need the control",
            ok: false,
            why: "Privilege inflation is a trap.",
          },
        ],
      };
    case "blast":
      return {
        prompt: `Blast Arena: which misuse of “${c.title}” do you reject?`,
        options: [
          { id: "a", label: trap, ok: true, why: `Trap named. Risk: ${why.slice(0, 90)}` },
          { id: "b", label: how, ok: false, why: "That is the good path." },
          {
            id: "c",
            label: "Document residual risk with owner + date when deferring",
            ok: false,
            why: "Healthy deferral — not a trap.",
          },
        ],
      };
    case "theater":
      return {
        prompt: `Scene: ${uc1.slice(0, 100)}… How do you act?`,
        options: [
          { id: "a", label: how1, ok: true, why: "Correct scene action." },
          {
            id: "b",
            label: "Ignore the hub and only update slides",
            ok: false,
            why: "Slides without landscape change fail under review.",
          },
          {
            id: "c",
            label: "Disable monitoring so the story looks green",
            ok: false,
            why: "Hiding signals is a trap.",
          },
        ],
      };
    case "scales":
      return {
        prompt: `Trade Scales: when choose “${c.title}” vs defer?`,
        options: [
          { id: "a", label: String(chooseA).slice(0, 160), ok: true, why: "Correct choose-A window." },
          {
            id: "b",
            label: "Always pick the newest brand name regardless of fit",
            ok: false,
            why: "Brand ≠ fit.",
          },
          {
            id: "c",
            label: "Never choose it — complexity is always wrong",
            ok: false,
            why: "Under-engineering is also risk. Defer only with discipline: " + String(chooseB).slice(0, 60),
          },
        ],
      };
    case "pulse":
    default:
      return {
        prompt: `Signal Pulse: which signal means you need “${c.title}” now?`,
        options: [
          { id: "a", label: uc, ok: true, why: "Signal matched — engage." },
          {
            id: "b",
            label: "A green dashboard with no customer impact and no design decision",
            ok: false,
            why: "No signal — don't invent work.",
          },
          {
            id: "c",
            label: "Someone said the buzzword in a meeting once",
            ok: false,
            why: "Name ≠ signal. Need trigger + risk.",
          },
        ],
      };
  }
}

const ARCADE_PALETTE: Record<
  ArcadeId,
  { a: string; b: string; accent: string; glow: string }
> = {
  radar: { a: "#020617", b: "#0c4a6e", accent: "#38bdf8", glow: "#22d3ee" },
  pipeline: { a: "#0f172a", b: "#1e1b4b", accent: "#a78bfa", glow: "#c4b5fd" },
  blast: { a: "#1c0a0a", b: "#450a0a", accent: "#fb7185", glow: "#f43f5e" },
  theater: { a: "#1a0a14", b: "#3b0764", accent: "#f472b6", glow: "#e879f9" },
  scales: { a: "#052e16", b: "#0c1f1a", accent: "#34d399", glow: "#fbbf24" },
  pulse: { a: "#020617", b: "#164e63", accent: "#67e8f9", glow: "#a5f3fc" },
};

function ArcadeCanvas({
  arcade,
  pulse,
  score,
}: {
  arcade: ArcadeId;
  pulse: "idle" | "good" | "bad";
  score: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pulseRef = useRef(pulse);
  const arcadeRef = useRef(arcade);
  const scoreRef = useRef(score);
  pulseRef.current = pulse;
  arcadeRef.current = arcade;
  scoreRef.current = score;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let t = 0;
    const particles: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      life: number;
      hue: number;
    }[] = [];
    const bolts: { x1: number; y1: number; x2: number; y2: number; life: number }[] = [];

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - 0.5) * 0.08,
        vy: (Math.random() - 0.5) * 0.08,
        r: 0.6 + Math.random() * 2.4,
        life: Math.random() * Math.PI * 2,
        hue: 180 + Math.random() * 80,
      });
    }

    function frame() {
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      t += 0.0165;
      const id = arcadeRef.current;
      const pal = ARCADE_PALETTE[id];
      const g = ctx!.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, pal.a);
      g.addColorStop(1, pal.b);
      ctx!.fillStyle = g;
      ctx!.fillRect(0, 0, w, h);

      // hex grid
      ctx!.strokeStyle = "rgba(255,255,255,0.04)";
      ctx!.lineWidth = 1;
      const hex = 28;
      for (let y = 0; y < h + hex; y += hex * 0.75) {
        for (let x = 0; x < w + hex; x += hex) {
          const ox = (Math.floor(y / (hex * 0.75)) % 2) * (hex * 0.5);
          ctx!.strokeRect(x + ox, y, hex * 0.9, hex * 0.6);
        }
      }

      // arcade-specific layers
      if (id === "radar") {
        const cx = w * 0.5;
        const cy = h * 0.42;
        for (let r = 20; r < Math.min(w, h) * 0.35; r += 22) {
          ctx!.beginPath();
          ctx!.arc(cx, cy, r + Math.sin(t + r) * 2, 0, Math.PI * 2);
          ctx!.strokeStyle = `rgba(56,189,248,${0.08 + (r % 40) * 0.002})`;
          ctx!.stroke();
        }
        const sweep = t * 1.8;
        ctx!.save();
        ctx!.translate(cx, cy);
        ctx!.rotate(sweep);
        const sg = ctx!.createLinearGradient(0, 0, Math.min(w, h) * 0.32, 0);
        sg.addColorStop(0, "rgba(34,211,238,0.45)");
        sg.addColorStop(1, "transparent");
        ctx!.fillStyle = sg;
        ctx!.beginPath();
        ctx!.moveTo(0, 0);
        ctx!.arc(0, 0, Math.min(w, h) * 0.32, -0.35, 0.05);
        ctx!.closePath();
        ctx!.fill();
        ctx!.restore();
        // blips
        for (let i = 0; i < 5; i++) {
          const ang = t * 0.5 + i * 1.2;
          const rr = 40 + (i * 18) % 70;
          const bx = cx + Math.cos(ang) * rr;
          const by = cy + Math.sin(ang) * rr * 0.7;
          ctx!.fillStyle = pal.glow;
          ctx!.globalAlpha = 0.4 + 0.5 * Math.sin(t * 4 + i);
          ctx!.beginPath();
          ctx!.arc(bx, by, 3.5, 0, Math.PI * 2);
          ctx!.fill();
          ctx!.globalAlpha = 1;
        }
      } else if (id === "pipeline") {
        const y = h * 0.4;
        const nodes = 5;
        for (let i = 0; i < nodes; i++) {
          const x = w * (0.12 + i * 0.19);
          const pulse = 1 + Math.sin(t * 3 + i) * 0.08;
          if (i < nodes - 1) {
            const x2 = w * (0.12 + (i + 1) * 0.19);
            ctx!.strokeStyle = "rgba(167,139,250,0.35)";
            ctx!.lineWidth = 3;
            ctx!.beginPath();
            ctx!.moveTo(x + 14, y);
            ctx!.lineTo(x2 - 14, y);
            ctx!.stroke();
            // data packet
            const px = x + ((x2 - x) * ((t * 0.4 + i * 0.2) % 1));
            ctx!.fillStyle = pal.glow;
            ctx!.beginPath();
            ctx!.arc(px, y + Math.sin(t * 6 + i) * 4, 4, 0, Math.PI * 2);
            ctx!.fill();
          }
          const rg = ctx!.createRadialGradient(x, y, 0, x, y, 22 * pulse);
          rg.addColorStop(0, "rgba(167,139,250,0.55)");
          rg.addColorStop(1, "transparent");
          ctx!.fillStyle = rg;
          ctx!.beginPath();
          ctx!.arc(x, y, 22 * pulse, 0, Math.PI * 2);
          ctx!.fill();
          ctx!.fillStyle = "#e2e8f0";
          ctx!.beginPath();
          ctx!.arc(x, y, 7, 0, Math.PI * 2);
          ctx!.fill();
        }
      } else if (id === "blast") {
        const cx = w * 0.5;
        const cy = h * 0.4;
        for (let i = 0; i < 3; i++) {
          const r = 30 + i * 28 + (t * 40 + i * 20) % 50;
          ctx!.strokeStyle = `rgba(251,113,133,${0.35 - i * 0.08})`;
          ctx!.lineWidth = 2;
          ctx!.beginPath();
          ctx!.arc(cx, cy, r, 0, Math.PI * 2);
          ctx!.stroke();
        }
        // shards
        for (let i = 0; i < 12; i++) {
          const ang = t + i * 0.5;
          const r = 20 + (i % 5) * 15;
          ctx!.strokeStyle = "rgba(251,113,133,0.4)";
          ctx!.beginPath();
          ctx!.moveTo(cx, cy);
          ctx!.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
          ctx!.stroke();
        }
      } else if (id === "theater") {
        const bar = 16 + Math.sin(t * 2) * 2;
        ctx!.fillStyle = "rgba(0,0,0,0.55)";
        ctx!.fillRect(0, 0, w, bar);
        ctx!.fillRect(0, h - bar, w, bar);
        // spotlight
        const lx = w * (0.35 + Math.sin(t) * 0.08);
        const ly = h * 0.35;
        const spot = ctx!.createRadialGradient(lx, ly, 10, lx, ly, 90);
        spot.addColorStop(0, "rgba(244,114,182,0.35)");
        spot.addColorStop(1, "transparent");
        ctx!.fillStyle = spot;
        ctx!.beginPath();
        ctx!.arc(lx, ly, 90, 0, Math.PI * 2);
        ctx!.fill();
        // stage platform
        ctx!.fillStyle = "rgba(167,139,250,0.15)";
        ctx!.beginPath();
        ctx!.ellipse(w * 0.5, h * 0.55, w * 0.28, 18, 0, 0, Math.PI * 2);
        ctx!.fill();
      } else if (id === "scales") {
        const cx = w * 0.5;
        const cy = h * 0.32;
        const tilt = Math.sin(t * 1.2) * 0.25;
        ctx!.strokeStyle = "rgba(52,211,153,0.5)";
        ctx!.lineWidth = 3;
        ctx!.beginPath();
        ctx!.moveTo(cx, cy - 10);
        ctx!.lineTo(cx, cy + 50);
        ctx!.stroke();
        ctx!.save();
        ctx!.translate(cx, cy);
        ctx!.rotate(tilt);
        ctx!.beginPath();
        ctx!.moveTo(-70, 0);
        ctx!.lineTo(70, 0);
        ctx!.stroke();
        for (const side of [-1, 1]) {
          const px = side * 60;
          ctx!.strokeStyle = side < 0 ? pal.accent : pal.glow;
          ctx!.beginPath();
          ctx!.moveTo(px, 0);
          ctx!.lineTo(px, 28);
          ctx!.stroke();
          ctx!.fillStyle = side < 0 ? "rgba(52,211,153,0.35)" : "rgba(251,191,36,0.35)";
          ctx!.fillRect(px - 18, 28, 36, 14);
        }
        ctx!.restore();
      } else if (id === "pulse") {
        const cy = h * 0.4;
        ctx!.strokeStyle = "rgba(103,232,249,0.45)";
        ctx!.lineWidth = 2;
        ctx!.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const y =
            cy +
            Math.sin(x * 0.04 + t * 4) * 18 * (0.4 + 0.6 * Math.sin(t + x * 0.01)) +
            Math.sin(x * 0.1 - t * 2) * 6;
          if (x === 0) ctx!.moveTo(x, y);
          else ctx!.lineTo(x, y);
        }
        ctx!.stroke();
        // ECG peaks
        for (let i = 0; i < 3; i++) {
          const px = ((t * 80 + i * 120) % (w + 40)) - 20;
          ctx!.fillStyle = pal.glow;
          ctx!.globalAlpha = 0.7;
          ctx!.beginPath();
          ctx!.arc(px, cy - 20, 5, 0, Math.PI * 2);
          ctx!.fill();
          ctx!.globalAlpha = 1;
        }
      }

      // ribbons
      for (let i = 0; i < 3; i++) {
        ctx!.beginPath();
        for (let x = 0; x <= w; x += 6) {
          const y =
            h * (0.72 + i * 0.06) +
            Math.sin(x * 0.02 + t * 1.5 + i) * (10 + i * 4);
          if (x === 0) ctx!.moveTo(x, y);
          else ctx!.lineTo(x, y);
        }
        ctx!.strokeStyle = pal.accent;
        ctx!.globalAlpha = 0.12;
        ctx!.lineWidth = 2 + i;
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;

      // particles
      for (const p of particles) {
        p.x += p.vx * 0.016;
        p.y += p.vy * 0.016;
        p.life += 0.04;
        if (p.x < 0 || p.x > 1) p.vx *= -1;
        if (p.y < 0 || p.y > 1) p.vy *= -1;
        ctx!.beginPath();
        ctx!.fillStyle = pal.glow;
        ctx!.globalAlpha = 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(p.life));
        ctx!.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;

      // feedback ring
      const pl = pulseRef.current;
      if (pl !== "idle") {
        const cx = w * 0.5;
        const cy = h * 0.42;
        const rr = 40 + (1 - Math.min(1, (t * 3) % 1)) * 50;
        ctx!.strokeStyle = pl === "good" ? "rgba(52,211,153,0.7)" : "rgba(248,113,113,0.75)";
        ctx!.lineWidth = 3;
        ctx!.beginPath();
        ctx!.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx!.stroke();
        if (bolts.length < 8 && Math.random() > 0.7) {
          bolts.push({
            x1: cx,
            y1: cy,
            x2: cx + (Math.random() - 0.5) * 120,
            y2: cy + (Math.random() - 0.5) * 80,
            life: 1,
          });
        }
      }
      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i]!;
        b.life -= 0.05;
        if (b.life <= 0) {
          bolts.splice(i, 1);
          continue;
        }
        ctx!.globalAlpha = b.life;
        ctx!.strokeStyle = pl === "bad" ? "#fb7185" : "#34d399";
        ctx!.lineWidth = 2;
        ctx!.beginPath();
        ctx!.moveTo(b.x1, b.y1);
        ctx!.lineTo(b.x2, b.y2);
        ctx!.stroke();
        ctx!.globalAlpha = 1;
      }

      // score pips
      const sc = scoreRef.current;
      for (let i = 0; i < Math.min(sc, 8); i++) {
        ctx!.fillStyle = pal.glow;
        ctx!.globalAlpha = 0.8;
        ctx!.beginPath();
        ctx!.arc(16 + i * 14, h - 14, 4, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;

      // scanline
      const scanY = ((t * 50) % (h + 30)) - 15;
      ctx!.fillStyle = "rgba(255,255,255,0.03)";
      ctx!.fillRect(0, scanY, w, 14);

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="use-arena-canvas" aria-hidden />;
}

export function ConceptUseArena({
  concept,
  onLaunchFullGame,
}: {
  concept: ConceptUseLike;
  onLaunchFullGame?: (
    role: "when" | "how" | "trap" | "scenario" | "compare" | "intro" | "mastery",
  ) => void;
}) {
  const [arcade, setArcade] = useState<ArcadeId>("radar");
  const [picked, setPicked] = useState<string | null>(null);
  const [pulse, setPulse] = useState<"idle" | "good" | "bad">("idle");
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [cleared, setCleared] = useState<Set<ArcadeId>>(() => new Set());
  const pack = useMemo(() => buildPack(concept, arcade), [concept, arcade]);
  const meta = ARCADES.find((a) => a.id === arcade)!;

  const choose = useCallback(
    (id: string, ok: boolean) => {
      setPicked(id);
      setPulse(ok ? "good" : "bad");
      if (ok) {
        setScore((s) => s + 1);
        setCombo((c) => c + 1);
        setCleared((prev) => new Set(prev).add(arcade));
      } else {
        setCombo(0);
      }
      window.setTimeout(() => setPulse("idle"), 1000);
    },
    [arcade],
  );

  return (
    <section className="use-arena" aria-label="How and when games for this concept">
      <header className="use-arena-head">
        <div>
          <h4 className="use-arena-title">How & when arcade</h4>
          <p className="use-arena-sub muted">
            Six modern mini-games for <strong>{concept.title}</strong> — timing, procedure,
            traps, scenes, and trade-offs. Advanced motion · instant feedback.
          </p>
        </div>
        <div className="use-arena-stats">
          {combo > 0 && (
            <span className="use-arena-streak" data-hot={combo >= 3 ? "1" : "0"}>
              Focus ×{combo}
            </span>
          )}
          <span className="use-arena-score">{score} clears</span>
        </div>
      </header>

      <div className="use-arcade-tabs" role="tablist" aria-label="Mini games">
        {ARCADES.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={arcade === a.id}
            className={`use-arcade-tab${arcade === a.id ? " active" : ""}${cleared.has(a.id) ? " cleared" : ""}`}
            onClick={() => {
              setArcade(a.id);
              setPicked(null);
              setPulse("idle");
            }}
          >
            <span className="tab-emoji">{a.emoji}</span>
            <span className="tab-label">{a.label}</span>
            <span className="tab-blurb">{a.blurb}</span>
            {cleared.has(a.id) && <span className="tab-check">✓</span>}
          </button>
        ))}
      </div>

      <div className="use-arena-stage use-arena-stage-tall">
        <ArcadeCanvas arcade={arcade} pulse={pulse} score={score} />
        <div className="use-arena-overlay">
          <div className="use-arena-badge">{meta.emoji} {meta.label}</div>
          <p className="use-arena-prompt">{pack.prompt}</p>
          <div className="use-arena-options">
            {pack.options.map((o) => {
              const state =
                picked === o.id ? (o.ok ? "good" : "bad") : picked && o.ok ? "reveal" : "";
              return (
                <button
                  key={o.id}
                  type="button"
                  className={`use-opt ${state}`}
                  onClick={() => choose(o.id, o.ok)}
                >
                  <span className="use-opt-label">{o.label}</span>
                  {picked === o.id && <span className="use-opt-why">{o.why}</span>}
                </button>
              );
            })}
          </div>
          {onLaunchFullGame && (
            <button
              type="button"
              className="btn primary use-arena-launch"
              onClick={() => onLaunchFullGame(meta.teach)}
            >
              ▶ Full campaign: {meta.teach} game
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
