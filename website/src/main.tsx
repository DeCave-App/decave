import React from "react";
import { createRoot } from "react-dom/client";
import { HomePage } from "./home";
import { PrivacyPage, TermsPage } from "./legal";
import { GuidelinesPage, HelpPage, RoadmapPage } from "./pages";
import "./styles.css";

const routes: Record<string, () => React.JSX.Element> = {
  "/privacy": PrivacyPage,
  "/privacy-policy": PrivacyPage,
  "/terms": TermsPage,
  "/terms-of-service": TermsPage,
  "/guidelines": GuidelinesPage,
  "/community-guidelines": GuidelinesPage,
  "/community": GuidelinesPage,
  "/help": HelpPage,
  "/help-center": HelpPage,
  "/roadmap": RoadmapPage,
};

function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const Page = routes[path] ?? HomePage;
  return <Page />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
