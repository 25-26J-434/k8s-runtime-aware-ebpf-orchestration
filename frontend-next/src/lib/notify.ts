import type { MessageInstance } from "antd/es/message/interface";

/**
 * Toasts for code that runs outside components (mutation callbacks). `NotifyBridge`
 * (mounted under antd's <App>) hands over a themed message instance.
 */
let instance: MessageInstance | null = null;

export const setNotifier = (m: MessageInstance | null) => {
  instance = m;
};

export const notify = {
  success: (text: string) => instance?.success(text),
  error: (text: string) => instance?.error(text, 5),
  info: (text: string) => instance?.info(text),
};
