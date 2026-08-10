import { Test, TestingModule } from '@nestjs/testing';
import { ExcelParserService } from './excel-parser.service';
import * as XLSX from 'xlsx';

// Mock xlsx 模块
jest.mock('xlsx', () => ({
  readFile: jest.fn(),
  utils: {
    sheet_to_json: jest.fn(),
  },
}));

describe('ExcelParserService', () => {
  let service: ExcelParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExcelParserService],
    }).compile();

    service = module.get<ExcelParserService>(ExcelParserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('parse', () => {
    it('应该正确解析 Excel 文件', async () => {
      // Mock Excel 数据
      const mockWorkbook = {
        SheetNames: ['Sheet1'],
        Sheets: {
          Sheet1: {},
        },
      };

      const mockData = [
        ['question(问题)', 'ground_truth(参考答案)', 'ground_truth_contexts(需要检索到的文档)', 'category(类型)', 'expected_retrieved'],
        ['年假怎么申请？', '通过OA系统申请', 'OA系统', 'HR', true],
      ];

      (XLSX.readFile as jest.Mock).mockReturnValue(mockWorkbook);
      (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockData);

      const result = await service.parse('test.xlsx');

      expect(result).toHaveLength(1);
      expect(result[0].question).toBe('年假怎么申请？');
      expect(result[0].groundTruth).toBe('通过OA系统申请');
      expect(result[0].groundTruthContexts).toEqual(['OA系统']);
      expect(result[0].category).toBe('HR');
      expect(result[0].expectedRetrieved).toBe(true);
    });

    it('支持中文列名匹配', async () => {
      const mockWorkbook = {
        SheetNames: ['测试数据'],
        Sheets: { '测试数据': {} },
      };

      const mockData = [
        ['问题', '参考答案', '类型'],
        ['WiFi 坏了找谁？', '联系IT部门', 'IT'],
      ];

      (XLSX.readFile as jest.Mock).mockReturnValue(mockWorkbook);
      (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockData);

      const result = await service.parse('test.xlsx');

      expect(result[0].question).toBe('WiFi 坏了找谁？');
      expect(result[0].groundTruth).toBe('联系IT部门');
    });

    it('缺失必填列时抛出错误', async () => {
      const mockWorkbook = {
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: {} },
      };

      const mockData = [
        ['问题', '类型'], // 缺少 ground_truth
        ['WiFi 坏了找谁？', 'IT'], // 数据行
      ];

      (XLSX.readFile as jest.Mock).mockReturnValue(mockWorkbook);
      (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockData);

      await expect(service.parse('test.xlsx')).rejects.toThrow('缺少必填列');
    });

    it('解析 ground_truth_contexts 支持多行分隔', async () => {
      const mockWorkbook = {
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: {} },
      };

      const mockData = [
        ['question(问题)', 'ground_truth(参考答案)', 'ground_truth_contexts(需要检索到的文档)'],
        ['问题1', '答案1', '文档1\n文档2\n文档3'],
      ];

      (XLSX.readFile as jest.Mock).mockReturnValue(mockWorkbook);
      (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockData);

      const result = await service.parse('test.xlsx');

      expect(result[0].groundTruthContexts).toEqual(['文档1', '文档2', '文档3']);
    });

    it('解析 expected_retrieved 布尔值', async () => {
      const mockWorkbook = {
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: {} },
      };

      const mockData = [
        ['question(问题)', 'ground_truth(参考答案)', 'expected_retrieved'],
        ['问题1', '答案1', false],
        ['问题2', '答案2', '是'],
        ['问题3', '答案3', '否'],
      ];

      (XLSX.readFile as jest.Mock).mockReturnValue(mockWorkbook);
      (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue(mockData);

      const result = await service.parse('test.xlsx');

      expect(result[0].expectedRetrieved).toBe(false);
      expect(result[1].expectedRetrieved).toBe(true);
      expect(result[2].expectedRetrieved).toBe(false);
    });
  });
});
