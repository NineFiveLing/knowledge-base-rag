import { useEffect, useRef, useCallback } from 'react';
import { Modal, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.store';

/**
 * Hook: 权限变更监听
 * 当检测到权限/角色变化时，提示用户重新登录
 */
export function usePermissionChange(intervalMs: number = 30000) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const timerRef = useRef<number | null>(null);
  const lastPermissionsRef = useRef<string[]>(user?.permissions || []);
  const lastRolesRef = useRef<string[]>(user?.roles || []);

  const checkPermissionChange = useCallback(async () => {
    if (!user) return;

    try {
      const token = localStorage.getItem('access_token');
      if (!token) return;

      // 调用一个简单的接口来验证 token 有效性并获取最新的权限信息
      const response = await fetch('/auth/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        // Token 失效或被撤销，需要重新登录
        Modal.warning({
          title: '权限已变更',
          content: '您的权限已发生变更，请重新登录以继续使用系统。',
          okText: '重新登录',
          centered: true,
          onOk: () => {
            logout();
            navigate('/login');
          },
          closable: false,
          maskClosable: false,
        });
        return;
      }

      if (response.ok) {
        const data = await response.json();

        // 检查权限是否变化
        const currentPermissions = data.permissions || [];
        const currentRoles = data.roles || [];

        const permissionsChanged = JSON.stringify(currentPermissions.sort()) !==
                                   JSON.stringify(lastPermissionsRef.current.sort());
        const rolesChanged = JSON.stringify(currentRoles.sort()) !==
                            JSON.stringify(lastRolesRef.current.sort());

        if (permissionsChanged || rolesChanged) {
          // 权限或角色发生变化
          lastPermissionsRef.current = currentPermissions;
          lastRolesRef.current = currentRoles;

          // 更新本地存储的用户信息
          const currentUser = useAuthStore.getState().user;
          if (currentUser) {
            const updatedUser = {
              ...currentUser,
              permissions: currentPermissions,
              roles: currentRoles,
            };
            localStorage.setItem('user', JSON.stringify(updatedUser));
            useAuthStore.setState({ user: updatedUser });
          }

          // 如果当前用户权限被剥夺了某些操作权限，提示重新登录
          Modal.warning({
            title: '权限已变更',
            content: '您的权限已发生变更，部分功能可能不可用。建议重新登录以获取最新权限。',
            okText: '我知道了',
            centered: true,
            onOk: () => {
              // 可选：是否强制重新登录
              // logout();
              // navigate('/login');
            },
          });
        }
      }
    } catch (error) {
      // 网络错误，忽略
      console.debug('权限检查失败:', error);
    }
  }, [user, logout, navigate]);

  useEffect(() => {
    // 初始化权限引用
    if (user) {
      lastPermissionsRef.current = user.permissions || [];
      lastRolesRef.current = user.roles || [];
    }

    // 立即检查一次
    checkPermissionChange();

    // 设置定时检查
    timerRef.current = setInterval(checkPermissionChange, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [checkPermissionChange, intervalMs, user]);

  return { checkPermissionChange };
}
