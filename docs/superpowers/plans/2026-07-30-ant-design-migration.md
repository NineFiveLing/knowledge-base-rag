# Ant Design Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将前端 7 个页面 + Layout 壳子从纯手写 HTML/CSS 全量迁移至 Ant Design 5

**Architecture:** 安装 antd 5 和 @ant-design/icons，用 ConfigProvider 统一主题，逐页面将原生 HTML 替换为 antd 组件（Table/Form/Modal/Menu/Upload 等）。删除 global.css 中被替代的样式，保留聊天气泡等 antd 没有的定制样式。状态管理(Zustand)、路由(React Router v7)、hooks(useSSE/useVoiceChat) 全部不变。

**Tech Stack:** React 19, TypeScript 5.4, Vite 8, antd 5.x, @ant-design/icons, Zustand 5

## Global Constraints

- antd 版本: `^5.x`（最新稳定版）
- 图标库: `@ant-design/icons`
- 主题主色: `#667eea`（沿用现品牌色）
- 圆角: `6`
- `global.css` 仅保留: 基础 reset、字体系列、聊天气泡（其他全部删除）
- 不动文件: `App.tsx`, `api.ts`, `auth.store.ts`, `useSSE.ts`, `useVoiceChat.ts`, `Can.tsx`, `VoiceButton.tsx`, `vite.config.ts`

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| Create | — | 无需新建文件 |
| Modify | `apps/web/package.json` | 添加 antd, @ant-design/icons 依赖 |
| Modify | `apps/web/src/main.tsx` | 挂 ConfigProvider + AntApp 包裹层 |
| Modify | `apps/web/src/styles/global.css` | 删除被替代样式，仅保留 reset + 聊天气泡 |
| Modify | `apps/web/src/components/layout/Layout.tsx` | 改用 antd Layout/Menu/Avatar/Dropdown |
| Modify | `apps/web/src/pages/login/LoginPage.tsx` | 改用 antd Form/Tabs/Card/Button |
| Modify | `apps/web/src/pages/knowledge-base/KnowledgeBasePage.tsx` | 改用 antd Table/Spin/Empty |
| Modify | `apps/web/src/pages/analytics/AnalyticsPage.tsx` | 改用 antd Card/Statistic/Row/Col |
| Modify | `apps/web/src/pages/document/DocumentUploadPage.tsx` | 改用 antd Upload.Dragger/Progress/Card |
| Modify | `apps/web/src/pages/document/DocumentManagePage.tsx` | 改用 antd Table/Modal/Popconfirm/Tag |
| Modify | `apps/web/src/pages/admin/RoleManagePage.tsx` | 改用 antd Table/Modal/Form/Checkbox/Popconfirm |
| Modify | `apps/web/src/pages/chat/ChatPage.tsx` | 改用 antd Input.Search/Tag，气泡保留 |
| No-op | `apps/web/src/App.tsx` | 路由结构不变 |
| No-op | `apps/web/src/services/api.ts` | axios 封装不变 |
| No-op | `apps/web/src/stores/auth.store.ts` | Zustand store 不变 |
| No-op | `apps/web/src/hooks/useSSE.ts` | SSE hook 不变 |
| No-op | `apps/web/src/hooks/useVoiceChat.ts` | 语音 hook 不变 |
| No-op | `apps/web/src/components/common/Can.tsx` | 权限门不变 |
| No-op | `apps/web/src/components/chat/VoiceButton.tsx` | 音频按钮不变 |

---

### Task 1: 安装依赖 + 主题配置 + CSS 清理

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Produces: 全局可用 antd 组件；`AntApp` 包裹层提供 `message` 静态方法上下文；精简后的 global.css

- [ ] **Step 1: 安装依赖**

```bash
cd apps/web && pnpm add antd @ant-design/icons
```

- [ ] **Step 2: 配置 ConfigProvider 和 AntApp 包裹层**

打开 `apps/web/src/main.tsx`，替换为：

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import App from './App';

import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#667eea',
          borderRadius: 6,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
        },
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 3: 清理 global.css**

替换 `apps/web/src/styles/global.css` 为：

