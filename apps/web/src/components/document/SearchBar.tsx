import { Input, Select, Button, Space } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useState } from 'react';

const TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'pdf', label: 'PDF' },
  { value: 'word', label: 'Word' },
  { value: 'excel', label: 'Excel' },
  { value: 'ppt', label: 'PPT' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
];

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'uploading', label: '上传中' },
  { value: 'indexed', label: '已上传' },
  { value: 'failed', label: '已失败' },
  { value: 'cancelled', label: '已取消' },
];

interface SearchFilters {
  keyword?: string;
  type?: string;
  status?: string;
}

interface Props {
  onSearch: (filters: SearchFilters) => void;
}

export default function SearchBar({ onSearch }: Props) {
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');

  const handleSearch = () => {
    onSearch({ keyword: keyword || undefined, type: type || undefined, status: status || undefined });
  };

  return (
    <Space style={{ marginBottom: 16 }} wrap>
      <Input
        placeholder="搜索文件名..."
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onPressEnter={handleSearch}
        style={{ width: 200 }}
        prefix={<SearchOutlined />}
        allowClear
      />
      <Select
        value={type}
        onChange={(v) => setType(v)}
        options={TYPE_OPTIONS}
        style={{ width: 120 }}
      />
      <Select
        value={status}
        onChange={(v) => setStatus(v)}
        options={STATUS_OPTIONS}
        style={{ width: 120 }}
      />
      <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
        搜索
      </Button>
    </Space>
  );
}
