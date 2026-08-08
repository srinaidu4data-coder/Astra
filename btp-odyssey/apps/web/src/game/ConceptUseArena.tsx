/**
 * Interactive how/when arena on concept cards — modern canvas FX + scenario picks.
 * Teaches WHEN to use and HOW to apply without leaving the Atlas detail view.
 */
import { useEffect, useMemo, useRef, useState } from "react";
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
};

type Mode = "when" | "how" | "trap";

const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: "when", label: "When", blurb: "Pick the right moment" },
  { id: "how", label: "How", blurb: "Sequence the apply" },
  { id: "trap", label: "Trap", blurb: "Reject the misuse" },
];

function pickLines(c: ConceptUseLike, mode: Mode): { prompt: string; options: { id: string; label: string; ok: boolean; why: string }[] } {
  const uc = c.useCases?.[0] || `Reach for ${c.title} when the landscape decision depends on it.`;
  const how = c.howToApply?.[0] || `Apply ${c.title} on the active hop, then verify.`;
  const trap =
    c.commonMistakes?.[0] || `Treating “${c.title}” as optional decoration instead of a control.`;
  const why = c.whyItMatters || "Silent debt becomes customer-facing failure.";

  if (mode === "when") {
    return {
      prompt: `When should you use “${c.title}”?`,
      options: [
        { id: "a", label: uc, ok: true, why: "Correct window — use it here." },
        {
          id: "b",
          label: "Only after production has been broken for weeks",
          ok: false,
          why: "Too late — engage at design / early ops.",
        },
        {
          id: "c",
          label: "Never; it is only a marketing label",
          ok: false,
          why: "Operational design control, not decoration.",
        },
      ],
    };
  }
  if (mode === "how") {
    return {
      prompt: `How do you correctly apply “${c.title}”?`,
      options: [
        { id: "a", label: how, ok: true, why: "Correct procedure." },
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
          why: "Privilege inflation is a trap, not a how-to.",
        },
      ],
    };
  }
  return {
    prompt: `Which is the misuse of “${c.title}” to reject?`,
    options: [
      { id: "a", label: trap, ok: true, why: `Trap named. Risk: ${why.slice(0, 100)}` },
      { id: "b", label: how, ok: false, why: "That is the good path — not the trap." },
      {
        id: "c",
        label: "Document residual risk with owner + date when deferring",
        ok: false,
        why: "Healthy deferral — not a trap.",
      },
    ],
  };
}

