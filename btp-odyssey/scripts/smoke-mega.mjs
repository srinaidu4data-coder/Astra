const base = "http://localhost:8787";
const health = await fetch(`${base}/health`).then((r) => r.json());
const cat = await fetch(`${base}/api/catalog`).then((r) => r.json());
console.log({
  health: health.version,
  concepts: cat.conceptCount,
  missions: cat.missions.map((m) => `${m.id}:${m.stepCount}`),
  totalSteps: cat.missions.reduce((a, m) => a + m.stepCount, 0),
  paths: cat.learningPaths?.length,
});
const ses = await fetch(`${base}/api/sessions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ missionId: "r1-northwind-order-insights", seed: 7 }),
}).then((r) => r.json());
const step = ses.mission.steps.find((s) => s.check?.type === "mc");
const correct = step.check.options.filter((o) => o.correct).map((o) => o.id);
// correct field may be stripped from client - use first option check via server
const check = await fetch(`${base}/api/sessions/${ses.sessionId}/check`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    stepId: step.id,
    selectedOptionIds: correct.length ? correct : [step.check.options[0].id],
  }),
}).then((r) => r.json());
console.log({
  step: step.title,
  hasTeach: !!step.teach,
  checkKeys: Object.keys(check),
  passed: check.passed,
  related: ses.relatedConcepts?.length,
});
const html = await fetch(`${base}/`).then((r) => r.text());
console.log({ ui: html.includes("Outfit"), js: /assets\/index-[^"]+\.js/.test(html) });
console.log("MEGA_LIVE", base);
