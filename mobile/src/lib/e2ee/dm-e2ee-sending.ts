// Sending through DM encryption, the same on web, desktop and mobile: building
// encrypted (or plaintext) DM, reaction and group chat requests, resending once
// when a key or the member list changed underneath, and decrypting list
// previews. Each app creates one set for its session (createDmE2eeSending).
// The mobile app keeps an identical copy (checked by scripts/__tests__/dm-e2ee.test.mjs).

import { toggledReactions, type DmE2eeSession } from "./dm-e2ee-session.ts";
import type { DmEnvelope } from "./dm-e2ee-format.ts";
import { dmPreviewText } from "./dm-message-preview.ts";

/**
 * The uploads a message's text refers to. An encrypted message lists them next to
 * its envelope so the server keeps (and, on delete, removes) the files.
 */
export function attachmentKeysIn(text: string): string[] {
  return [...new Set(text.match(/attachments\/private\/[0-9a-f-]{36}/g) ?? [])];
}

type PendingSend = { targetId: string; text: string; replyToId: string | null; retried: boolean };
type GroupLike = { id: string; e2ee?: boolean; members: ReadonlyArray<{ id: string }> };
type PendingGroupSend = { group: GroupLike; text: string; replyToId: string | null; retried: boolean };

function remember<T>(map: Map<string, T>, key: string, value: T) {
  map.set(key, value);
  while (map.size > 50) map.delete(map.keys().next().value as string);
}

