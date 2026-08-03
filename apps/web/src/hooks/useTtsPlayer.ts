import { useState, useRef, useCallback } from 'react';
import type { Socket } from 'socket.io-client';

export type MessagePlayState = 'idle' | 'loading' | 'playing' | 'paused';

interface MessageAudioState {
  state: MessagePlayState;
  audioCtx: AudioContext;
  nextStartTime: number;
  eventCleanup: () => void;
}

export function useTtsPlayer(socket: Socket | null, getSessionId: () => string) {
  const messageAudioMapRef = useRef<Map<string, MessageAudioState>>(new Map());
  const activeMessageIdRef = useRef<string | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [messageStates, setMessageStates] = useState<Record<string, MessagePlayState>>({});
  const [autoPlayEnabled, setAutoPlayEnabled] = useState<boolean>(
    () => localStorage.getItem('tts-auto-play') !== 'false' // 默认开启
  );

  const updateMessageState = useCallback((messageId: string, state: MessagePlayState) => {
    setMessageStates(prev => ({ ...prev, [messageId]: state }));
  }, []);

  const stopMessage = useCallback((messageId: string) => {
    const info = messageAudioMapRef.current.get(messageId);
    if (info) {
      info.eventCleanup();
      info.audioCtx.close().catch(() => {});
      messageAudioMapRef.current.delete(messageId);
    }
    if (activeMessageIdRef.current === messageId) {
      activeMessageIdRef.current = null;
      setActiveMessageId(null);
    }
    updateMessageState(messageId, 'idle');
  }, [updateMessageState]);

  const playMessage = useCallback(async (messageId: string, text: string) => {
    if (!socket?.connected) return;
    if (!text) return;

    // 停止当前活跃的消息
    if (activeMessageIdRef.current && activeMessageIdRef.current !== messageId) {
      stopMessage(activeMessageIdRef.current);
    }

    updateMessageState(messageId, 'loading');
    activeMessageIdRef.current = messageId;
    setActiveMessageId(messageId);

    const audioCtx = new AudioContext({ sampleRate: 16000 });
    let nextStartTime = 0;

    const onAudioChunk = async (payload: { messageId: string; buffer: ArrayBuffer }) => {
      if (payload.messageId !== messageId) return;
      updateMessageState(messageId, 'playing');
      try {
        const int16 = new Int16Array(payload.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
        const audioBuffer = audioCtx.createBuffer(1, float32.length, 16000);
        audioBuffer.getChannelData(0).set(float32);
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        const startTime = Math.max(audioCtx.currentTime, nextStartTime);
        source.start(startTime);
        nextStartTime = startTime + audioBuffer.duration;
      } catch { /* 解码失败跳过 */ }
    };

    const onAudioEnd = (payload: { messageId: string }) => {
      if (payload.messageId !== messageId) return;
      stopMessage(messageId);
    };

    const onTtsError = (payload: { messageId: string; message: string }) => {
      if (payload.messageId !== messageId) return;
      stopMessage(messageId);
      console.warn('TTS 错误:', payload.message);
    };

    socket.on('audioChunk', onAudioChunk);
    socket.on('audioEnd', onAudioEnd);
    socket.on('ttsError', onTtsError);

    const eventCleanup = () => {
      socket.off('audioChunk', onAudioChunk);
      socket.off('audioEnd', onAudioEnd);
      socket.off('ttsError', onTtsError);
    };

    messageAudioMapRef.current.set(messageId, {
      state: 'loading',
      audioCtx,
      nextStartTime,
      eventCleanup,
    });

    // 请求后端合成
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('/api/chat/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text, messageId, sessionId: getSessionId() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'TTS 请求失败' }));
        socket.emit('ttsError', { messageId, message: err.message || 'TTS 请求失败' });
      }
    } catch (err) {
      stopMessage(messageId);
      console.warn('TTS 请求失败:', (err as Error).message);
    }
  }, [socket, getSessionId, stopMessage, updateMessageState]);

  const pauseMessage = useCallback((messageId: string) => {
    const info = messageAudioMapRef.current.get(messageId);
    if (!info || info.state !== 'playing') return;
    info.audioCtx.suspend().then(() => {
      updateMessageState(messageId, 'paused');
    }).catch(() => {});
  }, [updateMessageState]);

  const resumeMessage = useCallback((messageId: string) => {
    const info = messageAudioMapRef.current.get(messageId);
    if (!info || info.state !== 'paused') return;
    info.audioCtx.resume().then(() => {
      updateMessageState(messageId, 'playing');
    }).catch(() => {});
  }, [updateMessageState]);

  const stopAll = useCallback(() => {
    const ids = Array.from(messageAudioMapRef.current.keys());
    ids.forEach(id => stopMessage(id));
    messageAudioMapRef.current.clear();
    activeMessageIdRef.current = null;
    setActiveMessageId(null);
  }, [stopMessage]);

  const toggleAutoPlay = useCallback(() => {
    setAutoPlayEnabled(prev => {
      const next = !prev;
      localStorage.setItem('tts-auto-play', String(next));
      return next;
    });
  }, []);

  return {
    messageStates,
    activeMessageId,
    autoPlayEnabled,
    playMessage,
    pauseMessage,
    resumeMessage,
    stopAll,
    toggleAutoPlay,
  };
}
