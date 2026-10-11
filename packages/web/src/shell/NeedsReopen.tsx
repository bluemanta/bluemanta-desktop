import { useLaunch } from '../app/context';
import styles from './NeedsReopen.module.css';

/** 没有口令或口令失效（401）时整页显示（idea-ui 第 11 节）。 */
export function NeedsReopen({ reason }: { reason: 'missing' | 'rejected' }) {
  const { embed } = useLaunch();
  return (
    <div className={styles.page}>
      <section className={styles.card} aria-labelledby="needs-reopen-title">
        <h1 id="needs-reopen-title" className={styles.title}>
          需要重新打开
        </h1>
        <p className={styles.reason}>
          {reason === 'rejected' ? '本地服务的口令已变化，这个页面里存的口令不能再用。' : '这个页面还没有本地服务的口令。'}
        </p>
        {embed ? (
          <p className={styles.text}>在 DeepSeek Harness 里关掉灵感台，再从左侧栏重新打开。</p>
        ) : (
          <>
            <p className={styles.text}>在 bluemanta-desktop 仓库目录运行下面的命令，用新地址打开：</p>
            <pre className={styles.code}>
              <code>node packages/server/dist/cli.js open</code>
            </pre>
            <p className={styles.text}>
              不在 macOS 上时，运行 <code>node packages/server/dist/cli.js url</code>，把打出的地址贴进浏览器。本地服务还没启动的话，先运行{' '}
              <code>npm run server</code>。
            </p>
          </>
        )}
      </section>
    </div>
  );
}
