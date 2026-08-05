import axios from 'axios';

/** 统一 API 客户端：自动附加 JWT Token，401 时跳转登录页 */
const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // 登录/注册/修改密码端点不自动跳转，由页面内 catch 处理错误提示
    const skipPaths = ['/auth/login', '/auth/register', '/auth/password'];
    if ((err.response?.status === 401 || err.response?.status === 403) && !skipPaths.some(p => err.config?.url?.endsWith(p))) {
      const msg = err.response?.data?.message || '';
      // 密码被重置 → 发事件通知 React 组件弹窗（拦截器不在 React 树内，无法直接弹窗）
      if (msg.includes('密码已变更') || msg.includes('请重新登录')) {
        // 立即清除 token，阻止后续请求带着无效 token 发起
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');
        window.dispatchEvent(new CustomEvent('password-changed', { detail: { message: msg } }));
        return Promise.reject(err);
      }
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    // 兜底：500 也检查是否密码变更
    if (err.response?.status === 500) {
      const msg = err.response?.data?.message || '';
      if (msg.includes('密码已变更') || msg.includes('请重新登录')) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');
        window.dispatchEvent(new CustomEvent('password-changed', { detail: { message: msg } }));
      }
    }
    return Promise.reject(err);
  },
);

export default api;
