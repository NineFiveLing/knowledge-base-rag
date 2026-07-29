interface Props {
  isRecording: boolean;
  onStart: () => void;
  onStop: () => void;
}

/** 语音按钮：按住说话，松开发送 */
export default function VoiceButton({ isRecording, onStart, onStop }: Props) {
  return (
    <button
      className={`voice-btn ${isRecording ? 'recording' : ''}`}
      onMouseDown={onStart}
      onMouseUp={onStop}
      onMouseLeave={isRecording ? onStop : undefined}
      onTouchStart={onStart}
      onTouchEnd={onStop}
    >
      {isRecording ? '🎙️ 松开发送' : '🎤 按住说话'}
    </button>
  );
}
