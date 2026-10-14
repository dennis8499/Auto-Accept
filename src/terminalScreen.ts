export interface ScreenSnapshot {
  lines: string[];
  complete: boolean;
  frame: number;
  issue?: string;
}

type ParseState = 'text' | 'escape' | 'csi' | 'string' | 'stringEscape' | 'charset';
type Rows = Map<number, Map<number, string>>;
const MAX_ROWS = 512;
const MAX_COLUMNS = 4096;
const MAX_CELLS = 65536;

/** A bounded view of cursor-addressed TUI output, without retaining scrollback. */
export class TerminalScreen {
  private rows: Rows = new Map();
  private row = 0;
  private column = 0;
  private savedCursor = { row: 0, column: 0 };
  private mainScreen?: { rows: Rows; row: number; column: number };
  private state: ParseState = 'text';
  private sequence = '';
  private synchronized = false;
  private frame = 0;
  private scrollTop = 0;
  private scrollBottom = MAX_ROWS - 1;
  private issue?: string;

  write(chunk: string, onFrame?: () => void): void {
    for (const char of chunk) {
      const previousFrame = this.frame;
      this.consume(char);
      if (onFrame && this.frame !== previousFrame) {
        this.trim();
        onFrame();
      }
    }
    this.trim();
  }

  snapshot(): ScreenSnapshot {
    const lastRow = Math.max(-1, ...this.rows.keys());
    const lines: string[] = [];
    for (let row = 0; row <= lastRow; row++) {
      const cells = this.rows.get(row);
      if (!cells?.size) {
        lines.push('');
        continue;
      }
      const lastColumn = Math.max(...cells.keys());
      let line = '';
      for (let column = 0; column <= lastColumn; column++) line += cells.get(column) ?? ' ';
      lines.push(line.trimEnd());
    }
    return { lines, complete: this.state === 'text' && !this.synchronized && !this.issue, frame: this.frame, issue: this.issue };
  }

  private consume(char: string): void {
    switch (this.state) {
      case 'escape':
        this.state = 'text';
        if (char === '[') {
          this.sequence = '';
          this.state = 'csi';
        } else if (']PX^_'.includes(char)) {
          this.state = 'string';
        } else if ('()*+-.'.includes(char)) {
          this.state = 'charset';
        } else if (char === '7') {
          this.savedCursor = { row: this.row, column: this.column };
        } else if (char === '8') {
          this.row = this.savedCursor.row;
          this.column = this.savedCursor.column;
        } else if (char === 'D' || char === 'E') {
          if (char === 'E') this.column = 0;
          this.lineFeed();
        } else if (char === 'M') {
          if (this.row === this.scrollTop) this.scroll(-1);
          else this.row = Math.max(0, this.row - 1);
        } else if (char === 'c') {
          this.rows.clear();
          this.row = this.column = 0;
          this.mainScreen = undefined;
          this.synchronized = false;
        } else if (char === '\x1b') {
          this.state = 'escape';
        }
        return;
      case 'csi':
        if (char >= '@' && char <= '~') {
          this.applyCsi(char, this.sequence);
          this.sequence = '';
          this.state = 'text';
        } else if (char === '\x1b') {
          this.sequence = '';
          this.state = 'escape';
        } else if (this.sequence.length < 1024) {
          this.sequence += char;
        } else {
          this.issue = 'ANSI 控制序列超過解析上限';
        }
        return;
      case 'string':
        if (char === '\x07' || char === '\u009c') this.state = 'text';
        else if (char === '\x1b') this.state = 'stringEscape';
        return;
      case 'stringEscape':
        this.state = char === '\\' || char === '\x07' ? 'text' : char === '\x1b' ? 'stringEscape' : 'string';
        return;
      case 'charset':
        this.state = 'text';
        return;
    }

    if (char === '\x1b') this.state = 'escape';
    else if (char === '\u009b') { this.state = 'csi'; this.sequence = ''; }
    else if (char === '\u009d' || char === '\u0090') this.state = 'string';
    else if (char === '\r') this.column = 0;
    else if (char === '\n' || char === '\x0b' || char === '\x0c') this.lineFeed();
    else if (char === '\b') this.column = Math.max(0, this.column - 1);
    else if (char === '\t') this.column = Math.min(MAX_COLUMNS - 1, (Math.floor(this.column / 8) + 1) * 8);
    else if (char >= ' ' && char !== '\x7f' && !(char >= '\u0080' && char <= '\u009f')) this.put(char);
  }

