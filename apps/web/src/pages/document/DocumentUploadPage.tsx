import { useState } from 'react';
import api from '../../services/api';

/** 文档上传页面：支持拖拽上传 */
export default function DocumentUploadPage() {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<any>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProgress(0);
    setStatus('上传中...');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const { data } = await api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => {
          if (evt.total) setProgress(Math.round((evt.loaded * 100) / evt.total));
        },
      });
      setResult(data);
      setStatus('✅ 上传成功');
    } catch (err: any) {
      setStatus(`❌ 上传失败: ${err.response?.data?.message || err.message}`);
    }
  };

  return (
    <div className="upload-page">
      <h2>📄 上传文档</h2>
      <div className="upload-area">
        <input type="file" onChange={handleUpload} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.txt,.png,.jpg,.jpeg,.mp3,.wav,.mp4" />
        <p>支持: PDF / Word / Excel / PPT / Markdown / 文本 / 图片 / 音频 / 视频</p>
      </div>
      {status && <p>{status}</p>}
      {progress > 0 && <progress value={progress} max={100} />}
      {result && <p>文档 ID: {result.docId} | 状态: {result.status}</p>}
    </div>
  );
}
