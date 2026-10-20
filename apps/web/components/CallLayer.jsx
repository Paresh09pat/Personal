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

/**
 * Peer-to-peer WebRTC calls. Signalling runs over Socket.IO in a per-call room that the server only
 * lets you join with a short-lived token bound to you + that call + that space.
 */
export function CallLayer({ children }) {
  const socket = useSocket();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [call, setCallState] = useState(null); // { phase, rid, callId, kind, name, startedAt }
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [now, setNow] = useState(0);
  const pcRef = useRef(null);
  const localRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pendingIce = useRef([]);
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
    setMuted(false);
    setCameraOff(false);
    const rid = callRef.current?.rid;
    setCall(null);
    if (rid) queryClient.invalidateQueries({ queryKey: qk.section(rid, 'calls') });
  }, [queryClient, setCall]);

  const signal = useCallback(
    (callId, data) => socket?.emit(EVENTS.CALL_SIGNAL, { callId, data }),
    [socket],
  );

  const setupPeer = useCallback(
    async (callId, kind, iceServers) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' });
      localRef.current = stream;
      if (localVideo.current) localVideo.current.srcObject = stream;
      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.onicecandidate = (e) => e.candidate && signal(callId, { type: 'candidate', candidate: e.candidate.toJSON() });
      pc.ontrack = (e) => {
        remoteStreamRef.current = e.streams[0];
        if (remoteVideo.current) remoteVideo.current.srcObject = e.streams[0];
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') setCall((c) => (c ? { ...c, phase: 'live', startedAt: c.startedAt ?? Date.now() } : c));
        if (['failed', 'closed'].includes(pc.connectionState)) cleanup();
      };
      return pc;
    },
    [signal, cleanup, setCall],
  );

  const join = useCallback(
    async (callId, token) => {
      const res = await socket.timeout(5000).emitWithAck(EVENTS.CALL_JOIN, { callId, token });
      if (!res.ok) throw new Error(res.error?.message ?? 'Could not join the call');
    },
    [socket],
  );

  const startCall = useCallback(
    async (rid, kind, name) => {
      if (callRef.current || !socket) return;
      try {
        const { call: c, token, iceServers } = await api.post(relUrl(rid, '/calls'), { kind });
        setCall({ phase: 'outgoing', rid, callId: c.id, kind, name });
        await setupPeer(c.id, kind, iceServers);
        await join(c.id, token);
      } catch (err) {
        toast(err.message ?? 'Call failed', { tone: 'error' });
        cleanup();
      }
    },
    [socket, setupPeer, join, toast, cleanup, setCall],
  );

  const accept = useCallback(async () => {
    const c = callRef.current;
    if (!c) return;
    try {
      setCall({ ...c, phase: 'connecting' });
      const { token, iceServers } = await api.post(relUrl(c.rid, `/calls/${c.callId}/token`));
      await setupPeer(c.callId, c.kind, iceServers);
      await join(c.callId, token);
    } catch (err) {
      toast(err.message ?? 'Could not connect', { tone: 'error' });
      cleanup();
    }
  }, [setupPeer, join, toast, cleanup, setCall]);

  const decline = useCallback(async () => {
    const c = callRef.current;
    if (c) await api.post(relUrl(c.rid, `/calls/${c.callId}/decline`)).catch(() => {});
    cleanup();
  }, [cleanup]);

  const hangUp = useCallback(() => {
    const c = callRef.current;
    if (c && socket) socket.emit(EVENTS.CALL_END, { callId: c.callId });
    else if (c) api.post(relUrl(c.rid, `/calls/${c.callId}/end`)).catch(() => {});
    cleanup();
  }, [socket, cleanup]);

  useEffect(() => {
    if (!socket) return undefined;
    const onIncoming = (p) => {
      if (callRef.current) return; // already busy
      setCall({ phase: 'incoming', rid: p.relationshipId, callId: p.callId, kind: p.kind, name: p.fromName });
    };
    const onPeerJoined = async ({ callId }) => {
      const pc = pcRef.current;
      if (!pc || callRef.current?.callId !== callId || callRef.current.phase !== 'outgoing') return;
      setCall((c) => ({ ...c, phase: 'connecting' }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signal(callId, { type: 'offer', sdp: offer.sdp });
    };
    const onSignal = async ({ callId, data }) => {
      const pc = pcRef.current;
      if (!pc || callRef.current?.callId !== callId || !data) return;
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
    };
    const onEnded = ({ callId, status }) => {
      if (callRef.current?.callId !== callId) return;
      if (status === 'declined') toast('Call declined');
      if (status === 'missed' && callRef.current.phase === 'outgoing') toast('No answer');
      cleanup();
    };
    socket.on(EVENTS.CALL_INCOMING, onIncoming);
    socket.on(EVENTS.CALL_PEER_JOINED, onPeerJoined);
    socket.on(EVENTS.CALL_SIGNAL, onSignal);
    socket.on(EVENTS.CALL_ENDED, onEnded);
    return () => {
      socket.off(EVENTS.CALL_INCOMING, onIncoming);
      socket.off(EVENTS.CALL_PEER_JOINED, onPeerJoined);
      socket.off(EVENTS.CALL_SIGNAL, onSignal);
      socket.off(EVENTS.CALL_ENDED, onEnded);
    };
  }, [socket, signal, cleanup, toast, setCall]);

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
              <p className="font-display text-xl">{call.name}</p>
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
      {call && call.phase !== 'incoming' && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-[#12060c] text-white">
          <div className="relative flex-1 overflow-hidden">
            {call.kind === 'video' ? (
              <video ref={remoteVideo} autoPlay playsInline className="h-full w-full object-cover" />
            ) : (
              <audio ref={remoteVideo} autoPlay />
            )}
            {(call.kind !== 'video' || call.phase !== 'live') && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                <span className={call.phase === 'live' ? '' : 'animate-ring rounded-full'}>
                  <Avatar name={call.name} size={112} />
                </span>
                <p className="font-display text-4xl">{call.name}</p>
                <p className="text-white/70">
                  {call.phase === 'outgoing' ? 'Calling…' : call.phase === 'connecting' ? 'Connecting…' : fmtDuration(Math.max(0, now - call.startedAt) / 1000)}
                </p>
              </div>
            )}
            {call.kind === 'video' && (
              <video ref={localVideo} autoPlay playsInline muted className="absolute bottom-4 right-4 h-40 w-28 rounded-2xl object-cover ring-2 ring-white/30 sm:h-48 sm:w-36" />
            )}
          </div>
          <div className="flex items-center justify-center gap-5 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <Button variant="outline" size="icon" className="!h-14 !w-14 !border-white/30 !text-white" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
              {muted ? <MicOff /> : <Mic />}
            </Button>
            {call.kind === 'video' && (
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
