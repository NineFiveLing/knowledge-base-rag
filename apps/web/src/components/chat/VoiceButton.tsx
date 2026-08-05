import { Button } from "antd";
import { MessageOutlined, SoundOutlined } from '@ant-design/icons';

interface Props {
  isRecording: boolean;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
}

/** 语音按钮：点击切换 录音/停止，使用话题图标 */
export default function VoiceButton({ isRecording, disabled, onStart, onStop }: Props) {
  return (
    <Button
      className={`voice-btn ${isRecording ? "recording" : ""}`}
      onClick={isRecording ? onStop : onStart}
      size="large"
      icon={isRecording ? <SoundOutlined /> : <MessageOutlined />}
      disabled={!!disabled}
    >
      {isRecording ? "点击停止" : "点击说话"}
    </Button>
  );
}
