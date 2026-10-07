import { useEffect, useRef, useState } from "react";

type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

/** Play a short two-note chime through the chosen output device. */
async function playSpeakerTest(outputDeviceId: string, volume: number): Promise<void> {
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const gain = context.createGain();
  gain.gain.value = 0.0001;
  gain.connect(destination);
  const now = context.currentTime;
  [523.25, 783.99].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start(now + index * 0.28);
    oscillator.stop(now + index * 0.28 + 0.5);
  });
  gain.gain.exponentialRampToValueAtTime(0.35, now + 0.03);
  gain.gain.setValueAtTime(0.35, now + 0.6);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
  const audio = new Audio() as SinkAudio;
  audio.srcObject = destination.stream;
  audio.volume = Math.max(0, Math.min(1, volume / 100));
  if (outputDeviceId && audio.setSinkId) await audio.setSinkId(outputDeviceId).catch(() => undefined);
  await audio.play();
  window.setTimeout(() => {
    audio.pause();
    audio.srcObject = null;
    void context.close();
  }, 1200);
}

type OutputProps = {
  outputDeviceId: string;
  volume: number;
  onVolume: (volume: number) => void;
};

/** Settings → Voice: master volume for everyone you hear, plus a speaker test. */
export function OutputPanel({ outputDeviceId, volume, onVolume }: OutputProps) {
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const test = async () => {
    setTesting(true);
    setError("");
    try {
      await playSpeakerTest(outputDeviceId, volume);
    } catch {
      setError("Could not play the test sound on this device.");
    }
    window.setTimeout(() => setTesting(false), 1200);
  };
  return (
    <div className="settings-audio-panel settings-audio-panel-wide">
      <div className="settings-audio-panel-title">
        <span>Output</span>
        <small>How loud other people are, and a quick check that sound reaches your speakers or headset</small>
      </div>
      <div className="settings-audio-slider-block">
        <div className="settings-audio-row">
          <div>
            <strong>Output volume</strong>
            <small>Applies to everyone in voice. Per-person volumes are set on top of this.</small>
          </div>
          <b>{volume}%</b>
        </div>
        <input
          className="settings-range"
          type="range"
          min="0"
          max="200"
          step="5"
          value={volume}
          onChange={(event) => onVolume(Number(event.target.value))}
          aria-label="Output volume"
        />
      </div>
      <div className="dcs-card-actions">
        <button type="button" className="modal-secondary" disabled={testing} onClick={() => void test()}>
          {testing ? "Playing…" : "Test speakers"}
        </button>
        {error && <span className="dcs-error">{error}</span>}
      </div>
    </div>
  );
}

type CameraProps = {
  cameraDeviceId: string;
  onCameraDevice: (deviceId: string) => void;
};

/** Settings → Voice: choose a camera and preview it before going live. */
export function CameraPanel({ cameraDeviceId, onCameraDevice }: CameraProps) {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const refresh = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter((device) => device.kind === "videoinput"));
    } catch {
      setCameras([]);
    }
  };

  const stop = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setPreviewing(false);
  };

  const start = async (deviceId = cameraDeviceId) => {
    stop();
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => undefined);
      }
      setPreviewing(true);
      void refresh(); // Labels appear once permission is granted.
    } catch {
      setError(
        "DeCave couldn't open that camera. Check that no other app is using it and that camera access is allowed.",
      );
    }
  };

  useEffect(() => {
    void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
      stop();
    };
  }, []);

  return (
    <div className="settings-audio-panel settings-audio-panel-wide">
      <div className="settings-audio-panel-title">
        <span>Camera</span>
        <small>Used when you turn your camera on in a voice room</small>
      </div>
      <div className="dcs-camera">
        <div className="dcs-camera-preview">
          <video ref={videoRef} muted playsInline aria-label="Camera preview" />
          {!previewing && <span>Preview is off</span>}
        </div>
        <div className="dcs-camera-controls">
          <label className="settings-field">
            <span>Camera</span>
            <select
              value={cameraDeviceId}
              onChange={(event) => {
                onCameraDevice(event.target.value);
                if (previewing) void start(event.target.value);
              }}
            >
              <option value="">Default camera</option>
              {cameras.map((camera, index) => (
                <option key={camera.deviceId || index} value={camera.deviceId}>
                  {camera.label || `Camera ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="modal-secondary" onClick={() => (previewing ? stop() : void start())}>
            {previewing ? "Stop preview" : "Preview camera"}
          </button>
          {error && <p className="dcs-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}

export type UserVolumeRow = { userId: string; name: string; volume: number };

type VolumesProps = {
  rows: readonly UserVolumeRow[];
  onReset: (userId: string) => void;
  onResetAll: () => void;
};

/** Settings → Voice: people whose volume you changed from the voice menu. */
export function UserVolumesPanel({ rows, onReset, onResetAll }: VolumesProps) {
  return (
    <div className="settings-audio-panel settings-audio-panel-wide">
      <div className="settings-audio-panel-title">
        <span>Per-person volume</span>
        <small>Right-click someone in a voice room to make them louder or quieter</small>
      </div>
      {rows.length === 0 ? (
        <p className="dcs-muted">Everyone is at the normal volume.</p>
      ) : (
        <>
          <ul className="dcs-list">
            {rows.map((row) => (
              <li key={row.userId} className="dcs-list-row">
                <span className="dcs-initial" aria-hidden="true">
                  {row.name.charAt(0).toUpperCase()}
                </span>
                <span className="dcs-list-copy">
                  <strong>{row.name}</strong>
                  <small>{row.volume === 0 ? "Muted for you" : `${row.volume}%`}</small>
                </span>
                <button type="button" className="modal-secondary" onClick={() => onReset(row.userId)}>
                  Reset
                </button>
              </li>
            ))}
          </ul>
          <div className="dcs-card-actions">
            <button type="button" className="modal-secondary" onClick={onResetAll}>
              Reset everyone
            </button>
          </div>
        </>
      )}
    </div>
  );
}
