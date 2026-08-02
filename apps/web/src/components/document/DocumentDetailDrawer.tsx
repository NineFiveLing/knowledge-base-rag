import { Drawer, Descriptions, Table, Tag, Spin, App, Button } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useEffect, useState, useRef } from 'react';
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

/** 可在浏览器内直接渲染为文本的类型 */
const TEXT_RENDERABLE = new Set(['text', 'markdown', 'json', 'xml', 'csv']);
/** 浏览器可内嵌预览的类型 */
const EMBEDDABLE = new Set(['pdf', 'image', 'audio', 'video']);

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
  const [rawContent, setRawContent] = useState<string>('');
  const [blobUrl, setBlobUrl] = useState<string>('');
  const [fileLoading, setFileLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();

  // 用 ref 跟踪当前 blob URL，确保 cleanup 能访问最新值（避免闭包过期导致媒体未释放）
  const blobUrlRef = useRef<string>('');

  useEffect(() => {
    if (open && docId) {
      setLoading(true);
      setDoc(null);
      setVersions([]);
      setRawContent('');
      setBlobUrl('');
      blobUrlRef.current = '';

      api.get(`/documents/${docId}`)
        .then(r => {
          setDoc(r.data);
          return r.data;
        })
        .then((docData) => {
          // 加载原始文件内容
          setFileLoading(true);
          const token = localStorage.getItem('access_token');
          if (TEXT_RENDERABLE.has(docData.type)) {
            // 文本类文件：直接拉取文本内容展示
            fetch(`/api/documents/${docId}/file`, {
              headers: { Authorization: `Bearer ${token}` },
            })
              .then(r => r.text())
              .then(setRawContent)
              .catch(() => message.error('加载文件内容失败'))
              .finally(() => setFileLoading(false));
          } else {
            // 非文本文件：拉取 blob 用于内嵌预览
            fetch(`/api/documents/${docId}/file`, {
              headers: { Authorization: `Bearer ${token}` },
            })
              .then(r => r.blob())
              .then(blob => {
                const url = URL.createObjectURL(blob);
                blobUrlRef.current = url;
                setBlobUrl(url);
              })
              .catch(() => {})
              .finally(() => setFileLoading(false));
          }
        })
        .catch(() => message.error('加载文档详情失败'))
        .finally(() => setLoading(false));

      api.get(`/documents/${docId}/versions`)
        .then(r => setVersions(r.data))
        .catch(() => {});
    }
    return () => {
      // 通过 ref 访问最新 blob URL，避免闭包过期
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = '';
      }
    };
  }, [open, docId]);

  const versionColumns = [
    { title: '版本', dataIndex: 'version', key: 'version' },
    { title: '文件名', dataIndex: 'name', key: 'name' },
    { title: '大小', dataIndex: 'size', key: 'size', render: (s: number) => formatSize(s) },
    { title: '归档时间', dataIndex: 'created_at', key: 'created_at',
      render: (d: string) => d ? new Date(d).toLocaleString() : '-' },
  ];

  return (
    <Drawer
      title="文档详情"
      open={open}
      onClose={onClose}
      width={720}
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

          {/* ── 原文件预览 ── */}
          {doc && (
            <div style={{ marginBottom: 24 }}>
              <h4>📄 原文件预览</h4>
              {fileLoading ? (
                <Spin />
              ) : TEXT_RENDERABLE.has(doc.type) ? (
                rawContent ? (
                  <pre style={{
                    background: '#f9fafb', padding: 16, borderRadius: 8,
                    whiteSpace: 'pre-wrap', maxHeight: 500, overflow: 'auto',
                    border: '1px solid #f0f0f0', fontSize: 13, lineHeight: 1.6,
                    margin: 0,
                  }}>{rawContent}</pre>
                ) : (
                  <p style={{ color: '#999' }}>暂无内容</p>
                )
              ) : EMBEDDABLE.has(doc.type) ? (
                blobUrl ? (
                  <iframe
                    src={blobUrl}
                    title="原文件预览"
                    style={{
                      width: '100%', height: 500, border: '1px solid #f0f0f0',
                      borderRadius: 8, background: '#fff',
                    }}
                  />
                ) : (
                  <p style={{ color: '#999' }}>无法预览</p>
                )
              ) : (
                /* Office 等无法浏览器内预览的类型：提供下载按钮 */
                <div style={{
                  background: '#f9fafb', padding: 24, borderRadius: 8,
                  border: '1px solid #f0f0f0', textAlign: 'center',
                }}>
                  <p style={{ color: '#666', marginBottom: 12 }}>
                    此文件类型（{doc.type}）不支持在线预览，请下载后查看
                  </p>
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    onClick={() => {
                      const token = localStorage.getItem('access_token');
                      const a = document.createElement('a');
                      a.href = `/api/documents/${docId}/download`;
                      // blob 方式下载可携带 auth header
                      fetch(`/api/documents/${docId}/download`, {
                        headers: { Authorization: `Bearer ${token}` },
                      })
                        .then(r => r.blob())
                        .then(blob => {
                          const url = URL.createObjectURL(blob);
                          a.href = url;
                          a.download = doc.name;
                          a.click();
                          URL.revokeObjectURL(url);
                        })
                        .catch(() => message.error('下载失败'));
                    }}
                  >
                    下载原文件
                  </Button>
                </div>
              )}
            </div>
          )}

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
