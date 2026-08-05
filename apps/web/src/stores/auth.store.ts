import { create } from 'zustand';
import api from '../services/api';

interface Department {
  id: string;
  name: string;
}

interface User {
  id: string;
  username: string;
  real_name: string;
  email?: string;
  phone?: string;
  dept_id: string;
  department?: Department;
  roles: string[];
  permissions?: string[];
}

interface AuthState {
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  register: (data: { username: string; password: string; real_name: string; dept_id: string; email?: string; phone?: string }) => Promise<void>;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  isAuthenticated: () => boolean;
}

/** 认证状态管理 */
export const useAuthStore = create<AuthState>((set, get) => ({
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

  updateUser: (updates) => {
    const currentUser = get().user;
    if (currentUser) {
      const updatedUser = { ...currentUser, ...updates };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      set({ user: updatedUser });
    }
  },

  isAuthenticated: () => !!localStorage.getItem('access_token'),
}));
