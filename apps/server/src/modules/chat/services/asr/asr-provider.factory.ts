import { ConfigService } from '@nestjs/config';
import type { AsrProvider } from './asr-provider.interface';
import { AliDashScopeAsrProvider } from './ali-dashscope.provider';
import { TencentAsrProvider } from './tencent.provider';

/** 根据 DEFAULT_ASR_PROVIDER 配置创建对应的 ASR 提供商实例 */
export function createAsrProvider(config: ConfigService): AsrProvider {
  const provider = (config.get('DEFAULT_ASR_PROVIDER') || 'aliyun').toLowerCase();

  switch (provider) {
    case 'aliyun': {
      const apiKey = config.get('ALIYUN_API_KEY') || '';
      if (!apiKey) throw new Error('ALIYUN_API_KEY 未配置，阿里云 ASR 不可用');
      const model = config.get('ALIYUN_ASR_MODEL', 'fun-asr-mtl');
      return new AliDashScopeAsrProvider(apiKey, model);
    }
    case 'tencent': {
      const secretId = config.get('TENCENT_SECRET_ID') || '';
      const secretKey = config.get('TENCENT_SECRET_KEY') || '';
      const appId = config.get('TENCENT_APP_ID') || '';
      if (!secretId || !secretKey) throw new Error('TENCENT_SECRET_ID/SECRET_KEY 未配置，腾讯云 ASR 不可用');
      if (!appId) throw new Error('TENCENT_APP_ID 未配置，腾讯云 ASR 需要 AppID');
      // 腾讯云也读 ALIYUN_ASR_MODEL 作为模型标识
      const model = config.get('ALIYUN_ASR_MODEL', 'fun-asr-mtl');
      return new TencentAsrProvider(secretId, secretKey, appId, model);
    }
    default:
      throw new Error(`未知 ASR 提供商: ${provider}，可选值: aliyun | tencent`);
  }
}
