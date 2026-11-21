import { Banner } from '../ui/Banner';
import { EmptyState } from '../ui/EmptyState';
import styles from './PersonalOsPages.module.css';

export function PersonalOsMissing({ root }: { root: string }) {
  return <EmptyState icon="folder" title="没有找到 PersonalOS">服务按 {root} 查找。在启动服务前设置 BLUEMANTA_KNOWLEDGE_HOME 可更换位置。</EmptyState>;
}

export function PersonalOsReadWarning({ message, updatedAt, onRetry, retrying }: { message: string; updatedAt: number; onRetry: () => void; retrying: boolean }) {
  const readAt = updatedAt ? new Date(updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
  return <div className={styles.warning}><Banner onRetry={onRetry} retrying={retrying}>{message}{readAt ? `；当前仍显示 ${readAt} 读取的内容。` : ''}</Banner></div>;
}
