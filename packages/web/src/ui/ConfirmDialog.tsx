import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import styles from './ConfirmDialog.module.css';

export type ConfirmRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
};

type ConfirmApi = (request: ConfirmRequest) => Promise<boolean>;

const Context = createContext<ConfirmApi>(async () => false);

export function useConfirm(): ConfirmApi {
  return useContext(Context);
}

export const DISCARD_CONFIRM: ConfirmRequest = {
  title: '放弃未保存的修改？',
  description: '这次编辑会丢掉。',
  confirmLabel: '放弃修改',
  cancelLabel: '继续编辑',
  danger: true,
};

/** 只用于不可逆操作。esc 关闭；打开时焦点在取消（安全）按钮上。 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const pending = useRef<((value: boolean) => void) | null>(null);
  const choice = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const finish = (value: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    choice.current = false;
    setRequest(null);
    resolve?.(value);
  };

  const confirm = useCallback((next: ConfirmRequest) => {
    return new Promise<boolean>((resolve) => {
      if (pending.current) pending.current(false);
      pending.current = resolve;
      choice.current = false;
      setRequest(next);
    });
  }, []);

  return (
    <Context.Provider value={confirm}>
      {children}
      <AlertDialog.Root
        open={request !== null}
        onOpenChange={(open) => {
          if (!open) finish(choice.current);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className={styles.scrim} />
          <AlertDialog.Content
            className={styles.dialog}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              cancelRef.current?.focus();
            }}
          >
            <AlertDialog.Title className={styles.title}>{request?.title}</AlertDialog.Title>
            <AlertDialog.Description className={styles.text}>{request?.description}</AlertDialog.Description>
            <div className={styles.actions}>
              <AlertDialog.Cancel asChild>
                <Button ref={cancelRef}>{request?.cancelLabel ?? '取消'}</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button variant={request?.danger ? 'dangerFill' : 'primary'} onClick={() => (choice.current = true)}>
                  {request?.confirmLabel ?? '确定'}
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </Context.Provider>
  );
}
