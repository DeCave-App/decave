import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useDialogA11y } from "../shared/useDialogA11y";
import {
  FORUM_LFG_LIMITS,
  FORUM_MEDIA_URL_MAX,
  FORUM_POLL_LIMITS,
  FORUM_POST_TYPES,
  FORUM_TAG_LIMITS,
  type ForumPostType,
} from "../../../shared/forum";
import { TagChip } from "./ForumView";
import { LfgBlock, MediaBlock, PollBlock, TypeBadge } from "./ForumPostExtras";
import { renderForumMarkdown } from "./forumRichText";
import {
  FORUM_BODY_MAX,
  FORUM_TITLE_MAX,
  FORUM_TYPE_META,
  encodeForumPost,
  loadForumDraft,
  saveForumDraft,
  forumDraftSessionVersion,
  uploadForumFile,
  type ForumAttachment,
  type ForumFetch,
  type ForumPostPayload,
} from "./forumModel";
import "../shared/shared.css";
import "./forum.css";
import { Icon } from "../../components/Icon";

export type ForumComposeModalProps = {
  className?: string;
  apiBase: string;
  fetcher: ForumFetch;
  roomId: number;
  roomName: string;
  guidelines?: string;
  /** Moderator-defined tag list; empty means free-text tags. */
  roomTags: string[];
  /** Null when the viewer may post, otherwise why not. */
  restriction: string | null;
  /** Forum staff may create a post with replies turned off. */
  canLockReplies?: boolean;
  /** Used to show the viewer's own vote state in the preview. */
  viewerId?: string;
  resolveIconUrl(url: string | undefined): string | null;
  publish(text: string, attachment: ForumAttachment | null): Promise<boolean>;
  onPublished(): void;
  onClose(): void;
};

const MAX_TAGS = FORUM_TAG_LIMITS.maxTagsPerPost;
const POLL_DURATIONS = [
  { id: "none", ms: 0 },
  { id: "h1", ms: 3_600_000 },
  { id: "d1", ms: 86_400_000 },
  { id: "d3", ms: 3 * 86_400_000 },
  { id: "w1", ms: 7 * 86_400_000 },
  { id: "d30", ms: FORUM_POLL_LIMITS.maxDurationMs },
] as const;
/** A URL shape, the same in every language. */
const LINK_URL_EXAMPLE = "https://";
/** Toolbar letters for bold, italic, strikethrough and heading (the same in every language, like the markdown). */
const GLYPHS = { bold: "B", italic: "I", strike: "S", heading: "H" };
const PLATFORMS = ["PC", "PlayStation", "Xbox", "Switch", "Mobile", "Cross-play"];
const EMOJIS = [
  "😀",
  "😂",
  "😅",
  "😍",
  "😎",
  "🤔",
  "😭",
  "😡",
  "👍",
  "👎",
  "👏",
  "🙏",
  "🔥",
  "💯",
  "🎉",
  "❤️",
  "💀",
  "👀",
  "✅",
  "❌",
  "⚠️",
  "🎮",
  "🕹️",
  "🏆",
  "⚔️",
  "🛡️",
  "🎯",
  "🚀",
  "💡",
  "📌",
  "🐛",
  "⭐",
];

type Draft = {
  type: ForumPostType;
  title: string;
  body: string;
  tags: string[];
  iconUrl: string;
  attachment: ForumAttachment | null;
  pollOptions: string[];
  pollMulti: boolean;
  pollDurationMs: number;
  lfgGame: string;
  lfgPlatform: string;
  lfgSlots: number;
  lfgStart: string;
  mediaUrl: string;
  mediaMime: string;
  repliesLocked: boolean;
};

const EMPTY: Draft = {
  type: "discussion",
  title: "",
  body: "",
  tags: [],
  iconUrl: "",
  attachment: null,
  pollOptions: ["", ""],
  pollMulti: false,
  pollDurationMs: 86_400_000,
  lfgGame: "",
  lfgPlatform: "",
  lfgSlots: 1,
  lfgStart: "",
  mediaUrl: "",
  mediaMime: "",
  repliesLocked: false,
};

const isDraftEmpty = (draft: Draft) =>
  !draft.title.trim() &&
  !draft.body.trim() &&
  !draft.tags.length &&
  !draft.iconUrl &&
  !draft.attachment &&
  draft.pollOptions.every((option) => !option.trim()) &&
  !draft.lfgGame.trim() &&
  !draft.mediaUrl;

function restoreDraft(raw: unknown): Draft | null {
  if (!raw || typeof raw !== "object") return null;
  const merged = { ...EMPTY, ...(raw as Partial<Draft>) };
  if (!(FORUM_POST_TYPES as readonly string[]).includes(merged.type)) merged.type = "discussion";
  if (!Array.isArray(merged.tags)) merged.tags = [];
  if (!Array.isArray(merged.pollOptions) || merged.pollOptions.length < 2) merged.pollOptions = ["", ""];
  merged.pollOptions = merged.pollOptions.filter((x) => typeof x === "string").slice(0, FORUM_POLL_LIMITS.maxOptions);
  return isDraftEmpty(merged) ? null : merged;
}

const isImage = (file: File) => /^image\/(png|jpeg|webp|gif)$/.test(file.type);

