import { ScreenSnapshot } from './terminalScreen';

export type ApprovalKind = 'command' | 'edit' | 'network' | 'input' | 'permissions';
export interface ApprovalPrompt { kind: ApprovalKind; fingerprint: string; content: string }
export interface ApprovalDetection {
  state: 'approval' | 'partial' | 'other';
  prompt?: ApprovalPrompt;
  reason?: string;
  fingerprint?: string;
}

const FOOTER = 'Press enter to confirm or esc to cancel';
const HEADERS: Array<{ kind: ApprovalKind; pattern: RegExp; label: string }> = [
  { kind: 'command', pattern: /Would you like to run the following command\s*\?/, label: 'Yes, proceed (y)' },
  { kind: 'edit', pattern: /Would you like to make the following edits\?/, label: 'Yes, proceed (y)' },
  { kind: 'network', pattern: /Do you want to approve network access to "[^"\n]+"\?/, label: 'Yes, just this once (y)' },
  { kind: 'input', pattern: /Would you like to send input to (?:the existing terminal|terminal [\w-]+)\?/, label: 'Yes, proceed (y)' },
  { kind: 'permissions', pattern: /Would you like to grant these permissions\?/, label: 'Yes, grant these permissions for this turn (y)' },
];

/** Match an active native approval card, never an isolated Yes or a chat question. */
export function detectApproval(snapshot: ScreenSnapshot): ApprovalDetection {
  if (!snapshot.complete) return { state: 'partial', reason: snapshot.issue };
  const sourceLines = snapshot.lines.slice(-128);
  const textLines = sourceLines.map(line => line.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const lineStarts = new Set<number>();
  const lineEnds = new Set<number>();
  const sourceRows = new Map<number, number>();
  let offset = 0;
  for (const [row, source] of sourceLines.entries()) {
    const line = source.trim().replace(/\s+/g, ' ');
    if (!line) continue;
    lineStarts.add(offset);
    lineEnds.add(offset + line.length);
    sourceRows.set(offset, row);
    offset += line.length + 1;
  }
  const text = textLines.join(' ');
  const footer = text.lastIndexOf(FOOTER);
  let selected: { kind: ApprovalKind; label: string; start: number } | undefined;
  for (const header of HEADERS) {
    const pattern = new RegExp(header.pattern.source, 'g');
    for (const match of (footer < 0 ? text : text.slice(0, footer)).matchAll(pattern)) {
      if (!lineStarts.has(match.index!) || !lineEnds.has(match.index! + match[0].length)) continue;
      if (!selected || match.index! > selected.start) selected = { kind: header.kind, label: header.label, start: match.index! };
    }
  }
  if (footer < 0) return selected ? {
    state: 'partial',
    reason: '核准確認提示未完整顯示，請放大終端或手動核准',
    fingerprint: `${selected.kind}:${text.slice(selected.start)}`,
  } : { state: 'other' };
  // A quoted footer or content after it is not an active native approval.
  const suffix = text.slice(footer + FOOTER.length).trim();
  if (!lineStarts.has(footer) || (suffix && !/^or \S+ to open thread$/.test(suffix))) return { state: 'other' };
  if (!selected) return { state: 'other', reason: '不是已支援的 Codex 操作核准' };
  const block = text.slice(selected.start, footer).trim();
  // Normalize only the validated command title; preserve operation text and screen offsets.
  const fingerprintBlock = selected.kind === 'command'
    ? block.replace(/^(Would you like to run the following command)\s*\?/, '$1?') : block;
  const fingerprint = `${selected.kind}:${fingerprintBlock.replace(/[›❯]\s*(?=\d+\.)/g, '')}`;
  // Description text is opaque: only line-start menu rows define UI controls.
  const starts = [...block.matchAll(/(?:[›❯]\s*)?\b(\d+)\.\s+/g)]
    .filter(option => lineStarts.has(selected!.start + option.index!));
  const options = starts.map((option, index) => ({
    number: option[1],
    start: option.index!,
    selected: /^[›❯]/.test(option[0]),
    label: block.slice(option.index! + option[0].length, starts[index + 1]?.index ?? block.length).trim(),
  }));
  const containsCompletedMenu = [...block.matchAll(/Press enter to confirm or esc to cancel/g)].some(earlierFooter =>
    lineStarts.has(selected!.start + earlierFooter.index!) && options.some(option =>
      option.number === '1' && option.label === selected!.label && option.start < earlierFooter.index!));
  if (containsCompletedMenu) return { state: 'other', reason: '目前選單不是已支援的 Codex 操作核准，先前核准畫面僅為歷史' };
  const first = options.filter(option => option.number === '1').pop();
  const hasSelection = options.some(option => option.selected);
  const hasDeny = options.some(option => option.start > (first?.start ?? Infinity) &&
    /^No, (?:and tell Codex what to do differently|continue without running it|continue without permissions) \((?:esc|d)\)$/.test(option.label));
  if (!hasSelection || first?.label !== selected.label) {
    return { state: 'partial', reason: '核准格式或快捷鍵未知，沒有送出輸入', fingerprint };
  }
  if (!hasDeny) {
    return { state: 'partial', reason: '核准選項未完整顯示，請放大終端或手動核准', fingerprint };
  }
  // Map validated UI boundaries back to screen rows, retaining operation formatting.
  const contentLines = sourceLines.slice(sourceRows.get(selected.start), sourceRows.get(selected.start + first!.start));
  while (contentLines.length && !contentLines[contentLines.length - 1].trim()) contentLines.pop();
  return {
    state: 'approval',
    prompt: { kind: selected.kind, fingerprint, content: contentLines.join('\n') },
  };
}
