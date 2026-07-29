import { useState, useEffect } from 'react';
import api from '../../services/api';

/** 知识库浏览页面：文档列表 */
export default function KnowledgeBasePage() {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/documents').then((res) => {
      setDocs(res.data.items || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div>加载中...</div>;

  return (
    <div className="knowledge-page">
      <h2>📁 知识库文档</h2>
      {docs.length === 0 ? (
        <p>暂无文档，请先上传。</p>
      ) : (
        <table>
          <thead>
            <tr><th>文档名</th><th>类型</th><th>状态</th><th>上传时间</th></tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.name}</td>
                <td>{doc.type}</td>
                <td className={`status-${doc.status}`}>{doc.status}</td>
                <td>{doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
