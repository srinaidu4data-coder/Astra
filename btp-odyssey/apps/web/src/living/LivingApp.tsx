/**
 * BTP Odyssey: The Living Enterprise — production successor shell (R1).
 * Guest cold-start → living incident loop → debrief → retrieval → portfolio.
 * Ethical engagement; progressive disclosure; a11y modes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./living.css";

type Route =
  | "gate"
  | "continue"
  | "incident"
  | "constellation"
  | "review"
  | "portfolio"
  | "preferences"
  | "legacy";

type Persona = { id: string; label: string; path: string };

type Bootstrap = {
  product: {
    name: string;
    version: string;
    fidelityDefault: string;
    ethics: string;
  };
  learner: {
    displayName: string;
    settings: Record<string, unknown>;
    completedMissions: string[];
    evidence: unknown[];
    engagement?: {
      prestige?: number;
      architectRank?: string;
      challengesCleared?: string[];
    };
  };
  domains: { id: string; title: string; summary?: string }[];
  conceptCount: number;
  missionCount: number;
  totalChallenges: number;
  nextChallenge: { id: string; title: string; conceptId?: string; variant?: string } | null;
  beginnerPathIds: string[];
  flagshipIncident: {
    id: string;
    missionId: string;
    title: string;
    estimatedMinutes: number;
    fidelityTier: string;
    hook: string;
  };
  personas: Persona[];
};

type LoopPhase =
  | "hook"
  | "diagnose"
  | "inspect"
  | "architect"
  | "configure"
  | "test"
  | "observe"
  | "tradeoffs"
  | "debrief"
  | "remediate"
  | "retrieval"
  | "portfolio";

const PHASES: { id: LoopPhase; label: string }[] = [
  { id: "hook", label: "Hook" },
  { id: "diagnose", label: "Diagnose" },
  { id: "inspect", label: "Inspect" },
  { id: "architect", label: "Architect" },
  { id: "configure", label: "Configure" },
  { id: "test", label: "Test" },
  { id: "observe", label: "Observe" },
  { id: "tradeoffs", label: "Tradeoffs" },
  { id: "debrief", label: "Debrief" },
  { id: "remediate", label: "Remediate" },
  { id: "retrieval", label: "Retrieval" },
  { id: "portfolio", label: "Portfolio" },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${path}: ${t}`);
  }
  return res.json() as Promise<T>;
}

function Cinema({ caption, lowStim }: { caption: string; lowStim: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (lowStim) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let t = 0;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    function resize() {
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    function frame() {
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      t += 0.016;
      const g = ctx!.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#020617");
      g.addColorStop(1, "#0f172a");
      ctx!.fillStyle = g;
      ctx!.fillRect(0, 0, w, h);
      for (let i = 0; i < 3; i++) {
        ctx!.beginPath();
        for (let x = 0; x <= w; x += 6) {
          const y = h * (0.35 + i * 0.12) + Math.sin(x * 0.02 + t + i) * 12;
          if (x === 0) ctx!.moveTo(x, y);
          else ctx!.lineTo(x, y);
        }
        ctx!.strokeStyle = `rgba(56,189,248,${0.15 - i * 0.03})`;
        ctx!.lineWidth = 2;
        ctx!.stroke();
      }
      const cx = w * 0.7;
      const cy = h * 0.4;
      const rg = ctx!.createRadialGradient(cx, cy, 4, cx, cy, 50 + Math.sin(t) * 8);
      rg.addColorStop(0, "rgba(167,139,250,0.45)");
      rg.addColorStop(1, "transparent");
      ctx!.fillStyle = rg;
      ctx!.beginPath();
      ctx!.arc(cx, cy, 60, 0, Math.PI * 2);
      ctx!.fill();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [lowStim]);

  return (
    <div className="le-cinema" role="img" aria-label={caption}>
      {!lowStim && <canvas ref={ref} className="le-cinema-canvas" aria-hidden />}
      {lowStim && (
        <div style={{ minHeight: 160, background: "#0b1220" }} aria-hidden />
      )}
      <div className="le-cinema-caption">{caption}</div>
    </div>
  );
}

export function LivingApp() {
  const [route, setRoute] = useState<Route>("gate");
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [persona, setPersona] = useState("beginner");
  const [displayName, setDisplayName] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<LoopPhase>("hook");
  const [phaseDone, setPhaseDone] = useState<Set<LoopPhase>>(() => new Set());
  const [incidentMeta, setIncidentMeta] = useState<{
    title: string;
    summary: string;
    estimatedMinutes: number;
    fidelity: { tier?: string };
    naturalStoppingPoints?: string[];
  } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [diagnosis, setDiagnosis] = useState("");
  const [architecture, setArchitecture] = useState("destination+cap");
  const [configNote, setConfigNote] = useState("");
  const [debrief, setDebrief] = useState({
    whatHappened: "",
    rootCause: "",
    fix: "",
    tradeoffs: "",
  });
  const [artifact, setArtifact] = useState<unknown>(null);
  const [review, setReview] = useState<{ items: { id?: string; prompt?: string }[] } | null>(
    null,
  );
  const [sessionStart] = useState(() => Date.now());
  const [breakNudge, setBreakNudge] = useState(false);

  const settings = boot?.learner?.settings ?? {};
  const lowStim = Boolean(settings.lowStimulation || settings.reducedMotion);
  const silent = Boolean(settings.silentMode);
  const goalMin = Number(settings.sessionGoalMinutes ?? 25);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.reducedMotion || settings.lowStimulation) {
      root.dataset.reducedMotion = "true";
    }
    if (settings.highContrast) root.dataset.contrast = "high";
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b = await api<Bootstrap>("/api/living/bootstrap");
        if (cancelled) return;
        setBoot(b);
        setDisplayName(b.learner.displayName || "");
        setPersona(String(b.learner.settings?.persona || "beginner"));
        const cleared = b.learner.engagement?.challengesCleared?.length ?? 0;
        if (cleared > 0 || (b.learner.completedMissions?.length ?? 0) > 0) {
          setRoute("continue");
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!goalMin || goalMin < 5) return;
    const t = window.setTimeout(
      () => setBreakNudge(true),
      goalMin * 60 * 1000,
    );
    return () => window.clearTimeout(t);
  }, [goalMin, sessionStart]);

  const startGuestIncident = useCallback(async () => {
    setBusy(true);
    setError(null);
    const t0 = performance.now();
    try {
      const res = await api<{
        sessionId: string;
        incident: { title: string; summary: string };
        estimatedMinutes: number;
        fidelity: { tier?: string };
        naturalStoppingPoints?: string[];
        world?: { logs?: { message?: string; level?: string }[] };
      }>("/api/living/guest-incident", {
        method: "POST",
        body: JSON.stringify({ persona, displayName: displayName || undefined }),
      });
      setSessionId(res.sessionId);
      setIncidentMeta({
        title: res.incident.title,
        summary: res.incident.summary,
        estimatedMinutes: res.estimatedMinutes,
        fidelity: res.fidelity,
        naturalStoppingPoints: res.naturalStoppingPoints,
      });
      const worldLogs = (res.world?.logs ?? [])
        .slice(-8)
        .map((l) => `${l.level ?? "info"}: ${l.message ?? JSON.stringify(l)}`);
      setLogs(
        worldLogs.length
          ? worldLogs
          : [
              "warn: order-status CAP service returned empty collection",
              "error: destination Northwind_API audience mismatch (simulated)",
              "info: IAS token issued for app OrderInsights",
            ],
      );
      setPhase("hook");
      setPhaseDone(new Set());
      setRoute("incident");
      const elapsed = performance.now() - t0;
      if (elapsed > 60000) {
        console.warn("Guest incident exceeded 60s cold start", elapsed);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [persona, displayName]);

  const markPhase = (p: LoopPhase) => {
    setPhaseDone((prev) => new Set(prev).add(p));
  };

  const advance = () => {
    const idx = PHASES.findIndex((p) => p.id === phase);
    markPhase(phase);
    const next = PHASES[idx + 1];
    if (next) setPhase(next.id);
  };

  const savePrefs = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/learner/settings", {
        method: "PUT",
        body: JSON.stringify({
          settings: { ...settings, ...patch, livingEnterprise: true },
          displayName: displayName || undefined,
        }),
      });
      const b = await api<Bootstrap>("/api/living/bootstrap");
      setBoot(b);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitDebrief = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ artifact: unknown; retrieval: unknown }>(
        "/api/living/debrief",
        {
          method: "POST",
          body: JSON.stringify({ sessionId, ...debrief }),
        },
      );
      setArtifact(res.artifact);
      markPhase("debrief");
      setPhase("remediate");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadReview = async () => {
    try {
      const q = await api<{ items: { id?: string; prompt?: string }[] }>(
        "/api/living/review-queue",
      );
      setReview(q);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const nav: { id: Route; label: string }[] = useMemo(
    () => [
      { id: "continue", label: "Continue" },
      { id: "incident", label: "Incident" },
      { id: "constellation", label: "Constellation" },
      { id: "review", label: "Review" },
      { id: "portfolio", label: "Portfolio" },
      { id: "preferences", label: "Preferences" },
    ],
    [],
  );

  if (!boot && !error) {
    return (
      <div className="living-root">
        <div className="living-shell">
          <div className="le-panel">Loading Living Enterprise…</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="living-root"
      data-low-stim={lowStim ? "true" : "false"}
      data-silent={silent ? "true" : "false"}
    >
      <div className="living-shell">
        <header className="le-topbar">
          <div className="le-brand">
            <strong>BTP Odyssey: The Living Enterprise</strong>
            <span>
              {boot?.product.version ?? "3.0.0"} · Tier{" "}
              {boot?.product.fidelityDefault ?? "tier2_behavioral"} simulation · Independent of SAP
            </span>
          </div>
          <nav className="le-nav" aria-label="Primary">
            {nav.map((n) => (
              <button
                key={n.id}
                type="button"
                aria-current={route === n.id ? "page" : undefined}
                onClick={() => {
                  setRoute(n.id);
                  if (n.id === "review") void loadReview();
                }}
              >
                {n.label}
              </button>
            ))}
            <button type="button" onClick={() => setRoute("legacy")}>
              Legacy shell
            </button>
          </nav>
        </header>

        {error && (
          <div className="le-banner error" role="alert">
            {error}
          </div>
        )}
        {breakNudge && (
          <div className="le-banner ethics" role="status">
            Natural stop: your {goalMin}-minute session goal is up. Progress is saved — breaks never
            cost mastery.{" "}
            <button type="button" className="le-btn ghost" onClick={() => setBreakNudge(false)}>
              Continue calmly
            </button>
          </div>
        )}

        {route === "gate" && boot && (
          <section className="le-panel le-hero">
            <div className="le-hero-grid">
              <div>
                <div className="le-kicker">Guest · no login · under 60s</div>
                <h1>Master SAP BTP by healing a living enterprise.</h1>
                <p className="lead">
                  Diagnose incidents, reason about architecture, configure a deterministic
                  simulator, and leave with portfolio-quality evidence — not loot boxes or streak
                  shame.
                </p>
                <div className="le-meta">
                  <span className="le-chip good">Ethical engagement</span>
                  <span className="le-chip">
                    {boot.conceptCount} concepts · {boot.totalChallenges} practice games
                  </span>
                  <span className="le-chip warn">
                    ~{boot.flagshipIncident.estimatedMinutes} min ·{" "}
                    {boot.flagshipIncident.fidelityTier}
                  </span>
                </div>
                <div className="le-banner ethics">{boot.product.ethics}</div>
                <label className="le-field">
                  <span>Display name (optional)</span>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Local Learner"
                  />
                </label>
                <p className="lead" style={{ fontSize: "0.82rem" }}>
                  Who are you becoming?
                </p>
                <div className="le-persona-grid">
                  {boot.personas.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`le-persona${persona === p.id ? " active" : ""}`}
                      onClick={() => setPersona(p.id)}
                    >
                      <strong>{p.label}</strong>
                      <span>Path: {p.path}</span>
                    </button>
                  ))}
                </div>
                <div className="le-actions">
                  <button
                    type="button"
                    className="le-btn primary"
                    disabled={busy}
                    onClick={() => void startGuestIncident()}
                  >
                    {busy ? "Opening incident…" : "Enter living incident (no login)"}
                  </button>
                  <button
                    type="button"
                    className="le-btn"
                    onClick={() => setRoute("preferences")}
                  >
                    Accessibility & session goals
                  </button>
                  <button type="button" className="le-btn ghost" onClick={() => setRoute("continue")}>
                    Continue dashboard
                  </button>
                </div>
              </div>
              <Cinema
                lowStim={lowStim}
                caption={boot.flagshipIncident.hook}
              />
            </div>
          </section>
        )}

        {route === "continue" && boot && (
          <section className="le-panel">
            <div className="le-kicker">Continue learning</div>
            <h2 style={{ marginTop: 0 }}>Welcome back, {boot.learner.displayName}</h2>
            <div className="le-meta">
              <span className="le-chip">
                Rank {boot.learner.engagement?.architectRank ?? "Apprentice"} (optional prestige)
              </span>
              <span className="le-chip">
                Cleared {boot.learner.engagement?.challengesCleared?.length ?? 0} /{" "}
                {boot.totalChallenges}
              </span>
              <span className="le-chip">
                Missions done {boot.learner.completedMissions?.length ?? 0}
              </span>
            </div>
            <div className="le-card-list">
              <article className="le-card">
                <h3>Flagship living incident</h3>
                <p>{boot.flagshipIncident.title} — {boot.flagshipIncident.hook}</p>
                <div className="le-actions">
                  <button
                    type="button"
                    className="le-btn primary"
                    disabled={busy}
                    onClick={() => void startGuestIncident()}
                  >
                    Start / resume incident
                  </button>
                </div>
              </article>
              <article className="le-card">
                <h3>Next practice gate</h3>
                <p>
                  {boot.nextChallenge
                    ? `${boot.nextChallenge.title} (${boot.nextChallenge.variant ?? "step"})`
                    : "All gates clear — schedule transfer review."}
                </p>
                <div className="le-actions">
                  <button
                    type="button"
                    className="le-btn"
                    onClick={() => setRoute("legacy")}
                  >
                    Open practice campaign (legacy PLAY)
                  </button>
                </div>
              </article>
              <article className="le-card">
                <h3>Natural stop</h3>
                <p>
                  Session goal {goalMin} minutes. Quiet hours and grace streaks are optional —
                  missing a day never removes evidence.
                </p>
              </article>
            </div>
            <div className="le-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="le-btn ghost" onClick={() => setRoute("gate")}>
                Back to gate
              </button>
            </div>
          </section>
        )}

        {route === "incident" && (
          <section className="le-panel">
            <div className="le-kicker">Core loop · process evidence</div>
            <h2 style={{ marginTop: 0 }}>
              {incidentMeta?.title ?? "Living incident"}
            </h2>
            <p className="lead">{incidentMeta?.summary}</p>
            <div className="le-meta">
              <span className="le-chip warn">
                ~{incidentMeta?.estimatedMinutes ?? 25} min
              </span>
              <span className="le-chip">
                Fidelity {incidentMeta?.fidelity?.tier ?? "tier2_behavioral"}
              </span>
              <span className="le-chip">Session {sessionId ?? "—"}</span>
            </div>
            <div className="le-stepper" aria-label="Incident phases">
              {PHASES.map((p) => (
                <span
                  key={p.id}
                  className={`le-step${phase === p.id ? " active" : ""}${phaseDone.has(p.id) ? " done" : ""}`}
                >
                  {p.label}
                </span>
              ))}
            </div>

            {phase === "hook" && (
              <>
                <Cinema
                  lowStim={lowStim}
                  caption="Cinematic hook (skippable): Order Insights is dark. Customers and sales are blocked. You have one working session."
                />
                <p className="lead" style={{ marginTop: "0.75rem" }}>
                  Equivalent text: A CAP-based Order Insights app returns empty order status. Board
                  wants a fix without violating clean-core or opening Admin.All.
                </p>
                <div className="le-actions">
                  <button type="button" className="le-btn primary" onClick={advance}>
                    Skip to diagnose
                  </button>
                </div>
              </>
            )}

            {phase === "diagnose" && (
              <>
                <p className="lead">Form a hypothesis before changing production-like config.</p>
                <div className="le-field">
                  <label htmlFor="diag">Hypothesis</label>
                  <textarea
                    id="diag"
                    value={diagnosis}
                    onChange={(e) => setDiagnosis(e.target.value)}
                    placeholder="e.g. Destination audience mismatch or missing principal propagation"
                  />
                </div>
                <div className="le-actions">
                  <button
                    type="button"
                    className="le-btn primary"
                    disabled={diagnosis.trim().length < 8}
                    onClick={advance}
                  >
                    Lock hypothesis → inspect
                  </button>
                </div>
              </>
            )}

            {phase === "inspect" && (
              <>
                <p className="lead">Simulated logs / metrics / traces (deterministic sandbox).</p>
                <div className="le-log" role="log">
                  {logs.map((l) => (
                    <div
                      key={l}
                      className={l.startsWith("error") ? "err" : l.startsWith("warn") ? "" : "ok"}
                    >
                      {l}
                    </div>
                  ))}
                </div>
                <div className="le-actions">
                  <button type="button" className="le-btn primary" onClick={advance}>
                    Proceed to architecture
                  </button>
                </div>
              </>
            )}

            {phase === "architect" && (
              <>
                <p className="lead">Select an architecture approach and name the tradeoff.</p>
                <div className="le-field">
                  <label htmlFor="arch">Architecture choice</label>
                  <select
                    id="arch"
                    value={architecture}
                    onChange={(e) => setArchitecture(e.target.value)}
                  >
                    <option value="destination+cap">
                      Fix destination + CAP service binding (minimal blast radius)
                    </option>
                    <option value="rebuild-rap">
                      Rebuild in RAP on stack (higher effort, clean-core alignment)
                    </option>
                    <option value="admin-all">
                      Temporarily Admin.All (unsafe — will be rejected in debrief)
                    </option>
                  </select>
                </div>
                <div className="le-actions">
                  <button type="button" className="le-btn primary" onClick={advance}>
                    Configure simulator
                  </button>
                </div>
              </>
            )}

            {phase === "configure" && (
              <>
                <p className="lead">
                  Document the config change you would apply in the labeled Tier-2 simulator.
                </p>
                <div className="le-field">
                  <label htmlFor="cfg">Configuration note</label>
                  <textarea
                    id="cfg"
                    value={configNote}
                    onChange={(e) => setConfigNote(e.target.value)}
                    placeholder="Update destination OAuth audience; rebind CAP; redeploy MTA module X"
                  />
                </div>
                <div className="le-actions">
                  <button
                    type="button"
                    className="le-btn primary"
                    disabled={configNote.trim().length < 8}
                    onClick={advance}
                  >
                    Run test
                  </button>
                </div>
              </>
            )}

            {phase === "test" && (
              <>
                <p className="lead">
                  {architecture === "admin-all"
                    ? "Test result: SHORT-TERM green, audit FAIL. This path is a trap."
                    : "Test result: Order status returns 200 with rows. Negative auth test still required."}
                </p>
                <div className="le-actions">
                  <button type="button" className="le-btn primary" onClick={advance}>
                    Observe consequences
                  </button>
                </div>
              </>
            )}

            {phase === "observe" && (
              <>
                <p className="lead">
                  Customers recover. Cost meter: low. Residual risk: document destination ownership
                  and monitoring on the CAP route.
                </p>
                <div className="le-actions">
                  <button type="button" className="le-btn primary" onClick={advance}>
                    Explain tradeoffs
                  </button>
                </div>
              </>
            )}

            {phase === "tradeoffs" && (
              <>
                <p className="lead">
                  Minimal destination fix ships fastest; RAP rebuild is cleaner long-term; Admin.All
                  is never acceptable in this landscape.
                </p>
                <div className="le-actions">
                  <button type="button" className="le-btn primary" onClick={advance}>
                    Blameless debrief
                  </button>
                </div>
              </>
            )}

            {phase === "debrief" && (
              <>
                <div className="le-grid-2">
                  <div className="le-field">
                    <label>What happened</label>
                    <textarea
                      value={debrief.whatHappened}
                      onChange={(e) =>
                        setDebrief((d) => ({ ...d, whatHappened: e.target.value }))
                      }
                    />
                  </div>
                  <div className="le-field">
                    <label>Root cause (systems, not people)</label>
                    <textarea
                      value={debrief.rootCause}
                      onChange={(e) =>
                        setDebrief((d) => ({ ...d, rootCause: e.target.value }))
                      }
                    />
                  </div>
                  <div className="le-field">
                    <label>Fix applied</label>
                    <textarea
                      value={debrief.fix}
                      onChange={(e) => setDebrief((d) => ({ ...d, fix: e.target.value }))}
                    />
                  </div>
                  <div className="le-field">
                    <label>Tradeoffs accepted</label>
                    <textarea
                      value={debrief.tradeoffs}
                      onChange={(e) =>
                        setDebrief((d) => ({ ...d, tradeoffs: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="le-actions">
                  <button
                    type="button"
                    className="le-btn primary"
                    disabled={busy}
                    onClick={() => void submitDebrief()}
                  >
                    Save debrief artifact
                  </button>
                </div>
              </>
            )}

            {phase === "remediate" && (
              <>
                <p className="lead">
                  Targeted remediation: re-open concept cards for Destinations, JWT audience, and CAP
                  bindings. Optional how/when arcade remains free to play.
                </p>
                <div className="le-actions">
                  <button type="button" className="le-btn" onClick={() => setRoute("legacy")}>
                    Open Atlas / practice games
                  </button>
                  <button type="button" className="le-btn primary" onClick={advance}>
                    Schedule retrieval
                  </button>
                </div>
              </>
            )}

            {phase === "retrieval" && (
              <>
                <p className="lead">
                  Spaced prompt (due in ~3 days, optional): How would you run the same diagnosis on
                  a different BTP landscape?
                </p>
                <div className="le-banner ethics">
                  Missing the review day never removes your debrief evidence.
                </div>
                <div className="le-actions">
                  <button type="button" className="le-btn primary" onClick={advance}>
                    Portfolio artifact
                  </button>
                </div>
              </>
            )}

            {phase === "portfolio" && (
              <>
                <p className="lead">
                  Portfolio-quality practice artifact saved locally. Not SAP certification.
                </p>
                {artifact ? (
                  <pre className="le-log">{JSON.stringify(artifact, null, 2)}</pre>
                ) : (
                  <p className="lead">Complete debrief to mint artifact.</p>
                )}
                <div className="le-actions">
                  <button type="button" className="le-btn primary" onClick={() => setRoute("portfolio")}>
                    View portfolio
                  </button>
                  <button type="button" className="le-btn" onClick={() => setRoute("continue")}>
                    Natural stop → dashboard
                  </button>
                </div>
              </>
            )}

            {incidentMeta?.naturalStoppingPoints && (
              <p className="le-disclaimer">
                Natural stops: {incidentMeta.naturalStoppingPoints.join(" · ")}
              </p>
            )}
          </section>
        )}

        {route === "constellation" && boot && (
          <section className="le-panel">
            <div className="le-kicker">Mastery constellation</div>
            <h2 style={{ marginTop: 0 }}>Domains in the living enterprise</h2>
            <p className="lead">
              Progressive disclosure: explore one district at a time. Full campaign remains available
              without a feature wall.
            </p>
            <div className="le-card-list">
              {boot.domains.map((d) => (
                <article key={d.id} className="le-card">
                  <h3>{d.title}</h3>
                  <p>{d.summary || d.id}</p>
                </article>
              ))}
            </div>
            <div className="le-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="le-btn" onClick={() => setRoute("legacy")}>
                Open full Atlas (legacy)
              </button>
            </div>
          </section>
        )}

        {route === "review" && (
          <section className="le-panel">
            <div className="le-kicker">Spaced review queue</div>
            <h2 style={{ marginTop: 0 }}>Retrieval practice</h2>
            <div className="le-banner ethics">
              Optional. No FOMO timers. No progress loss for resting.
            </div>
            <div className="le-card-list">
              {(review?.items?.length ? review.items : [{ prompt: "No items yet — complete a debrief first." }]).map(
                (item, i) => (
                  <article key={item.id ?? i} className="le-card">
                    <h3>Transfer check</h3>
                    <p>{item.prompt}</p>
                  </article>
                ),
              )}
            </div>
          </section>
        )}

        {route === "portfolio" && boot && (
          <section className="le-panel">
            <div className="le-kicker">Portfolio · privacy local</div>
            <h2 style={{ marginTop: 0 }}>Evidence of skills</h2>
            <p className="lead">
              Artifacts stay on this runtime until you export. Not official certification.
            </p>
            <pre className="le-log">
              {JSON.stringify(boot.learner.evidence?.slice(-5) ?? [], null, 2)}
            </pre>
            <div className="le-actions">
              <button
                type="button"
                className="le-btn"
                onClick={() => {
                  void api("/api/export").then((data) => {
                    const blob = new Blob([JSON.stringify(data, null, 2)], {
                      type: "application/json",
                    });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = "btp-living-enterprise-export.json";
                    a.click();
                  });
                }}
              >
                Export progress JSON
              </button>
            </div>
          </section>
        )}

        {route === "preferences" && (
          <section className="le-panel">
            <div className="le-kicker">Agency · accessibility · ethics</div>
            <h2 style={{ marginTop: 0 }}>Preferences</h2>
            <div className="le-toggle-row">
              <span>Reduced motion</span>
              <button
                type="button"
                className="le-btn ghost"
                onClick={() => void savePrefs({ reducedMotion: !settings.reducedMotion })}
              >
                {settings.reducedMotion ? "On" : "Off"}
              </button>
            </div>
            <div className="le-toggle-row">
              <span>Low stimulation</span>
              <button
                type="button"
                className="le-btn ghost"
                onClick={() => void savePrefs({ lowStimulation: !settings.lowStimulation })}
              >
                {settings.lowStimulation ? "On" : "Off"}
              </button>
            </div>
            <div className="le-toggle-row">
              <span>High contrast</span>
              <button
                type="button"
                className="le-btn ghost"
                onClick={() => void savePrefs({ highContrast: !settings.highContrast })}
              >
                {settings.highContrast ? "On" : "Off"}
              </button>
            </div>
            <div className="le-toggle-row">
              <span>Silent mode (no SFX intent)</span>
              <button
                type="button"
                className="le-btn ghost"
                onClick={() => void savePrefs({ silentMode: !settings.silentMode })}
              >
                {settings.silentMode ? "On" : "Off"}
              </button>
            </div>
            <div className="le-toggle-row">
              <span>Data saver</span>
              <button
                type="button"
                className="le-btn ghost"
                onClick={() => void savePrefs({ dataSaver: !settings.dataSaver })}
              >
                {settings.dataSaver ? "On" : "Off"}
              </button>
            </div>
            <div className="le-toggle-row">
              <span>Grace streak opt-in (non-punitive)</span>
              <button
                type="button"
                className="le-btn ghost"
                onClick={() => void savePrefs({ graceStreakOptIn: !settings.graceStreakOptIn })}
              >
                {settings.graceStreakOptIn ? "On" : "Off"}
              </button>
            </div>
            <div className="le-field" style={{ marginTop: "0.75rem" }}>
              <label htmlFor="goal">Session goal (minutes)</label>
              <input
                id="goal"
                type="number"
                min={10}
                max={120}
                defaultValue={goalMin}
                onBlur={(e) =>
                  void savePrefs({ sessionGoalMinutes: Number(e.target.value) || 25 })
                }
              />
            </div>
            <div className="le-field">
              <label htmlFor="break">Break reminder (minutes)</label>
              <input
                id="break"
                type="number"
                min={15}
                max={180}
                defaultValue={Number(settings.sessionBreakMinutes ?? 50)}
                onBlur={(e) =>
                  void savePrefs({ sessionBreakMinutes: Number(e.target.value) || 50 })
                }
              />
            </div>
            <div className="le-banner ethics">
              Notifications stay opt-in. No artificial scarcity. Pause anytime.
            </div>
          </section>
        )}

        {route === "legacy" && (
          <section className="le-panel">
            <div className="le-kicker">Bridge</div>
            <h2 style={{ marginTop: 0 }}>Legacy mega-teach shell</h2>
            <p className="lead">
              Full PLAY campaign, Atlas arcade, Architect studio, and missions remain available.
              Reload with <code>?legacy=1</code> for the previous default shell, or continue below
              after we hot-swap.
            </p>
            <div className="le-actions">
              <button
                type="button"
                className="le-btn primary"
                onClick={() => {
                  const url = new URL(window.location.href);
                  url.searchParams.set("legacy", "1");
                  window.location.href = url.toString();
                }}
              >
                Open legacy shell
              </button>
              <button type="button" className="le-btn" onClick={() => setRoute("continue")}>
                Back to Living Enterprise
              </button>
            </div>
          </section>
        )}

        <p className="le-disclaimer">
          Independent learning product. Not affiliated with or endorsed by SAP SE. SAP and product
          names are trademarks of their respective owners. Simulations are not live SAP BTP.
          Completing missions does not grant certification or employment. Evidence audit:
          docs/LIVING_ENTERPRISE_AUDIT.md (2026-08-08).
        </p>
      </div>
    </div>
  );
}
