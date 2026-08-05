import { useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { message as antMsg } from 'antd';

/** 语音聊天 Hook：AudioContext PCM 采集 + WebSocket 音频上行 + ASR 识别 */
export function useVoiceChat(_sessionId: string, onVoiceConnect?: () => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [asrText, setAsrText] = useState('');
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);
  const [voiceSocket, setVoiceSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);
  // AudioContext 相关引用（用于 stopRecording 清理）
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onConnectRef = useRef(onVoiceConnect);
  onConnectRef.current = onVoiceConnect;
  // 记录最后一次成功写入 state 的 ASR 文本（解决同 tick 多个事件导致 prev 相同的问题）
  const lastCommittedRef = useRef('');

  const connect = useCallback((sessionId?: string) => {
    const wsUrl = import.meta.env.VITE_WS_URL || 'http://localhost:3001';
    const socket = io(`${wsUrl}/voice`);
    socketRef.current = socket;
    setVoiceSocket(socket);

    // 立即 emit register（Socket.IO 会在连接建立后自动发送缓冲的消息）
    // 避免连接成功 → on('connect') 回调前 SSE 已启动的竞态
    if (sessionId) socket.emit('register', sessionId);

    socket.on('connect', () => {
      console.log('[Voice] socket 已连接:', socket.id);
      // 连接后再次 register 确保服务端收到（幂等）
      if (sessionId) socket.emit('register', sessionId);
      // 通知外部 voice socket 已就绪（例如 TTS 刷新待播放队列）
      if (onConnectRef.current) onConnectRef.current();
    });

    socket.on('connect_error', (err) => {
      console.warn('[Voice] socket 连接失败:', err.message);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Voice] socket 断开:', reason);
    });

    socket.on('asrResult', (data: { text: string; isFinal: boolean; error?: string }) => {
      if (data.error) {
        antMsg.error(data.error);
        return;
      }
      if (!data.text) return;
      // 去重策略：只追加不重复的部分（标准化后比较，忽略空格/标点差异）
      const normalize = (s: string) => s.replace(/\s+/g, '').replace(/[，。！？、；：""''（）\s]/g, '');
      setAsrText((prev) => {
        const newText = data.text;
        if (!newText) return prev;
        const normPrev = normalize(prev);
        const normNew = normalize(newText);
        if (normNew === normPrev) return prev;
        // 新文本已完全包含在旧文本中 → 跳过（后端重复发送）
        if (normPrev.includes(normNew)) return prev;
        // 旧文本是新文本的前缀 → 直接用新文本替换（后端发送了完整累积文本）
        if (normNew.startsWith(normPrev)) {
          lastCommittedRef.current = newText;
          return newText;
        }
        // 找末尾重叠：只追加不重叠的部分
        const maxLen = Math.min(normPrev.length, normNew.length);
        let overlap = 0;
        for (let len = maxLen; len > 0; len--) {
          if (normPrev.slice(-len) === normNew.slice(0, len)) {
            overlap = len;
            break;
          }
        }
        // 用原始文本计算重叠位置（近似）
        const result = prev + newText.slice(overlap);
        lastCommittedRef.current = result;
        return result;
      });
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
      // 只清空去重追踪，不清空输入框（新录音的内容会增量追加到已有文字上）
      lastCommittedRef.current = '';
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
    lastCommittedRef.current = '';
    socketRef.current?.emit('stopListening');
  }, []);

  return {
    socket: voiceSocket,
    isRecording,
    asrText,
    triggerMessage,
    connect,
    startRecording,
    stopRecording,
    clearTrigger: () => setTriggerMessage(null),
  };
}
