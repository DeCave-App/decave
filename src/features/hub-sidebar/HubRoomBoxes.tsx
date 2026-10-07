import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "../../components/Icon";
import { buildRoomBoxes, denser, neighbourInBox, pickDensity, type RoomBox, type RoomDensity } from "./roomBoxesModel";
import "./hubSidebar.css";
import "./hubPolish.css";
import "./hubBoxes.css";

export type SidebarRoomType = "forum" | "text" | "voice";

export type SidebarRoom = {
  id: number;
  name: string;
  type: string;
  category?: string;
  private?: boolean;
  icon?: string;
};

export type SidebarVoiceParticipant = {
  connectionId: string;
  userId: string;
  username: string;
  avatarUrl?: string | null;
  channelId: number;
  muted: boolean;
  selfMuted?: boolean;
  deafened?: boolean;
  selfDeafened?: boolean;
  serverMuted?: boolean;
  serverDeafened?: boolean;
  screenSharing: boolean;
};

/** Newest thread of a forum room, shown on its tile. */
export type ForumPreview = {
  title: string;
  replyCount: number;
  lastActivityAt: string;
  /** True when the newest thread has activity the viewer has not seen. */
  unread: boolean;
  solved: boolean;
};

type DragProps = {
  draggable: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
};

export type HubRoomBoxesProps<R extends SidebarRoom, P extends SidebarVoiceParticipant> = {
  hubId: number;
  rooms: R[];
  selectedRoomId: number;
  /** Hub Home is open in the main pane (no room tile is highlighted). */
  homeSelected: boolean;
  /** Rooms with something new, shown on the Hub Home tile. */
  homeBadge: number;
  onOpenHome: () => void;
  /** Hub actions (members, calendar, manage) shown on the Hub Home row. */
  homeActions?: ReactNode;
  draggedRoomId: number | null;
  ownerOnlyPosting: boolean;
  canManageRooms: boolean;
  unread: Record<number, number>;
  mentions: Record<number, number>;
  voiceParticipants: P[];
  connectedVoiceRoomId: number | null;
  forumPreviews: Record<number, ForumPreview | null | undefined>;
  reorderError: string;
  onDismissReorderError: () => void;
  dragProps: (room: R) => DragProps;
  onSelectRoom: (room: R) => void;
  /** Double-click (or Enter) on a voice tile: select it and join voice right away. */
  onJoinVoiceRoom?: (room: R) => void;
  onRoomContextMenu: (event: MouseEvent<HTMLElement>, room: R) => void;
  /** Move `sourceId` to the position of `targetId` (both in the same box). */
  onReorderRooms: (sourceId: number, targetId: number) => void;
  onCreateRoom: (type: SidebarRoomType) => void;
  isSpeaking: (participant: P) => boolean;
  onParticipantClick: (event: MouseEvent<HTMLElement>, participant: P) => void;
  onParticipantContextMenu: (event: MouseEvent<HTMLElement>, participant: P) => void;
  renderAvatar: (participant: P) => ReactNode;
};

const DEFAULT_ICON: Record<SidebarRoomType, IconName> = { forum: "forum", text: "hash", voice: "volume" };

function roomType(room: SidebarRoom): SidebarRoomType {
  return room.type === "voice" ? "voice" : room.type === "forum" ? "forum" : "text";
}

function LockGlyph() {
  return (
    <svg className="hbx-lock" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7 10V7a5 5 0 0 1 10 0v3h1.25A1.75 1.75 0 0 1 20 11.75v8.5A1.75 1.75 0 0 1 18.25 22H5.75A1.75 1.75 0 0 1 4 20.25v-8.5A1.75 1.75 0 0 1 5.75 10H7Zm2 0h6V7a3 3 0 1 0-6 0v3Z"
      />
    </svg>
  );
}

