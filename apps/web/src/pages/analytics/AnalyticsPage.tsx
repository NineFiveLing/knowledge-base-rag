import { useState, useEffect } from 'react';
import { Card, Statistic, Table, Spin, Row, Col } from 'antd';
import { FileTextOutlined, UserOutlined, MessageOutlined, CalendarOutlined } from '@ant-design/icons';
import api from '../../services/api';

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<any>({});
  const [docStats, setDocStats] = useState<any>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/analytics/overview'), api.get('/analytics/documents')])
      .then(([o, d]) => {
        setOverview(o.data);
        setDocStats(d.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;

  const typeColumns = [
    { title: '类型', dataIndex: 'type', key: 'type', render: (t: string) => t || '未知' },
    { title: '数量', dataIndex: 'count', key: 'count' },
  ];

  const statusColumns = [
    { title: '状态', dataIndex: 'status', key: 'status' },
    { title: '数量', dataIndex: 'count', key: 'count' },
  ];

  return (
    <div>
      <h1 style={{ marginBottom: 20, fontSize: 20 }}>📊 数据统计</h1>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="文档总数" value={overview.docCount || 0} prefix={<FileTextOutlined />} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="用户数" value={overview.totalUsers || 0} prefix={<UserOutlined />} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="活跃会话" value={overview.totalSessions || 0} prefix={<MessageOutlined />} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="周活跃用户" value={overview.activeUsers || 0} prefix={<CalendarOutlined />} /></Card>
        </Col>
      </Row>

      {docStats.byType?.length > 0 && (
        <Card title="文档类型分布" style={{ marginBottom: 16 }}>
          <Table columns={typeColumns} dataSource={docStats.byType} rowKey="type" pagination={false} />
        </Card>
      )}

      {docStats.byStatus?.length > 0 && (
        <Card title="文档状态分布">
          <Table columns={statusColumns} dataSource={docStats.byStatus} rowKey="status" pagination={false} />
        </Card>
      )}
    </div>
  );
}
