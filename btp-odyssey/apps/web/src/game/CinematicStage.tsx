/**
 * Max-animation challenge stage backdrops.
 * Biomes: war · chess · farm · roblox · neural · space · market · film
 * Inspired by film craft (camera, light, cut), game feel (juice), and motion design.
 */
import { useEffect, useRef } from "react";

export type Biome =
  | "war"
  | "chess"
  | "farm"
  | "roblox"
  | "neural"
  | "space"
  | "market"
  | "film"
  | "default";

const BIOME_PALETTE: Record<
  Biome,
  { bg: [string, string]; accent: string; particle: string; secondary: string }
> = {
  war: {
    bg: ["#1a0a0a", "#0a1220"],
    accent: "#fb7185",
    particle: "#fbbf24",
    secondary: "#ef4444",
  },
  chess: {
    bg: ["#12141c", "#0c0e14"],
    accent: "#e2e8f0",
    particle: "#94a3b8",
    secondary: "#64748b",
  },
  farm: {
    bg: ["#0c1a10", "#142218"],
    accent: "#4ade80",
    particle: "#86efac",
    secondary: "#fbbf24",
  },
  roblox: {
    bg: ["#0b1224", "#1e1b4b"],
    accent: "#f97316",
    particle: "#38bdf8",
    secondary: "#a78bfa",
  },
  neural: {
    bg: ["#0f0720", "#12081f"],
    accent: "#c4b5fd",
    particle: "#a78bfa",
    secondary: "#22d3ee",
  },
  space: {
    bg: ["#020617", "#0b1026"],
    accent: "#38bdf8",
    particle: "#e0f2fe",
    secondary: "#818cf8",
  },
  market: {
    bg: ["#0a1628", "#0c1f1a"],
    accent: "#34d399",
    particle: "#fbbf24",
    secondary: "#22d3ee",
  },
  film: {
    bg: ["#140a12", "#1a1020"],
    accent: "#f472b6",
    particle: "#fda4af",
    secondary: "#c4b5fd",
  },
  default: {
    bg: ["#0a1228", "#050814"],
    accent: "#38bdf8",
    particle: "#7dd3fc",
    secondary: "#a78bfa",
  },
};

