import { Button } from 'antd';
import { SoundOutlined, PauseCircleOutlined, PlayCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import type { MessagePlayState } from '../../hooks/useTtsPlayer';

interface Props {
  messageId: string;
  text: string;
  state: MessagePlayState;
  onPlay: (messageId: string, text: string) => void;
  onPause: (messageId: string) => void;
  onResume: (messageId: string) => void;
}

export default function MessageTtsButton({ messageId, text, state, onPlay, onPause, onResume }: Props) {
  const handleClick = () => {
    if (state === 'playing') onPause(messageId);
    else if (state === 'paused') onResume(messageId);
    else onPlay(messageId, text);
  };

  const icon =
    state === 'loading' ? <LoadingOutlined spin /> :
    state === 'playing' ? <SoundOutlined /> :
    state === 'paused' ? <PauseCircleOutlined /> :
    <PlayCircleOutlined />;

  const title =
    state === 'loading' ? '语音加载中…' :
    state === 'playing' ? '暂停播放' :
    state === 'paused' ? '继续播放' :
    '播放语音';

  return (
    <Button
      type="text"
      size="small"
      className={`tts-btn tts-${state}`}
      icon={icon}
      title={title}
      onClick={handleClick}
      disabled={state === 'loading'}
    />
  );
}
