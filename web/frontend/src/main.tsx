import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { PageScrollControls } from "./components/PageScrollControls";
import { assertPaletteValid, createArcadePalette, installCssTokens } from "./palette";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/auth.css";
import "./styles/public.css";
import "./styles/groups.css";
import "./styles/settings.css";
import "./styles/dashboard.css";
import "./styles/create-wizard.css";
import "./styles/metrics.css";
import "./styles/posts.css";
import "./styles/output.css";
import "./styles/feedback.css";
import "./styles/responsive.css";

const palette = createArcadePalette();
assertPaletteValid(palette.validation);
installCssTokens(palette.tokens);

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
    <PageScrollControls contentRoot={root} />
  </StrictMode>,
);
