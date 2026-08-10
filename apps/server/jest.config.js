/** @type {import('jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  // 超时设置：OTel 和 LangFuse 初始化可能需要时间
  testTimeout: 30000,
  // 自动 mock 环境变量
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
};
