// Which Hub panels are open: Hub home, Streamer overview, members, calendar,
// insights, message search and pinned messages.

import { useState } from "react";

export function useHubPanelsState() {
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [showPinnedMessages, setShowPinnedMessages] = useState(false);
  const [showHubInsights, setShowHubInsights] = useState(false);
  const [showHubMembersPanel, setShowHubMembersPanel] = useState(false);
  const [showHubHome, setShowHubHome] = useState(false);
  const [showStreamerOverview, setShowStreamerOverview] = useState(false);
  const [showHubCalendarPanel, setShowHubCalendarPanel] = useState(false);

  return {
    showMessageSearch,
    setShowMessageSearch,
    showPinnedMessages,
    setShowPinnedMessages,
    showHubInsights,
    setShowHubInsights,
    showHubMembersPanel,
    setShowHubMembersPanel,
    showHubHome,
    setShowHubHome,
    showStreamerOverview,
    setShowStreamerOverview,
    showHubCalendarPanel,
    setShowHubCalendarPanel,
  };
}

export type HubPanelsState = ReturnType<typeof useHubPanelsState>;
