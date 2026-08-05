import { Switch, Space } from 'antd';
import { SoundOutlined } from '@ant-design/icons';

interface Props {
  autoPlayEnabled: boolean;
  onToggle: () => void;
  style?: React.CSSProperties;
}

export default function TtsGlobalControl({ autoPlayEnabled, onToggle, style }: Props) {
  return (
    <Space className="tts-global-control" size="small" style={style}>
      <SoundOutlined />
      <span style={{ fontSize: 13, color: '#666' }}>自动播放</span>
      <Switch checked={autoPlayEnabled} onChange={onToggle} size="small" />
    </Space>
  );
}
