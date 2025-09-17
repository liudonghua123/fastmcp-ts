export interface ParsedDoc {
  description: string | undefined;
  params: Record<string, string> | undefined;
  returns: string | undefined;
}

export function parseRawDocComment(raw: string): ParsedDoc {
  const lines = raw.split(/\r?\n/);
  const params: Record<string, string> = {};
  const descriptionLines: string[] = [];
  let returns: string | undefined;
  let started = false;
  for (let i = 0; i < lines.length; i++) {
  let line = lines[i] ?? '';
    if (!started) {
      const idx = line.indexOf('/**');
      if (idx !== -1) {
        line = line.slice(idx + 3);
        started = true;
      } else {
        continue;
      }
    }
    const endIdx = line.indexOf('*/');
    if (endIdx !== -1) {
      line = line.slice(0, endIdx);
    }
    line = line.replace(/^\s*\*\s?/, '').trim();
    if (!line) {
      if (endIdx !== -1) break;
      continue;
    }
    if (/^@param\s+/.test(line)) {
      const m = line.match(/^@param\s+(\w+)\s+(.*)$/);
      if (m && m[1]) params[m[1]] = (m[2] || '').trim();
    } else if (/^@returns?\b/.test(line)) {
      const m = line.match(/^@returns?\s+(.*)$/);
      if (m) returns = (m[1] || '').trim();
    } else if (!line.startsWith('@')) {
      descriptionLines.push(line);
    }
    if (endIdx !== -1) break;
  }
  const description = descriptionLines.join(' ').replace(/\s+\/$/, '').trim() || undefined;
  return { description, params: Object.keys(params).length ? params : undefined, returns };
}

export function extractDocCommentAbove(lines: string[], decoratorLine: number): string | undefined {
  let i = decoratorLine - 2; // above decorator; indices are 0-based
  while (i >= 0) {
    const line = lines[i];
    if (line === undefined) break;
    const trimmed = line.trim();
    if (trimmed.endsWith('*/')) {
      let end = i;
      let start = i;
      while (start >= 0) {
        const l = lines[start];
        if (l === undefined) break;
        if (l.includes('/**')) break;
        start--;
      }
      if (start >= 0) {
        return lines.slice(start, end + 1).join('\n');
      }
      return undefined;
    }
    // Stop if we hit a non-comment, non-empty line
    if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')) break;
    i--;
  }
  return undefined;
}
