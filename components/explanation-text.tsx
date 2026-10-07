'use client';

import type { ReactNode } from 'react';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderInline(text: string, knownPaths: ReadonlySet<string>, onSelectPath: (path: string) => void): ReactNode[] {
  const paths = [...knownPaths].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const inlineCodePattern = '`[^`]+`';
  const matcher = new RegExp(`(${inlineCodePattern}|\\*\\*[^*]+\\*\\*${paths.length ? `|${paths.join('|')}` : ''})`, 'g');
  const parts: ReactNode[] = [];
  let start = 0;
  for (const match of text.matchAll(matcher)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > start) parts.push(text.slice(start, index));
    if (token.startsWith('`')) {
      const value = token.slice(1, -1);
      parts.push(knownPaths.has(value)
        ? <button key={`${index}-${value}`} type="button" onClick={() => onSelectPath(value)} className="cursor-pointer font-mono text-accent underline decoration-accent/40 underline-offset-2">{value}</button>
        : <code key={`${index}-${value}`} className="rounded bg-raised px-1 font-mono text-fg">{value}</code>);
    } else if (token.startsWith('**')) {
      parts.push(<strong key={`${index}-${token}`} className="font-semibold text-fg">{token.slice(2, -2)}</strong>);
    } else {
      parts.push(<button key={`${index}-${token}`} type="button" onClick={() => onSelectPath(token)} className="cursor-pointer font-mono text-accent underline decoration-accent/40 underline-offset-2">{token}</button>);
    }
    start = index + token.length;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

export function ExplanationText({
  content,
  filePaths,
  onSelectPath,
}: {
  content: string;
  filePaths: readonly string[];
  onSelectPath: (path: string) => void;
}) {
  const knownPaths = new Set(filePaths);
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push(<ul key={`list-${blocks.length}`} className="list-disc space-y-1 pl-5">{bullets.map((item, index) => <li key={`${index}-${item}`}>{renderInline(item, knownPaths, onSelectPath)}</li>)}</ul>);
    bullets = [];
  };

  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flushBullets();
    if (line.trim()) blocks.push(<p key={`paragraph-${blocks.length}`}>{renderInline(line, knownPaths, onSelectPath)}</p>);
  }
  flushBullets();

  return <div className="space-y-3 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-fg">{blocks}</div>;
}
