import { useState, useRef, useEffect, useCallback } from 'react';
import { Input, Button, message as antMsg } from 'antd';
import { SendOutlined, UserOutlined, RobotOutlined } from '@ant-design/icons';
import { useSSE } from '../../hooks/useSSE';
import { useVoiceChat } from '../../hooks/useVoiceChat';
import { useTtsPlayer } from '../../hooks/useTtsPlayer';
import VoiceButton from '../../components/chat/VoiceButton';
import ConversationList from '../../components/chat/ConversationList';
import { SourceCard } from '../../components/chat/SourceCard';
import type { SourceRef } from '../../components/chat/SourceCard';
import DocumentDetailDrawer from '../../components/document/DocumentDetailDrawer';
import { chatStore, type ChatMessage, type ConvLive } from '../../stores/chat.store';

/** 模块级 dispatch：SSE 回调通过此对象更新当前挂载组件的 React state。
 *  旧组件卸载后 dispatch 被置 null，SSE 回调自动降级为仅写 chatStore。
 *  新组件挂载后重新赋值，SSE 回调恢复对 React state 的更新。 */
let chatDispatch: {
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setStreaming: React.Dispatch<React.SetStateAction<string>>;
  setThinking: React.Dispatch<React.SetStateAction<boolean>>;
} | null = null;

