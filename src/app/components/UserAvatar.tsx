import { useEffect, useState, type CSSProperties } from "react";
import { resolveAvatarUrl } from "../user-display";

export function UserAvatar({
  username,
  avatarUrl,
  className,
  style,
}: {
  username: string;
  avatarUrl?: string | null;
  className?: string;
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  const resolved = resolveAvatarUrl(avatarUrl);

  useEffect(() => {
    setFailed(false);
  }, [resolved]);

  return (
    <div
      className={className}
      style={{
        ...style,
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
      }}
    >
      {resolved && !failed ? (
        <img
          src={resolved}
          alt={`${username} profile`}
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
        />
      ) : (
        username.charAt(0).toUpperCase()
      )}
    </div>
  );
}
