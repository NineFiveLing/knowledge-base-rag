import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

/**
 * NestJS 应用入口
 * 启动 HTTP 服务，配置全局管道和 CORS
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 全局路径前缀：所有 API 路由以 /api 开头
  app.setGlobalPrefix('api');

  // CORS：允许前端开发服务器跨域访问
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  });

  // 全局验证管道：自动校验 DTO，剥离非白名单字段
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,   // 自动移除未在 DTO 中声明的字段
      transform: true,   // 自动转换类型（字符串 → 数字等）
    }),
  );

  const port = process.env.SERVER_PORT || 3000;
  await app.listen(port);
  console.log(`🚀 知识库后端服务已启动: http://localhost:${port}`);
}

bootstrap();
