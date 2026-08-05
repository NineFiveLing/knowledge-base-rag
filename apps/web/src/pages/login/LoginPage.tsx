import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Tabs, Form, Input, Button, App, Select } from 'antd';
import { UserOutlined, LockOutlined, IdcardOutlined, TeamOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../stores/auth.store';
import api from '../../services/api';

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

interface Department {
  id: string;
  name: string;
}

export default function LoginPage() {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const { login, register } = useAuthStore();
  const navigate = useNavigate();
  const { message } = App.useApp();

  // 加载部门列表供注册下拉选择
  useEffect(() => {
    api.get('/departments').then(({ data }) => setDepartments(data || [])).catch(() => {});
  }, []);

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
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as 'login' | 'register')}
          centered
          items={[
            {
              key: 'login',
              label: '登录',
              children: (
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
              ),
            },
            {
              key: 'register',
              label: '注册',
              children: (
                <Form<RegisterForm> onFinish={handleRegister} size="large">
                  <Form.Item name="username" rules={[
                    { required: true, message: '请输入用户名' },
                    { min: 3, message: '用户名至少3个字符' },
                    { max: 30, message: '用户名最多30个字符' },
                  ]}>
                    <Input prefix={<UserOutlined />} placeholder="用户名" />
                  </Form.Item>
                  <Form.Item name="password" rules={[
                    { required: true, message: '请输入密码' },
                    { min: 6, message: '密码至少6个字符' },
                  ]}>
                    <Input.Password prefix={<LockOutlined />} placeholder="密码" />
                  </Form.Item>
                  <Form.Item name="real_name" rules={[{ required: true, message: '请输入真实姓名' }]}>
                    <Input prefix={<IdcardOutlined />} placeholder="真实姓名" />
                  </Form.Item>
                  <Form.Item name="dept_id" rules={[{ required: true, message: '请选择所属部门' }]}>
                    <Select placeholder="选择部门" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={loading} block>注册</Button>
                  </Form.Item>
                </Form>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
