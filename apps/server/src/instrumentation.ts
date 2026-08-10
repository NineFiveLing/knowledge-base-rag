import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

// 自动插桩注册表
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
// 注：Elasticsearch 无官方 OTel instrumentation 包，使用客户端内置诊断

let sdk: NodeSDK | null = null;

/**
 * 注册 OpenTelemetry 自动插桩
 * 当 OTEL_EXPORTER_OTLP_ENDPOINT 未设置时，跳过初始化
 */
export function registerOTel(): NodeSDK | null {
  // 如果已注册，直接返回
  if (sdk) {
    return sdk;
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint || endpoint.trim() === '') {
    return null;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME || 'knowledge-base-rag-server';
  const environment = process.env.OTEL_ENVIRONMENT || 'development';

  sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'knowledge-base-rag',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: environment,
    }),
    traceExporter: new OTLPTraceExporter({
      url: endpoint,
    }),
    instrumentations: [
      new ExpressInstrumentation(),
      new PgInstrumentation(),
      new MongoDBInstrumentation(),
      new IORedisInstrumentation(),
      // Elasticsearch: 无官方 OTel instrumentation 包，跳过
    ],
  });

  sdk.start();
  return sdk;
}

/**
 * 关闭 OTel SDK
 */
export async function shutdownOTel(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}
