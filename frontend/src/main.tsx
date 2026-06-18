import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { Harness } from "./Harness";
import "./theme.css";

// ?harness -> dev-only component playground (no auth), for visual screenshotting.
const isHarness = new URLSearchParams(window.location.search).has("harness");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isHarness ? <Harness /> : <App />}</React.StrictMode>,
);
