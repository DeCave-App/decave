/** Shared decision cards bridge to the existing poll/event message actions. */

export type ExistingPollPayload = {
  question: string;
  options: string[];
};

export type ExistingEventPayload = {
  title: string;
  startAt: string;
  description: string;
  inviteMode: "all" | "selected";
  invitedUserIds: string[];
  invitedUsernames: string[];
};

export type DecisionCardKind = "poll" | "availability" | "choose-game";

export type SharedDecisionCard = {
  id: string;
  kind: DecisionCardKind;
  question: string;
  options: string[];
  deadlineAt: string | null;
  sourceMessageId: string;
  eventId: string | null;
  counts: number[];
  selectedOptionIndex: number | null;
  pinned: boolean;
};

export type DecisionCardMetadata = {
  cardId: string;
  kind: DecisionCardKind;
  deadlineAt: string | null;
  eventId: string | null;
};

export function normalizeDecisionCardMetadata(value: unknown): DecisionCardMetadata | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const cardId = text(raw.cardId, 160);
  const kind: DecisionCardKind =
    raw.kind === "availability" || raw.kind === "choose-game" ? raw.kind : raw.kind === "poll" ? "poll" : "poll";
  if (!cardId) return null;
  return {
    cardId,
    kind,
    deadlineAt: validDeadline(typeof raw.deadlineAt === "string" ? raw.deadlineAt : null),
    eventId: text(raw.eventId, 160) || null,
  };
}

export type DecisionCardTransport = {
  /** Posts through the existing poll composer/message API. */
  createPoll: (
    payload: ExistingPollPayload,
    metadata: DecisionCardMetadata,
  ) => Promise<{ sourceMessageId: string }> | { sourceMessageId: string };
  /** Posts through the existing event composer/message API when the card is linked to an event. */
  createEvent?: (
    payload: ExistingEventPayload,
    metadata: DecisionCardMetadata,
  ) => Promise<{ eventId: string }> | { eventId: string };
  /** Votes via the existing reaction/message action. */
  vote: (sourceMessageId: string, optionIndex: number) => Promise<void> | void;
  /** Pinning is an existing hub/DM card action owned by the caller. */
  setPinned?: (card: SharedDecisionCard, pinned: boolean) => Promise<void> | void;
  openEvent?: (eventId: string) => void;
};

const MAX_QUESTION_LENGTH = 180;
const MAX_OPTION_LENGTH = 100;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validDeadline(value: string | null): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export function createDecisionCardId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return `decision-${globalThis.crypto.randomUUID()}`;
  } catch {
    // Use a local fallback where Web Crypto is unavailable.
  }
  return `decision-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeDecisionCard(value: unknown): SharedDecisionCard | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, 160);
  const sourceMessageId = text(raw.sourceMessageId, 160);
  const question = text(raw.question, MAX_QUESTION_LENGTH);
  const kind: DecisionCardKind = raw.kind === "availability" || raw.kind === "choose-game" ? raw.kind : "poll";
  const options = Array.isArray(raw.options)
    ? [
        ...new Set(
          raw.options
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim().slice(0, MAX_OPTION_LENGTH))
            .filter(Boolean),
        ),
      ].slice(0, 8)
    : [];
  if (!id || !sourceMessageId || !question || options.length < 2) return null;
  const rawCounts = Array.isArray(raw.counts) ? raw.counts : [];
  const counts = options.map((_option, index) => {
    const count = rawCounts[index];
    return typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  });
  const selectedOptionIndex =
    typeof raw.selectedOptionIndex === "number" &&
    Number.isInteger(raw.selectedOptionIndex) &&
    raw.selectedOptionIndex >= 0 &&
    raw.selectedOptionIndex < options.length
      ? raw.selectedOptionIndex
      : null;
  return {
    id,
    kind,
    question,
    options,
    deadlineAt: validDeadline(typeof raw.deadlineAt === "string" ? raw.deadlineAt : null),
    sourceMessageId,
    eventId: text(raw.eventId, 160) || null,
    counts,
    selectedOptionIndex,
    pinned: raw.pinned === true,
  };
}

export function createDecisionCard(
  input: Omit<SharedDecisionCard, "id" | "counts" | "selectedOptionIndex" | "pinned"> &
    Partial<Pick<SharedDecisionCard, "id" | "counts" | "selectedOptionIndex" | "pinned">>,
): SharedDecisionCard | null {
  return normalizeDecisionCard({
    ...input,
    id: input.id ?? createDecisionCardId(),
    counts: input.counts ?? [],
    selectedOptionIndex: input.selectedOptionIndex ?? null,
    pinned: input.pinned ?? false,
  });
}

export function toExistingPollPayload(card: Pick<SharedDecisionCard, "question" | "options">): ExistingPollPayload {
  return {
    question: text(card.question, MAX_QUESTION_LENGTH),
    options: card.options
      .map((option) => text(option, MAX_OPTION_LENGTH))
      .filter(Boolean)
      .slice(0, 8),
  };
}

export function toExistingEventPayload(
  card: Pick<SharedDecisionCard, "question" | "deadlineAt">,
): ExistingEventPayload | null {
  if (!card.deadlineAt) return null;
  return {
    title: text(card.question, MAX_QUESTION_LENGTH),
    startAt: card.deadlineAt,
    description: "Decision card deadline",
    // A linked decision event has no implicit audience. The existing event
    // composer may add explicitly selected members after permission checks.
    inviteMode: "selected",
    invitedUserIds: [],
    invitedUsernames: [],
  };
}

export function decisionCardTotalVotes(card: Pick<SharedDecisionCard, "counts">): number {
  return card.counts.reduce((total, count) => total + Math.max(0, count), 0);
}

export function decisionCardIsClosed(card: Pick<SharedDecisionCard, "deadlineAt">, now = Date.now()): boolean {
  return card.deadlineAt !== null && Date.parse(card.deadlineAt) <= now;
}
