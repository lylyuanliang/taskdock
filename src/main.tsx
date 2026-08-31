import React from "react";
import ReactDOM from "react-dom/client";
import "./theme/tokens.css";
import App from "./app/App";
import { resolveLocale } from "./i18n";
import { ThemeProvider } from "./theme/ThemeProvider";

document.documentElement.lang = resolveLocale(navigator.language);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
