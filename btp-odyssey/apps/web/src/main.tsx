import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LivingApp } from "./living/LivingApp";
import "./styles.css";
import "./architect.css";
import "./game.css";
import "./engine/engine.css";
import "./game/challenge.css";

const params = new URLSearchParams(window.location.search);
const useLegacy = params.get("legacy") === "1" || params.get("shell") === "legacy";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{useLegacy ? <App /> : <LivingApp />}</StrictMode>,
);
