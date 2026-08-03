import { Modal, TreeSelect, App } from 'antd';
import { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';

interface FolderNode {
  id: string;
  name: string;
  parent_id: string | null;
}

interface Props {
  open: boolean;
  folder: FolderNode | null;
  allFolders: FolderNode[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function MoveFolderModal({ open, folder, allFolders, onClose, onSuccess }: Props) {
  const [targetParentId, setTargetParentId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();

  // 收集自身及所有子孙节点 ID（需要排除）
  const excludedIds = useMemo(() => {
    if (!folder) return new Set<string>();
    const ids = new Set<string>();
    ids.add(folder.id);
    // BFS/递归收集子节点
    const collectChildren = (parentId: string) => {
      allFolders.forEach(f => {
        if (f.parent_id === parentId && !ids.has(f.id)) {
          ids.add(f.id);
          collectChildren(f.id);
        }
      });
    };
    collectChildren(folder.id);
    return ids;
  }, [folder, allFolders]);

  // 构建 TreeSelect 数据（排除自身及子孙）
  const treeData = useMemo(() => {
    const availableFolders = allFolders.filter(f => !excludedIds.has(f.id));
    const buildTree = (parentId: string | null): any[] =>
      availableFolders
        .filter(f => f.parent_id === parentId)
        .map(f => ({
          title: f.name,
          value: f.id,
          key: f.id,
          children: buildTree(f.id),
        }));
    return buildTree(null);
  }, [allFolders, excludedIds]);

  useEffect(() => {
    if (open) {
      setTargetParentId(undefined);
    }
  }, [open]);

  const handleOk = async () => {
    if (!folder) return;
    setLoading(true);
    try {
      await api.post(`/knowledge-bases/folders/${folder.id}/move`, {
        new_parent_id: targetParentId || null,
      });
      message.success('文件夹已移动');
      onSuccess();
      onClose();
    } catch (err: any) {
      message.error(err.response?.data?.message || '移动失败');
    } finally {
      setLoading(false);
    }
  };

  if (!folder) return null;

  return (
    <Modal
      title={`移动文件夹 — ${folder.name}`}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="移动"
      cancelText="取消"
      confirmLoading={loading}
      destroyOnClose
    >
      <p style={{ marginBottom: 8, color: '#666' }}>
        选择目标位置，留空则移到知识库根目录
      </p>
      <TreeSelect
        style={{ width: '100%' }}
        placeholder="留空则移到根目录"
        allowClear
        treeDefaultExpandAll
        treeData={treeData}
        value={targetParentId}
        onChange={(val) => setTargetParentId(val)}
      />
    </Modal>
  );
}