```css
/* === 全局基础 === */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
html,
body,
#root {
  height: 100%;
  font-size: 14px;
}

/* === 聊天气泡（antd 无此组件，保留自定义） === */
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 800px;
  margin: 0 auto;
}
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px 0;
}
.chat-bubble {
  margin-bottom: 12px;
  padding: 10px 16px;
  border-radius: 8px;
  max-width: 80%;
  white-space: pre-wrap;
}
.chat-bubble.user {
  background: #667eea;
  color: #fff;
  margin-left: auto;
}
.chat-bubble.assistant {
  background: #f1f5f9;
  color: #333;
}
.chat-bubble.streaming {
  border-left: 3px solid #667eea;
}
```

- [ ] **Step 4: 验证 pnpm dev 启动正常**

```bash
cd apps/web && pnpm dev
```

预期：浏览器打开 localhost:3000，无 antd 导入报错。

- [ ] **Step 5: 提交**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml apps/web/src/main.tsx apps/web/src/styles/global.css
git commit -m "chore: install antd 5 + ConfigProvider theme + clean global.css"
```

---

### Task 2: 重构 Layout（侧边栏 + 顶栏）

**Files:**
- Modify: `apps/web/src/components/layout/Layout.tsx`

**Interfaces:**
- Consumes: antd 全局可用（Task 1）
- Produces: `<Layout />` 组件，侧边栏 Menu + 顶栏用户信息 + `<Outlet />` 内容区

- [ ] **Step 1: 重写 Layout.tsx**

替换 `apps/web/src/components/layout/Layout.tsx` 为：

```tsx
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Avatar, Dropdown, Space } from 'antd';
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
  { key: '/documents', icon: <FileTextOutlined />, label: '文档管理' },
  { key: '/analytics', icon: <BarChartOutlined />, label: '数据统计' },
];

