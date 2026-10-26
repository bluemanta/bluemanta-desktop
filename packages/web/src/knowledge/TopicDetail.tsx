import type { KnowledgeFileEntry, KnowledgeTopicDocument, KnowledgeTopicResponse } from '@bluemanta/server/api-types';
import { Fragment, useState } from 'react';
import { describeError } from '../api/client';
import { Banner } from '../ui/Banner';
import { Icon } from '../ui/Icon';
import { useKnowledgeIndex, useKnowledgeTopic } from './api';
import { Markdown } from './Markdown';
import { categoryName, formatDate, formatSize, statusLabel, statusTone, useCopyPath } from './shared';
import styles from './Knowledge.module.css';

type Tab = KnowledgeTopicDocument | 'files';

const TABS: ReadonlyArray<{ id: Tab; label: string; file?: string }> = [
  { id: 'readme', label: '概览', file: 'README.md' },
  { id: 'assetIndex', label: '资产', file: 'Asset_Index.md' },
  { id: 'knowledge', label: '知识', file: 'Topic_Knowledge.md' },
  { id: 'log', label: '日志', file: 'Topic_Log.md' },
  { id: 'files', label: '文件' },
];

type TopicDetailProps = {
  library: string;
  path: string;
  onOpen: (path: string) => void;
  onTopic: (topicPath: string) => void;
};

function FileList({ entries, onOpen }: { entries: readonly KnowledgeFileEntry[]; onOpen: (path: string) => void }) {
  return (
    <ul className={styles.files}>
      {entries.map((entry) => (
        <li key={entry.path} className={styles.fileRow}>
          <Icon name={entry.kind === 'directory' ? 'folder' : 'file'} />
          {entry.kind === 'markdown' || entry.kind === 'directory' ? (
            <button type="button" className={styles.fileName} onClick={() => onOpen(entry.path)}>
              {entry.name}
            </button>
          ) : (
            <span className={styles.fileName} title={entry.name}>
              {entry.name}
            </span>
          )}
          {entry.kind === 'directory' ? null : <span className={styles.fileMeta}>{formatSize(entry.size)}</span>}
          <span className={styles.fileMeta}>{formatDate(entry.modifiedAt)}</span>
        </li>
      ))}
    </ul>
  );
}

function Routing({ data, library, onTopic }: { data: KnowledgeTopicResponse; library: string; onTopic: (topicPath: string) => void }) {
  const index = useKnowledgeIndex(library);
  const topics = index.data?.categories.flatMap((category) => category.topics) ?? [];
  const { topic } = data;
  const rows: Array<[string, string[]]> = [
    ['别名', topic.aliases],
    ['关键词', topic.keywords],
    ['典型问题', topic.typicalQuestions],
  ];
  if (rows.every(([, values]) => values.length === 0) && topic.relatedTopics.length === 0) return null;
  return (
    <dl className={styles.routing}>
      {rows
        .filter(([, values]) => values.length > 0)
        .map(([label, values]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>{values.join(label === '典型问题' ? '；' : '、')}</dd>
          </Fragment>
        ))}
      {topic.relatedTopics.length > 0 ? (
        <>
          <dt>相关主题</dt>
          <dd>
            {topic.relatedTopics.map((name, i) => {
              const target = topics.find((item) => item.name === name);
              return (
                <span key={name}>
                  {i > 0 ? '、' : null}
                  {target ? (
                    <button type="button" className={styles.linkButton} onClick={() => onTopic(target.path)}>
                      {name}
                    </button>
                  ) : (
                    name
                  )}
                </span>
              );
            })}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

/** Topic card (knowledge-ui §3): routing facts, the four default documents as tabs, other files and archive. */
export function TopicDetail({ library, path, onOpen, onTopic }: TopicDetailProps) {
  const topic = useKnowledgeTopic(library, path);
  const copyPath = useCopyPath();
  const [tab, setTab] = useState<Tab>('readme');
  const [showArchive, setShowArchive] = useState(false);

  if (topic.isPending) return <p className={styles.none}>正在读取…</p>;
  if (topic.isError || !topic.data) {
    return (
      <div className={styles.banner}>
        <Banner onRetry={() => void topic.refetch()} retrying={topic.isFetching}>
          读不到这个主题：{describeError(topic.error)}
        </Banner>
      </div>
    );
  }
  const data = topic.data;
  const info = data.topic;
  const status = statusLabel(info.status);
  const displayPath = `${data.library.root}/${info.path}`;
  const current = TABS.find((item) => item.id === tab) ?? TABS[0]!;

  return (
    <div data-testid="knowledge-topic">
      <h2 className={styles.detailTitle}>
        {info.name}
        <span className={styles.tag}>{data.library.name}</span>
      </h2>
      <div className={styles.meta}>
        <span>{categoryName(info.category)}</span>
        {status ? (
          <span className={styles.tag} data-tone={statusTone(info.status)}>
            {status}
          </span>
        ) : null}
        {info.registered ? null : <span className={styles.tag}>未登记</span>}
        {info.lastReviewed ? <span>审阅于 {info.lastReviewed}</span> : null}
        <button type="button" className={styles.iconButton} onClick={() => copyPath(displayPath)} title={displayPath}>
          <Icon name="copy" />
          复制路径
        </button>
      </div>
      <div className={styles.tabs} role="tablist" aria-label="主题内容">
        {TABS.map((item) => {
          const empty = item.id !== 'files' && !info.documents[item.id];
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              className={styles.tab}
              aria-selected={tab === item.id}
              data-empty={empty}
              onClick={() => setTab(item.id)}
            >
              {item.label}
              {item.id === 'files' && data.files.length > 0 ? ` ${data.files.length}` : null}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" aria-label={current.label}>
        {tab === 'readme' ? <Routing data={data} library={library} onTopic={onTopic} /> : null}
        {tab === 'files' ? (
          <>
            {data.files.length === 0 ? <p className={styles.none}>这个主题根目录下没有其他文件。</p> : <FileList entries={data.files} onOpen={onOpen} />}
            {data.archive.length > 0 ? (
              <div className={styles.archiveToggle}>
                <button type="button" className={styles.linkButton} aria-expanded={showArchive} onClick={() => setShowArchive((value) => !value)}>
                  归档 {data.archive.length} 个
                </button>
                {showArchive ? <FileList entries={data.archive} onOpen={onOpen} /> : null}
              </div>
            ) : null}
          </>
        ) : data.documents[tab] !== undefined ? (
          <Markdown source={data.documents[tab] ?? ''} basePath={`${info.path}/${current.file ?? ''}`} onOpen={onOpen} skipLeadingTitle />
        ) : (
          <p className={styles.none}>这个主题还没有 {current.file}。</p>
        )}
      </div>
    </div>
  );
}
