import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Space } from 'antd';
import {
  FolderOutlined,
  MessageOutlined,
  FileTextOutlined,
  BarChartOutlined,
  SettingOutlined,
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../stores/auth.store';
import Can from '../common/Can';

const { Sider, Header, Content } = Layout;

const menuItems = [
  { key: '/knowledge', icon: <FolderOutlined />, label: '知识库' },
  { key: '/chat', icon: <MessageOutlined />, label: 'AI 问答' },
  { key: '/documents/manage', icon: <FileTextOutlined />, label: '文档管理' },
  { key: '/analytics', icon: <BarChartOutlined />, label: '数据统计' },
];

export default function AppLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const pathname = location.pathname;
  const selectedKey = pathname.startsWith('/documents') ? '/documents/manage' : '/' + pathname.split('/')[1];

  const isAdmin = user?.roles?.includes('admin') || user?.permissions?.includes('rbac:read');
  const userMenuItems = [
    { key: 'info', label: <span>{user?.real_name || user?.username}</span>, disabled: true },
    { type: 'divider' as const },
    ...(isAdmin
      ? [{ key: 'roles' as const, icon: <SettingOutlined />, label: '角色管理' }]
      : []),
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
  ];

  const handleUserMenu = ({ key }: { key: string }) => {
    if (key === 'logout') logout();
    if (key === 'roles') navigate('/admin/roles');
  };

  return (
    <Layout style={{ height: '100%' }}>
      <Sider width={220} theme="dark">
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 20,
            color: '#fff',
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          📚 企业知识库
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
        {/* 角色管理入口：仅管理员可见 */}
        <div style={{ padding: '0 24px', marginTop: 8 }}>
          <Can permission="rbac:read">
            <Menu
              theme="dark"
              mode="inline"
              selectable={false}
              items={[{ key: '/admin/roles', icon: <SettingOutlined />, label: '角色管理' }]}
              onClick={({ key }) => navigate(key)}
            />
          </Can>
        </div>
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 20px',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenu }}>
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <span>{user?.real_name || user?.username}</span>
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ padding: 20, overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
