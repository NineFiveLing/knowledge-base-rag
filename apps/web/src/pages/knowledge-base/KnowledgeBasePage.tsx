import { useState, useEffect } from 'react';
import { Table, Spin, Empty, Tag } from 'antd';
import api from '../../services/api';

// ── 后端状态 → 前端四态映射（与 DocumentManagePage 一致） ──
function toFrontendStatus(status: string): string {
  switch (status) {
    case 'uploading': case 'parsing': case 'parsed': case 'indexing':
      return 'uploading';
    case 'indexed':   return 'indexed';
    case 'failed':    return 'failed';
    case 'cancelled': return 'cancelled';
    default:          return 'failed';
  }
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  uploading:  { label: '上传中', color: 'blue' },
  cancelled:  { label: '已取消', color: 'default' },
  indexed:    { label: '已上传', color: 'green' },
  failed:     { label: '已失败', color: 'red' },
};

export default function KnowledgeBasePage() {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/documents')
      .then((res) => setDocs(res.data.items || []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;

  const columns = [
    { title: '文档名', dataIndex: 'name', key: 'name' },
    { title: '类型', dataIndex: 'type', key: 'type' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => {
        const fs = STATUS_MAP[toFrontendStatus(s)] || { label: s, color: 'default' };
        return <Tag color={fs.color}>{fs.label}</Tag>;
      },
    },
    {
      title: '上传时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (d: string) => (d ? new Date(d).toLocaleDateString() : '-'),
    },
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 16, fontSize: 20 }}>📁 知识库文档</h2>
      <Table
        columns={columns}
        dataSource={docs}
        rowKey="id"
        locale={{ emptyText: <Empty description="暂无文档，请先上传" /> }}
      />
    </div>
  );
}
