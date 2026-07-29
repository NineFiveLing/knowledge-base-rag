-- PostgreSQL 初始化脚本（pgvector 镜像首次启动自动执行）
-- 启用向量扩展
CREATE EXTENSION IF NOT EXISTS vector;
-- 启用 UUID 生成
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- 创建 chunk 向量表（如果 TypeORM synchronize 未覆盖）
-- 注意：实际部署中由 TypeORM/VectorsService.ensureTable() 管理，
-- 此脚本主要确保 pgvector 扩展在数据库创建时就已经可用
