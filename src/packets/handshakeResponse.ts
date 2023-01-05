import { calculateToken } from '../auth41';
import { ALL_CLIENT_CONSTANTS } from '../constants/clientConstants';
import { Packet } from '../packet';

export class HandshakeResponse {
  user: string;
  database: string;
  password: string;
  authPluginData1: Buffer;
  authPluginData2: Buffer;
  compress: boolean;
  clientFlags: number;
  authToken: Buffer;
  charsetNumber: number;
  encoding: string;
  connectAttributes: any;

  constructor(handshake: {
    flags: number;
    user: string;
    database: string;
    password: string;
    charsetNumber: number;
    authPluginData1: Buffer;
    authPluginData2: Buffer;
    compress: boolean;
    connectAttributes: {};
  }) {
    this.user = handshake.user || '';
    this.database = handshake.database || '';
    this.password = handshake.password || '';
    this.authPluginData1 = handshake.authPluginData1;
    this.authPluginData2 = handshake.authPluginData2;
    this.compress = handshake.compress;
    this.clientFlags = handshake.flags;

    this.authToken = calculateToken(
      this.password,
      this.authPluginData1,
      this.authPluginData2
    );
    this.charsetNumber = handshake.charsetNumber;
    this.encoding = 'utf8'; // CharsetToEncoding[handshake.charsetNumber];
    this.connectAttributes = handshake.connectAttributes;
  }

  serializeResponse(buffer: Buffer) {
    const isSet = (flag: keyof typeof ALL_CLIENT_CONSTANTS) =>
      this.clientFlags & ALL_CLIENT_CONSTANTS[flag];

    const packet = new Packet(0, buffer, 0, buffer.length);
    packet.offset = 4;
    packet.writeInt32(this.clientFlags);
    packet.writeInt32(0); // max packet size. todo: move to config
    packet.writeInt8(this.charsetNumber);
    packet.skip(23);
    const encoding = this.encoding;
    packet.writeNullTerminatedString(this.user, encoding);
    let k;

    if (isSet('PLUGIN_AUTH_LENENC_CLIENT_DATA')) {
      packet.writeLengthCodedNumber(this.authToken.length);
      packet.writeBuffer(this.authToken);
    } else if (isSet('SECURE_CONNECTION')) {
      packet.writeInt8(this.authToken.length);
      packet.writeBuffer(this.authToken);
    } else {
      packet.writeBuffer(this.authToken);
      packet.writeInt8(0);
    }

    if (isSet('CONNECT_WITH_DB')) {
      packet.writeNullTerminatedString(this.database, encoding);
    }
    if (isSet('PLUGIN_AUTH')) {
      // TODO: pass from config
      packet.writeNullTerminatedString('mysql_native_password', 'latin1');
    }

    if (isSet('CONNECT_ATTRS')) {
      const connectAttributes = this.connectAttributes || {};
      const attrNames = Object.keys(connectAttributes);
      let keysLength = 0;
      for (k = 0; k < attrNames.length; ++k) {
        keysLength += Packet.lengthCodedStringLength(attrNames[k], encoding);
        keysLength += Packet.lengthCodedStringLength(
          connectAttributes[attrNames[k]],
          encoding
        );
      }
      packet.writeLengthCodedNumber(keysLength);
      for (k = 0; k < attrNames.length; ++k) {
        packet.writeLengthCodedString(attrNames[k], encoding);
        packet.writeLengthCodedString(
          connectAttributes[attrNames[k]],
          encoding
        );
      }
    }

    return packet;
  }

  toPacket() {
    if (typeof this.user !== 'string') {
      throw new Error('"user" connection config property must be a string');
    }
    if (typeof this.database !== 'string') {
      throw new Error('"database" connection config property must be a string');
    }
    // dry run: calculate resulting packet length
    const p = this.serializeResponse(Packet.MockBuffer());
    return this.serializeResponse(Buffer.alloc(p.offset));
  }
}
