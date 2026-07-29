import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { VectorService } from './vector.service';

/** PostgreSQL + PGVector 数据库模块 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('POSTGRES_HOST', 'localhost'),
        port: Number(config.get('POSTGRES_PORT', '5432')),
        username: config.get('POSTGRES_USER', 'postgres'),
        password: config.get('POSTGRES_PASSWORD', 'password'),
        database: config.get('POSTGRES_DB', 'ai_agent'),
        autoLoadEntities: true,
        synchronize: true,
      }),
    }),
  ],
  providers: [VectorService],
  exports: [TypeOrmModule, VectorService],
})
export class PostgresModule {}
