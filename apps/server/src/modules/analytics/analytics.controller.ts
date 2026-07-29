import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';

/** 统计仪表盘控制器 */
@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('overview')
  async overview() { return this.service.getOverview(); }

  @Get('documents')
  async documents() { return this.service.getDocumentStats(); }

  @Get('chat')
  async chat() { return this.service.getChatStats(); }

  @Get('users')
  async users() { return this.service.getUserStats(); }
}
