import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisService } from '../../database/redis/redis.service';

/** 统计服务：文档/会话/用户数据聚合 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  /** 总览：文档数 + 会话数 + 用户数 + 周活跃用户 */
  async getOverview() {
    const [docCount] = await this.dataSource.query(
      `SELECT COUNT(*)::int as count FROM documents`
    );
    const sessionKeys = await this.redis.client.keys('session:*:history');
    const [totalUsers] = await this.dataSource.query(
      `SELECT COUNT(*)::int as count FROM users`
    );
    const [activeUsers] = await this.dataSource.query(`
      SELECT COUNT(DISTINCT created_by)::int as count
      FROM documents WHERE created_at >= NOW() - INTERVAL '7 days'
    `);

    return {
      docCount: docCount?.count ?? 0,
      totalSessions: sessionKeys.length,
      totalUsers: totalUsers?.count ?? 0,
      activeUsers: activeUsers?.count ?? 0,
    };
  }

  /** 文档维度：类型分布 + 状态分布 + 30 天上传趋势 */
  async getDocumentStats() {
    const byType = await this.dataSource.query(`
      SELECT type, COUNT(*)::int as count FROM documents
      GROUP BY type ORDER BY count DESC
    `);
    const byStatus = await this.dataSource.query(`
      SELECT status, COUNT(*)::int as count FROM documents
      GROUP BY status ORDER BY count DESC
    `);
    const uploadTrend = await this.dataSource.query(`
      SELECT DATE(created_at) as date, COUNT(*)::int as count
      FROM documents WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at) ORDER BY date DESC
    `);
    return { byType, byStatus, uploadTrend };
  }

  /** 对话维度：基于 Redis session keys 估算 */
  async getChatStats() {
    const sessionKeys = await this.redis.client.keys('session:*:history');
    return {
      totalQuestions: sessionKeys.length,
      topQueries: [],
      avgRounds: 0,
      intentDistribution: { chat: 0, simple: 0, complex: 0 },
      degradeRate: 0,
    };
  }

  /** 用户维度 */
  async getUserStats() {
    const [totalUsers] = await this.dataSource.query(
      `SELECT COUNT(*)::int as count FROM users`
    );
    const [activeUsers] = await this.dataSource.query(`
      SELECT COUNT(DISTINCT created_by)::int as count
      FROM documents WHERE created_at >= NOW() - INTERVAL '7 days'
    `);
    return {
      totalUsers: totalUsers?.count ?? 0,
      activeUsers: activeUsers?.count ?? 0,
    };
  }
}
