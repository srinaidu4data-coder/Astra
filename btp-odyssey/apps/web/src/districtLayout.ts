/** Visual coordinates (0–100) for universe map nodes */
export const DISTRICT_LAYOUT: Record<
  string,
  { x: number; y: number; hue: number; glyph: string }
> = {
  "ui5-fiori": { x: 18, y: 28, hue: 210, glyph: "◇" },
  cap: { x: 32, y: 18, hue: 195, glyph: "⬡" },
  "rap-abap": { x: 48, y: 14, hue: 170, glyph: "▣" },
  integration: { x: 68, y: 22, hue: 35, glyph: "⇄" },
  events: { x: 82, y: 32, hue: 280, glyph: "✦" },
  bpa: { x: 74, y: 48, hue: 25, glyph: "⟳" },
  workzone: { x: 58, y: 38, hue: 200, glyph: "⌂" },
  "hana-cloud": { x: 28, y: 48, hue: 160, glyph: "◉" },
  datasphere: { x: 42, y: 55, hue: 185, glyph: "◎" },
  bdc: { x: 55, y: 62, hue: 220, glyph: "◈" },
  sac: { x: 70, y: 68, hue: 250, glyph: "◐" },
  security: { x: 14, y: 62, hue: 0, glyph: "⛨" },
  operations: { x: 22, y: 78, hue: 140, glyph: "⌘" },
  incident: { x: 40, y: 82, hue: 10, glyph: "⚠" },
  architecture: { x: 50, y: 42, hue: 265, glyph: "△" },
  ai: { x: 86, y: 58, hue: 300, glyph: "✧" },
};

export const MAP_EDGES: [string, string][] = [
  ["ui5-fiori", "cap"],
  ["cap", "rap-abap"],
  ["cap", "architecture"],
  ["ui5-fiori", "workzone"],
  ["cap", "hana-cloud"],
  ["integration", "events"],
  ["integration", "cap"],
  ["events", "bpa"],
  ["hana-cloud", "datasphere"],
  ["datasphere", "bdc"],
  ["bdc", "sac"],
  ["security", "operations"],
  ["security", "cap"],
  ["operations", "incident"],
  ["architecture", "incident"],
  ["architecture", "ai"],
  ["security", "architecture"],
];
