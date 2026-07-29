import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

/**
 * 应用根模块
 * 负责全局配置导入，后续各业务模块在此注册
 */
@Module({
  imports: [
    // 全局环境变量配置：.env 文件自动加载，全模块可用
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
  ],
})
export class AppModule {}
