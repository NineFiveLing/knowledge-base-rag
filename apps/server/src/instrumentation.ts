import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

/**
 * OpenTelemetry 自动插桩（LangfuseSpanProcessor 导出）
 * 未配置 LANGFUSE_PUBLIC_KEY 时优雅降级（不启动 SDK，不抛异常）
 */
let sdk: NodeSDK | null = null;
const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
if (publicKey && publicKey.trim() !== "") {
  const langfuseSpanProcessor = new LangfuseSpanProcessor({
    publicKey,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
    environment: process.env.NODE_ENV || "development",
  });
  sdk = new NodeSDK({
    spanProcessors: [langfuseSpanProcessor],
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
}

/**
 * 获取当前 OTel SDK 实例（测试钩子；未初始化时为 null）
 */
export function getOTelSdk(): NodeSDK | null {
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
