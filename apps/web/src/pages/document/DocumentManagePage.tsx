import { useState, useEffect, useCallback } from 'react';
import { Table, Button, Popconfirm, Tag, Space, App } from 'antd';
import {
  EyeOutlined, DownloadOutlined, EditOutlined,
  SwapOutlined, CloseCircleOutlined, DeleteOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import SearchBar from '../../components/document/SearchBar';
import DocumentEditModal from '../../components/document/DocumentEditModal';
import DocumentReplaceModal from '../../components/document/DocumentReplaceModal';
import DocumentDetailDrawer from '../../components/document/DocumentDetailDrawer';

// ── 后端状态 → 前端四态映射 ──
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

const TYPE_ICONS: Record<string, string> = {
  pdf: '📕', word: '📝', excel: '📊', ppt: '📽️',
  markdown: '📄', text: '📃', image: '🖼️', audio: '🎵', video: '🎬',
};

function formatSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentManagePage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<{ keyword?: string; type?: string; status?: string }>({});

  // 弹窗状态
  const [editDoc, setEditDoc] = useState<any>(null);
  const [replaceDoc, setReplaceDoc] = useState<any>(null);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);

  const { message } = App.useApp();
  const navigate = useNavigate();

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize };
      if (filters.keyword) params.keyword = filters.keyword;
      if (filters.type) params.type = filters.type;
      if (filters.status) params.status = filters.status;
      const { data } = await api.get('/documents', { params });
      setDocuments(data.items || []);
      setTotal(data.total || 0);
    } catch {
      message.error('加载文档列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  // 轮询：有 uploading 状态时每 5 秒刷新
  useEffect(() => {
    const hasUploading = documents.some(d => toFrontendStatus(d.status) === 'uploading');
    if (!hasUploading) return;
    const timer = setInterval(loadDocuments, 5000);
    return () => clearInterval(timer);
  }, [documents, loadDocuments]);

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/documents/${id}`);
      setDocuments(prev => prev.filter(d => d.id !== id));
      message.success('删除成功');
    } catch { message.error('删除失败'); }
  };

  const handleCancel = async (id: string) => {
    try {
      await api.post(`/documents/${id}/cancel`);
      message.success('已取消上传');
      loadDocuments();
    } catch (err: any) { message.error(err.response?.data?.message || '取消失败'); }
  };

  const handleViewFile = async (id: string) => {
    try {
      const res = await api.get(`/documents/${id}/file`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data);
      window.open(blobUrl, '_blank');
    } catch { message.error('查看文件失败'); }
  };

  const handleDownload = async (id: string) => {
    try {
      const res = await api.get(`/documents/${id}/download`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = blobUrl;
      const disposition = res.headers['content-disposition'];
      const match = disposition?.match(/filename="?([^"]+)"?/);
      a.download = match?.[1] || 'download';
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch { message.error('下载文件失败'); }
  };

  const columns = [
    {
      title: '名称', dataIndex: 'name', key: 'name',
      render: (name: string, record: any) => (
        <a onClick={() => setDetailDocId(record.id)} style={{ cursor: 'pointer' }}>
          {TYPE_ICONS[record.type] || '📄'} {name}
        </a>
      ),
    },
    { title: '类型', dataIndex: 'type', key: 'type', width: 80 },
    {
      title: '大小', dataIndex: 'size', key: 'size', width: 100,
      render: (s: number) => formatSize(s),
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (s: string) => {
        const fs = STATUS_MAP[toFrontendStatus(s)] || { label: s, color: 'default' };
        return <Tag color={fs.color}>{fs.label}</Tag>;
      },
    },
    {
      title: '上传时间', dataIndex: 'created_at', key: 'created_at', width: 120,
      render: (d: string) => d ? new Date(d).toLocaleDateString() : '-',
    },
    {
      title: '操作', key: 'actions', width: 300,
      render: (_: unknown, record: any) => {
        const fs = toFrontendStatus(record.status);
        return (
          <Space size="small" wrap>
            {/* 👁 查看 — 全部状态 */}
            <Button size="small" icon={<EyeOutlined />}
              onClick={() => handleViewFile(record.id)}>查看</Button>

            {/* 📥 下载 — 仅已上传 */}
            {fs === 'indexed' && (
              <Button size="small" icon={<DownloadOutlined />}
                onClick={() => handleDownload(record.id)}>下载</Button>
            )}

            {/* ✏️ 编辑 — 仅已上传 */}
            {fs === 'indexed' && (
              <Button size="small" icon={<EditOutlined />}
                onClick={() => setEditDoc(record)}>编辑</Button>
            )}

            {/* 🔄 替换 — 已取消 / 已上传 / 已失败 */}
            {(fs === 'cancelled' || fs === 'indexed' || fs === 'failed') && (
              <Button size="small" icon={<SwapOutlined />}
                onClick={() => setReplaceDoc(record)}>替换</Button>
            )}

            {/* ❌ 取消 — 仅上传中 */}
            {fs === 'uploading' && (
              <Popconfirm title="确定要取消上传吗？" onConfirm={() => handleCancel(record.id)}>
                <Button size="small" icon={<CloseCircleOutlined />}>取消</Button>
              </Popconfirm>
            )}

            {/* 🗑 删除 — 已取消 / 已上传 / 已失败 */}
            {(fs === 'cancelled' || fs === 'indexed' || fs === 'failed') && (
              <Popconfirm title="确定删除？此操作不可撤销。" onConfirm={() => handleDelete(record.id)}>
                <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>📂 文档管理</h1>
        <Button type="primary" icon={<PlusOutlined />}
          onClick={() => navigate('/documents')}>上传文档</Button>
      </div>

      <SearchBar onSearch={(f) => { setFilters(f); setPage(1); }} />

      <Table
        columns={columns}
        dataSource={documents}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 篇文档`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />

      <DocumentEditModal
        open={!!editDoc}
        document={editDoc}
        onClose={() => setEditDoc(null)}
        onSuccess={loadDocuments}
      />

      <DocumentReplaceModal
        open={!!replaceDoc}
        document={replaceDoc}
        onClose={() => setReplaceDoc(null)}
        onSuccess={loadDocuments}
      />

      <DocumentDetailDrawer
        open={!!detailDocId}
        docId={detailDocId}
        onClose={() => setDetailDocId(null)}
      />
    </div>
  );
}
