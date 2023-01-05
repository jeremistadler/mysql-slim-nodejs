// This file was modified by Oracle on June 1, 2021.
// A comment describing some changes in the strict default SQL mode regarding
// non-standard dates was introduced.
// Modifications copyright (c) 2021, Oracle and/or its affiliates.

import { ErrorCodeById } from './errorCodes';
import { MysqlError } from './MysqlError';
import { Buffer as NativeBuffer } from 'node:buffer';
import { decodeString, encodeString } from './stringParser';

const TWO_PWR_16_DBL = 1 << 16;
const TWO_PWR_32_DBL = TWO_PWR_16_DBL * TWO_PWR_16_DBL;

// The whole reason parse* function below exist
// is because String creation is relatively expensive (at least with V8), and if we have
// a buffer with "12345" content ideally we would like to bypass intermediate
// "12345" string creation and directly build 12345 number out of
// <Buffer 31 32 33 34 35> data.
// In my benchmarks the difference is ~25M 8-digit numbers per second vs
// 4.5 M using Number(packet.readLengthCodedString())
// not used when size is close to max precision as series of *10 accumulate error
// and approximate result mihgt be diffreent from (approximate as well) Number(bigNumStringValue))
// In the futire node version if speed difference is smaller parse* functions might be removed
// don't consider them as Packet public API

const minus = '-'.charCodeAt(0);
const plus = '+'.charCodeAt(0);

// TODO: handle E notation
const dot = '.'.charCodeAt(0);
const exponent = 'e'.charCodeAt(0);
const exponentCapital = 'E'.charCodeAt(0);

export class Packet {
  sequenceId: number;
  numPackets: number;
  buffer: Buffer;
  start: number;
  offset: number;
  end: number;
  _name: string;

  constructor(id: number, buffer: Buffer, start: number, end: number) {
    // hot path, enable checks when testing only
    // if (!Buffer.isBuffer(buffer) || typeof start == 'undefined' || typeof end == 'undefined')
    //  throw new Error('invalid packet');
    this.sequenceId = id;
    this.numPackets = 1;
    this.buffer = buffer;
    this.start = start;
    this.offset = start + 4;
    this.end = end;
    this._name = '';
  }

  // ==============================
  // readers
  // ==============================
  reset() {
    this.offset = this.start + 4;
  }

  length() {
    return this.end - this.start;
  }

  slice() {
    return this.buffer.slice(this.start, this.end);
  }

  dump() {
    // eslint-disable-next-line no-console
    console.log(
      this.buffer.subarray(this.start, this.end),
      this.length(),
      this.sequenceId
    );
  }

  haveMoreData() {
    return this.end > this.offset;
  }

  skip(num: number) {
    this.offset += num;
  }

  readInt8() {
    return this.buffer[this.offset++];
  }

  readInt16() {
    this.offset += 2;
    return this.buffer.readUInt16LE(this.offset - 2);
  }

  readInt24() {
    return this.readInt16() + (this.readInt8() << 16);
  }

  readInt32() {
    this.offset += 4;
    return this.buffer.readUInt32LE(this.offset - 4);
  }

  isEOF() {
    return this.buffer[this.offset] === 0xfe && this.length() < 13;
  }

  eofStatusFlags() {
    return this.buffer.readInt16LE(this.offset + 3);
  }

  readLengthCodedNumber(bigNumberStrings: boolean, signed: boolean) {
    const byte1 = this.buffer[this.offset++];
    if (byte1 < 251) {
      return byte1;
    }
    return this.readLengthCodedNumberExt(byte1, bigNumberStrings, signed);
  }

  readLengthCodedNumberSigned(bigNumberStrings: boolean) {
    return this.readLengthCodedNumber(bigNumberStrings, true);
  }

  readLengthCodedNumberExt(
    tag: number,
    bigNumberStrings: boolean,
    signed: boolean
  ): number | null {
    let word0, word1;
    let res;

    if (tag === 0xfb) {
      return null;
    }

    if (tag === 0xfc) {
      return this.readInt8() + (this.readInt8() << 8);
    }
    if (tag === 0xfd) {
      return this.readInt8() + (this.readInt8() << 8) + (this.readInt8() << 16);
    }
    if (tag === 0xfe) {
      // TODO: check version
      // Up to MySQL 3.22, 0xfe was followed by a 4-byte integer.
      word0 = this.readInt32();
      word1 = this.readInt32();
      if (word1 === 0) {
        return word0; // don't convert to float if possible
      }
      if (word1 < 2097152) {
        // max exact float point int, 2^52 / 2^32
        return word1 * 0x100000000 + word0;
      }
      // res = new Long(word0, word1, !signed); // Long need unsigned
      // const resNumber = res.toNumber();
      // const resString = res.toString();
      // res = resNumber.toString() === resString ? resNumber : resString;
      // return bigNumberStrings ? resString : res;
    }
    // eslint-disable-next-line no-console
    console.trace();
    throw new Error(`Should not reach here: ${tag}`);
  }