export function ForumComposeModal(props: ForumComposeModalProps) {
  const { t } = useTranslation(["forum"]);
  const dialogRef = useDialogA11y<HTMLDivElement>(props.onClose);
  const titleId = useId();
  const fieldId = useId();
  const initial = useMemo(
    () => restoreDraft(loadForumDraft<unknown>(props.viewerId ?? "", props.roomId)),
    [props.viewerId, props.roomId],
  );
  const forumDraftVersion = useMemo(() => forumDraftSessionVersion(props.viewerId ?? ""), [props.viewerId]);
  const [draft, setDraft] = useState<Draft>(initial ?? EMPTY);
  const [restored, setRestored] = useState(Boolean(initial));
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [uploading, setUploading] = useState<"" | "icon" | "file" | "image" | "media">("");
  const [error, setError] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const iconInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const touch = (field: string) => setTouched((current) => (current[field] ? current : { ...current, [field]: true }));
  const show = (field: string) => submitted || Boolean(touched[field]);

  // Autosave (debounced) per room.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (isDraftEmpty(draft)) saveForumDraft(props.viewerId ?? "", props.roomId, null, forumDraftVersion);
      else {
        saveForumDraft(props.viewerId ?? "", props.roomId, draft, forumDraftVersion);
        setSavedAt(Date.now());
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [draft, props.roomId, forumDraftVersion]);

  const { type } = draft;
  const meta = FORUM_TYPE_META[type];
  const bodyOptional = type === "poll" || type === "lfg" || type === "media";
  const cleanPollOptions = draft.pollOptions.map((option) => option.trim()).filter(Boolean);

  const errors = {
    title: !draft.title.trim() ? t("forum.compose.errors.title") : "",
    body: !bodyOptional && !draft.body.trim() ? t("forum.compose.errors.body") : "",
    poll:
      type !== "poll"
        ? ""
        : cleanPollOptions.length < FORUM_POLL_LIMITS.minOptions
          ? t("forum.compose.errors.pollOptions")
          : new Set(cleanPollOptions.map((option) => option.toLowerCase())).size !== cleanPollOptions.length
            ? t("forum.compose.errors.pollDuplicate")
            : "",
    lfgGame: type === "lfg" && !draft.lfgGame.trim() ? t("forum.compose.errors.lfgGame") : "",
    lfgStart:
      type === "lfg" && draft.lfgStart && !(new Date(draft.lfgStart).getTime() > 0)
        ? t("forum.compose.errors.lfgStart")
        : "",
    media:
      type !== "media"
        ? ""
        : !draft.mediaUrl && !draft.attachment
          ? t("forum.compose.errors.media")
          : draft.mediaUrl && !draft.mediaUrl.startsWith("/uploads/") && !/^https:\/\/\S+$/.test(draft.mediaUrl)
            ? t("forum.compose.errors.mediaHttps")
            : "",
  };
  const errorList = Object.values(errors).filter(Boolean);
  const valid = errorList.length === 0;

  // ---------- tags ----------
  const toggleTag = (tag: string) => {
    setDraft((current) => {
      const has = current.tags.some((item) => item.toLowerCase() === tag.toLowerCase());
      if (has) return { ...current, tags: current.tags.filter((item) => item.toLowerCase() !== tag.toLowerCase()) };
      return current.tags.length >= MAX_TAGS ? current : { ...current, tags: [...current.tags, tag] };
    });
  };
  const commitTagDraft = () => {
    const tag = tagDraft.replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, FORUM_TAG_LIMITS.maxTagLength);
    if (!tag) return;
    if (draft.tags.length >= MAX_TAGS) {
      setError(t("forum.compose.errors.tags", { count: MAX_TAGS }));
      return;
    }
    if (!draft.tags.some((item) => item.toLowerCase() === tag.toLowerCase())) set("tags", [...draft.tags, tag]);
    setTagDraft("");
  };
  const onTagKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitTagDraft();
    } else if (event.key === "Backspace" && !tagDraft && draft.tags.length) set("tags", draft.tags.slice(0, -1));
  };

  // ---------- editor ----------
  const rememberSelection = () => {
    const textarea = bodyRef.current;
    if (textarea) selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
  };
  const currentSelection = () => {
    const textarea = bodyRef.current;
    if (textarea && document.activeElement === textarea)
      return { start: textarea.selectionStart, end: textarea.selectionEnd };
    return selectionRef.current ?? { start: draft.body.length, end: draft.body.length };
  };
  const applyEdit = (next: string, selStart: number, selEnd: number) => {
    const clipped = next.slice(0, FORUM_BODY_MAX);
    set("body", clipped);
    setTab("write");
    window.setTimeout(() => {
      const textarea = bodyRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(Math.min(selStart, clipped.length), Math.min(selEnd, clipped.length));
    }, 0);
  };
  const wrapSelection = (before: string, after: string, placeholder: string) => {
    const { start, end } = currentSelection();
    const body = draft.body;
    const selected = body.slice(start, end) || placeholder;
    applyEdit(
      `${body.slice(0, start)}${before}${selected}${after}${body.slice(end)}`,
      start + before.length,
      start + before.length + selected.length,
    );
  };
  const prefixLines = (prefix: (index: number) => string, placeholder: string) => {
    const { start, end } = currentSelection();
    const body = draft.body;
    const lineStart = body.lastIndexOf("\n", start - 1) + 1;
    const segment = body.slice(lineStart, end) || placeholder;
    const replaced = segment
      .split("\n")
      .map((line, index) => `${prefix(index)}${line}`)
      .join("\n");
    applyEdit(
      `${body.slice(0, lineStart)}${replaced}${body.slice(Math.max(end, lineStart))}`,
      lineStart,
      lineStart + replaced.length,
    );
  };
  const insertText = (text: string) => {
    const { start, end } = currentSelection();
    const body = draft.body;
    applyEdit(`${body.slice(0, start)}${text}${body.slice(end)}`, start + text.length, start + text.length);
  };
  const insertCodeBlock = () => {
    const { start, end } = currentSelection();
    const selected = draft.body.slice(start, end);
    if (selected.includes("\n") || !selected) {
      const lead = start > 0 && draft.body[start - 1] !== "\n" ? "\n" : "";
      wrapSelection(`${lead}\`\`\`\n`, "\n```\n", t("forum.compose.placeholder.code"));
    } else wrapSelection("`", "`", t("forum.compose.placeholder.code"));
  };
  const confirmLink = () => {
    let url: URL;
    try {
      url = new URL(linkUrl.trim());
    } catch {
      setError(t("forum.compose.errors.link"));
      return;
    }
    if (url.protocol !== "https:") {
      setError(t("forum.compose.errors.linkHttps"));
      return;
    }
    setError("");
    setLinkOpen(false);
    setLinkUrl("");
    wrapSelection("[", `](${url.toString()})`, t("forum.compose.placeholder.link"));
  };
  const onEditorKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === "b") {
      event.preventDefault();
      wrapSelection("**", "**", t("forum.compose.placeholder.bold"));
    } else if (key === "i") {
      event.preventDefault();
      wrapSelection("*", "*", t("forum.compose.placeholder.italic"));
    } else if (key === "k") {
      event.preventDefault();
      rememberSelection();
      setLinkOpen(true);
    } else if (key === "enter") {
      event.preventDefault();
      void publish();
    }
  };

  // ---------- uploads ----------
  const upload = async (file: File, kind: "icon" | "file" | "image" | "media") => {
    if ((kind === "icon" || kind === "image") && !isImage(file)) {
      setError(t("forum.compose.errors.imageType"));
      return;
    }
    setUploading(kind);
    setError("");
    try {
      const result = await uploadForumFile(props.fetcher, props.apiBase, props.roomId, file);
      if (kind === "icon") {
        if (!props.resolveIconUrl(result.url)) throw new Error(t("forum.compose.errors.cover"));
        set("iconUrl", result.url);
      } else if (kind === "image") {
        if (!props.resolveIconUrl(result.url)) throw new Error(t("forum.compose.errors.inline"));
        insertText(
          `![${file.name.replace(/[[\]()]/g, "").slice(0, 40) || t("forum.compose.placeholder.image")}](${result.url})`,
        );
      } else if (kind === "media") {
        setDraft((current) => ({
          ...current,
          mediaUrl: result.url,
          mediaMime: (result.mimeType || file.type || "").slice(0, 100),
        }));
      } else set("attachment", result);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t("forum.compose.errors.upload"));
    } finally {
      setUploading("");
    }
  };
  const handleFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    const image = list.find(isImage);
    const other = list.find((file) => !isImage(file));
    if (image) {
      rememberSelection();
      void upload(image, "image");
    } else if (other) void upload(other, type === "media" && /^(video|image)\//.test(other.type) ? "media" : "file");
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.some(isImage)) {
      event.preventDefault();
      handleFiles(files);
    }
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length && !uploading) handleFiles(event.dataTransfer.files);
  };

  // ---------- publish ----------
  const buildPayload = (now: number): Omit<ForumPostPayload, "version"> => {
    const extraTag =
      tagDraft.trim() && !props.roomTags.length ? tagDraft.trim().slice(0, FORUM_TAG_LIMITS.maxTagLength) : "";
    const tags =
      extraTag && !draft.tags.some((tag) => tag.toLowerCase() === extraTag.toLowerCase())
        ? [...draft.tags, extraTag].slice(0, MAX_TAGS)
        : draft.tags;
    const payload: Omit<ForumPostPayload, "version"> = {
      title: draft.title.trim().slice(0, FORUM_TITLE_MAX),
      tags,
      body: draft.body.trim().slice(0, FORUM_BODY_MAX),
      ...(draft.iconUrl ? { iconUrl: draft.iconUrl } : {}),
      type,
    };
    if (type === "poll")
      payload.poll = {
        options: cleanPollOptions.map((option) => option.slice(0, FORUM_POLL_LIMITS.maxOptionLength)),
        multi: draft.pollMulti,
        endsAt: draft.pollDurationMs ? now + draft.pollDurationMs : null,
      };
    if (type === "lfg") {
      const startAt = draft.lfgStart ? new Date(draft.lfgStart).getTime() : NaN;
      payload.lfg = {
        game: draft.lfgGame.trim().slice(0, FORUM_LFG_LIMITS.maxGameLength),
        platform: draft.lfgPlatform.trim().slice(0, FORUM_LFG_LIMITS.maxPlatformLength),
        slots: draft.lfgSlots,
        startAt: Number.isFinite(startAt) && startAt > 0 ? startAt : null,
      };
    }
    if (type === "media" && draft.mediaUrl)
      payload.media = {
        url: draft.mediaUrl.trim().slice(0, FORUM_MEDIA_URL_MAX),
        ...(draft.mediaMime ? { mime: draft.mediaMime } : {}),
      };
    if (props.canLockReplies && draft.repliesLocked) payload.repliesLocked = true;
    return payload;
  };

  const publish = async () => {
    setSubmitted(true);
    if (!valid || publishing || uploading || props.restriction) return;
    setPublishing(true);
    setError("");
    try {
      const text = encodeForumPost(buildPayload(Date.now()));
      if (!(await props.publish(text, draft.attachment))) throw new Error(t("forum.view.reconnecting"));
      saveForumDraft(props.viewerId ?? "", props.roomId, null, forumDraftVersion);
      props.onPublished();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : t("forum.compose.errors.publish"));
    } finally {
      setPublishing(false);
    }
  };

  const discardDraft = () => {
    saveForumDraft(props.viewerId ?? "", props.roomId, null, forumDraftVersion);
    setDraft(EMPTY);
    setTagDraft("");
    setRestored(false);
    setTouched({});
    setSubmitted(false);
    setSavedAt(null);
  };

  const iconPreview = props.resolveIconUrl(draft.iconUrl || undefined);
  const previewPayload = buildPayload(Date.now());
  const resolveImage = (url: string) => props.resolveIconUrl(url);
  const fieldError = (field: keyof typeof errors, id: string) =>
    show(field) && errors[field] ? (
      <small id={id} className="fx-error">
        {errors[field]}
      </small>
    ) : null;

  const previewCard = (
    <article className="fx-compose-preview" aria-label={t("forum.compose.postPreview")}>
      <div className="fx-compose-preview-head">
        {iconPreview ? (
          <img src={iconPreview} alt="" />
        ) : (
          <span className="fx-compose-preview-icon" aria-hidden="true">
            {meta.icon}
          </span>
        )}
        <div>
          <TypeBadge type={type} />
          <h3>{previewPayload.title || <span className="fx-muted">{t("forum.compose.titlePreview")}</span>}</h3>
        </div>
      </div>
      {previewPayload.tags.length > 0 && (
        <div className="fx-post-tags">
          {previewPayload.tags.map((tag) => (
            <TagChip key={tag} tag={tag} />
          ))}
        </div>
      )}
      {previewPayload.poll && <PollBlock poll={previewPayload.poll} viewerId={props.viewerId ?? ""} />}
      {previewPayload.lfg && previewPayload.lfg.game && <LfgBlock lfg={previewPayload.lfg} />}
      {previewPayload.media && <MediaBlock media={previewPayload.media} resolveUrl={resolveImage} />}
      {previewPayload.body ? (
        <div className="fx-thread-body">{renderForumMarkdown(previewPayload.body, resolveImage)}</div>
      ) : (
        !bodyOptional && <p className="fx-muted">{t("forum.compose.nothing")}</p>
      )}
      {draft.attachment && <p className="fx-muted">📎 {draft.attachment.name}</p>}
    </article>
  );

  return (
    <div
      className={`dcx-modal-overlay fx-compose-overlay ${props.className ?? ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="fx-compose fx-compose-rich"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-dc-dialog="open"
        tabIndex={-1}
      >
        <header className="fx-compose-head">
          <div>
            <span className="fx-kicker">{t("forum.compose.kicker", { room: props.roomName })}</span>
            <h2 id={titleId}>{t("forum.compose.title")}</h2>
          </div>
          <div className="fx-compose-head-side">
            {restored ? (
              <span className="fx-draft-note" role="status">
                {t("forum.compose.restored")}{" "}
                <button type="button" className="fx-link-btn" onClick={discardDraft}>
                  {t("forum.compose.discard")}
                </button>
              </span>
            ) : savedAt ? (
              <span className="fx-draft-note muted" role="status">
                {t("forum.compose.saved")}
              </span>
            ) : null}
            <button
              type="button"
              className="dcx-btn dcx-btn-ghost fx-close"
              aria-label={t("forum.compose.close")}
              onClick={props.onClose}
            >
              <Icon name="close" size="sm" />
            </button>
          </div>
        </header>

        {props.restriction ? (
          <div className="fx-compose-body">
            <p className="fx-restriction block" role="note">
              <span aria-hidden="true">🔒</span>
              {props.restriction}
            </p>
            <footer className="fx-compose-foot">
              <button type="button" className="dcx-btn" onClick={props.onClose}>
                {t("forum.compose.close")}
              </button>
            </footer>
          </div>
        ) : (
          <form
            className="fx-compose-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void publish();
            }}
          >
            <div className="fx-type-picker" role="radiogroup" aria-label={t("forum.compose.type")}>
              {FORUM_POST_TYPES.map((value) => {
                const item = FORUM_TYPE_META[value];
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={type === value}
                    className={`fx-type-option t-${value}${type === value ? " active" : ""}`}
                    onClick={() => set("type", value)}
                    title={item.hint}
                  >
                    <span className="fx-type-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="fx-type-label">{item.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="fx-type-hint">
              {type === "question" ? t("forum.compose.questionHint", { hint: meta.hint }) : meta.hint}
            </p>

            <div className="fx-compose-grid">
              <div className="fx-compose-main">
                <div className="fx-field">
                  <div className="fx-field-label">
                    <label htmlFor={`${fieldId}-title`}>{t("forum.compose.titleLabel")}</label>
                  </div>
                  <input
                    id={`${fieldId}-title`}
                    className="fx-title-input"
                    value={draft.title}
                    maxLength={FORUM_TITLE_MAX}
                    data-autofocus
                    onChange={(event) => set("title", event.target.value)}
                    onBlur={() => touch("title")}
                    placeholder={
                      type === "question"
                        ? t("forum.compose.titlePlaceholder.question")
                        : type === "lfg"
                          ? t("forum.compose.titlePlaceholder.lfg")
                          : t("forum.compose.titlePlaceholder.default")
                    }
                    aria-invalid={show("title") && Boolean(errors.title)}
                    aria-describedby={show("title") && errors.title ? `${fieldId}-title-err` : undefined}
                  />
                  {fieldError("title", `${fieldId}-title-err`)}
                </div>

                <div className="fx-field">
                  <div className="fx-field-label">
                    <span id={`${fieldId}-tags`}>{t("forum.compose.tags")}</span>
                    <small>
                      {draft.tags.length}/{MAX_TAGS}
                    </small>
                  </div>
                  {props.roomTags.length > 0 ? (
                    <div className="fx-tag-picker" role="group" aria-labelledby={`${fieldId}-tags`}>
                      {props.roomTags.map((tag) => {
                        const active = draft.tags.some((item) => item.toLowerCase() === tag.toLowerCase());
                        return (
                          <TagChip
                            key={tag}
                            tag={tag}
                            active={active}
                            onClick={active || draft.tags.length < MAX_TAGS ? () => toggleTag(tag) : undefined}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      className="fx-tag-input"
                      onClick={(event) =>
                        (event.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()
                      }
                    >
                      {draft.tags.map((tag) => (
                        <TagChip key={tag} tag={tag} removable onClick={() => toggleTag(tag)} />
                      ))}
                      {draft.tags.length < MAX_TAGS && (
                        <input
                          aria-labelledby={`${fieldId}-tags`}
                          value={tagDraft}
                          maxLength={FORUM_TAG_LIMITS.maxTagLength}
                          onChange={(event) => setTagDraft(event.target.value)}
                          onKeyDown={onTagKey}
                          onBlur={commitTagDraft}
                          placeholder={draft.tags.length ? t("forum.compose.addTag") : t("forum.compose.tagHint")}
                        />
                      )}
                    </div>
                  )}
                </div>

                {type === "poll" && (
                  <fieldset className="fx-field fx-typed-panel">
                    <legend>{t("forum.poll.options")}</legend>
                    {draft.pollOptions.map((option, index) => (
                      <div key={index} className="fx-poll-edit-row">
                        <span aria-hidden="true">{index + 1}</span>
                        <input
                          value={option}
                          maxLength={FORUM_POLL_LIMITS.maxOptionLength}
                          aria-label={t("forum.compose.option", { number: index + 1 })}
                          placeholder={t("forum.compose.option", { number: index + 1 })}
                          onBlur={() => touch("poll")}
                          onChange={(event) =>
                            set(
                              "pollOptions",
                              draft.pollOptions.map((value, i) => (i === index ? event.target.value : value)),
                            )
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              if (
                                index === draft.pollOptions.length - 1 &&
                                draft.pollOptions.length < FORUM_POLL_LIMITS.maxOptions
                              )
                                set("pollOptions", [...draft.pollOptions, ""]);
                            }
                          }}
                        />
                        {draft.pollOptions.length > FORUM_POLL_LIMITS.minOptions && (
                          <button
                            type="button"
                            className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                            aria-label={t("forum.compose.removeOption", { number: index + 1 })}
                            onClick={() =>
                              set(
                                "pollOptions",
                                draft.pollOptions.filter((_, i) => i !== index),
                              )
                            }
                          >
                            <Icon name="close" size="sm" />
                          </button>
                        )}
                      </div>
                    ))}
                    {draft.pollOptions.length < FORUM_POLL_LIMITS.maxOptions && (
                      <button
                        type="button"
                        className="dcx-btn dcx-btn-ghost dcx-btn-sm fx-add-option"
                        onClick={() => set("pollOptions", [...draft.pollOptions, ""])}
                      >
                        {t("forum.compose.addOption")}
                      </button>
                    )}
                    <div className="fx-inline-fields">
                      <label className="fx-switch">
                        <input
                          type="checkbox"
                          checked={draft.pollMulti}
                          onChange={(event) => set("pollMulti", event.target.checked)}
                        />
                        <span aria-hidden="true" />
                        {t("forum.compose.multi")}
                      </label>
                      <label className="fx-select-label">
                        {t("forum.compose.endsAfter")}
                        <select
                          value={draft.pollDurationMs}
                          onChange={(event) => set("pollDurationMs", Number(event.target.value))}
                        >
                          {POLL_DURATIONS.map((item) => (
                            <option key={item.ms} value={item.ms}>
                              {t(`forum.compose.pollDuration.${item.id}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {fieldError("poll", `${fieldId}-poll-err`)}
                  </fieldset>
                )}

                {type === "lfg" && (
                  <fieldset className="fx-field fx-typed-panel fx-lfg-edit">
                    <legend>{t("forum.compose.group")}</legend>
                    <label>
                      {t("forum.lfg.game")}
                      <input
                        value={draft.lfgGame}
                        maxLength={FORUM_LFG_LIMITS.maxGameLength}
                        onChange={(event) => set("lfgGame", event.target.value)}
                        onBlur={() => touch("lfgGame")}
                        placeholder={t("forum.compose.gamePlaceholder")}
                        aria-invalid={show("lfgGame") && Boolean(errors.lfgGame)}
                      />
                    </label>
                    <label>
                      {t("forum.lfg.platform")}
                      <input
                        value={draft.lfgPlatform}
                        list={`${fieldId}-platforms`}
                        maxLength={FORUM_LFG_LIMITS.maxPlatformLength}
                        onChange={(event) => set("lfgPlatform", event.target.value)}
                        placeholder={t("forum.compose.platformPlaceholder")}
                      />
                    </label>
                    <datalist id={`${fieldId}-platforms`}>
                      {PLATFORMS.map((item) => (
                        <option key={item} value={item} />
                      ))}
                    </datalist>
                    <label>
                      {t("forum.compose.players")}
                      <span className="fx-stepper">
                        <button
                          type="button"
                          aria-label={t("forum.compose.fewer")}
                          onClick={() => set("lfgSlots", Math.max(FORUM_LFG_LIMITS.minSlots, draft.lfgSlots - 1))}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={FORUM_LFG_LIMITS.minSlots}
                          max={FORUM_LFG_LIMITS.maxSlots}
                          value={draft.lfgSlots}
                          onChange={(event) =>
                            set(
                              "lfgSlots",
                              Math.min(
                                FORUM_LFG_LIMITS.maxSlots,
                                Math.max(FORUM_LFG_LIMITS.minSlots, Math.round(Number(event.target.value) || 1)),
                              ),
                            )
                          }
                        />
                        <button
                          type="button"
                          aria-label={t("forum.compose.more")}
                          onClick={() => set("lfgSlots", Math.min(FORUM_LFG_LIMITS.maxSlots, draft.lfgSlots + 1))}
                        >
                          +
                        </button>
                      </span>
                    </label>
                    <label>
                      {t("forum.compose.startTime")}
                      <input
                        type="datetime-local"
                        value={draft.lfgStart}
                        onChange={(event) => set("lfgStart", event.target.value)}
                        onBlur={() => touch("lfgStart")}
                      />
                    </label>
                    {fieldError("lfgGame", `${fieldId}-lfg-err`)}
                    {fieldError("lfgStart", `${fieldId}-lfgs-err`)}
                  </fieldset>
                )}

                {type === "media" && (
                  <fieldset className="fx-field fx-typed-panel">
                    <legend>{t("forum.compose.media")}</legend>
                    {draft.mediaUrl.startsWith("/uploads/") ? (
                      <div className="fx-asset">
                        <span aria-hidden="true">🎬</span>
                        <span>
                          {t("forum.compose.uploaded", { type: draft.mediaMime || t("forum.compose.fileWord") })}
                        </span>
                        <button
                          type="button"
                          className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                          onClick={() => setDraft((current) => ({ ...current, mediaUrl: "", mediaMime: "" }))}
                        >
                          {t("forum.view.remove")}
                        </button>
                      </div>
                    ) : (
                      <div className="fx-inline-fields">
                        <input
                          className="fx-grow"
                          type="url"
                          inputMode="url"
                          value={draft.mediaUrl}
                          maxLength={FORUM_MEDIA_URL_MAX}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, mediaUrl: event.target.value.trim(), mediaMime: "" }))
                          }
                          onBlur={() => touch("media")}
                          placeholder={t("forum.compose.mediaPlaceholder")}
                          aria-label={t("forum.compose.mediaLink")}
                        />
                        <span className="fx-muted">{t("forum.compose.or")}</span>
                        <button
                          type="button"
                          className="dcx-btn dcx-btn-sm"
                          disabled={Boolean(uploading)}
                          onClick={() => mediaInputRef.current?.click()}
                        >
                          {t("forum.compose.upload")}
                        </button>
                      </div>
                    )}
                    <input
                      ref={mediaInputRef}
                      type="file"
                      accept="image/*,video/*"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = "";
                        if (file) void upload(file, "media");
                      }}
                    />
                    {fieldError("media", `${fieldId}-media-err`)}
                  </fieldset>
                )}

                <div className="fx-field">
                  <div className="fx-field-label">
                    <label htmlFor={`${fieldId}-body`}>
                      {bodyOptional ? t("forum.compose.description") : t("forum.compose.post")}
                    </label>
                    <div className="fx-tabs" role="tablist" aria-label={t("forum.compose.mode")}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={tab === "write"}
                        className={tab === "write" ? "active" : ""}
                        onClick={() => setTab("write")}
                      >
                        {t("forum.compose.write")}
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={tab === "preview"}
                        className={tab === "preview" ? "active" : ""}
                        onClick={() => setTab("preview")}
                      >
                        {t("forum.compose.preview")}
                      </button>
                    </div>
                  </div>
                  <div
                    className={`fx-editor${dragging ? " dragging" : ""}`}
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes("Files")) {
                        event.preventDefault();
                        setDragging(true);
                      }
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
                    }}
                    onDrop={onDrop}
                  >
                    <div
                      className="fx-editor-tools"
                      role="toolbar"
                      aria-label={t("forum.compose.formatting")}
                      onMouseDown={rememberSelection}
                    >
                      <button
                        type="button"
                        aria-label={t("forum.compose.tool.bold")}
                        title={t("forum.compose.tool.bold")}
                        onClick={() => wrapSelection("**", "**", t("forum.compose.placeholder.bold"))}
                      >
                        <b>{GLYPHS.bold}</b>
                      </button>
                      <button
                        type="button"
                        aria-label={t("forum.compose.tool.italic")}
                        title={t("forum.compose.tool.italic")}
                        onClick={() => wrapSelection("*", "*", t("forum.compose.placeholder.italic"))}
                      >
                        <i>{GLYPHS.italic}</i>
                      </button>
                      <button
                        type="button"
                        aria-label={t("forum.compose.tool.strike")}
                        title={t("forum.compose.tool.strike")}
                        onClick={() => wrapSelection("~~", "~~", t("forum.compose.placeholder.strike"))}
                      >
                        <s>{GLYPHS.strike}</s>
                      </button>
                      <span className="fx-tool-sep" aria-hidden="true" />
                      <button
                        type="button"
                        aria-label={t("forum.compose.tool.heading")}
                        title={t("forum.compose.tool.heading")}
                        onClick={() => prefixLines(() => "## ", t("forum.compose.placeholder.heading"))}
                      >
                        {GLYPHS.heading}
                      </button>
                      <button
                        type="button"
                        aria-label={t("forum.compose.tool.bullets")}
                        title={t("forum.compose.tool.bullets")}
                        onClick={() => prefixLines(() => "- ", t("forum.compose.placeholder.listItem"))}
                      >
                        •≡
                      </button>
                      <button
                        type="button"
                        aria-label={t("forum.compose.tool.numbers")}
                        title={t("forum.compose.tool.numbers")}
                        onClick={() =>
                          prefixLines((index) => `${index + 1}. `, t("forum.compose.placeholder.listItem"))
                        }
                      >
                        1≡
                      </button>
                      <button
                        type="button"
                        aria-label={t("forum.compose.tool.quote")}
                        title={t("forum.compose.tool.quote")}
                        onClick={() => prefixLines(() => "> ", t("forum.compose.placeholder.quote"))}
                      >
                        ❝
                      </button>
                      <button
                        type="button"
                        aria-label={t("forum.compose.tool.code")}
                        title={t("forum.compose.tool.code")}
                        onClick={insertCodeBlock}
                      >
                        {"</>"}
                      </button>
                      <button
                        type="button"
                        aria-label={t("forum.compose.tool.spoiler")}
                        title={t("forum.compose.tool.spoiler")}
                        onClick={() => wrapSelection("||", "||", t("forum.compose.placeholder.spoiler"))}
                      >
                        ▒
                      </button>
                      <span className="fx-tool-sep" aria-hidden="true" />
                      <button
                        type="button"
                        aria-label={t("forum.compose.tool.link")}
                        title={t("forum.compose.tool.link")}
                        aria-expanded={linkOpen}
                        onClick={() => {
                          setLinkOpen((value) => !value);
                          setEmojiOpen(false);
                        }}
                      >
                        <Icon name="link" size="sm" />
                      </button>
                      <span className="fx-popover-anchor">
                        <button
                          type="button"
                          aria-label={t("forum.compose.tool.emoji")}
                          title={t("forum.compose.tool.emoji")}
                          aria-expanded={emojiOpen}
                          onClick={() => {
                            setEmojiOpen((value) => !value);
                            setLinkOpen(false);
                          }}
                        >
                          ☺
                        </button>
                        {emojiOpen && (
                          <div className="fx-emoji-pop" role="menu" aria-label={t("forum.compose.tool.emoji")}>
                            {EMOJIS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  insertText(emoji);
                                  setEmojiOpen(false);
                                }}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </span>
                      <button
                        type="button"
                        aria-label={t("forum.compose.tool.image")}
                        title={t("forum.compose.tool.imageTitle")}
                        disabled={Boolean(uploading)}
                        onClick={() => imageInputRef.current?.click()}
                      >
                        🖼
                      </button>
                      <button
                        type="button"
                        aria-label={t("forum.view.attach")}
                        title={t("forum.view.attach")}
                        disabled={Boolean(uploading)}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        📎
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        hidden
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = "";
                          if (file) void upload(file, "file");
                        }}
                      />
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        hidden
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = "";
                          if (file) void upload(file, "image");
                        }}
                      />
                    </div>
                    {linkOpen && (
                      <div className="fx-link-row">
                        <input
                          autoFocus
                          type="url"
                          value={linkUrl}
                          onChange={(event) => setLinkUrl(event.target.value)}
                          placeholder={LINK_URL_EXAMPLE}
                          aria-label={t("forum.compose.linkUrl")}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              confirmLink();
                            } else if (event.key === "Escape") {
                              event.stopPropagation();
                              setLinkOpen(false);
                            }
                          }}
                        />
                        <button type="button" className="dcx-btn dcx-btn-sm dcx-btn-primary" onClick={confirmLink}>
                          {t("forum.compose.insert")}
                        </button>
                        <button
                          type="button"
                          className="dcx-btn dcx-btn-sm dcx-btn-ghost"
                          onClick={() => setLinkOpen(false)}
                        >
                          {t("forum.view.cancel")}
                        </button>
                      </div>
                    )}
                    {tab === "write" ? (
                      <textarea
                        id={`${fieldId}-body`}
                        ref={bodyRef}
                        value={draft.body}
                        maxLength={FORUM_BODY_MAX}
                        rows={10}
                        onChange={(event) => set("body", event.target.value)}
                        onBlur={() => {
                          rememberSelection();
                          touch("body");
                        }}
                        onSelect={rememberSelection}
                        onKeyDown={onEditorKey}
                        onPaste={onPaste}
                        placeholder={
                          type === "guide"
                            ? t("forum.compose.bodyPlaceholder.guide")
                            : t("forum.compose.bodyPlaceholder.default")
                        }
                        aria-invalid={show("body") && Boolean(errors.body)}
                        aria-describedby={show("body") && errors.body ? `${fieldId}-body-err` : undefined}
                      />
                    ) : (
                      <div className="fx-editor-preview">
                        {draft.body.trim() ? (
                          renderForumMarkdown(draft.body, resolveImage)
                        ) : (
                          <p className="fx-muted">{t("forum.compose.nothing")}</p>
                        )}
                      </div>
                    )}
                    {dragging && (
                      <div className="fx-drop-hint" aria-hidden="true">
                        {t("forum.compose.drop")}
                      </div>
                    )}
                  </div>
                  {fieldError("body", `${fieldId}-body-err`)}
                </div>

                {(uploading || draft.attachment) && (
                  <div className="fx-compose-assets">
                    {uploading && (
                      <span className="fx-muted" role="status">
                        {t(`forum.compose.uploading.${uploading}`)}
                      </span>
                    )}
                    {draft.attachment && (
                      <span className="fx-asset">
                        <span aria-hidden="true">📎</span>
                        <span>{draft.attachment.name}</span>
                        <button
                          type="button"
                          className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                          onClick={() => set("attachment", null)}
                        >
                          {t("forum.view.remove")}
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </div>

              <aside className="fx-compose-side" aria-label={t("forum.compose.side")}>
                <section className="fx-side-card">
                  <h3 className="fx-side-title">{t("forum.compose.livePreview")}</h3>
                  {previewCard}
                </section>
                <section className="fx-side-card">
                  <h3 className="fx-side-title">{t("forum.compose.cover")}</h3>
                  <div className="fx-cover-row">
                    {iconPreview ? (
                      <img src={iconPreview} alt={t("forum.compose.coverPreview")} />
                    ) : (
                      <span className="fx-cover-empty" aria-hidden="true">
                        {meta.icon}
                      </span>
                    )}
                    <div>
                      <button
                        type="button"
                        className="dcx-btn dcx-btn-sm"
                        disabled={Boolean(uploading)}
                        onClick={() => iconInputRef.current?.click()}
                      >
                        {iconPreview ? t("forum.compose.change") : t("forum.compose.uploadImage")}
                      </button>
                      {iconPreview && (
                        <button
                          type="button"
                          className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                          onClick={() => set("iconUrl", "")}
                        >
                          {t("forum.view.remove")}
                        </button>
                      )}
                      <small className="fx-hint">{t("forum.compose.coverHint")}</small>
                    </div>
                    <input
                      ref={iconInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = "";
                        if (file) void upload(file, "icon");
                      }}
                    />
                  </div>
                </section>
                {props.canLockReplies && (
                  <section className="fx-side-card">
                    <h3 className="fx-side-title">{t("forum.compose.options")}</h3>
                    <label className="fx-switch">
                      <input
                        type="checkbox"
                        checked={!draft.repliesLocked}
                        onChange={(event) => set("repliesLocked", !event.target.checked)}
                      />
                      <span aria-hidden="true" />
                      {t("forum.compose.allowReplies")}
                    </label>
                    <small className="fx-hint">
                      {draft.repliesLocked ? t("forum.compose.lockedHint") : t("forum.compose.repliesHint")}
                    </small>
                  </section>
                )}
                {props.guidelines && (
                  <details className="fx-guidelines fx-side-card">
                    <summary>{t("forum.view.guidelines")}</summary>
                    <p>{props.guidelines}</p>
                  </details>
                )}
              </aside>
            </div>

            <footer className="fx-compose-foot fx-compose-sticky">
              <div className="fx-foot-meta">
                <span className={draft.title.length > FORUM_TITLE_MAX - 15 ? "warn" : ""}>
                  {t("forum.compose.titleCount", { count: draft.title.length, max: FORUM_TITLE_MAX })}
                </span>
                <span className={draft.body.length > FORUM_BODY_MAX - 200 ? "warn" : ""}>
                  {t("forum.compose.bodyCount", { count: draft.body.length, max: FORUM_BODY_MAX })}
                </span>
                {error ? (
                  <span className="fx-error" role="alert">
                    {error}
                  </span>
                ) : submitted && !valid ? (
                  <span className="fx-error" role="alert">
                    {errorList[0]}
                  </span>
                ) : (
                  <span className="fx-muted fx-kbd-hint">{t("forum.compose.shortcut")}</span>
                )}
              </div>
              <div className="fx-foot-actions">
                <button type="button" className="dcx-btn" onClick={props.onClose}>
                  {t("forum.view.cancel")}
                </button>
                <button
                  type="submit"
                  className="dcx-btn dcx-btn-primary fx-publish"
                  disabled={publishing || Boolean(uploading)}
                  aria-disabled={!valid}
                >
                  {publishing ? (
                    t("forum.compose.publishing")
                  ) : (
                    <>
                      <span aria-hidden="true">{meta.icon}</span> {t("forum.compose.publish")}
                    </>
                  )}
                </button>
              </div>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
