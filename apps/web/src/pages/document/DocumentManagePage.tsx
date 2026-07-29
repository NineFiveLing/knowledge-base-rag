import { useState, useEffect } from 'react';
import api from '../../services/api';

/** 文档管理页面：列表/删除/预览/重索引 */
export default function DocumentManagePage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<any>(null);

  useEffect(() => { loadDocuments(); }, []);

  async function loadDocuments() {
    try {
      const { data } = await api.get('/documents', { params: { pageSize: 100 } });
      setDocuments(data.items);
    } catch (err) { console.error('加载文档列表失败', err); }
    finally { setLoading(false); }
  }

  async function handleDelete(id: string, docName: string) {
    if (!confirm(`确定要删除「${docName}」吗？此操作不可撤销。`)) return;
    try {
      await api.delete(`/documents/${id}`);
      setDocuments(prev => prev.filter(d => d.id !== id));
    } catch (err) { console.error('删除失败', err); }
  }

  async function handlePreview(id: string) {
    try {
      const { data } = await api.get(`/documents/${id}/preview`);
      setPreview(data);
    } catch (err) { console.error('预览失败', err); }
  }

  async function handleReindex(id: string) {
    try {
      await api.post(`/documents/${id}/reindex`);
      loadDocuments();
    } catch (err) { console.error('重索引失败', err); }
  }

  const statusColors: Record<string, string> = {
    indexed: '#52c41a', failed: '#ff4d4f', indexing: '#1890ff',
    parsed: '#faad14', uploading: '#bfbfbf', parsing: '#faad14',
  };

  if (loading) return <div className="page-loading">加载中...</div>;

  return (
    <div className="document-manage-page">
      <h1>📂 文档管理</h1>

      {documents.length === 0 ? (
        <div className="empty-state">暂无文档，请先上传</div>
      ) : (
        <table>
          <thead>
            <tr><th>名称</th><th>类型</th><th>状态</th><th>上传时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            {documents.map(doc => (
              <tr key={doc.id}>
                <td>{doc.name}</td>
                <td>{doc.type}</td>
                <td><span style={{ color: statusColors[doc.status] }}>● {doc.status}</span></td>
                <td>{new Date(doc.created_at).toLocaleDateString()}</td>
                <td>
                  <button onClick={() => handlePreview(doc.id)}>预览</button>
                  {doc.status === 'failed' && (
                    <button onClick={() => handleReindex(doc.id)}>重索引</button>
                  )}
                  <button className="danger" onClick={() => handleDelete(doc.id, doc.name)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2>{preview.metadata?.name}</h2>
            <pre className="markdown-preview">{preview.markdown}</pre>
            <button onClick={() => setPreview(null)}>关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}
