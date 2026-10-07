// Home dashboard: choosing, resizing and reordering widgets, presets, editing
// quick links and adding external widgets.

import type { Dispatch, SetStateAction } from "react";
import type { HomeDashboardWidget } from "../types";
import {
  MAX_EXTERNAL_HOME_WIDGETS,
  MAX_EXTERNAL_HOME_WIDGET_TITLE_LENGTH,
  MAX_HOME_QUICK_LINKS,
  type HomeQuickLink,
  HOME_QUICK_LINKS,
  normalizeHomeQuickLink,
  isExternalHomeWidget,
  normalizeExternalHomeWidgetTitle,
  normalizeExternalHomeWidgetUrl,
} from "../home-dashboard";
import {
  fitHomeWidgetSize,
  homePresetLayout,
  homeWidgetDefinition,
  type HomePreset,
  type HomeWidgetId,
  type HomeWidgetSize,
} from "../../features/home";
import type { ExternalWidgetFormState } from "../state/external-widget-form";

export type HomeDashboardActionsDeps = {
  homeWidgets: HomeDashboardWidget[];
  setHomeWidgets: Dispatch<SetStateAction<HomeDashboardWidget[]>>;
  homeQuickLinks: HomeQuickLink[];
  setHomeQuickLinks: Dispatch<SetStateAction<HomeQuickLink[]>>;
  setShowQuickLinkEditor: Dispatch<SetStateAction<boolean>>;
  quickLinkDraft: HomeQuickLink[];
  setQuickLinkDraft: Dispatch<SetStateAction<HomeQuickLink[]>>;
  setQuickLinkError: Dispatch<SetStateAction<string>>;
  externalWidgetForm: ExternalWidgetFormState;
};

/** Called once per render with that render's values. */
export function createHomeDashboardActions(deps: HomeDashboardActionsDeps) {
  const {
    homeWidgets,
    setHomeWidgets,
    homeQuickLinks,
    setHomeQuickLinks,
    setShowQuickLinkEditor,
    quickLinkDraft,
    setQuickLinkDraft,
    setQuickLinkError,
    externalWidgetForm,
  } = deps;
  const {
    setShowExternalWidgetForm,
    externalWidgetTitle,
    setExternalWidgetTitle,
    externalWidgetUrl,
    setExternalWidgetUrl,
    externalWidgetSize,
    setExternalWidgetSize,
    setExternalWidgetError,
  } = externalWidgetForm;

  const toggleHomeWidget = (id: HomeWidgetId) => {
    setHomeWidgets((current) =>
      current.some((item) => item.id === id)
        ? current.filter((item) => item.id !== id)
        : [...current, { id, size: homeWidgetDefinition(id).defaultSize }],
    );
  };

  /** Presets are starting layouts; the user's external widgets are kept. */
  const applyHomePreset = (preset: HomePreset) => {
    setHomeWidgets((current) => [...homePresetLayout(preset), ...current.filter(isExternalHomeWidget)]);
  };

  const openQuickLinkEditor = () => {
    setQuickLinkDraft(homeQuickLinks.map((link) => ({ ...link })));
    setQuickLinkError("");
    setShowQuickLinkEditor(true);
  };

  const updateQuickLinkDraft = (id: string, field: "name" | "url" | "visible", value: string | boolean) => {
    setQuickLinkDraft((current) => current.map((link) => (link.id === id ? { ...link, [field]: value } : link)));
  };

  const removeQuickLinkDraft = (id: string) => {
    setQuickLinkDraft((current) => current.filter((link) => link.id !== id));
  };

  const restoreQuickLinkDefaults = () => {
    setQuickLinkDraft(HOME_QUICK_LINKS.map((link) => ({ ...link })));
    setQuickLinkError("");
  };

  const removeHomeWidget = (id: string) => {
    setHomeWidgets((current) => current.filter((item) => item.id !== id));
  };

  const resizeHomeWidget = (id: string, size: HomeWidgetSize) => {
    setHomeWidgets((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        return isExternalHomeWidget(item) ? { ...item, size } : { ...item, size: fitHomeWidgetSize(item.id, size) };
      }),
    );
  };

  const saveQuickLinkChanges = () => {
    const seen = new Set<string>();
    const cleaned: HomeQuickLink[] = [];
    for (const draft of quickLinkDraft.slice(0, MAX_HOME_QUICK_LINKS)) {
      const normalized = normalizeHomeQuickLink(
        draft,
        HOME_QUICK_LINKS.find((link) => link.id === draft.id),
      );
      if (!normalized || seen.has(normalized.id)) {
        setQuickLinkError(
          "Each shortcut needs a valid name and a public HTTPS URL without ports, credentials, or private addresses.",
        );
        return;
      }
      seen.add(normalized.id);
      cleaned.push(normalized);
    }
    setHomeQuickLinks(cleaned);
    setQuickLinkError("");
    setShowQuickLinkEditor(false);
  };

  const addExternalHomeWidget = () => {
    if (homeWidgets.filter(isExternalHomeWidget).length >= MAX_EXTERNAL_HOME_WIDGETS) {
      setExternalWidgetError(`You can add up to ${MAX_EXTERNAL_HOME_WIDGETS} external widgets.`);
      return;
    }
    const title = normalizeExternalHomeWidgetTitle(externalWidgetTitle);
    const url = normalizeExternalHomeWidgetUrl(externalWidgetUrl);
    if (!title) {
      setExternalWidgetError(`Enter a title of ${MAX_EXTERNAL_HOME_WIDGET_TITLE_LENGTH} characters or fewer.`);
      return;
    }
    if (!url) {
      setExternalWidgetError("Use a public HTTPS URL without a port, credentials, or local/private hostname.");
      return;
    }
    setHomeWidgets((current) => {
      if (current.filter(isExternalHomeWidget).length >= MAX_EXTERNAL_HOME_WIDGETS) return current;
      return [
        ...current,
        {
          kind: "external",
          id: `external-${crypto.randomUUID()}`,
          title,
          url,
          size: externalWidgetSize,
        },
      ];
    });
    setExternalWidgetTitle("");
    setExternalWidgetUrl("");
    setExternalWidgetSize("wide");
    setExternalWidgetError("");
    setShowExternalWidgetForm(false);
  };

  const moveHomeWidget = (id: string, toIndex: number) => {
    setHomeWidgets((current) => {
      const from = current.findIndex((item) => item.id === id);
      if (from < 0 || toIndex < 0 || toIndex >= current.length || from === toIndex) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  return {
    toggleHomeWidget,
    applyHomePreset,
    openQuickLinkEditor,
    updateQuickLinkDraft,
    removeQuickLinkDraft,
    restoreQuickLinkDefaults,
    saveQuickLinkChanges,
    addExternalHomeWidget,
    moveHomeWidget,
    removeHomeWidget,
    resizeHomeWidget,
  };
}

export type HomeDashboardActions = ReturnType<typeof createHomeDashboardActions>;
