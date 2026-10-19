import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AppErrorBoundary from "./components/AppErrorBoundary";
import "./index.css";

// The app's styles are scoped to #nn-chat (see the vite config), and its
// theme is read from that scope. Mirror the page's theme onto it before the
// first paint, so the standalone build and the one shared shell look alike.
const scope = document.getElementById("nn-chat");
if (scope) {
  const attr = document.documentElement.getAttribute("data-theme");
  scope.setAttribute("data-theme", attr === "dark" ? "dark" : "light");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
