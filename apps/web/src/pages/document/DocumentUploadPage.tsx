import { useState, useEffect } from 'react';
import { Upload, Card, Progress, Button, Breadcrumb, Select, TreeSelect, App, Row, Col } from 'antd';
import { InboxOutlined, UploadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { UploadFile } from 'antd/es/upload/interface';
import type { DataNode } from 'antd/es/tree';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';

const { Dragger } = Upload;

export default function DocumentUploadPage() {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const { message } = App.useApp();
  const user = useAuthStore((s) => s.user);

  // KB + 文件夹选择
  const [kbs, setKbs] = useState<{ value: string; label: string }[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | undefined>();
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>();
  const [folderTree, setFolderTree] = useState<DataNode[]>([]);

  useEffect(() => {
    api.get('/knowledge-bases').then(({ data }) => {
      setKbs((data || []).map((kb: any) => ({ value: kb.id, label: kb.name })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedKbId) { setFolderTree([]); return; }
    api.get(`/knowledge-bases/${selectedKbId}/folders`).then(({ data }) => {
      const toTreeOptions = (nodes: any[]): DataNode[] =>
        nodes.map((n: any) => ({
          key: n.id,
          value: n.id,
          title: n.name,
          children: n.children ? toTreeOptions(n.children) : undefined,
        }));
      setFolderTree(toTreeOptions(data || []));
    }).catch(() => setFolderTree([]));
  }, [selectedKbId]);

  const handleUpload = async () => {
    if (!selectedKbId) {
      message.warning('请先选择知识库');
      return;
    }

    const file = fileList[0]?.originFileObj;
    if (!file) return;

    setUploading(true);
    setProgress(0);
    const formData = new FormData();
    formData.append('file', file);
    if (user?.dept_id) formData.append('dept_id', user.dept_id);
    if (selectedKbId) formData.append('kb_id', selectedKbId);
    if (selectedFolderId) formData.append('folder_id', selectedFolderId);

    try {
      const { data } = await api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => {
          if (evt.total) setProgress(Math.round((evt.loaded * 100) / evt.total));
        },
      });
      message.success(`上传成功 — 文档 ID: ${data.docId}`);
      setFileList([]);
      setProgress(0);
    } catch (err: any) {
      message.error(err.response?.data?.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 16 }}
        items={[
          { title: <Link to="/documents/manage">文档管理</Link> },
          { title: '上传文档' },
        ]}
      />
      <h2 style={{ marginBottom: 16, fontSize: 20 }}>📄 上传文档</h2>
      <Card>
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={12}>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>知识库</div>
            <Select
              style={{ width: '100%' }}
              placeholder="选择知识库"
              options={kbs}
              value={selectedKbId}
              onChange={(val) => { setSelectedKbId(val); setSelectedFolderId(undefined); }}
            />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>文件夹</div>
            <TreeSelect
              style={{ width: '100%' }}
              placeholder={selectedKbId ? '选择文件夹（可选）' : '请先选择知识库'}
              treeData={folderTree}
              value={selectedFolderId}
              onChange={(val) => setSelectedFolderId(val)}
              allowClear
              disabled={!selectedKbId}
            />
          </Col>
        </Row>

        <Dragger
          fileList={fileList}
          beforeUpload={() => false}
          onChange={({ fileList: fl }) => setFileList(fl)}
          maxCount={1}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.txt,.png,.jpg,.jpeg,.mp3,.wav,.mp4"
          onRemove={() => { setFileList([]); setProgress(0); }}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
          <p className="ant-upload-hint">支持 PDF / Word / Excel / PPT / Markdown / 文本 / 图片 / 音频 / 视频</p>
        </Dragger>
        {fileList.length > 0 && (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <Button
              type="primary"
              onClick={handleUpload}
              loading={uploading}
              icon={<UploadOutlined />}
            >
              {uploading ? '上传中' : '开始上传'}
            </Button>
          </div>
        )}
        {progress > 0 && <Progress percent={progress} style={{ marginTop: 16 }} />}
      </Card>
    </div>
  );
}