export function CinematicBackdrop({
  biome = "default",
  intensity = 1,
  pulse = "idle" as "idle" | "good" | "bad" | "unlock",
}: {
  biome?: string;
  intensity?: number;
  pulse?: "idle" | "good" | "bad" | "unlock";
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pulseRef = useRef(pulse);
  pulseRef.current = pulse;
  const b = (BIOME_PALETTE[biome as Biome] ?? BIOME_PALETTE.default)!;

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
      a: number;
      life: number;
    }[] = [];

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

    for (let i = 0; i < 48 * intensity; i++) {
      particles.push({
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - 0.5) * 0.04,
        vy: (Math.random() - 0.5) * 0.04,
        r: 0.8 + Math.random() * 2.2,
        a: 0.15 + Math.random() * 0.5,
        life: Math.random(),
      });
    }

    function frame() {
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      t += 0.016;
      const g = ctx!.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, b.bg[0]);
      g.addColorStop(1, b.bg[1]);
      ctx!.fillStyle = g;
      ctx!.fillRect(0, 0, w, h);

      // biome-specific layers
      if (biome === "chess") {
        const cell = Math.max(28, Math.min(w, h) / 10);
        for (let y = 0; y < h / cell + 1; y++) {
          for (let x = 0; x < w / cell + 1; x++) {
            if ((x + y) % 2 === 0) {
              ctx!.fillStyle = "rgba(255,255,255,0.03)";
              ctx!.fillRect(x * cell, y * cell, cell, cell);
            }
          }
        }
      } else if (biome === "farm") {
        ctx!.strokeStyle = "rgba(74,222,128,0.08)";
        ctx!.lineWidth = 1;
        for (let y = 0; y < h; y += 36) {
          ctx!.beginPath();
          ctx!.moveTo(0, y + Math.sin(t + y * 0.02) * 3);
          ctx!.lineTo(w, y + Math.sin(t + y * 0.02) * 3);
          ctx!.stroke();
        }
      } else if (biome === "neural") {
        ctx!.strokeStyle = "rgba(167,139,250,0.12)";
        for (let i = 0; i < 12; i++) {
          const x1 = (Math.sin(t * 0.4 + i) * 0.5 + 0.5) * w;
          const y1 = (Math.cos(t * 0.3 + i * 0.7) * 0.5 + 0.5) * h;
          const x2 = (Math.sin(t * 0.5 + i + 2) * 0.5 + 0.5) * w;
          const y2 = (Math.cos(t * 0.35 + i * 1.1) * 0.5 + 0.5) * h;
          ctx!.beginPath();
          ctx!.moveTo(x1, y1);
          ctx!.lineTo(x2, y2);
          ctx!.stroke();
        }
      } else if (biome === "space") {
        for (let i = 0; i < 40; i++) {
          const sx = ((i * 97) % w) + Math.sin(t + i) * 2;
          const sy = ((i * 53) % h) + Math.cos(t * 0.7 + i) * 2;
          ctx!.fillStyle = `rgba(224,242,254,${0.2 + (i % 5) * 0.1})`;
          ctx!.fillRect(sx, sy, 1.5, 1.5);
        }
      } else if (biome === "war") {
        ctx!.strokeStyle = "rgba(251,113,133,0.08)";
        ctx!.setLineDash([6, 10]);
        for (let i = 0; i < 5; i++) {
          const y = h * (0.2 + i * 0.15) + Math.sin(t + i) * 4;
          ctx!.beginPath();
          ctx!.moveTo(0, y);
          ctx!.lineTo(w, y);
          ctx!.stroke();
        }
        ctx!.setLineDash([]);
      } else if (biome === "roblox") {
        const s = 40;
        for (let y = 0; y < h; y += s) {
          for (let x = 0; x < w; x += s) {
            ctx!.strokeStyle = "rgba(249,115,22,0.06)";
            ctx!.strokeRect(x + 2, y + 2, s - 4, s - 4);
          }
        }
      } else if (biome === "film") {
        // letterbox bars pulse
        const bar = 18 + Math.sin(t) * 2;
        ctx!.fillStyle = "rgba(0,0,0,0.45)";
        ctx!.fillRect(0, 0, w, bar);
        ctx!.fillRect(0, h - bar, w, bar);
      } else if (biome === "market") {
        ctx!.strokeStyle = "rgba(52,211,153,0.12)";
        ctx!.beginPath();
        for (let x = 0; x < w; x += 4) {
          const y = h * 0.55 + Math.sin(x * 0.03 + t * 2) * 28 + Math.sin(x * 0.01 - t) * 12;
          if (x === 0) ctx!.moveTo(x, y);
          else ctx!.lineTo(x, y);
        }
        ctx!.stroke();
      }

      // ambient particles
      for (const p of particles) {
        p.x += p.vx * 0.016;
        p.y += p.vy * 0.016;
        p.life += 0.016;
        if (p.x < 0 || p.x > 1) p.vx *= -1;
        if (p.y < 0 || p.y > 1) p.vy *= -1;
        ctx!.beginPath();
        ctx!.fillStyle = b.particle;
        ctx!.globalAlpha = p.a * (0.5 + 0.5 * Math.sin(p.life * 3));
        ctx!.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;

      // pulse rings
      const pl = pulseRef.current;
      if (pl !== "idle") {
        const col =
          pl === "good" || pl === "unlock" ? "#34d399" : pl === "bad" ? "#fb7185" : b.accent;
        const phase = (t * 2) % 1.5;
        ctx!.strokeStyle = col;
        ctx!.globalAlpha = Math.max(0, 1 - phase / 1.5) * 0.55;
        ctx!.lineWidth = 3;
        ctx!.beginPath();
        ctx!.arc(w / 2, h / 2, 40 + phase * Math.min(w, h) * 0.35, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.globalAlpha = 1;
      }

      // vignette
      const vg = ctx!.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.7);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx!.fillStyle = vg;
      ctx!.fillRect(0, 0, w, h);

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [biome, intensity, b]);

  return <canvas ref={ref} className="cinematic-canvas" aria-hidden />;
}

/** Animated concept teach strip — film frames + formula chip */
export function ConceptCinema({
  teach,
  formula,
  cinema,
  stepTitle,
}: {
  teach: string;
  formula?: string;
  cinema?: string;
  stepTitle: string;
}) {
  return (
    <div className={`concept-cinema cinema-${cinema || "default"}`} data-cinema={cinema || "default"}>
      <div className="cc-reels" aria-hidden>
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="cc-kicker">Concept beat · animated teach</div>
      <h4 className="cc-title">{stepTitle}</h4>
      <p className="cc-body">{teach}</p>
      {formula && (
        <div className="cc-formula" title="Cross-domain formula">
          <span>ƒ</span> {formula}
        </div>
      )}
      <div className="cc-scanline" aria-hidden />
    </div>
  );
}

/** Floating juice number / badge */
export function JuiceBurst({
  kind,
  text,
}: {
  kind: "good" | "bad" | "unlock" | "hint";
  text: string;
}) {
  return (
    <div className={`juice-burst juice-${kind}`} role="status">
      {text}
    </div>
  );
}
