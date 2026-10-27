'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { EVENTS } from '@olw/shared';
import { api, relUrl } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { fmtDuration } from '@/lib/format';
import { useSocket } from './SocketProvider';
import { useToast } from './Toast';
import { Avatar, Button } from './ui';

const CallContext = createContext({ startCall: async () => {}, busy: false });

const CONNECT_TIMEOUT_MS = 30 * 1000;
const RECONNECT_GRACE_MS = 12 * 1000;

const friendly = (message) => Object.assign(new Error(message), { friendly: true });

/** Turns the browser's cryptic media errors into something a person can act on. */
function describeError(err) {
  if (err?.friendly) return err.message;
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Microphone or camera access is blocked. Click the lock icon next to the address bar, allow Microphone and Camera for this site, then try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found on this device.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Your microphone or camera is being used by another app. Close it and try again.';
    default:
      return err?.message || 'The call could not be started. Please try again.';
  }
}

/** Mic (and camera for video calls). Falls back to voice-only when no camera can be opened. */
async function getMedia(kind) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw friendly('Calls need a secure connection. Open this site with https:// (or on localhost) and try again.');
  }
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (kind !== 'video') return { stream: await navigator.mediaDevices.getUserMedia({ audio }), videoDropped: false };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    return { stream, videoDropped: false };
  } catch (err) {
    if (!['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError', 'NotReadableError'].includes(err?.name)) throw err;
    return { stream: await navigator.mediaDevices.getUserMedia({ audio }), videoDropped: true };
  }
}

const statusText = (phase) =>
  ({ preparing: 'Getting ready…', outgoing: 'Calling…', connecting: 'Connecting…', reconnecting: 'Reconnecting…' })[phase];

/**
 * Peer-to-peer WebRTC calls. Signalling runs over Socket.IO in a per-call room that the server only
 * lets you join with a short-lived token bound to you + that call + that space.
 *
 * Order matters for reliability: the microphone/camera is opened BEFORE anything is created on the
 * server, so a denied permission never leaves a phantom "call in progress" behind; and any failure
 * after the call exists ends it on the server too.
 */
