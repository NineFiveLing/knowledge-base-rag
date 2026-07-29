import { useCallback } from 'react';

/** SSE 流式聊天 Hook：发送消息，接收逐 Token 流 */
export function useSSE() {
  const sendMessage = useCallback(
    async (
      message: string,
      sessionId: string,
      onToken: (token: string) => void,
      onDone: () => void,
    ) => {
      const token = localStorage.getItem('access_token');
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message, sessionId }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) { onDone(); break; }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'text') onToken(data.content);
            } catch { /* skip malformed */ }
          }
        }
      }
    },
    [],
  );

  return { sendMessage };
}
