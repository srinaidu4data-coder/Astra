import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./architect.css";
import "./game.css";
import "./engine/engine.css";
import "./game/challenge.css";
import "./living/living.css";

/**
 * Single product entry — BTP Odyssey: The Living Enterprise.
 * All features (incident loop, PLAY, Atlas, Arena, missions, trees, skills,
 * paths, portfolio, glossary, notes, sandbox, support, settings) share one nav.
 * No legacy fork / no second shell.
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
