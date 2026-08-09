import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyFix,
  askMentor,
  deleteProgress,
  diagnose,
  evaluate,
  evaluateArchitect,
  exportData,
  clearChallenge,
  fetchArchitectScenarios,
  fetchCatalog,
  fetchChallenges,
  fetchConcept,
  fetchLearner,
  fetchQuests,
  fetchWorld,
  resetProgress,
  saveChallengeProgress,
  revealTeach,
  saveSettings,
  startSession,
  submitAnswer,
  submitCheck,
  type ArchitectScenario,
  type Catalog,
  type CatalogMission,
  type ConceptFull,
  type LearnerState,
  type Mission,
  type QuestBoard,
  type WorldSnapshot,
} from "./api";
import {
  ArchitectStudio,
  MasteryToast,
} from "./ArchitectStudio";
import { isAudioEnabled, setAudioEnabled, sfx } from "./audio";
import {
  ObjectiveCompass,
  SkillTreePanel,
} from "./GameChrome";
import { ChallengePlay, type ChallengePack } from "./game/ChallengePlay";
import {
  AtlasCardShell,
  AtlasMotionControl,
  ConceptDetailArt,
  groupConceptsByDomain,
  type MotionIntensity,
} from "./game/ConceptAtlasFX";
import { ConceptUseArena } from "./game/ConceptUseArena";
import { ReturnLoopBanner, type ReturnLoopData } from "./game/ReturnLoop";
import { LivingApp, type LivingRoute } from "./living/LivingApp";
import "./living/living.css";
import { TeachPanel } from "./TeachPanel";
import { ArchitectureEngineView } from "./engine/ArchitectureEngineView";
import {
  ArchitectureGraph,
  CompetencyConstellation,
  Starfield,
} from "./Visuals";

type View =
  | "home"
  | "play"
  | "mission"
  | "skills"
  | "paths"
  | "atlas"
  | "architect"
  | "trees"
  | "settings"
  | "result"
  /** Living Enterprise surfaces — same product path, not a second shell */
  | "incident"
  | "continue"
  | "diagnostic"
  | "register"
  | "constellation"
  | "review"
  | "portfolio"
  | "glossary"
  | "notes"
  | "sandbox"
  | "teams"
  | "support"
  | "preferences";

const LIVING_VIEWS = new Set<View>([
  "incident",
  "continue",
  "diagnostic",
  "register",
  "constellation",
  "review",
  "portfolio",
  "glossary",
  "notes",
  "sandbox",
  "teams",
  "support",
  "preferences",
]);

const FIDELITY: Record<string, string> = {
  tier1_conceptual: "Tier 1 Conceptual",
  tier2_behavioral: "Tier 2 Behavioral",
  tier3_sandbox: "Tier 3 Sandbox",
};

function applyTheme(settings: LearnerState["profile"]["settings"]) {
  const root = document.documentElement;
  const theme =
    settings.theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : settings.theme;
  root.dataset.theme = theme;
  root.dataset.contrast = settings.highContrast ? "high" : "normal";
  root.dataset.reducedMotion =
    settings.reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "true"
      : "false";
}

function nextCampaignMission(catalog: Catalog, completed: string[]): CatalogMission | null {
  for (const camp of catalog.campaigns) {
    for (const id of camp.missionIds) {
      if (!completed.includes(id)) return catalog.missions.find((m) => m.id === id) ?? null;
    }
  }
  return catalog.missions[0] ?? null;
}

