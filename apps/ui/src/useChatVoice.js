import { useEffect, useRef, useState } from 'react';
import client from './client.js';

export default function useChatVoice({ conversationId, agentProfileId, isVisible, onError }) {
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [handsFreeMode, setHandsFreeMode] = useState(false);
  const [handsFreeStatus, setHandsFreeStatus] = useState('off');
  const voiceSessionRef = useRef(null);
  const handsFreeModeRef = useRef(false);
  const voiceStartIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    setVoiceAvailable(false);
    client.voice.status(conversationId)
      .then(status => { if (active) setVoiceAvailable(status.available); })
      .catch(() => { if (active) setVoiceAvailable(false); });
    return () => { active = false; };
  }, [conversationId, agentProfileId]);

  useEffect(() => {
    if (isVisible) return;
    disableHandsFree();
  }, [isVisible]);

  useEffect(() => {
    disableHandsFree();
  }, [conversationId, agentProfileId]);

  useEffect(() => () => {
    const session = voiceSessionRef.current;
    voiceStartIdRef.current++;
    closeRealtimeSession(session);
  }, []);

  function closeRealtimeSession(session) {
    if (!session || session.finished) return;
    session.finished = true;
    session.channel?.close();
    session.pc?.close();
    session.stream?.getTracks().forEach(track => track.stop());
    session.remoteAudio?.pause();
    if (session.remoteAudio) session.remoteAudio.srcObject = null;
    if (voiceSessionRef.current === session) voiceSessionRef.current = null;
  }

  function stopVoiceCapture() {
    voiceStartIdRef.current++;
    closeRealtimeSession(voiceSessionRef.current);
  }

  async function startVoiceCapture() {
    const startId = ++voiceStartIdRef.current;
    let pendingStream = null;
    let pendingPc = null;
    let pendingAudio = null;
    onError(null);
    setHandsFreeStatus('connecting');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
        throw new Error('Este navegador no admite audio WebRTC para voz.');
      }
      pendingStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (startId !== voiceStartIdRef.current) {
        pendingStream.getTracks().forEach(track => track.stop());
        return;
      }
      const token = await client.voice.createRealtimeSession(conversationId);
      if (startId !== voiceStartIdRef.current) {
        pendingStream.getTracks().forEach(track => track.stop());
        return;
      }

      const pc = new RTCPeerConnection();
      pendingPc = pc;
      const channel = pc.createDataChannel('oai-events');
      const remoteAudio = new Audio();
      remoteAudio.autoplay = true;
      const session = { startId, pc, channel, stream: pendingStream, remoteAudio, finished: false };
      voiceSessionRef.current = session;
      pendingStream = null;
      pendingPc = null;
      pc.ontrack = event => {
        remoteAudio.srcObject = event.streams[0];
        void remoteAudio.play().catch(() => onError('El navegador bloqueó el audio. Permití la reproducción de voz e intentá nuevamente.'));
      };
      pc.onconnectionstatechange = () => {
        if (session.finished) return;
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          onError('Se perdió la conexión de voz. Probá nuevamente.');
          disableHandsFree();
        }
      };
      channel.onopen = () => {
        if (session.startId === voiceStartIdRef.current) setHandsFreeStatus('listening');
      };
      channel.onmessage = event => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'input_audio_buffer.speech_started') setHandsFreeStatus('listening');
        if (message.type === 'input_audio_buffer.speech_stopped') setHandsFreeStatus('processing');
        if (message.type === 'response.function_call_arguments.done') {
          setHandsFreeStatus('processing');
          void (async () => {
            const callId = message.call_id;
            try {
              const result = await client.voice.executeTool(conversationId, message.name, callId, message.arguments);
              if (session.finished || channel.readyState !== 'open') return;
              channel.send(JSON.stringify({
                type: 'conversation.item.create',
                item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result ?? null) },
              }));
            } catch (error) {
              if (session.finished || channel.readyState !== 'open') return;
              channel.send(JSON.stringify({
                type: 'conversation.item.create',
                item: { type: 'function_call_output', call_id: callId, output: JSON.stringify({ error: error.message || 'La herramienta falló.' }) },
              }));
            }
            if (!session.finished && channel.readyState === 'open') channel.send(JSON.stringify({ type: 'response.create' }));
          })();
        }
        if (message.type === 'response.created') setHandsFreeStatus('processing');
        if (message.type === 'response.output_audio.delta') setHandsFreeStatus('speaking');
        if (message.type === 'response.done') setHandsFreeStatus('listening');
        if (message.type === 'error') {
          onError(message.error?.message || 'Falló la sesión de voz.');
          disableHandsFree();
        }
      };
      pendingAudio = remoteAudio;
      session.stream.getTracks().forEach(track => pc.addTrack(track, session.stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answerSdp = await client.voice.negotiateRealtime({
        realtimeUrl: token.realtimeUrl,
        token: token.value,
        offerSdp: pc.localDescription?.sdp ?? '',
      });
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      pendingAudio = null;
      if (startId === voiceStartIdRef.current) setHandsFreeStatus('listening');
    } catch (error) {
      pendingStream?.getTracks().forEach(track => track.stop());
      pendingPc?.close();
      pendingAudio?.pause();
      if (startId !== voiceStartIdRef.current) return;
      closeRealtimeSession(voiceSessionRef.current);
      disableHandsFree();
      onError(error.message || 'No se pudo iniciar la sesión de voz.');
    }
  }

  function disableHandsFree() {
    handsFreeModeRef.current = false;
    setHandsFreeMode(false);
    setHandsFreeStatus('off');
    stopVoiceCapture();
  }

  function toggleHandsFree({ isLoading, isDelegatedActive, editingMessage }) {
    if (!voiceAvailable && !handsFreeModeRef.current) return;
    if (handsFreeModeRef.current) {
      disableHandsFree();
      return;
    }
    if (isLoading || isDelegatedActive || editingMessage || voiceSessionRef.current) return;
    handsFreeModeRef.current = true;
    setHandsFreeMode(true);
    setHandsFreeStatus('connecting');
    void startVoiceCapture();
  }

  return { voiceAvailable, handsFreeMode, handsFreeStatus, toggleHandsFree };
}
