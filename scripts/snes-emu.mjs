/**
 * A minimal 65816 + SNES emulator, written purely to verify the ROMs the
 * builder generates. It implements the instruction subset the engine emits and
 * enough of the PPU/DMA registers to observe what the ROM actually does.
 *
 * Unknown opcodes throw, which makes this a strong check on the assembler's
 * encodings: any mistake shows up as a decode failure or a wild jump rather
 * than silently producing a broken ROM.
 */

const FLAG_C = 0x01;
const FLAG_Z = 0x02;
const FLAG_I = 0x04;
const FLAG_D = 0x08;
const FLAG_X = 0x10;
const FLAG_M = 0x20;
const FLAG_V = 0x40;
const FLAG_N = 0x80;

export class Snes {
  constructor(rom) {
    this.rom = rom;
    this.wram = new Uint8Array(0x20000);
    this.vram = new Uint8Array(0x10000);
    this.cgram = new Uint8Array(0x200);
    this.oam = new Uint8Array(0x220);
    this.ppu = new Uint8Array(0x100);
    this.cpuReg = new Uint8Array(0x600);

    this.vmadd = 0;
    this.vmain = 0;
    this.cgadd = 0;
    this.cgLatchLow = true;
    this.cgLatch = 0;
    this.oamadd = 0;
    this.oamLatchLow = true;
    this.oamLatch = 0;
    this.wmadd = 0;
    this.joypad = 0;
    this.nmiEnabled = false;
    this.bg1hofs = 0;
    this.bg1vofs = 0;
    this.bgofsLatch = 0;
    this.bghofsLatch = 0;
    this.inidisp = 0x8f;
    this.dmaBytes = 0;

    // CPU state
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.s = 0x01ff;
    this.d = 0;
    this.dbr = 0;
    this.pbr = 0;
    this.pc = 0;
    this.p = FLAG_M | FLAG_X | FLAG_I;
    this.e = true;
    this.cycles = 0;
    this.opcodeHistogram = new Map();
  }

  reset() {
    this.pbr = 0;
    this.pc = this.read16(0, 0xfffc);
    this.e = true;
    this.p = FLAG_M | FLAG_X | FLAG_I;
    this.s = 0x01ff;
  }

  // ------------------------------------------------------------- memory map

  read8(bank, addr) {
    bank &= 0xff;
    addr &= 0xffff;
    const b = bank & 0x7f; // $80-$BF mirror $00-$3F
    if (bank === 0x7e || bank === 0x7f) {
      return this.wram[((bank - 0x7e) << 16) | addr];
    }
    if (b <= 0x3f) {
      if (addr < 0x2000) return this.wram[addr];
      if (addr >= 0x2100 && addr <= 0x21ff) return this.readPpu(addr);
      if (addr >= 0x4200 && addr <= 0x44ff) return this.readCpuReg(addr);
      if (addr >= 0x8000) return this.romByte(bank, addr);
      return 0;
    }
    if (addr >= 0x8000) return this.romByte(bank, addr);
    return 0;
  }

  write8(bank, addr, value) {
    bank &= 0xff;
    addr &= 0xffff;
    value &= 0xff;
    const b = bank & 0x7f;
    if (bank === 0x7e || bank === 0x7f) {
      this.wram[((bank - 0x7e) << 16) | addr] = value;
      return;
    }
    if (b <= 0x3f) {
      if (addr < 0x2000) {
        this.wram[addr] = value;
        return;
      }
      if (addr >= 0x2100 && addr <= 0x21ff) return this.writePpu(addr, value);
      if (addr >= 0x4200 && addr <= 0x44ff) return this.writeCpuReg(addr, value);
      return; // writes to ROM are ignored
    }
  }

  romByte(bank, addr) {
    const offset = ((bank & 0x7f) * 0x8000 + (addr - 0x8000)) % this.rom.length;
    return this.rom[offset];
  }

