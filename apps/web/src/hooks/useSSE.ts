import { useCallback, useRef } from 'react';

interface SSEEvent {
  type: 'text' | 'sources' | 'conversation';
  content?: string;
  sources?: Array<{ index: number; docId: string; chunkId: string; docName: string; docType: string; docSize: number }>;
  conversationId?: string;
  isNew?: boolean;
}

/** SSE 流式聊天 Hook：发送消息，接收逐 Token 流，支持按对话中断 */
export function useSSE() {
  /** 每对话一个 AbortController（切换对话时不断流，仅删除对话时中断） */
  const abortMapRef = useRef<Map<string, AbortController>>(new Map());

  /** 中断指定对话的 SSE */
  const abortConv = useCallback((convId: string) => {
    const ctrl = abortMapRef.current.get(convId);
    if (ctrl) {
      ctrl.abort();
      abortMapRef.current.delete(convId);
    }
  }, []);

  const sendMessage = useCallback(
    async (
      message: string,
      sessionId: string,
      onToken: (token: string) => void,
      onDone: () => void,
      onSources?: (sources: Array<{ index: number; docId: string; chunkId: string; docName: string; docType: string; docSize: number }>) => void,
      conversationId?: string | null,
      onConversation?: (conversationId: string, isNew: boolean) => void,
    ) => {
      const controller = new AbortController();
      const convKey = conversationId || '__new__';
      abortMapRef.current.set(convKey, controller);

      const token = localStorage.getItem('access_token');
      const body: any = { message, sessionId };
      if (conversationId) body.conversationId = conversationId;

      try {
        const response = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (!controller.signal.aborted) onDone();
            break;
          }
          if (controller.signal.aborted) {
            reader.cancel();
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
            try {
              const data: SSEEvent = JSON.parse(line.slice(6));
              if (data.type === 'text' && data.content) {
                onToken(data.content);
              } else if (data.type === 'sources' && onSources && data.sources) {
                onSources(data.sources);
              } else if (data.type === 'conversation' && data.conversationId) {
                onConversation?.(data.conversationId, data.isNew ?? false);
              }
            } catch { /* skip malformed */ }
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        throw err;
      } finally {
        if (abortMapRef.current.get(convKey) === controller) {
          abortMapRef.current.delete(convKey);
        }
      }
    },
    [],
  );

  return { sendMessage, abortConv };
}