export function CallLayer({ children }) {
  const socket = useSocket();
  const toast = useToast();
  const queryClient = useQueryClient();
  // { phase: preparing|incoming|outgoing|connecting|live|reconnecting, role, rid, callId, kind, name, startedAt }
  const [call, setCallState] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [now, setNow] = useState(0);
  const pcRef = useRef(null);
  const localRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pendingIce = useRef([]);
  const offered = useRef(false);
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  // Socket handlers need the latest call synchronously, so state and ref are updated together.
  const callRef = useRef(null);
  const setCall = useCallback((update) => {
    const next = typeof update === 'function' ? update(callRef.current) : update;
    callRef.current = next;
    setCallState(next);
  }, []);

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    remoteStreamRef.current = null;
    pendingIce.current = [];
    offered.current = false;
    setMuted(false);
    setCameraOff(false);
    setHasVideo(false);
    const rid = callRef.current?.rid;
    setCall(null);
    if (rid) queryClient.invalidateQueries({ queryKey: qk.section(rid, 'calls') });
  }, [queryClient, setCall]);

  const signal = useCallback((callId, data) => socket?.emit(EVENTS.CALL_SIGNAL, { callId, data }), [socket]);

  /** Tell the server this call is over (socket first, HTTP as a fallback). Safe to call twice. */
  const endOnServer = useCallback(
    async (rid, callId) => {
      if (!callId) return;
      const ack = socket ? await socket.timeout(3000).emitWithAck(EVENTS.CALL_END, { callId }).catch(() => null) : null;
      if (!ack?.ok) await api.post(relUrl(rid, `/calls/${callId}/end`)).catch(() => {});
    },
    [socket],
  );

  /** Ends the call everywhere (closes the screen immediately, then tells the server). */
  const hangUp = useCallback(() => {
    const c = callRef.current;
    cleanup();
    if (c?.callId) endOnServer(c.rid, c.callId);
  }, [cleanup, endOnServer]);

  const attachLocal = useCallback((stream) => {
    localRef.current = stream;
    setHasVideo(stream.getVideoTracks().length > 0);
    if (localVideo.current) localVideo.current.srcObject = stream;
  }, []);

  const sendOffer = useCallback(
    async (callId) => {
      const pc = pcRef.current;
      if (!pc || offered.current) return;
      offered.current = true;
      setCall((c) => (c ? { ...c, phase: c.phase === 'live' ? c.phase : 'connecting' } : c));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signal(callId, { type: 'offer', sdp: offer.sdp });
    },
    [signal, setCall],
  );

  const buildPeer = useCallback(
    (callId, stream, iceServers) => {
      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.onicecandidate = (e) => e.candidate && signal(callId, { type: 'candidate', candidate: e.candidate.toJSON() });
      pc.ontrack = (e) => {
        remoteStreamRef.current = e.streams[0];
        const el = remoteVideo.current;
        if (el) {
          el.srcObject = e.streams[0];
          el.play?.().catch(() => {});
        }
      };
      pc.onconnectionstatechange = () => {
        if (pcRef.current !== pc) return;
        if (pc.connectionState === 'connected') {
          setCall((c) => (c ? { ...c, phase: 'live', startedAt: c.startedAt ?? Date.now() } : c));
        } else if (pc.connectionState === 'disconnected') {
          setCall((c) => (c && c.phase === 'live' ? { ...c, phase: 'reconnecting' } : c));
        } else if (pc.connectionState === 'failed') {
          toast('The connection was lost. Check your internet and try again.', { tone: 'error' });
          hangUp();
        }
      };
      return pc;
    },
    [signal, setCall, toast, hangUp],
  );

  const join = useCallback(
    async (callId, token) => {
      const res = await socket.timeout(5000).emitWithAck(EVENTS.CALL_JOIN, { callId, token });
      if (!res?.ok) throw new Error(res?.error?.message ?? 'Could not join the call');
      return res;
    },
    [socket],
  );

  const startCall = useCallback(
    async (rid, kind, name) => {
      if (callRef.current || !socket) return;
      setCall({ phase: 'preparing', role: 'caller', rid, kind, name });
      let created = null;
      try {
        const { stream, videoDropped } = await getMedia(kind);
        if (!callRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return; // cancelled while the permission prompt was open
        }
        attachLocal(stream);
        const effectiveKind = videoDropped ? 'audio' : kind;
        if (videoDropped) toast('No camera available, so this will be a voice call.');
        const res = await api.post(relUrl(rid, '/calls'), { kind: effectiveKind });
        created = res.call;
        if (!callRef.current) {
          endOnServer(rid, created.id); // cancelled while the call was being created
          return;
        }
        setCall((c) => ({ ...c, phase: 'outgoing', callId: created.id, kind: effectiveKind }));
        buildPeer(created.id, stream, res.iceServers);
        const ack = await join(created.id, res.token);
        if (ack.peers > 0) await sendOffer(created.id); // the other side was already waiting
      } catch (err) {
        toast(describeError(err), { tone: 'error' });
        if (created) endOnServer(rid, created.id);
        cleanup();
      }
    },
    [socket, setCall, attachLocal, buildPeer, join, sendOffer, toast, endOnServer, cleanup],
  );

  const accept = useCallback(async () => {
    const c = callRef.current;
    if (!c) return;
    setCall({ ...c, phase: 'connecting', role: 'callee' });
    try {
      const { stream } = await getMedia(c.kind);
      if (!callRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      attachLocal(stream);
      const { token, iceServers } = await api.post(relUrl(c.rid, `/calls/${c.callId}/token`));
      buildPeer(c.callId, stream, iceServers);
      await join(c.callId, token);
    } catch (err) {
      toast(describeError(err), { tone: 'error' });
      // Could not take the call: say so properly instead of leaving the caller ringing.
      await api.post(relUrl(c.rid, `/calls/${c.callId}/decline`)).catch(() => {});
      cleanup();
    }
  }, [setCall, attachLocal, buildPeer, join, toast, cleanup]);

  const decline = useCallback(async () => {
    const c = callRef.current;
    cleanup();
    if (c) await api.post(relUrl(c.rid, `/calls/${c.callId}/decline`)).catch(() => {});
  }, [cleanup]);

  useEffect(() => {
    if (!socket) return undefined;
    const onIncoming = (p) => {
      if (callRef.current) return; // already busy
      setCall({ phase: 'incoming', role: 'callee', rid: p.relationshipId, callId: p.callId, kind: p.kind, name: p.fromName });
    };
    const onPeerJoined = ({ callId }) => {
      const c = callRef.current;
      if (c?.callId === callId && c.role === 'caller') sendOffer(callId).catch(() => {});
    };
    const onSignal = async ({ callId, data }) => {
      const pc = pcRef.current;
      if (!pc || callRef.current?.callId !== callId || !data) return;
      try {
        if (data.type === 'offer') {
          await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
          for (const c of pendingIce.current.splice(0)) await pc.addIceCandidate(c).catch(() => {});
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signal(callId, { type: 'answer', sdp: answer.sdp });
        } else if (data.type === 'answer') {
          await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
          for (const c of pendingIce.current.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        } else if (data.type === 'candidate') {
          if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
          else pendingIce.current.push(data.candidate);
        }
      } catch {
        /* a stale or duplicate signal; the connection-state handler reports real failures */
      }
    };
    const onEnded = ({ callId, status }) => {
      const c = callRef.current;
      if (c?.callId !== callId) return;
      if (status === 'declined') toast('Call declined');
      else if (status === 'missed') toast(c.phase === 'incoming' ? 'Missed call' : 'No answer');
      else if (c.phase === 'live' || c.phase === 'reconnecting') toast('Call ended');
      cleanup();
    };
    // After a dropped connection the socket comes back without its call room: rejoin so the call survives.
    const onReconnect = async () => {
      const c = callRef.current;
      if (!c?.callId || c.phase === 'incoming' || c.phase === 'preparing') return;
      try {
        const { token } = await api.post(relUrl(c.rid, `/calls/${c.callId}/token`));
        await join(c.callId, token);
      } catch {
        /* the call may already be over; CALL_ENDED will tidy up */
      }
    };
    socket.on(EVENTS.CALL_INCOMING, onIncoming);
    socket.on(EVENTS.CALL_PEER_JOINED, onPeerJoined);
    socket.on(EVENTS.CALL_SIGNAL, onSignal);
    socket.on(EVENTS.CALL_ENDED, onEnded);
    socket.on('connect', onReconnect);
    return () => {
      socket.off(EVENTS.CALL_INCOMING, onIncoming);
      socket.off(EVENTS.CALL_PEER_JOINED, onPeerJoined);
      socket.off(EVENTS.CALL_SIGNAL, onSignal);
      socket.off(EVENTS.CALL_ENDED, onEnded);
      socket.off('connect', onReconnect);
    };
  }, [socket, signal, sendOffer, join, cleanup, toast, setCall]);

  // Closing or reloading the tab during a call must not leave it running on the server.
  useEffect(() => {
    const onLeave = () => {
      const c = callRef.current;
      if (c?.callId && socket) socket.emit(EVENTS.CALL_END, { callId: c.callId });
    };
    window.addEventListener('pagehide', onLeave);
    return () => window.removeEventListener('pagehide', onLeave);
  }, [socket]);

  // Never hang forever on "Connecting…" or "Reconnecting…".
  useEffect(() => {
    const phase = call?.phase;
    if (phase !== 'connecting' && phase !== 'reconnecting') return undefined;
    const t = setTimeout(
      () => {
        toast(phase === 'connecting' ? 'Could not connect the call. Check your internet and try again.' : 'The call dropped.', { tone: 'error' });
        hangUp();
      },
      phase === 'connecting' ? CONNECT_TIMEOUT_MS : RECONNECT_GRACE_MS,
    );
    return () => clearTimeout(t);
  }, [call?.phase, toast, hangUp]);

  useEffect(() => {
    if (call?.phase !== 'live') return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [call?.phase]);

  // Re-attach streams when the overlay (re)mounts the video elements.
  useEffect(() => {
    if (localVideo.current && localRef.current) localVideo.current.srcObject = localRef.current;
    if (remoteVideo.current && remoteStreamRef.current) remoteVideo.current.srcObject = remoteStreamRef.current;
  });

  const toggleMute = () => {
    localRef.current?.getAudioTracks().forEach((t) => (t.enabled = muted));
    setMuted(!muted);
  };
  const toggleCamera = () => {
    localRef.current?.getVideoTracks().forEach((t) => (t.enabled = cameraOff));
    setCameraOff(!cameraOff);
  };

  const value = useMemo(() => ({ startCall, busy: Boolean(call) }), [startCall, call]);
  const inCall = call && call.phase !== 'incoming';
  const label = statusText(call?.phase) ?? fmtDuration(Math.max(0, now - (call?.startedAt ?? now)) / 1000);

  return (
    <CallContext.Provider value={value}>
      {children}
      {call?.phase === 'incoming' && (
        <div className="fixed inset-x-0 top-4 z-[70] flex justify-center px-4">
          <div className="glass animate-pop-in flex w-full max-w-sm items-center gap-4 rounded-3xl bg-surface-solid p-4">
            <span className="animate-ring rounded-full">
              <Avatar name={call.name} size={52} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-xl">{call.name}</p>
              <p className="text-sm text-ink-soft">Incoming {call.kind} call…</p>
            </div>
            <Button variant="danger" size="icon" onClick={decline} aria-label="Decline">
              <PhoneOff className="h-5 w-5" />
            </Button>
            <Button size="icon" className="!bg-emerald-600" onClick={accept} aria-label="Accept">
              {call.kind === 'video' ? <Video className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      )}
      {inCall && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-[#12060c] text-white">
          <div className="relative flex-1 overflow-hidden">
            {call.kind === 'video' ? (
              <video ref={remoteVideo} autoPlay playsInline className="h-full w-full object-cover" />
            ) : (
              <audio ref={remoteVideo} autoPlay playsInline />
            )}
            {(call.kind !== 'video' || call.phase !== 'live') && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
                <span className={call.phase === 'live' ? '' : 'animate-ring rounded-full'}>
                  <Avatar name={call.name} size={112} />
                </span>
                <p className="font-display text-4xl">{call.name}</p>
                <p className="text-white/70">{label}</p>
              </div>
            )}
            {call.kind === 'video' && call.phase === 'live' && (
              <p className="absolute left-4 top-4 rounded-full bg-black/40 px-3 py-1 text-sm backdrop-blur">{label}</p>
            )}
            {call.kind === 'video' && hasVideo && (
              <video ref={localVideo} autoPlay playsInline muted className="absolute bottom-4 right-4 h-40 w-28 rounded-2xl object-cover ring-2 ring-white/30 sm:h-48 sm:w-36" />
            )}
          </div>
          <div className="flex items-center justify-center gap-5 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <Button variant="outline" size="icon" className="!h-14 !w-14 !border-white/30 !text-white" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
              {muted ? <MicOff /> : <Mic />}
            </Button>
            {call.kind === 'video' && hasVideo && (
              <Button variant="outline" size="icon" className="!h-14 !w-14 !border-white/30 !text-white" onClick={toggleCamera} aria-label={cameraOff ? 'Camera on' : 'Camera off'}>
                {cameraOff ? <VideoOff /> : <Video />}
              </Button>
            )}
            <Button variant="danger" size="icon" className="!h-16 !w-16" onClick={hangUp} aria-label="End call">
              <PhoneOff />
            </Button>
          </div>
        </div>
      )}
    </CallContext.Provider>
  );
}

export const useCall = () => useContext(CallContext);
