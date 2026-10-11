import { forwardRef, type ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'dangerFill';
  size?: 'md' | 'sm';
};

/**
 * 设计规范第 7 节的按钮。需要说明「为什么不能用」时用 `aria-disabled`，
 * 这样仍能获得焦点和显示提示；点击由调用方忽略。
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', className, type = 'button', ...props },
  ref,
) {
  const classes = [styles.button, styles[variant], size === 'sm' ? styles.sm : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return <button ref={ref} type={type} className={classes} {...props} />;
});
