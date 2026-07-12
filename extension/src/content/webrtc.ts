// WebRTC mesh for small rooms (voice + optional video). Each pair of members
// holds one RTCPeerConnection; SDP/ICE are exchanged over the WebSocket
// signaling relay (webrtc_signal, targeted per member). For rooms larger than
// ~4-5 this should move to an SFU (LiveKit/mediasoup) — flagged as v2.
//
// Initiator rule (avoids offer glare): for a pair, the member with the larger
// userId creates the offer; the other answers. ICE candidates flow both ways.

import type { SignalPayload } from "../shared/protocol";

// Public STUN only; a TURN server is needed for symmetric-NAT peers (v2).
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export interface MeshCallbacks {
  onRemoteStream: (userId: string, stream: MediaStream) => void;
  onRemoteGone: (userId: string) => void;
  onLocalStream: (stream: MediaStream | null) => void;
}

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean; // lower userId = polite (answers)
}

export class MeshManager {
  private myUserId = "";
  private localStream: MediaStream | null = null;
  private readonly peers = new Map<string, Peer>();
  private members = new Set<string>();
  private active = false;

  constructor(
    private readonly sendSignal: (target: string, payload: SignalPayload) => void,
    private readonly cb: MeshCallbacks,
  ) {}

  setIdentity(userId: string): void {
    this.myUserId = userId;
  }

  get inCall(): boolean {
    return this.active;
  }

  // Start capturing local media and open connections to everyone present.
  async startCall(video: boolean): Promise<void> {
    if (this.active) return;
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    this.active = true;
    this.cb.onLocalStream(this.localStream);
    for (const u of this.members) this.connectTo(u);
  }

  stopCall(): void {
    this.active = false;
    for (const [u] of this.peers) this.teardown(u);
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.cb.onLocalStream(null);
  }

  // Keep the mesh in step with room membership.
  setMembers(userIds: string[]): void {
    this.members = new Set(userIds.filter((u) => u !== this.myUserId));
    if (!this.active) return;
    for (const u of this.members) if (!this.peers.has(u)) this.connectTo(u);
    for (const [u] of this.peers) if (!this.members.has(u)) this.teardown(u);
  }

  memberLeft(userId: string): void {
    this.members.delete(userId);
    this.teardown(userId);
  }

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  setCameraEnabled(on: boolean): void {
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = on));
  }

  hasVideo(): boolean {
    return (this.localStream?.getVideoTracks().length ?? 0) > 0;
  }

  private connectTo(userId: string): Peer {
    const existing = this.peers.get(userId);
    if (existing) return existing;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const polite = this.myUserId < userId;
    const peer: Peer = { pc, polite };
    this.peers.set(userId, peer);

    this.localStream?.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));

    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSignal(userId, { kind: "candidate", candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      if (e.streams[0]) this.cb.onRemoteStream(userId, e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") this.teardown(userId);
    };

    // Impolite peer (larger userId) initiates the offer.
    if (!polite) void this.makeOffer(userId, peer);
    return peer;
  }

  private async makeOffer(userId: string, peer: Peer): Promise<void> {
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.sendSignal(userId, { kind: "offer", description: peer.pc.localDescription!.toJSON() });
    } catch (e) {
      console.warn("wt: offer failed", e);
    }
  }

  async handleSignal(fromUserId: string, payload: SignalPayload): Promise<void> {
    if (!this.active) return;
    const peer = this.peers.get(fromUserId) ?? this.connectTo(fromUserId);
    const { pc } = peer;
    try {
      if (payload.kind === "offer" && payload.description) {
        await pc.setRemoteDescription(payload.description);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendSignal(fromUserId, { kind: "answer", description: pc.localDescription!.toJSON() });
      } else if (payload.kind === "answer" && payload.description) {
        await pc.setRemoteDescription(payload.description);
      } else if (payload.kind === "candidate" && payload.candidate) {
        await pc.addIceCandidate(payload.candidate).catch(() => {});
      }
    } catch (e) {
      console.warn("wt: signal handling failed", e);
    }
  }

  private teardown(userId: string): void {
    const peer = this.peers.get(userId);
    if (!peer) return;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    this.peers.delete(userId);
    this.cb.onRemoteGone(userId);
  }
}
