import { Switch, Space } from 'antd';
import { SoundOutlined } from '@ant-design/icons';

interface Props {
  autoPlayEnabled: boolean;
  onToggle: () => void;
}

export default function TtsGlobalControl({ autoPlayEnabled, onToggle }: Props) {
  return (
    <Space className="tts-global-control" size="small">
      <SoundOutlined />
      <span style={{ fontSize: 13, color: '#666' }}>自动播放</span>
      <Switch checked={autoPlayEnabled} onChange={onToggle} size="small" />
    </Space>
  );
}
