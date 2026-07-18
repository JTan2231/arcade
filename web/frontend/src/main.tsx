import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/fanwood-text/400.css";

import App from "./App";
import { PageScrollControls } from "./components/PageScrollControls";
import { initializeViewerTheme } from "./theme";
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

initializeViewerTheme();

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
