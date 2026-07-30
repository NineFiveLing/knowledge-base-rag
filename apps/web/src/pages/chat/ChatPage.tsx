import { useState, useRef, useEffect } from 'react';
import { Input, Button, Tag, Spin } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useSSE } from '../../hooks/useSSE';
import { useVoiceChat } from '../../hooks/useVoiceChat';
import VoiceButton from '../../components/chat/VoiceButton';

interface Message { role: 'user' | 'assistant'; content: string; }

/** AI 问答页面：流式 SSE 接收回答 + 语音输入支持 */
export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState('');
  const [input, setInput] = useState('');
  const [sources, setSources] = useState<Array<{ index: number; docId: string; chunkId: string }>>([]);
  const { sendMessage } = useSSE();
  const sessionId = useRef(`sess-${Date.now()}`).current;
  const { isRecording, asrText, triggerMessage, connect, startRecording, stopRecording, clearTrigger } = useVoiceChat(sessionId);

  /** WebSocket 生命周期：连接语音网关，断开时清理 */
  useEffect(() => {
    const socket = connect();
    return () => { socket?.disconnect(); };
  }, []);

  /** 收到 ASR triggerChat 事件时，自动发送消息到 SSE */
  useEffect(() => {
    if (triggerMessage) {
      handleSend(triggerMessage);
      clearTrigger();
    }
  }, [triggerMessage]);

  const handleSend = async (voiceText?: string) => {
    const text = (voiceText || input).trim();
    if (!text || streaming) return;
    if (!voiceText) setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setStreaming('');

    await sendMessage(text, sessionId, (token) => {
      setStreaming((prev) => prev + token);
    }, () => {
      setStreaming((prev) => {
        if (prev) setMessages((msgs) => [...msgs, { role: 'assistant', content: prev }]);
        return '';
      });
    }, (srcs) => {
      setSources(srcs);
    });
  };

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.role}`}>{m.content}</div>
        ))}
        {!streaming && messages.length === 0 && <Spin style={{ display: 'block', margin: '12px 0' }} />}
        {streaming && <div className="chat-bubble assistant streaming">{streaming}</div>}
      </div>
      {sources.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <span style={{ marginRight: 8, color: '#666', fontSize: 13 }}>参考来源：</span>
          {sources.map((s) => (
            <Tag key={s.index} color="blue" title={`文档: ${s.docId} | 片段: ${s.chunkId}`}>
              [{s.index}]
            </Tag>
          ))}
        </div>
      )}
      <div className="chat-input-area">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={() => handleSend()}
          placeholder="输入您的问题..."
          disabled={!!streaming}
          size="large"
          style={{ flex: 1 }}
        />
        <VoiceButton isRecording={isRecording} onStart={startRecording} onStop={stopRecording} />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={() => handleSend()}
          disabled={!!streaming}
          size="large"
        >
          发送
        </Button>
      </div>
      {asrText && <div className="asr-preview">{asrText}</div>}
    </div>
  );
}
