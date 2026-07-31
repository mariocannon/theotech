/**
 * A small 65816 assembler.
 *
 * Only the addressing modes the SNES engine actually needs are implemented.
 * Operands may be numbers or label names; label references are patched once
 * every label is known, so forward branches are fine.
 *
 * Register widths are tracked so `ldaImm`/`ldxImm` know whether to emit one
 * or two operand bytes. `rep`/`sep` update the tracked widths automatically;
 * `assume()` sets them without emitting anything (used at subroutine entry).
 */

export type Operand = number | string;

type FixupKind = "byte" | "word" | "long" | "rel8" | "rel16";

interface Fixup {
  at: number; // index into `bytes`
  label: string;
  kind: FixupKind;
  pcAfter: number; // address of the next instruction (for relative modes)
  addend: number;
}

export class AsmError extends Error {}

export class Asm {
  readonly bank: number;
  readonly origin: number;

  private bytes: number[] = [];
  private fixups: Fixup[] = [];
  private labels = new Map<string, number>();
  private aWide = true;
  private iWide = true;
  private scope = "";

  constructor(bank: number, origin: number) {
    this.bank = bank;
    this.origin = origin;
  }

  /** Current program counter (address within the bank). */
  get pc(): number {
    return this.origin + this.bytes.length;
  }

  get length(): number {
    return this.bytes.length;
  }

  // ---------------------------------------------------------------- labels

  /**
   * Define a label at the current position. Names starting with "." are local
   * to the most recent global label, so routines can reuse `.loop` freely.
   */
  l(name: string): this {
    const full = this.qualify(name);
    if (this.labels.has(full)) {
      throw new AsmError(`duplicate label: ${full}`);
    }
    if (!name.startsWith(".")) this.scope = name;
    this.labels.set(full, this.pc);
    return this;
  }

  /** Define a label with an explicit address (for data outside this bank). */
  equ(name: string, value: number): this {
    if (this.labels.has(name)) {
      throw new AsmError(`duplicate label: ${name}`);
    }
    this.labels.set(name, value);
    return this;
  }

  private qualify(name: string): string {
    return name.startsWith(".") ? `${this.scope}${name}` : name;
  }

  // ------------------------------------------------------------ raw output

  db(...values: number[]): this {
    for (const v of values) this.bytes.push(v & 0xff);
    return this;
  }

  dw(...values: number[]): this {
    for (const v of values) {
      this.bytes.push(v & 0xff, (v >> 8) & 0xff);
    }
    return this;
  }

  /** Pad with `value` until the bank-relative address reaches `addr`. */
  padTo(addr: number, value = 0x00): this {
    if (this.pc > addr) {
      throw new AsmError(
        `cannot pad to $${addr.toString(16)}: already at $${this.pc.toString(16)}`
      );
    }
    while (this.pc < addr) this.bytes.push(value & 0xff);
    return this;
  }

  // ----------------------------------------------------------- width state

  assume(opts: { a?: 8 | 16; i?: 8 | 16 }): this {
    if (opts.a !== undefined) this.aWide = opts.a === 16;
    if (opts.i !== undefined) this.iWide = opts.i === 16;
    return this;
  }

  rep(mask: number): this {
    this.db(0xc2, mask);
    if (mask & 0x20) this.aWide = true;
    if (mask & 0x10) this.iWide = true;
    return this;
  }

  sep(mask: number): this {
    this.db(0xe2, mask);
    if (mask & 0x20) this.aWide = false;
    if (mask & 0x10) this.iWide = false;
    return this;
  }

  a8(): this {
    return this.sep(0x20);
  }
  a16(): this {
    return this.rep(0x20);
  }
  i8(): this {
    return this.sep(0x10);
  }
  i16(): this {
    return this.rep(0x10);
  }
  ai8(): this {
    return this.sep(0x30);
  }
  ai16(): this {
    return this.rep(0x30);
  }

  // -------------------------------------------------------- operand emitters

  private emitByte(op: number, v: Operand): this {
    this.bytes.push(op);
    if (typeof v === "number") {
      this.bytes.push(v & 0xff);
    } else {
      this.pushFixup(v, "byte");
      this.bytes.push(0);
    }
    return this;
  }

