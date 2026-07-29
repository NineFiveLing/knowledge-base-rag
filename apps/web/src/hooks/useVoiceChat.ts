import { useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

/** 语音聊天 Hook：WebSocket 音频上行 + ASR 识别 */
export function useVoiceChat(_sessionId: string) {
  const [isRecording, setIsRecording] = useState(false);
  const [asrText, setAsrText] = useState('');
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const connect = useCallback(() => {
    const wsUrl = import.meta.env.VITE_WS_URL || 'http://localhost:3000';
    const socket = io(`${wsUrl}/voice`);
    socketRef.current = socket;

    socket.on('asrResult', (data: { text: string; isFinal: boolean }) => {
      setAsrText(prev => data.isFinal ? data.text : prev + ' ' + data.text);
    });

    socket.on('triggerChat', (data: { message: string; sessionId: string }) => {
      setTriggerMessage(data.message);
    });

    return socket;
  }, []);

  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && socketRef.current) {
        event.data.arrayBuffer().then(buffer => {
          socketRef.current?.emit('audio', buffer);
        });
      }
    };

    mediaRecorder.start(100);
    mediaRecorderRef.current = mediaRecorder;
    setIsRecording(true);
    setAsrText('');
    socketRef.current?.emit('startListening');
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop());
    setIsRecording(false);
    socketRef.current?.emit('stopListening');
  }, []);

  return {
    isRecording, asrText, triggerMessage,
    connect, startRecording, stopRecording,
    clearTrigger: () => setTriggerMessage(null),
  };
}
