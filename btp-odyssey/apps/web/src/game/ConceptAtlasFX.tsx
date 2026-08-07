/**
 * Concept Atlas visuals — senior game UX + learning psychology.
 *
 * Design rules:
 * - Attention is scarce: idle cards are calm identity art; juice only on hover/focus/open
 * - Reading needs quiet: detail cinema peaks on open, then settles (peak-end + cognitive load)
 * - Performance is UX: no 150 full-FPS canvases; animate only live cards
 * - Identity without noise: domain color + motif DNA, readable title hierarchy
 * - Autonomy: motion intensity (calm / live / cinema) via data attribute on document
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { drawTeachScene, resolveTeachLesson, type TeachLesson } from "./conceptTeachEngine";
import "./concept-atlas-fx.css";

export { resolveTeachLesson } from "./conceptTeachEngine";
export type { TeachLesson } from "./conceptTeachEngine";

export type ConceptArtInput = {
  id: string;
  title: string;
  domainId: string;
  level?: string;
  summary?: string;
  tags?: string[];
};

export type MotionIntensity = "calm" | "live" | "cinema";

type Theme = {
  key: string;
  label: string;
  bg0: string;
  bg1: string;
  accent: string;
  accent2: string;
  glow: string;
  motif: Motif;
};

type Motif =
  | "shield"
  | "neural"
  | "nodes"
  | "waves"
  | "hex"
  | "orbit"
  | "grid"
  | "flame"
  | "crystal"
  | "flow"
  | "dna"
  | "radar"
  | "sparklines"
  | "blocks"
  | "stars";

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function domainTheme(domainId: string): Partial<Theme> {
  const d = (domainId || "").toLowerCase();
  if (d.includes("sec") || d.includes("auth") || d.includes("iam"))
    return {
      key: "security",
      label: "Security",
      bg0: "#14060c",
      bg1: "#1a0a18",
      accent: "#fb7185",
      accent2: "#fbbf24",
      glow: "rgba(251,113,133,0.35)",
      motif: "shield",
    };
  if (d.includes("ai") || d.includes("joule") || d.includes("ml"))
    return {
      key: "ai",
      label: "AI",
      bg0: "#0c0618",
      bg1: "#140a28",
      accent: "#c4b5fd",
      accent2: "#22d3ee",
      glow: "rgba(167,139,250,0.35)",
      motif: "neural",
    };
  if (d.includes("cap") || d.includes("odata") || d.includes("rap") || d.includes("abap"))
    return {
      key: "appdev",
      label: "App dev",
      bg0: "#061018",
      bg1: "#0a1a28",
      accent: "#38bdf8",
      accent2: "#a78bfa",
      glow: "rgba(56,189,248,0.35)",
      motif: "hex",
    };
  if (d.includes("int") || d.includes("cpi") || d.includes("event") || d.includes("mesh"))
    return {
      key: "integration",
      label: "Integration",
      bg0: "#061410",
      bg1: "#0a1c18",
      accent: "#34d399",
      accent2: "#22d3ee",
      glow: "rgba(52,211,153,0.35)",
      motif: "flow",
    };
  if (
    d.includes("data") ||
    d.includes("bdc") ||
    d.includes("hana") ||
    d.includes("sphere") ||
    d.includes("sac")
  )
    return {
      key: "data",
      label: "Data",
      bg0: "#0a1208",
      bg1: "#101a0c",
      accent: "#4ade80",
      accent2: "#fbbf24",
      glow: "rgba(74,222,128,0.32)",
      motif: "crystal",
    };
  if (d.includes("ops") || d.includes("sre") || d.includes("observ") || d.includes("perf"))
    return {
      key: "ops",
      label: "Ops",
      bg0: "#0a0e18",
      bg1: "#12182a",
      accent: "#fbbf24",
      accent2: "#fb7185",
      glow: "rgba(251,191,36,0.32)",
      motif: "radar",
    };
  if (d.includes("arch") || d.includes("clean") || d.includes("enterprise"))
    return {
      key: "arch",
      label: "Architecture",
      bg0: "#0c0a16",
      bg1: "#16122a",
      accent: "#a78bfa",
      accent2: "#38bdf8",
      glow: "rgba(167,139,250,0.35)",
      motif: "orbit",
    };
  if (d.includes("bpa") || d.includes("process") || d.includes("workflow"))
    return {
      key: "process",
      label: "Process",
      bg0: "#100c08",
      bg1: "#1a140c",
      accent: "#fb923c",
      accent2: "#fbbf24",
      glow: "rgba(251,146,60,0.32)",
      motif: "blocks",
    };
  return {
    key: "default",
    label: "Concept",
    bg0: "#080c18",
    bg1: "#0c1224",
    accent: "#7dd3fc",
    accent2: "#a78bfa",
    glow: "rgba(125,211,252,0.32)",
    motif: "stars",
  };
}

function keywordMotif(id: string, title: string): Motif | null {
  const s = `${id} ${title}`.toLowerCase();
  if (/jwt|token|oauth|authn|authz|scope|identity/.test(s)) return "shield";
  if (/tenant|isolat/.test(s)) return "blocks";
  if (/odata|expand|query|perf|latency/.test(s)) return "sparklines";
  if (/event|mesh|async|queue|dlq|idempot/.test(s)) return "flow";
  if (/ai|llm|hallucin|agent|joule|ground/.test(s)) return "neural";
  if (/cache|cdn|edge/.test(s)) return "orbit";
  if (/hana|data.?product|semantic|datasphere/.test(s)) return "crystal";
  if (/trace|metric|log|slo|observ/.test(s)) return "radar";
  if (/clean.?core|rap|cap/.test(s)) return "hex";
  if (/security|threat|risk/.test(s)) return "flame";
  if (/schema|model/.test(s)) return "dna";
  if (/network|graph|topology/.test(s)) return "nodes";
  return null;
}

export function resolveConceptTheme(c: ConceptArtInput): Theme {
  const base = domainTheme(c.domainId);
  const h = hashStr(c.id);
  const motifs: Motif[] = [
    "shield",
    "neural",
    "nodes",
    "waves",
    "hex",
    "orbit",
    "grid",
    "flame",
    "crystal",
    "flow",
    "dna",
    "radar",
    "sparklines",
    "blocks",
    "stars",
  ];
  const kw = keywordMotif(c.id, c.title);
  return {
    key: base.key ?? "default",
    label: base.label ?? "Concept",
    bg0: base.bg0 ?? "#080c18",
    bg1: base.bg1 ?? "#0c1224",
    accent: base.accent ?? "#7dd3fc",
    accent2: base.accent2 ?? "#a78bfa",
    glow: base.glow ?? "rgba(125,211,252,0.32)",
    motif: kw ?? motifs[h % motifs.length]!,
  };
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset.reducedMotion === "true" ||
    document.documentElement.dataset.atlasMotion === "calm"
  );
}

function paintFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  theme: Theme,
  teach: TeachLesson,
  t: number,
  energy: number,
  extreme: boolean,
) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 2 || h < 2) return;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, theme.bg0);
  g.addColorStop(1, theme.bg1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const rg = ctx.createRadialGradient(w * 0.75, h * 0.2, 4, w * 0.75, h * 0.2, w * 0.5);
  rg.addColorStop(0, theme.glow);
  rg.addColorStop(1, "transparent");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, w, h);

  // Pedagogical diagram that explains the concept (labeled, stepped)
  const beat =
    teach.beats[Math.floor(t * 0.45) % Math.max(1, teach.beats.length)] ?? teach.lesson;
  drawTeachScene(
    ctx,
    teach.scene,
    w,
    h,
    t,
    energy,
    theme.accent,
    theme.accent2,
    extreme ? beat : teach.lesson.slice(0, 42),
  );

  if (extreme && energy > 0.45) {
    const ly = ((t * 22) % (h + 24)) - 12;
    const lg = ctx.createLinearGradient(0, ly - 12, 0, ly + 12);
    lg.addColorStop(0, "transparent");
    lg.addColorStop(0.5, theme.glow);
    lg.addColorStop(1, "transparent");
    ctx.fillStyle = lg;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, ly - 12, w, 24);
    ctx.globalAlpha = 1;
  }
}

function useConceptCanvas(
  theme: Theme,
  teach: TeachLesson,
  opts: {
    height: number;
    live: boolean;
    extreme?: boolean;
    energy?: number;
  },
) {
  const ref = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef(opts.live);
  const energyRef = useRef(opts.energy ?? (opts.live ? 1 : 0.25));
  const teachRef = useRef(teach);
  liveRef.current = opts.live;
  energyRef.current = opts.energy ?? (opts.live ? 1 : 0.25);
  teachRef.current = teach;

  const setupSize = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr = Math.min(window.devicePixelRatio || 1, opts.extreme ? 2 : 1.25);
    const w = parent.clientWidth;
    const h = opts.height || parent.clientHeight || 96;
    canvas.width = Math.max(1, w * dpr);
    canvas.height = Math.max(1, h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [opts.height, opts.extreme]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    setupSize();
    const ro = new ResizeObserver(() => {
      setupSize();
      paintFrame(ctx, canvas, theme, teachRef.current, 0.5, energyRef.current, !!opts.extreme);
    });
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    // Always show teaching diagram immediately (explains concept at a glance)
    paintFrame(ctx, canvas, theme, teach, 0.5, 0.4, false);

    let raf = 0;
    let t = 0.5;
    let running = true;
    let visible = true;

    const io = new IntersectionObserver(
      ([e]) => {
        visible = !!e?.isIntersecting;
        if (visible && running) {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(loop);
        }
      },
      { rootMargin: "40px", threshold: 0.08 },
    );
    io.observe(canvas);

    function loop() {
      if (!running) return;
      if (!visible) return; // pause off-screen (restarted by IO)
      raf = requestAnimationFrame(loop);
      if (prefersReducedMotion()) return;
      // Slow step cycle on grid; faster when hovered/detail
      const cinema = document.documentElement.dataset.atlasMotion === "cinema";
      t += liveRef.current || opts.extreme || cinema ? 0.018 : 0.01;
      paintFrame(
        ctx!,
        canvas!,
        theme,
        teachRef.current,
        t,
        energyRef.current,
        !!opts.extreme && (liveRef.current || energyRef.current > 0.5),
      );
    }
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [theme, teach, opts.extreme, setupSize]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    paintFrame(
      ctx,
      canvas,
      theme,
      teach,
      performance.now() / 1000,
      energyRef.current,
      !!opts.extreme,
    );
  }, [opts.live, theme, teach, opts.extreme]);

  return ref;
}

/** Card art: animated diagram that explains this concept */
export function ConceptCardArt({
  concept,
  height = 110,
  live = false,
}: {
  concept: ConceptArtInput;
  height?: number;
  live?: boolean;
}) {
  const theme = useMemo(() => resolveConceptTheme(concept), [concept]);
  const teach = useMemo(() => resolveTeachLesson(concept), [concept]);
  const ref = useConceptCanvas(theme, teach, {
    height,
    live,
    extreme: false,
    // Always some energy so teach steps cycle on grid
    energy: live ? 0.9 : 0.45,
  });

  return (
    <div
      className={`concept-card-art domain-${theme.key}${live ? " is-live" : ""}`}
      style={{ height }}
      title={teach.lesson}
    >
      <canvas ref={ref} className="concept-fx-canvas" aria-hidden />
      <div className="concept-card-art-fade" aria-hidden />
    </div>
  );
}

