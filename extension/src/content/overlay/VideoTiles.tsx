import { useEffect, useRef, useState } from "react";
import { useCallStore, type CallControls, type Tile } from "./callStore";

// Draggable PiP panel showing local + remote video/audio tiles and controls.
export function VideoTiles({ controls }: { controls: CallControls }) {
  const { inCall, connecting, tiles, muted, cameraOn, hasVideo, error } = useCallStore();
  const pos = useDrag({ x: 20, y: 20 });

  if (!inCall && !connecting) return null;

  return (
    <div className="wt-call" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
      <div className="wt-call-head" onPointerDown={pos.onPointerDown}>
        <span>Voice{hasVideo ? " + Video" : ""}</span>
        <span className="wt-muted">{connecting ? "connecting…" : `${tiles.length} in call`}</span>
      </div>
      {error && <div className="wt-err wt-call-err">{error}</div>}
      <div className="wt-tiles">
        {tiles.map((t) => (
          <VideoTile key={t.userId} tile={t} />
        ))}
      </div>
      <div className="wt-call-controls">
        <button className={muted ? "wt-cc wt-cc-off" : "wt-cc"} onClick={controls.toggleMute} title="Mute">
          {muted ? "🔇" : "🎙️"}
        </button>
        <button
          className="wt-cc"
          onPointerDown={() => controls.pushToTalk(true)}
          onPointerUp={() => controls.pushToTalk(false)}
          onPointerLeave={() => controls.pushToTalk(false)}
          title="Push to talk"
        >
          🅟🆃🆃
        </button>
        {hasVideo && (
          <button className={cameraOn ? "wt-cc" : "wt-cc wt-cc-off"} onClick={controls.toggleCamera} title="Camera">
            {cameraOn ? "📷" : "🚫"}
          </button>
        )}
        <button className="wt-cc wt-cc-leave" onClick={controls.leaveCall} title="Leave call">
          📞
        </button>
      </div>
    </div>
  );
}

function VideoTile({ tile }: { tile: Tile }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== tile.stream) ref.current.srcObject = tile.stream;
  }, [tile.stream]);
  const hasVideo = tile.stream.getVideoTracks().some((t) => t.enabled);
  return (
    <div className="wt-tile">
      <video ref={ref} autoPlay playsInline muted={tile.isLocal} className={hasVideo ? "" : "wt-tile-hidden"} />
      {!hasVideo && <div className="wt-tile-avatar">{initial(tile.name)}</div>}
      <span className="wt-tile-name">{tile.name}{tile.isLocal ? " (you)" : ""}</span>
    </div>
  );
}

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

// Minimal pointer-based drag returning a live translate offset.
function useDrag(initial: { x: number; y: number }) {
  const [pos, setPos] = useState(initial);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      setPos({ x: drag.current.ox + (e.clientX - drag.current.sx), y: drag.current.oy + (e.clientY - drag.current.sy) });
    };
    const up = () => (drag.current = null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  return {
    x: pos.x,
    y: pos.y,
    onPointerDown: (e: React.PointerEvent) => {
      drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    },
  };
}