  read16(bank, addr) {
    return this.read8(bank, addr) | (this.read8(bank, addr + 1) << 8);
  }

  // ------------------------------------------------------------------- ppu

  readPpu(addr) {
    if (addr === 0x2137) return 0;
    return this.ppu[addr & 0xff];
  }

  writePpu(addr, value) {
    this.ppu[addr & 0xff] = value;
    switch (addr) {
      case 0x2100:
        this.inidisp = value;
        break;
      case 0x2115:
        this.vmain = value;
        break;
      case 0x2116:
        this.vmadd = (this.vmadd & 0xff00) | value;
        break;
      case 0x2117:
        this.vmadd = (this.vmadd & 0x00ff) | (value << 8);
        break;
      case 0x2118:
        this.vram[(this.vmadd << 1) & 0xffff] = value;
        if ((this.vmain & 0x80) === 0) this.stepVmadd();
        break;
      case 0x2119:
        this.vram[((this.vmadd << 1) + 1) & 0xffff] = value;
        if ((this.vmain & 0x80) !== 0) this.stepVmadd();
        break;
      case 0x2121:
        this.cgadd = value;
        this.cgLatchLow = true;
        break;
      case 0x2122:
        if (this.cgLatchLow) {
          this.cgLatch = value;
          this.cgLatchLow = false;
        } else {
          this.cgram[(this.cgadd << 1) & 0x1ff] = this.cgLatch;
          this.cgram[((this.cgadd << 1) + 1) & 0x1ff] = value;
          this.cgadd = (this.cgadd + 1) & 0xff;
          this.cgLatchLow = true;
        }
        break;
      case 0x2102:
        this.oamadd = (this.oamadd & 0x100) | value;
        this.oamLatchLow = true;
        break;
      case 0x2103:
        this.oamadd = (this.oamadd & 0x0ff) | ((value & 1) << 8);
        this.oamLatchLow = true;
        break;
      case 0x2104: {
        const byteAddr = this.oamadd << 1;
        if (byteAddr >= 0x200) {
          // High table: writes land immediately, one byte at a time.
          this.oam[0x200 + (this.oamadd & 0x0f)] = value;
          this.oamadd = (this.oamadd + 1) & 0x1ff;
          break;
        }
        if (this.oamLatchLow) {
          this.oamLatch = value;
          this.oamLatchLow = false;
        } else {
          this.oam[byteAddr] = this.oamLatch;
          this.oam[byteAddr + 1] = value;
          this.oamadd = (this.oamadd + 1) & 0x1ff;
          this.oamLatchLow = true;
        }
        break;
      }
      // The BG scroll registers are not a low/high toggle: each write shifts a
      // new high byte in over the shared latch holding the previous write.
      // That is why a stray odd write (the register clear at boot) does not
      // desynchronise later writes.
      case 0x210d:
        this.bg1hofs =
          ((value << 8) | (this.bgofsLatch & 0xf8) | (this.bghofsLatch & 0x07)) &
          0x3ff;
        this.bgofsLatch = value;
        this.bghofsLatch = value;
        break;
      case 0x210e:
        this.bg1vofs = ((value << 8) | this.bgofsLatch) & 0x3ff;
        this.bgofsLatch = value;
        break;
      case 0x2180:
        this.wram[this.wmadd & 0x1ffff] = value;
        this.wmadd = (this.wmadd + 1) & 0x1ffff;
        break;
      case 0x2181:
        this.wmadd = (this.wmadd & 0x1ff00) | value;
        break;
      case 0x2182:
        this.wmadd = (this.wmadd & 0x100ff) | (value << 8);
        break;
      case 0x2183:
        this.wmadd = (this.wmadd & 0x0ffff) | ((value & 1) << 16);
        break;
    }
  }

  stepVmadd() {
    const step = [1, 32, 128, 128][this.vmain & 0x03];
    this.vmadd = (this.vmadd + step) & 0xffff;
  }

