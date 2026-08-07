import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { sfx } from "./audio";

export type Axis =
  | "security"
  | "resilience"
  | "cost"
  | "complexity"
  | "time_to_value"
  | "operability"
  | "clean_core"
  | "scalability"
  | "data_governance"
  | "team_fit";

const AXES: { id: Axis; label: string }[] = [
  { id: "security", label: "Security" },
  { id: "resilience", label: "Resilience" },
  { id: "cost", label: "Cost efficiency" },
  { id: "complexity", label: "Simplicity" },
  { id: "time_to_value", label: "Time to value" },
  { id: "operability", label: "Operability" },
  { id: "clean_core", label: "Clean core" },
  { id: "scalability", label: "Scalability" },
  { id: "data_governance", label: "Data governance" },
  { id: "team_fit", label: "Team fit" },
];

export interface StudioOption {
  id: string;
  title: string;
  summary: string;
  scores: Partial<Record<Axis, number>>;
  risks: string[];
  whenToChoose: string[];
  whenToReject: string[];
}

export interface StudioScenario {
  id: string;
  title: string;
  businessContext: string;
  constraints: string[];
  nonNegotiables: string[];
  options: StudioOption[];
  boardChallenges: {
    id: string;
    voice: string;
    question: string;
  }[];
  note: string;
}

export interface StudioResult {
  overall: number;
  passed: boolean;
  feedback: string[];
  dimensionScores: Record<string, number>;
  boardResults: { id: string; score: number; feedback: string }[];
  radar: { axis: string; selected: number; weight: number }[];
  prestigeDelta: number;
}

type Phase = "context" | "options" | "weights" | "board" | "result";
const PHASES: Phase[] = ["context", "options", "weights", "board", "result"];

/** SVG radar chart for option scores vs learner weights */
export function TradeRadar({
  scores,
  weights,
  size = 280,
}: {
  scores: Partial<Record<Axis, number>>;
  weights: Partial<Record<Axis, number>>;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.36;
  const n = AXES.length;

  function pt(i: number, value: number) {
    const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const rr = r * Math.max(0, Math.min(1, value));
    return [cx + Math.cos(angle) * rr, cy + Math.sin(angle) * rr] as const;
  }

  const scorePoly = AXES.map((a, i) => pt(i, scores[a.id] ?? 0.5))
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
  const weightPoly = AXES.map((a, i) => pt(i, weights[a.id] ?? 0))
    .map(([x, y]) => `${x},${y}`)
    .join(" ");

  return (
    <svg
      className="radar-svg"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Trade-off radar chart"
    >
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon
          key={ring}
          points={AXES.map((_, i) => {
            const [x, y] = pt(i, ring);
            return `${x},${y}`;
          }).join(" ")}
          className="radar-ring"
        />
      ))}
      {AXES.map((a, i) => {
        const [x, y] = pt(i, 1);
        return (
          <g key={a.id}>
            <line x1={cx} y1={cy} x2={x} y2={y} className="radar-axis" />
            <text
              x={x + (x - cx) * 0.12}
              y={y + (y - cy) * 0.12}
              className="radar-label"
              textAnchor="middle"
            >
              {a.label}
            </text>
          </g>
        );
      })}
      <polygon points={weightPoly} className="radar-weights" />
      <polygon points={scorePoly} className="radar-scores" />
    </svg>
  );
}

