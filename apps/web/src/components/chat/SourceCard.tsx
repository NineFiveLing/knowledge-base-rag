import { memo } from 'react';

interface SourceRef {
  index: number;
  docId: string;
  chunkId: string;
  docName: string;
  docType: string;
  docSize: number;
}

interface SourceCardProps {
  source: SourceRef;
  onClick: () => void;
}

/** 文件类型 → { 缩写, 颜色, 中文名 } 映射 */
const TYPE_CONFIG: Record<string, { abbr: string; color: string; label: string }> = {
  pdf:       { abbr: 'PDF', color: '#ff4d4f', label: 'PDF' },
  word:      { abbr: 'DOC', color: '#2f54eb', label: 'Word' },
  excel:     { abbr: 'XLS', color: '#52c41a', label: 'Excel' },
  ppt:       { abbr: 'PPT', color: '#fa8c16', label: 'PPT' },
  markdown:  { abbr: 'MD',  color: '#1677ff', label: 'Markdown' },
  text:      { abbr: 'TXT', color: '#666666', label: 'Text' },
  image:     { abbr: 'IMG', color: '#eb2f96', label: 'Image' },
  audio:     { abbr: 'AUD', color: '#722ed1', label: 'Audio' },
  video:     { abbr: 'VID', color: '#722ed1', label: 'Video' },
};

const DEFAULT_CONFIG = { abbr: 'FILE', color: '#999999', label: 'File' };

/** 22×22 文件类型图标 */
function FileTypeIcon({ docType }: { docType: string }) {
  const cfg = TYPE_CONFIG[docType] || DEFAULT_CONFIG;
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect x="4" y="2" width="16" height="20" rx="2" fill={cfg.color} />
      <text
        x="12" y="16"
        textAnchor="middle"
        fontSize={cfg.abbr.length > 3 ? '6' : '7'}
        fill="#fff"
        fontWeight="bold"
      >
        {cfg.abbr}
      </text>
    </svg>
  );
}

function formatSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const SourceCard = memo(function SourceCard({ source, onClick }: SourceCardProps) {
  return (
    <div className="source-card" onClick={onClick}>
      <FileTypeIcon docType={source.docType} />
      <div className="source-card-body">
        <div className="source-card-name">{source.docName}</div>
        <div className="source-card-size">{formatSize(source.docSize)}</div>
      </div>
      <span className="source-card-arrow">→</span>
    </div>
  );
});

export type { SourceRef };
