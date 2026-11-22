import { Fragment, useId, useMemo, useRef, type ReactNode } from 'react';
import { inlineText, parseInline, parseMarkdown, resolveLink, type Block, type Inline } from './mdParse';
import styles from './Markdown.module.css';

export type MarkdownProps = {
  source: string;
  /** Library-relative path of the file being shown; relative links resolve against it. */
  basePath: string;
  /** Opens a library-relative path (file or topic folder). */
  onOpen: (path: string, anchor?: string) => void;
  /** Highlight only prose, never code or link destinations. */
  highlightTerms?: readonly string[];
  /** A container may handle anchors across several Markdown sections. */
  onAnchor?: (anchor: string) => void;
  /** Topic documents start with `# <主题名> …`, which repeats the card title; drop that first H1. */
  skipLeadingTitle?: boolean;
};

/** Stable heading ids so search hits and the outline can scroll to a section. */
export function headingId(index: number): string {
  return `kb-h-${index}`;
}

/** GitHub-style heading text, also accepting the original Chinese title. */
export function headingAnchor(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
}

export function scrollToHeading(root: HTMLElement | null, anchor: string): boolean {
  if (!root) return false;
  const normalized = headingAnchor(anchor);
  const target = [...root.querySelectorAll<HTMLElement>('[data-heading]')].find((element) =>
    element.dataset.heading === anchor || element.id === anchor || element.dataset.outlineId === anchor || headingAnchor(element.dataset.heading ?? '') === normalized,
  );
  if (!target) return false;
  target.scrollIntoView({ block: 'start' });
  target.dataset.flash = 'true';
  window.setTimeout(() => delete target.dataset.flash, 1600);
  return true;
}

function HighlightedText({ text, terms }: { text: string; terms: readonly string[] }) {
  const matches = terms.filter(Boolean).sort((a, b) => b.length - a.length);
  if (matches.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${matches.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return <>{text.split(pattern).map((part, index) => matches.includes(part) ? <mark key={index}>{part}</mark> : <Fragment key={index}>{part}</Fragment>)}</>;
}

type InlineProps = Pick<MarkdownProps, 'basePath' | 'onOpen' | 'highlightTerms' | 'onAnchor'>;

function InlineNodes({ nodes, ...props }: InlineProps & { nodes: readonly Inline[] }) {
  const { basePath, onOpen, onAnchor, highlightTerms = [] } = props;
  return <>{nodes.map((node, index) => {
    if (node.type === 'text') return <HighlightedText key={index} text={node.text} terms={highlightTerms} />;
    if (node.type === 'code') return <code key={index}>{node.text}</code>;
    if (node.type === 'strong') return <strong key={index}><InlineNodes nodes={node.children} {...props} /></strong>;
    if (node.type === 'em') return <em key={index}><InlineNodes nodes={node.children} {...props} /></em>;
    const target = resolveLink(node.href, basePath);
    const label = <InlineNodes nodes={node.children} {...props} />;
    if (target.kind === 'external') return <a key={index} href={target.href} target="_blank" rel="noreferrer noopener" onClick={(event) => event.stopPropagation()}>{label}</a>;
    if (target.kind === 'library' || target.kind === 'anchor') {
      return <a key={index} href={target.kind === 'anchor' ? `#${encodeURIComponent(target.anchor)}` : '#'} onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (target.kind === 'anchor') {
          if (onAnchor) onAnchor(target.anchor);
          else onOpen(basePath, target.anchor);
        } else if (target.path === basePath && target.anchor && onAnchor) onAnchor(target.anchor);
        else onOpen(target.path, target.anchor ?? undefined);
      }}>{label}</a>;
    }
    return <span key={index} className={styles.deadLink} title={node.href}>{label}</span>;
  })}</>;
}

/** Safe inline Markdown for compact read-only rows. */
export function InlineMarkdown({ source, ...props }: Omit<MarkdownProps, 'skipLeadingTitle'>) {
  return <span className={`${styles.markdown} ${styles.inline}`}><InlineNodes nodes={parseInline(source)} {...props} /></span>;
}

function Blocks({ blocks, counter, prefix, ...props }: InlineProps & { blocks: readonly Block[]; counter: { value: number }; prefix: string }): ReactNode {
  return blocks.map((block, index) => {
    const inline = (nodes: readonly Inline[]) => <InlineNodes nodes={nodes} {...props} />;
    switch (block.type) {
      case 'heading': {
        const id = headingId(counter.value);
        counter.value += 1;
        const Tag = `h${Math.min(block.level + 1, 6)}` as 'h2';
        return (
          <Tag key={index} id={`${prefix}-${id}`} data-outline-id={id} data-heading={block.text} className={styles.heading} data-level={block.level}>
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
            <Blocks blocks={block.children} {...props} counter={counter} prefix={prefix} />
          </blockquote>
        );
      case 'list': {
        const items = block.items.map((item, itemIndex) => (
          <li key={itemIndex} data-task={item.checked === null ? undefined : item.checked ? 'done' : 'todo'}>
            {item.checked === null ? null : <span className={styles.check} aria-label={item.checked ? '已完成' : '未完成'}>{item.checked ? '☑' : '☐'}</span>}
            {inline(item.children)}
            {item.nested.length > 0 ? <Blocks blocks={item.nested} {...props} counter={counter} prefix={prefix} /> : null}
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
export function Markdown({ source, basePath, onOpen, highlightTerms, onAnchor, skipLeadingTitle = false }: MarkdownProps) {
  const root = useRef<HTMLDivElement>(null);
  const prefix = useId();
  const blocks = useMemo(() => {
    const parsed = parseMarkdown(source);
    const first = parsed[0];
    return skipLeadingTitle && first?.type === 'heading' && first.level === 1 ? parsed.slice(1) : parsed;
  }, [source, skipLeadingTitle]);
  return (
    <div ref={root} className={styles.markdown}>
      <Blocks blocks={blocks} basePath={basePath} onOpen={onOpen} highlightTerms={highlightTerms} onAnchor={onAnchor ?? ((anchor) => { scrollToHeading(root.current, anchor); })} counter={{ value: 0 }} prefix={prefix} />
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