export function createDmE2eeSending(session: DmE2eeSession) {
  // Socket sends fail asynchronously (DM_ERROR / GROUP_ERROR), after the composer
  // has cleared. When the failure is only a stale key, the peer setting up
  // encryption a moment ago, or a member change, the message is sealed again
  // with fresh keys and resent once.
  const pendingSends = new Map<string, PendingSend>();
  const pendingGroupSends = new Map<string, PendingGroupSend>();

  /** Body for sending or editing a DM: an envelope (with its uploads) or plaintext. */
  async function dmSealedBody(
    targetId: string,
    text: string,
    options: { id?: string; refreshKeys?: boolean; replyToId?: string | null } = {},
  ): Promise<Record<string, unknown>> {
    const sealed = await session.seal(targetId, text, options);
    return "envelope" in sealed ? { ...sealed, attachmentKeys: attachmentKeysIn(text) } : sealed;
  }

  /** Build the DM_MESSAGE frame for `text`, encrypted whenever the peer can read encrypted messages. */
  async function dmSocketFrame(
    targetId: string,
    text: string,
    replyToId: string | null,
    retried = false,
  ): Promise<Record<string, unknown>> {
    const sealed = await dmSealedBody(targetId, text, { refreshKeys: retried, replyToId });
    const envelopeId = (sealed.envelope as { id?: string } | undefined)?.id;
    remember(pendingSends, envelopeId ?? `plain:${targetId}`, { targetId, text, replyToId, retried });
    // An encrypted message carries its reply link inside; the server never sees it.
    return { type: "DM_MESSAGE", targetUserId: targetId, replyToId: envelopeId ? null : replyToId, ...sealed };
  }

  /** The message arrived; nothing to retry. */
  function settleDmSend(messageId: string, targetId: string) {
    pendingSends.delete(messageId);
    pendingSends.delete(`plain:${targetId}`);
  }

  /**
   * After a DM_ERROR: a fresh frame to resend, or null when the error isn't one a
   * resend can fix (or it was already retried).
   */
  async function retryFrameAfterDmError(error: {
    code?: unknown;
    messageId?: unknown;
  }): Promise<Record<string, unknown> | null> {
    if (error.code !== "DM_E2EE_STALE_KEY" && error.code !== "DM_E2EE_REQUIRED") return null;
    let key = typeof error.messageId === "string" ? error.messageId : "";
    if (!key) key = [...pendingSends.keys()].reverse().find((candidate) => candidate.startsWith("plain:")) ?? "";
    const pending = pendingSends.get(key);
    pendingSends.delete(key);
    if (!pending || pending.retried) return null;
    return dmSocketFrame(pending.targetId, pending.text, pending.replyToId, true);
  }

  /**
   * Body for toggling `emoji` on a DM. On an encrypted message it is this
   * account's whole new set of reactions, sealed (null when none are left);
   * otherwise the plain emoji, as before.
   */
  async function dmReactionBody(
    message: { id: string; envelope?: unknown; reactions?: Record<string, string[]> },
    me: string,
    peerId: string,
    emoji: string,
    refreshKeys = false,
  ): Promise<Record<string, unknown>> {
    if (!message.envelope || !session.getState().available) return { emoji };
    const next = toggledReactions(message.reactions, me, emoji);
    if (!next.length) return { envelope: null };
    return { envelope: await session.sealReactions(peerId, message.id, next, { refreshKeys }) };
  }

  /** Build the GROUP_MESSAGE frame, encrypted for every member when the group is encrypted. */
  async function groupSocketFrame(
    group: GroupLike,
    text: string,
    replyToId: string | null,
    retried = false,
  ): Promise<Record<string, unknown>> {
    const sealed = await session.sealGroup(
      group.id,
      group.members.map((member) => member.id),
      text,
      { markedEncrypted: Boolean(group.e2ee), refreshKeys: retried, replyToId },
    );
    const key = "envelope" in sealed ? sealed.envelope.id : `plain:${group.id}`;
    remember(pendingGroupSends, key, { group, text, replyToId, retried });
    return { type: "GROUP_MESSAGE", groupId: group.id, replyToId: "envelope" in sealed ? null : replyToId, ...sealed };
  }

  function settleGroupSend(messageId: string, groupId: string) {
    pendingGroupSends.delete(messageId);
    pendingGroupSends.delete(`plain:${groupId}`);
  }

  /**
   * After a GROUP_ERROR: a fresh frame to resend once, sealed with fresh keys and
   * the latest member list, or null when a resend can't help. `latest` returns
   * the group as the app knows it now.
   */
  async function retryGroupFrameAfterError(
    error: { code?: unknown; messageId?: unknown; groupId?: unknown },
    latest: (groupId: string) => GroupLike | null,
  ): Promise<Record<string, unknown> | null> {
    if (error.code !== "DM_E2EE_STALE_KEY" && error.code !== "DM_E2EE_REQUIRED") return null;
    const groupId = typeof error.groupId === "string" ? error.groupId : "";
    const key = typeof error.messageId === "string" && error.messageId ? error.messageId : `plain:${groupId}`;
    const pending = pendingGroupSends.get(key);
    pendingGroupSends.delete(key);
    if (!pending || pending.retried) return null;
    const group = latest(pending.group.id) ?? pending.group;
    // Refused as plaintext: the group is encrypted now.
    return groupSocketFrame(
      error.code === "DM_E2EE_REQUIRED" ? { ...group, e2ee: true } : group,
      pending.text,
      pending.replyToId,
      true,
    );
  }

  /** A group's list preview, decrypted when it is encrypted. */
  async function groupPreview(group: { id: string; latestMessage: string; latestEnvelope?: unknown }): Promise<string> {
    const envelope = group.latestEnvelope as DmEnvelope | null | undefined;
    if (!envelope) return dmPreviewText(group.latestMessage);
    const opened = await session.openGroup(
      { id: envelope.id ?? "", fromUserId: envelope.from ?? "", text: "", envelope },
      group.id,
    );
    return opened.e2ee === "encrypted" ? dmPreviewText(opened.text) : "🔒 Encrypted message";
  }

  /** Decrypt the latest-message previews of a DM conversation list. */
  async function decryptConversationPreviews<
    T extends {
      user: { id: string };
      latestMessage: string;
      latestMessageId?: string;
      latestEnvelope?: DmEnvelope | null;
    },
  >(conversations: T[]): Promise<T[]> {
    const opened = await Promise.all(
      conversations.map((conversation) =>
        session.open(
          {
            id: conversation.latestMessageId ?? "",
            fromUserId: conversation.latestEnvelope?.from ?? "",
            toUserId: conversation.latestEnvelope?.to ?? "",
            text: conversation.latestMessage,
            envelope: conversation.latestEnvelope ?? null,
          },
          conversation.user.id,
        ),
      ),
    );
    return conversations.map((conversation, index) => ({
      ...conversation,
      latestMessage:
        !conversation.latestEnvelope || opened[index].e2ee === "encrypted"
          ? dmPreviewText(opened[index].text)
          : "🔒 Encrypted message",
    }));
  }

  return {
    dmSealedBody,
    dmSocketFrame,
    settleDmSend,
    retryFrameAfterDmError,
    dmReactionBody,
    groupSocketFrame,
    settleGroupSend,
    retryGroupFrameAfterError,
    groupPreview,
    decryptConversationPreviews,
  };
}
