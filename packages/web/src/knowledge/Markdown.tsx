import { Fragment, useMemo, type ReactNode } from 'react';
import { inlineText, parseMarkdown, resolveLink, type Block, type Inline } from './mdParse';
import styles from './Markdown.module.css';

type MarkdownProps = {
  source: string;
  /** Library-relative path of the file being shown; relative links resolve against it. */
  basePath: string;
  /** Opens a library-relative path (file or topic folder). */
  onOpen: (path: string) => void;
  /** Topic documents start with `# <主题名> …`, which repeats the card title; drop that first H1. */
  skipLeadingTitle?: boolean;
};

/** Stable heading ids so search hits and the outline can scroll to a section. */
export function headingId(index: number): string {
  return `kb-h-${index}`;
}

function InlineNodes({ nodes, basePath, onOpen }: { nodes: readonly Inline[]; basePath: string; onOpen: (path: string) => void }) {
  return (
    <>
      {nodes.map((node, index) => {
        if (node.type === 'text') return <Fragment key={index}>{node.text}</Fragment>;
        if (node.type === 'code') return <code key={index}>{node.text}</code>;
        if (node.type === 'strong') return <strong key={index}><InlineNodes nodes={node.children} basePath={basePath} onOpen={onOpen} /></strong>;
        if (node.type === 'em') return <em key={index}><InlineNodes nodes={node.children} basePath={basePath} onOpen={onOpen} /></em>;
        const target = resolveLink(node.href, basePath);
        const label = <InlineNodes nodes={node.children} basePath={basePath} onOpen={onOpen} />;
        if (target.kind === 'external') {
          return (
            <a key={index} href={target.href} target="_blank" rel="noreferrer noopener">
              {label}
            </a>
          );
        }
        if (target.kind === 'library') {
          return (
            <a
              key={index}
              href="#"
              onClick={(event) => {
                event.preventDefault();
                onOpen(target.path);
              }}
            >
              {label}
            </a>
          );
        }
        return (
          <span key={index} className={styles.deadLink} title={node.href}>
            {label}
          </span>
        );
      })}
    </>
  );
}

function Blocks({ blocks, basePath, onOpen, counter }: { blocks: readonly Block[]; basePath: string; onOpen: (path: string) => void; counter: { value: number } }): ReactNode {
  return blocks.map((block, index) => {
    const inline = (nodes: readonly Inline[]) => <InlineNodes nodes={nodes} basePath={basePath} onOpen={onOpen} />;
    switch (block.type) {
      case 'heading': {
        const id = headingId(counter.value);
        counter.value += 1;
        const Tag = `h${Math.min(block.level + 1, 6)}` as 'h2';
        return (
          <Tag key={index} id={id} data-heading={block.text} className={styles.heading} data-level={block.level}>
            {inline(block.children)}
          </Tag>
        );
      }
      case 'paragraph':
        return <p key={index}>{inline(block.children)}</p>;
      case 'rule':
        return <hr key={index} />;
      case 'code':
        return (
          <pre key={index} className={styles.code}>
            <code>{block.text}</code>
          </pre>
        );
      case 'quote':
        return (
          <blockquote key={index}>
            <Blocks blocks={block.children} basePath={basePath} onOpen={onOpen} counter={counter} />
          </blockquote>
        );
      case 'list': {
        const items = block.items.map((item, itemIndex) => (
          <li key={itemIndex} data-task={item.checked === null ? undefined : item.checked ? 'done' : 'todo'}>
            {item.checked === null ? null : <span className={styles.check} aria-label={item.checked ? '已完成' : '未完成'}>{item.checked ? '☑' : '☐'}</span>}
            {inline(item.children)}
            {item.nested.length > 0 ? <Blocks blocks={item.nested} basePath={basePath} onOpen={onOpen} counter={counter} /> : null}
          </li>
        ));
        return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
      }
      case 'table':
        return (
          <div key={index} className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  {block.header.map((cell, cellIndex) => (
                    <th key={cellIndex} title={inlineText(cell)}>
                      {inline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} title={inlineText(cell)}>
                        {inline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

/** Renders a library Markdown file. Raw HTML in the source is shown as text, never injected. */
export function Markdown({ source, basePath, onOpen, skipLeadingTitle = false }: MarkdownProps) {
  const blocks = useMemo(() => {
    const parsed = parseMarkdown(source);
    const first = parsed[0];
    return skipLeadingTitle && first?.type === 'heading' && first.level === 1 ? parsed.slice(1) : parsed;
  }, [source, skipLeadingTitle]);
  return (
    <div className={styles.markdown}>
      <Blocks blocks={blocks} basePath={basePath} onOpen={onOpen} counter={{ value: 0 }} />
    </div>
  );
}

/** Second- and third-level headings for the outline. */
export function outline(source: string): Array<{ id: string; text: string; level: number }> {
  const items: Array<{ id: string; text: string; level: number }> = [];
  let index = 0;
  const visit = (blocks: readonly Block[]): void => {
    for (const block of blocks) {
      if (block.type === 'heading') {
        if (block.level === 2 || block.level === 3) items.push({ id: headingId(index), text: block.text, level: block.level });
        index += 1;
      } else if (block.type === 'quote') visit(block.children);
      else if (block.type === 'list') for (const item of block.items) visit(item.nested);
    }
  };
  visit(parseMarkdown(source));
  return items;
}