export function relativeShort(iso: string, now = Date.now()): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.round((now - time) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.round(days / 7)}w`;
}

export function HubRoomBoxes<R extends SidebarRoom, P extends SidebarVoiceParticipant>(props: HubRoomBoxesProps<R, P>) {
  const boxes = useMemo(
    () => buildRoomBoxes(props.rooms, { ownerOnlyPosting: props.ownerOnlyPosting }),
    [props.rooms, props.ownerOnlyPosting],
  );
  const liveVoiceIds = useMemo(
    () => new Set(props.voiceParticipants.map((participant) => participant.channelId)),
    [props.voiceParticipants],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const estimated = useMemo(
    () => pickDensity(boxes, size.height, liveVoiceIds, size.width),
    [boxes, size, liveVoiceIds],
  );
  // Extra "denser" steps on top of the estimate, remembered only for the estimate they were measured against.
  const [extraSteps, setExtraSteps] = useState<{ base: RoomDensity; steps: number }>({ base: estimated, steps: 0 });
  let density: RoomDensity = estimated;
  if (extraSteps.base === estimated) for (let i = 0; i < extraSteps.steps; i += 1) density = denser(density);

  // Track the space the boxes have to fit into.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = () =>
      setSize((current) =>
        current.width === node.clientWidth && current.height === node.clientHeight
          ? current
          : { width: node.clientWidth, height: node.clientHeight },
      );
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Step denser while the real layout still overflows (text scaling or long
  // names can make tiles taller than the estimate). Never collapses anything.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || density === "tight") return;
    if (node.scrollHeight > node.clientHeight + 1) {
      setExtraSteps((current) => ({ base: estimated, steps: (current.base === estimated ? current.steps : 0) + 1 }));
    }
  }, [density, estimated]);

  const boxOf = (roomId: number) => boxes.find((box) => box.rooms.some((room) => room.id === roomId))?.key ?? null;

  // Drag-and-drop only reorders inside one box.
  const scopedDragProps = (room: R, box: RoomBox<R>): DragProps => {
    const base = props.dragProps(room);
    const sameBox = () => props.draggedRoomId !== null && boxOf(props.draggedRoomId) === box.key;
    return {
      ...base,
      onDragEnter: (event) => {
        if (sameBox()) base.onDragEnter(event);
      },
      onDragOver: (event) => {
        if (sameBox()) base.onDragOver(event);
      },
      onDrop: (event) => {
        if (sameBox()) base.onDrop(event);
        else base.onDragEnd();
      },
    };
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>, room: R) => {
    if (event.key === "Enter" && !event.altKey && !event.repeat && room.type === "voice" && props.onJoinVoiceRoom) {
      event.preventDefault();
      props.onJoinVoiceRoom(room);
      return;
    }
    if (!props.canManageRooms || !event.altKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown" && event.key !== "ArrowLeft" && event.key !== "ArrowRight")
      return;
    event.preventDefault();
    const delta = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
    const target = neighbourInBox(boxes, room.id, delta);
    if (target === null) return;
    props.onReorderRooms(room.id, target);
    const id = room.id;
    window.setTimeout(() => document.querySelector<HTMLElement>(`.hbx-root [data-channel-id="${id}"]`)?.focus(), 0);
  };

  const tileLabel = (room: R, extra: string) => {
    const unread = props.unread[room.id] ?? 0;
    const mention = props.mentions[room.id] ?? 0;
    const locked = room.private === true || (room.type !== "voice" && props.ownerOnlyPosting);
    return `${room.name}${extra}${locked ? ", private" : ""}${mention ? `, ${mention} mentions` : unread ? `, ${unread} unread` : ""}`;
  };

  const roomButtonProps = (room: R, box: RoomBox<R>) => {
    const selected = !props.homeSelected && props.selectedRoomId === room.id;
    return {
      type: "button" as const,
      ...scopedDragProps(room, box),
      "data-channel-id": room.id,
      "aria-current": selected ? ("page" as const) : undefined,
      "aria-keyshortcuts": props.canManageRooms ? "Alt+ArrowUp Alt+ArrowDown" : undefined,
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        if (event.detail > 1) return;
        props.onSelectRoom(room);
      },
      onDoubleClick:
        room.type === "voice" && props.onJoinVoiceRoom
          ? (event: MouseEvent<HTMLButtonElement>) => {
              event.preventDefault();
              props.onJoinVoiceRoom?.(room);
            }
          : undefined,
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => handleKeyDown(event, room),
      onContextMenu: (event: MouseEvent<HTMLButtonElement>) => props.onRoomContextMenu(event, room),
    };
  };

  const stateClass = (room: R) => {
    const selected = !props.homeSelected && props.selectedRoomId === room.id;
    const unread = (props.unread[room.id] ?? 0) > 0 || (props.mentions[room.id] ?? 0) > 0;
    return `${selected ? " is-selected" : ""}${unread && !selected ? " is-new" : ""}${props.draggedRoomId === room.id ? " is-dragging" : ""}`;
  };

  const badge = (room: R) => {
    const mention = props.mentions[room.id] ?? 0;
    const unread = props.unread[room.id] ?? 0;
    const selected = !props.homeSelected && props.selectedRoomId === room.id;
    // Forums also count a newest thread you have not seen, so chip sizes keep the "new" signal.
    const freshForum = room.type === "forum" && props.forumPreviews[room.id]?.unread === true;
    if (mention > 0)
      return (
        <b className="hbx-badge" aria-hidden="true">
          {mention > 99 ? "99+" : mention}
        </b>
      );
    if ((unread > 0 || freshForum) && !selected) return <i className="hbx-dot" aria-hidden="true" />;
    return null;
  };

  const roomIcon = (room: R) => (
    <span className={`hbx-icon${room.icon ? " custom" : ""}`} aria-hidden="true">
      {room.icon || <Icon name={DEFAULT_ICON[roomType(room)]} size="sm" />}
    </span>
  );

  const lockFor = (room: R) => {
    const locked = room.private === true || (room.type !== "voice" && props.ownerOnlyPosting);
    if (!locked) return null;
    return (
      <span
        className="hbx-lockwrap"
        title={room.type !== "voice" && props.ownerOnlyPosting ? "Only the Hub owner can post" : "Private room"}
      >
        <LockGlyph />
      </span>
    );
  };

  const renderPlainTile = (room: R, box: RoomBox<R>, extraLabel = "") => (
    <button
      key={room.id}
      {...roomButtonProps(room, box)}
      className={`hbx-tile hbx-tile--${roomType(room)}${stateClass(room)}`}
      aria-label={tileLabel(room, extraLabel)}
      title={room.name}
    >
      {roomIcon(room)}
      <span className="hbx-name">{room.name}</span>
      {lockFor(room)}
      {badge(room)}
    </button>
  );

  const renderForumTile = (room: R, box: RoomBox<R>) => {
    const preview = props.forumPreviews[room.id];
    const fresh = preview?.unread === true || (props.unread[room.id] ?? 0) > 0;
    if (density === "chips" || density === "tight")
      return renderPlainTile(
        room,
        box,
        `, forum${preview ? `, newest thread ${preview.title}${preview.unread ? ", new" : ""}` : ""}`,
      );
    return (
      <button
        key={room.id}
        {...roomButtonProps(room, box)}
        className={`hbx-forum${stateClass(room)}${fresh ? " is-fresh" : ""}`}
        aria-label={tileLabel(room, `, forum${preview ? `, newest thread ${preview.title}` : ""}`)}
        title={room.name}
      >
        <span className="hbx-forum-head">
          {roomIcon(room)}
          <span className="hbx-name">{room.name}</span>
          {lockFor(room)}
          {fresh ? (
            <em className="hbx-fresh">New</em>
          ) : preview ? (
            <em className="hbx-quiet">{relativeShort(preview.lastActivityAt)}</em>
          ) : null}
        </span>
        <span className="hbx-thread">
          {preview ? (
            <>
              <span className="hbx-thread-title">
                {preview.solved ? "✓ " : ""}
                {preview.title}
              </span>
              <span className="hbx-thread-meta">
                {preview.replyCount} {preview.replyCount === 1 ? "reply" : "replies"}
              </span>
            </>
          ) : preview === null ? (
            <span className="hbx-thread-title is-empty">No threads yet</span>
          ) : (
            <span className="hbx-thread-title is-empty">Open to see threads</span>
          )}
        </span>
      </button>
    );
  };

  const renderLiveVoice = (room: R, box: RoomBox<R>, participants: P[]) => {
    const sharing = participants.some((participant) => participant.screenSharing);
    const connected = props.connectedVoiceRoomId === room.id;
    return (
      <div key={room.id} className={`hbx-voice-live${connected ? " is-connected" : ""}${stateClass(room)}`}>
        <button
          {...roomButtonProps(room, box)}
          className="hbx-voice-main"
          aria-label={tileLabel(
            room,
            `, voice room, ${participants.length} connected${sharing ? ", someone is sharing their screen" : ""}${connected ? ", you are connected" : ""}`,
          )}
          title={`${room.name} · double-click to join`}
        >
          {roomIcon(room)}
          <span className="hbx-voice-copy">
            <span className="hbx-name">{room.name}</span>
            <small>
              {connected ? "You're here · " : ""}
              {participants.length} in voice{sharing ? " · sharing" : ""}
            </small>
          </span>
          {lockFor(room)}
        </button>
        <ul className="hbx-people" aria-label={`In ${room.name}`}>
          {participants.slice(0, 6).map((participant) => {
            const deafened =
              participant.deafened === true || participant.selfDeafened === true || participant.serverDeafened === true;
            const muted =
              deafened || participant.muted || participant.selfMuted === true || participant.serverMuted === true;
            return (
              <li
                key={participant.connectionId}
                className={`hbx-person user-context-target${props.isSpeaking(participant) ? " speaking" : ""}${muted ? " muted" : ""}`}
                title={`${participant.username}${deafened ? " (deafened)" : muted ? " (muted)" : ""}${participant.screenSharing ? " · sharing screen" : ""}`}
                onClick={(event) => props.onParticipantClick(event, participant)}
                onContextMenu={(event) => props.onParticipantContextMenu(event, participant)}
              >
                {props.renderAvatar(participant)}
                {participant.screenSharing && <span className="hbx-live">LIVE</span>}
              </li>
            );
          })}
          {participants.length > 6 && <li className="hbx-person hbx-more">+{participants.length - 6}</li>}
        </ul>
      </div>
    );
  };

  const homeClass = `hbx-home${props.homeSelected ? " is-selected" : ""}`;

  return (
    <div className={`channel-section hsb-rooms hbx-root hbx--${density}`} ref={scrollRef} data-density={density}>
      {props.reorderError && (
        <div className="hsb-error" role="alert">
          <span>{props.reorderError}</span>
          <button type="button" aria-label="Dismiss" onClick={props.onDismissReorderError}>
            <Icon name="close" size="sm" />
          </button>
        </div>
      )}
      <div className="hbx-homebar">
        <button
          type="button"
          className={homeClass}
          aria-current={props.homeSelected ? "page" : undefined}
          onClick={props.onOpenHome}
        >
          <span className="hbx-home-icon" aria-hidden="true">
            <Icon name="home" size="sm" />
          </span>
          <span className="hbx-name">Hub Home</span>
          {props.homeBadge > 0 && (
            <b className="hbx-badge accent" aria-label={`${props.homeBadge} rooms with new messages`}>
              {props.homeBadge > 99 ? "99+" : props.homeBadge}
            </b>
          )}
        </button>
        {props.homeActions}
      </div>
      {boxes.length === 0 && (
        <div className="hbx-empty">
          <span>{props.canManageRooms ? "This Hub has no rooms yet." : "No rooms you can see yet."}</span>
          {props.canManageRooms && (
            <button type="button" className="hbx-empty-add" onClick={() => props.onCreateRoom("text")}>
              <Icon name="plus" size="sm" />
              Create a room
            </button>
          )}
        </div>
      )}
      {boxes.map((box) => {
        const titleId = `hbx-${props.hubId}-${box.key.replace(/[^a-z0-9]+/gi, "-")}`;
        const live = box.kind === "voice" ? box.rooms.filter((room) => liveVoiceIds.has(room.id)) : [];
        const plain = box.kind === "voice" ? box.rooms.filter((room) => !liveVoiceIds.has(room.id)) : box.rooms;
        return (
          <section key={box.key} className={`hbx-box hbx-box--${box.kind}`} aria-labelledby={titleId}>
            <div className="hbx-box-head">
              <h3 className="hbx-box-title" id={titleId}>
                <span>{box.title}</span>
                <em>{box.rooms.length}</em>
              </h3>
              {props.canManageRooms &&
                (() => {
                  const type: SidebarRoomType =
                    box.kind === "forum" ? "forum" : box.kind === "voice" ? "voice" : "text";
                  const label =
                    box.kind === "forum"
                      ? "Create forum"
                      : box.kind === "voice"
                        ? "Create voice room"
                        : `Create room in ${box.title}`;
                  return (
                    <button
                      type="button"
                      className="hbx-box-add"
                      onClick={() => props.onCreateRoom(type)}
                      aria-label={label}
                      title={label}
                    >
                      <Icon name="plus" size="sm" />
                    </button>
                  );
                })()}
            </div>
            {box.kind === "forum" ? (
              <div className="hbx-forums">{box.rooms.map((room) => renderForumTile(room, box))}</div>
            ) : (
              <>
                {live.map((room) =>
                  renderLiveVoice(
                    room,
                    box,
                    props.voiceParticipants.filter((participant) => participant.channelId === room.id),
                  ),
                )}
                {plain.length > 0 && (
                  <div className="hbx-grid">
                    {plain.map((room) => renderPlainTile(room, box, box.kind === "voice" ? ", voice room, empty" : ""))}
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
