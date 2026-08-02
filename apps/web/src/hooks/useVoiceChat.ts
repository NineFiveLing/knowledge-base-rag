import { useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { message as antMsg } from 'antd';

/** 语音聊天 Hook：AudioContext PCM 采集 + WebSocket 音频上行 + ASR 识别 */
export function useVoiceChat(_sessionId: string) {
  const [isRecording, setIsRecording] = useState(false);
  const [asrText, setAsrText] = useState('');
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  // AudioContext 相关引用（用于 stopRecording 清理）
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const connect = useCallback(() => {
    const wsUrl = import.meta.env.VITE_WS_URL || 'http://localhost:3001';
    const socket = io(`${wsUrl}/voice`);
    socketRef.current = socket;

    socket.on('asrResult', (data: { text: string; isFinal: boolean; error?: string }) => {
      if (data.error) {
        antMsg.error(data.error);
        return;
      }
      setAsrText((prev) => (data.isFinal ? data.text : prev + ' ' + data.text));
    });

    socket.on('triggerChat', (data: { message: string; sessionId: string }) => {
      setTriggerMessage(data.message);
    });

    return socket;
  }, []);

  /** Float32Array → Int16Array PCM 转换 */
  const floatToPcm = (float32: Float32Array): ArrayBuffer => {
    const pcm = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcm.buffer;
  };

  const startRecording = useCallback(async () => {
    try {
      // 1. 获取麦克风
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      // 2. 创建 AudioContext（16kHz 采样率）
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      // 3. 连接音频源 → ScriptProcessor（4096 采样点/帧 @ 16kHz ≈ 256ms）
      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!socketRef.current?.connected) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBuffer = floatToPcm(inputData);
        socketRef.current.emit('audio', pcmBuffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      // 4. 通知服务端开始识别
      socketRef.current?.emit('startListening');
      setIsRecording(true);
      setAsrText('');
    } catch (err: any) {
      console.error('麦克风访问失败', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        antMsg.error('无法访问麦克风，请在浏览器设置中允许麦克风权限');
      } else if (err.name === 'NotFoundError') {
        antMsg.error('未检测到麦克风设备');
      } else {
        antMsg.error(`麦克风初始化失败: ${err.message || '未知错误'}`);
      }
    }
  }, []);

  const stopRecording = useCallback(() => {
    // 断开 AudioContext 链路并释放资源
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current?.getTracks().forEach((t) => t.stop());

    processorRef.current = null;
    sourceRef.current = null;
    audioCtxRef.current = null;
    streamRef.current = null;

    setIsRecording(false);
    socketRef.current?.emit('stopListening');
  }, []);

  return {
    isRecording,
    asrText,
    triggerMessage,
    connect,
    startRecording,
    stopRecording,
    clearTrigger: () => setTriggerMessage(null),
  };
}