  private put(char: string): void {
    if (this.column >= MAX_COLUMNS) {
      this.issue = '終端單行內容超過解析上限';
      return;
    }
    let cells = this.rows.get(this.row);
    if (!cells) this.rows.set(this.row, cells = new Map());
    if (/\p{Mark}/u.test(char) && this.column > 0) {
      const previous = this.column - 1;
      const combined = (cells.get(previous) ?? '') + char;
      if (combined.length > 32) {
        this.issue = '單一文字儲存格超過解析上限';
        return;
      }
      cells.set(previous, combined);
      return;
    }
    const code = char.codePointAt(0) ?? 0;
    const wide = code >= 0x1100 && (
      code <= 0x115f || code === 0x2329 || code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) || code >= 0x1f300
    );
    cells.set(this.column++, char);
    if (wide && this.column < MAX_COLUMNS) cells.set(this.column++, '');
  }

  private lineFeed(): void {
    if (this.row === this.scrollBottom) this.scroll(1);
    else this.row = Math.min(MAX_ROWS - 1, this.row + 1);
  }

  private scroll(amount: number): void {
    const changed: Rows = new Map();
    for (const [row, cells] of this.rows) {
      if (row < this.scrollTop || row > this.scrollBottom) changed.set(row, cells);
      else if (row - amount >= this.scrollTop && row - amount <= this.scrollBottom) changed.set(row - amount, cells);
    }
    this.rows = changed;
  }

  private applyCsi(final: string, sequence: string): void {
    const privateMode = sequence.startsWith('?');
    const parameters = sequence.replace(/^[?>!]/, '').split(';').map(value => Number(value) || 0);
    const count = Math.min(MAX_COLUMNS, parameters[0] || 1);
    if (privateMode && (final === 'h' || final === 'l')) {
      for (const mode of parameters) {
        if (mode === 2026) {
          if (final === 'l' && this.synchronized) this.frame++;
          this.synchronized = final === 'h';
        }
        if ([47, 1047, 1049].includes(mode)) this.alternateScreen(final === 'h');
      }
      return;
    }
    switch (final) {
      case 'H': case 'f':
        this.row = Math.min(MAX_ROWS - 1, Math.max(0, (parameters[0] || 1) - 1));
        this.column = Math.min(MAX_COLUMNS - 1, Math.max(0, (parameters[1] || 1) - 1));
        break;
      case 'A': this.row = Math.max(0, this.row - count); break;
      case 'B': case 'e': this.row = Math.min(MAX_ROWS - 1, this.row + count); break;
      case 'C': case 'a': this.column = Math.min(MAX_COLUMNS - 1, this.column + count); break;
      case 'D': this.column = Math.max(0, this.column - count); break;
      case 'E': this.row = Math.min(MAX_ROWS - 1, this.row + count); this.column = 0; break;
      case 'F': this.row = Math.max(0, this.row - count); this.column = 0; break;
      case 'G': case '`': this.column = Math.min(MAX_COLUMNS - 1, count - 1); break;
      case 'd': this.row = Math.min(MAX_ROWS - 1, count - 1); break;
      case 'J': this.eraseDisplay(parameters[0]); break;
      case 'K': this.eraseLine(parameters[0]); break;
      case 'X': this.eraseCells(this.column, this.column + count - 1); break;
      case 'P': this.shiftCells(-count); break;
      case '@': this.shiftCells(count); break;
      case 'S': this.scroll(count); break;
      case 'T': this.scroll(-count); break;
      case 'L': case 'M': {
        const top = this.scrollTop;
        this.scrollTop = this.row;
        this.scroll(final === 'L' ? -count : count);
        this.scrollTop = top;
        break;
      }
      case 'r':
        this.scrollTop = Math.min(MAX_ROWS - 1, Math.max(0, (parameters[0] || 1) - 1));
        this.scrollBottom = Math.min(MAX_ROWS - 1, Math.max(this.scrollTop, (parameters[1] || MAX_ROWS) - 1));
        this.row = this.column = 0;
        break;
      case 's': this.savedCursor = { row: this.row, column: this.column }; break;
      case 'u': this.row = this.savedCursor.row; this.column = this.savedCursor.column; break;
      // SGR, terminal queries and non-cursor modes have no visible text.
    }
  }

  private alternateScreen(enter: boolean): void {
    if (enter && !this.mainScreen) {
      this.mainScreen = { rows: this.rows, row: this.row, column: this.column };
      this.rows = new Map();
      this.row = this.column = 0;
    } else if (!enter && this.mainScreen) {
      this.rows = this.mainScreen.rows;
      this.row = this.mainScreen.row;
      this.column = this.mainScreen.column;
      this.mainScreen = undefined;
    }
  }

  private eraseDisplay(mode: number): void {
    if (mode === 2) this.rows.clear();
    else if (mode === 0 || mode === 1) {
      for (const row of this.rows.keys()) {
        if (mode === 0 ? row > this.row : row < this.row) this.rows.delete(row);
      }
      this.eraseLine(mode);
    }
  }

  private eraseLine(mode: number): void {
    if (mode === 2) this.rows.delete(this.row);
    else if (mode === 0) this.eraseCells(this.column, MAX_COLUMNS - 1);
    else if (mode === 1) this.eraseCells(0, this.column);
  }

  private eraseCells(from: number, to: number): void {
    const cells = this.rows.get(this.row);
    if (!cells) return;
    for (const column of cells.keys()) if (column >= from && column <= to) cells.delete(column);
    if (!cells.size) this.rows.delete(this.row);
  }

  private shiftCells(amount: number): void {
    const cells = this.rows.get(this.row);
    if (!cells) return;
    const shifted = new Map<number, string>();
    for (const [column, char] of cells) {
      if (column < this.column) shifted.set(column, char);
      else if (column + amount >= this.column && column + amount < MAX_COLUMNS) shifted.set(column + amount, char);
    }
    this.rows.set(this.row, shifted);
  }

  private trim(): void {
    let total = 0;
    for (const cells of this.rows.values()) total += cells.size;
    for (const row of [...this.rows.keys()].sort((a, b) => a - b)) {
      if (total <= MAX_CELLS) break;
      if (row === this.row) continue;
      total -= this.rows.get(row)?.size ?? 0;
      this.rows.delete(row);
    }
  }
}
