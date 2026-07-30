import { useState, useEffect } from 'react';
import { Table, Button, Modal, Popconfirm, Tag, Spin, App } from 'antd';
import { EyeOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../../services/api';

const statusColorMap: Record<string, string> = {
  indexed: 'green',
  failed: 'red',
  indexing: 'blue',
  parsed: 'gold',
  uploading: 'default',
  parsing: 'gold',
};

export default function DocumentManagePage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ markdown: string; metadata?: any } | null>(null);
  const { message } = App.useApp();

  useEffect(() => {
    loadDocuments();
  }, []);

  async function loadDocuments() {
    setLoading(true);
    try {
      const { data } = await api.get('/documents', { params: { pageSize: 100 } });
      setDocuments(data.items);
    } catch {
      message.error('加载文档列表失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/documents/${id}`);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      message.success('删除成功');
    } catch {
      message.error('删除失败');
    }
  }

  async function handlePreview(id: string) {
    try {
      const { data } = await api.get(`/documents/${id}/preview`);
      setPreview(data);
    } catch {
      message.error('预览失败');
    }
  }

  async function handleReindex(id: string) {
    try {
      await api.post(`/documents/${id}/reindex`);
      message.success('重索引已触发');
      loadDocuments();
    } catch {
      message.error('重索引失败');
    }
  }

  if (loading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '类型', dataIndex: 'type', key: 'type' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <Tag color={statusColorMap[s] || 'default'}>{s}</Tag>,
    },
    {
      title: '上传时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (d: string) => (d ? new Date(d).toLocaleDateString() : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: any) => (
        <Button.Group>
          <Button size="small" icon={<EyeOutlined />} onClick={() => handlePreview(record.id)}>预览</Button>
          {record.status === 'failed' && (
            <Button size="small" icon={<ReloadOutlined />} onClick={() => handleReindex(record.id)}>重索引</Button>
          )}
          <Popconfirm title="确定要删除此文档吗？此操作不可撤销。" onConfirm={() => handleDelete(record.id)} okText="确定" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Button.Group>
      ),
    },
  ];

  return (
    <div>
      <h1 style={{ marginBottom: 16, fontSize: 20 }}>📂 文档管理</h1>
      <Table columns={columns} dataSource={documents} rowKey="id" />

      <Modal
        title={preview?.metadata?.name || '预览'}
        open={!!preview}
        onCancel={() => setPreview(null)}
        footer={<Button onClick={() => setPreview(null)}>关闭</Button>}
        width={800}
      >
        <pre style={{ maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {preview?.markdown}
        </pre>
      </Modal>
    </div>
  );
}
