import { create } from 'zustand';
import api from '../services/api';

interface User {
  id: string;
  username: string;
  real_name: string;
  roles: string[];
  dept_id: string;
}

interface AuthState {
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  register: (data: { username: string; password: string; real_name: string; dept_id: string }) => Promise<void>;
  logout: () => void;
  isAuthenticated: () => boolean;
}

/** 认证状态管理 */
export const useAuthStore = create<AuthState>((set) => ({
  user: JSON.parse(localStorage.getItem('user') || 'null'),

  login: async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password });
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('user', JSON.stringify(data.user));
    set({ user: data.user });
  },

  register: async (form) => {
    await api.post('/auth/register', form);
  },

  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    set({ user: null });
    window.location.href = '/login';
  },

  isAuthenticated: () => !!localStorage.getItem('access_token'),
}));