function ArenaCanvas({ mode, pulse }: { mode: Mode; pulse: "idle" | "good" | "bad" }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pulseRef = useRef(pulse);
  pulseRef.current = pulse;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let t = 0;
    const ribbons: { phase: number; amp: number; y: number; hue: number }[] = [];
    const sparks: { x: number; y: number; vx: number; vy: number; life: number }[] = [];

    for (let i = 0; i < 5; i++) {
      ribbons.push({
        phase: Math.random() * Math.PI * 2,
        amp: 12 + Math.random() * 18,
        y: 0.25 + i * 0.12,
        hue: 180 + i * 28,
      });
    }

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

    function frame() {
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      t += 0.018;
      const m = modeRef.current;
      const bg =
        m === "when"
          ? ["#04101f", "#0a1a32"]
          : m === "how"
            ? ["#0a1020", "#121a2e"]
            : ["#1a0a12", "#120810"];
      const g = ctx!.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, bg[0]!);
      g.addColorStop(1, bg[1]!);
      ctx!.fillStyle = g;
      ctx!.fillRect(0, 0, w, h);

      // soft vignette
      const vg = ctx!.createRadialGradient(w * 0.5, h * 0.45, 10, w * 0.5, h * 0.5, w * 0.7);
      vg.addColorStop(0, "rgba(56,189,248,0.08)");
      vg.addColorStop(1, "rgba(0,0,0,0.35)");
      ctx!.fillStyle = vg;
      ctx!.fillRect(0, 0, w, h);

      // animated ribbons (modern motion design)
      for (const r of ribbons) {
        ctx!.beginPath();
        for (let x = 0; x <= w; x += 6) {
          const y =
            h * r.y +
            Math.sin(x * 0.02 + t * 1.4 + r.phase) * r.amp +
            Math.sin(x * 0.008 - t + r.phase) * (r.amp * 0.4);
          if (x === 0) ctx!.moveTo(x, y);
          else ctx!.lineTo(x, y);
        }
        ctx!.strokeStyle = `hsla(${r.hue}, 85%, 65%, 0.35)`;
        ctx!.lineWidth = 2;
        ctx!.stroke();
        // glow trail
        ctx!.strokeStyle = `hsla(${r.hue}, 90%, 70%, 0.12)`;
        ctx!.lineWidth = 8;
        ctx!.stroke();
      }

      // orbiting nodes — "decision constellation"
      const cx = w * 0.5;
      const cy = h * 0.48;
      const n = 6;
      for (let i = 0; i < n; i++) {
        const ang = t * 0.6 + (i / n) * Math.PI * 2;
        const rad = Math.min(w, h) * 0.22 + Math.sin(t * 2 + i) * 6;
        const x = cx + Math.cos(ang) * rad;
        const y = cy + Math.sin(ang) * rad * 0.72;
        const next = t * 0.6 + ((i + 1) / n) * Math.PI * 2;
        const x2 = cx + Math.cos(next) * rad;
        const y2 = cy + Math.sin(next) * rad * 0.72;
        ctx!.strokeStyle = "rgba(125,211,252,0.18)";
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(x, y);
        ctx!.lineTo(x2, y2);
        ctx!.stroke();
        const grd = ctx!.createRadialGradient(x, y, 0, x, y, 10);
        grd.addColorStop(0, m === "trap" ? "rgba(251,113,133,0.9)" : "rgba(56,189,248,0.95)");
        grd.addColorStop(1, "rgba(56,189,248,0)");
        ctx!.fillStyle = grd;
        ctx!.beginPath();
        ctx!.arc(x, y, 10, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.fillStyle = "#e0f2fe";
        ctx!.beginPath();
        ctx!.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx!.fill();
      }

      // center pulse
      const pl = pulseRef.current;
      const pulseR = 18 + Math.sin(t * 3) * 4 + (pl === "good" ? 10 : pl === "bad" ? 6 : 0);
      ctx!.strokeStyle =
        pl === "good"
          ? "rgba(52,211,153,0.65)"
          : pl === "bad"
            ? "rgba(248,113,113,0.7)"
            : "rgba(167,139,250,0.45)";
      ctx!.lineWidth = 2;
      ctx!.beginPath();
      ctx!.arc(cx, cy, pulseR, 0, Math.PI * 2);
      ctx!.stroke();
      ctx!.fillStyle = "rgba(15,23,42,0.75)";
      ctx!.beginPath();
      ctx!.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.fillStyle = "#f8fafc";
      ctx!.font = "600 10px ui-sans-serif, system-ui";
      ctx!.textAlign = "center";
      ctx!.textBaseline = "middle";
      ctx!.fillText(m === "when" ? "WHEN" : m === "how" ? "HOW" : "TRAP", cx, cy);

      // sparks on feedback
      if (pl === "good" || pl === "bad") {
        if (sparks.length < 40) {
          for (let i = 0; i < 3; i++) {
            sparks.push({
              x: cx,
              y: cy,
              vx: (Math.random() - 0.5) * 4,
              vy: (Math.random() - 0.5) * 4,
              life: 1,
            });
          }
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.x += s.vx;
        s.y += s.vy;
        s.life -= 0.03;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        ctx!.globalAlpha = s.life;
        ctx!.fillStyle = pl === "bad" ? "#fb7185" : "#34d399";
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.globalAlpha = 1;
      }

      // scanline (subtle modern HUD)
      const scanY = ((t * 40) % (h + 40)) - 20;
      ctx!.fillStyle = "rgba(56,189,248,0.04)";
      ctx!.fillRect(0, scanY, w, 18);

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
  onLaunchFullGame?: (role: "when" | "how" | "trap") => void;
}) {
  const [mode, setMode] = useState<Mode>("when");
  const [picked, setPicked] = useState<string | null>(null);
  const [pulse, setPulse] = useState<"idle" | "good" | "bad">("idle");
  const [streak, setStreak] = useState(0);
  const pack = useMemo(() => pickLines(concept, mode), [concept, mode]);

  function choose(id: string, ok: boolean) {
    setPicked(id);
    setPulse(ok ? "good" : "bad");
    setStreak((s) => (ok ? s + 1 : 0));
    window.setTimeout(() => setPulse("idle"), 900);
  }

  return (
    <section className="use-arena" aria-label="How and when to use this concept">
      <header className="use-arena-head">
        <div>
          <h4 className="use-arena-title">Live use arena</h4>
          <p className="use-arena-sub muted">
            Advanced motion + scenario picks — when, how, and traps for{" "}
            <strong>{concept.title}</strong>
          </p>
        </div>
        {streak > 0 && (
          <span className="use-arena-streak" data-hot={streak >= 3 ? "1" : "0"}>
            Focus ×{streak}
          </span>
        )}
      </header>

      <div className="use-arena-modes" role="tablist" aria-label="Arena mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            className={`use-mode-btn${mode === m.id ? " active" : ""}`}
            onClick={() => {
              setMode(m.id);
              setPicked(null);
              setPulse("idle");
            }}
          >
            <span className="use-mode-label">{m.label}</span>
            <span className="use-mode-blurb">{m.blurb}</span>
          </button>
        ))}
      </div>

      <div className="use-arena-stage">
        <ArenaCanvas mode={mode} pulse={pulse} />
        <div className="use-arena-overlay">
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
              onClick={() => onLaunchFullGame(mode)}
            >
              ▶ Full {mode} game (campaign graphics)
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
