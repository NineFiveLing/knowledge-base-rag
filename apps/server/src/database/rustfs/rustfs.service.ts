import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { v4 as uuid } from 'uuid';

/**
 * RustFS 对象存储服务
 * S3 兼容接口，存储原始文件和提取的多媒体资源
 */
@Injectable()
export class RustFSService {
  private s3: S3Client;
  private bucket = 'knowledge-base';

  constructor(private config: ConfigService) {
    this.s3 = new S3Client({
      endpoint: config.get('RUSTFS_ENDPOINT', 'http://localhost:9000'),
      region: 'us-east-1',
      credentials: {
        accessKeyId: config.get('RUSTFS_ACCESS_KEY', 'rustfsadmin'),
        secretAccessKey: config.get('RUSTFS_SECRET_KEY', 'rustfsadmin'),
      },
      forcePathStyle: true, // S3 兼容存储需要 path-style 访问
    });
  }

  /** 上传文件到 RustFS，返回访问 URL */
  async uploadFile(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<string> {
    const key = `documents/${uuid()}/${filename}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
    return `${this.config.get('RUSTFS_ENDPOINT')}/${this.bucket}/${key}`;
  }

  /** 删除文件（回滚时使用） */
  async deleteFile(fileUrl: string): Promise<void> {
    const key = fileUrl.split(`${this.bucket}/`)[1];
    if (key) {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    }
  }
}
