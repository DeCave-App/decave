// Text the server writes for people to read (realtime errors, access notices,
// bot and Twitch announcements) travels as { code, params } next to the English.
// `code` is a full catalog key ("chat.server.roomReadOnly"); clients render it
// in the UI language and fall back to the English. Codes outside this list are
// ignored by clients, so a crafted message can't pull arbitrary catalog text.

export const SERVER_NOTICE_CODES = [
  // Realtime connection and Hub chat (worker/HubRoom.ts)
  "chat.server.authTimedOut",
  "chat.server.rateLimited",
  "chat.server.payloadTooLarge",
  "chat.server.invalidJson",
  "chat.server.unknownType",
  "chat.server.authTooManyAttempts",
  "chat.server.authUnavailable",
  "chat.server.sessionExpired",
  "chat.server.authenticateFirst",
  "chat.server.noHubAccess",
  "chat.server.roomNotFound",
  "chat.server.officialPolicyUnavailable",
  "chat.server.ownerOnlyPosting",
  "chat.server.roomReadOnly",
  "chat.server.timedOut",
  "chat.server.slowMode",
  "chat.server.attachmentNotOwned",
  "chat.server.replyTargetMissingInRoom",
  "chat.server.forumReplyTarget",
  "chat.server.forumReplyNotPost",
  "chat.server.forumPostLocked",
  "chat.server.forumPostsOnlyInForums",
  "chat.server.forumTopLevelPosts",
  "chat.server.forumTooManyTags",
  "chat.server.forumTagInvalid",
  "chat.server.forumRoleCannotPost",
  "chat.server.forumLockForbidden",
  "chat.server.attachmentUnavailable",
  // Private and group messages
  "chat.server.dmFriendsOnly",
  "chat.server.dmBlocked",
  "chat.server.replyTargetMissing",
  "chat.server.alreadySent",
  "chat.server.groupNotMember",
  // Voice rooms and access changes
  "chat.server.voiceRoomNotFound",
  "chat.server.voiceRoomFull",
  "chat.server.soundUnavailable",
  "chat.server.soundboardUnavailable",
  "chat.server.voiceRoomDeleted",
  "chat.server.voiceAccessRevoked",
  "chat.server.roomAccessRevoked",
  "chat.server.roomDeleted",
  "chat.server.leftHub",
  "chat.server.removedFromHub",
  "chat.server.kickedFromHub",
  "chat.server.bannedFromHub",
  "chat.server.leftSquadRoom",
  // Direct calls (DM_CALL_ERROR)
  "dm.call.server.blocked",
  "dm.call.server.leaveVoice",
  "dm.call.server.friendsOnly",
  "dm.call.server.peerBusy",
  "dm.call.server.peerOffline",
  "dm.call.server.recipientOnly",
  // Bot system notices
  "bots.server.commandUsage",
  // Bot run log and test steps (worker/bots): reasons shown in the bot builder
  "bots.run.server.publisherLeft",
  "bots.run.server.noChannel",
  "bots.run.server.hubChannelsOnly",
  "bots.run.server.channelGone",
  "bots.run.server.channelOtherHub",
  "bots.run.server.textChannelsOnly",
  "bots.run.server.channelNotAllowed",
  "bots.run.server.publisherNoAccess",
  "bots.run.server.publisherCantPost",
  "bots.run.server.roleGone",
  "bots.run.server.publisherCantManageRole",
  "bots.run.server.noMember",
  "bots.run.server.memberLeft",
  "bots.run.server.noMessage",
  "bots.run.server.messageGone",
  "bots.run.server.variableLimit",
  "bots.run.server.notANumber",
  "bots.run.server.waitNeedsChannel",
  "bots.run.server.rulesUnavailable",
  "bots.run.server.pollIncomplete",
  "bots.run.server.messageLimit",
  "bots.run.server.publisherCantCreateEvents",
  "bots.run.server.eventTitleEmpty",
  "bots.run.server.eventTimesInvalid",
  "bots.run.server.tooManyEvents",
  "bots.run.server.formsNeedInteraction",
  "bots.run.server.postFailed",
  "bots.run.server.forumReplyTarget",
  "bots.run.server.postLocked",
  "bots.run.server.memberNoAccess",
  "bots.run.server.editOwnOnly",
  "bots.run.server.cantEdit",
  "bots.run.server.publisherCantModerate",
  "bots.run.server.publisherCantDelete",
  "bots.run.server.cantDeleteKind",
  "bots.run.server.emojiRequired",
  "bots.run.server.emojiReserved",
  "bots.run.server.threadsNeedForum",
  "bots.run.server.publisherCantPostForum",
  "bots.run.server.threadNameEmpty",
  "bots.run.server.timedRoleNeedsChannel",
  "bots.run.server.webhookLimit",
  "bots.run.server.webhookUrlInvalid",
  "bots.run.server.webhookHttpsOnly",
  "bots.run.server.webhookNoLogin",
  "bots.run.server.webhookNoPort",
  "bots.run.server.webhookHostRefused",
  "bots.run.server.webhookRedirect",
  "bots.run.server.webhookTooLarge",
  "bots.run.server.webhookTimedOut",
  "bots.run.server.webhookFailed",
  "bots.run.server.unknownAction",
  "bots.run.server.capabilityMissing",
  "bots.run.server.actionFailed",
  "bots.run.server.ranActions",
  "bots.run.server.ranNothing",
  "bots.run.server.patternNotAllowed",
  "bots.run.server.chainTooDeep",
  "bots.run.server.coolingDown",
  "bots.run.server.runLimit",
  "bots.run.server.conditionsNotMet",
  "bots.run.server.ruleUnavailable",
  "bots.run.server.ruleFailed",
  "bots.run.server.runFailed",
  "bots.run.server.commandMissingOption",
  "bots.run.server.commandInvalidOption",
  "bots.run.server.timerDropped",
  "bots.run.server.wouldCall",
  "bots.run.server.wouldWait",
  "bots.run.server.roleStep",
  // Streamer Hubs and Twitch
  "streamer.server.autoLiveNeedsLink",
  "streamer.server.autoLiveUnavailable",
  "streamer.server.autoLiveNoChannel",
  "streamer.server.autoLiveUnreachable",
  "streamer.server.clipPosted",
  "streamer.server.clipPostedAnonymous",
  "streamer.server.clipOfTheWeek",
  "streamer.server.clipPostedUntitled",
  "streamer.server.clipPostedUntitledAnonymous",
  "streamer.server.clipOfTheWeekUntitled",
  // Clip posts in forum rooms (title and body notices on the forum payload)
  "streamer.server.clipDefaultTitle",
  "streamer.server.clipForumBody",
  "streamer.server.clipForumBodyAnonymous",
  // Success messages on account and admin responses
  "auth.server.resetLinkSent",
  "auth.server.localAccountCreated",
  "auth.server.accountCreated",
  "auth.server.verificationEmailSent",
  "auth.server.passwordChanged",
  "admin.server.passwordResetForced",
  "admin.server.importAlreadyRolledBack",
  "admin.server.importRolledBack",
  "admin.server.importRolledBackPartly",
  "admin.server.accountErased",
] as const;

export type ServerNoticeCode = (typeof SERVER_NOTICE_CODES)[number];

export type ServerNoticeParams = Record<string, string | number>;

/** A server notice as sent on the wire. */
export type ServerNotice = { code: ServerNoticeCode; params?: ServerNoticeParams };

const KNOWN = new Set<string>(SERVER_NOTICE_CODES);

/** The notice in a frame or payload when it is well formed and known, else null. */
export function readServerNotice(value: unknown): ServerNotice | null {
  if (!value || typeof value !== "object") return null;
  const { code, params } = value as { code?: unknown; params?: unknown };
  if (typeof code !== "string" || !KNOWN.has(code)) return null;
  if (params === undefined) return { code: code as ServerNoticeCode };
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const clean: ServerNoticeParams = {};
  for (const [key, item] of Object.entries(params)) {
    if (typeof item === "string" || (typeof item === "number" && Number.isFinite(item))) clean[key] = item;
  }
  return { code: code as ServerNoticeCode, params: clean };
}
