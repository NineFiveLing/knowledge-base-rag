import { useState } from 'react';
import { Upload, Card, Progress, Button, Breadcrumb, App } from 'antd';
import { InboxOutlined, UploadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { UploadFile } from 'antd/es/upload/interface';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';

const { Dragger } = Upload;

export default function DocumentUploadPage() {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const { message } = App.useApp();
  const user = useAuthStore((s) => s.user);

  const handleUpload = async () => {
    const file = fileList[0]?.originFileObj;
    if (!file) return;

    setUploading(true);
    setProgress(0);
    const formData = new FormData();
    formData.append('file', file);
    if (user?.dept_id) formData.append('dept_id', user.dept_id);

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
