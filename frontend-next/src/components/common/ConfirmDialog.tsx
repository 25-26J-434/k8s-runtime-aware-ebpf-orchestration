"use client";

import { Modal } from "antd";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ open, title, description, confirmLabel, destructive, loading, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      okText={confirmLabel}
      okButtonProps={{ danger: destructive, loading }}
      onOk={onConfirm}
      onCancel={onClose}
      width={420}
      centered
      maskClosable={!loading}
    >
      {description}
    </Modal>
  );
}
