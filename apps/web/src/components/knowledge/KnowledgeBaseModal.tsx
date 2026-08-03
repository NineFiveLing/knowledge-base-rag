import { Modal, Form, Input, App } from 'antd';
import { useEffect } from 'react';
import api from '../../services/api';

interface KBInfo {
  id?: string;
  name?: string;
  description?: string;
}

interface Props {
  open: boolean;
  knowledgeBase: KBInfo | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function KnowledgeBaseModal({ open, knowledgeBase, onClose, onSuccess }: Props) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const isEdit = !!knowledgeBase?.id;

  useEffect(() => {
    if (knowledgeBase) {
      form.setFieldsValue({
        name: knowledgeBase.name || '',
        description: knowledgeBase.description || '',
      });
    } else {
      form.resetFields();
    }
  }, [knowledgeBase, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    try {
      if (isEdit) {
        await api.patch(`/knowledge-bases/${knowledgeBase!.id}`, values);
        message.success('知识库已更新');
      } else {
        await api.post('/knowledge-bases', values);
        message.success('知识库已创建');
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      message.error(err.response?.data?.message || '操作失败');
    }
  };

  return (
    <Modal
      title={isEdit ? '编辑知识库' : '新建知识库'}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="知识库名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input maxLength={100} placeholder="例如：研发知识库" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="知识库简介（可选）" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
