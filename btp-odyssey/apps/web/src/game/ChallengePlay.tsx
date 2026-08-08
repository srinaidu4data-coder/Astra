import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sfx } from "../audio";
import {
  AnticipationOverlay,
  ComboBadge,
  FloatReward,
  PeakReveal,
  PrecisionToggle,
} from "./ReturnLoop";
import { CinematicBackdrop, ConceptCinema, JuiceBurst } from "./CinematicStage";
import "./challenge.css";
import "./return-loop.css";

export interface ChallengeTool {
  id: string;
  label: string;
  icon: string;
  color: string;
}

export interface ChallengeOption {
  id: string;
  label: string;
  correct: boolean;
  why: string;
}

export interface ChallengeStep {
  id: string;
  title: string;
  teach: string;
  prompt: string;
  mode: "choose" | "drop";
  hint: string;
  options?: ChallengeOption[];
  toolId?: string;
  targetNodeId?: string;
  wrongTargets?: Record<string, string>;
  successWhy?: string;
  cinema?: string;
  formula?: string;
}

export interface ChallengeDef {
  id: string;
  title: string;
  tier: string;
  domain: string;
  brief: string;
  unlockAfter: string | null;
  concepts: string[];
  biome?: string;
  challengeType?: string;
  mapStyle?: string;
  curriculumIndex?: number;
  conceptId?: string;
  variant?: string;
  mapNodes: {
    id: string;
    label: string;
    x: number;
    y: number;
    kind: string;
    broken?: boolean;
  }[];
  edges: [string, string][];
  steps: ChallengeStep[];
}

export interface ChallengePack {
  title: string;
  intro: string;
  challenges: ChallengeDef[];
  tools: ChallengeTool[];
  biomes?: string[];
  totalChallenges?: number;
  totalConcepts?: number;
}

export interface ClearReward {
  prestige: number;
  label: string;
  peak: "normal" | "strong" | "epic";
  breakdown?: string[];
  peakCopy?: { headline: string; sub: string };
}

const KIND_GLYPH: Record<string, string> = {
  app: "◇",
  dest: "⇄",
  api: "⬡",
  data: "◉",
  core: "▣",
  slot: "□",
  partner: "◎",
  flow: "⟳",
  queue: "▤",
  tenant: "⌂",
  semantic: "≈",
  product: "◈",
  bi: "◐",
};

const BIOME_META: Record<string, { label: string; emoji: string; blurb: string }> = {
  war: { label: "War Room", emoji: "⚔", blurb: "Doctrine · edges · blast radius" },
  chess: { label: "Chess", emoji: "♞", blurb: "Opening theory · clean-core king safety" },
  farm: { label: "Farm", emoji: "🌾", blurb: "Grow products · weed dumps" },
  roblox: { label: "World", emoji: "🧱", blurb: "Build walls · tenant rooms" },
  neural: { label: "Neural", emoji: "◈", blurb: "Synapses · idempotent spikes" },
  space: { label: "Space", emoji: "✦", blurb: "Light-cones · p99 gravity" },
  market: { label: "Market", emoji: "📈", blurb: "Portfolio · EV trades" },
  film: { label: "Film Set", emoji: "🎬", blurb: "Storyboard incidents" },
};

function variantGateLabel(variant?: string): string {
  switch (variant) {
    case "when":
      return "When-to-use gate";
    case "how":
      return "How-to-use gate";
    case "trap":
      return "Trap / misuse gate";
    case "mastery":
      return "Mastery gate";
    case "intro":
    default:
      return "Intro gate";
  }
}

function variantChip(variant?: string): string {
  switch (variant) {
    case "when":
      return "WHEN";
    case "how":
      return "HOW";
    case "trap":
      return "TRAP";
    case "mastery":
      return "MASTER";
    default:
      return "INTRO";
  }
}

type Feedback = { kind: "good" | "bad"; text: string } | null;

