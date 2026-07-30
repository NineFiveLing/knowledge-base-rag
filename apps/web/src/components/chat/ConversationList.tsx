import { useState, useEffect } from 'react';
import { Button, List, Popconfirm, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined, MessageOutlined } from '@ant-design/icons';
import api from '../../services/api';

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface Props {
  activeId: string | null;
  onSelect: (id: string) => void;
}

export default function ConversationList({ activeId, onSelect }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await api.get('/chat/conversations', { params: { pageSize: 50 } });
      setConversations(res.data.items || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, []);

  /** 监听外部刷新事件（例如新对话自动创建后） */
  useEffect(() => {
    const handler = () => { fetchList(); };
    window.addEventListener('refresh-conversations', handler);
    return () => { window.removeEventListener('refresh-conversations', handler); };
  }, []);

  const handleNew = async () => {
    const res = await api.post('/chat/conversations', { title: '新对话' });
    const conv = res.data;
    await fetchList();
    onSelect(conv.id);
  };

  const handleDelete = async (id: string) => {
    await api.delete(`/chat/conversations/${id}`);
    await fetchList();
    if (activeId === id) onSelect('');
  };

  return (
    <div className="conversation-list">
      <div className="conversation-list-header">
        <Typography.Text strong>对话列表</Typography.Text>
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleNew}>
          新建
        </Button>
      </div>
      <List
        loading={loading}
        dataSource={conversations}
        locale={{ emptyText: '暂无对话' }}
        renderItem={(item) => (
          <List.Item
            className={`conversation-item ${item.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(item.id)}
            actions={[
              <Popconfirm
                key="del"
                title="确定删除此对话？"
                onConfirm={(e) => {
                  e?.stopPropagation();
                  handleDelete(item.id);
                }}
                onCancel={(e) => e?.stopPropagation()}
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(e) => e.stopPropagation()}
                />
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              avatar={<MessageOutlined />}
              title={item.title.length > 20 ? `${item.title.slice(0, 20)}...` : item.title}
              description={new Date(item.updated_at).toLocaleDateString()}
            />
          </List.Item>
        )}
      />
    </div>
  );
}
