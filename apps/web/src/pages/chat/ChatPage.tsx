import { useState, useRef, useEffect, useCallback } from 'react';
import { Input, Button, Tag, message as antMsg } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useSSE } from '../../hooks/useSSE';
import { useVoiceChat } from '../../hooks/useVoiceChat';
import VoiceButton from '../../components/chat/VoiceButton';
import ConversationList from '../../components/chat/ConversationList';

interface Message { role: 'user' | 'assistant'; content: string; }

/** AI 问答页面：左侧对话列表 + 右侧流式 SSE 聊天区 + 语音输入支持 */
export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState('');
  const [input, setInput] = useState('');
  const [sources, setSources] = useState<Array<{ index: number; docId: string; chunkId: string }>>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

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

  /** 加载对话历史消息 */
  const loadConversation = useCallback(async (convId: string) => {
    if (!convId) {
      // 活跃对话被删除，回退到空状态
      setMessages([]);
      setActiveConvId(null);
      setStreaming('');
      setSources([]);
      return;
    }
    setLoadingHistory(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/chat/conversations/${convId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setMessages(data.messages.map((m: any) => ({ role: m.role, content: m.content })));
      setActiveConvId(convId);
    } catch {
      antMsg.error('加载对话失败');
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  /** 新建对话 */
  const handleNewConversation = useCallback(() => {
    setMessages([]);
    setActiveConvId(null);
    setStreaming('');
    setSources([]);
  }, []);

  const handleSend = async (voiceText?: string) => {
    const text = (voiceText || input).trim();
    if (!text || streaming) return;
    if (!voiceText) setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setStreaming('');

    await sendMessage(
      text,
      sessionId,
      (token) => setStreaming((prev) => prev + token),
      () => {
        setStreaming((prev) => {
          if (prev) {
            setMessages((msgs) => [...msgs, { role: 'assistant', content: prev }]);
            // 如果没有活跃对话，刷新列表以显示新创建的对话
            if (!activeConvId) {
              // 延迟刷新以确保后端已创建
              setTimeout(() => {
                const event = new CustomEvent('refresh-conversations');
                window.dispatchEvent(event);
              }, 500);
            }
          }
          return '';
        });
      },
      (srcs) => setSources(srcs),
      activeConvId,
    );
  };

  return (
    <div className="chat-layout">
      {/* 左侧对话列表 */}
      <aside className="chat-sidebar">
        <ConversationList
          activeId={activeConvId}
          onSelect={(id) => loadConversation(id)}
        />
      </aside>

      {/* 右侧聊天区 */}
      <main className="chat-main">
        <div className="chat-messages">
          {loadingHistory && <div style={{ textAlign: 'center', color: '#999' }}>加载中…</div>}
          {messages.map((m, i) => (
            <div key={i} className={`chat-bubble ${m.role}`}>{m.content}</div>
          ))}
          {!streaming && messages.length === 0 && !loadingHistory && (
            <div className="chat-empty-hint">
              <div className="chat-empty-icon">💬</div>
              <h3>AI 知识库问答</h3>
              <p>输入您的问题，我将从知识库中检索答案</p>
            </div>
          )}
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
      </main>
    </div>
  );
}
