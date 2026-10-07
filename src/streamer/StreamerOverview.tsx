import { useEffect, useRef } from "react";
import { mountStreamerOverview, type StreamerOverviewOptions } from "./controller";
import "./streamer-overview.css";

/** Only mount this inside the existing primary workspace; key by authenticated
 * account + hub so no previous account's/Hub's snapshot can survive navigation. */
export function StreamerOverview(props: StreamerOverviewOptions) {
  const root = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof mountStreamerOverview> | null>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    if (!root.current) return;
    const instance = mountStreamerOverview(root.current, latest.current);
    controller.current = instance;
    return () => {
      instance.destroy();
      if (controller.current === instance) controller.current = null;
    };
  }, [props.hubId, props.accountId]);
  useEffect(() => {
    controller.current?.update(props);
  });
  return <div className="dc-streamer-mount" ref={root} />;
}
