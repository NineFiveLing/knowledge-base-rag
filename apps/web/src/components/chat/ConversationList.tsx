import { useState, useEffect } from 'react';
import { Button, List, Dropdown, Typography, Modal, Input } from 'antd';
import { PlusOutlined, MoreOutlined, EditOutlined, DeleteOutlined, MessageOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
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
  // 重命名 Modal 状态
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingConv, setEditingConv] = useState<Conversation | null>(null);
  const [editTitle, setEditTitle] = useState('');

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

  useEffect(() => {
    const handler = () => { fetchList(); };
    window.addEventListener('refresh-conversations', handler);
    return () => { window.removeEventListener('refresh-conversations', handler); };
  }, []);

  const handleNew = async () => {
    const res = await api.post('/chat/conversations', { title: '新对话' });
    const conv = res.data;
    // 立即插入列表顶部，不等待后端刷新排序（新建空会话没有消息，updated_at 必定 ≤ 有消息的会话）
    setConversations((prev) => [conv, ...prev]);
    onSelect(conv.id);
  };

  const handleDelete = async (id: string) => {
    await api.delete(`/chat/conversations/${id}`);
    await fetchList();
    if (activeId === id) onSelect('');
  };

  const handleStartRename = (conv: Conversation) => {
    setEditingConv(conv);
    setEditTitle(conv.title);
    setEditModalOpen(true);
  };

  const handleRenameConfirm = async () => {
    if (!editingConv || !editTitle.trim()) return;
    await api.patch(`/chat/conversations/${editingConv.id}`, { title: editTitle.trim() });
    setEditModalOpen(false);
    setEditingConv(null);
    fetchList();
  };

  const getMenuItems = (item: Conversation): MenuProps['items'] => [
    {
      key: 'edit',
      label: '编辑标题',
      icon: <EditOutlined />,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        handleStartRename(item);
      },
    },
    { type: 'divider' },
    {
      key: 'delete',
      label: '删除',
      icon: <DeleteOutlined />,
      danger: true,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        handleDelete(item.id);
      },
    },
  ];

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
              <Dropdown
                key="more"
                menu={{ items: getMenuItems(item) }}
                trigger={['click']}
                placement="bottomRight"
              >
                <Button
                  type="text"
                  size="small"
                  icon={<MoreOutlined />}
                  onClick={(e) => e.stopPropagation()}
                />
              </Dropdown>,
            ]}
          >
            <List.Item.Meta
              avatar={<MessageOutlined />}
              title={item.title.length > 24 ? `${item.title.slice(0, 24)}...` : item.title}
              description={new Date(item.updated_at).toLocaleDateString()}
            />
          </List.Item>
        )}
      />

      {/* 重命名 Modal */}
      <Modal
        title="编辑对话标题"
        open={editModalOpen}
        onOk={handleRenameConfirm}
        onCancel={() => setEditModalOpen(false)}
        okText="确定"
        cancelText="取消"
      >
        <Input
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onPressEnter={handleRenameConfirm}
          placeholder="请输入新标题"
          maxLength={100}
        />
      </Modal>
    </div>
  );
}
