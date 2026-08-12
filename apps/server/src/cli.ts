import './instrumentation';

import { CommandFactory } from 'nest-commander';
import { AppModule } from './app.module';

/**
 * NestJS CLI 入口
 * 用于执行 Commander CLI 命令（如 eval upload/run）
 */
async function bootstrap() {
  await CommandFactory.run(AppModule, {
    // CLI 模式不需要 logger 配置
    logger: ['log', 'error', 'warn'],
  });
}

bootstrap().catch((err) => {
  console.error('CLI 启动失败:', err);
  process.exit(1);
});
