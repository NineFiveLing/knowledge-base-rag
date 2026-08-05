import { useState, useRef, useCallback, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

export type MessagePlayState = 'idle' | 'loading' | 'playing' | 'paused';

interface MessageAudioState {
  state: MessagePlayState;
  audioCtx: AudioContext;
  nextStartTime: number;
  eventCleanup: () => void;
  /** audioEnd 后的排空清理定时器 —— 同 ID 重播时由 stopMessage clearTimeout 取消，避免陈旧 timer 误删新播放条目 */
  drainTimer?: ReturnType<typeof setTimeout>;
}

/** TTS 播放器 Hook：独立 Socket.IO 连接 + AudioContext PCM 播放 */
export function useTtsPlayer(getSessionId: () => string, autoPlayEnabled: boolean, onToggleAutoPlay: () => void) {
  const messageAudioMapRef = useRef<Map<string, MessageAudioState>>(new Map());
  const activeMessageIdRef = useRef<string | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [messageStates, setMessageStates] = useState<Record<string, MessagePlayState>>({});
  // 待播放队列：socket 未连接时缓存请求，连接后自动播放
  const pendingPlaysRef = useRef<Array<{ messageId: string; text: string }>>([]);
  const socketRef = useRef<Socket | null>(null);

  // 从 props 读取自动播放状态
  const autoPlay = autoPlayEnabled;
  const toggleAutoPlay = onToggleAutoPlay;

  // 独立管理 TTS socket 连接
  const playMessageRef = useRef<((messageId: string, text: string) => void) | null>(null);

  useEffect(() => {
    const wsUrl = import.meta.env.VITE_WS_URL || 'http://localhost:3001';
    const socket = io(wsUrl, { path: '/socket.io/' });
    socketRef.current = socket;

    socket.on('connect', () => {
      // 刷新待播放队列
      const pending = pendingPlaysRef.current;
      pendingPlaysRef.current = [];
      if (pending.length > 0) {
        const latest = pending[pending.length - 1];
        playMessageRef.current?.(latest.messageId, latest.text);
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const updateMessageState = useCallback((messageId: string, state: MessagePlayState) => {
    setMessageStates(prev => ({ ...prev, [messageId]: state }));
  }, []);

  const stopMessage = useCallback((messageId: string) => {
    const info = messageAudioMapRef.current.get(messageId);
    if (info) {
      if (info.drainTimer) clearTimeout(info.drainTimer);
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
    const s = socketRef.current;

    // socket 未连接时入队，等待连接后自动播放
    if (!s?.connected) {
      pendingPlaysRef.current.push({ messageId, text });
      return;
    }

    // 停止当前活跃的消息
    if (activeMessageIdRef.current) {
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
      // 不立即 close —— 等待已调度的音频帧播放完毕后再清理
      updateMessageState(messageId, 'idle');
      const drainMs = Math.max(0, (nextStartTime - audioCtx.currentTime) * 1000 + 300);
      const drainTimer = setTimeout(() => {
        audioCtx.close().catch(() => {});
        eventCleanup();
        messageAudioMapRef.current.delete(messageId);
        if (activeMessageIdRef.current === messageId) {
          activeMessageIdRef.current = null;
          setActiveMessageId(null);
        }
      }, drainMs);
      // 记录 timer 到 map entry —— 同 ID 重播时 stopMessage 会 clearTimeout 取消此陈旧 timer
      const entry = messageAudioMapRef.current.get(messageId);
      if (entry) entry.drainTimer = drainTimer;
    };

    const onTtsError = (payload: { messageId: string; message: string }) => {
      if (payload.messageId !== messageId) return;
      stopMessage(messageId);
      console.warn('TTS 错误:', payload.message);
    };

    s.on('audioChunk', onAudioChunk);
    s.on('audioEnd', onAudioEnd);
    s.on('ttsError', onTtsError);

    const eventCleanup = () => {
      s.off('audioChunk', onAudioChunk);
      s.off('audioEnd', onAudioEnd);
      s.off('ttsError', onTtsError);
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
        stopMessage(messageId);
        console.warn('TTS 请求失败: HTTP', res.status);
      }
    } catch (err) {
      stopMessage(messageId);
      console.warn('TTS 请求失败:', (err as Error).message);
    }
  }, [getSessionId, stopMessage, updateMessageState]);
  playMessageRef.current = playMessage;

  const pauseMessage = useCallback((messageId: string) => {
    const info = messageAudioMapRef.current.get(messageId);
    if (!info) return;
    info.audioCtx.suspend().then(() => {
      updateMessageState(messageId, 'paused');
    }).catch(() => {});
  }, [updateMessageState]);

  const resumeMessage = useCallback((messageId: string) => {
    const info = messageAudioMapRef.current.get(messageId);
    if (!info) return;
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

  return {
    messageStates,
    activeMessageId,
    autoPlayEnabled: autoPlay,
    playMessage,
    pauseMessage,
    resumeMessage,
    stopAll,
    toggleAutoPlay,
  };
}