export function ChallengePlay({
  pack,
  clearedIds,
  onCleared,
  onOpenConcept,
  onProgress,
  initialChallengeId,
}: {
  pack: ChallengePack;
  clearedIds: string[];
  onCleared: (
    challengeId: string,
    stats: {
      wrongs: number;
      hintsUsed: number;
      precisionMode: boolean;
      stepCount: number;
      combo: number;
    },
  ) => void | Promise<ClearReward | void>;
  onOpenConcept?: (id: string) => void;
  onProgress?: (p: {
    challengeId: string;
    title: string;
    stepIndex: number;
  }) => void;
  initialChallengeId?: string | null;
}) {
  const [activeId, setActiveId] = useState<string | null>(initialChallengeId ?? null);
  const [stepIndex, setStepIndex] = useState(0);
  const [fixedNodes, setFixedNodes] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<{ id: string; kind: "red" | "green" } | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [hintLevel, setHintLevel] = useState(0);
  const [choiceState, setChoiceState] = useState<Record<string, "wrong" | "right">>({});
  const [won, setWon] = useState(false);
  const [dragTool, setDragTool] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; tool: ChallengeTool } | null>(null);
  const [hotNode, setHotNode] = useState<string | null>(null);
  const [precisionMode, setPrecisionMode] = useState(false);
  const [combo, setCombo] = useState(0);
  const [wrongs, setWrongs] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [anticipating, setAnticipating] = useState(false);
  const [floatText, setFloatText] = useState<string | null>(null);
  const [floatKey, setFloatKey] = useState(0);
  const [clearReward, setClearReward] = useState<ClearReward | null>(null);
  const [showPeak, setShowPeak] = useState(false);
  const [pulse, setPulse] = useState<"idle" | "good" | "bad" | "unlock">("idle");
  const [juice, setJuice] = useState<{ kind: "good" | "bad" | "unlock" | "hint"; text: string } | null>(
    null,
  );
  const [shake, setShake] = useState(false);
  /** When true, user is on path map and auto-start must not steal the UI */
  const [browseMap, setBrowseMap] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef({ wrongs: 0, hintsUsed: 0, combo: 0 });
  const hadWrongThisStep = useRef(false);
  const autoStartedRef = useRef(false);
  const anticipatingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [localCleared, setLocalCleared] = useState<string[]>([]);
  const cleared = useMemo(
    () => new Set([...clearedIds, ...localCleared]),
    [clearedIds, localCleared],
  );

  const unlocked = useCallback(
    (ch: ChallengeDef) => {
      if (!ch.unlockAfter) return true;
      return cleared.has(ch.unlockAfter);
    },
    [cleared],
  );

  const challenge = pack.challenges.find((c) => c.id === activeId) ?? null;
  const step = challenge?.steps[stepIndex] ?? null;
  const biome = challenge?.biome || challenge?.mapStyle || "default";
  const toolsById = useMemo(
    () => Object.fromEntries(pack.tools.map((t) => [t.id, t])),
    [pack.tools],
  );

  const nextCampaign = useMemo(() => {
    return pack.challenges.find((c) => {
      if (cleared.has(c.id)) return false;
      if (!c.unlockAfter) return true;
      return cleared.has(c.unlockAfter);
    });
  }, [pack.challenges, cleared]);

  // Auto-start the required next step once — never fight "Path map" button
  useEffect(() => {
    if (browseMap) return;
    if (activeId) return;
    if (autoStartedRef.current && !initialChallengeId) return;

    const nextOpen = pack.challenges.find((c) => unlocked(c) && !cleared.has(c.id));
    if (
      initialChallengeId &&
      pack.challenges.find((c) => c.id === initialChallengeId) &&
      unlocked(pack.challenges.find((c) => c.id === initialChallengeId)!)
    ) {
      if (!nextOpen || initialChallengeId === nextOpen.id || cleared.has(initialChallengeId)) {
        autoStartedRef.current = true;
        setActiveId(initialChallengeId);
        return;
      }
    }
    if (nextOpen) {
      autoStartedRef.current = true;
      setActiveId(nextOpen.id);
    }
  }, [pack, unlocked, cleared, activeId, initialChallengeId, browseMap]);

  useEffect(() => {
    if (!challenge) return;
    onProgress?.({
      challengeId: challenge.id,
      title: challenge.title,
      stepIndex,
    });
  }, [challenge, stepIndex, onProgress]);

  // Safety: never leave anticipation overlay blocking clicks forever
  useEffect(() => {
    if (!anticipating) return;
    const t = setTimeout(() => setAnticipating(false), 2000);
    return () => clearTimeout(t);
  }, [anticipating]);

  function pulseJuice(kind: "good" | "bad" | "unlock" | "hint", text: string) {
    setJuice({ kind, text });
    setFloatText(text);
    setFloatKey((k) => k + 1);
    setTimeout(() => {
      setJuice(null);
      setFloatText(null);
    }, 1100);
  }

  function startChallenge(id: string) {
    const ch = pack.challenges.find((c) => c.id === id);
    if (!ch) return;
    if (!unlocked(ch)) {
      pulseJuice("bad", "LOCKED");
      try {
        sfx.fail();
      } catch {
        /* ignore */
      }
      return;
    }
    // Hard path lock: cannot open a future island beyond the current next gate
    // (cleared ones may be replayed)
    const nextOpen = pack.challenges.find((c) => unlocked(c) && !cleared.has(c.id));
    if (nextOpen && id !== nextOpen.id && !cleared.has(id)) {
      pulseJuice("bad", "FOLLOW THE PATH");
      try {
        sfx.fail();
      } catch {
        /* ignore */
      }
      setBrowseMap(false);
      setActiveId(nextOpen.id);
      return;
    }
    setBrowseMap(false);
    setActiveId(id);
    setStepIndex(0);
    setFixedNodes(new Set());
    setFeedback(null);
    setHintOpen(false);
    setHintLevel(0);
    setChoiceState({});
    setWon(false);
    setCombo(0);
    setWrongs(0);
    setAnticipating(false);
    setHintsUsed(0);
    setClearReward(null);
    setShowPeak(false);
    setPulse("idle");
    statsRef.current = { wrongs: 0, hintsUsed: 0, combo: 0 };
    hadWrongThisStep.current = false;
    sfx.launch();
  }

  function advance(why: string) {
    if (!challenge || !step || anticipating) return;
    setAnticipating(true);
    setPulse("good");
    const delay = precisionMode ? 520 : 280;
    if (anticipatingTimer.current) clearTimeout(anticipatingTimer.current);
    anticipatingTimer.current = setTimeout(() => {
      setAnticipating(false);
      setFeedback({ kind: "good", text: why });
      setCombo((c) => {
        const n = c + 1;
        statsRef.current.combo = n;
        if (n >= 5) pulseJuice("good", `Flow ×${n}`);
        else if (n >= 3) pulseJuice("good", `Focus ×${n}`);
        else if (hadWrongThisStep.current) pulseJuice("good", "Recovered");
        else pulseJuice("good", "UNLOCKED");
        return n;
      });
      hadWrongThisStep.current = false;
      sfx.success();
      setTimeout(() => {
        if (stepIndex >= challenge.steps.length - 1) {
          setWon(true);
          setPulse("unlock");
          sfx.unlock();
          pulseJuice("unlock", "CHALLENGE CLEAR");
          const stats = {
            wrongs: statsRef.current.wrongs,
            hintsUsed: statsRef.current.hintsUsed,
            precisionMode,
            stepCount: challenge.steps.length,
            combo: statsRef.current.combo,
          };
          setLocalCleared((prev) =>
            prev.includes(challenge.id) ? prev : [...prev, challenge.id],
          );
          void Promise.resolve(onCleared(challenge.id, stats)).then((reward) => {
            if (reward && typeof reward === "object" && "prestige" in reward) {
              setClearReward(reward);
              setTimeout(() => setShowPeak(true), 400);
              setTimeout(() => setShowPeak(false), 3200);
            }
          });
        } else {
          setStepIndex((i) => i + 1);
          setFeedback(null);
          setHintOpen(false);
          setHintLevel(0);
          setChoiceState({});
          setPulse("idle");
          sfx.tick();
        }
      }, 900);
    }, delay);
  }

  function fail(text: string, nodeId?: string) {
    if (anticipating) return;
    setAnticipating(true);
    setPulse("bad");
    setShake(true);
    setTimeout(() => setShake(false), 450);
    if (anticipatingTimer.current) clearTimeout(anticipatingTimer.current);
    anticipatingTimer.current = setTimeout(() => {
      setAnticipating(false);
      setFeedback({ kind: "bad", text });
      setCombo(0);
      statsRef.current.combo = 0;
      hadWrongThisStep.current = true;
      setWrongs((w) => {
        const n = w + 1;
        statsRef.current.wrongs = n;
        return n;
      });
      pulseJuice("bad", "BLOCKED");
      sfx.fail();
      if (nodeId) {
        setFlash({ id: nodeId, kind: "red" });
        setTimeout(() => setFlash(null), 800);
      }
      setTimeout(() => setPulse("idle"), 700);
    }, precisionMode ? 480 : 200);
  }

  function onChoose(opt: ChallengeOption) {
    if (!step || step.mode !== "choose" || anticipating || won) return;
    // Already solved this beat
    if (Object.values(choiceState).includes("right")) return;
    if (opt.correct) {
      setChoiceState({ [opt.id]: "right" });
      advance(opt.why);
    } else {
      setChoiceState((s) => ({ ...s, [opt.id]: "wrong" }));
      fail(opt.why);
    }
  }

  function resolveDrop(nodeId: string) {
    if (!step || step.mode !== "drop" || !dragTool) return;
    const tool = toolsById[dragTool];
    if (!tool || tool.id !== step.toolId) {
      fail("Wrong tool for this step. Use the highlighted tray chip.");
      setDragTool(null);
      setGhost(null);
      return;
    }
    if (nodeId === step.targetNodeId) {
      setFlash({ id: nodeId, kind: "green" });
      setFixedNodes((s) => new Set(s).add(nodeId));
      setTimeout(() => setFlash(null), 900);
      advance(step.successWhy || "Correct placement — gate unlocked.");
    } else {
      const why =
        step.wrongTargets?.[nodeId] ||
        "Wrong target. Read the concept beat and try another node.";
      fail(why, nodeId);
    }
    setDragTool(null);
    setGhost(null);
    setHotNode(null);
  }

  useEffect(() => {
    if (!dragTool) return;
    const tool = toolsById[dragTool];
    if (!tool) return;
    const move = (e: PointerEvent) => {
      setGhost({ x: e.clientX, y: e.clientY, tool });
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const node = el?.closest("[data-node-id]") as HTMLElement | null;
      setHotNode(node?.dataset.nodeId ?? null);
    };
    const up = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const node = el?.closest("[data-node-id]") as HTMLElement | null;
      if (node?.dataset.nodeId) resolveDrop(node.dataset.nodeId);
      else {
        setDragTool(null);
        setGhost(null);
        setHotNode(null);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragTool, stepIndex, activeId]);

  const nodePos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    challenge?.mapNodes.forEach((n) => m.set(n.id, { x: n.x, y: n.y }));
    return m;
  }, [challenge]);

  // —— Campaign map: curriculum order only (never regroup out of sequence) ——
  // Also shown when browseMap is true (active challenge paused)
  if (!challenge || browseMap) {
    const clearedN = pack.challenges.filter((c) => cleared.has(c.id)).length;
    const total = pack.challenges.length || 1;
    const pct = Math.round((clearedN / total) * 100);
    const nextIdx = nextCampaign
      ? pack.challenges.findIndex((c) => c.id === nextCampaign.id)
      : 0;
    // Show a sliding window so 300+ cards stay usable
    const windowStart = Math.max(0, nextIdx - 2);
    const windowEnd = Math.min(total, nextIdx + 12);
    const windowList = pack.challenges.slice(windowStart, windowEnd);

    return (
      <div className="play-shell campaign-shell">
        <div className="campaign-hero">
          <CinematicBackdrop biome="space" intensity={1.2} />
          <div className="campaign-hero-copy">
            <p className="hero-kicker">
              Linear path · {total} games · {pack.totalConcepts ?? Math.floor(total / 2)} concepts ·
              0 missing
            </p>
            <h2>{pack.title}</h2>
            <p className="sub">{pack.intro}</p>
            <div className="return-bar" aria-hidden>
              <i style={{ width: `${pct}%` }} />
            </div>
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              {clearedN}/{total} cleared · {pct}% · order is fixed: What is BTP → … → last concept
              mastery. You cannot skip ahead.
            </p>
            {nextCampaign && (
              <div className="path-next-banner">
                <div>
                  <div className="hero-kicker">Required next step</div>
                  <strong>
                    #{nextCampaign.curriculumIndex ?? nextIdx + 1} · {nextCampaign.title}
                  </strong>
                  <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.82rem" }}>
                    Concept: {(nextCampaign.concepts || []).join(", ")} ·{" "}
                    {nextCampaign.variant || "step"}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn primary"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startChallenge(nextCampaign.id);
                  }}
                >
                  ▶ Play required step
                </button>
              </div>
            )}
            {!nextCampaign && (
              <p style={{ color: "#34d399", fontWeight: 700 }}>Curriculum complete — replay any step.</p>
            )}
          </div>
        </div>

        <p className="muted" style={{ fontSize: "0.8rem" }}>
          Showing path window {windowStart + 1}–{windowEnd} of {total} (always in curriculum order)
        </p>
        <div className="campaign-map campaign-map-islands">
          {windowList.map((ch, i) => {
            const globalIdx = windowStart + i;
            const isUnlocked = unlocked(ch);
            const isCleared = cleared.has(ch.id);
            const isNext = nextCampaign?.id === ch.id;
            const b = ch.biome || "default";
            const meta = BIOME_META[b] ?? { label: b, emoji: "◇", blurb: ch.domain };
            return (
              <button
                key={ch.id}
                type="button"
                className={`challenge-card island biome-${b}${isCleared ? " cleared" : ""}${isUnlocked && !isCleared ? " current" : ""}${isNext ? " next-gate" : ""}`}
                disabled={!isUnlocked || (!isCleared && !isNext)}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  startChallenge(ch.id);
                }}
              >
                <div className="island-glow" aria-hidden />
                <div className="tier">
                  {meta.emoji} #{ch.curriculumIndex ?? globalIdx + 1} ·{" "}
                  {variantChip(ch.variant)} · {ch.tier}
                  {isNext ? " · REQUIRED NOW" : ""}
                </div>
                <h3 style={{ margin: "0.35rem 0" }}>{ch.title}</h3>
                <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
                  {(ch.concepts || []).join(", ")} · {ch.domain}
                </p>
                <div className="island-steps">
                  {ch.steps.map((s) => (
                    <i key={s.id} className={isCleared ? "done" : ""} title={s.title} />
                  ))}
                </div>
                {!isUnlocked && <div className="lock">🔒</div>}
                {isCleared && (
                  <div className="muted" style={{ marginTop: "0.45rem", color: "#34d399" }}>
                    Cleared · replay ok
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const activeTool =
    step?.mode === "drop" && step.toolId ? toolsById[step.toolId] : null;
  const meta = BIOME_META[biome] ?? { label: biome, emoji: "◇", blurb: "" };

  const peakHeadline =
    clearReward?.peakCopy?.headline ??
    (clearReward?.peak === "epic"
      ? "Epic peak — precision mastery"
      : clearReward?.peak === "strong"
        ? "Strong clear"
        : "Challenge cleared");
  const peakSub =
    clearReward?.peakCopy?.sub ??
    (clearReward
      ? `+${clearReward.prestige} prestige · ${clearReward.label}`
      : "Next campaign island unlocked.");

  return (
    <div className={`play-shell biome-play biome-${biome}${shake ? " board-shake" : ""}`}>
      <ComboBadge combo={combo} />
      {floatText && <FloatReward key={floatKey} text={floatText} keyId={floatKey} />}
      {juice && <JuiceBurst kind={juice.kind} text={juice.text} />}
      <AnticipationOverlay
        open={anticipating}
        label={precisionMode ? "Stakes resolving…" : "Resolving…"}
      />
      <PeakReveal
        open={showPeak && !!clearReward}
        peak={clearReward?.peak ?? "normal"}
        headline={peakHeadline}
        sub={peakSub}
        breakdown={clearReward?.breakdown}
      />

      <div className="path-rail-live" aria-live="polite">
        <span>
          Path #{challenge.curriculumIndex ?? "—"} / {pack.challenges.length} ·{" "}
          <strong>{(challenge.concepts || [])[0] || challenge.id}</strong>
        </span>
        <span className="muted">
          {variantGateLabel(challenge.variant)} · linear path
        </span>
      </div>
      <div className="action-row play-top-bar">
        <button
          className="btn"
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setAnticipating(false);
            setShowPeak(false);
            setWon(false);
            setPulse("idle");
            setBrowseMap(true);
            // Keep activeId so resume is easy, but show map (browseMap)
            // Clear activeId so map is the only view
            setActiveId(null);
          }}
        >
          ← Path map
        </button>
        <span className={`pill hot biome-pill biome-${biome}`}>
          {meta.emoji} {meta.label}
        </span>
        <span className="pill">
          {challenge.tier} · {challenge.domain}
        </span>
        <span className="pill">
          Beat {stepIndex + 1}/{challenge.steps.length}
        </span>
        <PrecisionToggle on={precisionMode} onToggle={() => setPrecisionMode((v) => !v)} />
      </div>

      {precisionMode && (
        <div className="stake-meter">
          Stakes: <strong>{wrongs} wrong</strong> · {hintsUsed} hints · clean = max reward
          {combo >= 2 ? ` · focus ×${combo}` : ""}
        </div>
      )}

      <div className="progress-pips animated-pips" aria-hidden>
        {challenge.steps.map((s, i) => (
          <i
            key={s.id}
            className={i < stepIndex ? "done" : i === stepIndex ? "on" : ""}
            title={s.title}
          />
        ))}
      </div>

      <div className="challenge-stage cinematic-stage">
        <aside className="panel stage-rail">
          <h3 style={{ marginTop: 0 }}>{challenge.title}</h3>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {challenge.brief}
          </p>
          <ul className="step-rail-game">
            {challenge.steps.map((s, i) => (
              <li
                key={s.id}
                className={
                  i < stepIndex ? "done" : i === stepIndex ? "active" : "locked"
                }
              >
                {i < stepIndex ? "✓ " : i === stepIndex ? "► " : "🔒 "}
                {s.title}
              </li>
            ))}
          </ul>
          {challenge.concepts?.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <div className="muted" style={{ fontSize: "0.75rem" }}>
                Concepts (open atlas)
              </div>
              <div className="tags">
                {challenge.concepts.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="tag pulse-tag"
                    onClick={() => onOpenConcept?.(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        <section className="panel board-panel" style={{ padding: "0.5rem" }}>
          <div
            className={`challenge-board map-${biome}${shake ? " shake" : ""}`}
            ref={boardRef}
          >
            <CinematicBackdrop biome={biome} intensity={1.15} pulse={pulse} />
            <svg
              className="board-svg-edges"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden
            >
              {challenge.edges.map(([a, b], i) => {
                const A = nodePos.get(a);
                const B = nodePos.get(b);
                if (!A || !B) return null;
                const bad =
                  (challenge.mapNodes.find((n) => n.id === a)?.broken ||
                    challenge.mapNodes.find((n) => n.id === b)?.broken) &&
                  !fixedNodes.has(a) &&
                  !fixedNodes.has(b);
                const mx = (A.x + B.x) / 2;
                const my = (A.y + B.y) / 2 - 6;
                return (
                  <g key={`${a}-${b}`}>
                    <path
                      d={`M ${A.x} ${A.y} Q ${mx} ${my} ${B.x} ${B.y}`}
                      className={bad ? "svg-edge bad" : "svg-edge"}
                      fill="none"
                    />
                    <circle r="1.4" className={bad ? "svg-packet bad" : "svg-packet"}>
                      <animateMotion
                        dur={`${1.6 + (i % 3) * 0.35}s`}
                        repeatCount="indefinite"
                        path={`M ${A.x} ${A.y} Q ${mx} ${my} ${B.x} ${B.y}`}
                      />
                    </circle>
                  </g>
                );
              })}
            </svg>
            {challenge.mapNodes.map((n) => {
              const isFixed = fixedNodes.has(n.id);
              const flashClass =
                flash?.id === n.id
                  ? flash.kind === "red"
                    ? " flash-red"
                    : " flash-green"
                  : "";
              return (
                <div
                  key={n.id}
                  data-node-id={n.id}
                  className={`board-node node-${n.kind}${n.broken && !isFixed ? " broken" : ""}${isFixed ? " fixed" : ""}${hotNode === n.id ? " drop-hot" : ""}${flashClass}`}
                  style={{ left: `${n.x}%`, top: `${n.y}%` }}
                  onPointerUp={() => {
                    if (dragTool) resolveDrop(n.id);
                  }}
                >
                  <span className="glyph">{KIND_GLYPH[n.kind] ?? "●"}</span>
                  <span className="node-label">{n.label}</span>
                  {isFixed && <span className="node-check">✓</span>}
                </div>
              );
            })}
            {won && (
              <div className="win-overlay">
                <div className="win-card win-card-cinema">
                  <div className="win-burst" aria-hidden />
                  <h3>{peakHeadline}</h3>
                  <p className="muted">{peakSub}</p>
                  {clearReward?.breakdown && (
                    <ul className="win-breakdown">
                      {clearReward.breakdown.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                  <div className="action-row" style={{ justifyContent: "center" }}>
                    <button
                      className="btn primary"
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setWon(false);
                        setShowPeak(false);
                        setBrowseMap(true);
                        setActiveId(null);
                      }}
                    >
                      Path map
                    </button>
                    <button
                      className="btn violet"
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const next = pack.challenges.find((c) => c.unlockAfter === challenge.id);
                        if (next) startChallenge(next.id);
                        else {
                          setBrowseMap(true);
                          setActiveId(null);
                        }
                      }}
                    >
                      Next required step
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {step?.mode === "drop" && (
            <div className="tool-tray animated-tray">
              <span className="muted" style={{ fontSize: "0.75rem", width: "100%" }}>
                Grab the glowing tool — drop on the correct node. Wrong targets flash RED with why.
              </span>
              {pack.tools
                .filter((t) => t.id === step.toolId)
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`tool-chip glow-tool${dragTool === t.id ? " dragging" : ""}`}
                    style={{ borderColor: t.color, background: t.color + "33" }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setDragTool(t.id);
                      setGhost({ x: e.clientX, y: e.clientY, tool: t });
                      sfx.click();
                    }}
                  >
                    <span>{t.icon}</span> {t.label}
                  </button>
                ))}
            </div>
          )}
        </section>

        <aside className="panel teach-panel-live">
          {step && (
            <>
              <ConceptCinema
                teach={step.teach}
                formula={step.formula}
                cinema={step.cinema}
                stepTitle={step.title}
              />
              <p className="step-prompt">{step.prompt}</p>

              {step.mode === "choose" && (
                <div className="choice-grid">
                  {step.options?.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={`choice-btn ${choiceState[o.id] ?? ""}`}
                      disabled={
                        anticipating ||
                        won ||
                        Object.values(choiceState).includes("right") ||
                        choiceState[o.id] === "wrong"
                      }
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onChoose(o);
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}

              {step.mode === "drop" && activeTool && (
                <p className="muted" style={{ fontSize: "0.85rem" }}>
                  Active tool:{" "}
                  <strong style={{ color: activeTool.color }}>{activeTool.label}</strong>
                </p>
              )}

              <button
                type="button"
                className="btn hint-btn hint-pulse"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setHintOpen(true);
                  setHintLevel((h) => h + 1);
                  setHintsUsed((h) => {
                    const n = h + 1;
                    statsRef.current.hintsUsed = n;
                    return n;
                  });
                  pulseJuice("hint", `HINT L${Math.min(hintLevel + 1, 3)}`);
                  try {
                    sfx.click();
                  } catch {
                    /* ignore */
                  }
                }}
              >
                Hint {hintLevel > 0 ? `(L${Math.min(hintLevel, 3)})` : "— scaffold this step"}
              </button>
              {hintOpen && (
                <div className="hint-box hint-reveal">
                  {hintLevel <= 1 && step.hint}
                  {hintLevel === 2 &&
                    step.mode === "drop" &&
                    `Focus on node kinds near the broken hop. Loud symptoms ≠ root cause.`}
                  {hintLevel === 2 &&
                    step.mode === "choose" &&
                    `Eliminate answers that destroy data, remove security, or ignore constraints.`}
                  {hintLevel >= 3 &&
                    (step.mode === "drop"
                      ? `Target concept: ${step.targetNodeId}`
                      : `Only one option preserves constraints and least privilege.`)}
                </div>
              )}

              {feedback && (
                <div
                  className={`feedback-banner feedback-pop ${feedback.kind === "good" ? "good" : "bad"}`}
                >
                  <strong>{feedback.kind === "good" ? "GREEN · Unlocked" : "RED · Blocked"}:</strong>{" "}
                  {feedback.text}
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      {ghost && (
        <div
          className="ghost-drag ghost-juice"
          style={{
            left: ghost.x,
            top: ghost.y,
            background: ghost.tool.color,
          }}
        >
          {ghost.tool.icon} {ghost.tool.label}
        </div>
      )}
    </div>
  );
}