  // ------------------------------------------------------------- cpu regs

  readCpuReg(addr) {
    switch (addr) {
      case 0x4210: {
        const v = this.nmiFlag ? 0x82 : 0x02;
        this.nmiFlag = false;
        return v;
      }
      case 0x4212:
        return 0; // never busy: auto joypad read has always finished
      case 0x4218:
        return this.joypad & 0xff;
      case 0x4219:
        return (this.joypad >> 8) & 0xff;
      default:
        return this.cpuReg[addr - 0x4200] ?? 0;
    }
  }

  writeCpuReg(addr, value) {
    this.cpuReg[addr - 0x4200] = value;
    if (addr === 0x4200) this.nmiEnabled = (value & 0x80) !== 0;
    if (addr === 0x420b) this.runDma(value);
  }

  runDma(mask) {
    for (let ch = 0; ch < 8; ch++) {
      if ((mask & (1 << ch)) === 0) continue;
      const base = 0x4300 + ch * 0x10 - 0x4200;
      const dmap = this.cpuReg[base];
      const bbad = this.cpuReg[base + 1];
      let a1 = this.cpuReg[base + 2] | (this.cpuReg[base + 3] << 8);
      const a1b = this.cpuReg[base + 4];
      let count = this.cpuReg[base + 5] | (this.cpuReg[base + 6] << 8);
      if (count === 0) count = 0x10000;

      const stepBits = (dmap >> 3) & 0x03;
      const step = stepBits === 0 ? 1 : stepBits === 2 ? -1 : 0;
      const mode = dmap & 0x07;
      const pattern =
        mode === 0
          ? [0]
          : mode === 1
            ? [0, 1]
            : mode === 2
              ? [0, 0]
              : mode === 3
                ? [0, 0, 1, 1]
                : [0, 1, 2, 3];

      if (dmap & 0x80) {
        throw new Error("B->A DMA is not implemented");
      }

      for (let i = 0; i < count; i++) {
        const value = this.read8(a1b, a1);
        this.writePpu(0x2100 | ((bbad + pattern[i % pattern.length]) & 0xff), value);
        a1 = (a1 + step) & 0xffff;
      }
      this.dmaBytes += count;
      this.cpuReg[base + 2] = a1 & 0xff;
      this.cpuReg[base + 3] = (a1 >> 8) & 0xff;
      this.cpuReg[base + 5] = 0;
      this.cpuReg[base + 6] = 0;
    }
  }

  // ---------------------------------------------------------------- helpers

  get m16() {
    return !this.e && (this.p & FLAG_M) === 0;
  }
  get x16() {
    return !this.e && (this.p & FLAG_X) === 0;
  }

  setZN(value, wide) {
    const mask = wide ? 0xffff : 0xff;
    const neg = wide ? 0x8000 : 0x80;
    this.p = (this.p & ~(FLAG_Z | FLAG_N)) >>> 0;
    if ((value & mask) === 0) this.p |= FLAG_Z;
    if (value & neg) this.p |= FLAG_N;
  }

  push8(v) {
    this.write8(0, this.s, v & 0xff);
    this.s = (this.s - 1) & 0xffff;
  }
  pull8() {
    this.s = (this.s + 1) & 0xffff;
    return this.read8(0, this.s);
  }
  push16(v) {
    this.push8((v >> 8) & 0xff);
    this.push8(v & 0xff);
  }
  pull16() {
    return this.pull8() | (this.pull8() << 8);
  }

