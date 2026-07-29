import { ReactNode } from 'react';
import { useAuthStore } from '../../stores/auth.store';

interface Props {
  /** 需要的权限码（如 'rbac:write'） */
  permission?: string;
  /** 需要的角色码（如 'admin'） */
  role?: string;
  children: ReactNode;
}

/** 权限控制组件：无权限时不渲染子元素。admin 角色拥有所有权限 */
export default function Can({ permission, role, children }: Props) {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;

  // admin 角色拥有所有权限
  if (user.roles?.includes('admin')) return <>{children}</>;

  if (role && !user.roles?.includes(role)) return null;
  if (permission && !user.permissions?.includes(permission)) return null;

  return <>{children}</>;
}