/** AI 问答页面：左侧对话列表 + 右侧流式 SSE 聊天区 + 语音输入支持 */
export default function ChatPage() {
  // ── 当前展示的对话 state ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [input, setInput] = useState('');
  const [sourceDetailDocId, setSourceDetailDocId] = useState<string | null>(null);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [thinking, setThinking] = useState(false);

  const { sendMessage, abortConv } = useSSE();
  // 使用 chatStore.sessionId 确保跨路由切换不变化 —— voice socket 和 SSE 必须共用一个 sessionId
  const sessionId = chatStore.sessionId;
  const { socket: voiceSocket, isRecording, asrText, triggerMessage, connect, startRecording, stopRecording, clearTrigger } = useVoiceChat(sessionId);
  const { startPlayer, stopPlayer } = useTtsPlayer(voiceSocket);

  // ── 跨对话状态管理 ──
  const activeConvRef = useRef<string | null>(null);
  // 当前 SSE 流所属的会话（用于判断 token/onDone 归属，避免 setState 异步导致的 ref 不同步）
  const currentSSEConvRef = useRef<string | null>(null);
  // 最新 state 的 ref 镜像，用于 useCallback 中读取最新值而不依赖 state
  const messagesRef = useRef<ChatMessage[]>([]);
  const streamingRef = useRef('');
  const thinkingRef = useRef(false);
  const sourcesRef = useRef<SourceRef[]>([]);
  const promptContextRef = useRef<ChatMessage['promptContext']>(null);
  const inputRef = useRef('');
  // 消息列表容器 ref，用于自动滚动
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── 路由切回时从 store 恢复状态（防止消息消失） ──
  // 注意：不能使用 activeConvRef.current 做跳过判断 —— React 18 StrictMode 会保留
  // useRef 值跨越双挂载周期，导致第二次挂载时因 ref 已设置而跳过恢复。
  useEffect(() => {
    const storedConvId = chatStore.activeConvId;
    console.log(`[ChatPage] 恢复检查: storedConvId=${storedConvId} activeConvRef=${activeConvRef.current} dispatcher=${!!chatDispatch}`);
    if (storedConvId) {
      const live = chatStore.convLiveMap.get(storedConvId);
      const msgs = chatStore.convMessagesMap.get(storedConvId);
      console.log(`[ChatPage] 恢复数据: convId=${storedConvId} msgsLen=${msgs?.length ?? 0} liveExists=${!!live} liveStreaming=${live?.streaming?.length ?? 0}chars`);
      // 若缓存中已有 assistant 消息 → 对话已完成，清除残留的 streaming/thinking
      const hasAssistantMsg = msgs && msgs.length > 0 && msgs[msgs.length - 1]?.role === 'assistant';
      console.log(`[ChatPage] 恢复判断: hasAssistantMsg=${hasAssistantMsg}`);
      if (live && !hasAssistantMsg) {
        setStreaming(live.streaming);
        setThinking(live.thinking);
        sourcesRef.current = live.sources;
      } else if (hasAssistantMsg) {
        setStreaming('');
        setThinking(false);
        sourcesRef.current = [];
      }
      if (msgs && msgs.length > 0) {
        setMessages(msgs);
      }
      activeConvRef.current = storedConvId;
      setActiveConvId(storedConvId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 注册模块级 dispatch，供 SSE 回调在组件挂载后更新 React state ──
  // 组件卸载时置 null，SSE 回调自动降级为仅写 chatStore
  useEffect(() => {
    chatDispatch = { setMessages, setStreaming, setThinking };
    return () => { chatDispatch = null; };
  });

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

  // ── 组件卸载时保存当前状态到 chatStore（防止路由切换丢失） ──
  // 仅在有实际数据时保存，避免 React 18 StrictMode 双挂载的中间卸载用空状态覆盖有效数据
  useEffect(() => {
    return () => {
      if (activeConvRef.current) {
        const msgs = messagesRef.current;
        const hasStreaming = streamingRef.current.length > 0;
        const hasThinking = thinkingRef.current;
        console.log(`[ChatPage] 卸载保存: convId=${activeConvRef.current} msgsLen=${msgs.length} streaming=${streamingRef.current.length}chars thinking=${hasThinking} sourcesCount=${sourcesRef.current.length}`);
        // 仅在有流式内容或思考状态时更新 live 状态
        if (hasStreaming || hasThinking) {
          chatStore.convLiveMap.set(activeConvRef.current, {
            streaming: streamingRef.current,
            thinking: thinkingRef.current,
            sources: sourcesRef.current,
          });
        }
        // 仅在有消息时保存消息缓存，防止空数组覆盖有效数据
        if (msgs.length > 0) {
          chatStore.convMessagesMap.set(activeConvRef.current, msgs);
        }
      }
    };
  }, []);

  // ── WebSocket 语音生命周期（含 TTS 播放器） ──
  useEffect(() => {
    const socket = connect(sessionId);
    return () => {
      stopPlayer();
      socket?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // socket 就绪后启动 TTS 播放器
  useEffect(() => {
    if (voiceSocket) startPlayer();
  }, [voiceSocket, startPlayer]);

  // ── 发送消息 ──
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleSend = useCallback(async (voiceText?: string) => {
    const text = (voiceText || inputRef.current).trim();
    if (!text || streamingRef.current) return;
    if (!voiceText) setInput('');

    // 捕获当前会话 ID 到闭包（每个 SSE 流绑定自己的 convId，不受后续其他对话
    // 发送消息时对 chatStore.currentSSESessionConvId 的覆盖影响）。
    // 使用 let 而非 const：新对话首次发送无 convId，后端创建后通过 onConversation
    // 回调更新此值，同一条 SSE 流的后续 onToken/onDone 即可路由到正确的 convId。
    let sseConvId = activeConvRef.current;
    chatStore.currentSSESessionConvId = sseConvId;
    currentSSEConvRef.current = sseConvId;

    /** SSE 事件所属会话是否在前台展示（闭包捕获 sseConvId，隔离多 SSE 流） */
    const isForeground = () => chatStore.activeConvId === sseConvId;

    // 用户消息（幂等守卫防止重复添加）
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'user' && last?.content === text) return prev;
      return [...prev, { role: 'user', content: text }];
    });
    // 同步写入 chatStore
    if (activeConvRef.current) {
      chatStore.appendMessage(activeConvRef.current, { role: 'user', content: text });
      chatStore.convLiveMap.set(activeConvRef.current, { streaming: '', thinking: true, sources: [] });
    }
    setStreaming('');
    sourcesRef.current = [];
    promptContextRef.current = null;
    setThinking(true);

    // 有新消息时刷新对话列表
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('refresh-conversations'));
    }, 100);

    await sendMessage(
      text,
      sessionId,
      // ── onToken ──
      (token) => {
        const key = sseConvId || '__orphan__';
        // 始终更新 chatStore live（模块级，卸载不丢）
        const live = chatStore.convLiveMap.get(key) || { streaming: '', thinking: false, sources: [] };
        live.thinking = false;
        live.streaming += token;
        chatStore.convLiveMap.set(key, live);

        // 若当前在前台，同时更新 React state
        if (isForeground() && chatDispatch) {
          chatDispatch.setThinking(false);
          chatDispatch.setStreaming((prev) => prev + token);
        }
        // 仅在前 3 个 token 打印，避免刷屏
        if (live.streaming.length <= 3) {
          console.log(`[SSE] onToken: key=${key} isFg=${isForeground()} dispatch=${!!chatDispatch} streamingLen=${live.streaming.length}`);
        }
      },
      // ── onDone ──
      () => {
        const key = sseConvId || '__orphan__';
        const live = chatStore.convLiveMap.get(key);
        const finalText = live?.streaming || streamingRef.current;
        const finalSources = (live?.sources?.length ? live.sources : sourcesRef.current.length > 0 ? [...sourcesRef.current] : undefined);
        const finalPromptCtx = promptContextRef.current;

        console.log(`[SSE] onDone: key=${key} isFg=${isForeground()} dispatch=${!!chatDispatch} finalTextLen=${finalText?.length ?? 0} liveStreaming=${live?.streaming?.length ?? 0} streamRefLen=${streamingRef.current?.length ?? 0}`);

        // 始终持久化到 chatStore
        if (finalText) {
          chatStore.appendMessage(key, { role: 'assistant' as const, content: finalText, sources: finalSources, promptContext: finalPromptCtx ?? undefined });
        }
        chatStore.convLiveMap.delete(key);

        // 若当前在前台，同时更新 React state
        if (isForeground() && chatDispatch) {
          chatDispatch.setThinking(false);
          if (finalText) {
            chatDispatch.setMessages((msgs) => {
              if (msgs[msgs.length - 1]?.role === 'assistant') return msgs;
              return [...msgs, { role: 'assistant', content: finalText, sources: finalSources, promptContext: finalPromptCtx ?? undefined }];
            });
          }
          chatDispatch.setStreaming('');
        }
        // 流结束后刷新列表
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('refresh-conversations'));
        }, 300);
      },
      // ── onSources ──
      (srcs) => {
        const key = sseConvId || '__orphan__';
        // 始终更新 chatStore live
        const live = chatStore.convLiveMap.get(key);
        if (live) {
          live.sources = srcs;
          chatStore.convLiveMap.set(key, live);
        }
        // 若当前在前台，同时更新 ref
        if (isForeground()) {
          sourcesRef.current = srcs;
        }
      },
      sseConvId,
      // ── onConversation ──
      (newConvId, isNew) => {
        if (isNew && !sseConvId) {
          // 更新闭包捕获的 sseConvId，使本 SSE 流的后续 onToken/onDone
          // 路由到正确的 convId（而非 fallback '__orphan__'）
          sseConvId = newConvId;
          currentSSEConvRef.current = newConvId;
          activeConvRef.current = newConvId;
          chatStore.setActiveConv(newConvId);
          chatStore.currentSSESessionConvId = newConvId;
          setActiveConvId(newConvId);
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('refresh-conversations'));
          }, 300);
        }
      },
      // ── onPromptContext ──
      (ctx) => {
        promptContextRef.current = ctx;
      },
    );
  }, [sendMessage, sessionId]);

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

    // 清空输入框（防止切换会话时输入文字残留到新会话）
    setInput('');

    // 不中断旧对话的 SSE！保存当前 live 状态 + messages 缓存
    if (activeConvRef.current) {
      chatStore.convLiveMap.set(activeConvRef.current, {
        streaming: streamingRef.current,
        thinking: thinkingRef.current,
        sources: sourcesRef.current,
      });
      // 保存当前 messages 到缓存，防止切换回时消息丢失（修复消息消失 bug）
      const currentMessages = messagesRef.current;
      if (currentMessages.length > 0) {
        chatStore.convMessagesMap.set(activeConvRef.current, currentMessages);
      }
    }

    // ── 先恢复目标对话的 live 状态，再更新 activeConvRef ──
    // 避免 SSE onToken 在 ref 已更新但 live 尚未恢复时覆盖流式状态
    const live = chatStore.convLiveMap.get(convId);
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
    chatStore.setActiveConv(convId);
    setActiveConvId(convId);
    setLoadingHistory(true);

    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/chat/conversations/${convId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const msgs: ChatMessage[] = data.messages.map((m: any) => ({
        role: m.role,
        content: m.content,
        sources: m.sources || undefined,
      }));
      // 若 chatStore 中有更完整的消息（SSE onDone 已写入 assistant 但 DB 尚未落盘），
      // 优先保留 chatStore 数据，避免 API 返回的未完成数据覆盖完整数据
      const stored = chatStore.convMessagesMap.get(convId);
      const preferStore = stored && stored.length > msgs.length;
      const finalMsgs = preferStore ? stored! : msgs;
      if (!preferStore) chatStore.convMessagesMap.set(convId, msgs);
      setMessages(finalMsgs);
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