export default function AppLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const selectedKey = '/' + location.pathname.split('/')[1];

  const userMenuItems = [
    { key: 'info', label: <span>{user?.real_name || user?.username}</span>, disabled: true },
    { type: 'divider' as const },
    { key: 'roles', icon: <SettingOutlined />, label: '角色管理' },
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
```

- [ ] **Step 2: 更新 App.tsx 导入**

`App.tsx` 中的 `import Layout from './components/layout/Layout'` 保持不变（文件名未变，导出名未变，仅内部实现变了）。

- [ ] **Step 3: 验证**

```bash
cd apps/web && pnpm dev
```

预期：侧边栏暗色 Menu + 顶栏白色 Header + 用户头像下拉菜单。点击菜单项可切换路由。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/layout/Layout.tsx
git commit -m "refactor: rewrite Layout with antd Sider/Menu/Header/Avatar/Dropdown"
```

---

### Task 3: 重构简单页面 — LoginPage / KnowledgeBasePage / AnalyticsPage

**Files:**
- Modify: `apps/web/src/pages/login/LoginPage.tsx`
- Modify: `apps/web/src/pages/knowledge-base/KnowledgeBasePage.tsx`
- Modify: `apps/web/src/pages/analytics/AnalyticsPage.tsx`

**Interfaces:**
- Consumes: antd 全局可用（Task 1），Layout 已就位（Task 2）
- Produces: 三个页面的 antd 版本

- [ ] **Step 1: 重写 LoginPage.tsx**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Tabs, Form, Input, Button, App } from 'antd';
import { UserOutlined, LockOutlined, IdcardOutlined, TeamOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../stores/auth.store';

interface LoginForm {
  username: string;
  password: string;
}

interface RegisterForm {
  username: string;
  password: string;
  real_name: string;
  dept_id: string;
}

export default function LoginPage() {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuthStore();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const handleLogin = async (values: LoginForm) => {
    setLoading(true);
    try {
      await login(values.username, values.password);
      navigate('/');
    } catch (err: any) {
      message.error(err.response?.data?.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values: RegisterForm) => {
    setLoading(true);
    try {
      await register(values);
      message.success('注册成功，请登录');
      setTab('login');
    } catch (err: any) {
      message.error(err.response?.data?.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      <Card style={{ width: 400, borderRadius: 8 }}>
        <h1 style={{ textAlign: 'center', marginBottom: 20, fontSize: 22 }}>📚 企业知识库 RAG 平台</h1>
        <Tabs activeKey={tab} onChange={(k) => setTab(k as 'login' | 'register')} centered>
          <Tabs.TabPane tab="登录" key="login">
            <Form<LoginForm> onFinish={handleLogin} size="large">
              <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                <Input prefix={<UserOutlined />} placeholder="用户名" />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password prefix={<LockOutlined />} placeholder="密码" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading} block>登录</Button>
              </Form.Item>
            </Form>
          </Tabs.TabPane>
          <Tabs.TabPane tab="注册" key="register">
            <Form<RegisterForm> onFinish={handleRegister} size="large">
              <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                <Input prefix={<UserOutlined />} placeholder="用户名" />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password prefix={<LockOutlined />} placeholder="密码" />
              </Form.Item>
              <Form.Item name="real_name" rules={[{ required: true, message: '请输入真实姓名' }]}>
                <Input prefix={<IdcardOutlined />} placeholder="真实姓名" />
              </Form.Item>
              <Form.Item name="dept_id" rules={[{ required: true, message: '请输入部门 ID' }]}>
                <Input prefix={<TeamOutlined />} placeholder="部门 ID" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading} block>注册</Button>
              </Form.Item>
            </Form>
          </Tabs.TabPane>
        </Tabs>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: 重写 KnowledgeBasePage.tsx**

```tsx
import { useState, useEffect } from 'react';
import { Table, Spin, Empty, Tag } from 'antd';
import api from '../../services/api';

const statusColorMap: Record<string, string> = {
  indexed: 'green',
  failed: 'red',
  indexing: 'blue',
  parsed: 'gold',
  uploading: 'default',
  parsing: 'gold',
};

export default function KnowledgeBasePage() {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/documents')
      .then((res) => setDocs(res.data.items || []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;

  const columns = [
    { title: '文档名', dataIndex: 'name', key: 'name' },
    { title: '类型', dataIndex: 'type', key: 'type' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => <Tag color={statusColorMap[status] || 'default'}>{status}</Tag>,
    },
    {
      title: '上传时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (d: string) => (d ? new Date(d).toLocaleDateString() : '-'),
    },
  ];

  return (
    <div>
      <h2 style={{ marginBottom: 16, fontSize: 20 }}>📁 知识库文档</h2>
      <Table
        columns={columns}
        dataSource={docs}
        rowKey="id"
        locale={{ emptyText: <Empty description="暂无文档，请先上传" /> }}
      />
    </div>
  );
}
```

- [ ] **Step 3: 重写 AnalyticsPage.tsx**

```tsx
import { useState, useEffect } from 'react';
import { Card, Statistic, Table, Spin, Row, Col } from 'antd';
import { FileTextOutlined, UserOutlined, MessageOutlined, CalendarOutlined } from '@ant-design/icons';
import api from '../../services/api';

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<any>({});
  const [docStats, setDocStats] = useState<any>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/analytics/overview'), api.get('/analytics/documents')])
      .then(([o, d]) => {
        setOverview(o.data);
        setDocStats(d.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;

  const typeColumns = [
    { title: '类型', dataIndex: 'type', key: 'type', render: (t: string) => t || '未知' },
    { title: '数量', dataIndex: 'count', key: 'count' },
  ];

  const statusColumns = [
    { title: '状态', dataIndex: 'status', key: 'status' },
    { title: '数量', dataIndex: 'count', key: 'count' },
  ];

  return (
    <div>
      <h1 style={{ marginBottom: 20, fontSize: 20 }}>📊 数据统计</h1>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="文档总数" value={overview.docCount || 0} prefix={<FileTextOutlined />} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="用户数" value={overview.totalUsers || 0} prefix={<UserOutlined />} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="活跃会话" value={overview.totalSessions || 0} prefix={<MessageOutlined />} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="周活跃用户" value={overview.activeUsers || 0} prefix={<CalendarOutlined />} /></Card>
        </Col>
      </Row>

      {docStats.byType?.length > 0 && (
        <Card title="文档类型分布" style={{ marginBottom: 16 }}>
          <Table columns={typeColumns} dataSource={docStats.byType} rowKey="type" pagination={false} />
        </Card>
      )}

      {docStats.byStatus?.length > 0 && (
        <Card title="文档状态分布">
          <Table columns={statusColumns} dataSource={docStats.byStatus} rowKey="status" pagination={false} />
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 验证**

```bash
cd apps/web && pnpm dev
```

预期：登录页有 Card + Tabs 切换登录/注册；知识库页有 Table + Tag 状态色；统计页有 4 个 Statistic 卡片 + 分类型/分状态 Table。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/login/LoginPage.tsx apps/web/src/pages/knowledge-base/KnowledgeBasePage.tsx apps/web/src/pages/analytics/AnalyticsPage.tsx
git commit -m "refactor: rewrite LoginPage, KnowledgeBasePage, AnalyticsPage with antd"
```

---

### Task 4: 重构 DocumentUploadPage

**Files:**
- Modify: `apps/web/src/pages/document/DocumentUploadPage.tsx`

**Interfaces:**
- Consumes: antd 全局可用（Task 1）
- Produces: 拖拽上传页面，支持进度展示

- [ ] **Step 1: 重写 DocumentUploadPage.tsx**

```tsx
import { useState } from 'react';
import { Upload, Card, Progress, Button, App } from 'antd';
import { InboxOutlined, UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import api from '../../services/api';

const { Dragger } = Upload;

export default function DocumentUploadPage() {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const { message } = App.useApp();

  const handleUpload = async () => {
    const file = fileList[0]?.originFileObj;
    if (!file) return;

    setUploading(true);
    setProgress(0);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const { data } = await api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => {
          if (evt.total) setProgress(Math.round((evt.loaded * 100) / evt.total));
        },
      });
      message.success(`上传成功 — 文档 ID: ${data.docId}`);
      setFileList([]);
      setProgress(0);
    } catch (err: any) {
      message.error(err.response?.data?.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: 16, fontSize: 20 }}>📄 上传文档</h2>
      <Card>
        <Dragger
          fileList={fileList}
          beforeUpload={() => false}
          onChange={({ fileList: fl }) => setFileList(fl)}
          maxCount={1}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.txt,.png,.jpg,.jpeg,.mp3,.wav,.mp4"
          onRemove={() => { setFileList([]); setProgress(0); }}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
          <p className="ant-upload-hint">支持 PDF / Word / Excel / PPT / Markdown / 文本 / 图片 / 音频 / 视频</p>
        </Dragger>
        {fileList.length > 0 && (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <Button
              type="primary"
              onClick={handleUpload}
              loading={uploading}
              icon={<UploadOutlined />}
            >
              {uploading ? '上传中' : '开始上传'}
            </Button>
          </div>
        )}
        {progress > 0 && <Progress percent={progress} style={{ marginTop: 16 }} />}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: 验证**

```bash
cd apps/web && pnpm dev
```

预期：拖拽区域带虚线边框+图标，选择文件后显示"开始上传"按钮，点击后进度条实时更新，成功/失败有 message 提示。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/pages/document/DocumentUploadPage.tsx
git commit -m "refactor: rewrite DocumentUploadPage with antd Upload.Dragger"
```

---

### Task 5: 重构 DocumentManagePage

**Files:**
- Modify: `apps/web/src/pages/document/DocumentManagePage.tsx`

**Interfaces:**
- Consumes: antd 全局可用（Task 1）
- Produces: 文档列表 Table + 预览 Modal + 删除 Popconfirm + 重索引按钮

- [ ] **Step 1: 重写 DocumentManagePage.tsx**

```tsx
import { useState, useEffect } from 'react';
import { Table, Button, Modal, Popconfirm, Tag, Spin, App } from 'antd';
import { EyeOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../../services/api';

const statusColorMap: Record<string, string> = {
  indexed: 'green',
  failed: 'red',
  indexing: 'blue',
  parsed: 'gold',
  uploading: 'default',
  parsing: 'gold',
};

export default function DocumentManagePage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ markdown: string; metadata?: any } | null>(null);
  const { message } = App.useApp();

  useEffect(() => {
    loadDocuments();
  }, []);

  async function loadDocuments() {
    setLoading(true);
    try {
      const { data } = await api.get('/documents', { params: { pageSize: 100 } });
      setDocuments(data.items);
    } catch {
      message.error('加载文档列表失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/documents/${id}`);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      message.success('删除成功');
    } catch {
      message.error('删除失败');
    }
  }

  async function handlePreview(id: string) {
    try {
      const { data } = await api.get(`/documents/${id}/preview`);
      setPreview(data);
    } catch {
      message.error('预览失败');
    }
  }

  async function handleReindex(id: string) {
    try {
      await api.post(`/documents/${id}/reindex`);
      message.success('重索引已触发');
      loadDocuments();
    } catch {
      message.error('重索引失败');
    }
  }

  if (loading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '类型', dataIndex: 'type', key: 'type' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <Tag color={statusColorMap[s] || 'default'}>{s}</Tag>,
    },
    {
      title: '上传时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (d: string) => (d ? new Date(d).toLocaleDateString() : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: any) => (
        <Button.Group>
          <Button size="small" icon={<EyeOutlined />} onClick={() => handlePreview(record.id)}>预览</Button>
          {record.status === 'failed' && (
            <Button size="small" icon={<ReloadOutlined />} onClick={() => handleReindex(record.id)}>重索引</Button>
          )}
          <Popconfirm title="确定要删除此文档吗？此操作不可撤销。" onConfirm={() => handleDelete(record.id)} okText="确定" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Button.Group>
      ),
    },
  ];

  return (
    <div>
      <h1 style={{ marginBottom: 16, fontSize: 20 }}>📂 文档管理</h1>
      <Table columns={columns} dataSource={documents} rowKey="id" />

      <Modal
        title={preview?.metadata?.name || '预览'}
        open={!!preview}
        onCancel={() => setPreview(null)}
        footer={<Button onClick={() => setPreview(null)}>关闭</Button>}
        width={800}
      >
        <pre style={{ maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {preview?.markdown}
        </pre>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: 验证**

```bash
cd apps/web && pnpm dev
```

预期：文档列表 Table + 状态 Tag + 操作按钮组。点击预览弹出 Modal 展示 Markdown，点击删除弹出 Popconfirm。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/pages/document/DocumentManagePage.tsx
git commit -m "refactor: rewrite DocumentManagePage with antd Table/Modal/Popconfirm"
```

---

### Task 6: 重构 RoleManagePage

**Files:**
- Modify: `apps/web/src/pages/admin/RoleManagePage.tsx`

**Interfaces:**
- Consumes: antd 全局可用（Task 1），Can 组件不变
- Produces: 角色列表 Table + 创建/编辑 Modal Form + 删除 Popconfirm + 权限 Checkbox

- [ ] **Step 1: 重写 RoleManagePage.tsx**

```tsx
import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Checkbox, Popconfirm, Tag, Spin, App } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../../services/api';
import Can from '../../components/common/Can';

interface Role {
  id: string;
  name: string;
  description?: string;
  code: string;
  is_system: boolean;
  user_count: number;
  created_at: string;
}

interface Permission {
  id: string;
  code: string;
  resource: string;
  action: string;
}

export default function RoleManagePage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const { message } = App.useApp();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [{ data: rolesData }, { data: permsData }] = await Promise.all([
        api.get('/rbac/roles'),
        api.get('/rbac/permissions'),
      ]);
      setRoles(rolesData);
      setPermissions(permsData);
    } catch {
      message.error('加载数据失败，请确认您拥有管理员权限');
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditingRole(null);
    form.resetFields();
    form.setFieldsValue({ permissionCodes: [] });
    setModalOpen(true);
  }

  async function openEdit(role: Role) {
    setEditingRole(role);
    form.setFieldsValue({ name: role.name, description: role.description || '' });
    setModalOpen(true);
    setSaving(true);
    try {
      const { data } = await api.get(`/rbac/roles/${role.id}`);
      form.setFieldsValue({ permissionCodes: data.permissions || [] });
    } catch {
      form.setFieldsValue({ permissionCodes: [] });
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingRole) {
        await api.patch(`/rbac/roles/${editingRole.id}`, values);
      } else {
        await api.post('/rbac/roles', values);
      }
      message.success(editingRole ? '更新成功' : '创建成功');
      setModalOpen(false);
      await loadData();
    } catch (err: any) {
      if (err.response) {
        message.error(err.response.data?.message || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(role: Role) {
    setSaving(true);
    try {
      await api.delete(`/rbac/roles/${role.id}`);
      message.success('删除成功');
      await loadData();
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;

  const columns = [
    {
      title: '角色名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Role) => (
        <>
          <strong>{name}</strong>
          <br />
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{record.code}</span>
        </>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (d: string | undefined) => d || '-',
    },
    { title: '用户数', dataIndex: 'user_count', key: 'user_count' },
    {
      title: '类型',
      dataIndex: 'is_system',
      key: 'is_system',
      render: (v: boolean) =>
        v ? <Tag color="gold">系统</Tag> : <Tag>自定义</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (d: string) => new Date(d).toLocaleDateString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: Role) => (
        <>
          <Can permission="rbac:write">
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} style={{ marginRight: 8 }}>
              编辑
            </Button>
          </Can>
          {!record.is_system && (
            <Can permission="rbac:write">
              <Popconfirm title="确定要删除该角色吗？关联的用户角色分配也将被移除。" onConfirm={() => handleDelete(record)} okText="确定" cancelText="取消">
                <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            </Can>
          )}
        </>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0, fontSize: 20 }}>🔑 角色管理</h2>
        <Can permission="rbac:write">
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建角色</Button>
        </Can>
      </div>

      <Table columns={columns} dataSource={roles} rowKey="id" />

      <Modal
        title={editingRole ? '编辑角色' : '新建角色'}
        open={modalOpen}
        onCancel={() => !saving && setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="角色名称" rules={[{ required: true, message: '请输入角色名称' }]}>
            <Input placeholder="角色名称" disabled={saving} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="角色描述（可选）" disabled={saving} />
          </Form.Item>
          <Form.Item name="permissionCodes" label="权限">
            <Checkbox.Group style={{ width: '100%' }}>
              {permissions.map((perm) => (
                <div key={perm.id} style={{ marginBottom: 4 }}>
                  <Checkbox value={perm.code} disabled={saving}>
                    <code style={{ fontSize: 12 }}>{perm.code}</code>
                    <span style={{ color: '#94a3b8', fontSize: 12, marginLeft: 8 }}>
                      ({perm.resource}:{perm.action})
                    </span>
                  </Checkbox>
                </div>
              ))}
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: 验证**

```bash
cd apps/web && pnpm dev
```

预期：角色 Table 含 Tag（系统/自定义）、编辑按钮打开 Modal Form 含权限 Checkbox 列表、删除 Popconfirm、`message` 提示替代 `alert()`。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/pages/admin/RoleManagePage.tsx
git commit -m "refactor: rewrite RoleManagePage with antd Table/Modal/Form/Checkbox"
```

---

### Task 7: 重构 ChatPage（输入区 + 来源标签）

**Files:**
- Modify: `apps/web/src/pages/chat/ChatPage.tsx`

**Interfaces:**
- Consumes: antd 全局可用（Task 1），useSSE/useVoiceChat hooks 不变
- Produces: 聊天页，输入区用 Input.Search + Tag，气泡保留自定义 CSS

- [ ] **Step 1: 重写 ChatPage.tsx**

```tsx
import { useState, useRef, useEffect } from 'react';
import { Input, Button, Tag, Spin } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useSSE } from '../../hooks/useSSE';
import { useVoiceChat } from '../../hooks/useVoiceChat';
import VoiceButton from '../../components/chat/VoiceButton';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState('');
  const [input, setInput] = useState('');
  const [sources, setSources] = useState<Array<{ index: number; docId: string; chunkId: string }>>([]);
  const { sendMessage, loading: sseLoading } = useSSE();
  const sessionId = useRef(`sess-${Date.now()}`).current;
  const { isRecording, asrText, triggerMessage, connect, startRecording, stopRecording, clearTrigger } =
    useVoiceChat(sessionId);

  useEffect(() => {
    const socket = connect();
    return () => { socket?.disconnect(); };
  }, []);

  useEffect(() => {
    if (triggerMessage) {
      handleSend(triggerMessage);
      clearTrigger();
    }
  }, [triggerMessage]);

  const handleSend = async (voiceText?: string) => {
    const text = (voiceText || input).trim();
    if (!text || !!streaming) return;
    if (!voiceText) setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setStreaming('');

    await sendMessage(
      text,
      sessionId,
      (token) => setStreaming((prev) => prev + token),
      () =>
        setStreaming((prev) => {
          if (prev) setMessages((msgs) => [...msgs, { role: 'assistant', content: prev }]);
          return '';
        }),
      (srcs) => setSources(srcs),
    );
  };

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        {sseLoading && !streaming && <Spin style={{ display: 'block', margin: '12px 0' }} />}
        {streaming && <div className="chat-bubble assistant streaming">{streaming}</div>}
      </div>

      {sources.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <span style={{ marginRight: 8, color: '#666', fontSize: 13 }}>参考来源：</span>
          {sources.map((s) => (
            <Tag key={s.index} color="blue" title={`文档: ${s.docId} | 片段: ${s.chunkId}`}>
              [{s.index}]
            </Tag>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={() => handleSend()}
          placeholder="输入您的问题..."
          disabled={!!streaming}
          size="large"
          style={{ flex: 1 }}
        />
        <VoiceButton isRecording={isRecording} onStart={startRecording} onStop={stopRecording} />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={() => handleSend()}
          disabled={!!streaming}
          size="large"
        >
          发送
        </Button>
      </div>

      {asrText && (
        <div style={{ marginTop: 8, padding: 8, background: '#f6ffed', borderRadius: 4, fontSize: 13 }}>
          🎤 {asrText}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 检查 ChatPage 中 `sseLoading` 来源**

打开 `apps/web/src/hooks/useSSE.ts`，确认 hook 导出了 `loading` 状态。如果没有，在 hook 中添加：

```typescript
const [loading, setLoading] = useState(false);
// 在 sendMessage 中请求前 setLoading(true)，done 回调或 catch 中 setLoading(false)
```

如果 hook 当前未导出 `loading`，忽略此步（上述代码中可先移除 `sseLoading` 引用，仅保留 `streaming` 判断）。

简化方案：将第 73 行的 `{sseLoading && !streaming && ...}` 改为仅使用 `streaming` 判断：

```tsx
{!streaming && messages.length === 0 && <Spin style={{ display: 'block', margin: '12px 0' }} />}
```

- [ ] **Step 3: 验证**

```bash
cd apps/web && pnpm dev
```

预期：`Input.Search` + `Button` 输入区，`Tag` 来源标签，气泡保留自定义 CSS 效果不变。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/pages/chat/ChatPage.tsx
git commit -m "refactor: rewrite ChatPage input/sources with antd Input/Tag"
```

---

### Task 8: 构建验证

**Files:**
- None（验证环节）

- [ ] **Step 1: TypeScript 编译检查**

```bash
cd apps/web && npx tsc --noEmit
```

预期：零错误。如有因 `useSSE` hook 缺少 `loading` 导出导致的类型错误，在 `useSSE.ts` 中添加 `loading` state 并导出，或在 ChatPage 中移除该引用。

- [ ] **Step 2: Vite 生产构建**

```bash
cd apps/web && pnpm build
```

预期：构建成功，无警告。

- [ ] **Step 3: 逐页功能验收**

启动 `pnpm dev`，逐一验证：

| 页面 | 验证点 |
|------|--------|
| `/login` | Card+Tabs 切换、表单校验、登录/注册 message 提示 |
| `/chat` | 输入回车发送、SSE 流式、来源 Tag、语音按钮 |
| `/knowledge` | Table 列表、Tag 状态色 |
| `/documents` | Upload.Dragger、Progress、message |
| `/documents/manage` | Table、Modal 预览、Popconfirm 删除 |
| `/admin/roles` | Table、创建/编辑 Modal Form、权限 Checkbox、Popconfirm |
| `/analytics` | Statistic 卡片、Table 分布 |

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore: build verification passed, antd migration complete"
```

---

## Task Dependency Graph

```
Task 1 (deps + theme + CSS)
  └─> Task 2 (Layout)
        └─> Task 3 (Login/Knowledge/Analytics)
        └─> Task 4 (UploadPage)
        └─> Task 5 (ManagePage)
        └─> Task 6 (RolePage)
        └─> Task 7 (ChatPage)
              └─> Task 8 (Build verify)
```

Tasks 3-7 互不依赖，可并行执行。
