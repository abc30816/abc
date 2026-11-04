export class BinaryReader {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array, readonly label = 'binary data') {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  private check(offset: number, size: number): void {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > this.bytes.byteLength) {
      throw new RangeError(`${this.label}: read outside file at ${offset} (${size} bytes; length ${this.bytes.byteLength})`);
    }
  }
  u8(offset: number): number { this.check(offset, 1); return this.view.getUint8(offset); }
  i16(offset: number): number { this.check(offset, 2); return this.view.getInt16(offset, true); }
  u16(offset: number): number { this.check(offset, 2); return this.view.getUint16(offset, true); }
  i32(offset: number): number { this.check(offset, 4); return this.view.getInt32(offset, true); }
  u32(offset: number): number { this.check(offset, 4); return this.view.getUint32(offset, true); }
  f32(offset: number): number { this.check(offset, 4); return this.view.getFloat32(offset, true); }
  ascii(offset: number, length: number): string {
    this.check(offset, length);
    const slice = this.bytes.subarray(offset, offset + length);
    const end = slice.indexOf(0);
    return new TextDecoder('latin1').decode(end >= 0 ? slice.subarray(0, end) : slice).trim();
  }
  slice(offset: number, length: number): Uint8Array { this.check(offset, length); return this.bytes.subarray(offset, offset + length); }
}

export function decodeText(bytes: Uint8Array): string {
  // Game config files are normally single-byte text; windows-1252 keeps comments readable.
  try { return new TextDecoder('windows-1252').decode(bytes); }
  catch { return new TextDecoder().decode(bytes); }
}
