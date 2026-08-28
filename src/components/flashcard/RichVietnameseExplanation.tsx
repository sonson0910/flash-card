import { Fragment, type ReactNode } from 'react';

interface RichVietnameseExplanationProps {
  value: string;
}

const sectionLeadPattern = /\s+(?=\*\*(?:Cách|Giải thích|Lưu ý|Ví dụ|Bản dịch|Dịch)[^*]*\*\*)/giu;
const inlineBulletPattern = /\s+\*\s+(?=\*[^*\n]+:\*)/g;
const inlineTokenPattern = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;

export function normalizeGeneratedMarkdown(value: string) {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(sectionLeadPattern, '\n\n')
    .replace(/\s+(?=>\s)/g, '\n\n')
    .replace(inlineBulletPattern, '\n- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderInline(value: string, keyPrefix: string): ReactNode[] {
  return value.split(inlineTokenPattern).filter(Boolean).map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={key} className="font-extrabold text-slate-900 dark:text-white">{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith('*') && token.endsWith('*')) {
      return <em key={key} className="not-italic font-semibold text-slate-800 dark:text-slate-100">{token.slice(1, -1)}</em>;
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return <code key={key} className="rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-800 dark:border-white/12 dark:bg-slate-950/35 dark:text-slate-100">{token.slice(1, -1)}</code>;
    }
    return <Fragment key={key}>{token}</Fragment>;
  });
}

function isBlockStart(line: string) {
  return /^(?:>|[-*]\s+|\d+[.)]\s+|#{1,4}\s+)/.test(line.trim());
}

export function RichVietnameseExplanation({ value }: RichVietnameseExplanationProps) {
  const lines = normalizeGeneratedMarkdown(value).split('\n');
  const blocks: ReactNode[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push(<h4 key={`heading-${index}`} className="text-sm font-black tracking-[-0.01em] text-slate-900 dark:text-white">{renderInline(heading[2], `heading-${index}`)}</h4>);
      index += 1;
      continue;
    }

    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${index}`} className="rounded-r-2xl border-l-2 border-[var(--sf-brand)] bg-slate-100/90 dark:bg-slate-950/25 px-4 py-3 text-[13px] font-medium leading-6 text-slate-800 dark:text-slate-100 shadow-xs sm:text-sm">
          {quoteLines.map((quote, quoteIndex) => <p key={`quote-line-${quoteIndex}`}>{renderInline(quote, `quote-${index}-${quoteIndex}`)}</p>)}
        </blockquote>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ul key={`list-${index}`} className="space-y-2" role="list">
          {items.map((item, itemIndex) => (
            <li key={`item-${itemIndex}`} className="flex gap-3 text-[13px] font-medium leading-6 text-slate-800 dark:text-slate-100 sm:text-sm">
              <span className="mt-[0.62rem] size-1.5 shrink-0 rounded-full bg-[var(--sf-brand)]" aria-hidden="true" />
              <span className="min-w-0">{renderInline(item, `item-${index}-${itemIndex}`)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+[.)]\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ol key={`ordered-${index}`} className="space-y-2">
          {items.map((item, itemIndex) => (
            <li key={`ordered-item-${itemIndex}`} className="flex gap-3 text-[13px] font-medium leading-6 text-slate-800 dark:text-slate-100 sm:text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-[10px] font-black text-slate-700 dark:border-white/15 dark:bg-slate-950/25 dark:text-slate-100">{itemIndex + 1}</span>
              <span className="min-w-0">{renderInline(item, `ordered-${index}-${itemIndex}`)}</span>
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    const paragraph = paragraphLines.join(' ');
    blocks.push(<p key={`paragraph-${index}`} className="text-[13px] font-medium leading-6 text-slate-800 dark:text-slate-100 sm:text-sm">{renderInline(paragraph, `paragraph-${index}`)}</p>);
  }

  return (
    <div
      lang="vi"
      data-rich-vietnamese-explanation
      className="w-full space-y-3 break-words text-left [overflow-wrap:anywhere]"
    >
      {blocks}
    </div>
  );
}
