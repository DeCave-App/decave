import { useEffect, useState, type ReactNode } from "react";
import "../shared/shared.css";
import "./home.css";
import { Icon } from "../../components/Icon";
import { localeForLanguage } from "../../app/locale";

export type HomeFriendEntry = {
  id: string;
  username: string;
  avatar: ReactNode;
  activity?: string;
  onOpen: () => void;
};
export type HomeVoiceRoomEntry = {
  key: string;
  hubName: string;
  roomName: string;
  current: boolean;
  onJoin: () => void;
};
export type HomeEventEntry = {
  key: string;
  title: string;
  hubName: string;
  start: number;
  live: boolean;
  when: string;
  color: string;
  onOpen: () => void;
};
export type HomeHubEntry = {
  id: number;
  name: string;
  icon: ReactNode;
  online: number | null;
  unread: number;
  onOpen: () => void;
};
export type HomeMessageEntry = {
  id: string;
  username: string;
  avatar: ReactNode;
  preview: string;
  unread: number;
  onOpen: () => void;
};
export type HomeStats = { friendsOnline: number; inVoice: number; hubs: number; unreadDms: number };
export type HomeLastSession = { hubName: string; roomName: string; roomIcon: string; onOpen: () => void };
export type HomeActiveVoice = {
  hubName: string;
  roomName: string;
  people: { id: string; avatar: ReactNode; name: string }[];
  onOpen: () => void;
};

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "Late night grind";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function HomeEmpty({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="hdx-empty">
      <span className="hdx-empty-icon" aria-hidden="true">
        {icon}
      </span>
      <strong>{title}</strong>
      <small>{hint}</small>
      {action && (
        <button type="button" className="dcx-btn" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ hero */

export type HomeDashboardHeroProps = {
  username: string;
  avatar: ReactNode;
  /** Customize controls owned by the app. */
  controls: ReactNode;
  activeVoice: HomeActiveVoice | null;
  friendsOnline: number;
};

export function HomeDashboardHero(props: HomeDashboardHeroProps) {
  const subline = props.activeVoice
    ? `You're connected to ${props.activeVoice.roomName}. Your crew is waiting.`
    : props.friendsOnline > 0
      ? `${props.friendsOnline} friend${props.friendsOnline === 1 ? " is" : "s are"} online right now.`
      : "Ready when you are. Pick up where you left off.";
  return (
    <header className="hdx-hero">
      <div className="hdx-hero-main">
        <div className="hdx-avatar">{props.avatar}</div>
        <div className="hdx-hero-copy">
          <span className="hdx-kicker">My Cave · Personal dashboard</span>
          <h1>
            {greeting()}, <em>{props.username}</em>
          </h1>
          <p>{subline}</p>
        </div>
        <div className="hdx-controls">{props.controls}</div>
      </div>
    </header>
  );
}

/* --------------------------------------------------------------- widgets */

export function HomeJumpBackWidget(props: {
  lastSession: HomeLastSession | null;
  activeVoice: HomeActiveVoice | null;
  onOpenFriends: () => void;
  onDiscover: () => void;
  onCreateHub: () => void;
  onFindSquad: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="hdx-quick">
      {props.activeVoice && (
        <button type="button" className="hdx-cta live" onClick={props.activeVoice.onOpen}>
          <span className="hdx-cta-icon" aria-hidden="true">
            <Icon name="mic" />
          </span>
          <span className="hdx-cta-copy">
            <small>
              <i className="hdx-dot" aria-hidden="true" />
              Connected to voice
            </small>
            <strong>{props.activeVoice.roomName}</strong>
            <em>{props.activeVoice.hubName}</em>
          </span>
          {props.activeVoice.people.length > 0 && (
            <span className="hdx-stack" aria-label={`${props.activeVoice.people.length} in room`}>
              {props.activeVoice.people.slice(0, 4).map((person) => (
                <span key={person.id} title={person.name}>
                  {person.avatar}
                </span>
              ))}
              {props.activeVoice.people.length > 4 && <b>+{props.activeVoice.people.length - 4}</b>}
            </span>
          )}
        </button>
      )}
      {props.lastSession ? (
        <button type="button" className="hdx-cta" onClick={props.lastSession.onOpen}>
          <span className="hdx-cta-icon" aria-hidden="true">
            {props.lastSession.roomIcon}
          </span>
          <span className="hdx-cta-copy">
            <small>Jump back in</small>
            <strong>{props.lastSession.roomName}</strong>
            <em>{props.lastSession.hubName}</em>
          </span>
          <span className="hdx-cta-arrow" aria-hidden="true">
            →
          </span>
        </button>
      ) : (
        <button type="button" className="hdx-cta" onClick={props.onDiscover}>
          <span className="hdx-cta-icon" aria-hidden="true">
            🧭
          </span>
          <span className="hdx-cta-copy">
            <small>Get started</small>
            <strong>Discover Hubs</strong>
            <em>Find a community for your games</em>
          </span>
          <span className="hdx-cta-arrow" aria-hidden="true">
            →
          </span>
        </button>
      )}
      <div className="hdx-mini-actions">
        <button type="button" className="dcx-btn" onClick={props.onOpenFriends}>
          Friends
        </button>
        <button type="button" className="dcx-btn" onClick={props.onDiscover}>
          Discover
        </button>
        <button type="button" className="dcx-btn" onClick={props.onFindSquad}>
          Find a Squad
        </button>
        <button type="button" className="dcx-btn" onClick={props.onCreateHub}>
          ＋ Create Hub
        </button>
        <button type="button" className="dcx-btn" onClick={props.onOpenSettings}>
          Settings
        </button>
      </div>
    </div>
  );
}

export function HomeStatsWidget(props: {
  stats: HomeStats;
  onOpenFriends: () => void;
  onOpenVoice: () => void;
  onOpenHubs: () => void;
  onOpenDms: () => void;
}) {
  const { stats } = props;
  const tiles = [
    {
      key: "friends",
      icon: "users" as const,
      value: stats.friendsOnline,
      label: "Friends online",
      onClick: props.onOpenFriends,
      hot: stats.friendsOnline > 0,
    },
    {
      key: "voice",
      icon: "mic" as const,
      value: stats.inVoice,
      label: "People in voice",
      onClick: props.onOpenVoice,
      hot: stats.inVoice > 0,
    },
    {
      key: "hubs",
      icon: "castle" as const,
      value: stats.hubs,
      label: "Your Hubs",
      onClick: props.onOpenHubs,
      hot: false,
    },
    {
      key: "dms",
      icon: "mail" as const,
      value: stats.unreadDms,
      label: "Unread DMs",
      onClick: props.onOpenDms,
      hot: stats.unreadDms > 0,
    },
  ];
  return (
    <div className="hdx-stats">
      {tiles.map((tile) => (
        <button key={tile.key} type="button" className={`hdx-stat${tile.hot ? " hot" : ""}`} onClick={tile.onClick}>
          <span className="hdx-stat-icon" aria-hidden="true">
            <Icon name={tile.icon} />
          </span>
          <span className="hdx-stat-copy">
            <strong>{tile.value}</strong>
            <small>{tile.label}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

export function HomeFriendsWidget({
  friends,
  onOpenFriends,
}: {
  friends: HomeFriendEntry[];
  onOpenFriends: () => void;
}) {
  if (!friends.length)
    return (
      <HomeEmpty
        icon={<Icon name="users" />}
        title="Nobody online yet"
        hint="Friends light up here as soon as they connect."
        action={{ label: "Add friends", onClick: onOpenFriends }}
      />
    );
  return (
    <ul className="hdx-rows">
      {friends.slice(0, 8).map((friend) => (
        <li key={friend.id}>
          <button type="button" className="hdx-row-btn" onClick={friend.onOpen} title={`Message ${friend.username}`}>
            <span className="hdx-friend-avatar">
              {friend.avatar}
              <i aria-hidden="true" />
            </span>
            <span className="hdx-row-copy">
              <strong>{friend.username}</strong>
              <small>{friend.activity || "Online"}</small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function HomeVoiceRoomsWidget({ rooms, onDiscover }: { rooms: HomeVoiceRoomEntry[]; onDiscover: () => void }) {
  if (!rooms.length)
    return (
      <HomeEmpty
        icon={<Icon name="headphones" />}
        title="No voice rooms"
        hint="Join or create a Hub to hang out in voice."
        action={{ label: "Discover Hubs", onClick: onDiscover }}
      />
    );
  return (
    <ul className="hdx-rows">
      {rooms.slice(0, 8).map((room) => (
        <li key={room.key} className={`hdx-row${room.current ? " current" : ""}`}>
          <span className="hdx-room-icon" aria-hidden="true">
            <Icon name={room.current ? "volume" : "mic"} size="sm" />
          </span>
          <span className="hdx-row-copy">
            <strong>{room.roomName}</strong>
            <small>{room.current ? `Connected · ${room.hubName}` : room.hubName}</small>
          </span>
          <button
            type="button"
            className={`dcx-btn hdx-join${room.current ? "" : " dcx-btn-primary"}`}
            onClick={room.onJoin}
          >
            {room.current ? "Open" : "Join"}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function HomeEventsWidget({
  events,
  busy,
  notice,
}: {
  events: HomeEventEntry[];
  busy: boolean;
  notice?: string;
}) {
  return (
    <>
      {events.length ? (
        <ul className="hdx-rows">
          {events.slice(0, 6).map((event) => {
            const d = new Date(event.start);
            return (
              <li key={event.key}>
                <button
                  type="button"
                  className="hdx-row-btn"
                  style={{ ["--hdx-color" as string]: event.color }}
                  onClick={event.onOpen}
                >
                  <span className="hdx-date">
                    <strong>{d.toLocaleDateString(localeForLanguage(), { day: "2-digit" })}</strong>
                    <small>{d.toLocaleDateString(localeForLanguage(), { month: "short" }).toUpperCase()}</small>
                  </span>
                  <span className="hdx-row-copy">
                    <strong>{event.title}</strong>
                    <small>
                      {event.hubName} · {event.live ? <b className="hdx-live-pill">Live now</b> : event.when}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : busy ? (
        <HomeEmpty
          icon={<Icon name="refresh" />}
          title="Syncing events"
          hint="Checking your Hubs for scheduled sessions."
        />
      ) : (
        <HomeEmpty
          icon={<Icon name="calendar" />}
          title="Nothing scheduled"
          hint="Raid nights, tournaments and hangouts from your Hubs show up here."
        />
      )}
      {notice && (
        <small className="hdx-notice" role="status">
          {notice}
        </small>
      )}
    </>
  );
}

export function HomeHubsWidget({ hubs, onCreateHub }: { hubs: HomeHubEntry[]; onCreateHub: () => void }) {
  if (!hubs.length)
    return (
      <HomeEmpty
        icon={<Icon name="compass" />}
        title="No Hubs yet"
        hint="Create your own or find a community to join."
        action={{ label: "＋ Create Hub", onClick: onCreateHub }}
      />
    );
  return (
    <ul className="hdx-rows">
      {hubs.slice(0, 8).map((hub) => (
        <li key={hub.id}>
          <button type="button" className="hdx-row-btn" onClick={hub.onOpen} title={hub.name}>
            <span className="hdx-hub-icon">
              {hub.icon}
              {hub.unread > 0 && <b>{hub.unread > 99 ? "99+" : hub.unread}</b>}
            </span>
            <span className="hdx-row-copy">
              <strong>{hub.name}</strong>
              <small>{hub.online === null ? "Membership private" : `${hub.online} online`}</small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function HomeMessagesWidget({ messages, onOpenDms }: { messages: HomeMessageEntry[]; onOpenDms: () => void }) {
  if (!messages.length)
    return (
      <HomeEmpty
        icon={<Icon name="mail" />}
        title="No recent DMs"
        hint="Your latest conversations stay close here."
        action={{ label: "Open messages", onClick: onOpenDms }}
      />
    );
  return (
    <ul className="hdx-rows">
      {messages.slice(0, 6).map((entry) => (
        <li key={entry.id}>
          <button type="button" className="hdx-row-btn" onClick={entry.onOpen}>
            <span className="hdx-friend-avatar plain">{entry.avatar}</span>
            <span className="hdx-row-copy">
              <strong>{entry.username}</strong>
              <small>{entry.preview}</small>
            </span>
            {entry.unread > 0 && <b className="hdx-unread">{entry.unread > 99 ? "99+" : entry.unread}</b>}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function HomeNowPlayingWidget({
  game,
  icon,
  source,
  elapsed,
}: {
  game: string | null;
  icon: string | null;
  source: string;
  elapsed: string;
}) {
  if (!game)
    return (
      <HomeEmpty
        icon={<Icon name="gamepad" />}
        title="No game detected"
        hint="Launch a supported game and DeCave updates this automatically."
      />
    );
  return (
    <div className="hdx-playing">
      <span className="hdx-playing-art">{icon ? <img src={icon} alt="" /> : <span aria-hidden="true">▶</span>}</span>
      <span className="hdx-row-copy">
        <small className="hdx-playing-kicker">
          <i className="hdx-dot" aria-hidden="true" />
          Playing now
        </small>
        <strong>{game}</strong>
        <small>
          {source}
          {elapsed ? ` · ${elapsed}` : ""}
        </small>
      </span>
    </div>
  );
}

export function HomeProfileWidget({
  avatar,
  username,
  status,
  color,
  onEdit,
}: {
  avatar: ReactNode;
  username: string;
  status: string;
  color: string;
  onEdit: () => void;
}) {
  return (
    <div className="hdx-profile">
      <span className="hdx-friend-avatar plain">
        {avatar}
        <i aria-hidden="true" style={{ background: color }} />
      </span>
      <span className="hdx-row-copy">
        <strong>{username}</strong>
        <small>{status}</small>
      </span>
      <button type="button" className="hdx-link" onClick={onEdit}>
        Edit
      </button>
    </div>
  );
}

export function HomeClockWidget({ hour12 }: { hour12?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const time = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(hour12 === undefined ? {} : { hour12 }),
  });
  return (
    <div className="hdx-clock">
      <strong>
        <time dateTime={now.toISOString()}>{time}</time>
      </strong>
      <small>{now.toLocaleDateString(localeForLanguage(), { weekday: "long", month: "long", day: "numeric" })}</small>
    </div>
  );
}

export function HomeNotesWidget({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <textarea
      className="hdx-notes dcx-input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Keep a quick note here…"
      maxLength={1200}
      aria-label="Notes"
    />
  );
}