  readBuffer(len?: number): NativeBuffer {
    if (typeof len === 'undefined') {
      len = this.end - this.offset;
    }
    this.offset += len;
    return this.buffer.subarray(this.offset - len, this.offset);
  }

  readLengthCodedString(encoding: string): string | null {
    const len = this.readLengthCodedNumber(false, false);
    // TODO: check manually first byte here to avoid polymorphic return type?
    if (len === null) {
      return null;
    }
    this.offset += len;
    // TODO: Use characterSetCode to get proper encoding
    // https://github.com/sidorares/node-mysql2/pull/374
    return decodeString(this.buffer, encoding, this.offset - len, this.offset);
  }

  readNullTerminatedString(encoding: string): string {
    const start = this.offset;
    let end = this.offset;
    while (this.buffer[end]) {
      end = end + 1; // TODO: handle OOB check
    }
    this.offset = end + 1;
    return decodeString(this.buffer, encoding, start, end);
  }

  // TODO reuse?
  readString(len: number | undefined, encoding: string): string {
    // if (typeof len === 'string' && typeof encoding === 'undefined') {
    //   encoding = len;
    //   len = undefined;
    // }
    if (typeof len === 'undefined') {
      len = this.end - this.offset;
    }
    this.offset += len;
    return decodeString(this.buffer, encoding, this.offset - len, this.offset);
  }

  peekByte() {
    return this.buffer[this.offset];
  }

  isError() {
    return this.peekByte() === 0xff;
  }

  writeInt32(n: number) {
    this.buffer.writeUInt32LE(n, this.offset);
    this.offset += 4;
  }

  writeInt24(n: number) {
    this.writeInt8(n & 0xff);
    this.writeInt16(n >> 8);
  }

  writeInt16(n: number) {
    this.buffer.writeUInt16LE(n, this.offset);
    this.offset += 2;
  }

  writeInt8(n: number) {
    this.buffer.writeUInt8(n, this.offset);
    this.offset++;
  }

  writeBuffer(b: Buffer) {
    b.copy(this.buffer, this.offset);
    this.offset += b.length;
  }

  // TODO: refactor following three?
  writeNullTerminatedString(s: string, encoding: string) {
    const buf = encodeString(s, encoding);
    this.buffer.length && buf.copy(this.buffer, this.offset);
    this.offset += buf.length;
    this.writeInt8(0);
  }

  writeString(s: string, encoding: string) {
    if (s === null) {
      this.writeInt8(0xfb);
      return;
    }
    if (s.length === 0) {
      return;
    }
    // const bytes = Buffer.byteLength(s, 'utf8');
    // this.buffer.write(s, this.offset, bytes, 'utf8');
    // this.offset += bytes;
    const buf = encodeString(s, encoding);
    this.buffer.length && buf.copy(this.buffer, this.offset);
    this.offset += buf.length;
  }

  writeLengthCodedString(s: string, encoding: string) {
    const buf = encodeString(s, encoding);
    this.writeLengthCodedNumber(buf.length);
    this.buffer.length && buf.copy(this.buffer, this.offset);
    this.offset += buf.length;
  }

  writeLengthCodedBuffer(b: Buffer) {
    this.writeLengthCodedNumber(b.length);
    b.copy(this.buffer, this.offset);
    this.offset += b.length;
  }

  writeLengthCodedNumber(n: number) {
    if (n < 0xfb) {
      return this.writeInt8(n);
    }
    if (n < 0xffff) {
      this.writeInt8(0xfc);
      return this.writeInt16(n);
    }
    if (n < 0xffffff) {
      this.writeInt8(0xfd);
      return this.writeInt24(n);
    }
    if (n === null) {
      return this.writeInt8(0xfb);
    }
    // TODO: check that n is out of int precision
    this.writeInt8(0xfe);
    this.buffer.writeUInt32LE(n, this.offset);
    this.offset += 4;
    this.buffer.writeUInt32LE(n >> 32, this.offset);
    this.offset += 4;
    return this.offset;
  }

  writeHeader(sequenceId: number) {
    const offset = this.offset;
    this.offset = 0;
    this.writeInt24(this.buffer.length - 4);
    this.writeInt8(sequenceId);
    this.offset = offset;
  }

  type() {
    if (this.isEOF()) {
      return 'EOF';
    }
    if (this.isError()) {
      return 'Error';
    }
    if (this.buffer[this.offset] === 0) {
      return 'maybeOK'; // could be other packet types as well
    }
    return '';
  }

  static lengthCodedNumberLength(n: number) {
    if (n < 0xfb) {
      return 1;
    }
    if (n < 0xffff) {
      return 3;
    }
    if (n < 0xffffff) {
      return 5;
    }
    return 9;
  }

  static lengthCodedStringLength(str: string, encoding: string) {
    const buf = encodeString(str, encoding);
    const slen = buf.length;
    return Packet.lengthCodedNumberLength(slen) + slen;
  }

  static MockBuffer() {
    const noop = function () {};
    const res = Buffer.alloc(0);
    for (const op in NativeBuffer.prototype) {
      if (typeof res[op as any] === 'function') {
        res[op as any] = noop as any;
      }
    }
    return res;
  }
}
