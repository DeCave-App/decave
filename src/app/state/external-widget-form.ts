// The Home page form for adding an external widget.

import { useState } from "react";
import type { HomeWidgetSize } from "../../features/home";

export function useExternalWidgetFormState() {
  const [showExternalWidgetForm, setShowExternalWidgetForm] = useState(false);
  const [externalWidgetTitle, setExternalWidgetTitle] = useState("");
  const [externalWidgetUrl, setExternalWidgetUrl] = useState("");
  const [externalWidgetSize, setExternalWidgetSize] = useState<HomeWidgetSize>("wide");
  const [externalWidgetError, setExternalWidgetError] = useState("");

  return {
    showExternalWidgetForm,
    setShowExternalWidgetForm,
    externalWidgetTitle,
    setExternalWidgetTitle,
    externalWidgetUrl,
    setExternalWidgetUrl,
    externalWidgetSize,
    setExternalWidgetSize,
    externalWidgetError,
    setExternalWidgetError,
  };
}

export type ExternalWidgetFormState = ReturnType<typeof useExternalWidgetFormState>;
