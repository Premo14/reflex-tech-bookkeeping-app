import { createContext, useContext } from 'react';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'primary' | 'danger' | 'secondary';
}

export interface AlertOptions {
  title?: string;
  message: string;
  okText?: string;
  variant?: 'primary' | 'danger' | 'secondary';
}

export interface ConfirmationContextType {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  alert: (options: AlertOptions | string, title?: string) => Promise<void>;
}

export const ConfirmationContext = createContext<ConfirmationContextType | null>(null);

export function useConfirm() {
  const context = useContext(ConfirmationContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmationProvider');
  }
  return context;
}
