import type { ConceptFull, MissionStep } from "./api";

export function TeachPanel({
  step,
  concepts,
  revealLevel,
  onReveal,
  checkFeedback,
  checkPassed,
}: {
  step: MissionStep;
  concepts: ConceptFull[];
  revealLevel: number;
  onReveal: () => void;
  checkFeedback?: string[] | null;
  checkPassed?: boolean | null;
}) {
  const teach = step.teach;
  return (
    <div className="teach-panel">
      <div className="teach-kicker">
        {step.phase ? `${step.phase} · ` : ""}
        Learn before you act
      </div>
      {teach ? (
        <>
          <h3>{teach.headline}</h3>
          <p className="teach-body">{teach.explain}</p>
          {teach.analogy && (
            <div className="teach-callout analogy">
              <strong>Analogy</strong>
              <p>{teach.analogy}</p>
            </div>
          )}
          {teach.whyItMatters && (
            <div className="teach-callout why">
              <strong>Why it matters</strong>
              <p>{teach.whyItMatters}</p>
            </div>
          )}
          {teach.miniDiagram && (
            <pre className="teach-diagram">{teach.miniDiagram}</pre>
          )}
          {teach.formalPoints?.length > 0 && (
            <>
              <h4>Key points</h4>
              <ul>
                {teach.formalPoints.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
          {teach.commonMistakes?.length > 0 && (
            <>
              <h4>Common mistakes</h4>
              <ul className="mistakes">
                {teach.commonMistakes.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
          {teach.workedExample && (
            <div className="teach-callout example">
              <strong>Worked example</strong>
              <p>{teach.workedExample.setup}</p>
              <ol>
                {teach.workedExample.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <p>
                <em>{teach.workedExample.takeaway}</em>
              </p>
            </div>
          )}
          {teach.revealLevels?.length > 0 && (
            <div className="reveal-box">
              {(teach.revealLevels ?? []).slice(0, revealLevel).map((r) => (
                <div key={r.title} className="reveal-item">
                  <strong>{r.title}</strong>
                  <p>{r.body}</p>
                </div>
              ))}
              {revealLevel < (teach.revealLevels?.length ?? 0) && (
                <button type="button" className="btn" onClick={onReveal}>
                  Reveal deeper layer ({revealLevel + 1}/
                  {teach.revealLevels.length})
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="muted">
          Apply prior concepts on the simulation. Use glossary terms precisely.
        </p>
      )}

      {concepts.length > 0 && (
        <div className="concept-stack">
          <h4>Linked concepts</h4>
          {concepts.map((c) => (
            <details key={c.id} className="concept-card">
              <summary>
                {c.title}{" "}
                <span className={`tag level-${c.level}`}>{c.level}</span>
              </summary>
              <p>
                <strong>Summary:</strong> {c.summary}
              </p>
              <p>{c.explain}</p>
              <p>
                <strong>Analogy:</strong> {c.analogy}
              </p>
              <p>
                <strong>Why:</strong> {c.whyItMatters}
              </p>
              {c.commonMistakes?.length > 0 && (
                <ul className="mistakes">
                  {c.commonMistakes.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
              {c.glossary?.length > 0 && (
                <ul>
                  {c.glossary.map((g) => (
                    <li key={g.term}>
                      <strong>{g.term}:</strong> {g.definition}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          ))}
        </div>
      )}

      {checkFeedback && checkFeedback.length > 0 && (
        <div className={`feedback ${checkPassed ? "ok" : "bad"}`}>
          <strong>{checkPassed ? "Understood" : "Not yet"}</strong>
          <ul>
            {checkFeedback.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
