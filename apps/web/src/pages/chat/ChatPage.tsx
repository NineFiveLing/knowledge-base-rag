import { useState, useRef, useEffect, useCallback } from 'react';
import { Input, Button, message as antMsg } from 'antd';
import { SendOutlined, UserOutlined, RobotOutlined } from '@ant-design/icons';
import { useSSE } from '../../hooks/useSSE';
import { useVoiceChat } from '../../hooks/useVoiceChat';
import VoiceButton from '../../components/chat/VoiceButton';
import ConversationList from '../../components/chat/ConversationList';
import { SourceCard } from '../../components/chat/SourceCard';
import type { SourceRef } from '../../components/chat/SourceCard';
import DocumentDetailDrawer from '../../components/document/DocumentDetailDrawer';

interface Message { role: 'user' | 'assistant'; content: string; }

interface ConvLive {
  streaming: string;
  thinking: boolean;
  sources: SourceRef[];
}

/** AI 问答页面：左侧对话列表 + 右侧流式 SSE 聊天区 + 语音输入支持 */
export default function ChatPage() {
  // ── 当前展示的对话 state ──
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState('');
  const [input, setInput] = useState('');
  const [sources, setSources] = useState<SourceRef[]>([]);
  const [sourceDetailDocId, setSourceDetailDocId] = useState<string | null>(null);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [thinking, setThinking] = useState(false);

  const { sendMessage, abortConv } = useSSE();
  const sessionId = useRef(`sess-${Date.now()}`).current;
  const { isRecording, asrText, triggerMessage, connect, startRecording, stopRecording, clearTrigger } = useVoiceChat(sessionId);

  // ── 跨对话状态管理 ──
  const activeConvRef = useRef<string | null>(null);
  // 每对话的 SSE 实时状态（切换对话时不丢失）
  const convLiveRef = useRef<Map<string, ConvLive>>(new Map());
  // 每对话的已加载消息（避免每次切换都重新 fetch）
  const convMessagesRef = useRef<Map<string, Message[]>>(new Map());
  // 当前 SSE 流所属的会话（用于判断 token/onDone 归属，避免 setState 异步导致的 ref 不同步）
  const currentSSEConvRef = useRef<string | null>(null);
  // 最新 state 的 ref 镜像，用于 useCallback 中读取最新值而不依赖 state
  const messagesRef = useRef<Message[]>([]);
  const streamingRef = useRef('');
  const thinkingRef = useRef(false);
  const sourcesRef = useRef<SourceRef[]>([]);
  const inputRef = useRef('');
  // 消息列表容器 ref，用于自动滚动
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeConvRef.current = activeConvId;
  }, [activeConvId]);

  // ── 自动滚动到最新消息 ──
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  useEffect(() => { scrollToBottom(); }, [messages, streaming, thinking]);

  // ── WebSocket 语音生命周期 ──
  useEffect(() => {
    const socket = connect();
    return () => { socket?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 恢复对话实时状态到 UI state（切换对话时调用） ──
  const applyConvState = (convId: string | null) => {
    if (!convId) {
      setStreaming('');
      setThinking(false);
      setSources([]);
      return;
    }
    const live = convLiveRef.current.get(convId);
    if (live) {
      setStreaming(live.streaming);
      setThinking(live.thinking);
      setSources(live.sources);
      // 不覆盖 messages：服务端 fetch 的数据是权威的
    } else {
      setStreaming('');
      setThinking(false);
      setSources([]);
    }
  };

  // ── 发送消息 ──
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleSend = useCallback(async (voiceText?: string) => {
    const text = (voiceText || inputRef.current).trim();
    if (!text || streamingRef.current) return;
    if (!voiceText) setInput('');

    currentSSEConvRef.current = activeConvRef.current;

    // 用户消息
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setStreaming('');
    setSources([]);
    setThinking(true);

    // 有新消息时刷新对话列表（修复已存在对话不更新排序的 bug）
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('refresh-conversations'));
    }, 100);

    await sendMessage(
      text,
      sessionId,
      // onToken
      (token) => {
        if (activeConvRef.current !== currentSSEConvRef.current) {
          // 后台 SSE：更新 live map
          const key = currentSSEConvRef.current || '__orphan__';
          const live = convLiveRef.current.get(key) || { streaming: '', thinking: false, sources: [] };
          live.thinking = false;
          live.streaming += token;
          convLiveRef.current.set(key, live);
          return;
        }
        setThinking(false);
        setStreaming((prev) => prev + token);
      },
      // onDone
      () => {
        if (activeConvRef.current !== currentSSEConvRef.current) {
          // 后台 SSE 完成：将消息持久化到缓存
          const key = currentSSEConvRef.current || '__orphan__';
          const live = convLiveRef.current.get(key);
          if (live?.streaming) {
            const cached = convMessagesRef.current.get(key) || [];
            cached.push({ role: 'assistant' as const, content: live.streaming });
            convMessagesRef.current.set(key, cached);
          }
          convLiveRef.current.delete(key);
          // 后台流结束后也刷新列表
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('refresh-conversations'));
          }, 300);
          return;
        }
        setThinking(false);
        // ⚠️ 不在 setStreaming updater 内调用 setMessages
        // React StrictMode 会双重调用 updater，导致 setMessages 排队两次 → 重复消息
        const finalText = streamingRef.current;
        if (finalText) {
          setMessages((msgs) => [...msgs, { role: 'assistant', content: finalText }]);
          // 同步到缓存
          if (currentSSEConvRef.current) {
            const cached = convMessagesRef.current.get(currentSSEConvRef.current) || [];
            cached.push({ role: 'assistant', content: finalText });
            convMessagesRef.current.set(currentSSEConvRef.current, cached);
          }
        }
        setStreaming('');
        // 流结束后刷新对话列表
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('refresh-conversations'));
        }, 300);
      },
      // onSources
      (srcs) => {
        if (activeConvRef.current !== currentSSEConvRef.current) {
          const key = currentSSEConvRef.current || '__orphan__';
          const live = convLiveRef.current.get(key);
          if (live) {
            live.sources = srcs;
            convLiveRef.current.set(key, live);
          }
          return;
        }
        setSources(srcs);
      },
      currentSSEConvRef.current,
      // onConversation — SSE 首个事件，告知新创建的对话 ID
      (newConvId, isNew) => {
        if (isNew && !currentSSEConvRef.current) {
          // 同步更新两个 ref，避免 onToken/onDone 因 setState 异步而错误路由到后台
          currentSSEConvRef.current = newConvId;
          activeConvRef.current = newConvId;
          setActiveConvId(newConvId);
          // 刷新列表（新建会话时）
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('refresh-conversations'));
          }, 300);
        }
      },
    );
  }, [sendMessage, sessionId]); // sendMessage / sessionId 均为稳定引用

  // ── ASR 语音触发 ──
  useEffect(() => {
    if (triggerMessage) {
      handleSend(triggerMessage);
      clearTrigger();
    }
  }, [triggerMessage, handleSend, clearTrigger]);

  // ── 切换对话 ──
  const handleSelectConv = useCallback(async (convId: string) => {
    // 不中断旧对话的 SSE！保存当前 live 状态 + messages 缓存
    if (activeConvRef.current) {
      convLiveRef.current.set(activeConvRef.current, {
        streaming: streamingRef.current,
        thinking: thinkingRef.current,
        sources: sourcesRef.current,
      });
      // 保存当前 messages 到缓存，防止切换回时消息丢失（修复消息消失 bug）
      const currentMessages = messagesRef.current;
      if (currentMessages.length > 0) {
        convMessagesRef.current.set(activeConvRef.current, currentMessages);
      }
    }

    // 切换到新对话
    setActiveConvId(convId);
    setLoadingHistory(true);

    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/chat/conversations/${convId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const msgs: Message[] = data.messages.map((m: any) => ({ role: m.role, content: m.content }));
      convMessagesRef.current.set(convId, msgs);
      setMessages(msgs);
    } catch {
      antMsg.error('加载对话失败');
    } finally {
      setLoadingHistory(false);
    }

    // 恢复该对话的实时 SSE 状态
    applyConvState(convId);
  }, []); // 空依赖：通过 refs 读取最新 streaming/thinking/sources/messages

  // ── 当前显示的实时状态 ──
  const displayStreaming = streaming;
  const displayThinking = thinking;
  const displaySources = sources;

  // ── 同步最新 state 到 ref（供 useCallback 中读取，避免依赖频繁更新的 state） ──
  messagesRef.current = messages;
  streamingRef.current = streaming;
  thinkingRef.current = thinking;
  sourcesRef.current = sources;
  inputRef.current = input;

  return (
    <div className="chat-layout">
      {/* 左侧对话列表 */}
      <aside className="chat-sidebar">
        <ConversationList
          activeId={activeConvId}
          onSelect={handleSelectConv}
        />
      </aside>

      {/* 右侧聊天区 */}
      <main className="chat-main">
        <div className="chat-messages">
          {loadingHistory && <div className="chat-loading-hint">加载中…</div>}

          {messages.map((m, i) => (
            <div key={i} className={`chat-bubble-row ${m.role}`}>
              <div className={`chat-avatar ${m.role}`}>
                {m.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
              </div>
              <div className={`chat-bubble ${m.role}`}>{m.content}</div>
            </div>
          ))}

          {/* 思考中 */}
          {displayThinking && (
            <div className="chat-bubble-row assistant">
              <div className="chat-avatar assistant"><RobotOutlined /></div>
              <div className="chat-bubble assistant thinking">
                <span className="thinking-dots">思考中<span className="dot-anim">.</span><span className="dot-anim">.</span><span className="dot-anim">.</span></span>
              </div>
            </div>
          )}

          {/* 流式输出 */}
          {displayStreaming && (
            <div className="chat-bubble-row assistant">
              <div className="chat-avatar assistant"><RobotOutlined /></div>
              <div className="chat-bubble assistant streaming">{displayStreaming}</div>
            </div>
          )}

          {/* 滚动锚点 */}
          <div ref={messagesEndRef} />

          {/* 空状态 */}
          {!displayStreaming && !displayThinking && messages.length === 0 && !loadingHistory && (
            <div className="chat-empty-hint">
              <div className="chat-empty-icon">💬</div>
              <h3>AI 知识库问答</h3>
              <p>输入您的问题，我将从知识库中检索答案</p>
            </div>
          )}
        </div>

        {displaySources.length > 0 && (
          <div className="chat-sources">
            <div className="chat-sources-header">
              <span>📎 参考来源</span>
              <span className="chat-sources-hint">· 以下文档为该回答提供了参考依据</span>
            </div>
            <div className="chat-sources-cards">
              {displaySources.map((s) => (
                <SourceCard
                  key={`${s.docId}-${s.index}`}
                  source={s}
                  onClick={() => setSourceDetailDocId(s.docId)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="chat-input-area">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={() => handleSend()}
            placeholder="输入您的问题..."
            disabled={!!streaming || thinking}
            size="large"
            style={{ flex: 1 }}
          />
          <VoiceButton isRecording={isRecording} onStart={startRecording} onStop={stopRecording} />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={() => handleSend()}
            disabled={!!streaming || thinking}
            size="large"
          >
            发送
          </Button>
        </div>
        {asrText && <div className="asr-preview">{asrText}</div>}
      </main>

      <DocumentDetailDrawer
        open={!!sourceDetailDocId}
        docId={sourceDetailDocId}
        onClose={() => setSourceDetailDocId(null)}
      />
    </div>
  );
}
