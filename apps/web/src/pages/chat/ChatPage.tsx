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

interface Message { role: 'user' | 'assistant'; content: string; sources?: SourceRef[]; }

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

  // ── 自动滚动到最新消息（RAF 节流，流式期间 instant 避免 smooth 堆积卡顿） ──
  const scrollRafRef = useRef<number | null>(null);
  const scrollToBottom = useCallback((smooth: boolean) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
  }, []);
  useEffect(() => {
    if (scrollRafRef.current !== null) return; // 已有待执行的滚动，跳过
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollToBottom(!streaming); // 流式期间 instant，完成时 smooth
      scrollRafRef.current = null;
    });
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [messages, streaming, thinking, scrollToBottom]);

  // ── WebSocket 语音生命周期 ──
  useEffect(() => {
    const socket = connect();
    return () => { socket?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    sourcesRef.current = [];
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
            cached.push({ role: 'assistant' as const, content: live.streaming, sources: live.sources?.length ? live.sources : undefined });
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
        const finalSources = sourcesRef.current.length > 0 ? [...sourcesRef.current] : undefined;
        if (finalText) {
          setMessages((msgs) => {
            // 避免 fetch ↔ onDone 竞态重复：
            // 若 fetch 已恢复持久化的 assistant 消息（末条已是 assistant），
            // 说明后端 saveMessage 在 onDone 前完成，不再追加第二条
            if (msgs[msgs.length - 1]?.role === 'assistant') return msgs;
            return [...msgs, { role: 'assistant', content: finalText, sources: finalSources }];
          });
          // 同步到缓存
          if (currentSSEConvRef.current) {
            const cached = convMessagesRef.current.get(currentSSEConvRef.current) || [];
            cached.push({ role: 'assistant', content: finalText, sources: finalSources });
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
        sourcesRef.current = srcs;
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
    // 点击当前对话 — 无需切换
    if (convId === activeConvRef.current) return;

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

    // ── 先恢复目标对话的 live 状态，再更新 activeConvRef ──
    // 避免 SSE onToken 在 ref 已更新但 live 尚未恢复时覆盖流式状态
    const live = convLiveRef.current.get(convId);
    if (live) {
      setStreaming(live.streaming);
      setThinking(live.thinking);
      sourcesRef.current = live.sources;
    } else {
      setStreaming('');
      setThinking(false);
      sourcesRef.current = [];
    }

    // 同步更新 ref（SSE 回调据此判断前台/后台路由）
    activeConvRef.current = convId;
    setActiveConvId(convId);
    setLoadingHistory(true);

    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/chat/conversations/${convId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const msgs: Message[] = data.messages.map((m: any) => ({
        role: m.role,
        content: m.content,
        sources: m.sources || undefined,
      }));
      convMessagesRef.current.set(convId, msgs);
      setMessages(msgs);
    } catch {
      antMsg.error('加载对话失败');
    } finally {
      setLoadingHistory(false);
    }
  }, []); // 空依赖：通过 refs 读取最新 streaming/thinking/sources/messages

  // ── 当前显示的实时状态 ──
  const displayStreaming = streaming;
  const displayThinking = thinking;
  // 流式期间从 ref 取 sources（消息尚未写入 messages 数组），
  // 非流式期间从最后一条 assistant 消息的 sources 字段取
  const displaySources: SourceRef[] = (displayStreaming
    ? sourcesRef.current
    : (() => {
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'assistant' && messages[i].sources) {
            return messages[i].sources;
          }
        }
        return [];
      })()) as SourceRef[];

  // ── 同步最新 state 到 ref（供 useCallback 中读取，避免依赖频繁更新的 state） ──
  messagesRef.current = messages;
  streamingRef.current = streaming;
  thinkingRef.current = thinking;
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
              <div className="chat-bubble-wrapper">
                <div className={`chat-bubble ${m.role}`}>{m.content}</div>
                {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                  <div className="chat-sources">
                    <div className="chat-sources-header">
                      <span>📎 参考来源</span>
                    </div>
                    <div className="chat-sources-cards">
                      {m.sources.map((s) => (
                        <SourceCard key={s.docId} source={s} onClick={() => setSourceDetailDocId(s.docId)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
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
              <div className="chat-bubble-wrapper">
                <div className="chat-bubble assistant streaming">{displayStreaming}</div>
                {displaySources.length > 0 && (
                  <div className="chat-sources">
                    <div className="chat-sources-header">
                      <span>📎 参考来源</span>
                    </div>
                    <div className="chat-sources-cards">
                      {displaySources.map((s) => (
                        <SourceCard key={s.docId} source={s} onClick={() => setSourceDetailDocId(s.docId)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
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
