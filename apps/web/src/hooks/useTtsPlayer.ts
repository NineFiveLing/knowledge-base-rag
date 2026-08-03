import { useState, useRef, useCallback } from 'react';
import type { Socket } from 'socket.io-client';

export type TtsPlayerState = 'idle' | 'playing' | 'paused';

export function useTtsPlayer(socket: Socket | null) {
  const [state, setState] = useState<TtsPlayerState>('idle');
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartRef = useRef<number>(0);
  const eventCleanupRef = useRef<(() => void) | null>(null);

  /** 获取或创建 AudioContext */
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext({ sampleRate: 16000 });
    }
    return audioCtxRef.current;
  }, []);

  /** PCM Int16 ArrayBuffer → AudioBuffer */
  const pcmToAudioBuffer = useCallback(async (pcm: ArrayBuffer): Promise<AudioBuffer> => {
    const ctx = getAudioCtx();
    const int16 = new Int16Array(pcm);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    const audioBuffer = ctx.createBuffer(1, float32.length, 16000);
    audioBuffer.getChannelData(0).set(float32);
    return audioBuffer;
  }, [getAudioCtx]);

  /** 调度一个 AudioBuffer 到播放队列 */
  const scheduleChunk = useCallback((audioBuffer: AudioBuffer) => {
    const ctx = getAudioCtx();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startTime = Math.max(now, nextStartRef.current);
    source.start(startTime);
    nextStartRef.current = startTime + audioBuffer.duration;
  }, [getAudioCtx]);

  /** 清空播放队列 */
  const clearQueue = useCallback(() => {
    nextStartRef.current = 0;
  }, []);

  /** 开始接收并播放 TTS 音频 */
  const startPlayer = useCallback(() => {
    if (!socket) return;
    clearQueue();
    setState('playing');

    const onAudioChunk = async (data: ArrayBuffer) => {
      try {
        const audioBuffer = await pcmToAudioBuffer(data);
        scheduleChunk(audioBuffer);
      } catch { /* 解码失败跳过 */ }
    };

    const onAudioEnd = () => {
      setState('idle');
      nextStartRef.current = 0;
    };

    const onTtsError = (data: { message: string }) => {
      console.warn('TTS 错误:', data.message);
    };

    socket.on('audioChunk', onAudioChunk);
    socket.on('audioEnd', onAudioEnd);
    socket.on('ttsError', onTtsError);

    // 返回清理函数（外部切换会话时调用）
    eventCleanupRef.current = () => {
      socket.off('audioChunk', onAudioChunk);
      socket.off('audioEnd', onAudioEnd);
      socket.off('ttsError', onTtsError);
    };
  }, [socket, clearQueue, pcmToAudioBuffer, scheduleChunk]);

  /** 暂停 */
  const pause = useCallback(() => {
    if (!socket) return;
    setState('paused');
    clearQueue();
    socket.emit('pauseTts');
  }, [socket, clearQueue]);

  /** 恢复 */
  const resume = useCallback(() => {
    if (!socket) return;
    setState('playing');
    clearQueue();
    socket.emit('resumeTts');
  }, [socket, clearQueue]);

  /** 停止并清理 */
  const stopPlayer = useCallback(() => {
    setState('idle');
    clearQueue();
    eventCleanupRef.current?.();
    eventCleanupRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, [clearQueue]);

  return {
    state,
    isPlaying: state === 'playing',
    isPaused: state === 'paused',
    startPlayer,
    pause,
    resume,
    stopPlayer,
  };
}
