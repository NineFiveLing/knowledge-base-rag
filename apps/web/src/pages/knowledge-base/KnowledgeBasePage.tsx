import { useState, useEffect } from 'react';
import { Table, Spin, Empty, Tag } from 'antd';
import api from '../../services/api';

const statusColorMap: Record<string, string> = {
  indexed: 'green',
  failed: 'red',
  indexing: 'blue',
  parsed: 'gold',
  uploading: 'default',
  parsing: 'gold',
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
      render: (status: string) => <Tag color={statusColorMap[status] || 'default'}>{status}</Tag>,
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
