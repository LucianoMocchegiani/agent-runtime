import { useState, useEffect, useId } from 'react';

export default function MarkdownContent({ content, preserveWhitespace = false }) {
  return <div className="markdown-content">{renderMarkdownBlocks(content || '', preserveWhitespace)}</div>;
}

function MermaidDiagram({ chart }) {
  const reactId = useId();
  const [result, setResult] = useState({ svg: '', error: false });
  const diagramId = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  useEffect(() => {
    let isCurrent = true;
    setResult({ svg: '', error: false });
    import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'dark',
        flowchart: { htmlLabels: false },
      });
      const { svg } = await mermaid.render(diagramId, chart);
      if (isCurrent) setResult({ svg, error: false });
    }).catch(() => {
      if (isCurrent) setResult({ svg: '', error: true });
    });
    return () => { isCurrent = false; };
  }, [chart, diagramId]);

  if (result.error) {
    return (
      <div className="mermaid-fallback" role="status">
        <p>No se pudo dibujar este diagrama. Se muestra el código para que puedas revisarlo.</p>
        <pre className="markdown-code"><code>{chart}</code></pre>
      </div>
    );
  }
  if (!result.svg) return <div className="mermaid-loading" role="status">Dibujando diagrama…</div>;
  return <div className="mermaid-diagram" role="img" aria-label="Diagrama Mermaid" dangerouslySetInnerHTML={{ __html: result.svg }} />;
}

function renderMarkdownBlocks(content, preserveWhitespace = false) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }

    const fence = line.match(/^\s*```([^`]*)\s*$/);
    if (fence) {
      const code = [];
      index++;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      const source = code.join('\n');
      if (fence[1].trim().toLowerCase() === 'mermaid') {
        blocks.push(<MermaidDiagram key={`mermaid-${index}`} chart={source} />);
      } else {
        blocks.push(<pre className="markdown-code" key={`code-${index}`}><code>{source}</code></pre>);
      }
      continue;
    }

    if (index + 1 < lines.length && isMarkdownTableRow(line) && isMarkdownTableSeparator(lines[index + 1])) {
      const headers = splitMarkdownTableRow(line);
      const alignments = splitMarkdownTableRow(lines[index + 1]).map(getMarkdownTableAlignment);
      const rows = [];
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index]) && lines[index].trim()) {
        rows.push(splitMarkdownTableRow(lines[index++]));
      }
      blocks.push(
        <div className="markdown-table-wrapper" key={`table-${index}`}>
          <table className="markdown-table">
            <thead><tr>{headers.map((cell, cellIndex) => (
              <th key={cellIndex} scope="col" style={{ textAlign: alignments[cellIndex] || 'left' }}><MarkdownInline text={cell} /></th>
            ))}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{headers.map((_, cellIndex) => (
                <td key={cellIndex} style={{ textAlign: alignments[cellIndex] || 'left' }}><MarkdownInline text={row[cellIndex] || ''} /></td>
              ))}</tr>
            ))}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const Tag = `h${heading[1].length}`;
      blocks.push(<Tag key={`heading-${index}`}><MarkdownInline text={heading[2]} /></Tag>);
      index++;
      continue;
    }

    if (/^\s{0,3}(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      blocks.push(<hr key={`rule-${index}`} />);
      index++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={`quote-${index}`}>{renderMarkdownBlocks(quote.join('\n'), preserveWhitespace)}</blockquote>);
      continue;
    }

    const listMatch = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(item[3]);
        index++;
      }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(<Tag key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}><MarkdownInline text={item} /></li>)}</Tag>);
      continue;
    }

    const paragraph = [preserveWhitespace ? line : line.trim()];
    index++;
    while (index < lines.length && lines[index].trim() &&
      !/^\s*```/.test(lines[index]) &&
      !/^\s{0,3}#{1,6}\s+/.test(lines[index]) &&
      !/^\s*>/.test(lines[index]) &&
      !/^\s*(?:[-+*]|\d+\.)\s+/.test(lines[index]) &&
      !/^\s{0,3}(?:---+|___+|\*\*\*+)\s*$/.test(lines[index])) {
      paragraph.push(preserveWhitespace ? lines[index] : lines[index].trim());
      index++;
    }
    blocks.push(<p key={`paragraph-${index}`}><MarkdownInline text={paragraph.join(preserveWhitespace ? '\n' : ' ')} /></p>);
  }

  return blocks;
}

function splitMarkdownTableRow(line) {
  const cells = [];
  let cell = '';
  const trimmed = line.trim();
  const hasOuterLeadingPipe = trimmed.startsWith('|');
  const trailingBackslashes = (trimmed.match(/\\+$/) || [''])[0].length;
  const hasOuterTrailingPipe = trimmed.endsWith('|') && trailingBackslashes % 2 === 0;
  const start = hasOuterLeadingPipe ? 1 : 0;
  const end = hasOuterTrailingPipe ? trimmed.length - 1 : trimmed.length;

  for (let index = start; index < end; index++) {
    const character = trimmed[index];
    if (character === '\\' && trimmed[index + 1] === '|') {
      cell += '|';
      index++;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function isMarkdownTableRow(line) {
  return splitMarkdownTableRow(line).length > 1;
}

function isMarkdownTableSeparator(line) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function getMarkdownTableAlignment(separator) {
  if (separator.startsWith(':') && separator.endsWith(':')) return 'center';
  if (separator.endsWith(':')) return 'right';
  return 'left';
}

function MarkdownInline({ text }) {
  const tokenPattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\n]+\*|_[^_\n]+_)/g;
  const parts = text.split(tokenPattern).filter(Boolean);
  return parts.map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const safeHref = /^(https?:|mailto:)/i.test(link[2]) ? link[2] : null;
      return safeHref
        ? <a key={index} href={safeHref} target="_blank" rel="noreferrer">{link[1]}</a>
        : <span key={index}>{link[1]}</span>;
    }
    if (part.startsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('***')) return <strong key={index}><em>{part.slice(3, -3)}</em></strong>;
    if (part.startsWith('**') || part.startsWith('__')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('~~')) return <del key={index}>{part.slice(2, -2)}</del>;
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <span key={index}>{part}</span>;
  });
}