/** Trust-boundary / data-flow graphic — fixed positions, no label collisions */
export function TrustFlowDiagram({
  nodes,
  edges,
  title,
}: {
  nodes: { id: string; label: string; zone: "user" | "edge" | "app" | "data" | "partner" }[];
  edges: { from: string; to: string; label?: string; risk?: boolean }[];
  title?: string;
}) {
  const SLOT: Record<string, { x: number; y: number }> = {
    u: { x: 56, y: 110 },
    idp: { x: 156, y: 110 },
    api: { x: 268, y: 72 },
    ui: { x: 268, y: 128 },
    db: { x: 372, y: 110 },
    p: { x: 268, y: 200 },
    rap: { x: 268, y: 72 },
    cap: { x: 268, y: 132 },
    s4: { x: 372, y: 110 },
    em: { x: 330, y: 200 },
  };

  const byZone: Record<string, { x: number; y: number }[]> = {
    user: [{ x: 56, y: 110 }],
    edge: [{ x: 156, y: 110 }],
    app: [
      { x: 268, y: 68 },
      { x: 268, y: 132 },
    ],
    data: [{ x: 372, y: 110 }],
    partner: [{ x: 268, y: 200 }],
  };
  const zoneUsed: Record<string, number> = {};
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    if (SLOT[n.id]) {
      pos.set(n.id, SLOT[n.id]!);
      continue;
    }
    const i = zoneUsed[n.zone] ?? 0;
    zoneUsed[n.zone] = i + 1;
    const slots = byZone[n.zone] ?? [{ x: 200, y: 100 }];
    pos.set(n.id, slots[Math.min(i, slots.length - 1)]!);
  }

  function edgeLabelPos(
    a: { x: number; y: number },
    b: { x: number; y: number },
    label: string,
  ) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ox = (-dy / len) * 12;
    const oy = (dx / len) * 12;
    const preferUp = Math.abs(dy) < Math.abs(dx);
    return {
      x: mx + (preferUp ? 0 : ox),
      y: my + (preferUp ? -10 : oy) - 2,
      w: Math.max(28, label.length * 5.2 + 10),
    };
  }

  return (
    <div className="trust-flow">
      {title && <div className="trust-flow-title">{title}</div>}
      <svg viewBox="0 0 430 250" className="trust-svg" role="img" aria-label="Trust and flow diagram">
        <rect x="12" y="28" width="88" height="164" rx="12" className="zone user" />
        <rect x="112" y="28" width="88" height="164" rx="12" className="zone edge" />
        <rect x="212" y="28" width="112" height="148" rx="12" className="zone app" />
        <rect x="336" y="28" width="82" height="164" rx="12" className="zone data" />
        <rect x="212" y="184" width="112" height="52" rx="12" className="zone partner" />

        <text x="56" y="46" className="zone-label" textAnchor="middle">
          User
        </text>
        <text x="156" y="46" className="zone-label" textAnchor="middle">
          Edge / IdP
        </text>
        <text x="268" y="46" className="zone-label" textAnchor="middle">
          App
        </text>
        <text x="377" y="46" className="zone-label" textAnchor="middle">
          Data
        </text>
        <text x="268" y="200" className="zone-label" textAnchor="middle">
          Partner
        </text>

        {edges.map((e, ei) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const lp = e.label ? edgeLabelPos(a, b, e.label) : null;
          // slight curve offset for parallel edges
          const midY = (a.y + b.y) / 2 + (ei % 2 === 0 ? -6 : 6);
          const path = `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${midY} ${b.x} ${b.y}`;
          return (
            <g key={`${e.from}-${e.to}-${e.label ?? ""}-${ei}`}>
              <path
                d={path}
                className={`flow-edge${e.risk ? " risk" : ""}`}
                fill="none"
                markerEnd="url(#flow-arrow)"
              />
              {e.label && lp && (
                <g>
                  <rect
                    x={lp.x - lp.w / 2}
                    y={lp.y - 8}
                    width={lp.w}
                    height={14}
                    rx={4}
                    className="flow-edge-pill"
                  />
                  <text x={lp.x} y={lp.y + 2} className="flow-edge-label" textAnchor="middle">
                    {e.label}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        <defs>
          <marker
            id="flow-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="rgba(125, 211, 252, 0.75)" />
          </marker>
        </defs>

        {nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const labelBelow = n.zone !== "partner";
          const ly = labelBelow ? p.y + 20 : p.y - 16;
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r={11} className={`flow-node ${n.zone}`} />
              <text x={p.x} y={ly} className="flow-node-label" textAnchor="middle">
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Architecture sketch changes with selected option — makes the "flow" interactive */
function flowForOption(optionId: string | null): {
  title: string;
  nodes: { id: string; label: string; zone: "user" | "edge" | "app" | "data" | "partner" }[];
  edges: { from: string; to: string; label?: string; risk?: boolean }[];
} {
  const base = {
    nodes: [
      { id: "u", label: "User", zone: "user" as const },
      { id: "idp", label: "IdP", zone: "edge" as const },
      { id: "ui", label: "UI", zone: "app" as const },
      { id: "s4", label: "S/4", zone: "data" as const },
    ],
  };

  if (optionId === "rap-onstack") {
    return {
      title: "Flow: RAP on-stack",
      nodes: [
        ...base.nodes,
        { id: "rap", label: "RAP", zone: "app" },
        { id: "p", label: "Partner", zone: "partner" },
      ],
      edges: [
        { from: "u", to: "idp", label: "authn" },
        { from: "idp", to: "ui", label: "token" },
        { from: "ui", to: "rap", label: "OData" },
        { from: "rap", to: "s4", label: "BO" },
        { from: "p", to: "rap", label: "BAPI?", risk: true },
      ],
    };
  }
  if (optionId === "cap-side") {
    return {
      title: "Flow: CAP side-by-side",
      nodes: [
        ...base.nodes,
        { id: "cap", label: "CAP", zone: "app" },
        { id: "em", label: "Events", zone: "partner" },
      ],
      edges: [
        { from: "u", to: "idp", label: "authn" },
        { from: "idp", to: "ui", label: "token" },
        { from: "ui", to: "cap", label: "API" },
        { from: "cap", to: "s4", label: "dest", risk: true },
        { from: "em", to: "cap", label: "events" },
      ],
    };
  }
  if (optionId === "hybrid") {
    return {
      title: "Flow: Hybrid RAP + CAP",
      nodes: [
        ...base.nodes,
        { id: "rap", label: "RAP", zone: "app" },
        { id: "cap", label: "CAP", zone: "app" },
        { id: "em", label: "Events", zone: "partner" },
      ],
      edges: [
        { from: "u", to: "idp", label: "authn" },
        { from: "idp", to: "ui", label: "token" },
        { from: "ui", to: "rap", label: "approve" },
        { from: "ui", to: "cap", label: "insight" },
        { from: "rap", to: "s4", label: "post" },
        { from: "em", to: "cap", label: "project", risk: true },
      ],
    };
  }
  if (optionId === "lowcode-bpa") {
    return {
      title: "Flow: Process Automation",
      nodes: [
        ...base.nodes,
        { id: "api", label: "BPA", zone: "app" },
        { id: "p", label: "Forms", zone: "partner" },
      ],
      edges: [
        { from: "u", to: "idp", label: "authn" },
        { from: "idp", to: "ui", label: "token" },
        { from: "ui", to: "api", label: "workflow" },
        { from: "api", to: "s4", label: "action", risk: true },
        { from: "p", to: "api", label: "form" },
      ],
    };
  }
  return {
    title: "Flow: generic trust sketch",
    nodes: [
      { id: "u", label: "User", zone: "user" },
      { id: "idp", label: "IdP", zone: "edge" },
      { id: "api", label: "API", zone: "app" },
      { id: "ui", label: "UI", zone: "app" },
      { id: "db", label: "Data", zone: "data" },
      { id: "p", label: "Partner", zone: "partner" },
    ],
    edges: [
      { from: "u", to: "idp", label: "authn" },
      { from: "idp", to: "ui", label: "token" },
      { from: "ui", to: "api", label: "OAuth", risk: true },
      { from: "api", to: "db", label: "query" },
      { from: "p", to: "api", label: "intake", risk: true },
    ],
  };
}

function resetCaseState() {
  return {
    selected: "" as string,
    rejected: [] as string[],
    rationale: "",
    boardAnswers: {} as Record<string, string>,
    result: null as StudioResult | null,
    phase: "context" as Phase,
    submitError: null as string | null,
  };
}

export function ArchitectStudio({
  scenarios,
  onSubmit,
  onOpenLoop,
  initialScenarioId,
}: {
  scenarios: StudioScenario[];
  onSubmit: (
    scenarioId: string,
    body: {
      selectedOptionId: string;
      rejectedOptionIds: string[];
      weights: Partial<Record<Axis, number>>;
      rationale: string;
      boardAnswers: Record<string, string>;
    },
  ) => Promise<StudioResult>;
  onOpenLoop?: (title: string) => void;
  initialScenarioId?: string | null;
}) {
  const [idx, setIdx] = useState(0);
  const scenario = scenarios[idx] ?? scenarios[0];
  const [selected, setSelected] = useState<string>("");
  const [rejected, setRejected] = useState<string[]>([]);
  const [weights, setWeights] = useState<Partial<Record<Axis, number>>>(() =>
    Object.fromEntries(
      AXES.map((a) => [a.id, a.id === "security" || a.id === "clean_core" ? 0.7 : 0.4]),
    ),
  );
  const [rationale, setRationale] = useState("");
  const [boardAnswers, setBoardAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<StudioResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("context");

  // Only react when the deep-link id changes — not when scenarios array identity changes
  useEffect(() => {
    if (!initialScenarioId || !scenarios.length) return;
    const i = scenarios.findIndex((s) => s.id === initialScenarioId);
    if (i >= 0) {
      setIdx(i);
      const r = resetCaseState();
      setSelected(r.selected);
      setRejected(r.rejected);
      setRationale(r.rationale);
      setBoardAnswers(r.boardAnswers);
      setResult(r.result);
      setPhase(r.phase);
      setSubmitError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialScenarioId]);

  const selectedOpt = useMemo(
    () => scenario?.options.find((o) => o.id === selected) ?? null,
    [scenario, selected],
  );

  // Select alone unlocks weights (reject still required before final submit).
  const canWeights = !!selected;
  const canBoard = !!selected;
  const canResult = !!result;
  const rejectReady = rejected.length >= 1;
  const boardFilled = scenario
    ? scenario.boardChallenges.every((c) => (boardAnswers[c.id] ?? "").trim().length >= 12)
    : false;

  function phaseUnlocked(p: Phase): boolean {
    if (p === "context" || p === "options") return true;
    if (p === "weights") return canWeights;
    if (p === "board") return canBoard;
    if (p === "result") return canResult;
    return false;
  }

  function goPhase(p: Phase) {
    if (!phaseUnlocked(p)) {
      if (p === "weights" || p === "board") {
        setSubmitError("Pick a primary design on Options first.");
        setPhase("options");
      } else if (p === "result") {
        setSubmitError("Submit your board defense to unlock Result.");
      }
      try {
        sfx.fail();
      } catch {
        /* ignore */
      }
      return;
    }
    setSubmitError(null);
    setPhase(p);
    try {
      sfx.click();
    } catch {
      /* ignore */
    }
  }

  function switchCase(i: number) {
    setIdx(i);
    const r = resetCaseState();
    setSelected(r.selected);
    setRejected(r.rejected);
    setRationale(r.rationale);
    setBoardAnswers(r.boardAnswers);
    setResult(r.result);
    setPhase(r.phase);
    setSubmitError(null);
    sfx.click();
  }

  function selectOption(id: string, e?: SyntheticEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    setSelected(id);
    setRejected((r) => r.filter((x) => x !== id));
    setResult(null);
    setSubmitError(null);
    setBusy(false);
    try {
      sfx.click();
    } catch {
      /* audio optional */
    }
  }

  function toggleReject(id: string, e?: SyntheticEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    setRejected((r) => {
      if (r.includes(id)) return r.filter((x) => x !== id);
      return [...r, id];
    });
    // Rejecting primary clears primary — pick another primary next
    setSelected((s) => (s === id ? "" : s));
    setResult(null);
    try {
      sfx.tick();
    } catch {
      /* audio optional */
    }
  }

  function continueToWeights(e?: SyntheticEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    if (!selected) {
      setSubmitError("Pick a primary design first (Make primary / Primary radio).");
      try {
        sfx.fail();
      } catch {
        /* ignore */
      }
      return;
    }
    setSubmitError(null);
    setBusy(false);
    setPhase("weights");
    try {
      sfx.success();
    } catch {
      /* ignore */
    }
  }

  function continueToBoard(e?: SyntheticEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    if (!selected) {
      setSubmitError("Select a primary option before the board.");
      setPhase("options");
      return;
    }
    setSubmitError(null);
    setPhase("board");
    try {
      sfx.click();
    } catch {
      /* ignore */
    }
  }

  if (!scenario) return <p className="muted">No architect scenarios loaded.</p>;

  async function submit() {
    if (!selected) {
      setSubmitError("Select a primary design option first.");
      setPhase("options");
      return;
    }
    if (rejected.length < 1) {
      setSubmitError("Reject at least one alternative (architect judgment requires trade-offs).");
      setPhase("options");
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      const res = await onSubmit(scenario.id, {
        selectedOptionId: selected,
        rejectedOptionIds: rejected,
        weights,
        rationale,
        boardAnswers,
      });
      setResult(res);
      setPhase("result");
      if (res.passed) sfx.success();
      else sfx.fail();
      onOpenLoop?.(`Revisit: ${scenario.title} — residual risks after your choice`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Submit failed — check API is running.");
      sfx.fail();
    } finally {
      setBusy(false);
    }
  }

  const flowSketch = flowForOption(selected || null);
  const gateHint = !selected
    ? "Step 1: click Select on your primary design."
    : !rejectReady
      ? "Primary locked. Optional but scored: Reject ≥1 alternative, then Weight criteria."
      : "Ready — open Weight criteria (or Board).";

  return (
    <div className="architect-studio" data-arena-build="2.1-wiring">
      <header className="studio-header">
        <div>
          <p className="hero-kicker">Architecture Arena · button fix</p>
          <h2>{scenario.title}</h2>
        </div>
        <div className="studio-nav">
          {scenarios.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`btn${i === idx ? " primary" : ""}`}
              onClick={() => switchCase(i)}
            >
              Case {i + 1}
            </button>
          ))}
        </div>
      </header>

      <div className="studio-phases" role="tablist" aria-label="Arena steps">
        {PHASES.map((p) => {
          const unlocked = phaseUnlocked(p);
          return (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={phase === p}
              className={`${phase === p ? "active" : ""}${!unlocked ? " locked" : ""}${unlocked && p !== phase ? " ready" : ""}`}
              onClick={() => goPhase(p)}
              title={
                unlocked
                  ? p
                  : p === "weights" || p === "board"
                    ? "Pick a primary design on Options first"
                    : "Submit defense to unlock result"
              }
            >
              {p}
              {!unlocked && p !== "context" && p !== "options" ? " 🔒" : ""}
            </button>
          );
        })}
      </div>

      <div className="studio-gate-bar" aria-live="polite">
        <span>
          Primary:{" "}
          <strong>{selectedOpt ? selectedOpt.title : "— none —"}</strong>
        </span>
        <span>
          Rejected: <strong>{rejected.length}</strong>
        </span>
        <span className={canWeights ? "gate-ok" : "gate-wait"}>{gateHint}</span>
      </div>

      {submitError && (
        <div className="alert" role="alert">
          {submitError}
        </div>
      )}

      {phase === "context" && (
        <div className="studio-grid">
          <section className="panel">
            <h3>Business context</h3>
            <p>{scenario.businessContext}</p>
            <h4>Constraints</h4>
            <ul>
              {scenario.constraints.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <h4>Non-negotiables</h4>
            <div className="tags">
              {scenario.nonNegotiables.map((n) => (
                <span key={n} className="tag fid">
                  {n}
                </span>
              ))}
            </div>
            <p className="muted" style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
              {scenario.note}
            </p>
            <div className="action-row">
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  setPhase("options");
                  sfx.click();
                }}
              >
                Enter options war room →
              </button>
            </div>
          </section>
          <section className="panel">
            <h3>Trust & flow sketch</h3>
            <TrustFlowDiagram
              title={flowSketch.title}
              nodes={flowSketch.nodes}
              edges={flowSketch.edges}
            />
            <p className="muted" style={{ fontSize: "0.8rem" }}>
              Red-tinted edges = trust stress points. After you pick an option, this flow updates to
              match that architecture.
            </p>
          </section>
        </div>
      )}

      {phase === "options" && (
        <section className="panel">
          <div className="pipe-banner" role="status">
            PIPELINE · Make primary on one card · Reject others (optional now) · CONTINUE TO WEIGHTS
          </div>
          <h3>Design options — pick primary, then continue</h3>
          <p className="muted" style={{ fontSize: "0.88rem" }}>
            Press <strong>Make primary</strong> on one design. Optionally <strong>Reject</strong>{" "}
            alternatives. Then <strong>CONTINUE TO WEIGHTS</strong>. Cards are not labels — every
            button has its own handler.
          </p>

          <div className="option-form">
            <div className="option-grid">
              {scenario.options.map((o) => {
                const isSel = selected === o.id;
                const isRej = rejected.includes(o.id);
                return (
                  <article
                    key={o.id}
                    className={`option-card${isSel ? " selected" : ""}${isRej ? " rejected" : ""}`}
                    data-option-id={o.id}
                  >
                    {(isSel || isRej) && (
                      <div className={`option-badge${isSel ? " sel" : " rej"}`}>
                        {isSel ? "PRIMARY" : "REJECTED"}
                      </div>
                    )}
                    <h4>{o.title}</h4>
                    <p>{o.summary}</p>
                    <p className="muted" style={{ fontSize: "0.8rem" }}>
                      <strong>Risks:</strong> {o.risks.join(" · ") || "—"}
                    </p>
                    <div className="option-native-row">
                      <label className="native-ctl" htmlFor={`primary-${o.id}`}>
                        <input
                          id={`primary-${o.id}`}
                          type="radio"
                          name="arena-primary"
                          value={o.id}
                          checked={isSel}
                          onChange={() => selectOption(o.id)}
                        />
                        Primary
                      </label>
                      <label className="native-ctl" htmlFor={`reject-${o.id}`}>
                        <input
                          id={`reject-${o.id}`}
                          type="checkbox"
                          checked={isRej}
                          disabled={isSel}
                          onChange={() => toggleReject(o.id)}
                        />
                        Reject
                      </label>
                    </div>
                    <div className="action-row option-actions">
                      <button
                        className={`btn${isSel ? " good" : " primary"}`}
                        type="button"
                        onClick={(e) => selectOption(o.id, e)}
                      >
                        {isSel ? "✓ Primary" : "Make primary"}
                      </button>
                      <button
                        className="btn"
                        type="button"
                        disabled={isSel}
                        onClick={(e) => toggleReject(o.id, e)}
                      >
                        {isRej ? "Un-reject" : "Reject"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            {selectedOpt && (
              <div className="studio-grid" style={{ marginTop: "1rem" }}>
                <section className="panel" style={{ margin: 0 }}>
                  <h4 style={{ marginTop: 0 }}>Piped architecture flow</h4>
                  <TrustFlowDiagram
                    title={flowSketch.title}
                    nodes={flowSketch.nodes}
                    edges={flowSketch.edges}
                  />
                </section>
                <section className="panel" style={{ margin: 0 }}>
                  <h4 style={{ marginTop: 0 }}>When to choose / reject</h4>
                  <p className="muted" style={{ fontSize: "0.85rem" }}>
                    <strong>Choose when:</strong> {selectedOpt.whenToChoose.join(" · ") || "—"}
                  </p>
                  <p className="muted" style={{ fontSize: "0.85rem" }}>
                    <strong>Reject when:</strong> {selectedOpt.whenToReject.join(" · ") || "—"}
                  </p>
                </section>
              </div>
            )}

            <div className="arena-sticky-cta">
              <div className="arena-sticky-status">
                {selectedOpt ? (
                  <>
                    Piped: <strong>{selectedOpt.title}</strong>
                    {rejectReady
                      ? ` · rejected ${rejected.length}`
                      : " · reject optional until board submit"}
                  </>
                ) : (
                  <>
                    No primary yet — click <strong>Make primary</strong> on a card.
                  </>
                )}
              </div>
              <button
                className="btn primary"
                type="button"
                disabled={!selected}
                onClick={(e) => continueToWeights(e)}
              >
                CONTINUE TO WEIGHTS →
              </button>
            </div>
          </div>
        </section>
      )}

      {phase === "weights" && (
        <>
          {!selectedOpt ? (
            <section className="panel">
              <h3>Weights locked</h3>
              <p className="muted">Select a primary option and reject at least one first.</p>
              <button className="btn primary" type="button" onClick={() => setPhase("options")}>
                ← Back to options
              </button>
            </section>
          ) : (
            <div className="studio-grid">
              <section className="panel">
                <h3>Priority weights (your judgment)</h3>
                <p className="muted">
                  Higher weight = more important for THIS context. Architecture is weighted choice
                  under constraints — not fashion.
                </p>
                <p className="muted" style={{ fontSize: "0.85rem" }}>
                  Primary: <strong>{selectedOpt.title}</strong>
                </p>
                {AXES.map((a) => (
                  <label key={a.id} className="weight-row">
                    <span>{a.label}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={weights[a.id] ?? 0.4}
                      onChange={(e) =>
                        setWeights((w) => ({ ...w, [a.id]: Number(e.target.value) }))
                      }
                    />
                    <span className="mono">{((weights[a.id] ?? 0) * 100).toFixed(0)}</span>
                  </label>
                ))}
                <label style={{ display: "grid", gap: "0.35rem", marginTop: "0.75rem" }}>
                  Rationale (cite constraints, risks, rejected alternative)
                  <textarea
                    className="console"
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    placeholder="I choose X because… I reject Y because… Non-negotiables…"
                    rows={4}
                  />
                </label>
                <div className="action-row">
                  <button
                    className="btn"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setPhase("options");
                    }}
                  >
                    ← Options
                  </button>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={(e) => continueToBoard(e)}
                  >
                    Face the board →
                  </button>
                </div>
              </section>
              <section className="panel">
                <h3>Radar — option fit vs your weights</h3>
                <TradeRadar scores={selectedOpt.scores} weights={weights} />
                <p className="muted" style={{ fontSize: "0.8rem" }}>
                  Cyan fill = option strengths · violet tint = your priorities
                </p>
                <TrustFlowDiagram
                  title={flowSketch.title}
                  nodes={flowSketch.nodes}
                  edges={flowSketch.edges}
                />
              </section>
            </div>
          )}
        </>
      )}

      {phase === "board" && (
        <section className="panel">
          <h3>Adversarial architecture board</h3>
          <p className="muted">
            Answer as if defending a multi-million landscape decision. Vague slogans fail. Aim for
            mechanism-level answers (identity, failure mode, ownership).
          </p>
          {!selected && (
            <div className="alert">
              No primary option selected.{" "}
              <button type="button" className="btn" onClick={() => setPhase("options")}>
                Pick options
              </button>
            </div>
          )}
          {scenario.boardChallenges.map((ch) => (
            <div key={ch.id} className="board-q">
              <div className="board-voice">{ch.voice}</div>
              <p>{ch.question}</p>
              <textarea
                className="console"
                value={boardAnswers[ch.id] ?? ""}
                onChange={(e) =>
                  setBoardAnswers((b) => ({ ...b, [ch.id]: e.target.value }))
                }
                placeholder="Mechanism-level answer (tokens, scopes, SLOs, ownership)…"
                rows={3}
              />
            </div>
          ))}
          <div className="action-row studio-cta-row">
            <button className="btn" type="button" onClick={() => setPhase("weights")}>
              ← Weights
            </button>
            <button
              className="btn good"
              type="button"
              disabled={busy || !selected}
              onClick={() => void submit()}
            >
              {busy ? "Submitting…" : "Submit defense"}
            </button>
            {!boardFilled && (
              <span className="gate-wait" style={{ fontSize: "0.8rem" }}>
                Tip: fill each board answer (≥12 chars) for a real score.
              </span>
            )}
          </div>
        </section>
      )}

      {phase === "result" && (
        <>
          {!result ? (
            <section className="panel">
              <h3>No result yet</h3>
              <p className="muted">Submit your board defense to unlock scoring.</p>
              <button className="btn primary" type="button" onClick={() => setPhase("board")}>
                ← Face the board
              </button>
            </section>
          ) : (
            <section className={`victory${result.passed ? "" : " fail"}`}>
              <p className="hero-kicker">
                {result.passed ? "Board provisional pass" : "Board demands revision"}
              </p>
              <div className="score">{(result.overall * 100).toFixed(0)}</div>
              <p className="muted">
                Prestige {result.prestigeDelta >= 0 ? "+" : ""}
                {result.prestigeDelta} · evidence of judgment, not XP
              </p>
              <div className="dim-bars">
                {Object.entries(result.dimensionScores).map(([k, v]) => (
                  <div className="row" key={k}>
                    <span>{k}</span>
                    <span className="bar">
                      <i style={{ width: `${Math.round(v * 100)}%` }} />
                    </span>
                    <span className="mono">{Math.round(v * 100)}</span>
                  </div>
                ))}
              </div>
              <ul style={{ textAlign: "left", maxWidth: 560, margin: "0 auto" }}>
                {result.feedback.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <div style={{ textAlign: "left", maxWidth: 560, margin: "1rem auto" }}>
                {result.boardResults.map((b) => (
                  <div key={b.id} className="feedback mentor" style={{ marginBottom: "0.5rem" }}>
                    {b.feedback}
                  </div>
                ))}
              </div>
              {selectedOpt && (
                <TradeRadar
                  scores={selectedOpt.scores}
                  weights={Object.fromEntries(result.radar.map((r) => [r.axis, r.weight]))}
                />
              )}
              <div className="action-row" style={{ justifyContent: "center" }}>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => {
                    setPhase("options");
                    setResult(null);
                    sfx.click();
                  }}
                >
                  Revise design
                </button>
                <button
                  className="btn violet"
                  type="button"
                  onClick={() => switchCase((idx + 1) % scenarios.length)}
                >
                  Next complex case
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export function FlowMeter({
  score,
  rank,
  prestige,
}: {
  score: number;
  rank: string;
  prestige: number;
}) {
  const hue = score > 70 ? 150 : score > 40 ? 200 : 20;
  return (
    <div className="flow-meter" title="Flow rises with successful learning — not time-on-site">
      <div className="flow-meter-top">
        <span>Flow</span>
        <strong>{Math.round(score)}</strong>
      </div>
      <div className="flow-track">
        <i style={{ width: `${score}%`, background: `hsl(${hue}, 70%, 55%)` }} />
      </div>
      <div className="flow-rank">
        <span>{rank}</span>
        <span className="mono">{prestige} pr</span>
      </div>
    </div>
  );
}

export function CuriosityHook({
  hook,
  onExplore,
}: {
  hook: string;
  onExplore: () => void;
}) {
  return (
    <button type="button" className="curiosity-card" onClick={onExplore}>
      <span className="curiosity-label">Open loop</span>
      <span>{hook}</span>
      <span className="curiosity-cta">Explore payoff →</span>
    </button>
  );
}

export function MasteryToast({
  title,
  detail,
  onClose,
}: {
  title: string;
  detail: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 5200);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="mastery-toast" role="status">
      <strong>{title}</strong>
      <span className="muted" style={{ fontSize: "0.85rem" }}>
        {detail}
      </span>
      <button type="button" className="btn" onClick={onClose}>
        Dismiss
      </button>
    </div>
  );
}
