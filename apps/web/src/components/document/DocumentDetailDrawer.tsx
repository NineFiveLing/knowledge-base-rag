import { Drawer, Descriptions, Table, Tag, Spin, App } from 'antd';
import { useEffect, useState } from 'react';
import api from '../../services/api';

const STATUS_LABELS: Record<string, string> = {
  uploading: '上传中', parsing: '上传中', parsed: '上传中', indexing: '上传中',
  indexed: '已上传', failed: '已失败', cancelled: '已取消',
};

const STATUS_COLORS: Record<string, string> = {
  uploading: 'blue', parsing: 'blue', parsed: 'blue', indexing: 'blue',
  indexed: 'green', failed: 'red', cancelled: 'default',
};

const VIS_LABELS: Record<string, string> = {
  public: '公开', dept: '部门', private: '私有',
};

function formatSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  open: boolean;
  docId: string | null;
  onClose: () => void;
}

export default function DocumentDetailDrawer({ open, docId, onClose }: Props) {
  const [doc, setDoc] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();

  useEffect(() => {
    if (open && docId) {
      setLoading(true);
      // 详情和版本独立请求，版本失败不影响详情展示
      api.get(`/documents/${docId}`)
        .then(r => setDoc(r.data))
        .catch(() => message.error('加载文档详情失败'))
        .finally(() => setLoading(false));

      api.get(`/documents/${docId}/versions`)
        .then(r => setVersions(r.data))
        .catch(() => { /* 版本列表加载失败不提示，静默降级为空列表 */ });
    }
  }, [open, docId]);

  const versionColumns = [
    { title: '版本', dataIndex: 'version', key: 'version' },
    { title: '文件名', dataIndex: 'name', key: 'name' },
    {
      title: '大小', dataIndex: 'size', key: 'size',
      render: (s: number) => formatSize(s),
    },
    {
      title: '归档时间', dataIndex: 'created_at', key: 'created_at',
      render: (d: string) => d ? new Date(d).toLocaleString() : '-',
    },
  ];

  return (
    <Drawer
      title="文档详情"
      open={open}
      onClose={onClose}
      width={640}
    >
      {loading ? <Spin /> : doc && (
        <>
          <Descriptions column={2} bordered size="small" style={{ marginBottom: 24 }}>
            <Descriptions.Item label="文件名">{doc.name}</Descriptions.Item>
            <Descriptions.Item label="类型">{doc.type}</Descriptions.Item>
            <Descriptions.Item label="大小">{formatSize(doc.size)}</Descriptions.Item>
            <Descriptions.Item label="版本">v{doc.version}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={STATUS_COLORS[doc.status]}>
                {STATUS_LABELS[doc.status] || doc.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="可见性">
              {VIS_LABELS[doc.visibility] || doc.visibility}
            </Descriptions.Item>
            <Descriptions.Item label="上传时间" span={2}>
              {doc.created_at ? new Date(doc.created_at).toLocaleString() : '-'}
            </Descriptions.Item>
          </Descriptions>

          <h4>📜 历史版本</h4>
          {versions.length === 0 ? (
            <p style={{ color: '#999' }}>暂无历史版本</p>
          ) : (
            <Table
              columns={versionColumns}
              dataSource={versions}
              rowKey="id"
              size="small"
              pagination={false}
            />
          )}
        </>
      )}
    </Drawer>
  );
}
