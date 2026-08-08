/**
 * BTP Odyssey: The Living Enterprise — production successor (R1.1).
 * Evidence-first: guest incident <60s, real sim diagnose/fix, progressive IA,
 * ethical engagement, a11y modes, portfolio, review queue, constellation search.
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
  | "register"
  | "diagnostic"
  | "glossary"
  | "notes"
  | "sandbox"
  | "teams"
  | "support"
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

const DIAG_QUESTIONS = [
  { id: "btp", label: "SAP BTP as a platform" },
  { id: "cap", label: "CAP / OData services" },
  { id: "dest", label: "Destinations & identity" },
  { id: "int", label: "Integration / events" },
  { id: "ops", label: "Ops, SLO, incidents" },
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

function Cinema({
  caption,
  transcript,
  lowStim,
}: {
  caption: string;
  transcript: string;
  lowStim: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [showTranscript, setShowTranscript] = useState(false);
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
    <div className="le-cinema" role="region" aria-label="Skippable cinematic">
      {!lowStim && <canvas ref={ref} className="le-cinema-canvas" aria-hidden />}
      {lowStim && <div style={{ minHeight: 160, background: "#0b1220" }} aria-hidden />}
      <div className="le-cinema-caption">
        <p style={{ margin: 0 }}>{caption}</p>
        <button
          type="button"
          className="le-btn ghost"
          style={{ marginTop: "0.4rem", padding: "0.25rem 0.5rem", fontSize: "0.72rem" }}
          onClick={() => setShowTranscript((s) => !s)}
        >
          {showTranscript ? "Hide" : "Show"} transcript / audio description
        </button>
        {showTranscript && (
          <p style={{ margin: "0.4rem 0 0", color: "#cbd5e1" }}>{transcript}</p>
        )}
      </div>
    </div>
  );
}

export function LivingApp() {
  const [route, setRoute] = useState<Route>("gate");
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [persona, setPersona] = useState("beginner");
  const [displayName, setDisplayName] = useState("");
  const [careerGoal, setCareerGoal] = useState("btp-developer");
  const [certInterest, setCertInterest] = useState("none");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<LoopPhase>("hook");
  const [phaseDone, setPhaseDone] = useState<Set<LoopPhase>>(() => new Set());
  const [incidentMeta, setIncidentMeta] = useState<{
    title: string;
    summary: string;
    estimatedMinutes: number;
    fidelity: { tier?: string };
    naturalStoppingPoints?: string[];
    businessImpact?: string;
  } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<string[]>([]);
  const [diagnosis, setDiagnosis] = useState("");
  const [diagResult, setDiagResult] = useState<{
    correct: boolean;
    feedback: string;
    rootCause?: string;
  } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [hintLevel, setHintLevel] = useState(0);
  const [architecture, setArchitecture] = useState("destination+cap");
  const [configNote, setConfigNote] = useState("");
  const [fixMsg, setFixMsg] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<{
    overallScore: number;
    passed: boolean;
    summary: string;
    disclaimer: string;
  } | null>(null);
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
  const [searchQ, setSearchQ] = useState("");
  const [constellation, setConstellation] = useState<{
    concepts: { id: string; title: string; domainId: string; summary: string }[];
    domains: { id: string; title: string }[];
    totalMatched: number;
  } | null>(null);
  const [glossary, setGlossary] = useState<{ term: string; definition: string }[]>([]);
  const [notes, setNotes] = useState<{ id: string; text: string; bookmark?: boolean }[]>([]);
  const [noteText, setNoteText] = useState("");
  const [diagAnswers, setDiagAnswers] = useState<Record<string, string>>({});
  const [diagResultPath, setDiagResultPath] = useState<{
    level: string;
    recommendations: string[];
  } | null>(null);
  const [sandbox, setSandbox] = useState<Record<string, unknown> | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState("");
  const [feedbackOk, setFeedbackOk] = useState<string | null>(null);
  const [sessionStart] = useState(() => Date.now());
  const [breakNudge, setBreakNudge] = useState(false);
  const [coldStartMs, setColdStartMs] = useState<number | null>(null);

  const settings = boot?.learner?.settings ?? {};
  const lowStim = Boolean(settings.lowStimulation || settings.reducedMotion || settings.lowPower);
  const silent = Boolean(settings.silentMode);
  const goalMin = Number(settings.sessionGoalMinutes ?? 25);
  const dataSaver = Boolean(settings.dataSaver);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.reducedMotion =
      settings.reducedMotion || settings.lowStimulation || settings.lowPower ? "true" : "false";
    if (settings.highContrast) root.dataset.contrast = "high";
  }, [settings]);

  const refreshBoot = useCallback(async () => {
    const b = await api<Bootstrap>("/api/living/bootstrap");
    setBoot(b);
    setDisplayName(b.learner.displayName || "");
    setPersona(String(b.learner.settings?.persona || "beginner"));
    return b;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b = await refreshBoot();
        if (cancelled) return;
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
  }, [refreshBoot]);

  useEffect(() => {
    if (!goalMin || goalMin < 5) return;
    const t = window.setTimeout(() => setBreakNudge(true), goalMin * 60 * 1000);
    return () => window.clearTimeout(t);
  }, [goalMin, sessionStart]);

  const loadWorld = async (sid: string) => {
    const w = await api<{
      logs: { level: string; message: string; resourceId?: string }[];
      metrics: { name: string; value: number; unit?: string; resourceId?: string }[];
    }>(`/api/sessions/${sid}/world`);
    setLogs(
      (w.logs ?? []).slice(-12).map((l) => `${l.level}: [${l.resourceId ?? "?"}] ${l.message}`),
    );
    setMetrics(
      (w.metrics ?? [])
        .slice(-8)
        .map((m) => `${m.name}=${m.value}${m.unit ? m.unit : ""} @ ${m.resourceId ?? ""}`),
    );
  };

  const startGuestIncident = useCallback(async () => {
    if (offline) {
      setError("You appear offline. Reconnect to start a living incident.");
      return;
    }
    setBusy(true);
    setError(null);
    setDiagResult(null);
    setFixMsg(null);
    setEvalResult(null);
    setHint(null);
    setHintLevel(0);
    const t0 = performance.now();
    try {
      const res = await api<{
        sessionId: string;
        incident: { title: string; summary: string; businessImpact?: string };
        estimatedMinutes: number;
        fidelity: { tier?: string };
        naturalStoppingPoints?: string[];
      }>("/api/living/guest-incident", {
        method: "POST",
        body: JSON.stringify({ persona, displayName: displayName || undefined }),
      });
      const ms = Math.round(performance.now() - t0);
      setColdStartMs(ms);
      setSessionId(res.sessionId);
      setIncidentMeta({
        title: res.incident.title,
        summary: res.incident.summary,
        businessImpact: res.incident.businessImpact,
        estimatedMinutes: res.estimatedMinutes,
        fidelity: res.fidelity,
        naturalStoppingPoints: res.naturalStoppingPoints,
      });
      await loadWorld(res.sessionId);
      setPhase("hook");
      setPhaseDone(new Set());
      setRoute("incident");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [persona, displayName, offline]);

  const markPhase = (p: LoopPhase) => {
    setPhaseDone((prev) => new Set(prev).add(p));
  };

  const advance = () => {
    const idx = PHASES.findIndex((p) => p.id === phase);
    markPhase(phase);
    const next = PHASES[idx + 1];
    if (next) setPhase(next.id);
  };

  const runDiagnose = async () => {
    if (!sessionId || diagnosis.trim().length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ correct: boolean; feedback: string; rootCause?: string }>(
        `/api/sessions/${sessionId}/diagnose`,
        { method: "POST", body: JSON.stringify({ hypothesis: diagnosis }) },
      );
      setDiagResult(result);
      if (result.correct) {
        markPhase("diagnose");
        setPhase("inspect");
        await loadWorld(sessionId);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const askHint = async () => {
    if (!sessionId) return;
    const next = Math.min(hintLevel + 1, 3);
    setHintLevel(next);
    try {
      const r = await api<{ content: string }>(`/api/sessions/${sessionId}/mentor`, {
        method: "POST",
        body: JSON.stringify({
          message: diagnosis || "I need a socratic hint for the outage",
          hintLevel: next,
          role: "socratic_coach",
        }),
      });
      setHint(r.content);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const applySecureFix = async () => {
    if (!sessionId) return;
    if (architecture === "admin-all") {
      setFixMsg(
        "Rejected: Admin.All is not a secure remediation in this landscape. Choose a least-privilege fix.",
      );
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; message: string }>(`/api/sessions/${sessionId}/fix`, {
        method: "POST",
        body: "{}",
      });
      setFixMsg(r.message);
      await loadWorld(sessionId);
      markPhase("configure");
      markPhase("test");
      setPhase("observe");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runEvaluate = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      const r = await api<{
        overallScore: number;
        passed: boolean;
        summary: string;
        disclaimer: string;
      }>(`/api/sessions/${sessionId}/evaluate`, { method: "POST", body: "{}" });
      setEvalResult(r);
      markPhase("observe");
      markPhase("tradeoffs");
      setPhase("debrief");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
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
      await refreshBoot();
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
      const res = await api<{ artifact: unknown }>("/api/living/debrief", {
        method: "POST",
        body: JSON.stringify({ sessionId, ...debrief }),
      });
      setArtifact(res.artifact);
      markPhase("debrief");
      setPhase("remediate");
      await refreshBoot();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const searchConstellation = async (q: string, domain = "") => {
    try {
      const data = await api<{
        concepts: { id: string; title: string; domainId: string; summary: string }[];
        domains: { id: string; title: string }[];
        totalMatched: number;
      }>(
        `/api/living/constellation?q=${encodeURIComponent(q)}${domain ? `&domain=${encodeURIComponent(domain)}` : ""}`,
      );
      setConstellation(data);
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
      { id: "glossary", label: "Glossary" },
      { id: "notes", label: "Notes" },
      { id: "preferences", label: "Prefs" },
      { id: "support", label: "Support" },
    ],
    [],
  );

  if (!boot && !error) {
    return (
      <div className="living-root">
        <div className="living-shell">
          <div className="le-panel" role="status">
            Loading Living Enterprise…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="living-root"
      data-low-stim={lowStim ? "true" : "false"}
      data-silent={silent ? "true" : "false"}
      data-data-saver={dataSaver ? "true" : "false"}
    >
      <div className="living-shell">
        <header className="le-topbar">
          <div className="le-brand">
            <strong>BTP Odyssey: The Living Enterprise</strong>
            <span>
              {boot?.product.version ?? "3.0.0"} · Tier-2 behavioral simulation · Independent of SAP
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
                  if (n.id === "review") {
                    void api<{ items: { id?: string; prompt?: string }[] }>(
                      "/api/living/review-queue",
                    ).then(setReview);
                  }
                  if (n.id === "constellation") void searchConstellation("");
                  if (n.id === "glossary") {
                    void api<{ terms: { term: string; definition: string }[] }>(
                      "/api/living/glossary",
                    ).then((g) => setGlossary(g.terms));
                  }
                  if (n.id === "notes") {
                    void api<{ notes: { id: string; text: string; bookmark?: boolean }[] }>(
                      "/api/living/notes",
                    ).then((n2) => setNotes(n2.notes));
                  }
                  if (n.id === "support") setFeedbackOk(null);
                }}
              >
                {n.label}
              </button>
            ))}
            <button type="button" onClick={() => setRoute("legacy")}>
              Legacy
            </button>
          </nav>
        </header>

        {offline && (
          <div className="le-banner error" role="status">
            Offline / degraded: read-only notes in memory only. Reconnect to run incidents or save
            debriefs.
          </div>
        )}
        {error && (
          <div className="le-banner error" role="alert">
            {error}{" "}
            <button type="button" className="le-btn ghost" onClick={() => setError(null)}>
              Dismiss
            </button>
            <button
              type="button"
              className="le-btn ghost"
              onClick={() => void refreshBoot().catch((e) => setError((e as Error).message))}
            >
              Retry bootstrap
            </button>
          </div>
        )}
        {breakNudge && (
          <div className="le-banner ethics" role="status">
            Natural stop: {goalMin}-minute session goal reached. Progress is saved — breaks never
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
                <div className="le-kicker">Guest · no login required · cold-start target &lt;60s</div>
                <h1>Master SAP BTP inside a living enterprise.</h1>
                <p className="lead">
                  Enter a real incident loop: diagnose, inspect the simulator, choose architecture,
                  apply a secure fix, debrief without blame, and leave portfolio evidence — never
                  loot boxes or streak shame.
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
                <div className="le-actions">
                  <button
                    type="button"
                    className="le-btn primary"
                    disabled={busy || offline}
                    onClick={() => void startGuestIncident()}
                  >
                    {busy ? "Opening incident…" : "Enter living incident (guest)"}
                  </button>
                  <button type="button" className="le-btn" onClick={() => setRoute("diagnostic")}>
                    Prerequisite diagnostic
                  </button>
                  <button type="button" className="le-btn" onClick={() => setRoute("register")}>
                    Optional local profile
                  </button>
                  <button type="button" className="le-btn ghost" onClick={() => setRoute("preferences")}>
                    Accessibility
                  </button>
                </div>
                {coldStartMs != null && (
                  <p className="lead" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
                    Last cold start: <strong>{coldStartMs} ms</strong>
                    {coldStartMs < 60000 ? " (under 60s ✓)" : " (over 60s — check network)"}
                  </p>
                )}
              </div>
              {!dataSaver && (
                <Cinema
                  lowStim={lowStim}
                  caption={boot.flagshipIncident.hook}
                  transcript="Audio description: Dim operations room. Order Insights tiles go dark. Sales analysts blocked. Destination and CAP logs flash 401 audience mismatch. You have one working session."
                />
              )}
            </div>
          </section>
        )}

        {route === "register" && (
          <section className="le-panel">
            <div className="le-kicker">Optional local profile</div>
            <h2 style={{ marginTop: 0 }}>Register without a password</h2>
            <p className="lead">
              Local runtime profile only — no cloud account in R1. Guest play works without this.
            </p>
            <div className="le-field">
              <label>Display name</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="le-field">
              <label>Career goal</label>
              <select value={careerGoal} onChange={(e) => setCareerGoal(e.target.value)}>
                <option value="btp-developer">BTP application developer</option>
                <option value="integration">Integration specialist</option>
                <option value="architect">Solution architect</option>
                <option value="admin">Platform / security admin</option>
                <option value="data">Data & analytics on BTP</option>
                <option value="ai">AI on BTP (responsible)</option>
              </select>
            </div>
            <div className="le-field">
              <label>Certification interest (prep only — not a claim)</label>
              <select value={certInterest} onChange={(e) => setCertInterest(e.target.value)}>
                <option value="none">None / explore only</option>
                <option value="btp-dev-prep">Developer-oriented prep topics</option>
                <option value="architect-prep">Architect-oriented prep topics</option>
              </select>
            </div>
            <div className="le-persona-grid">
              {(boot?.personas ?? []).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`le-persona${persona === p.id ? " active" : ""}`}
                  onClick={() => setPersona(p.id)}
                >
                  <strong>{p.label}</strong>
                  <span>{p.path}</span>
                </button>
              ))}
            </div>
            <div className="le-actions">
              <button
                type="button"
                className="le-btn primary"
                disabled={busy}
                onClick={() => {
                  void api("/api/living/register", {
                    method: "POST",
                    body: JSON.stringify({
                      displayName,
                      persona,
                      careerGoal: `${careerGoal}|cert:${certInterest}`,
                    }),
                  })
                    .then(() => refreshBoot())
                    .then(() => setRoute("continue"))
                    .catch((e) => setError((e as Error).message));
                }}
              >
                Save local profile
              </button>
              <button type="button" className="le-btn ghost" onClick={() => setRoute("gate")}>
                Continue as pure guest
              </button>
            </div>
          </section>
        )}

        {route === "diagnostic" && (
          <section className="le-panel">
            <div className="le-kicker">Prerequisite diagnostic</div>
            <h2 style={{ marginTop: 0 }}>Pathing self-report</h2>
            <p className="lead">
              Honest answers only. This is not an SAP certification placement exam.
            </p>
            {DIAG_QUESTIONS.map((q) => (
              <div key={q.id} className="le-field">
                <label htmlFor={`dq-${q.id}`}>{q.label}</label>
                <select
                  id={`dq-${q.id}`}
                  value={diagAnswers[q.id] ?? "heard"}
                  onChange={(e) =>
                    setDiagAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                  }
                >
                  <option value="never">Never touched</option>
                  <option value="heard">Heard of it</option>
                  <option value="used">Used in a project</option>
                  <option value="designed">Designed / defended in production</option>
                </select>
              </div>
            ))}
            <div className="le-actions">
              <button
                type="button"
                className="le-btn primary"
                onClick={() => {
                  const answers = DIAG_QUESTIONS.map((q) => ({
                    id: q.id,
                    value: diagAnswers[q.id] ?? "heard",
                  }));
                  void api<{ level: string; recommendations: string[] }>(
                    "/api/living/diagnostic",
                    { method: "POST", body: JSON.stringify({ answers }) },
                  )
                    .then((r) => {
                      setDiagResultPath(r);
                      setPersona(r.level === "beginner" ? "beginner" : r.level);
                    })
                    .catch((e) => setError((e as Error).message));
                }}
              >
                Get recommendations
              </button>
            </div>
            {diagResultPath && (
              <div className="le-banner info" style={{ marginTop: "0.75rem" }}>
                Suggested level: <strong>{diagResultPath.level}</strong>. Try:{" "}
                {diagResultPath.recommendations.join(", ")}.
                <div className="le-actions" style={{ marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    className="le-btn primary"
                    onClick={() => void startGuestIncident()}
                  >
                    Start recommended incident
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {route === "continue" && boot && (
          <section className="le-panel">
            <div className="le-kicker">Continue learning</div>
            <h2 style={{ marginTop: 0 }}>Welcome back, {boot.learner.displayName}</h2>
            <div className="le-meta">
              <span className="le-chip">
                {boot.learner.engagement?.architectRank ?? "Apprentice"} (optional)
              </span>
              <span className="le-chip">
                Cleared {boot.learner.engagement?.challengesCleared?.length ?? 0}/
                {boot.totalChallenges}
              </span>
            </div>
            <div className="le-card-list">
              <article className="le-card">
                <h3>Personalized recommendation</h3>
                <p>
                  Flagship: {boot.flagshipIncident.title}. Next practice:{" "}
                  {boot.nextChallenge?.title ?? "schedule transfer review"}.
                </p>
                <div className="le-actions">
                  <button
                    type="button"
                    className="le-btn primary"
                    disabled={busy || offline}
                    onClick={() => void startGuestIncident()}
                  >
                    Resume living incident
                  </button>
                  <button type="button" className="le-btn" onClick={() => setRoute("constellation")}>
                    Search constellation
                  </button>
                </div>
              </article>
              <article className="le-card">
                <h3>Sandbox & teams</h3>
                <p>Simulator consent status and deferred team features.</p>
                <div className="le-actions">
                  <button
                    type="button"
                    className="le-btn"
                    onClick={() => {
                      void api<Record<string, unknown>>("/api/living/sandbox").then((s) => {
                        setSandbox(s);
                        setRoute("sandbox");
                      });
                    }}
                  >
                    Sandbox preview
                  </button>
                  <button type="button" className="le-btn ghost" onClick={() => setRoute("teams")}>
                    Teams (R2 stub)
                  </button>
                </div>
              </article>
            </div>
          </section>
        )}

        {route === "incident" && (
          <section className="le-panel">
            <div className="le-kicker">Core loop · real simulator</div>
            <h2 style={{ marginTop: 0 }}>{incidentMeta?.title ?? "Living incident"}</h2>
            <p className="lead">{incidentMeta?.summary}</p>
            {incidentMeta?.businessImpact && (
              <p className="lead">Business impact: {incidentMeta.businessImpact}</p>
            )}
            <div className="le-meta">
              <span className="le-chip warn">~{incidentMeta?.estimatedMinutes ?? 25} min</span>
              <span className="le-chip">
                Fidelity {incidentMeta?.fidelity?.tier ?? "tier2_behavioral"}
              </span>
              <span className="le-chip">Session {sessionId ?? "—"}</span>
              {coldStartMs != null && (
                <span className="le-chip good">Cold start {coldStartMs} ms</span>
              )}
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
                  lowStim={lowStim || dataSaver}
                  caption="Order Insights is dark. Board wants a fix without Admin.All."
                  transcript="Visual: enterprise dashboard tiles fail. Logs show 401. Audio: ambient ops room, no alarm spam. Equivalent text provided above for skip."
                />
                <div className="le-actions">
                  <button type="button" className="le-btn primary" onClick={advance}>
                    Skip cinema → diagnose
                  </button>
                </div>
              </>
            )}

            {phase === "diagnose" && (
              <>
                <p className="lead">
                  Form a hypothesis. Keywords like audience, JWT, destination score against the
                  incident forge.
                </p>
                <div className="le-field">
                  <label htmlFor="diag">Hypothesis</label>
                  <textarea
                    id="diag"
                    value={diagnosis}
                    onChange={(e) => setDiagnosis(e.target.value)}
                    placeholder="JWT audience on destination orders-api mismatches CAP service…"
                  />
                </div>
                {diagResult && (
                  <div className={`le-banner ${diagResult.correct ? "ethics" : "error"}`}>
                    {diagResult.feedback}
                    {diagResult.rootCause && (
                      <div style={{ marginTop: "0.35rem" }}>
                        Root cause (revealed on correct): {diagResult.rootCause}
                      </div>
                    )}
                  </div>
                )}
                {hint && (
                  <div className="le-banner info" role="status">
                    Coach (hint {hintLevel}/3): {hint}
                  </div>
                )}
                <div className="le-actions">
                  <button
                    type="button"
                    className="le-btn primary"
                    disabled={busy || diagnosis.trim().length < 4}
                    onClick={() => void runDiagnose()}
                  >
                    Submit diagnosis
                  </button>
                  <button type="button" className="le-btn" onClick={() => void askHint()}>
                    Socratic hint
                  </button>
                  <button
                    type="button"
                    className="le-btn ghost"
                    onClick={() => {
                      setDiagnosis("");
                      setDiagResult(null);
                    }}
                  >
                    Retry empty
                  </button>
                  {diagResult?.correct && (
                    <button type="button" className="le-btn violet" onClick={advance}>
                      Inspect systems
                    </button>
                  )}
                </div>
              </>
            )}

            {phase === "inspect" && (
              <>
                <p className="lead">Live snapshot from the deterministic simulator.</p>
                <div className="le-grid-2">
                  <div>
                    <h3 style={{ fontSize: "0.85rem" }}>Logs</h3>
                    <div className="le-log" role="log">
                      {logs.length === 0 && <div>Empty — refresh world.</div>}
                      {logs.map((l) => (
                        <div key={l} className={l.startsWith("error") ? "err" : undefined}>
                          {l}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 style={{ fontSize: "0.85rem" }}>Metrics</h3>
                    <div className="le-log">
                      {metrics.length === 0 && <div>No metrics yet.</div>}
                      {metrics.map((m) => (
                        <div key={m}>{m}</div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="le-actions">
                  <button
                    type="button"
                    className="le-btn"
                    onClick={() => sessionId && void loadWorld(sessionId)}
                  >
                    Refresh world
                  </button>
                  <button type="button" className="le-btn primary" onClick={advance}>
                    Select architecture
                  </button>
                </div>
              </>
            )}

            {phase === "architect" && (
              <>
                <div className="le-field">
                  <label htmlFor="arch">Architecture choice</label>
                  <select
                    id="arch"
                    value={architecture}
                    onChange={(e) => setArchitecture(e.target.value)}
                  >
                    <option value="destination+cap">
                      Fix destination audience + CAP binding (least blast radius)
                    </option>
                    <option value="rebuild-rap">
                      Longer rebuild on RAP (higher effort, clean-core alignment)
                    </option>
                    <option value="admin-all">Admin.All temporary (trap — rejected)</option>
                  </select>
                </div>
                <div className="le-actions">
                  <button type="button" className="le-btn primary" onClick={advance}>
                    Configure
                  </button>
                </div>
              </>
            )}

            {phase === "configure" && (
              <>
                <div className="le-field">
                  <label htmlFor="cfg">Configuration plan (evidence)</label>
                  <textarea
                    id="cfg"
                    value={configNote}
                    onChange={(e) => setConfigNote(e.target.value)}
                    placeholder="Set destination audience to order-service!t1; redeploy CAP; add CI audience check"
                  />
                </div>
                {fixMsg && <div className="le-banner info">{fixMsg}</div>}
                <div className="le-actions">
                  <button
                    type="button"
                    className="le-btn primary"
                    disabled={busy || configNote.trim().length < 8}
                    onClick={() => void applySecureFix()}
                  >
                    Apply secure remediation in simulator
                  </button>
                </div>
              </>
            )}

            {(phase === "test" || phase === "observe") && (
              <>
                <p className="lead">
                  {architecture === "admin-all"
                    ? "Unsafe path blocked."
                    : fixMsg || "Observe post-fix world state."}
                </p>
                <div className="le-log">
                  {logs.slice(-6).map((l) => (
                    <div key={l}>{l}</div>
                  ))}
                </div>
                <div className="le-actions">
                  <button
                    type="button"
                    className="le-btn primary"
                    onClick={() => void runEvaluate()}
                  >
                    Score process evidence
                  </button>
                  <button type="button" className="le-btn" onClick={advance}>
                    Skip to tradeoffs
                  </button>
                </div>
                {evalResult && (
                  <div className="le-banner ethics">
                    Score {Math.round(evalResult.overallScore * 100)}% ·{" "}
                    {evalResult.passed ? "Passed" : "Needs remediation"} — {evalResult.summary}
                    <div style={{ opacity: 0.85, marginTop: "0.35rem" }}>
                      {evalResult.disclaimer}
                    </div>
                  </div>
                )}
              </>
            )}

            {phase === "tradeoffs" && (
              <>
                <p className="lead">
                  Minimal destination fix restores service fastest; RAP rebuild is cleaner long-term;
                  Admin.All fails ethics and audit. Document residual risk and monitoring.
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
                  {(
                    [
                      ["whatHappened", "What happened"],
                      ["rootCause", "Root cause (systems)"],
                      ["fix", "Fix applied"],
                      ["tradeoffs", "Tradeoffs accepted"],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key} className="le-field">
                      <label>{label}</label>
                      <textarea
                        value={debrief[key]}
                        onChange={(e) =>
                          setDebrief((d) => ({ ...d, [key]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="le-actions">
                  <button
                    type="button"
                    className="le-btn primary"
                    disabled={busy}
                    onClick={() => void submitDebrief()}
                  >
                    Save portfolio debrief
                  </button>
                </div>
              </>
            )}

            {phase === "remediate" && (
              <>
                <p className="lead">
                  Targeted remediation: Destinations, JWT audience, CAP bindings. Open constellation
                  or legacy Atlas how/when games.
                </p>
                <div className="le-actions">
                  <button type="button" className="le-btn" onClick={() => setRoute("constellation")}>
                    Mastery constellation
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
                  Delayed transfer (optional, ~3 days): apply the same diagnosis process to another
                  landscape. Missing the day never removes evidence.
                </p>
                <div className="le-actions">
                  <button type="button" className="le-btn primary" onClick={advance}>
                    Portfolio
                  </button>
                </div>
              </>
            )}

            {phase === "portfolio" && (
              <>
                {artifact ? (
                  <pre className="le-log">{JSON.stringify(artifact, null, 2)}</pre>
                ) : (
                  <p className="lead">Complete debrief to mint artifact.</p>
                )}
                <div className="le-actions">
                  <button type="button" className="le-btn primary" onClick={() => setRoute("portfolio")}>
                    Portfolio view
                  </button>
                  <button type="button" className="le-btn" onClick={() => setRoute("continue")}>
                    Natural stop
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {route === "constellation" && (
          <section className="le-panel">
            <div className="le-kicker">Searchable mastery constellation</div>
            <h2 style={{ marginTop: 0 }}>Find a concept</h2>
            <div className="le-field">
              <label htmlFor="cq">Search</label>
              <input
                id="cq"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void searchConstellation(searchQ);
                }}
                placeholder="destination, jwt, cap…"
              />
            </div>
            <div className="le-actions">
              <button
                type="button"
                className="le-btn primary"
                onClick={() => void searchConstellation(searchQ)}
              >
                Search
              </button>
            </div>
            <p className="lead" style={{ fontSize: "0.8rem" }}>
              {constellation
                ? `${constellation.totalMatched} matched (showing ${constellation.concepts.length})`
                : "Search to load concepts."}
            </p>
            <div className="le-card-list">
              {(constellation?.concepts ?? []).map((c) => (
                <article key={c.id} className="le-card">
                  <h3>
                    {c.title}{" "}
                    <span className="le-chip">{c.domainId}</span>
                  </h3>
                  <p>{c.summary}</p>
                </article>
              ))}
            </div>
            {!constellation?.concepts.length && (
              <div className="le-banner info">Empty — try another query or clear search.</div>
            )}
          </section>
        )}

        {route === "glossary" && (
          <section className="le-panel">
            <div className="le-kicker">Glossary · sources in content pack</div>
            <h2 style={{ marginTop: 0 }}>Terms</h2>
            <div className="le-card-list">
              {glossary.map((t) => (
                <article key={t.term} className="le-card">
                  <h3>{t.term}</h3>
                  <p>{t.definition}</p>
                </article>
              ))}
            </div>
            {!glossary.length && <div className="le-banner info">Loading or empty glossary.</div>}
          </section>
        )}

        {route === "notes" && (
          <section className="le-panel">
            <div className="le-kicker">Notes & bookmarks</div>
            <h2 style={{ marginTop: 0 }}>Your notes</h2>
            <div className="le-field">
              <label>New note</label>
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} />
            </div>
            <div className="le-actions">
              <button
                type="button"
                className="le-btn primary"
                disabled={!noteText.trim()}
                onClick={() => {
                  void api<{ notes: { id: string; text: string; bookmark?: boolean }[] }>(
                    "/api/living/notes",
                    {
                      method: "POST",
                      body: JSON.stringify({ text: noteText, bookmark: false }),
                    },
                  ).then((r) => {
                    setNotes(r.notes);
                    setNoteText("");
                  });
                }}
              >
                Save note
              </button>
              <button
                type="button"
                className="le-btn"
                disabled={!noteText.trim()}
                onClick={() => {
                  void api<{ notes: { id: string; text: string; bookmark?: boolean }[] }>(
                    "/api/living/notes",
                    {
                      method: "POST",
                      body: JSON.stringify({ text: noteText, bookmark: true }),
                    },
                  ).then((r) => {
                    setNotes(r.notes);
                    setNoteText("");
                  });
                }}
              >
                Bookmark
              </button>
            </div>
            <div className="le-card-list" style={{ marginTop: "0.75rem" }}>
              {notes.map((n) => (
                <article key={n.id} className="le-card">
                  <h3>{n.bookmark ? "Bookmark" : "Note"}</h3>
                  <p>{n.text}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {route === "review" && (
          <section className="le-panel">
            <div className="le-kicker">Spaced review</div>
            <h2 style={{ marginTop: 0 }}>Retrieval queue</h2>
            <div className="le-banner ethics">
              Optional. No FOMO. No progress loss for rest.
            </div>
            <div className="le-card-list">
              {(review?.items?.length
                ? review.items
                : [{ prompt: "Empty queue — complete a debrief first." }]
              ).map((item, i) => (
                <article key={item.id ?? i} className="le-card">
                  <h3>Transfer check</h3>
                  <p>{item.prompt}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {route === "portfolio" && boot && (
          <section className="le-panel">
            <div className="le-kicker">Portfolio · local privacy</div>
            <h2 style={{ marginTop: 0 }}>Evidence of skills</h2>
            <pre className="le-log">
              {JSON.stringify(boot.learner.evidence?.slice(-8) ?? [], null, 2)}
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
                Export JSON
              </button>
              <button
                type="button"
                className="le-btn ghost"
                onClick={() => {
                  if (
                    confirm(
                      "Delete local learner progress? This cannot be undone without a prior export.",
                    )
                  ) {
                    void api("/api/learner/delete", { method: "POST", body: "{}" }).then(() =>
                      refreshBoot(),
                    );
                  }
                }}
              >
                Delete account data
              </button>
            </div>
          </section>
        )}

        {route === "sandbox" && (
          <section className="le-panel">
            <div className="le-kicker">Sandbox · consent</div>
            <h2 style={{ marginTop: 0 }}>Simulator preview</h2>
            <pre className="le-log">{JSON.stringify(sandbox, null, 2)}</pre>
            <div className="le-actions">
              <button
                type="button"
                className="le-btn primary"
                onClick={() => {
                  void api("/api/living/sandbox/consent", {
                    method: "POST",
                    body: JSON.stringify({ accept: true }),
                  }).then(() => setFeedbackOk("Simulator consent recorded (Tier-2 only)."));
                }}
              >
                Accept Tier-2 simulator terms
              </button>
              <button
                type="button"
                className="le-btn ghost"
                onClick={() => {
                  void api("/api/living/sandbox/consent", {
                    method: "POST",
                    body: JSON.stringify({ accept: false }),
                  });
                }}
              >
                Decline / revoke intent
              </button>
            </div>
            {feedbackOk && <div className="le-banner ethics">{feedbackOk}</div>}
          </section>
        )}

        {route === "teams" && (
          <section className="le-panel">
            <div className="le-kicker">Teams · R2</div>
            <h2 style={{ marginTop: 0 }}>Cohorts deferred</h2>
            <p className="lead">
              Team and cohort creation is stubbed for R2. Individual mastery and portfolio work in
              R1.
            </p>
          </section>
        )}

        {route === "support" && (
          <section className="le-panel">
            <div className="le-kicker">Support · feedback</div>
            <h2 style={{ marginTop: 0 }}>Report an issue</h2>
            <div className="le-field">
              <label>Message</label>
              <textarea
                value={feedbackMsg}
                onChange={(e) => setFeedbackMsg(e.target.value)}
                placeholder="What broke, what you expected…"
              />
            </div>
            <div className="le-actions">
              <button
                type="button"
                className="le-btn primary"
                disabled={!feedbackMsg.trim()}
                onClick={() => {
                  void api<{ message: string }>("/api/living/feedback", {
                    method: "POST",
                    body: JSON.stringify({ message: feedbackMsg, category: "product" }),
                  }).then((r) => {
                    setFeedbackOk(r.message);
                    setFeedbackMsg("");
                  });
                }}
              >
                Submit feedback
              </button>
            </div>
            {feedbackOk && <div className="le-banner ethics">{feedbackOk}</div>}
          </section>
        )}

        {route === "preferences" && (
          <section className="le-panel">
            <div className="le-kicker">Agency · accessibility · ethics</div>
            <h2 style={{ marginTop: 0 }}>Preferences</h2>
            {(
              [
                ["reducedMotion", "Reduced motion"],
                ["lowStimulation", "Low stimulation"],
                ["highContrast", "High contrast"],
                ["silentMode", "Silent mode"],
                ["dataSaver", "Data saver"],
                ["lowPower", "Low power"],
                ["graceStreakOptIn", "Grace streak opt-in (non-punitive)"],
                ["notificationsEnabled", "Notifications (opt-in)"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="le-toggle-row">
                <span>{label}</span>
                <button
                  type="button"
                  className="le-btn ghost"
                  onClick={() => void savePrefs({ [key]: !settings[key] })}
                >
                  {settings[key] ? "On" : "Off"}
                </button>
              </div>
            ))}
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
              <label htmlFor="qh1">Quiet hours start (HH:MM, optional)</label>
              <input
                id="qh1"
                placeholder="22:00"
                defaultValue={String(settings.quietHoursStart ?? "")}
                onBlur={(e) =>
                  void savePrefs({ quietHoursStart: e.target.value || null })
                }
              />
            </div>
            <div className="le-field">
              <label htmlFor="qh2">Quiet hours end (HH:MM, optional)</label>
              <input
                id="qh2"
                placeholder="07:00"
                defaultValue={String(settings.quietHoursEnd ?? "")}
                onBlur={(e) => void savePrefs({ quietHoursEnd: e.target.value || null })}
              />
            </div>
            <div className="le-banner ethics">
              No punitive streaks. Pause anytime. Breaks never remove progress.
            </div>
          </section>
        )}

        {route === "legacy" && (
          <section className="le-panel">
            <div className="le-kicker">Bridge</div>
            <h2 style={{ marginTop: 0 }}>Legacy mega-teach shell</h2>
            <p className="lead">
              Full PLAY (1099 games), Atlas arcade, Architect studio. Opens with{" "}
              <code>?legacy=1</code>.
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
          Independent learning product. Not affiliated with or endorsed by SAP SE. Completing
          missions does not grant SAP certification or employment. Simulations are not live SAP BTP.
          Audit: docs/LIVING_ENTERPRISE_AUDIT.md. Health product name: The Living Enterprise 3.0.
        </p>
      </div>
    </div>
  );
}