export function App() {
  const [view, setView] = useState<View>("home");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [learner, setLearner] = useState<LearnerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterDomain, setFilterDomain] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(true);
  const [atlasConcept, setAtlasConcept] = useState<ConceptFull | null>(null);
  const [atlasFilter, setAtlasFilter] = useState("");
  const [atlasDomain, setAtlasDomain] = useState<string | null>(null);
  const [atlasMotion, setAtlasMotion] = useState<MotionIntensity>("live");
  const [architectScenarios, setArchitectScenarios] = useState<ArchitectScenario[]>(
    [],
  );
  const [toast, setToast] = useState<{ title: string; detail: string } | null>(null);
  const [questBoard, setQuestBoard] = useState<QuestBoard | null>(null);
  const [arenaScenarioId, setArenaScenarioId] = useState<string | null>(null);
  const [pathWalk, setPathWalk] = useState<{
    title: string;
    ids: string[];
    index: number;
  } | null>(null);
  const [atlasLoading, setAtlasLoading] = useState(false);
  const [atlasError, setAtlasError] = useState<string | null>(null);
  const [challengePack, setChallengePack] = useState<ChallengePack | null>(null);
  const [challengesCleared, setChallengesCleared] = useState<string[]>([]);
  const [returnLoop, setReturnLoop] = useState<ReturnLoopData | null>(null);
  const [resumeChallengeId, setResumeChallengeId] = useState<string | null>(null);
  /** When true, ChallengePlay skips linear path lock (Atlas concept games) */
  const [playFreeMode, setPlayFreeMode] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mission, setMission] = useState<Mission | null>(null);
  const [currentStepId, setCurrentStepId] = useState<string | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);
  const [world, setWorld] = useState<WorldSnapshot | null>(null);
  const [logs, setLogs] = useState<
    { id: string; level: string; message: string; resourceId: string }[]
  >([]);
  const [metrics, setMetrics] = useState<
    { name: string; value: number; unit: string; resourceId: string }[]
  >([]);
  const [traces, setTraces] = useState<
    { name: string; status: string; resourceId: string; durationMs: number }[]
  >([]);
  const [incidentTitle, setIncidentTitle] = useState("");
  const [answer, setAnswer] = useState("");
  const [selectedOpts, setSelectedOpts] = useState<string[]>([]);
  const [mentor, setMentor] = useState<string | null>(null);
  const [diagFeedback, setDiagFeedback] = useState<string | null>(null);
  const [diagOk, setDiagOk] = useState<boolean | null>(null);
  const [checkFeedback, setCheckFeedback] = useState<string[] | null>(null);
  const [checkPassed, setCheckPassed] = useState<boolean | null>(null);
  const [checkExplain, setCheckExplain] = useState<string | null>(null);
  const [relatedConcepts, setRelatedConcepts] = useState<ConceptFull[]>([]);
  const [revealLevel, setRevealLevel] = useState(0);
  const [hintLevel, setHintLevel] = useState(0);
  const [result, setResult] = useState<Awaited<ReturnType<typeof evaluate>> | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [breakDismissed, setBreakDismissed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [opsTab, setOpsTab] = useState<"graph" | "resources" | "logs">("graph");
  const [checksPassedCount, setChecksPassedCount] = useState(0);

  const reloadQuests = useCallback(() => {
    return fetchQuests()
      .then(setQuestBoard)
      .catch(() => undefined);
  }, []);

  const refreshLearner = useCallback(() => {
    return fetchLearner()
      .then((l) => {
        setLearner(l);
        applyTheme(l.profile.settings);
        return reloadQuests();
      })
      .catch((e: Error) => setError(e.message));
  }, [reloadQuests]);

  useEffect(() => {
    Promise.all([
      fetchCatalog(),
      fetchLearner(),
      fetchArchitectScenarios(),
      fetchQuests(),
      fetchChallenges(),
    ])
      .then(([c, l, a, q, ch]) => {
        setCatalog(c);
        setLearner(l);
        setArchitectScenarios(a.scenarios);
        setQuestBoard(q);
        setChallengePack(ch.pack as ChallengePack);
        setChallengesCleared(ch.clearedIds ?? []);
        setReturnLoop(ch.returnLoop ?? null);
        applyTheme(l.profile.settings);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setAudioEnabled(audioOn);
  }, [audioOn]);

  const step = useMemo(
    () => mission?.steps.find((s) => s.id === currentStepId) ?? null,
    [mission, currentStepId],
  );

  const progress = useMemo(() => {
    if (!mission) return 0;
    return Math.round((completed.length / Math.max(mission.steps.length, 1)) * 100);
  }, [mission, completed]);

  const showBreak =
    !!sessionStartedAt &&
    !!learner &&
    !breakDismissed &&
    view === "mission" &&
    now - sessionStartedAt > learner.profile.settings.sessionBreakMinutes * 60 * 1000;

  const recommended = useMemo(() => {
    if (!catalog || !learner) return null;
    return nextCampaignMission(catalog, learner.profile.completedMissions);
  }, [catalog, learner]);

  const missionsShown = useMemo(() => {
    if (!catalog) return [];
    if (!filterDomain) return catalog.missions;
    return catalog.missions.filter((m) => m.domainIds.includes(filterDomain));
  }, [catalog, filterDomain]);

  const atlasList = useMemo(() => {
    let list = catalog?.concepts ?? [];
    if (atlasDomain) {
      list = list.filter((c) => c.domainId === atlasDomain);
    }
    const q = atlasFilter.toLowerCase().trim();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q) ||
        c.domainId.includes(q) ||
        c.tags?.some((t) => t.includes(q)),
    );
  }, [catalog, atlasFilter, atlasDomain]);

  const atlasGroups = useMemo(() => groupConceptsByDomain(atlasList), [atlasList]);

  const atlasDomainCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of catalog?.concepts ?? []) {
      m.set(c.domainId, (m.get(c.domainId) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([id, n]) => ({ id, n }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [catalog]);

  useEffect(() => {
    document.documentElement.dataset.atlasMotion = atlasMotion;
  }, [atlasMotion]);

  const refreshWorld = useCallback(async (sid: string) => {
    const w = await fetchWorld(sid);
    setWorld(w.world);
    setLogs(w.logs);
    setMetrics(w.metrics);
    setTraces(w.traces);
  }, []);

  async function loadStepConcepts(ids: string[] = []) {
    if (!ids.length) {
      setRelatedConcepts([]);
      return;
    }
    const loaded = await Promise.all(
      ids.map((id) => fetchConcept(id).then((r) => r.concept).catch(() => null)),
    );
    setRelatedConcepts(loaded.filter(Boolean) as ConceptFull[]);
  }

  function go(v: View) {
    try {
      sfx.click();
    } catch {
      /* audio optional — never block navigation */
    }
    setView(v);
    setMoreOpen(false);
    // Clear transient errors when switching major views
    setError(null);
  }

  const primaryNav: { id: View; label: string }[] = [
    { id: "home", label: "Home" },
    { id: "incident", label: "Incident" },
    { id: "play", label: "Play" },
    { id: "atlas", label: "Atlas" },
    { id: "architect", label: "Arena" },
  ];

  const moreNav: { id: View; label: string }[] = [
    { id: "continue", label: "Continue" },
    { id: "constellation", label: "Constellation" },
    { id: "trees", label: "Quest trees" },
    { id: "skills", label: "Skills" },
    { id: "paths", label: "Paths" },
    { id: "review", label: "Review" },
    { id: "portfolio", label: "Portfolio" },
    { id: "glossary", label: "Glossary" },
    { id: "notes", label: "Notes" },
    { id: "sandbox", label: "Sandbox" },
    { id: "diagnostic", label: "Diagnostic" },
    { id: "register", label: "Profile" },
    { id: "preferences", label: "Preferences" },
    { id: "support", label: "Support" },
    { id: "settings", label: "Settings" },
    { id: "teams", label: "Teams" },
  ];

  const moreActive = moreNav.some((n) => n.id === view);

  async function onStartMission(missionId: string) {
    setLoading(true);
    setError(null);
    sfx.launch();
    try {
      const s = await startSession(missionId, 42 + Math.floor(Math.random() * 1000));
      setSessionId(s.sessionId);
      setMission(s.mission);
      setCurrentStepId(s.currentStepId);
      setCompleted([]);
      setWorld(s.world);
      setAnswer("");
      setSelectedOpts([]);
      setMentor(null);
      setDiagFeedback(null);
      setDiagOk(null);
      setCheckFeedback(null);
      setCheckPassed(null);
      setCheckExplain(null);
      setHintLevel(0);
      setRevealLevel(0);
      setChecksPassedCount(0);
      setResult(null);
      setIncidentTitle(s.incident.title);
      setSessionStartedAt(Date.now());
      setBreakDismissed(false);
      setOpsTab("graph");
      setView("mission");
      const first = s.mission.steps[0];
      await loadStepConcepts(first?.conceptIds ?? []);
      await refreshWorld(s.sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      sfx.fail();
    } finally {
      setLoading(false);
    }
  }

  async function selectStep(id: string) {
    if (!mission) return;
    sfx.click();
    setCurrentStepId(id);
    setAnswer("");
    setSelectedOpts([]);
    setCheckFeedback(null);
    setCheckPassed(null);
    setCheckExplain(null);
    setRevealLevel(0);
    const s = mission.steps.find((x) => x.id === id);
    await loadStepConcepts(s?.conceptIds ?? []);
  }

  async function onCheck() {
    if (!sessionId || !step?.check) return;
    setLoading(true);
    try {
      const res = await submitCheck(sessionId, {
        stepId: step.id,
        selectedOptionIds: selectedOpts,
        shortText: answer,
      });
      setCheckFeedback(res.feedback);
      setCheckPassed(res.passed);
      setCheckExplain(res.explanation);
      setCompleted(res.completedStepIds);
      if (res.passed) {
        setChecksPassedCount((n) => n + 1);
        sfx.success();
      } else sfx.fail();
      if (step.kind === "diagnose" && answer.trim()) {
        const d = await diagnose(sessionId, answer);
        setDiagFeedback(d.feedback);
        setDiagOk(d.correct);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function onSave(advance: boolean) {
    if (!sessionId || !step) return;
    setLoading(true);
    setError(null);
    try {
      if (step.check && (step.check.type === "mc" || step.check.type === "multi" || step.check.type === "short")) {
        await onCheck();
      }
      if (step.kind === "diagnose" && answer.trim()) {
        const d = await diagnose(sessionId, answer);
        setDiagFeedback(d.feedback);
        setDiagOk(d.correct);
        if (d.correct) sfx.success();
        else sfx.fail();
      }
      const res = await submitAnswer(sessionId, {
        stepId: step.id,
        text: answer,
        diagnosis: step.kind === "diagnose" ? answer : undefined,
        advance,
      });
      setCurrentStepId(res.currentStepId);
      setCompleted(res.completedStepIds);
      if (advance) {
        setAnswer("");
        setSelectedOpts([]);
        setCheckFeedback(null);
        setCheckPassed(null);
        setCheckExplain(null);
        setRevealLevel(0);
        const next = mission?.steps.find((s) => s.id === res.currentStepId);
        await loadStepConcepts(next?.conceptIds ?? []);
        sfx.tick();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function onFix() {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await applyFix(sessionId);
      setWorld(res.world);
      setMentor(res.message);
      sfx.unlock();
      await refreshWorld(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      sfx.fail();
    } finally {
      setLoading(false);
    }
  }

  async function onHint(role = "socratic_coach") {
    if (!sessionId) return;
    const next = hintLevel + 1;
    setHintLevel(next);
    sfx.click();
    const m = await askMentor(sessionId, answer || step?.prompt || "help", next, role);
    setMentor(m.content + (m.citesUncertainty ? " · Simulated mentor — verify official SAP docs." : ""));
  }

  async function onReveal() {
    if (!sessionId || !step) return;
    const r = await revealTeach(sessionId, step.id);
    setRevealLevel(r.revealLevel);
    sfx.click();
  }

  async function onEvaluate() {
    if (!sessionId) return;
    setLoading(true);
    try {
      if (step && answer.trim()) {
        await submitAnswer(sessionId, {
          stepId: step.id,
          text: answer,
          diagnosis: step.kind === "diagnose" ? answer : undefined,
        });
      }
      const r = await evaluate(sessionId);
      setResult(r);
      setView("result");
      if (r.passed) sfx.success();
      else sfx.fail();
      await refreshLearner();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function openAtlasConcept(id: string) {
    if (!id) {
      setAtlasError("No concept id provided");
      setView("atlas");
      return;
    }
    setAtlasLoading(true);
    setAtlasError(null);
    setView("atlas");
    try {
      // Prefer catalog payload if already rich
      const cached = catalog?.concepts?.find((c) => c.id === id);
      if (cached?.explain && cached.explain.length > 40) {
        setAtlasConcept({
          id: cached.id,
          title: cached.title,
          domainId: cached.domainId,
          level: cached.level,
          summary: cached.summary,
          tags: cached.tags ?? [],
          explain: cached.explain,
          analogy: cached.analogy ?? "",
          whyItMatters: cached.whyItMatters ?? "",
          formalPoints: [],
          commonMistakes: [],
          howToRecognize: [],
          howToApply: [],
          glossary: [],
          relatedIds: [],
        });
      }
      const { concept } = await fetchConcept(id);
      setAtlasConcept(concept);
      sfx.click();
      // scroll detail into view after paint
      setTimeout(() => {
        document.querySelector(".atlas-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } catch (e) {
      setAtlasError(e instanceof Error ? e.message : String(e));
      setAtlasConcept(null);
      sfx.fail();
    } finally {
      setAtlasLoading(false);
    }
  }

  async function openLearningPath(title: string, ids: string[]) {
    if (!ids.length) {
      setAtlasError("This path has no concepts yet");
      setView("atlas");
      return;
    }
    setPathWalk({ title, ids, index: 0 });
    await openAtlasConcept(ids[0]!);
  }

  function runNextStep() {
    const cq = questBoard?.currentQuest;
    if (!cq) {
      // Default newcomer path
      void openLearningPath("New to BTP? Start here", [
        "btp-what",
        "btp-services-map",
        "btp-platform-structure",
        "btp-security-admin",
      ]);
      return;
    }
    sfx.launch();
    if (cq.cta.type === "challenge") {
      setResumeChallengeId(cq.cta.id ?? null);
      go("play");
      return;
    }
    if (cq.cta.type === "arena") {
      setArenaScenarioId(cq.cta.id ?? null);
      go("architect");
      return;
    }
    if (cq.cta.type === "mission" && cq.cta.id) {
      void onStartMission(cq.cta.id);
      return;
    }
    if (cq.cta.type === "atlas") {
      if (cq.conceptIds?.length) {
        void openLearningPath(cq.title, cq.conceptIds);
      } else if (cq.cta.id) void openAtlasConcept(cq.cta.id);
      else go("atlas");
    }
  }

  function startBeginnerJourney() {
    sfx.launch();
    setResumeChallengeId("ch-btp-what-intro");
    const full =
      catalog?.learningPaths?.find((p) => p.id === "path-full-spine")?.conceptIds ??
      catalog?.concepts?.map((c) => c.id) ??
      [];
    const startIds = full.length
      ? full.slice(0, 12)
      : [
          "btp-what",
          "btp-services-map",
          "btp-platform-structure",
          "ops-accounts",
          "btp-security-admin",
          "sec-authn-authz",
          "sec-destinations",
          "c-least-privilege",
        ];
    void openLearningPath("Full BTP Odyssey · start of spine", startIds);
  }

  const domainFilterName =
    catalog?.domains.find((d) => d.id === filterDomain)?.districtName ?? null;

  return (
    <div className="odyssey ux-min">
      {view === "home" && <Starfield />}
      <header className="topnav topnav-min">
        <button type="button" className="logo" onClick={() => go("home")} title="Home">
          <span className="logo-mark">Ω</span>
          <span className="logo-text">
            <strong>BTP Odyssey</strong>
          </span>
        </button>
        <nav className="nav-tabs nav-tabs-min" aria-label="Primary">
          {primaryNav.map((n) => (
            <button
              key={n.id}
              type="button"
              aria-current={view === n.id ? "page" : undefined}
              onClick={() => go(n.id)}
            >
              {n.label}
            </button>
          ))}
          <div className="nav-more-wrap">
            <button
              type="button"
              className="nav-more-btn"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-current={moreActive ? "page" : undefined}
              onClick={() => setMoreOpen((o) => !o)}
            >
              More
            </button>
            {moreOpen && (
              <div className="nav-more-menu" role="menu">
                {moreNav.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    role="menuitem"
                    aria-current={view === n.id ? "page" : undefined}
                    onClick={() => go(n.id)}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>
        <div className="nav-meta nav-meta-min">
          <button
            type="button"
            className="icon-btn"
            title={audioOn ? "Mute" : "Sound on"}
            onClick={() => {
              setAudioOn((v) => !v);
              if (!isAudioEnabled()) sfx.click();
            }}
          >
            {audioOn ? "♪" : "ø"}
          </button>
        </div>
      </header>

      <main className="main main-min">
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}

        {LIVING_VIEWS.has(view) && (
          <LivingApp
            hideShell
            externalRoute={view as LivingRoute}
            onExitTo={(dest) => go(dest as View)}
          />
        )}

        {questBoard?.currentQuest &&
          view !== "mission" &&
          view !== "result" &&
          !LIVING_VIEWS.has(view) && (
          <ObjectiveCompass
            title={questBoard.currentQuest.title}
            detail={`${questBoard.currentQuest.objective}${questBoard.followingQuest ? ` → Next after this: ${questBoard.followingQuest.title}` : ""}`}
            ctaLabel={questBoard.currentQuest.cta.label}
            onCta={runNextStep}
            progressLabel={`Tier: ${questBoard.currentQuest.tier} · Quest spine ${questBoard.quests.filter((q) => q.done).length}/${questBoard.quests.length}`}
          />
        )}

        {view === "home" && (
          <>
            <section className="hero hero-min">
              <h1>Learn SAP BTP by doing</h1>
              <p className="hero-lead">
                One path: fix a living incident, then deepen with Play, Atlas, and Arena.
              </p>
              <div className="hero-actions hero-actions-min">
                <button className="btn primary" type="button" onClick={() => go("incident")}>
                  Start incident
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setResumeChallengeId("ch-btp-what-intro");
                    go("play");
                  }}
                >
                  Play path
                </button>
                {recommended && (
                  <button
                    className="btn ghost"
                    type="button"
                    disabled={loading}
                    onClick={() => onStartMission(recommended.id)}
                  >
                    Mission
                  </button>
                )}
              </div>
              <div className="home-secondary" aria-label="More ways in">
                <button type="button" className="linkish" onClick={() => go("atlas")}>
                  Atlas
                </button>
                <button type="button" className="linkish" onClick={() => go("architect")}>
                  Arena
                </button>
                <button type="button" className="linkish" onClick={runNextStep}>
                  Next quest
                </button>
                <button type="button" className="linkish" onClick={startBeginnerJourney}>
                  Beginner spine
                </button>
                <button type="button" className="linkish" onClick={() => go("continue")}>
                  Continue
                </button>
                <button type="button" className="linkish" onClick={() => go("portfolio")}>
                  Portfolio
                </button>
              </div>
              <p className="home-foot muted">
                Independent simulation · not SAP certification ·{" "}
                {challengePack?.totalChallenges ?? "…"} games · {catalog?.conceptCount ?? "…"}{" "}
                concepts
                {learner?.profile.demonstratedCompetencies.length
                  ? ` · ${learner.profile.demonstratedCompetencies.length} skills evidenced`
                  : ""}
              </p>
            </section>

            {questBoard?.currentQuest && (
              <section className="panel panel-min home-next" aria-label="Next quest">
                <div className="home-next-row">
                  <div>
                    <div className="hero-kicker">Next</div>
                    <strong>{questBoard.currentQuest.title}</strong>
                  </div>
                  <button className="btn primary" type="button" onClick={runNextStep}>
                    Go
                  </button>
                </div>
              </section>
            )}

            <section className="panel panel-min">
              <div className="home-next-row" style={{ marginBottom: "0.75rem" }}>
                <h2 style={{ margin: 0, fontSize: "1rem" }}>
                  Missions {domainFilterName ? `· ${domainFilterName}` : ""}
                </h2>
                <button
                  type="button"
                  className="linkish"
                  onClick={() => setFilterDomain(null)}
                >
                  All districts
                </button>
              </div>
              <div className="domain-pills" role="list">
                {(catalog?.domains ?? []).slice(0, 8).map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`domain-pill${filterDomain === d.id ? " on" : ""}`}
                    onClick={() => setFilterDomain(filterDomain === d.id ? null : d.id)}
                  >
                    {d.districtName || d.title}
                  </button>
                ))}
              </div>
              <div className="mission-grid">
                {missionsShown.map((m) => {
                  const done = learner?.profile.completedMissions.includes(m.id);
                  return (
                    <article key={m.id} className={`mission-card${done ? " done" : ""}`}>
                      <div className="tags">
                        <span className={`tag level-${m.targetLevel}`}>{m.targetLevel}</span>
                        <span className="tag fid">{FIDELITY[m.fidelityTier]}</span>
                        <span className="tag">{m.stepCount} steps</span>
                        <span className="tag">~{m.estimatedMinutes}m</span>
                      </div>
                      <h3>{m.title}</h3>
                      <p>{m.summary}</p>
                      <div className="action-row">
                        <button
                          className="btn primary"
                          type="button"
                          disabled={loading}
                          onClick={() => onStartMission(m.id)}
                        >
                          {done ? "Replay mega act" : "Enter teaching cockpit"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {view === "mission" && mission && step && (
          <div className="cockpit-teach">
            <aside className="panel">
              <h2 style={{ fontSize: "0.9rem" }}>{mission.title.split("—")[0]}</h2>
              <div className="progress-track">
                <i style={{ width: `${progress}%` }} />
              </div>
              <p className="muted" style={{ fontSize: "0.78rem" }}>
                {completed.length}/{mission.steps.length} · checks ✓ {checksPassedCount}
              </p>
              <ul className="step-rail">
                {mission.steps.map((s, idx) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`${s.id === currentStepId ? "active" : ""} ${completed.includes(s.id) ? "done" : ""}`}
                      onClick={() => selectStep(s.id)}
                    >
                      <span className="idx">{String(idx + 1).padStart(2, "0")}</span>
                      <span>
                        {s.phase ? <span className="phase-chip">{s.phase.split("·")[0]}</span> : null}
                        {s.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="action-row">
                <button className="btn ghost" type="button" onClick={() => go("home")}>
                  Exit
                </button>
                <button className="btn primary" type="button" onClick={onEvaluate}>
                  Submit evidence
                </button>
              </div>
            </aside>

            <TeachPanel
              step={step}
              concepts={relatedConcepts}
              revealLevel={revealLevel}
              onReveal={onReveal}
              checkFeedback={checkFeedback}
              checkPassed={checkPassed}
            />

            <section className="panel scan">
              <div className="fidelity-strip">
                <div>
                  <strong>{FIDELITY[mission.fidelity.tier]}</strong>
                  <div>
                    Teach → check → apply. {incidentTitle ? `Incident: ${incidentTitle}` : ""}
                  </div>
                </div>
              </div>
              {step.phase && <div className="phase-chip">{step.phase}</div>}
              <div className="prompt-box">
                <div className="kind">{step.kind.replace(/_/g, " ")}</div>
                <h3>{step.title}</h3>
                <p style={{ margin: 0 }}>{step.prompt}</p>
              </div>

              {step.check && (step.check.type === "mc" || step.check.type === "multi") && (
                <div className="check-box">
                  <h4>{step.check.question}</h4>
                  {step.check.options.map((o) => {
                    const selected = selectedOpts.includes(o.id);
                    return (
                      <label
                        key={o.id}
                        className={`check-option${selected ? " selected" : ""}`}
                      >
                        <input
                          type={step.check?.type === "multi" ? "checkbox" : "radio"}
                          name="checkopt"
                          checked={selected}
                          onChange={() => {
                            if (step.check?.type === "multi") {
                              setSelectedOpts((prev) =>
                                prev.includes(o.id)
                                  ? prev.filter((x) => x !== o.id)
                                  : [...prev, o.id],
                              );
                            } else setSelectedOpts([o.id]);
                          }}
                        />
                        <span>{o.text}</span>
                      </label>
                    );
                  })}
                  <div className="action-row">
                    <button className="btn violet" type="button" disabled={loading} onClick={onCheck}>
                      Check understanding
                    </button>
                  </div>
                  {checkExplain && (
                    <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
                      {checkExplain}
                    </p>
                  )}
                </div>
              )}

              {(!step.check || step.check.type === "short" || step.kind === "diagnose") && (
                <>
                  {step.check?.type === "short" && (
                    <p className="muted" style={{ fontSize: "0.85rem" }}>
                      <strong>Check:</strong> {step.check.question}
                    </p>
                  )}
                  <textarea
                    className="console"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Write using precise terms from the teaching panel…"
                  />
                </>
              )}

              <div className="action-row">
                {step.check?.type === "short" && (
                  <button className="btn violet" type="button" disabled={loading} onClick={onCheck}>
                    Check answer
                  </button>
                )}
                <button className="btn" type="button" disabled={loading} onClick={() => onSave(false)}>
                  Save
                </button>
                <button
                  className="btn primary"
                  type="button"
                  disabled={loading}
                  onClick={() => onSave(true)}
                >
                  Commit & next micro-step
                </button>
                <button className="btn" type="button" onClick={() => onHint()}>
                  Hint
                </button>
                <button className="btn" type="button" onClick={() => onHint("architecture_review_board")}>
                  Board
                </button>
                {(step.kind === "resolve" ||
                  step.kind === "configure" ||
                  step.kind === "mitigate" ||
                  step.kind === "diagnose") && (
                  <button className="btn good" type="button" onClick={onFix}>
                    Apply secure fix
                  </button>
                )}
              </div>

              {diagFeedback && (
                <div className={`feedback ${diagOk ? "ok" : "bad"}`}>
                  <strong>Diagnosis engine:</strong> {diagFeedback}
                </div>
              )}
              {mentor && (
                <div className="feedback mentor">
                  <strong>Mentor:</strong> {mentor}
                </div>
              )}
            </section>

            <aside className="panel">
              <div className="nav-tabs" style={{ marginBottom: "0.5rem" }}>
                {(
                  [
                    ["graph", "Graph"],
                    ["resources", "Fleet"],
                    ["logs", "Telemetry"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-current={opsTab === id ? "page" : undefined}
                    onClick={() => setOpsTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {opsTab === "graph" && (
                <div className="ops-block arch-ops">
                  <h4>Architecture pulse</h4>
                  <p className="muted" style={{ fontSize: "0.72rem", margin: "0 0 0.45rem" }}>
                    Realtime engine · layered topology · pulse on unhealthy · click to focus
                  </p>
                  <ArchitectureEngineView resources={world?.resources ?? []} />
                  {/* Accessible fallback list */}
                  <details style={{ marginTop: "0.5rem" }}>
                    <summary className="muted" style={{ fontSize: "0.78rem", cursor: "pointer" }}>
                      Accessible resource list
                    </summary>
                    <ArchitectureGraph resources={world?.resources ?? []} />
                  </details>
                </div>
              )}
              {opsTab === "resources" && (
                <div className="ops-block" style={{ maxHeight: "70vh", overflow: "auto" }}>
                  {(world?.resources ?? []).map((r) => (
                    <div key={r.id} className="resource-row">
                      <header>
                        <span>{r.name}</span>
                        <span className={`health ${r.health}`}>{r.health}</span>
                      </header>
                      <div className="muted mono" style={{ fontSize: "0.68rem" }}>
                        {r.kind}
                      </div>
                      <pre
                        className="mono"
                        style={{ fontSize: "0.6rem", color: "var(--muted)", whiteSpace: "pre-wrap" }}
                      >
                        {JSON.stringify(r.configuration, null, 0).slice(0, 160)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
              {opsTab === "logs" && (
                <div className="ops-block">
                  <div className="log-stream">
                    {logs.map((l) => (
                      <div
                        key={l.id}
                        className={l.level === "error" ? "e" : l.level === "warn" ? "w" : "i"}
                      >
                        [{l.level}] {l.resourceId}: {l.message}
                      </div>
                    ))}
                    {metrics.map((m, i) => (
                      <div key={`m${i}`} className="i">
                        metric {m.resourceId}.{m.name}={m.value}
                      </div>
                    ))}
                    {traces.map((t, i) => (
                      <div key={`t${i}`} className={t.status === "error" ? "e" : "i"}>
                        trace {t.resourceId} {t.name} {t.status}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}

        {(view === "play" || view === "home") && returnLoop && (
          <ReturnLoopBanner
            data={returnLoop}
            onResume={() => {
              if (returnLoop.unfinishedChallengeId) {
                setResumeChallengeId(returnLoop.unfinishedChallengeId);
                go("play");
              }
            }}
            onPlayNext={() => {
              setResumeChallengeId(returnLoop.nextUnlockId);
              go("play");
            }}
            onCuriosity={() => {
              go("atlas");
            }}
          />
        )}

        {view === "play" && challengePack && (
          <ChallengePlay
            pack={challengePack}
            clearedIds={challengesCleared}
            initialChallengeId={resumeChallengeId}
            freePlay={playFreeMode}
            onProgress={(p) => {
              void saveChallengeProgress(p);
            }}
            onCleared={async (id, stats) => {
              const res = await clearChallenge(id, stats);
              setChallengesCleared(res.clearedIds ?? [...challengesCleared, id]);
              setResumeChallengeId(null);
              setPlayFreeMode(false);
              if (res.returnLoop) setReturnLoop(res.returnLoop);
              else {
                const ch2 = await fetchChallenges();
                setReturnLoop(ch2.returnLoop ?? null);
              }
              if (res.engagement || res.reward) {
                setToast({
                  title: res.reward?.label ?? "Challenge cleared",
                  detail: `+${res.reward?.prestige ?? 0} prestige · ${res.reward?.peak ?? "normal"} peak · ${res.engagement?.architectRank ?? ""}${
                    res.returnLoop?.stopHint ? ` · ${res.returnLoop.stopHint}` : ""
                  }`,
                });
              }
              await refreshLearner();
              return res.reward;
            }}
            onOpenConcept={(id) => void openAtlasConcept(id)}
          />
        )}
        {view === "play" && !challengePack && (
          <div className="panel">Loading challenge campaign…</div>
        )}

        {view === "architect" && (
          <ArchitectStudio
            scenarios={architectScenarios}
            initialScenarioId={arenaScenarioId}
            onSubmit={async (scenarioId, body) => {
              const res = await evaluateArchitect({
                scenarioId,
                selectedOptionId: body.selectedOptionId,
                rejectedOptionIds: body.rejectedOptionIds,
                weights: body.weights as Record<string, number>,
                rationale: body.rationale,
                boardAnswers: body.boardAnswers,
              });
              if (res.engagement) {
                setLearner((prev) =>
                  prev
                    ? {
                        ...prev,
                        engagement: {
                          ...res.engagement!,
                          openLoops: res.engagement!.openLoops ?? [],
                          masteryMoments: res.engagement!.masteryMoments ?? [],
                        },
                        profile: {
                          ...prev.profile,
                          engagement: {
                            prestige: res.engagement!.prestige,
                            flowScore: res.engagement!.flowScore,
                            architectRank: res.engagement!.architectRank,
                            openLoops: res.engagement!.openLoops ?? [],
                            masteryMoments: res.engagement!.masteryMoments ?? [],
                          },
                        },
                      }
                    : prev,
                );
                if (res.passed) {
                  setToast({
                    title: "Mastery moment",
                    detail: `Board pass · +${res.prestigeDelta} prestige · ${res.engagement.architectRank}`,
                  });
                  sfx.unlock();
                }
              }
              await refreshLearner();
              return res;
            }}
            onOpenLoop={() => {
              /* server persists open loops */
            }}
          />
        )}

        {view === "atlas" && (
          <section className="panel">
            <div className="atlas-hero-fx">
              <h2 style={{ margin: "0 0 0.35rem" }}>Concept Atlas</h2>
              <p className="sub" style={{ margin: 0, maxWidth: "64ch" }}>
                {catalog?.conceptCount ?? catalog?.concepts?.length ?? 0} concepts — each card runs a
                labeled animation that explains the idea (JWT chain, tenant walls, $expand cost, RAG,
                clean-core…). Hover speeds it up; open for full teach beats + text.
              </p>
            </div>

            <div className="atlas-toolbar">
              <input
                type="search"
                placeholder="Search title, domain, tag…"
                value={atlasFilter}
                onChange={(e) => setAtlasFilter(e.target.value)}
                aria-label="Search concepts"
              />
              <AtlasMotionControl value={atlasMotion} onChange={setAtlasMotion} />
            </div>

            <div className="atlas-domain-chiprow" role="tablist" aria-label="Filter by domain">
              <button
                type="button"
                className={`atlas-domain-chip${atlasDomain === null ? " on" : ""}`}
                onClick={() => setAtlasDomain(null)}
              >
                All
                <span className="n">{catalog?.concepts?.length ?? 0}</span>
              </button>
              {atlasDomainCounts.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`atlas-domain-chip${atlasDomain === d.id ? " on" : ""}`}
                  onClick={() => setAtlasDomain(d.id)}
                >
                  {d.id}
                  <span className="n">{d.n}</span>
                </button>
              ))}
            </div>

            {atlasLoading && <p className="muted">Loading concept…</p>}
            {atlasError && (
              <div className="alert" role="alert">
                {atlasError}
              </div>
            )}

            {pathWalk && (
              <div className="objective-compass" style={{ marginBottom: "0.85rem" }}>
                <div className="compass-body" style={{ gridColumn: "1 / -1" }}>
                  <div className="compass-kicker">Guided path · clear next step</div>
                  <strong>
                    {pathWalk.title} · {pathWalk.index + 1}/{pathWalk.ids.length}
                  </strong>
                  <p>Read this card, then advance. One concept at a time keeps load low.</p>
                  <div className="action-row">
                    <button
                      className="btn"
                      type="button"
                      disabled={pathWalk.index <= 0}
                      onClick={() => {
                        const i = pathWalk.index - 1;
                        setPathWalk({ ...pathWalk, index: i });
                        void openAtlasConcept(pathWalk.ids[i]!);
                      }}
                    >
                      Previous
                    </button>
                    <button
                      className="btn primary"
                      type="button"
                      disabled={pathWalk.index >= pathWalk.ids.length - 1}
                      onClick={() => {
                        const i = pathWalk.index + 1;
                        setPathWalk({ ...pathWalk, index: i });
                        void openAtlasConcept(pathWalk.ids[i]!);
                      }}
                    >
                      Next concept
                    </button>
                    <button className="btn" type="button" onClick={() => setPathWalk(null)}>
                      Exit path
                    </button>
                  </div>
                </div>
              </div>
            )}

            {atlasConcept && (
              <div className="atlas-detail atlas-detail-fx" id="atlas-detail">
                <div className="atlas-detail-inner">
                  <ConceptDetailArt
                    concept={{
                      id: atlasConcept.id,
                      title: atlasConcept.title,
                      domainId: atlasConcept.domainId,
                      level: atlasConcept.level,
                      summary: atlasConcept.summary,
                      tags: atlasConcept.tags,
                    }}
                    height={200}
                  />
                  <div className="atlas-read">
                    <div className="tags">
                      <span className={`tag level-${atlasConcept.level}`}>
                        {atlasConcept.level}
                      </span>
                      <span className="tag">{atlasConcept.domainId}</span>
                    </div>
                    <h3>{atlasConcept.title}</h3>
                    {atlasConcept.summary && (
                      <p className="muted">
                        <strong>In one line:</strong> {atlasConcept.summary}
                      </p>
                    )}

                    {(atlasConcept.mnemonic || atlasConcept.memoryHook) && (
                      <div className="memory-card">
                        <div className="hero-kicker">Mnemonic · etch this</div>
                        <p style={{ margin: 0, fontWeight: 650 }}>
                          {atlasConcept.mnemonic || atlasConcept.memoryHook}
                        </p>
                      </div>
                    )}

                    <div style={{ whiteSpace: "pre-wrap" }}>{atlasConcept.explain}</div>
                    {atlasConcept.analogy && (
                      <p>
                        <strong>Analogy:</strong> {atlasConcept.analogy}
                      </p>
                    )}
                    {atlasConcept.whyItMatters && (
                      <p>
                        <strong>Why it matters:</strong> {atlasConcept.whyItMatters}
                      </p>
                    )}

                    {(atlasConcept.useCases?.length ?? 0) > 0 && (
                      <>
                        <h4>Use cases (clear picture)</h4>
                        <ol className="use-case-list">
                          {atlasConcept.useCases!.map((u) => (
                            <li key={u}>{u}</li>
                          ))}
                        </ol>
                      </>
                    )}

                    {(atlasConcept.designTradeoffs?.length ?? 0) > 0 && (
                      <>
                        <h4>Architect design trade-offs (≥3)</h4>
                        <div className="tradeoff-grid">
                          {atlasConcept.designTradeoffs!.map((t) => (
                            <article key={t.decision} className="tradeoff-card">
                              <h5>{t.decision}</h5>
                              <p>
                                <strong>A:</strong> {t.optionA}
                              </p>
                              <p>
                                <strong>B:</strong> {t.optionB}
                              </p>
                              <p className="muted">
                                <strong>Choose A when:</strong> {t.whenChooseA}
                              </p>
                              <p className="muted">
                                <strong>Choose B when:</strong> {t.whenChooseB}
                              </p>
                              <p className="tradeoff-risk">
                                <strong>Risk if wrong:</strong> {t.risk}
                              </p>
                            </article>
                          ))}
                        </div>
                      </>
                    )}

                    <ConceptUseArena
                      concept={atlasConcept}
                      onLaunchFullGame={(role) => {
                        const g =
                          atlasConcept.linkedGames?.find((x) => x.role === role) ||
                          atlasConcept.linkedGames?.[0];
                        if (!g) return;
                        setPlayFreeMode(true);
                        setResumeChallengeId(g.id);
                        go("play");
                      }}
                    />

                    {(atlasConcept.linkedGames?.length ?? 0) > 0 && (
                      <>
                        <h4>Campaign games for this concept</h4>
                        <p className="muted" style={{ fontSize: "0.85rem" }}>
                          Seven cinematic games:{" "}
                          <strong>What → When → How → Trap → Scenario → Compare → Mastery</strong>.
                          Play free from this card (how/when focus) or follow the linear path in PLAY.
                        </p>
                        <div className="concept-games-grid">
                          {atlasConcept.linkedGames!.map((g) => {
                            const labels: Record<string, string> = {
                              intro: "What is it?",
                              when: "When to use",
                              how: "How to use",
                              trap: "Trap / misuse",
                              scenario: "Scenario story",
                              compare: "Compare tradeoff",
                              mastery: "Mastery",
                            };
                            return (
                              <button
                                key={g.id}
                                type="button"
                                className={`concept-game-chip role-${g.role}`}
                                onClick={() => {
                                  setPlayFreeMode(true);
                                  setResumeChallengeId(g.id);
                                  go("play");
                                }}
                                title={g.purpose}
                              >
                                <span className="chip-role">{g.role}</span>
                                <span className="chip-title">
                                  {labels[g.role] || g.role}
                                </span>
                                <span className="chip-purpose">
                                  {g.purpose || g.title}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}

                    {(atlasConcept.formalPoints?.length ?? 0) > 0 && (
                      <>
                        <h4>Key points</h4>
                        <ul>
                          {atlasConcept.formalPoints.map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    <h4>Common mistakes</h4>
                    <ul className="mistakes">
                      {(atlasConcept.commonMistakes?.length
                        ? atlasConcept.commonMistakes
                        : ["Write one failure mode yourself — that is how memory sticks."]
                      ).map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                    <h4>How to apply</h4>
                    <ul>
                      {(atlasConcept.howToApply?.length
                        ? atlasConcept.howToApply
                        : [`Use ${atlasConcept.title} in your next architecture defense.`]
                      ).map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                    {(atlasConcept.glossary?.length ?? 0) > 0 && (
                      <>
                        <h4>Glossary</h4>
                        <ul>
                          {atlasConcept.glossary.map((g) => (
                            <li key={g.term}>
                              <strong>{g.term}:</strong> {g.definition}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                  <div className="atlas-sticky-actions">
                    <button className="btn" type="button" onClick={() => setAtlasConcept(null)}>
                      Back to grid
                    </button>
                    {(atlasConcept.linkedGames?.length ?? 0) > 0 && (
                      <button
                        className="btn primary"
                        type="button"
                        onClick={() => {
                          const g =
                            atlasConcept.linkedGames!.find((x) => x.role === "when") ||
                            atlasConcept.linkedGames!.find((x) => x.role === "how") ||
                            atlasConcept.linkedGames![0];
                          setPlayFreeMode(true);
                          setResumeChallengeId(g!.id);
                          go("play");
                        }}
                      >
                        ▶ Play when/how games
                      </button>
                    )}
                    {pathWalk && pathWalk.index < pathWalk.ids.length - 1 && (
                      <button
                        className="btn"
                        type="button"
                        onClick={() => {
                          const i = pathWalk.index + 1;
                          setPathWalk({ ...pathWalk, index: i });
                          void openAtlasConcept(pathWalk.ids[i]!);
                        }}
                      >
                        Next in path →
                      </button>
                    )}
                    <button className="btn violet" type="button" onClick={runNextStep}>
                      Quest next step
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!atlasConcept && !atlasLoading && (
              <p className="muted" style={{ marginBottom: "0.75rem" }}>
                Pick a card. Hover for motion. Open to learn.
              </p>
            )}

            {atlasList.length === 0 ? (
              <div className="atlas-empty">No concepts match. Clear search or domain filter.</div>
            ) : (
              atlasGroups.map((g) => (
                <section key={g.domainId} className="atlas-domain-section">
                  <header className="atlas-domain-header">
                    <h3>{g.label}</h3>
                    <span className="count">
                      {g.items.length} card{g.items.length === 1 ? "" : "s"}
                    </span>
                  </header>
                  <div className="atlas-grid atlas-grid-fx">
                    {g.items.map((c) => (
                      <AtlasCardShell
                        key={c.id}
                        concept={{
                          id: c.id,
                          title: c.title,
                          domainId: c.domainId,
                          level: c.level,
                          summary: c.summary,
                          tags: c.tags,
                        }}
                        selected={atlasConcept?.id === c.id}
                        onClick={() => void openAtlasConcept(c.id)}
                      >
                        <span className={`tag level-${c.level}`}>{c.level}</span>
                        <h3>{c.title}</h3>
                        <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>
                          {c.summary || c.explain?.slice(0, 100) || "Open to study"}
                        </p>
                        <p className="concept-card-meta">
                          2 games · mnemonic · 3 trade-offs
                        </p>
                      </AtlasCardShell>
                    ))}
                  </div>
                </section>
              ))
            )}

            {(catalog?.learningPaths?.length ?? 0) > 0 && (
              <>
                <h2 style={{ marginTop: "1.25rem" }}>Guided learning paths</h2>
                <p className="sub">Sequenced concepts — one open loop at a time.</p>
                <div className="mission-grid">
                  {catalog!.learningPaths.map((p) => (
                    <article key={p.id} className="mission-card">
                      <h3>{p.title}</h3>
                      <p>
                        {p.conceptIds?.length ?? 0} concepts
                        {(p as { nextHint?: string }).nextHint
                          ? ` · ${(p as { nextHint?: string }).nextHint}`
                          : ""}
                      </p>
                      <div className="action-row">
                        <button
                          className="btn primary"
                          type="button"
                          onClick={() => openLearningPath(p.title, p.conceptIds ?? [])}
                        >
                          Start path
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {view === "result" && result && (
          <section className={`victory${result.passed ? "" : " fail"}`}>
            <p className="hero-kicker">
              {result.passed ? "Evidence accepted" : "Keep studying the teach panels"}
            </p>
            <div className="score">{(result.overallScore * 100).toFixed(0)}</div>
            <p style={{ maxWidth: "48ch", margin: "0.5rem auto", color: "var(--muted)" }}>
              {result.summary}
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
            <ul
              style={{
                textAlign: "left",
                maxWidth: 520,
                margin: "0 auto 1rem",
                color: "var(--muted)",
                fontSize: "0.88rem",
              }}
            >
              {result.evidence.map((e, i) => (
                <li key={i}>
                  <strong style={{ color: "var(--text)" }}>{e.dimension}</strong>: {e.rationale}
                </li>
              ))}
            </ul>
            <p className="disclaimer">{result.disclaimer}</p>
            <div className="action-row" style={{ justifyContent: "center" }}>
              <button className="btn primary" type="button" onClick={() => go("home")}>
                Universe
              </button>
              <button className="btn violet" type="button" onClick={() => go("atlas")}>
                Review concepts
              </button>
              {recommended && result.passed && (
                <button className="btn good" type="button" onClick={() => onStartMission(recommended.id)}>
                  Next act
                </button>
              )}
            </div>
          </section>
        )}

        {view === "trees" && questBoard && (
          <section className="panel">
            <SkillTreePanel
              trees={questBoard.skillTrees}
              labels={questBoard.skillTreeLabels}
              onOpenConcept={(id) => {
                void openAtlasConcept(id);
                go("atlas");
              }}
            />
          </section>
        )}

        {view === "skills" && catalog && (
          <section className="panel">
            <h2>Skill constellation</h2>
            <CompetencyConstellation
              order={catalog.competencyOrder}
              competencies={catalog.competencies}
              demonstrated={new Set(learner?.profile.demonstratedCompetencies ?? [])}
            />
          </section>
        )}

        {view === "paths" && catalog && (
          <section className="panel">
            <h2>Specialization paths</h2>
            <div className="spec-grid">
              {catalog.specializations.map((s) => {
                const done = s.competencyIds.filter((id) =>
                  learner?.profile.demonstratedCompetencies.includes(id),
                ).length;
                const pct = Math.round((done / Math.max(s.competencyIds.length, 1)) * 100);
                return (
                  <div key={s.id} className="spec-card">
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <h3>{s.title}</h3>
                      <div className="ring" style={{ ["--p" as string]: pct }}>
                        <span>{pct}%</span>
                      </div>
                    </div>
                    <p className="muted" style={{ fontSize: "0.82rem" }}>
                      {done}/{s.competencyIds.length}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {view === "settings" && learner && (
          <section className="panel">
            <h2>Settings</h2>
            <p className="muted" style={{ fontSize: "0.88rem" }}>
              Classic settings plus Living Enterprise preferences (session goals, low-stim, quiet
              hours) are on the same path — open{" "}
              <button type="button" className="btn ghost" onClick={() => go("preferences")}>
                Preferences
              </button>{" "}
              for extended a11y / ethics controls. Nothing is hidden in another product version.
            </p>
            <div className="form-grid">
              <label>
                Callsign
                <input type="text" id="displayName" defaultValue={learner.profile.displayName} />
              </label>
              <label>
                Theme
                <select id="theme" defaultValue={learner.profile.settings.theme}>
                  <option value="system">System</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </label>
              <label>
                Break minutes
                <input
                  type="text"
                  id="breakMin"
                  defaultValue={String(learner.profile.settings.sessionBreakMinutes)}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  id="reducedMotion"
                  defaultChecked={learner.profile.settings.reducedMotion}
                />
                Reduced motion
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  id="highContrast"
                  defaultChecked={learner.profile.settings.highContrast}
                />
                High contrast
              </label>
              <div className="action-row">
                <button
                  className="btn primary"
                  type="button"
                  onClick={async () => {
                    await saveSettings(
                      {
                        theme: (document.getElementById("theme") as HTMLSelectElement).value as
                          | "system"
                          | "dark"
                          | "light",
                        reducedMotion: (
                          document.getElementById("reducedMotion") as HTMLInputElement
                        ).checked,
                        highContrast: (
                          document.getElementById("highContrast") as HTMLInputElement
                        ).checked,
                        sessionBreakMinutes: Number(
                          (document.getElementById("breakMin") as HTMLInputElement).value || 50,
                        ),
                        notificationsEnabled: false,
                      },
                      (document.getElementById("displayName") as HTMLInputElement).value,
                    );
                    sfx.success();
                    await refreshLearner();
                  }}
                >
                  Save
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={async () => {
                    const data = await exportData();
                    const blob = new Blob([JSON.stringify(data, null, 2)], {
                      type: "application/json",
                    });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = "btp-odyssey-export.json";
                    a.click();
                  }}
                >
                  Export
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={async () => {
                    await deleteProgress();
                    await refreshLearner();
                  }}
                >
                  Clear progress
                </button>
                <button
                  className="btn violet"
                  type="button"
                  onClick={async () => {
                    await resetProgress();
                    await refreshLearner();
                    setArenaScenarioId(null);
                    setPathWalk(null);
                    sfx.unlock();
                    go("home");
                  }}
                >
                  Restart quest spine from beginning
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      {showBreak && (
        <div className="break-toast" role="status">
          <span>
            Natural break (peak-end + rest aids consolidation). Odyssey never punishes sleep or
            pauses.
          </span>
          <button className="btn" type="button" onClick={() => setBreakDismissed(true)}>
            Resume
          </button>
        </div>
      )}
      {toast && (
        <MasteryToast
          title={toast.title}
          detail={toast.detail}
          onClose={() => setToast(null)}
        />
      )}
      <footer className="footer-note">
        SAP BTP Odyssey · Arena + Mega Teach · ethical engagement · not affiliated with SAP
      </footer>
    </div>
  );
}
