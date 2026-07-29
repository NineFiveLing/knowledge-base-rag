import { useState, useEffect } from 'react';
import api from '../../services/api';

/** 统计仪表盘：文档/用户/会话数据概览 */
export default function AnalyticsPage() {
  const [overview, setOverview] = useState<any>({});
  const [docStats, setDocStats] = useState<any>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/analytics/overview'),
      api.get('/analytics/documents'),
    ]).then(([overviewRes, docRes]) => {
      setOverview(overviewRes.data);
      setDocStats(docRes.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-loading">加载中...</div>;

  return (
    <div className="analytics-page">
      <h1>📊 数据统计</h1>

      <div className="stat-cards">
        <div className="stat-card">📄 文档总数: <strong>{overview.docCount}</strong></div>
        <div className="stat-card">👥 用户数: <strong>{overview.totalUsers}</strong></div>
        <div className="stat-card">💬 活跃会话: <strong>{overview.totalSessions}</strong></div>
        <div className="stat-card">📅 周活跃: <strong>{overview.activeUsers}</strong></div>
      </div>

      {docStats.byType?.length > 0 && (
        <div className="stat-section">
          <h2>文档类型分布</h2>
          <table>
            <thead><tr><th>类型</th><th>数量</th></tr></thead>
            <tbody>
              {docStats.byType.map((item: any) => (
                <tr key={item.type}><td>{item.type || '未知'}</td><td>{item.count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {docStats.byStatus?.length > 0 && (
        <div className="stat-section">
          <h2>文档状态分布</h2>
          <table>
            <thead><tr><th>状态</th><th>数量</th></tr></thead>
            <tbody>
              {docStats.byStatus.map((item: any) => (
                <tr key={item.status}><td>{item.status}</td><td>{item.count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
