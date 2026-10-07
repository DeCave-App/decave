// The API routes in the order handleApi tries them. Each handler returns a
// response when the request is one of its routes, otherwise null.

import type { ApiRouteHandler } from "./context";
import { handleGiphyRoutes, handleSteamRoutes } from "./integrations";
import { handleDmPreferenceRoutes, handleFriendRoutes } from "./social";
import { handleHealthRoutes, handleRtcRoutes } from "./system";
import { handleSignInRoutes, handleSessionRoutes, handlePasswordRoutes } from "./auth";
import { handleAccountSecurityRoutes, handleAccountSettingsRoutes } from "./account";
import { handleOwnerSecurityRoutes } from "./admin/owner-security";
import { handleAdminDashboardRoutes } from "./admin/dashboard";
import { handleAdminAccountRoutes } from "./admin/accounts";
import { handlePlatformAdminRoutes } from "./admin/platform";
import { handleActivityStatusRoutes, handleProfileRoutes } from "./profile";
import { handleSoundboardRoutes } from "./soundboard";
import { handleSquadFinderRoutes } from "./squad";
import { handleGroupChatRoutes } from "./group-chats";
import { handleDirectMessageRoutes } from "./direct-messages";
import { handleDmKeyRoutes } from "./dm-keys";
import { handleFeedbackRoutes } from "./feedback";
import { handleHubListRoutes, handleHubRoutes } from "./hubs";
import { handleHubImportRoutes } from "./hub-import";
import { handleRoomRoutes } from "./rooms";
import { handleEventAndForumRoutes } from "./events-forum";
import { handleHubAssetRoutes } from "./hub-assets";
import { handleHubBotRoutes } from "./hub-bots";
import { handleMediaRoutes } from "./media";

export const API_ROUTES: ApiRouteHandler[] = [
  handleGiphyRoutes,
  handleDmPreferenceRoutes,
  handleHealthRoutes,
  handleSignInRoutes,
  handleAccountSecurityRoutes,
  handleSessionRoutes,
  handleAccountSettingsRoutes,
  handleOwnerSecurityRoutes,
  handleAdminDashboardRoutes,
  handleAdminAccountRoutes,
  handlePlatformAdminRoutes,
  handlePasswordRoutes,
  handleRtcRoutes,
  handleActivityStatusRoutes,
  handleSteamRoutes,
  handleProfileRoutes,
  handleSoundboardRoutes,
  handleFriendRoutes,
  handleSquadFinderRoutes,
  handleGroupChatRoutes,
  handleDmKeyRoutes,
  handleDirectMessageRoutes,
  handleFeedbackRoutes,
  handleHubListRoutes,
  handleHubImportRoutes,
  handleHubRoutes,
  handleRoomRoutes,
  handleEventAndForumRoutes,
  handleHubAssetRoutes,
  handleHubBotRoutes,
  handleMediaRoutes,
];
