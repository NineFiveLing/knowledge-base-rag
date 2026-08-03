import { Modal, Form, Input, App } from 'antd';
import { useEffect } from 'react';
import api from '../../services/api';

interface FolderInfo {
  id?: string;
  name?: string;
}

interface Props {
  open: boolean;
  folder: FolderInfo | null;  // null = 新建，有 id = 重命名
  kbId: string;
  parentId?: string;          // 新建时指定父文件夹
  onClose: () => void;
  onSuccess: () => void;
}

export default function FolderModal({ open, folder, kbId, parentId, onClose, onSuccess }: Props) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const isRename = !!folder?.id;

  useEffect(() => {
    if (folder) {
      form.setFieldsValue({ name: folder.name || '' });
    } else {
      form.resetFields();
    }
  }, [folder, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    try {
      if (isRename) {
        await api.patch(`/knowledge-bases/folders/${folder!.id}`, { name: values.name });
        message.success('文件夹已重命名');
      } else {
        await api.post(`/knowledge-bases/${kbId}/folders`, {
          name: values.name,
          kb_id: kbId,
          parent_id: parentId || undefined,
        });
        message.success('文件夹已创建');
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      message.error(err.response?.data?.message || '操作失败');
    }
  };

  return (
    <Modal
      title={isRename ? '重命名文件夹' : '新建文件夹'}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="文件夹名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input maxLength={200} placeholder="例如：前端规范" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
