import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';
import styles from './Tooltip.module.css';

export const TooltipProvider = RadixTooltip.Provider;

type TooltipProps = {
  label: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** 为 false 时只渲染子元素（例如侧栏展开时名称已经可见）。 */
  enabled?: boolean;
  children: ReactElement;
};

export function Tooltip({ label, side = 'bottom', enabled = true, children }: TooltipProps) {
  if (!enabled) return children;
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className={styles.content} side={side} sideOffset={6} collisionPadding={8}>
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
