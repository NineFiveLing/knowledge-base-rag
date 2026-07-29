import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';

/** 登录页面：支持登录和注册切换 */
export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [form, setForm] = useState({ username: '', password: '', real_name: '', dept_id: '' });
  const [error, setError] = useState('');
  const { login, register } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (isLogin) {
        await login(form.username, form.password);
        navigate('/');
      } else {
        await register(form);
        setIsLogin(true);
        setError('注册成功，请登录');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || '操作失败');
    }
  };

  return (
    <div className="login-page">
      <form onSubmit={handleSubmit} className="login-form">
        <h1>📚 企业知识库 RAG 平台</h1>
        {error && <div className="error-msg">{error}</div>}
        <input placeholder="用户名" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
        <input type="password" placeholder="密码" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        {!isLogin && (
          <>
            <input placeholder="真实姓名" value={form.real_name} onChange={(e) => setForm({ ...form, real_name: e.target.value })} required />
            <input placeholder="部门 ID" value={form.dept_id} onChange={(e) => setForm({ ...form, dept_id: e.target.value })} required />
          </>
        )}
        <button type="submit">{isLogin ? '登录' : '注册'}</button>
        <p className="toggle" onClick={() => setIsLogin(!isLogin)}>
          {isLogin ? '没有账号？去注册' : '已有账号？去登录'}
        </p>
      </form>
    </div>
  );
}
