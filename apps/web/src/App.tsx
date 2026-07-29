import { BrowserRouter, Routes, Route } from 'react-router-dom';

/**
 * 应用根组件
 * 路由配置：后续各页面在此注册
 */
export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Routes>
          <Route
            path="/"
            element={
              <div className="flex items-center justify-center min-h-screen bg-gray-50">
                <div className="text-center">
                  <h1 className="text-3xl font-bold text-gray-800 mb-2">
                    📚 企业知识库 RAG 平台
                  </h1>
                  <p className="text-gray-500">智能文档检索与 AI 问答系统</p>
                </div>
              </div>
            }
          />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
