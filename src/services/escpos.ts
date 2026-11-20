/**
 * Minimal ESC/POS encoder for 58/80 mm thermal printers.
 * Text is encoded as CP437-compatible ASCII; unsupported characters are replaced.
 */
const ESC = 0x1b
const GS = 0x1d

export class EscPos {
  private bytes: number[] = []
  readonly width: number

  constructor(width = 42) {
    this.width = width
    this.raw(ESC, 0x40) // initialise
  }

  raw(...b: number[]) {
    this.bytes.push(...b)
    return this
  }

  text(value: string) {
    for (const ch of value.normalize('NFKD')) {
      const code = ch.charCodeAt(0)
      if (code === 0x2212) this.bytes.push(0x2d)
      else if (code >= 0x20 && code < 0x7f) this.bytes.push(code)
      else if (code === 0x0a) this.bytes.push(0x0a)
      else if (code >= 0x300 && code <= 0x36f) continue
      else this.bytes.push(0x3f)
    }
    return this
  }

  line(value = '') {
    return this.text(value).raw(0x0a)
  }

  align(mode: 'left' | 'center' | 'right') {
    return this.raw(ESC, 0x61, mode === 'left' ? 0 : mode === 'center' ? 1 : 2)
  }

  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0)
  }

  size(double: boolean) {
    return this.raw(GS, 0x21, double ? 0x11 : 0x00)
  }

  rule(char = '-') {
    return this.line(char.repeat(this.width))
  }

  /** Left text and right text on one line, truncating the left side if needed. */
  pair(left: string, right: string) {
    const space = this.width - right.length - 1
    const l = left.length > space ? `${left.slice(0, Math.max(0, space - 1))}.` : left
    return this.line(`${l}${' '.repeat(Math.max(1, this.width - l.length - right.length))}${right}`)
  }

  feed(lines = 3) {
    return this.raw(ESC, 0x64, lines)
  }

  cut() {
    return this.raw(GS, 0x56, 0x42, 0x00)
  }

  toArray(): number[] {
    return [...this.bytes]
  }
}

/** ESC p: pulse drawer kick pin 2 (most cash drawers). */
export function drawerKickBytes(): number[] {
  return [ESC, 0x70, 0x00, 0x19, 0xfa]
}
