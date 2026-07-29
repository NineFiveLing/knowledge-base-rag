import { useState, useRef } from 'react';
import { useSSE } from '../../hooks/useSSE';

interface Message { role: 'user' | 'assistant'; content: string; }

/** AI 问答页面：流式 SSE 接收回答 */
export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState('');
  const [input, setInput] = useState('');
  const [sources, setSources] = useState<Array<{ index: number; docId: string; chunkId: string }>>([]);
  const { sendMessage } = useSSE();
  const sessionId = useRef(`sess-${Date.now()}`).current;

  const handleSend = async () => {
    if (!input.trim() || streaming) return;
    const text = input.trim();
    setInput('');
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
        {streaming && <div className="chat-bubble assistant streaming">{streaming}</div>}
      </div>
      {sources.length > 0 && (
        <div className="sources-bar">
          <span className="sources-label">参考来源：</span>
          {sources.map((s) => (
            <span key={s.index} className="source-tag" title={`文档: ${s.docId} | 片段: ${s.chunkId}`}>
              [{s.index}]
            </span>
          ))}
        </div>
      )}
      <div className="chat-input-area">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="输入您的问题..." disabled={!!streaming} />
        <button onClick={handleSend} disabled={!!streaming}>发送</button>
      </div>
    </div>
  );
}
