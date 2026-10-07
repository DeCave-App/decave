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
const POLL_DURATIONS: { label: string; ms: number }[] = [
  { label: "No end", ms: 0 },
  { label: "1 hour", ms: 3_600_000 },
  { label: "1 day", ms: 86_400_000 },
  { label: "3 days", ms: 3 * 86_400_000 },
  { label: "1 week", ms: 7 * 86_400_000 },
  { label: "30 days", ms: FORUM_POLL_LIMITS.maxDurationMs },
];
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
    title: !draft.title.trim() ? "Add a title." : "",
    body: !bodyOptional && !draft.body.trim() ? "Write something in the post body." : "",
    poll:
      type !== "poll"
        ? ""
        : cleanPollOptions.length < FORUM_POLL_LIMITS.minOptions
          ? "Add at least two options."
          : new Set(cleanPollOptions.map((option) => option.toLowerCase())).size !== cleanPollOptions.length
            ? "Options must be different."
            : "",
    lfgGame: type === "lfg" && !draft.lfgGame.trim() ? "Which game are you playing?" : "",
    lfgStart:
      type === "lfg" && draft.lfgStart && !(new Date(draft.lfgStart).getTime() > 0) ? "Pick a valid start time." : "",
    media:
      type !== "media"
        ? ""
        : !draft.mediaUrl && !draft.attachment
          ? "Add a clip link or upload a file."
          : draft.mediaUrl && !draft.mediaUrl.startsWith("/uploads/") && !/^https:\/\/\S+$/.test(draft.mediaUrl)
            ? "Links must start with https://."
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
      setError(`Posts can have at most ${MAX_TAGS} tags.`);
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
      wrapSelection(`${lead}\`\`\`\n`, "\n```\n", "code");
    } else wrapSelection("`", "`", "code");
  };
  const confirmLink = () => {
    let url: URL;
    try {
      url = new URL(linkUrl.trim());
    } catch {
      setError("Enter a valid https:// link.");
      return;
    }
    if (url.protocol !== "https:") {
      setError("Links must use https://.");
      return;
    }
    setError("");
    setLinkOpen(false);
    setLinkUrl("");
    wrapSelection("[", `](${url.toString()})`, "link text");
  };
  const onEditorKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === "b") {
      event.preventDefault();
      wrapSelection("**", "**", "bold text");
    } else if (key === "i") {
      event.preventDefault();
      wrapSelection("*", "*", "italic text");
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
      setError("Choose a PNG, JPEG, WebP, or GIF image.");
      return;
    }
    setUploading(kind);
    setError("");
    try {
      const result = await uploadForumFile(props.fetcher, props.apiBase, props.roomId, file);
      if (kind === "icon") {
        if (!props.resolveIconUrl(result.url)) throw new Error("That image cannot be used as a cover.");
        set("iconUrl", result.url);
      } else if (kind === "image") {
        if (!props.resolveIconUrl(result.url)) throw new Error("That image cannot be shown inline; attach it instead.");
        insertText(`![${file.name.replace(/[[\]()]/g, "").slice(0, 40) || "image"}](${result.url})`);
      } else if (kind === "media") {
        setDraft((current) => ({
          ...current,
          mediaUrl: result.url,
          mediaMime: (result.mimeType || file.type || "").slice(0, 100),
        }));
      } else set("attachment", result);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
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
      if (!(await props.publish(text, draft.attachment)))
        throw new Error("Realtime is reconnecting. Try again in a moment.");
      saveForumDraft(props.viewerId ?? "", props.roomId, null, forumDraftVersion);
      props.onPublished();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "Could not publish the post.");
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
    <article className="fx-compose-preview" aria-label="Post preview">
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
          <h3>{previewPayload.title || <span className="fx-muted">Your title appears here</span>}</h3>
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
        !bodyOptional && <p className="fx-muted">Nothing to preview yet.</p>
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
            <span className="fx-kicker">New post · #{props.roomName}</span>
            <h2 id={titleId}>Create a post</h2>
          </div>
          <div className="fx-compose-head-side">
            {restored ? (
              <span className="fx-draft-note" role="status">
                Draft restored ·{" "}
                <button type="button" className="fx-link-btn" onClick={discardDraft}>
                  Discard
                </button>
              </span>
            ) : savedAt ? (
              <span className="fx-draft-note muted" role="status">
                Draft saved
              </span>
            ) : null}
            <button type="button" className="dcx-btn dcx-btn-ghost fx-close" aria-label="Close" onClick={props.onClose}>
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
                Close
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
            <div className="fx-type-picker" role="radiogroup" aria-label="Post type">
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
              {meta.hint}
              {type === "question" ? " — you can mark a reply as the solution." : ""}
            </p>

            <div className="fx-compose-grid">
              <div className="fx-compose-main">
                <div className="fx-field">
                  <div className="fx-field-label">
                    <label htmlFor={`${fieldId}-title`}>Title</label>
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
                        ? "What do you need help with?"
                        : type === "lfg"
                          ? "e.g. Ranked duos tonight, chill vibes"
                          : "A clear, searchable title"
                    }
                    aria-invalid={show("title") && Boolean(errors.title)}
                    aria-describedby={show("title") && errors.title ? `${fieldId}-title-err` : undefined}
                  />
                  {fieldError("title", `${fieldId}-title-err`)}
                </div>

                <div className="fx-field">
                  <div className="fx-field-label">
                    <span id={`${fieldId}-tags`}>Tags</span>
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
                          placeholder={draft.tags.length ? "Add tag" : "Type a tag and press Enter"}
                        />
                      )}
                    </div>
                  )}
                </div>

                {type === "poll" && (
                  <fieldset className="fx-field fx-typed-panel">
                    <legend>Poll options</legend>
                    {draft.pollOptions.map((option, index) => (
                      <div key={index} className="fx-poll-edit-row">
                        <span aria-hidden="true">{index + 1}</span>
                        <input
                          value={option}
                          maxLength={FORUM_POLL_LIMITS.maxOptionLength}
                          aria-label={`Option ${index + 1}`}
                          placeholder={`Option ${index + 1}`}
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
                            aria-label={`Remove option ${index + 1}`}
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
                        + Add option
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
                        Allow multiple choices
                      </label>
                      <label className="fx-select-label">
                        Ends after
                        <select
                          value={draft.pollDurationMs}
                          onChange={(event) => set("pollDurationMs", Number(event.target.value))}
                        >
                          {POLL_DURATIONS.map((item) => (
                            <option key={item.ms} value={item.ms}>
                              {item.label}
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
                    <legend>Group details</legend>
                    <label>
                      Game
                      <input
                        value={draft.lfgGame}
                        maxLength={FORUM_LFG_LIMITS.maxGameLength}
                        onChange={(event) => set("lfgGame", event.target.value)}
                        onBlur={() => touch("lfgGame")}
                        placeholder="e.g. Valorant"
                        aria-invalid={show("lfgGame") && Boolean(errors.lfgGame)}
                      />
                    </label>
                    <label>
                      Platform
                      <input
                        value={draft.lfgPlatform}
                        list={`${fieldId}-platforms`}
                        maxLength={FORUM_LFG_LIMITS.maxPlatformLength}
                        onChange={(event) => set("lfgPlatform", event.target.value)}
                        placeholder="PC, PlayStation…"
                      />
                    </label>
                    <datalist id={`${fieldId}-platforms`}>
                      {PLATFORMS.map((item) => (
                        <option key={item} value={item} />
                      ))}
                    </datalist>
                    <label>
                      Players needed
                      <span className="fx-stepper">
                        <button
                          type="button"
                          aria-label="Fewer players"
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
                          aria-label="More players"
                          onClick={() => set("lfgSlots", Math.min(FORUM_LFG_LIMITS.maxSlots, draft.lfgSlots + 1))}
                        >
                          +
                        </button>
                      </span>
                    </label>
                    <label>
                      Start time (optional)
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
                    <legend>Clip or media</legend>
                    {draft.mediaUrl.startsWith("/uploads/") ? (
                      <div className="fx-asset">
                        <span aria-hidden="true">🎬</span>
                        <span>Uploaded {draft.mediaMime || "file"}</span>
                        <button
                          type="button"
                          className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                          onClick={() => setDraft((current) => ({ ...current, mediaUrl: "", mediaMime: "" }))}
                        >
                          Remove
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
                          placeholder="https://example.com/media"
                          aria-label="Media link"
                        />
                        <span className="fx-muted">or</span>
                        <button
                          type="button"
                          className="dcx-btn dcx-btn-sm"
                          disabled={Boolean(uploading)}
                          onClick={() => mediaInputRef.current?.click()}
                        >
                          Upload
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
                    <label htmlFor={`${fieldId}-body`}>{bodyOptional ? "Description (optional)" : "Post"}</label>
                    <div className="fx-tabs" role="tablist" aria-label="Editor mode">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={tab === "write"}
                        className={tab === "write" ? "active" : ""}
                        onClick={() => setTab("write")}
                      >
                        Write
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={tab === "preview"}
                        className={tab === "preview" ? "active" : ""}
                        onClick={() => setTab("preview")}
                      >
                        Preview
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
                      aria-label="Formatting"
                      onMouseDown={rememberSelection}
                    >
                      <button
                        type="button"
                        aria-label="Bold (Ctrl+B)"
                        title="Bold (Ctrl+B)"
                        onClick={() => wrapSelection("**", "**", "bold text")}
                      >
                        <b>B</b>
                      </button>
                      <button
                        type="button"
                        aria-label="Italic (Ctrl+I)"
                        title="Italic (Ctrl+I)"
                        onClick={() => wrapSelection("*", "*", "italic text")}
                      >
                        <i>I</i>
                      </button>
                      <button
                        type="button"
                        aria-label="Strikethrough"
                        title="Strikethrough"
                        onClick={() => wrapSelection("~~", "~~", "struck text")}
                      >
                        <s>S</s>
                      </button>
                      <span className="fx-tool-sep" aria-hidden="true" />
                      <button
                        type="button"
                        aria-label="Heading"
                        title="Heading"
                        onClick={() => prefixLines(() => "## ", "Heading")}
                      >
                        H
                      </button>
                      <button
                        type="button"
                        aria-label="Bulleted list"
                        title="Bulleted list"
                        onClick={() => prefixLines(() => "- ", "List item")}
                      >
                        •≡
                      </button>
                      <button
                        type="button"
                        aria-label="Numbered list"
                        title="Numbered list"
                        onClick={() => prefixLines((index) => `${index + 1}. `, "List item")}
                      >
                        1≡
                      </button>
                      <button
                        type="button"
                        aria-label="Quote"
                        title="Quote"
                        onClick={() => prefixLines(() => "> ", "Quote")}
                      >
                        ❝
                      </button>
                      <button type="button" aria-label="Code" title="Code" onClick={insertCodeBlock}>
                        {"</>"}
                      </button>
                      <button
                        type="button"
                        aria-label="Spoiler"
                        title="Spoiler"
                        onClick={() => wrapSelection("||", "||", "spoiler")}
                      >
                        ▒
                      </button>
                      <span className="fx-tool-sep" aria-hidden="true" />
                      <button
                        type="button"
                        aria-label="Insert link (Ctrl+K)"
                        title="Insert link (Ctrl+K)"
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
                          aria-label="Emoji"
                          title="Emoji"
                          aria-expanded={emojiOpen}
                          onClick={() => {
                            setEmojiOpen((value) => !value);
                            setLinkOpen(false);
                          }}
                        >
                          ☺
                        </button>
                        {emojiOpen && (
                          <div className="fx-emoji-pop" role="menu" aria-label="Emoji">
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
                        aria-label="Insert image"
                        title="Insert image (or paste / drop)"
                        disabled={Boolean(uploading)}
                        onClick={() => imageInputRef.current?.click()}
                      >
                        🖼
                      </button>
                      <button
                        type="button"
                        aria-label="Attach a file"
                        title="Attach a file"
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
                          placeholder="https://"
                          aria-label="Link URL"
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
                          Insert
                        </button>
                        <button
                          type="button"
                          className="dcx-btn dcx-btn-sm dcx-btn-ghost"
                          onClick={() => setLinkOpen(false)}
                        >
                          Cancel
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
                            ? "## Step 1\nExplain each step… Paste or drop screenshots right here."
                            : "Share the details. Markdown works, and you can paste or drop images."
                        }
                        aria-invalid={show("body") && Boolean(errors.body)}
                        aria-describedby={show("body") && errors.body ? `${fieldId}-body-err` : undefined}
                      />
                    ) : (
                      <div className="fx-editor-preview">
                        {draft.body.trim() ? (
                          renderForumMarkdown(draft.body, resolveImage)
                        ) : (
                          <p className="fx-muted">Nothing to preview yet.</p>
                        )}
                      </div>
                    )}
                    {dragging && (
                      <div className="fx-drop-hint" aria-hidden="true">
                        Drop to upload
                      </div>
                    )}
                  </div>
                  {fieldError("body", `${fieldId}-body-err`)}
                </div>

                {(uploading || draft.attachment) && (
                  <div className="fx-compose-assets">
                    {uploading && (
                      <span className="fx-muted" role="status">
                        Uploading {uploading === "icon" ? "cover" : uploading}…
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
                          Remove
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </div>

              <aside className="fx-compose-side" aria-label="Preview and options">
                <section className="fx-side-card">
                  <h3 className="fx-side-title">Live preview</h3>
                  {previewCard}
                </section>
                <section className="fx-side-card">
                  <h3 className="fx-side-title">Cover</h3>
                  <div className="fx-cover-row">
                    {iconPreview ? (
                      <img src={iconPreview} alt="Cover preview" />
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
                        {iconPreview ? "Change" : "Upload image"}
                      </button>
                      {iconPreview && (
                        <button
                          type="button"
                          className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                          onClick={() => set("iconUrl", "")}
                        >
                          Remove
                        </button>
                      )}
                      <small className="fx-hint">Shown as the post icon in the list.</small>
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
                    <h3 className="fx-side-title">Options</h3>
                    <label className="fx-switch">
                      <input
                        type="checkbox"
                        checked={!draft.repliesLocked}
                        onChange={(event) => set("repliesLocked", !event.target.checked)}
                      />
                      <span aria-hidden="true" />
                      Allow replies
                    </label>
                    <small className="fx-hint">
                      {draft.repliesLocked
                        ? "The post is created locked; only moderators can reply."
                        : "Turn off for announcements."}
                    </small>
                  </section>
                )}
                {props.guidelines && (
                  <details className="fx-guidelines fx-side-card">
                    <summary>Posting guidelines</summary>
                    <p>{props.guidelines}</p>
                  </details>
                )}
              </aside>
            </div>

            <footer className="fx-compose-foot fx-compose-sticky">
              <div className="fx-foot-meta">
                <span className={draft.title.length > FORUM_TITLE_MAX - 15 ? "warn" : ""}>
                  Title {draft.title.length}/{FORUM_TITLE_MAX}
                </span>
                <span className={draft.body.length > FORUM_BODY_MAX - 200 ? "warn" : ""}>
                  Body {draft.body.length}/{FORUM_BODY_MAX}
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
                  <span className="fx-muted fx-kbd-hint">Ctrl+Enter to publish</span>
                )}
              </div>
              <div className="fx-foot-actions">
                <button type="button" className="dcx-btn" onClick={props.onClose}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="dcx-btn dcx-btn-primary fx-publish"
                  disabled={publishing || Boolean(uploading)}
                  aria-disabled={!valid}
                >
                  {publishing ? (
                    "Publishing…"
                  ) : (
                    <>
                      <span aria-hidden="true">{meta.icon}</span> Publish
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
