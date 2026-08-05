import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth.store';
import Layout from './components/layout/Layout';
import LoginPage from './pages/login/LoginPage';
import ChatPage from './pages/chat/ChatPage';
import KnowledgeBasePage from './pages/knowledge-base/KnowledgeBasePage';
import FolderBrowsePage from './pages/knowledge/FolderBrowsePage';
import DocumentUploadPage from './pages/document/DocumentUploadPage';
import DocumentManagePage from './pages/document/DocumentManagePage';
import RoleManagePage from './pages/admin/RoleManagePage';
import UserManagePage from './pages/admin/UserManagePage';
import AnalyticsPage from './pages/analytics/AnalyticsPage';
import { usePermissionChange } from './hooks/usePermissionChange';
import { App as AntApp } from 'antd';
import { useCallback, useEffect, useRef } from 'react';

/** 路由守卫：未登录跳转 /login */
function Protected({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** 密码变更监听：当后端返回 401 且消息包含"密码已变更"时，弹窗提醒用户重新登录 */
function PasswordChangeWatcher() {
  const { modal } = AntApp.useApp();
  const shownRef = useRef(false);

  const handlePasswordChanged = useCallback((e: Event) => {
    // 防重复弹窗
    if (shownRef.current) return;
    shownRef.current = true;
    const detail = (e as CustomEvent).detail;
    modal.confirm({
      title: '登录已失效',
      content: detail?.message || '您的密码已被管理员重置，请使用新密码重新登录。',
      okText: '去登录',
      centered: true,
      cancelButtonProps: { style: { display: 'none' } },
      onOk: () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      },
    });
  }, [modal]);

  useEffect(() => {
    window.addEventListener('password-changed', handlePasswordChanged);
    return () => window.removeEventListener('password-changed', handlePasswordChanged);
  }, [handlePasswordChanged]);

  return null;
}

/** 权限变更监听 */
function PermissionChangeWatcher() {
  usePermissionChange(30000); // 每30秒检查一次
  return null;
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
            <Route path="knowledge/:kbId" element={<FolderBrowsePage />} />
            <Route path="documents" element={<DocumentUploadPage />} />
            <Route path="documents/manage" element={<DocumentManagePage />} />
            <Route path="admin/roles" element={<RoleManagePage />} />
            <Route path="admin/users" element={<UserManagePage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
          </Route>
        </Routes>
        <PermissionChangeWatcher />
        <PasswordChangeWatcher />
      </div>
    </BrowserRouter>
  );
}