/** Detail: full teach animation + cycling explanation beats */
export function ConceptDetailArt({
  concept,
  height = 220,
}: {
  concept: ConceptArtInput;
  height?: number;
}) {
  const theme = useMemo(() => resolveConceptTheme(concept), [concept]);
  const teach = useMemo(() => resolveTeachLesson(concept), [concept]);
  const [energy, setEnergy] = useState(1);
  const [live, setLive] = useState(true);
  const [beatIdx, setBeatIdx] = useState(0);

  useEffect(() => {
    setEnergy(1);
    setLive(true);
    setBeatIdx(0);
    const settle = window.setTimeout(() => setEnergy(0.55), 2800);
    // Keep teaching animation alive longer — this is the explanation
    const iv = window.setInterval(() => {
      setBeatIdx((i) => (i + 1) % Math.max(1, teach.beats.length));
    }, 2200);
    return () => {
      clearTimeout(settle);
      clearInterval(iv);
    };
  }, [concept.id, teach.beats.length]);

  const ref = useConceptCanvas(theme, teach, {
    height,
    live: true,
    extreme: true,
    energy,
  });

  return (
    <div
      className={`concept-detail-art domain-${theme.key}${live ? " is-live" : " is-settled"}`}
      style={{ height }}
      onMouseEnter={() => {
        if (!prefersReducedMotion()) setEnergy(0.95);
        setLive(true);
      }}
    >
      <canvas ref={ref} className="concept-fx-canvas" aria-hidden />
      <div className="concept-detail-hud">
        <span className="cdh-kicker">Animated explanation · {theme.label}</span>
        <span className="cdh-motif">{teach.lesson}</span>
      </div>
      <ol className="concept-teach-beats" aria-live="polite">
        {teach.beats.map((b, i) => (
          <li key={b} className={i === beatIdx ? "on" : ""}>
            {b}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Atlas card with explain-graphic + lesson caption */
export function AtlasCardShell({
  concept,
  children,
  onClick,
  selected = false,
}: {
  concept: ConceptArtInput;
  children: ReactNode;
  onClick: () => void;
  selected?: boolean;
}) {
  const theme = useMemo(() => resolveConceptTheme(concept), [concept]);
  const teach = useMemo(() => resolveTeachLesson(concept), [concept]);
  const [live, setLive] = useState(false);

  return (
    <button
      type="button"
      className={`atlas-card atlas-card-fx domain-${theme.key}${selected ? " is-selected" : ""}${live ? " is-live" : ""}`}
      onClick={onClick}
      onMouseEnter={() => setLive(true)}
      onMouseLeave={() => setLive(false)}
      onFocus={() => setLive(true)}
      onBlur={() => setLive(false)}
      aria-pressed={selected}
      aria-label={`${concept.title}. Teaches: ${teach.lesson}`}
      style={
        {
          "--fx-accent": theme.accent,
          "--fx-accent2": theme.accent2,
          "--fx-glow": theme.glow,
        } as CSSProperties
      }
    >
      <div className="atlas-card-stripe" aria-hidden />
      <ConceptCardArt concept={concept} height={124} live={live || selected} />
      <div className="atlas-card-body">
        {children}
        <p className="concept-lesson-line">
          <span>Teaches</span> {teach.lesson}
        </p>
      </div>
      {selected && <span className="atlas-card-selected-pill">Open</span>}
    </button>
  );
}

export function AtlasMotionControl({
  value,
  onChange,
}: {
  value: MotionIntensity;
  onChange: (v: MotionIntensity) => void;
}) {
  return (
    <div className="atlas-motion-control" role="group" aria-label="Motion intensity">
      <span className="amc-label">Motion</span>
      {(
        [
          ["calm", "Calm"],
          ["live", "Live"],
          ["cinema", "Cinema"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={`amc-btn${value === id ? " on" : ""}`}
          onClick={() => onChange(id)}
          aria-pressed={value === id}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function groupConceptsByDomain<T extends { domainId: string; title: string }>(
  list: T[],
): { domainId: string; label: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const c of list) {
    const d = c.domainId || "general";
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(c);
  }
  return [...map.entries()]
    .map(([domainId, items]) => ({
      domainId,
      label: domainTheme(domainId).label ?? domainId,
      items: items.sort((a, b) => a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
