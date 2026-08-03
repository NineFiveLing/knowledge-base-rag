import { Modal, Form, Input, Select, TreeSelect, App } from 'antd';
import { useEffect, useState } from 'react';
import type { DataNode } from 'antd/es/tree';
import api from '../../services/api';

interface DocInfo {
  id: string;
  name: string;
  visibility: string;
  dept_id?: string;
  folder_id?: string;
  kb_id?: string;
}

interface Props {
  open: boolean;
  document: DocInfo | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DocumentEditModal({ open, document, onClose, onSuccess }: Props) {
  const [form] = Form.useForm();
  const { message } = App.useApp();

  // KB + 文件夹选择
  const [kbs, setKbs] = useState<{ value: string; label: string }[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | undefined>();
  const [folderTree, setFolderTree] = useState<DataNode[]>([]);

  // 部门选择
  const [departments, setDepartments] = useState<{ value: string; label: string }[]>([]);

  // 加载 KB 列表
  useEffect(() => {
    api.get('/knowledge-bases').then(({ data }) => {
      setKbs((data || []).map((kb: any) => ({ value: kb.id, label: kb.name })));
    }).catch(() => {});
  }, []);

  // 加载部门列表
  useEffect(() => {
    api.get('/departments').then(({ data }) => {
      setDepartments((data || []).map((d: any) => ({ value: d.id, label: d.name })));
    }).catch(() => {});
  }, []);

  // KB 变化时加载文件夹树
  useEffect(() => {
    if (!selectedKbId) { setFolderTree([]); return; }
    api.get(`/knowledge-bases/${selectedKbId}/folders`).then(({ data }) => {
      const toTreeOptions = (nodes: any[]): DataNode[] =>
        nodes.map((n: any) => ({
          key: n.id,
          value: n.id,
          title: n.name,
          children: n.children ? toTreeOptions(n.children) : undefined,
        }));
      setFolderTree(toTreeOptions(data || []));
    }).catch(() => setFolderTree([]));
  }, [selectedKbId]);

  // 初始化表单 + 反查 folder 所属 KB
  useEffect(() => {
    if (document) {
      form.setFieldsValue({
        name: document.name,
        visibility: document.visibility,
        dept_id: document.dept_id || undefined,
        folder_id: document.folder_id || undefined,
        kb_id: document.kb_id || undefined,
      });
      setSelectedKbId(document.kb_id || undefined);
    }
  }, [document, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    try {
      await api.patch(`/documents/${document!.id}`, {
        name: values.name,
        visibility: values.visibility,
        dept_id: values.dept_id || undefined,
        folder_id: values.folder_id ?? null,
        kb_id: values.kb_id ?? null,
      });
      message.success('修改成功');
      onSuccess();
      onClose();
    } catch (err: any) {
      message.error(err.response?.data?.message || '修改失败');
    }
  };

  return (
    <Modal
      title="编辑文档"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="文件名" rules={[{ required: true, message: '请输入文件名' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="visibility" label="可见性" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'public', label: '公开 — 所有人可见' },
              { value: 'dept', label: '部门 — 仅本部门可见' },
              { value: 'private', label: '私有 — 仅自己可见' },
            ]}
          />
        </Form.Item>
        <Form.Item name="dept_id" label="所属部门">
          <Select
            placeholder="选择部门（可选）"
            allowClear
            showSearch
            filterOption={(input, option) =>
              (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
            }
            options={departments}
          />
        </Form.Item>
        <Form.Item name="kb_id" label="所属知识库">
          <Select
            style={{ width: '100%' }}
            placeholder="选择知识库（可选）"
            allowClear
            options={kbs}
            onChange={(val) => { setSelectedKbId(val); form.setFieldValue('folder_id', undefined); }}
          />
        </Form.Item>
        <Form.Item name="folder_id" label="所属文件夹">
          <TreeSelect
            style={{ width: '100%' }}
            placeholder="选择文件夹（可选，用于重新归类文档）"
            treeData={folderTree}
            allowClear
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
