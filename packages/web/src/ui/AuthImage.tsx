import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { apiFetch, describeError } from '../api/client';
import styles from './AuthImage.module.css';

type AuthImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  /** 接口给出的同源地址（`/api/v1/attachments/<id>`）。 */
  src: string;
  alt: string;
};

type State = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'error'; reason: string };

/**
 * 接口要求口令，`<img src>` 带不上 Authorization 头，所以先用 fetch 取回、
 * 转成 blob URL 再显示；组件卸载或地址变化时释放。
 */
export function AuthImage({ src, alt, className, ...props }: AuthImageProps) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setState({ status: 'loading' });
    apiFetch(src, { signal: controller.signal })
      .then((response) => response.blob())
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: 'ready', url: objectUrl });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', reason: describeError(error) });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (state.status === 'ready') {
    return <img src={state.url} alt={alt} className={className} {...props} />;
  }
  return (
    <span
      className={[styles.placeholder, className ?? ''].join(' ')}
      role="img"
      aria-label={state.status === 'error' ? `${alt}：图片读取失败（${state.reason}）` : `${alt}：读取中`}
      aria-busy={state.status === 'loading'}
      data-state={state.status}
    >
      {state.status === 'error' ? '图片读取失败' : null}
    </span>
  );
}
