import { Button } from "antd";

interface Props {
  isRecording: boolean;
  onStart: () => void;
  onStop: () => void;
}

/** 语音按钮：按住说话，松开发送 */
export default function VoiceButton({ isRecording, onStart, onStop }: Props) {
  return (
    <Button
      className={`voice-btn ${isRecording ? "recording" : ""}`}
      onMouseDown={onStart}
      onMouseUp={onStop}
      onMouseLeave={isRecording ? onStop : undefined}
      onTouchStart={onStart}
      onTouchEnd={onStop}
      size="large"
    >
      {isRecording ? "🎙️ 松开发送" : "🎤 按住说话"}
    </Button>
  );
}