  private emitWord(op: number, v: Operand): this {
    this.bytes.push(op);
    if (typeof v === "number") {
      this.bytes.push(v & 0xff, (v >> 8) & 0xff);
    } else {
      this.pushFixup(v, "word");
      this.bytes.push(0, 0);
    }
    return this;
  }

  private emitLong(op: number, v: Operand): this {
    this.bytes.push(op);
    if (typeof v === "number") {
      this.bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff);
    } else {
      this.pushFixup(v, "long");
      this.bytes.push(0, 0, 0);
    }
    return this;
  }

  private emitImm(op: number, v: Operand, wide: boolean): this {
    this.bytes.push(op);
    if (typeof v === "string") {
      this.pushFixup(v, wide ? "word" : "byte");
      this.bytes.push(0);
      if (wide) this.bytes.push(0);
      return this;
    }
    if (wide) {
      this.bytes.push(v & 0xff, (v >> 8) & 0xff);
    } else {
      this.bytes.push(v & 0xff);
    }
    return this;
  }

  private emitRel8(op: number, target: Operand): this {
    this.bytes.push(op);
    if (typeof target === "number") {
      const delta = target - (this.pc + 1);
      if (delta < -128 || delta > 127) {
        throw new AsmError(`branch out of range (${delta})`);
      }
      this.bytes.push(delta & 0xff);
    } else {
      this.pushFixup(target, "rel8");
      this.bytes.push(0);
    }
    return this;
  }

  private emitRel16(op: number, target: Operand): this {
    this.bytes.push(op);
    if (typeof target === "number") {
      const delta = target - (this.pc + 2);
      this.bytes.push(delta & 0xff, (delta >> 8) & 0xff);
    } else {
      this.pushFixup(target, "rel16");
      this.bytes.push(0, 0);
    }
    return this;
  }

  private pushFixup(label: string, kind: FixupKind): void {
    // Support "label+3" style operands, handy for indexing into tables.
    let name = label;
    let addend = 0;
    const plus = label.indexOf("+");
    if (plus > 0) {
      name = label.slice(0, plus);
      addend = parseInt(label.slice(plus + 1), 10);
      if (Number.isNaN(addend)) {
        throw new AsmError(`bad label expression: ${label}`);
      }
    }
    const size =
      kind === "byte" || kind === "rel8" ? 1 : kind === "long" ? 3 : 2;
    this.fixups.push({
      at: this.bytes.length,
      label: this.qualify(name),
      kind,
      pcAfter: this.pc + size,
      addend,
    });
  }

  // ------------------------------------------------------------ instructions

  // -- loads / stores
  ldaImm(v: Operand): this {
    return this.emitImm(0xa9, v, this.aWide);
  }
  ldaDp(v: Operand): this {
    return this.emitByte(0xa5, v);
  }
  ldaAbs(v: Operand): this {
    return this.emitWord(0xad, v);
  }
  ldaAbsX(v: Operand): this {
    return this.emitWord(0xbd, v);
  }
  ldaAbsY(v: Operand): this {
    return this.emitWord(0xb9, v);
  }
  ldaLong(v: Operand): this {
    return this.emitLong(0xaf, v);
  }
  ldaLongX(v: Operand): this {
    return this.emitLong(0xbf, v);
  }

  ldxImm(v: Operand): this {
    return this.emitImm(0xa2, v, this.iWide);
  }
  ldxDp(v: Operand): this {
    return this.emitByte(0xa6, v);
  }
  ldxAbs(v: Operand): this {
    return this.emitWord(0xae, v);
  }

  ldyImm(v: Operand): this {
    return this.emitImm(0xa0, v, this.iWide);
  }
  ldyDp(v: Operand): this {
    return this.emitByte(0xa4, v);
  }
  ldyAbs(v: Operand): this {
    return this.emitWord(0xac, v);
  }

  staDp(v: Operand): this {
    return this.emitByte(0x85, v);
  }
  staAbs(v: Operand): this {
    return this.emitWord(0x8d, v);
  }
  staAbsX(v: Operand): this {
    return this.emitWord(0x9d, v);
  }
  staAbsY(v: Operand): this {
    return this.emitWord(0x99, v);
  }
  staLong(v: Operand): this {
    return this.emitLong(0x8f, v);
  }

  stxDp(v: Operand): this {
    return this.emitByte(0x86, v);
  }
  stxAbs(v: Operand): this {
    return this.emitWord(0x8e, v);
  }
  styDp(v: Operand): this {
    return this.emitByte(0x84, v);
  }
  styAbs(v: Operand): this {
    return this.emitWord(0x8c, v);
  }

  stzDp(v: Operand): this {
    return this.emitByte(0x64, v);
  }
  stzAbs(v: Operand): this {
    return this.emitWord(0x9c, v);
  }
  stzAbsX(v: Operand): this {
    return this.emitWord(0x9e, v);
  }

  // -- arithmetic / logic
  adcImm(v: Operand): this {
    return this.emitImm(0x69, v, this.aWide);
  }
  adcDp(v: Operand): this {
    return this.emitByte(0x65, v);
  }
  adcAbs(v: Operand): this {
    return this.emitWord(0x6d, v);
  }
  adcAbsY(v: Operand): this {
    return this.emitWord(0x79, v);
  }

  sbcImm(v: Operand): this {
    return this.emitImm(0xe9, v, this.aWide);
  }
  sbcDp(v: Operand): this {
    return this.emitByte(0xe5, v);
  }
  sbcAbs(v: Operand): this {
    return this.emitWord(0xed, v);
  }
  sbcAbsY(v: Operand): this {
    return this.emitWord(0xf9, v);
  }

  andImm(v: Operand): this {
    return this.emitImm(0x29, v, this.aWide);
  }
  andDp(v: Operand): this {
    return this.emitByte(0x25, v);
  }
  andAbs(v: Operand): this {
    return this.emitWord(0x2d, v);
  }

  oraImm(v: Operand): this {
    return this.emitImm(0x09, v, this.aWide);
  }
  oraDp(v: Operand): this {
    return this.emitByte(0x05, v);
  }
  oraAbs(v: Operand): this {
    return this.emitWord(0x0d, v);
  }
  oraAbsX(v: Operand): this {
    return this.emitWord(0x1d, v);
  }

  eorDp(v: Operand): this {
    return this.emitByte(0x45, v);
  }

  cmpImm(v: Operand): this {
    return this.emitImm(0xc9, v, this.aWide);
  }
  cmpDp(v: Operand): this {
    return this.emitByte(0xc5, v);
  }
  cmpAbs(v: Operand): this {
    return this.emitWord(0xcd, v);
  }

  cpxImm(v: Operand): this {
    return this.emitImm(0xe0, v, this.iWide);
  }
  cpyImm(v: Operand): this {
    return this.emitImm(0xc0, v, this.iWide);
  }

  incA(): this {
    return this.db(0x1a);
  }
  incDp(v: Operand): this {
    return this.emitByte(0xe6, v);
  }
  incAbs(v: Operand): this {
    return this.emitWord(0xee, v);
  }
  decA(): this {
    return this.db(0x3a);
  }
  decDp(v: Operand): this {
    return this.emitByte(0xc6, v);
  }
  decAbs(v: Operand): this {
    return this.emitWord(0xce, v);
  }

  aslA(n = 1): this {
    for (let i = 0; i < n; i++) this.db(0x0a);
    return this;
  }
  lsrA(n = 1): this {
    for (let i = 0; i < n; i++) this.db(0x4a);
    return this;
  }

  inx(): this {
    return this.db(0xe8);
  }
  iny(): this {
    return this.db(0xc8);
  }
  dex(): this {
    return this.db(0xca);
  }
  dey(): this {
    return this.db(0x88);
  }

  // -- transfers / stack
  tax(): this {
    return this.db(0xaa);
  }
  tay(): this {
    return this.db(0xa8);
  }
  txa(): this {
    return this.db(0x8a);
  }
  tya(): this {
    return this.db(0x98);
  }
  tcd(): this {
    return this.db(0x5b);
  }
  tcs(): this {
    return this.db(0x1b);
  }
  txs(): this {
    return this.db(0x9a);
  }
  xba(): this {
    return this.db(0xeb);
  }

  pha(): this {
    return this.db(0x48);
  }
  pla(): this {
    return this.db(0x68);
  }
  phx(): this {
    return this.db(0xda);
  }
  plx(): this {
    return this.db(0xfa);
  }
  phy(): this {
    return this.db(0x5a);
  }
  ply(): this {
    return this.db(0x7a);
  }
  phb(): this {
    return this.db(0x8b);
  }
  plb(): this {
    return this.db(0xab);
  }
  phd(): this {
    return this.db(0x0b);
  }
  pld(): this {
    return this.db(0x2b);
  }
  php(): this {
    return this.db(0x08);
  }
  plp(): this {
    return this.db(0x28);
  }

  // -- flags
  clc(): this {
    return this.db(0x18);
  }
  sec(): this {
    return this.db(0x38);
  }
  sei(): this {
    return this.db(0x78);
  }
  cli(): this {
    return this.db(0x58);
  }
  cld(): this {
    return this.db(0xd8);
  }
  xce(): this {
    return this.db(0xfb);
  }

  // -- control flow
  bcc(t: Operand): this {
    return this.emitRel8(0x90, t);
  }
  bcs(t: Operand): this {
    return this.emitRel8(0xb0, t);
  }
  beq(t: Operand): this {
    return this.emitRel8(0xf0, t);
  }
  bne(t: Operand): this {
    return this.emitRel8(0xd0, t);
  }
  bmi(t: Operand): this {
    return this.emitRel8(0x30, t);
  }
  bpl(t: Operand): this {
    return this.emitRel8(0x10, t);
  }
  bra(t: Operand): this {
    return this.emitRel8(0x80, t);
  }
  brl(t: Operand): this {
    return this.emitRel16(0x82, t);
  }

  jmp(t: Operand): this {
    return this.emitWord(0x4c, t);
  }
  jml(t: Operand): this {
    return this.emitLong(0x5c, t);
  }
  jsr(t: Operand): this {
    return this.emitWord(0x20, t);
  }
  jsl(t: Operand): this {
    return this.emitLong(0x22, t);
  }
  rts(): this {
    return this.db(0x60);
  }
  rtl(): this {
    return this.db(0x6b);
  }
  rti(): this {
    return this.db(0x40);
  }
  nop(): this {
    return this.db(0xea);
  }
  wai(): this {
    return this.db(0xcb);
  }

  // ------------------------------------------------------------- assembling

  /** Resolve every fixup and return the finished bank image. */
  assemble(): Uint8Array {
    for (const f of this.fixups) {
      const base = this.labels.get(f.label);
      if (base === undefined) {
        throw new AsmError(`undefined label: ${f.label}`);
      }
      const value = base + f.addend;
      switch (f.kind) {
        case "byte":
          this.bytes[f.at] = value & 0xff;
          break;
        case "word":
          this.bytes[f.at] = value & 0xff;
          this.bytes[f.at + 1] = (value >> 8) & 0xff;
          break;
        case "long":
          this.bytes[f.at] = value & 0xff;
          this.bytes[f.at + 1] = (value >> 8) & 0xff;
          this.bytes[f.at + 2] = (value >> 16) & 0xff;
          break;
        case "rel8": {
          const delta = value - f.pcAfter;
          if (delta < -128 || delta > 127) {
            throw new AsmError(
              `branch to ${f.label} out of range (${delta} bytes)`
            );
          }
          this.bytes[f.at] = delta & 0xff;
          break;
        }
        case "rel16": {
          const delta = value - f.pcAfter;
          this.bytes[f.at] = delta & 0xff;
          this.bytes[f.at + 1] = (delta >> 8) & 0xff;
          break;
        }
      }
    }
    return Uint8Array.from(this.bytes);
  }

  labelAddress(name: string): number {
    const v = this.labels.get(name);
    if (v === undefined) throw new AsmError(`undefined label: ${name}`);
    return v;
  }
}
