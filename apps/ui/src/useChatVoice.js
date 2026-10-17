import { useEffect, useRef, useState } from 'react';
import client from './client.js';

export default function useChatVoice({ conversationId, isVisible, onError, onRecognizedSpeech }) {
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [handsFreeMode, setHandsFreeMode] = useState(false);
  const [handsFreeStatus, setHandsFreeStatus] = useState('off');
  const [voiceAudioUrl, setVoiceAudioUrl] = useState(null);
  const [isPreparingVoice, setIsPreparingVoice] = useState(false);
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);
  const voiceSessionRef = useRef(null);
  const handsFreeModeRef = useRef(false);
  const handsFreeRestartRef = useRef(false);
  const speechSynthesisFinishedRef = useRef(false);
  const voiceSynthesisPendingRef = useRef(0);
  const voiceSynthesisQueueRef = useRef(Promise.resolve());
  const voiceSpeechPipelineRef = useRef(false);
  const voiceStartIdRef = useRef(0);
  const voiceTranscriptRef = useRef([]);
  const voiceAudioRef = useRef(null);
  const voiceAudioUrlsRef = useRef([]);
  const voicePlaybackIndexRef = useRef(0);
  const voicePlaybackEnabledRef = useRef(false);
  const voiceSynthesisIdRef = useRef(0);
  const voiceTraceIdRef = useRef(null);
  useEffect(() => {
    let active = true;
    setVoiceAvailable(false);
    client.voice.status(conversationId)
      .then(status => { if (active) setVoiceAvailable(status.available); })
      .catch(() => { if (active) setVoiceAvailable(false); });
    return () => { active = false; };
  }, [conversationId]);

  useEffect(() => {
    if (isVisible) return;
    handsFreeModeRef.current = false;
    setHandsFreeMode(false);
    setHandsFreeStatus('off');
    stopVoiceCapture();
    stopVoicePlayback({ discard: true });
  }, [isVisible]);

  useEffect(() => {
    handsFreeModeRef.current = false;
    setHandsFreeMode(false);
    setHandsFreeStatus('off');
    stopVoiceCapture();
    stopVoicePlayback({ discard: true });
  }, [conversationId]);

  useEffect(() => () => {
    voiceSynthesisIdRef.current++;
    const session = voiceSessionRef.current;
    if (session) {
      window.clearTimeout(session.finishTimer);
      session.channel.close();
      session.pc.close();
      session.stream.getTracks().forEach(track => track.stop());
    }
    voiceAudioRef.current?.pause();
    voiceAudioUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
  }, []);

  function stopVoicePlayback({ discard = false } = {}) {
    voicePlaybackEnabledRef.current = false;
    const audio = voiceAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      voiceAudioRef.current = null;
    }
    setIsPlayingVoice(false);
    if (discard) {
      // Invalida cualquier síntesis anterior que todavía esté en vuelo.
      voiceSynthesisIdRef.current++;
      voiceSynthesisPendingRef.current = 0;
      voiceSpeechPipelineRef.current = false;
      voicePlaybackIndexRef.current = 0;
      voiceAudioUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      voiceAudioUrlsRef.current = [];
      setVoiceAudioUrl(null);
      setIsPreparingVoice(false);
    }
  }

  function completeHandsFreeSpeechIfReady() {
    if (!speechSynthesisFinishedRef.current || voiceSynthesisPendingRef.current > 0) return;
    if (voiceAudioRef.current || voicePlaybackIndexRef.current < voiceAudioUrlsRef.current.length) return;
    setIsPlayingVoice(false);
    voiceSpeechPipelineRef.current = false;
    if (handsFreeModeRef.current) void restartHandsFreeCapture();
  }

  function enqueueVoiceSpeech(rawText, turnTraceId, turnStartedAt) {
    const traceId = turnTraceId || (globalThis.crypto?.randomUUID?.() ?? `voice-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const text = rawText
      .replace(/```[\s\S]*?```/g, ' fragmento de código omitido ')
      .replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[`*_>#~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return;

    if (!voiceSpeechPipelineRef.current) {
      stopVoicePlayback({ discard: true });
      speechSynthesisFinishedRef.current = false;
      voiceSynthesisPendingRef.current = 0;
      voiceSynthesisQueueRef.current = Promise.resolve();
      voiceSpeechPipelineRef.current = true;
      voiceTraceIdRef.current = traceId;
      voicePlaybackEnabledRef.current = true;
      voicePlaybackIndexRef.current = 0;
      if (handsFreeModeRef.current) setHandsFreeStatus('processing');
    }

    const replyReadyAt = Date.now();
    const chunks = splitSpeechText(text, 600, 220);
    console.info('[voice-debug] reply-segment-ready', JSON.stringify({
      traceId, textChars: text.length, chunkCount: chunks.length,
      msFromTurnSubmit: turnStartedAt ? Date.now() - turnStartedAt : null,
    }));
    const synthesisId = voiceSynthesisIdRef.current;
    voiceSynthesisPendingRef.current++;
    setIsPreparingVoice(true);

    const synthesizeSegment = async () => {
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        if (synthesisId !== voiceSynthesisIdRef.current) return;
        const chunk = chunks[chunkIndex];
        const requestStartedAt = Date.now();
        console.info('[voice-debug] synthesis-start', JSON.stringify({
          traceId, chunkIndex: chunkIndex + 1, chunkCount: chunks.length, textChars: chunk.length,
        }));
        const slowRequestTimer = window.setTimeout(() => {
          console.warn('[voice-debug] synthesis-still-pending', JSON.stringify({
            traceId, chunkIndex: chunkIndex + 1, elapsedMs: Date.now() - requestStartedAt,
          }));
        }, 10_000);
        try {
          const blob = await client.voice.synthesize(conversationId, chunk, traceId);
          window.clearTimeout(slowRequestTimer);
          const synthesisMs = Date.now() - requestStartedAt;
          console.info('[voice-debug] synthesis-ready', JSON.stringify({
            traceId, chunkIndex: chunkIndex + 1, chunkCount: chunks.length,
            synthesisMs, audioBytes: blob.size,
          }));
          if (synthesisId !== voiceSynthesisIdRef.current) {
            console.info('[voice-debug] synthesis-discarded', JSON.stringify({ traceId, chunkIndex: chunkIndex + 1 }));
            return;
          }
          const urls = voiceAudioUrlsRef.current;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          voiceAudioUrlsRef.current = urls;
          if (urls.length === 1) {
            setVoiceAudioUrl(url);
            console.info('[voice-debug] first-audio-ready', JSON.stringify({
              traceId, msFromReplyReady: Date.now() - replyReadyAt,
              msFromTurnSubmit: turnStartedAt ? Date.now() - turnStartedAt : null, audioBytes: blob.size,
            }));
          }
          // Los segmentos se sintetizan en orden, pero la reproducción empieza
          // en cuanto llega el primer clip, mientras la herramienta/turno continúa.
          if (voicePlaybackEnabledRef.current && !voiceAudioRef.current && voicePlaybackIndexRef.current === urls.length - 1) {
            playVoiceTrack(voicePlaybackIndexRef.current);
          }
        } catch (e) {
          window.clearTimeout(slowRequestTimer);
          console.error('[voice-debug] synthesis-failed', JSON.stringify({
            traceId, chunkIndex: chunkIndex + 1, chunkCount: chunks.length,
            synthesisMs: Date.now() - requestStartedAt, error: e?.message || String(e),
          }));
          if (synthesisId === voiceSynthesisIdRef.current) {
            onError(`La respuesta quedó guardada, pero no se pudo generar el audio: ${e.message}`);
          }
          break;
        }
      }
    };

    voiceSynthesisQueueRef.current = voiceSynthesisQueueRef.current
      .catch(() => {})
      .then(synthesizeSegment)
      .finally(() => {
        if (synthesisId !== voiceSynthesisIdRef.current) return;
        voiceSynthesisPendingRef.current = Math.max(0, voiceSynthesisPendingRef.current - 1);
        if (voiceSynthesisPendingRef.current === 0) setIsPreparingVoice(false);
        completeHandsFreeSpeechIfReady();
      });
  }

  function playVoiceTrack(index) {
    const urls = voiceAudioUrlsRef.current;
    const traceId = voiceTraceIdRef.current;
    if (!urls[index]) {
      console.info('[voice-debug] playback-queue-empty', JSON.stringify({ traceId, chunkIndex: index + 1, readyChunks: urls.length }));
      voiceAudioRef.current = null;
      voicePlaybackIndexRef.current = index;
      setIsPlayingVoice(false);
      completeHandsFreeSpeechIfReady();
      return;
    }
    voicePlaybackIndexRef.current = index;
    console.info('[voice-debug] playback-start-request', JSON.stringify({ traceId, chunkIndex: index + 1, readyChunks: urls.length }));
    const audio = new Audio(urls[index]);
    voiceAudioRef.current = audio;
    audio.onplaying = () => {
      console.info('[voice-debug] playback-playing', JSON.stringify({ traceId, chunkIndex: index + 1 }));
      if (handsFreeModeRef.current) setHandsFreeStatus('speaking');
    };
    audio.onwaiting = () => {
      console.warn('[voice-debug] playback-waiting', JSON.stringify({ traceId, chunkIndex: index + 1, readyState: audio.readyState }));
    };
    audio.onstalled = () => {
      console.warn('[voice-debug] playback-stalled', JSON.stringify({ traceId, chunkIndex: index + 1, readyState: audio.readyState, networkState: audio.networkState }));
    };
    audio.onended = () => {
      console.info('[voice-debug] playback-ended', JSON.stringify({ traceId, chunkIndex: index + 1 }));
      if (voiceAudioRef.current === audio) {
        voiceAudioRef.current = null;
        if (voicePlaybackEnabledRef.current) playVoiceTrack(index + 1);
        else setIsPlayingVoice(false);
      }
    };
    audio.onerror = () => {
      console.error('[voice-debug] playback-error', JSON.stringify({
        traceId, chunkIndex: index + 1, mediaErrorCode: audio.error?.code ?? null,
        readyState: audio.readyState, networkState: audio.networkState,
      }));
      if (voiceAudioRef.current === audio) {
        voiceAudioRef.current = null;
        voicePlaybackEnabledRef.current = false;
        voicePlaybackIndexRef.current = voiceAudioUrlsRef.current.length;
        setIsPlayingVoice(false);
        onError('No se pudo reproducir la respuesta de voz. Podés intentar reproducirla de nuevo.');
        completeHandsFreeSpeechIfReady();
      }
    };
    setIsPlayingVoice(true);
    void audio.play().catch(e => {
      console.error('[voice-debug] playback-rejected', JSON.stringify({
        traceId, chunkIndex: index + 1, errorName: e?.name || null, error: e?.message || String(e),
      }));
      if (voiceAudioRef.current === audio) {
        voiceAudioRef.current = null;
        voicePlaybackEnabledRef.current = false;
        voicePlaybackIndexRef.current = voiceAudioUrlsRef.current.length;
        setIsPlayingVoice(false);
        const message = e?.name === 'NotAllowedError'
          ? 'El navegador bloqueó la reproducción automática. Tocá «Reproducir voz» para escuchar la respuesta.'
          : `No se pudo iniciar la reproducción de voz: ${e.message}`;
        onError(message);
        completeHandsFreeSpeechIfReady();
      }
    });
  }

  function finishVoiceCapture(session, submitTranscript) {
    if (session?.finished) return;
    const continueHandsFree = Boolean(session && handsFreeModeRef.current);
    if (session) {
      session.finished = true;
      window.clearTimeout(session.finishTimer);
      if (voiceSessionRef.current === session) voiceSessionRef.current = null;
      session.channel.close();
      session.pc.close();
      session.stream.getTracks().forEach(track => track.stop());
    }
    if (continueHandsFree) setHandsFreeStatus('processing');
    const text = voiceTranscriptRef.current.join(' ').replace(/\s+/g, ' ').trim();
    voiceTranscriptRef.current = [];
    if (submitTranscript && text) void onRecognizedSpeech(text);
    else if (continueHandsFree) void restartHandsFreeCapture();
  }

  function stopVoiceCapture() {
    voiceStartIdRef.current++;
    const session = voiceSessionRef.current;
    voiceTranscriptRef.current = [];
    if (session) finishVoiceCapture(session, false);
  }

  function handleTranscriptionEvent(session, transcript) {
    if (typeof transcript === 'string' && transcript.trim()) {
      voiceTranscriptRef.current.push(transcript.trim());
    }
    session.stopRequested = true;
    session.stream.getTracks().forEach(track => track.stop());
    finishVoiceCapture(session, true);
  }

  function handleVoiceError(session, message) {
    const error = message || 'Falló el reconocimiento de voz.';
    if (session.stopRequested) finishVoiceCapture(session, true);
    else {
      onError(error);
      disableHandsFree();
    }
  }

  async function startVoiceCapture() {
    const startId = ++voiceStartIdRef.current;
    let pendingStream = null;
    onError(null);
    stopVoicePlayback();
    voiceTranscriptRef.current = [];
    setHandsFreeStatus('connecting');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
        throw new Error('Este navegador no admite captura de voz WebRTC.');
      }
      const token = await client.voice.createRealtimeToken(conversationId);
      if (startId !== voiceStartIdRef.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      pendingStream = stream;
      if (startId !== voiceStartIdRef.current) {
        stream.getTracks().forEach(track => track.stop());
        pendingStream = null;
        return;
      }
      const pc = new RTCPeerConnection();
      const channel = pc.createDataChannel('oai-events');
      const session = { pc, channel, stream, stopRequested: false, finished: false, finishTimer: null };
      pendingStream = null;
      voiceSessionRef.current = session;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      channel.onmessage = event => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'input_audio_buffer.speech_stopped' && !session.stopRequested) {
          session.stopRequested = true;
          setHandsFreeStatus('processing');
          session.stream.getTracks().forEach(track => track.stop());
          session.finishTimer = window.setTimeout(() => finishVoiceCapture(session, true), 5000);
        } else if (message.type === 'conversation.item.input_audio_transcription.completed') {
          handleTranscriptionEvent(session, message.transcript);
        } else if (message.type === 'error') {
          handleVoiceError(session, message.error?.message);
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' && voiceSessionRef.current === session) {
          onError('Se perdió la conexión de voz. Probá nuevamente.');
          disableHandsFree();
        }
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answer = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/sdp' },
        body: pc.localDescription?.sdp,
      });
      if (!answer.ok) throw new Error(`OpenAI rechazó la conexión de voz (HTTP ${answer.status}).`);
      await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() });
      if (startId === voiceStartIdRef.current) setHandsFreeStatus('listening');
    } catch (e) {
      pendingStream?.getTracks().forEach(track => track.stop());
      if (startId !== voiceStartIdRef.current) return;
      disableHandsFree();
      onError(e.message || 'No se pudo iniciar el reconocimiento de voz.');
    }
  }

  async function restartHandsFreeCapture() {
    if (!handsFreeModeRef.current || handsFreeRestartRef.current) return;
    handsFreeRestartRef.current = true;
    try {
      await startVoiceCapture();
    } finally {
      handsFreeRestartRef.current = false;
    }
  }

  function disableHandsFree() {
    handsFreeModeRef.current = false;
    setHandsFreeMode(false);
    setHandsFreeStatus('off');
    stopVoiceCapture();
    stopVoicePlayback({ discard: true });
  }

  function toggleHandsFree({ isLoading, isDelegatedActive, editingMessage }) {
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

  function handleReplayVoice() {
    if (!voiceAudioUrlsRef.current.length) return;
    onError(null);
    stopVoicePlayback();
    voicePlaybackEnabledRef.current = true;
    playVoiceTrack(0);
  }

  function finishVoiceReply() {
    speechSynthesisFinishedRef.current = true;
    const willSpeakVoiceReply = handsFreeModeRef.current;
    if (voiceSynthesisPendingRef.current === 0) completeHandsFreeSpeechIfReady();
    return willSpeakVoiceReply;
  }

  return {
    voiceAvailable,
    handsFreeMode,
    handsFreeStatus,
    voiceAudioUrl,
    isPreparingVoice,
    isPlayingVoice,
    isHandsFreeMode: () => handsFreeModeRef.current,
    stopVoicePlayback,
    enqueueVoiceSpeech,
    finishVoiceReply,
    restartHandsFreeCapture,
    toggleHandsFree,
    handleReplayVoice,
  };
}

function splitSpeechText(text, maxLength, firstChunkMaxLength = maxLength) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > (chunks.length === 0 ? firstChunkMaxLength : maxLength)) {
    const limit = chunks.length === 0 ? firstChunkMaxLength : maxLength;
    let cut = remaining.lastIndexOf('. ', limit);
    if (cut >= limit * 0.55) {
      cut += 1;
    } else {
      cut = remaining.lastIndexOf(' ', limit);
    }
    if (cut <= 0) cut = limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
