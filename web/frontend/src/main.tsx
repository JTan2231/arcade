import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/auth.css";
import "./styles/public.css";
import "./styles/groups.css";
import "./styles/settings.css";
import "./styles/dashboard.css";
import "./styles/metrics.css";
import "./styles/posts.css";
import "./styles/output.css";
import "./styles/feedback.css";
import "./styles/responsive.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
