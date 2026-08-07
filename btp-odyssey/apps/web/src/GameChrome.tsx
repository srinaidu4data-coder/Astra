/**
 * Game-like chrome for Odyssey — visual engagement without dark patterns.
 * No loot boxes, shame streaks, artificial scarcity, or sleep pressure.
 */

export function ObjectiveCompass({
  title,
  detail,
  ctaLabel,
  onCta,
  progressLabel,
}: {
  title: string;
  detail: string;
  ctaLabel: string;
  onCta: () => void;
  progressLabel?: string;
}) {
  return (
    <div className="objective-compass" role="region" aria-label="Your next step">
      <div className="compass-ring" aria-hidden>
        <span className="compass-needle" />
      </div>
      <div className="compass-body">
        <div className="compass-kicker">Next step · always visible</div>
        <strong>{title}</strong>
        <p>{detail}</p>
        {progressLabel && <div className="compass-progress">{progressLabel}</div>}
        <button type="button" className="btn primary" onClick={onCta}>
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}

export function QuestLog({
  quests,
  activeId,
  onSelect,
}: {
  quests: {
    id: string;
    title: string;
    tier: string;
    objective: string;
    order: number;
    done?: boolean;
    current?: boolean;
    challengeId?: string;
    missionId?: string | null;
    arenaScenarioId?: string;
    conceptIds?: string[];
  }[];
  activeId?: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="quest-log">
      <h3>Quest log</h3>
      <p className="muted" style={{ fontSize: "0.8rem" }}>
        Ordered campaign. Optional pacing — never punished for resting.
      </p>
      <ol className="quest-list">
        {quests.map((q) => (
          <li key={q.id}>
            <button
              type="button"
              className={`quest-item${q.current ? " current" : ""}${q.done ? " done" : ""}${activeId === q.id ? " selected" : ""}`}
              onClick={() => onSelect(q.id)}
            >
              <span className="quest-tier">{q.tier}</span>
              <span className="quest-title">
                {q.done ? "✓ " : q.current ? "► " : `${q.order}. `}
                {q.title}
              </span>
              <span className="quest-obj">{q.objective}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SkillTreePanel({
  trees,
  labels,
  onOpenConcept,
}: {
  trees: Record<string, { basic: { id: string; title: string }[]; advanced: { id: string; title: string }[]; expert: { id: string; title: string }[] }>;
  labels: Record<string, string>;
  onOpenConcept: (id: string) => void;
}) {
  const domains = Object.keys(trees).sort();
  return (
    <div className="skill-trees">
      <h3>Skill trees · basic → expert</h3>
      <div className="tree-grid">
        {domains.map((d) => (
          <div key={d} className="tree-card">
            <header>
              <strong>{labels[d] ?? d}</strong>
              <span className="muted">{d}</span>
            </header>
            {(["basic", "advanced", "expert"] as const).map((lvl) => (
              <div key={lvl} className="tree-level">
                <div className={`tree-level-label level-${lvl}`}>{lvl}</div>
                <div className="tree-nodes">
                  {(trees[d]?.[lvl] ?? []).map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      className={`tree-node level-${lvl}`}
                      onClick={() => onOpenConcept(n.id)}
                      title={n.title}
                    >
                      {n.title}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function GameMapDecor() {
  return (
    <div className="game-map-decor" aria-hidden>
      <div className="terrain t1" />
      <div className="terrain t2" />
      <div className="terrain t3" />
      <div className="fog" />
    </div>
  );
}

export function EthicsBanner() {
  return (
    <div className="ethics-banner" role="note">
      <strong>Engagement ethics:</strong> Compelling by craft and curiosity — not by illegal or
      manipulative addiction tricks. No loot boxes, pay-to-win, shame streaks, sleep disruption, or
      fake urgency. You always see the next step; you may stop anytime.
    </div>
  );
}
