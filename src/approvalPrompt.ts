import { ScreenSnapshot } from './terminalScreen';

export type ApprovalKind = 'command' | 'edit' | 'network' | 'input' | 'permissions';
export interface ApprovalPrompt { kind: ApprovalKind; fingerprint: string }
export interface ApprovalDetection {
  state: 'approval' | 'partial' | 'other';
  prompt?: ApprovalPrompt;
  reason?: string;
}

const FOOTER = 'Press enter to confirm or esc to cancel';
const HEADERS: Array<{ kind: ApprovalKind; pattern: RegExp; label: string }> = [
  { kind: 'command', pattern: /Would you like to run the following command\?/, label: 'Yes, proceed (y)' },
  { kind: 'edit', pattern: /Would you like to make the following edits\?/, label: 'Yes, proceed (y)' },
  { kind: 'network', pattern: /Do you want to approve network access to "[^"\n]+"\?/, label: 'Yes, just this once (y)' },
  { kind: 'input', pattern: /Would you like to send input to (?:the existing terminal|terminal [\w-]+)\?/, label: 'Yes, proceed (y)' },
  { kind: 'permissions', pattern: /Would you like to grant these permissions\?/, label: 'Yes, grant these permissions for this turn (y)' },
];

/** Match an active native approval card, never an isolated Yes or a chat question. */
export function detectApproval(snapshot: ScreenSnapshot): ApprovalDetection {
  if (!snapshot.complete) return { state: 'partial', reason: snapshot.issue };
  const lines = snapshot.lines.slice(-128).map(line => line.trim());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const textLines = lines.map(line => line.replace(/\s+/g, ' ')).filter(Boolean);
  const lineStarts = new Set<number>();
  const lineEnds = new Set<number>();
  let offset = 0;
  for (const line of textLines) {
    lineStarts.add(offset);
    lineEnds.add(offset + line.length);
    offset += line.length + 1;
  }
  const text = textLines.join(' ');
  const footer = text.lastIndexOf(FOOTER);
  if (footer < 0) {
    const nativeHeader = HEADERS.some(header => header.pattern.test(text));
    return { state: nativeHeader ? 'partial' : 'other' };
  }
  // Any composer, question or other content after this footer means it is history.
  const suffix = text.slice(footer + FOOTER.length).trim();
  if (suffix && !/^or \S+ to open thread$/.test(suffix)) return { state: 'other' };

  let selected: { kind: ApprovalKind; label: string; start: number } | undefined;
  for (const header of HEADERS) {
    const pattern = new RegExp(header.pattern.source, 'g');
    for (const match of text.slice(0, footer).matchAll(pattern)) {
      if (!lineStarts.has(match.index!) || !lineEnds.has(match.index! + match[0].length)) continue;
      if (!selected || match.index! > selected.start) selected = { kind: header.kind, label: header.label, start: match.index! };
    }
  }
  if (!selected) return { state: 'other', reason: '不是已支援的 Codex 操作核准' };
  const block = text.slice(selected.start, footer).trim();
  if (/Question\s+\d+\s*\/\s*\d+|needs your approval|Yes, provide the requested info|```/.test(block)) {
    return { state: 'other', reason: '一般提問或資料填寫表單保留手動回答' };
  }

  const options = [...block.matchAll(/(?:[›❯]\s*)?\b(\d+)\.\s+([\s\S]*?)(?=\s+(?:[›❯]\s*)?\d+\.\s+|$)/g)]
    .filter(option => lineStarts.has(selected!.start + option.index!));
  const first = options.filter(option => option[1] === '1').pop();
  const hasSelection = /[›❯]\s*\d+\.\s/.test(block);
  const hasDeny = options.some(option => option.index! > (first?.index ?? Infinity) &&
    /^No, (?:and tell Codex what to do differently|continue without running it|continue without permissions) \((?:esc|d)\)$/.test(option[2].trim()));
  if (!hasSelection || first?.[2].trim() !== selected.label) {
    return { state: 'partial', reason: '核准格式或快捷鍵未知，沒有送出輸入' };
  }
  if (!hasDeny) {
    return { state: 'partial', reason: '核准選項未完整顯示，請放大終端或手動核准' };
  }
  return {
    state: 'approval',
    prompt: { kind: selected.kind, fingerprint: `${selected.kind}:${block.replace(/[›❯]\s*(?=\d+\.)/g, '')}` },
  };
}
