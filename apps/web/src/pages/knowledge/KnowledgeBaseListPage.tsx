import { useState, useEffect, useCallback } from 'react';
import { Card, Button, Dropdown, App, Empty, Spin, Row, Col } from 'antd';
import { PlusOutlined, EllipsisOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import KnowledgeBaseModal from '../../components/knowledge/KnowledgeBaseModal';

export default function KnowledgeBaseListPage() {
  const [kbs, setKbs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingKb, setEditingKb] = useState<any>(null);
  const { message } = App.useApp();
  const navigate = useNavigate();

  const loadKbs = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/knowledge-bases');
      setKbs(data || []);
    } catch {
      message.error('加载知识库列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadKbs(); }, [loadKbs]);

  const handleDelete = async (id: string, name: string) => {
    try {
      await api.delete(`/knowledge-bases/${id}`);
      message.success(`已删除"${name}"`);
      loadKbs();
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>📚 知识库</h2>
        <Button type="primary" icon={<PlusOutlined />}
          onClick={() => { setEditingKb(null); setModalOpen(true); }}>新建知识库</Button>
      </div>

      {loading ? (
        <Spin style={{ display: 'block', margin: '40px auto' }} />
      ) : kbs.length === 0 ? (
        <Empty description="暂无知识库，点击上方按钮创建" />
      ) : (
        <Row gutter={[16, 16]}>
          {kbs.map((kb) => (
            <Col key={kb.id} xs={24} sm={12} md={8} lg={6}>
              <Card
                hoverable
                title={`📗 ${kb.name}`}
                onClick={() => navigate(`/knowledge/${kb.id}`)}
                extra={
                  <Dropdown menu={{
                    items: [
                      {
                        key: 'edit', icon: <EditOutlined />, label: '编辑',
                        onClick: ({ domEvent }) => {
                          domEvent.stopPropagation();
                          setEditingKb(kb);
                          setModalOpen(true);
                        },
                      },
                      { type: 'divider' },
                      {
                        key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true,
                        onClick: ({ domEvent }) => {
                          domEvent.stopPropagation();
                          handleDelete(kb.id, kb.name);
                        },
                      },
                    ],
                  }} trigger={['click']}>
                    <Button type="text" size="small" icon={<EllipsisOutlined />}
                      onClick={(e) => e.stopPropagation()} />
                  </Dropdown>
                }
              >
                <Card.Meta
                  description={
                    <>
                      <div>{kb.description || '暂无描述'}</div>
                      <div style={{ marginTop: 8, color: '#888' }}>
                        {kb.docCount ?? 0} 个文档
                      </div>
                    </>
                  }
                />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <KnowledgeBaseModal
        open={modalOpen}
        knowledgeBase={editingKb}
        onClose={() => { setModalOpen(false); setEditingKb(null); }}
        onSuccess={loadKbs}
      />
    </div>
  );
}
