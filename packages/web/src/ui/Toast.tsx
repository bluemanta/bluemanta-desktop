import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import styles from './Toast.module.css';

const TOAST_MS = 4_000;

export type ToastAction = { label: string; onClick: () => void };

type ToastApi = { show: (text: string, action?: ToastAction) => void };

const ToastContext = createContext<ToastApi>({ show: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

/** 轻提示：底部居中，4 秒消失，`role="status"`；可逆操作带「撤销」。 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ text: string; key: number; action?: ToastAction } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((text: string, action?: ToastAction) => {
    window.clearTimeout(timer.current);
    setMessage({ text, key: Date.now(), action });
    timer.current = window.setTimeout(() => setMessage(null), TOAST_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {message ? (
          <div key={message.key} className={styles.toast}>
            <span>{message.text}</span>
            {message.action ? (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  window.clearTimeout(timer.current);
                  const run = message.action?.onClick;
                  setMessage(null);
                  run?.();
                }}
              >
                {message.action.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
