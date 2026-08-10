/**
 * Jest 全局 setup：mock 环境变量，确保测试隔离
 */

// 默认 mock 所有外部服务环境变量为空，避免测试中意外调用真实 API
process.env.LANGFUSE_PUBLIC_KEY = '';
process.env.LANGFUSE_SECRET_KEY = '';
process.env.LANGFUSE_BASE_URL = 'https://cloud.langfuse.com';
process.env.LANGFUSE_PROJECT_ID = '';
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = '';
process.env.OTEL_SERVICE_NAME = 'knowledge-base-rag-server';
process.env.OTEL_ENVIRONMENT = 'test';

// 其他必需的 mock
process.env.ALIYUN_API_KEY = 'test-api-key';
process.env.ALIYUN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
process.env.MODEL_NAME = 'deepseek-v4-flash-0731';
process.env.EMBEDDING_MODEL = 'text-embedding-v2';
process.env.JWT_SECRET = 'test-secret';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.POSTGRES_HOST = 'localhost';
process.env.POSTGRES_PORT = '5432';
process.env.POSTGRES_USER = 'postgres';
process.env.POSTGRES_PASSWORD = 'test';
process.env.POSTGRES_DB = 'test';
process.env.MONGO_HOST = 'localhost';
process.env.MONGO_PORT = '27017';
process.env.ES_HOST = 'localhost';
process.env.ES_PORT = '9200';
process.env.NEO4J_HOST = 'localhost';
process.env.NEO4J_BOLT_PORT = '7687';
process.env.NEO4J_HTTP_PORT = '7474';
process.env.NEO4J_USER = 'neo4j';
process.env.NEO4J_PASSWORD = 'test';
process.env.RUSTFS_ENDPOINT = 'http://localhost:9000';
process.env.RUSTFS_ACCESS_KEY = 'test';
process.env.RUSTFS_SECRET_KEY = 'test';

// 抑制 NestJS 开发模式警告
process.env.NODE_ENV = 'test';
