import { Modal, Upload, App } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { useState } from 'react';
import type { UploadFile } from 'antd/es/upload/interface';
import api from '../../services/api';

const { Dragger } = Upload;

interface Props {
  open: boolean;
  document: { id: string; name: string } | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DocumentReplaceModal({ open, document, onClose, onSuccess }: Props) {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const { message } = App.useApp();

  const handleReplace = async () => {
    const file = fileList[0]?.originFileObj;
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const { data } = await api.post(`/documents/${document!.id}/replace`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success(`替换成功 — 版本 ${data.version}`);
      setFileList([]);
      onSuccess();
      onClose();
    } catch (err: any) {
      message.error(err.response?.data?.message || '替换失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      title={`替换文件 — ${document?.name || ''}`}
      open={open}
      onOk={handleReplace}
      onCancel={() => { setFileList([]); onClose(); }}
      okText="上传并替换"
      cancelText="取消"
      confirmLoading={uploading}
      destroyOnClose
      okButtonProps={{ disabled: fileList.length === 0 }}
    >
      <Dragger
        fileList={fileList}
        beforeUpload={() => false}
        onChange={({ fileList: fl }) => setFileList(fl)}
        maxCount={1}
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.txt,.png,.jpg,.jpeg,.mp3,.wav,.mp4"
        onRemove={() => setFileList([])}
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">点击或拖拽新文件到此区域</p>
        <p className="ant-upload-hint">替换后将自动归档当前版本并重建索引</p>
      </Dragger>
    </Modal>
  );
}
