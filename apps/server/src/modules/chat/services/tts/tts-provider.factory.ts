import { ConfigService } from '@nestjs/config';
import type { TtsProvider } from './tts-provider.interface';
import { AliNlsTtsProvider } from './ali-nls.provider';

/** 根据 DEFAULT_TTS_PROVIDER 配置创建对应的 TTS 提供商实例 */
export function createTtsProvider(config: ConfigService): TtsProvider {
  const provider = (config.get('DEFAULT_TTS_PROVIDER') || 'aliyun').toLowerCase();

  switch (provider) {
    case 'aliyun': {
      const accessKeyId = config.get('ALIYUN_NLS_ACCESS_KEY_ID') || '';
      const accessKeySecret = config.get('ALIYUN_NLS_ACCESS_KEY_SECRET') || '';
      const appKey = config.get('ALIYUN_NLS_APP_KEY') || '';
      if (!accessKeyId || !accessKeySecret || !appKey) {
        throw new Error('ALIYUN_NLS_ACCESS_KEY_ID/SECRET/APP_KEY 未配置，NLS TTS 不可用');
      }
      return new AliNlsTtsProvider(accessKeyId, accessKeySecret, appKey);
    }
    default:
      throw new Error(`未知 TTS 提供商: ${provider}，可选值: aliyun`);
  }
}
