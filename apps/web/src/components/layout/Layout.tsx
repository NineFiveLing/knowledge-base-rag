import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import Can from '../common/Can';

/** 主布局：侧边栏导航 + 顶栏用户信息 + 内容区 */
export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { path: '/knowledge', label: '📁 知识库', icon: '📁' },
    { path: '/chat', label: '💬 AI 问答', icon: '💬' },
    { path: '/documents', label: '📄 文档管理', icon: '📄' },
  ];

  return (
    <div className="layout">
      <aside className="sidebar">
        <h2>企业知识库</h2>
        <nav>
          {navItems.map((item) => (
            <a key={item.path} className={location.pathname.startsWith(item.path) ? 'active' : ''} onClick={() => navigate(item.path)}>
              {item.icon} {item.label}
            </a>
          ))}
          {/* 数据统计 */}
          <a className={location.pathname.startsWith('/analytics') ? 'active' : ''} onClick={() => navigate('/analytics')}>
            📊 数据统计
          </a>
          {/* 系统管理（仅拥有 rbac:read 权限或 admin 角色可见） */}
          <Can permission="rbac:read">
            <a className={location.pathname.startsWith('/admin') ? 'active' : ''} onClick={() => navigate('/admin/roles')}>
              🔑 角色管理
            </a>
          </Can>
        </nav>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <span>👤 {user?.real_name || user?.username}</span>
          <button onClick={logout}>退出</button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
