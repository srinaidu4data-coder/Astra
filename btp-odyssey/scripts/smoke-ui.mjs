const base = "http://localhost:8787";
const h = await fetch(`${base}/health`).then((r) => r.json());
const html = await fetch(`${base}/`).then((r) => r.text());
const jsMatch = html.match(/assets\/[^"]+\.js/);
const cssMatch = html.match(/assets\/[^"]+\.css/);
console.log({
  health: h,
  hasFonts: html.includes("Outfit"),
  js: jsMatch?.[0],
  css: cssMatch?.[0],
});
if (jsMatch) {
  const js = await fetch(`${base}/${jsMatch[0]}`).then((r) => r.text());
  console.log({
    jsLen: js.length,
    hasOdyssey: js.includes("BTP Odyssey"),
    hasContinue: js.includes("Continue journey"),
    hasCockpit: js.includes("cockpit") || js.includes("Architecture"),
  });
}
const cat = await fetch(`${base}/api/catalog`).then((r) => r.json());
console.log({
  missions: cat.missions.length,
  domains: cat.domains.length,
  specs: cat.specializations.length,
});
console.log("PRODUCT_LIVE", base);
