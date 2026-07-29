/** 解析结果：统一输出 Markdown + 提取的图片 */
export interface ParseResult {
  /** 解析后的 Markdown 正文 */
  markdown: string;
  /** 从文档中提取的图片（需上传 RustFS 后替换占位符） */
  images: Array<{
    originalName: string;
    buffer: Buffer;
    mimeType: string;
    placeholderInMd: string;
  }>;
  /** 解析阶段提取的元数据（页码/作者等） */
  metadata: Record<string, any>;
}

/** 文档解析器接口：每种文件类型实现此接口 */
export interface DocumentParser {
  /** 支持的文件扩展名列表（不含点） */
  readonly supportedTypes: string[];
  /** 解析文件 Buffer → Markdown */
  parse(buffer: Buffer, filename: string): Promise<ParseResult>;
}
