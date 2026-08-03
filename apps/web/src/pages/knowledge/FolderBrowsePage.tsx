import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Breadcrumb, Button, Tree, Table, Tag, Dropdown, App, Spin, Empty } from 'antd';
import {
  FolderAddOutlined, EditOutlined, DeleteOutlined,
  EyeOutlined, DownloadOutlined, ArrowLeftOutlined,
} from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import api from '../../services/api';
import FolderModal from '../../components/knowledge/FolderModal';
import KnowledgeBaseModal from '../../components/knowledge/KnowledgeBaseModal';
import DocumentDetailDrawer from '../../components/document/DocumentDetailDrawer';

function toFrontendStatus(status: string): string {
  switch (status) {
    case 'uploading': case 'parsing': case 'parsed': case 'indexing': return 'uploading';
    case 'indexed':   return 'indexed';
    case 'failed':    return 'failed';
    case 'cancelled': return 'cancelled';
    default:          return 'failed';
  }
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  uploading: { label: '上传中', color: 'blue' },
  cancelled: { label: '已取消', color: 'default' },
  indexed:   { label: '已上传', color: 'green' },
  failed:    { label: '已失败', color: 'red' },
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

export default function FolderBrowsePage() {
  const { kbId } = useParams<{ kbId: string }>();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const [kb, setKb] = useState<any>(null);
  const [folderTree, setFolderTree] = useState<DataNode[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);

  const [documents, setDocuments] = useState<any[]>([]);
  const [docLoading, setDocLoading] = useState(false);
  const [docPage, setDocPage] = useState(1);
  const [docTotal, setDocTotal] = useState(0);

  // 弹窗状态
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<any>(null);
  const [newFolderParentId, setNewFolderParentId] = useState<string | undefined>();
  const [kbModalOpen, setKbModalOpen] = useState(false);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);

  // 加载知识库详情
  const loadKb = useCallback(async () => {
    try {
      const { data } = await api.get(`/knowledge-bases/${kbId}`);
      setKb(data);
    } catch { message.error('加载知识库失败'); }
  }, [kbId]);

  // 加载文件夹树
  const loadFolderTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const { data } = await api.get(`/knowledge-bases/${kbId}/folders`);
      const toTreeNodes = (nodes: any[]): DataNode[] =>
        nodes.map((n: any) => ({
          key: n.id,
          title: n.name,
          children: n.children ? toTreeNodes(n.children) : undefined,
          isLeaf: !n.children || n.children.length === 0,
          data: n,
        }));
      setFolderTree(toTreeNodes(data || []));
    } catch { message.error('加载文件夹失败'); }
    finally { setTreeLoading(false); }
  }, [kbId]);

  // 加载文档列表
  const loadDocuments = useCallback(async (page = 1) => {
    setDocLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize: 20 };
      if (selectedFolderId) {
        params.folder_id = selectedFolderId;
      } else if (kbId) {
        params.kb_id = kbId;
      }
      const { data } = await api.get('/documents', { params });
      setDocuments(data.items || []);
      setDocTotal(data.total || 0);
    } catch { message.error('加载文档列表失败'); }
    finally { setDocLoading(false); }
  }, [selectedFolderId, kbId]);

  useEffect(() => { loadKb(); loadFolderTree(); }, [loadKb, loadFolderTree]);
  useEffect(() => { setDocPage(1); loadDocuments(1); }, [loadDocuments]);

  // 当页码变化时重新加载
  useEffect(() => {
    if (docPage > 1) loadDocuments(docPage);
  }, [docPage]);

  const handleDeleteFolder = async (id: string) => {
    try {
      await api.delete(`/knowledge-bases/folders/${id}`);
      message.success('文件夹已删除');
      if (selectedFolderId === id) setSelectedFolderId(null);
      loadFolderTree();
    } catch (err: any) { message.error(err.response?.data?.message || '删除失败'); }
  };

  const handleTreeSelect = (selectedKeys: React.Key[]) => {
    setSelectedFolderId(selectedKeys.length ? (selectedKeys[0] as string) : null);
    setDocPage(1);
  };

  const handleDownload = async (id: string) => {
    try {
      const res = await api.get(`/documents/${id}/download`, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = blobUrl;
      const disposition = res.headers['content-disposition'] || '';
      const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/);
      a.download = utf8Match ? decodeURIComponent(utf8Match[1]) : 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch { message.error('下载文件失败'); }
  };

  const docColumns = [
    {
      title: '名称', dataIndex: 'name', key: 'name',
      render: (name: string, record: any) => (
        <a onClick={() => setDetailDocId(record.id)} style={{ cursor: 'pointer' }}>
          {TYPE_ICONS[record.type] || '📄'} {name}
        </a>
      ),
    },
    { title: '类型', dataIndex: 'type', key: 'type', width: 80 },
    { title: '大小', dataIndex: 'size', key: 'size', width: 100, render: (s: number) => formatSize(s) },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (s: string) => {
        const fs = STATUS_MAP[toFrontendStatus(s)] || { label: s, color: 'default' };
        return <Tag color={fs.color}>{fs.label}</Tag>;
      },
    },
    {
      title: '操作', key: 'actions', width: 150,
      render: (_: unknown, record: any) => (
        <>
          <Button size="small" icon={<EyeOutlined />}
            onClick={() => setDetailDocId(record.id)}>查看</Button>
          {toFrontendStatus(record.status) === 'indexed' && (
            <Button size="small" icon={<DownloadOutlined />} style={{ marginLeft: 4 }}
              onClick={() => handleDownload(record.id)}>下载</Button>
          )}
        </>
      ),
    },
  ];

  // 面包屑路径
  const getBreadcrumbPath = () => {
    const parts: { title: string }[] = [{ title: kb?.name || '知识库' }];
    if (selectedFolderId) {
      const collectPath = (nodes: DataNode[], targetKey: string): boolean => {
        for (const node of nodes) {
          if (node.key === targetKey) return true;
          if ((node as any).children && collectPath((node as any).children, targetKey)) {
            parts.push({ title: (node.title as string) });
            return true;
          }
        }
        return false;
      };
      collectPath(folderTree, selectedFolderId);
    }
    return parts;
  };

  return (
    <div>
      {/* 顶部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/knowledge')}>返回</Button>
          <h2 style={{ margin: 0, fontSize: 18 }}>📗 {kb?.name || '加载中...'}</h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button icon={<FolderAddOutlined />}
            onClick={() => { setEditingFolder(null); setNewFolderParentId(undefined); setFolderModalOpen(true); }}>
            新建文件夹
          </Button>
          <Button onClick={() => setKbModalOpen(true)}>编辑知识库</Button>
        </div>
      </div>

      {/* 左右布局 */}
      <div style={{ display: 'flex', gap: 16 }}>
        {/* 左侧文件夹树 */}
        <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid #f0f0f0', paddingRight: 8, minHeight: 300 }}>
          {treeLoading ? <Spin /> : folderTree.length === 0 ? (
            <Empty description="暂无文件夹" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Tree
              showIcon
              defaultExpandAll
              treeData={folderTree}
              selectedKeys={selectedFolderId ? [selectedFolderId] : []}
              onSelect={handleTreeSelect}
              titleRender={(node: any) => {
                const folder = node.data;
                return (
                  <Dropdown menu={{
                    items: [
                      {
                        key: 'new', icon: <FolderAddOutlined />, label: '新建子文件夹',
                        onClick: () => {
                          setEditingFolder(null);
                          setNewFolderParentId(folder.id);
                          setFolderModalOpen(true);
                        },
                      },
                      {
                        key: 'rename', icon: <EditOutlined />, label: '重命名',
                        onClick: () => {
                          setEditingFolder(folder);
                          setNewFolderParentId(undefined);
                          setFolderModalOpen(true);
                        },
                      },
                      { type: 'divider' },
                      {
                        key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true,
                        onClick: () => handleDeleteFolder(folder.id),
                      },
                    ],
                  }} trigger={['contextMenu']}>
                    <span>📁 {folder.name}</span>
                  </Dropdown>
                );
              }}
            />
          )}
        </div>

        {/* 右侧：面包屑 + 文档表格 */}
        <div style={{ flex: 1 }}>
          <Breadcrumb
            style={{ marginBottom: 12 }}
            items={getBreadcrumbPath().map((p, i) => ({
              title: i === 0 ? p.title : `📁 ${p.title}`,
            }))}
          />
          <Table
            columns={docColumns}
            dataSource={documents}
            rowKey="id"
            loading={docLoading}
            locale={{ emptyText: <Empty description="当前目录暂无文档" /> }}
            pagination={{
              current: docPage,
              pageSize: 20,
              total: docTotal,
              showTotal: (t) => `共 ${t} 篇文档`,
              onChange: (p) => setDocPage(p),
            }}
          />
        </div>
      </div>

      {/* 弹窗 */}
      <FolderModal
        open={folderModalOpen}
        folder={editingFolder}
        kbId={kbId!}
        parentId={newFolderParentId}
        onClose={() => { setFolderModalOpen(false); setEditingFolder(null); }}
        onSuccess={loadFolderTree}
      />
      <KnowledgeBaseModal
        open={kbModalOpen}
        knowledgeBase={kb}
        onClose={() => setKbModalOpen(false)}
        onSuccess={loadKb}
      />
      <DocumentDetailDrawer
        open={!!detailDocId}
        docId={detailDocId}
        onClose={() => setDetailDocId(null)}
      />
    </div>
  );
}
