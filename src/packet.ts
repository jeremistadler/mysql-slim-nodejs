// This file was modified by Oracle on June 1, 2021.
// A comment describing some changes in the strict default SQL mode regarding
// non-standard dates was introduced.
// Modifications copyright (c) 2021, Oracle and/or its affiliates.

import { ErrorCodeById } from './errorCodes';
import { MysqlError } from './MysqlError';
import { Buffer as NativeBuffer } from 'node:buffer';
import { decodeString, encodeString } from './stringParser';

const INVALID_DATE = new Date(NaN);

// this is nearly duplicate of previous function so generated code is not slower
// due to "if (dateStrings)" branching
const pad = '000000000000';
function leftPad(num: number, value: string) {
  // if we don't need to pad
  if (value.length >= num) {
    return value;
  }
  return (pad + value).slice(-num);
}

const TWO_PWR_16_DBL = 1 << 16;
const TWO_PWR_24_DBL = 1 << 24;
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

  readSInt8() {
    return this.buffer.readInt8(this.offset++);
  }

  readSInt16() {
    this.offset += 2;
    return this.buffer.readInt16LE(this.offset - 2);
  }

  readSInt32() {
    this.offset += 4;
    return this.buffer.readInt32LE(this.offset - 4);
  }

  readInt64JSNumber() {
    const word0 = this.readInt32();
    const word1 = this.readInt32();

    return (word1 >>> 0) * TWO_PWR_32_DBL + (word0 >>> 0);
  }

  readSInt64JSNumber() {
    const word0 = this.readInt32();
    const word1 = this.readInt32();
    if (!(word1 & 0x80000000)) {
      return word0 + 0x100000000 * word1;
    }

    return word1 * TWO_PWR_32_DBL + (word0 >>> 0);
  }

  readInt64String() {
    const word0 = this.readInt32();
    const word1 = this.readInt32();
    return ((word1 >>> 0) * TWO_PWR_32_DBL + (word0 >>> 0)).toString();
  }

  readSInt64String() {
    const word0 = this.readInt32();
    const word1 = this.readInt32();
    if (!(word1 & 0x80000000)) {
      return word0 + 0x100000000 * word1;
    }

    return (word1 * TWO_PWR_32_DBL + (word0 >>> 0)).toString();
  }

  readInt64() {
    const word0 = this.readInt32();
    const word1 = this.readInt32();
    return (word1 >>> 0) * TWO_PWR_32_DBL + (word0 >>> 0);
  }

  readSInt64() {
    const word0 = this.readInt32();
    const word1 = this.readInt32();
    return word1 * TWO_PWR_32_DBL + (word0 >>> 0);
  }

  isEOF() {
    return this.buffer[this.offset] === 0xfe && this.length() < 13;
  }

  eofStatusFlags() {
    return this.buffer.readInt16LE(this.offset + 3);
  }

  eofWarningCount() {
    return this.buffer.readInt16LE(this.offset + 1);
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
      res = new Long(word0, word1, !signed); // Long need unsigned
      const resNumber = res.toNumber();
      const resString = res.toString();
      res = resNumber.toString() === resString ? resNumber : resString;
      return bigNumberStrings ? resString : res;
    }
    // eslint-disable-next-line no-console
    console.trace();
    throw new Error(`Should not reach here: ${tag}`);
  }

  readFloat() {
    const res = this.buffer.readFloatLE(this.offset);
    this.offset += 4;
    return res;
  }

  readDouble() {
    const res = this.buffer.readDoubleLE(this.offset);
    this.offset += 8;
    return res;
  }

  readBuffer(len?: number): NativeBuffer {
    if (typeof len === 'undefined') {
      len = this.end - this.offset;
    }
    this.offset += len;
    return this.buffer.subarray(this.offset - len, this.offset);
  }

  // DATE, DATETIME and TIMESTAMP
  readDateTime(timezone: string): Date | null {
    if (!timezone || timezone === 'Z' || timezone === 'local') {
      const length = this.readInt8();
      if (length === 0xfb) {
        return null;
      }
      let y = 0;
      let m = 0;
      let d = 0;
      let H = 0;
      let M = 0;
      let S = 0;
      let ms = 0;
      if (length > 3) {
        y = this.readInt16();
        m = this.readInt8();
        d = this.readInt8();
      }
      if (length > 6) {
        H = this.readInt8();
        M = this.readInt8();
        S = this.readInt8();
      }
      if (length > 10) {
        ms = this.readInt32() / 1000;
      }
      // NO_ZERO_DATE mode and NO_ZERO_IN_DATE mode are part of the strict
      // default SQL mode used by MySQL 8.0. This means that non-standard
      // dates like '0000-00-00' become NULL. For older versions and other
      // possible MySQL flavours we still need to account for the
      // non-standard behaviour.
      if (y + m + d + H + M + S + ms === 0) {
        return INVALID_DATE;
      }
      if (timezone === 'Z') {
        return new Date(Date.UTC(y, m - 1, d, H, M, S, ms));
      }
      return new Date(y, m - 1, d, H, M, S, ms);
    }
    let str = this.readDateTimeString(6, 'T');
    if (str === undefined) return null;

    if (str.length === 10) {
      str += 'T00:00:00';
    }
    return new Date(str + timezone);
  }

  readDateTimeString(decimals: boolean, timeSep?: string) {
    const length = this.readInt8();
    let y = 0;
    let m = 0;
    let d = 0;
    let H = 0;
    let M = 0;
    let S = 0;
    let ms = 0;
    let str = '';
    if (length > 3) {
      y = this.readInt16();
      m = this.readInt8();
      d = this.readInt8();
      str = [
        leftPad(4, y.toString()),
        leftPad(2, m.toString()),
        leftPad(2, d.toString()),
      ].join('-');
    }
    if (length > 6) {
      H = this.readInt8();
      M = this.readInt8();
      S = this.readInt8();
      str += `${timeSep || ' '}${[
        leftPad(2, H.toString()),
        leftPad(2, M.toString()),
        leftPad(2, S.toString()),
      ].join(':')}`;
    }
    if (length > 10) {
      ms = this.readInt32();
      str += '.';
      if (decimals) {
        ms = leftPad(6, ms.toString());
        if (ms.length > decimals) {
          ms = ms.substring(0, decimals); // rounding is done at the MySQL side, only 0 are here
        }
      }
      str += ms;
    }
    return str;
  }

  // TIME - value as a string, Can be negative
  readTimeString(convertTtoMs: boolean) {
    const length = this.readInt8();
    if (length === 0) {
      return '00:00:00';
    }
    const sign = this.readInt8() ? -1 : 1; // 'isNegative' flag byte
    let d = 0;
    let H = 0;
    let M = 0;
    let S = 0;
    let ms = 0;
    if (length > 6) {
      d = this.readInt32();
      H = this.readInt8();
      M = this.readInt8();
      S = this.readInt8();
    }
    if (length > 10) {
      ms = this.readInt32();
    }
    if (convertTtoMs) {
      H += d * 24;
      M += H * 60;
      S += M * 60;
      ms += S * 1000;
      ms *= sign;
      return ms;
    }
    // Format follows mySQL TIME format ([-][h]hh:mm:ss[.u[u[u[u[u[u]]]]]])
    // For positive times below 24 hours, this makes it equal to ISO 8601 times
    return (
      (sign === -1 ? '-' : '') +
      [
        leftPad(2, (d * 24 + H).toString()),
        leftPad(2, M.toString()),
        leftPad(2, S.toString()),
      ].join(':') +
      (ms ? `.${ms}`.replace(/0+$/, '') : '')
    );
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

  readLengthCodedBuffer() {
    const len = this.readLengthCodedNumber(false, false);
    if (len === null) {
      return null;
    }
    return this.readBuffer(len);
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

  parseInt(len: number | null, supportBigNumbers: boolean) {
    if (len === null) {
      return null;
    }
    if (len >= 14 && !supportBigNumbers) {
      const s = this.buffer.toString('ascii', this.offset, this.offset + len);
      this.offset += len;
      return Number(s);
    }
    let result = 0;
    const start = this.offset;
    const end = this.offset + len;
    let sign = 1;
    if (len === 0) {
      return 0; // TODO: assert? exception?
    }
    if (this.buffer[this.offset] === minus) {
      this.offset++;
      sign = -1;
    }
    // max precise int is 9007199254740992
    let str;
    const numDigits = end - this.offset;
    if (supportBigNumbers) {
      if (numDigits >= 15) {
        str = this.readString(end - this.offset, 'binary');
        result = parseInt(str, 10);
        if (result.toString() === str) {
          return sign * result;
        }
        return sign === -1 ? `-${str}` : str;
      }
      if (numDigits > 16) {
        str = this.readString(end - this.offset);
        return sign === -1 ? `-${str}` : str;
      }
    }
    if (this.buffer[this.offset] === plus) {
      this.offset++; // just ignore
    }
    while (this.offset < end) {
      result *= 10;
      result += this.buffer[this.offset] - 48;
      this.offset++;
    }
    const num = result * sign;
    if (!supportBigNumbers) {
      return num;
    }
    str = this.buffer.toString('ascii', start, end);
    if (num.toString() === str) {
      return num;
    }
    return str;
  }

  // note that if value of inputNumberAsString is bigger than MAX_SAFE_INTEGER
  // ( or smaller than MIN_SAFE_INTEGER ) the parseIntNoBigCheck result might be
  // different from what you would get from Number(inputNumberAsString)
  // String(parseIntNoBigCheck) <> String(Number(inputNumberAsString)) <> inputNumberAsString
  parseIntNoBigCheck(len: number) {
    if (len === null) {
      return null;
    }
    let result = 0;
    const end = this.offset + len;
    let sign = 1;
    if (len === 0) {
      return 0; // TODO: assert? exception?
    }
    if (this.buffer[this.offset] === minus) {
      this.offset++;
      sign = -1;
    }
    if (this.buffer[this.offset] === plus) {
      this.offset++; // just ignore
    }
    while (this.offset < end) {
      result *= 10;
      result += this.buffer[this.offset] - 48;
      this.offset++;
    }
    return result * sign;
  }

  // copy-paste from https://github.com/mysqljs/mysql/blob/master/lib/protocol/Parser.js
  parseGeometryValue() {
    const buffer = this.readLengthCodedBuffer();
    let offset = 4;
    if (buffer === null || !buffer.length) {
      return null;
    }
    function parseGeometry() {
      let x, y, i, j, numPoints, line;
      let result = null;
      const byteOrder = buffer.readUInt8(offset);
      offset += 1;
      const wkbType = byteOrder
        ? buffer.readUInt32LE(offset)
        : buffer.readUInt32BE(offset);
      offset += 4;
      switch (wkbType) {
        case 1: // WKBPoint
          x = byteOrder
            ? buffer.readDoubleLE(offset)
            : buffer.readDoubleBE(offset);
          offset += 8;
          y = byteOrder
            ? buffer.readDoubleLE(offset)
            : buffer.readDoubleBE(offset);
          offset += 8;
          result = { x: x, y: y };
          break;
        case 2: // WKBLineString
          numPoints = byteOrder
            ? buffer.readUInt32LE(offset)
            : buffer.readUInt32BE(offset);
          offset += 4;
          result = [];
          for (i = numPoints; i > 0; i--) {
            x = byteOrder
              ? buffer.readDoubleLE(offset)
              : buffer.readDoubleBE(offset);
            offset += 8;
            y = byteOrder
              ? buffer.readDoubleLE(offset)
              : buffer.readDoubleBE(offset);
            offset += 8;
            result.push({ x: x, y: y });
          }
          break;
        case 3: // WKBPolygon
          // eslint-disable-next-line no-case-declarations
          const numRings = byteOrder
            ? buffer.readUInt32LE(offset)
            : buffer.readUInt32BE(offset);
          offset += 4;
          result = [];
          for (i = numRings; i > 0; i--) {
            numPoints = byteOrder
              ? buffer.readUInt32LE(offset)
              : buffer.readUInt32BE(offset);
            offset += 4;
            line = [];
            for (j = numPoints; j > 0; j--) {
              x = byteOrder
                ? buffer.readDoubleLE(offset)
                : buffer.readDoubleBE(offset);
              offset += 8;
              y = byteOrder
                ? buffer.readDoubleLE(offset)
                : buffer.readDoubleBE(offset);
              offset += 8;
              line.push({ x: x, y: y });
            }
            result.push(line);
          }
          break;
        case 4: // WKBMultiPoint
        case 5: // WKBMultiLineString
        case 6: // WKBMultiPolygon
        case 7: // WKBGeometryCollection
          // eslint-disable-next-line no-case-declarations
          const num = byteOrder
            ? buffer.readUInt32LE(offset)
            : buffer.readUInt32BE(offset);
          offset += 4;
          result = [];
          for (i = num; i > 0; i--) {
            result.push(parseGeometry());
          }
          break;
      }
      return result;
    }
    return parseGeometry();
  }

  parseDate(timezone) {
    const strLen = this.readLengthCodedNumber(false, false);
    if (strLen === null) {
      return null;
    }
    if (strLen !== 10) {
      // we expect only YYYY-MM-DD here.
      // if for some reason it's not the case return invalid date
      return new Date(NaN);
    }
    const y = this.parseInt(4);
    this.offset++; // -
    const m = this.parseInt(2);
    this.offset++; // -
    const d = this.parseInt(2);
    if (!timezone || timezone === 'local') {
      return new Date(y, m - 1, d);
    }
    if (timezone === 'Z') {
      return new Date(Date.UTC(y, m - 1, d));
    }
    return new Date(
      `${leftPad(4, y)}-${leftPad(2, m)}-${leftPad(2, d)}T00:00:00${timezone}`
    );
  }

  parseDateTime(timezone) {
    const str = this.readLengthCodedString('binary');
    if (str === null) {
      return null;
    }
    if (!timezone || timezone === 'local') {
      return new Date(str);
    }
    return new Date(`${str}${timezone}`);
  }

  parseFloat(len) {
    if (len === null) {
      return null;
    }
    let result = 0;
    const end = this.offset + len;
    let factor = 1;
    let pastDot = false;
    let charCode = 0;
    if (len === 0) {
      return 0; // TODO: assert? exception?
    }
    if (this.buffer[this.offset] === minus) {
      this.offset++;
      factor = -1;
    }
    if (this.buffer[this.offset] === plus) {
      this.offset++; // just ignore
    }
    while (this.offset < end) {
      charCode = this.buffer[this.offset];
      if (charCode === dot) {
        pastDot = true;
        this.offset++;
      } else if (charCode === exponent || charCode === exponentCapital) {
        this.offset++;
        const exponentValue = this.parseInt(end - this.offset, false);
        return (result / factor) * Math.pow(10, exponentValue);
      } else {
        result *= 10;
        result += this.buffer[this.offset] - 48;
        this.offset++;
        if (pastDot) {
          factor = factor * 10;
        }
      }
    }
    return result / factor;
  }

  parseLengthCodedIntNoBigCheck() {
    return this.parseIntNoBigCheck(this.readLengthCodedNumber(false, false));
  }

  parseLengthCodedInt(supportBigNumbers: boolean) {
    return this.parseInt(
      this.readLengthCodedNumber(false, false),
      supportBigNumbers
    );
  }

  parseLengthCodedIntString() {
    return this.readLengthCodedString('binary');
  }

  parseLengthCodedFloat() {
    return this.parseFloat(this.readLengthCodedNumber(false, false));
  }

  peekByte() {
    return this.buffer[this.offset];
  }

  // OxFE is often used as "Alt" flag - not ok, not error.
  // For example, it's first byte of AuthSwitchRequest
  isAlt() {
    return this.peekByte() === 0xfe;
  }

  isError() {
    return this.peekByte() === 0xff;
  }

  asError(encoding: string) {
    this.reset();
    this.readInt8(); // fieldCount
    const errorCode = this.readInt16();
    let sqlState = '';
    if (this.buffer[this.offset] === 0x23) {
      this.skip(1);
      sqlState = this.readBuffer(5).toString();
    }
    const message = this.readString(undefined, encoding);
    const err = new MysqlError(message, ErrorCodeById[errorCode], false);
    err.errno = errorCode;
    err.sqlState = sqlState;
    err.sqlMessage = message;
    return err;
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

  writeDouble(n: number) {
    this.buffer.writeDoubleLE(n, this.offset);
    this.offset += 8;
  }

  writeBuffer(b: Buffer) {
    b.copy(this.buffer, this.offset);
    this.offset += b.length;
  }

  writeNull() {
    this.buffer[this.offset] = 0xfb;
    this.offset++;
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

  writeDate(d: Date, timezone: string) {
    this.buffer.writeUInt8(11, this.offset);
    if (!timezone || timezone === 'local') {
      this.buffer.writeUInt16LE(d.getFullYear(), this.offset + 1);
      this.buffer.writeUInt8(d.getMonth() + 1, this.offset + 3);
      this.buffer.writeUInt8(d.getDate(), this.offset + 4);
      this.buffer.writeUInt8(d.getHours(), this.offset + 5);
      this.buffer.writeUInt8(d.getMinutes(), this.offset + 6);
      this.buffer.writeUInt8(d.getSeconds(), this.offset + 7);
      this.buffer.writeUInt32LE(d.getMilliseconds() * 1000, this.offset + 8);
    } else {
      if (timezone !== 'Z') {
        const offset =
          (timezone[0] === '-' ? -1 : 1) *
          (parseInt(timezone.substring(1, 3), 10) * 60 +
            parseInt(timezone.substring(4), 10));
        if (offset !== 0) {
          d = new Date(d.getTime() + 60000 * offset);
        }
      }
      this.buffer.writeUInt16LE(d.getUTCFullYear(), this.offset + 1);
      this.buffer.writeUInt8(d.getUTCMonth() + 1, this.offset + 3);
      this.buffer.writeUInt8(d.getUTCDate(), this.offset + 4);
      this.buffer.writeUInt8(d.getUTCHours(), this.offset + 5);
      this.buffer.writeUInt8(d.getUTCMinutes(), this.offset + 6);
      this.buffer.writeUInt8(d.getUTCSeconds(), this.offset + 7);
      this.buffer.writeUInt32LE(d.getUTCMilliseconds() * 1000, this.offset + 8);
    }
    this.offset += 12;
  }

  writeHeader(sequenceId: number) {
    const offset = this.offset;
    this.offset = 0;
    this.writeInt24(this.buffer.length - 4);
    this.writeInt8(sequenceId);
    this.offset = offset;
  }

  clone() {
    return new Packet(this.sequenceId, this.buffer, this.start, this.end);
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