import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth.store';
import Layout from './components/layout/Layout';
import LoginPage from './pages/login/LoginPage';
import ChatPage from './pages/chat/ChatPage';
import KnowledgeBasePage from './pages/knowledge-base/KnowledgeBasePage';
import DocumentUploadPage from './pages/document/DocumentUploadPage';
import DocumentManagePage from './pages/document/DocumentManagePage';

/** 路由守卫：未登录跳转 /login */
function Protected({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** 应用根组件：路由配置 */
export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Protected><Layout /></Protected>}>
            <Route index element={<Navigate to="/chat" replace />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="knowledge" element={<KnowledgeBasePage />} />
            <Route path="documents" element={<DocumentUploadPage />} />
            <Route path="documents/manage" element={<DocumentManagePage />} />
          </Route>
        </Routes>
      </div>
    </BrowserRouter>
  );
}