  fetch8() {
    const v = this.read8(this.pbr, this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }
  fetch16() {
    return this.fetch8() | (this.fetch8() << 8);
  }
  fetch24() {
    return this.fetch8() | (this.fetch8() << 8) | (this.fetch8() << 16);
  }

  // Addressing modes return [bank, address].
  addrDp() {
    return [0, (this.d + this.fetch8()) & 0xffff];
  }
  addrAbs() {
    return [this.dbr, this.fetch16()];
  }
  addrAbsX() {
    const a = this.fetch16() + this.x;
    return [(this.dbr + (a >> 16)) & 0xff, a & 0xffff];
  }
  addrAbsY() {
    const a = this.fetch16() + this.y;
    return [(this.dbr + (a >> 16)) & 0xff, a & 0xffff];
  }
  addrLong() {
    const v = this.fetch24();
    return [(v >> 16) & 0xff, v & 0xffff];
  }
  addrLongX() {
    const v = this.fetch24();
    const a = (v & 0xffff) + this.x;
    return [((v >> 16) + (a >> 16)) & 0xff, a & 0xffff];
  }

  loadOp(mode, wide) {
    const [bank, addr] = mode.call(this);
    return wide ? this.read16(bank, addr) : this.read8(bank, addr);
  }

  storeOp(mode, wide, value) {
    const [bank, addr] = mode.call(this);
    this.write8(bank, addr, value & 0xff);
    if (wide) this.write8(bank, addr + 1, (value >> 8) & 0xff);
  }

  immediate(wide) {
    return wide ? this.fetch16() : this.fetch8();
  }

  setA(value) {
    if (this.m16) this.a = value & 0xffff;
    else this.a = (this.a & 0xff00) | (value & 0xff);
  }
  getA() {
    return this.m16 ? this.a & 0xffff : this.a & 0xff;
  }

  setX(value) {
    this.x = this.x16 ? value & 0xffff : value & 0xff;
  }
  setY(value) {
    this.y = this.x16 ? value & 0xffff : value & 0xff;
  }

  doAdc(operand) {
    const wide = this.m16;
    const mask = wide ? 0xffff : 0xff;
    const a = this.getA();
    const sum = a + operand + (this.p & FLAG_C ? 1 : 0);
    this.p &= ~(FLAG_C | FLAG_V);
    if (sum > mask) this.p |= FLAG_C;
    const neg = wide ? 0x8000 : 0x80;
    if (~(a ^ operand) & (a ^ sum) & neg) this.p |= FLAG_V;
    this.setA(sum);
    this.setZN(sum & mask, wide);
  }

  doSbc(operand) {
    const wide = this.m16;
    const mask = wide ? 0xffff : 0xff;
    this.doAdcRaw(operand ^ mask, wide, mask);
  }

  doAdcRaw(operand, wide, mask) {
    const a = this.getA();
    const sum = a + operand + (this.p & FLAG_C ? 1 : 0);
    this.p &= ~(FLAG_C | FLAG_V);
    if (sum > mask) this.p |= FLAG_C;
    const neg = wide ? 0x8000 : 0x80;
    if (~(a ^ operand) & (a ^ sum) & neg) this.p |= FLAG_V;
    this.setA(sum);
    this.setZN(sum & mask, wide);
  }

  doCompare(reg, operand, wide) {
    const mask = wide ? 0xffff : 0xff;
    const diff = (reg - operand) & 0xffffff;
    this.p &= ~FLAG_C;
    if (reg >= operand) this.p |= FLAG_C;
    this.setZN(diff & mask, wide);
  }

  branch(cond) {
    const offset = this.fetch8();
    if (!cond) return;
    const signed = offset < 0x80 ? offset : offset - 0x100;
    this.pc = (this.pc + signed) & 0xffff;
  }

  nmi() {
    this.nmiFlag = true;
    this.push8(this.pbr);
    this.push16(this.pc);
    this.push8(this.p);
    this.p |= FLAG_I;
    this.p &= ~FLAG_D;
    this.pbr = 0;
    this.pc = this.read16(0, 0xffea);
  }

  step() {
    const opcode = this.fetch8();
    this.opcodeHistogram.set(
      opcode,
      (this.opcodeHistogram.get(opcode) ?? 0) + 1
    );
    this.cycles++;
    const m = this.m16;
    const i = this.x16;

    switch (opcode) {
      // ---- flags / misc
      case 0x78: this.p |= FLAG_I; break;
      case 0x58: this.p &= ~FLAG_I; break;
      case 0xd8: this.p &= ~FLAG_D; break;
      case 0x18: this.p &= ~FLAG_C; break;
      case 0x38: this.p |= FLAG_C; break;
      case 0xea: break;
      case 0xfb: {
        // XCE exchanges the carry flag with the emulation bit.
        const carry = (this.p & FLAG_C) !== 0;
        const oldE = this.e;
        this.e = carry;
        this.p = oldE ? this.p | FLAG_C : this.p & ~FLAG_C;
        if (this.e) {
          this.p |= FLAG_M | FLAG_X;
          this.x &= 0xff;
          this.y &= 0xff;
          this.s = 0x0100 | (this.s & 0xff);
        }
        break;
      }
      case 0xc2: {
        const mask = this.fetch8();
        this.p &= ~mask;
        break;
      }
      case 0xe2: {
        const mask = this.fetch8();
        this.p |= mask;
        if (this.p & FLAG_X) {
          this.x &= 0xff;
          this.y &= 0xff;
        }
        break;
      }

      // ---- loads
      case 0xa9: this.setA(this.immediate(m)); this.setZN(this.getA(), m); break;
      case 0xa5: this.setA(this.loadOp(this.addrDp, m)); this.setZN(this.getA(), m); break;
      case 0xad: this.setA(this.loadOp(this.addrAbs, m)); this.setZN(this.getA(), m); break;
      case 0xbd: this.setA(this.loadOp(this.addrAbsX, m)); this.setZN(this.getA(), m); break;
      case 0xb9: this.setA(this.loadOp(this.addrAbsY, m)); this.setZN(this.getA(), m); break;
      case 0xaf: this.setA(this.loadOp(this.addrLong, m)); this.setZN(this.getA(), m); break;
      case 0xbf: this.setA(this.loadOp(this.addrLongX, m)); this.setZN(this.getA(), m); break;

      case 0xa2: this.setX(this.immediate(i)); this.setZN(this.x, i); break;
      case 0xa6: this.setX(this.loadOp(this.addrDp, i)); this.setZN(this.x, i); break;
      case 0xae: this.setX(this.loadOp(this.addrAbs, i)); this.setZN(this.x, i); break;
      case 0xa0: this.setY(this.immediate(i)); this.setZN(this.y, i); break;
      case 0xa4: this.setY(this.loadOp(this.addrDp, i)); this.setZN(this.y, i); break;
      case 0xac: this.setY(this.loadOp(this.addrAbs, i)); this.setZN(this.y, i); break;

      // ---- stores
      case 0x85: this.storeOp(this.addrDp, m, this.getA()); break;
      case 0x8d: this.storeOp(this.addrAbs, m, this.getA()); break;
      case 0x9d: this.storeOp(this.addrAbsX, m, this.getA()); break;
      case 0x99: this.storeOp(this.addrAbsY, m, this.getA()); break;
      case 0x8f: this.storeOp(this.addrLong, m, this.getA()); break;
      case 0x86: this.storeOp(this.addrDp, i, this.x); break;
      case 0x8e: this.storeOp(this.addrAbs, i, this.x); break;
      case 0x84: this.storeOp(this.addrDp, i, this.y); break;
      case 0x8c: this.storeOp(this.addrAbs, i, this.y); break;
      case 0x64: this.storeOp(this.addrDp, m, 0); break;
      case 0x9c: this.storeOp(this.addrAbs, m, 0); break;
      case 0x9e: this.storeOp(this.addrAbsX, m, 0); break;

      // ---- arithmetic
      case 0x69: this.doAdc(this.immediate(m)); break;
      case 0x65: this.doAdc(this.loadOp(this.addrDp, m)); break;
      case 0x6d: this.doAdc(this.loadOp(this.addrAbs, m)); break;
      case 0x79: this.doAdc(this.loadOp(this.addrAbsY, m)); break;
      case 0xe9: this.doSbc(this.immediate(m)); break;
      case 0xe5: this.doSbc(this.loadOp(this.addrDp, m)); break;
      case 0xed: this.doSbc(this.loadOp(this.addrAbs, m)); break;
      case 0xf9: this.doSbc(this.loadOp(this.addrAbsY, m)); break;

      case 0x29: this.setA(this.getA() & this.immediate(m)); this.setZN(this.getA(), m); break;
      case 0x25: this.setA(this.getA() & this.loadOp(this.addrDp, m)); this.setZN(this.getA(), m); break;
      case 0x2d: this.setA(this.getA() & this.loadOp(this.addrAbs, m)); this.setZN(this.getA(), m); break;
      case 0x09: this.setA(this.getA() | this.immediate(m)); this.setZN(this.getA(), m); break;
      case 0x05: this.setA(this.getA() | this.loadOp(this.addrDp, m)); this.setZN(this.getA(), m); break;
      case 0x0d: this.setA(this.getA() | this.loadOp(this.addrAbs, m)); this.setZN(this.getA(), m); break;
      case 0x1d: this.setA(this.getA() | this.loadOp(this.addrAbsX, m)); this.setZN(this.getA(), m); break;
      case 0x45: this.setA(this.getA() ^ this.loadOp(this.addrDp, m)); this.setZN(this.getA(), m); break;

      case 0xc9: this.doCompare(this.getA(), this.immediate(m), m); break;
      case 0xc5: this.doCompare(this.getA(), this.loadOp(this.addrDp, m), m); break;
      case 0xcd: this.doCompare(this.getA(), this.loadOp(this.addrAbs, m), m); break;
      case 0xe0: this.doCompare(this.x, this.immediate(i), i); break;
      case 0xc0: this.doCompare(this.y, this.immediate(i), i); break;

      case 0x1a: this.setA(this.getA() + 1); this.setZN(this.getA(), m); break;
      case 0x3a: this.setA(this.getA() - 1); this.setZN(this.getA(), m); break;
      case 0xe6: case 0xee: case 0xc6: case 0xce: {
        const mode = opcode === 0xe6 || opcode === 0xc6 ? this.addrDp : this.addrAbs;
        const delta = opcode === 0xe6 || opcode === 0xee ? 1 : -1;
        const [bank, addr] = mode.call(this);
        let v = m ? this.read16(bank, addr) : this.read8(bank, addr);
        v = (v + delta) & (m ? 0xffff : 0xff);
        this.write8(bank, addr, v & 0xff);
        if (m) this.write8(bank, addr + 1, (v >> 8) & 0xff);
        this.setZN(v, m);
        break;
      }

      case 0x0a: {
        const mask = m ? 0xffff : 0xff;
        const neg = m ? 0x8000 : 0x80;
        const v = this.getA();
        this.p = v & neg ? this.p | FLAG_C : this.p & ~FLAG_C;
        this.setA((v << 1) & mask);
        this.setZN(this.getA(), m);
        break;
      }
      case 0x4a: {
        const v = this.getA();
        this.p = v & 1 ? this.p | FLAG_C : this.p & ~FLAG_C;
        this.setA(v >> 1);
        this.setZN(this.getA(), m);
        break;
      }

      case 0xe8: this.setX(this.x + 1); this.setZN(this.x, i); break;
      case 0xca: this.setX(this.x - 1); this.setZN(this.x, i); break;
      case 0xc8: this.setY(this.y + 1); this.setZN(this.y, i); break;
      case 0x88: this.setY(this.y - 1); this.setZN(this.y, i); break;

      // ---- transfers
      // TAX/TAY move as many bits as the index registers are wide, whatever M is.
      case 0xaa: this.setX(this.a); this.setZN(this.x, i); break;
      case 0xa8: this.setY(this.a); this.setZN(this.y, i); break;
      case 0x8a: this.setA(this.x); this.setZN(this.getA(), m); break;
      case 0x98: this.setA(this.y); this.setZN(this.getA(), m); break;
      case 0x5b: this.d = this.a & 0xffff; this.setZN(this.d, true); break;
      case 0x1b: this.s = this.a & 0xffff; break;
      case 0x9a: this.s = this.x & 0xffff; break;
      case 0xeb: {
        const lo = this.a & 0xff;
        const hi = (this.a >> 8) & 0xff;
        this.a = (lo << 8) | hi;
        this.setZN(hi, false);
        break;
      }

      // ---- stack
      case 0x48: if (m) this.push16(this.a & 0xffff); else this.push8(this.a & 0xff); break;
      case 0x68: {
        if (m) this.a = this.pull16();
        else this.a = (this.a & 0xff00) | this.pull8();
        this.setZN(this.getA(), m);
        break;
      }
      case 0xda: if (i) this.push16(this.x); else this.push8(this.x); break;
      case 0xfa: this.setX(i ? this.pull16() : this.pull8()); this.setZN(this.x, i); break;
      case 0x5a: if (i) this.push16(this.y); else this.push8(this.y); break;
      case 0x7a: this.setY(i ? this.pull16() : this.pull8()); this.setZN(this.y, i); break;
      case 0x8b: this.push8(this.dbr); break;
      case 0xab: this.dbr = this.pull8(); this.setZN(this.dbr, false); break;
      case 0x0b: this.push16(this.d); break;
      case 0x2b: this.d = this.pull16(); this.setZN(this.d, true); break;
      case 0x08: this.push8(this.p); break;
      case 0x28: this.p = this.pull8(); break;

      // ---- branches
      case 0x90: this.branch((this.p & FLAG_C) === 0); break;
      case 0xb0: this.branch((this.p & FLAG_C) !== 0); break;
      case 0xf0: this.branch((this.p & FLAG_Z) !== 0); break;
      case 0xd0: this.branch((this.p & FLAG_Z) === 0); break;
      case 0x30: this.branch((this.p & FLAG_N) !== 0); break;
      case 0x10: this.branch((this.p & FLAG_N) === 0); break;
      case 0x80: this.branch(true); break;
      case 0x82: {
        const offset = this.fetch16();
        const signed = offset < 0x8000 ? offset : offset - 0x10000;
        this.pc = (this.pc + signed) & 0xffff;
        break;
      }

      // ---- jumps
      case 0x4c: this.pc = this.fetch16(); break;
      case 0x5c: {
        const target = this.fetch24();
        this.pc = target & 0xffff;
        this.pbr = (target >> 16) & 0xff;
        break;
      }
      case 0x20: {
        const target = this.fetch16();
        this.push16((this.pc - 1) & 0xffff);
        this.pc = target;
        break;
      }
      case 0x22: {
        const target = this.fetch24();
        this.push8(this.pbr);
        this.push16((this.pc - 1) & 0xffff);
        this.pbr = (target >> 16) & 0xff;
        this.pc = target & 0xffff;
        break;
      }
      case 0x60: this.pc = (this.pull16() + 1) & 0xffff; break;
      case 0x6b: {
        this.pc = (this.pull16() + 1) & 0xffff;
        this.pbr = this.pull8();
        break;
      }
      case 0x40: {
        this.p = this.pull8();
        this.pc = this.pull16();
        this.pbr = this.pull8();
        break;
      }

      default:
        throw new Error(
          `unimplemented opcode $${opcode.toString(16).padStart(2, "0")} at $${this.pbr
            .toString(16)
            .padStart(2, "0")}:${((this.pc - 1) & 0xffff).toString(16).padStart(4, "0")}`
        );
    }
  }
}
