import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppModule } from './app.module';
import { registerOTel } from './instrumentation';

/**
 * NestJS 应用入口
 * 启动 HTTP 服务，配置全局管道和 CORS
 */
async function bootstrap() {
  // OpenTelemetry 自动插桩（在 NestJS 启动前注册）
  registerOTel();

  const app = await NestFactory.create(AppModule, {
    // 启用 debug 级别日志，方便观察 RAG 节点流转
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  // 全局路径前缀：所有 API 路由以 /api 开头
  app.setGlobalPrefix('api');

  // CORS：允许前端开发服务器跨域访问
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  });

  // 全局异常过滤器：统一错误响应格式
  app.useGlobalFilters(new AllExceptionsFilter());

  // 全局验证管道：自动校验 DTO，剥离非白名单字段
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,   // 自动移除未在 DTO 中声明的字段
      transform: true,   // 自动转换类型（字符串 → 数字等）
    }),
  );

  const port = process.env.SERVER_PORT || 3001;
  await app.listen(port);
  console.log(`🚀 知识库后端服务已启动: http://localhost:${port}`);
}

bootstrap();
