// TODO: rename to OK packet
// https://dev.mysql.com/doc/internals/en/packet-OK_Packet.html

import { ALL_CLIENT_CONSTANTS } from '../constants/clientConstants';
import { Packet } from '../packet';
import { Connection } from '../v2/connection';

const SERVER_SESSION_STATE_CHANGED = 0x4000;
const SESSION_CHANGE_SYSTEM_VARIABLES = 0;
const SESSION_CHANGE_SCHEMA = 1;
const SESSION_CHANGE_STATE_CHANGE = 2;

export class ResultSetHeaderPacket {
  fieldCount: number;
  affectedRows: number | null = null;
  insertId: number | null = null;
  info: string = '';
  serverStatus: number = 0;
  warningStatus: number = 0;
  stateChanges: {
    systemVariables: {};
    schema: null | string;
    trackStateChange: null | string;
  } | null = null;
  changedRows: number = 0;

  constructor(packet: Packet, connection: Connection) {
    const encoding = connection.serverEncoding;
    const flags = connection.serverCapabilityFlags;

    const isSet = (flag: keyof typeof ALL_CLIENT_CONSTANTS) =>
      flags & ALL_CLIENT_CONSTANTS[flag];

    if (packet.buffer[packet.offset] !== 0) {
      this.fieldCount = packet.readLengthCodedNumber(false, false)!;
      if (this.fieldCount === null) {
        const inlineFilename = packet.readString(undefined, encoding);
        throw new Error('Inline files not supported ' + inlineFilename);
      }
      return;
    }

    this.fieldCount = packet.readInt8(); // skip OK byte
    this.affectedRows = packet.readLengthCodedNumber(false, false);
    this.insertId = packet.readLengthCodedNumberSigned(false);

    if (isSet('PROTOCOL_41')) {
      this.serverStatus = packet.readInt16();
      this.warningStatus = packet.readInt16();
    } else if (isSet('TRANSACTIONS')) {
      this.serverStatus = packet.readInt16();
    }

    let stateChanges = null;
    if (isSet('SESSION_TRACK') && packet.offset < packet.end) {
      this.info = packet.readLengthCodedString(encoding) || '';

      if (this.serverStatus && SERVER_SESSION_STATE_CHANGED) {
        // session change info record - see
        // https://dev.mysql.com/doc/internals/en/packet-OK_Packet.html#cs-sect-packet-ok-sessioninfo
        let len =
          packet.offset < packet.end
            ? packet.readLengthCodedNumber(false, false) || 0
            : 0;
        const end = packet.offset + len;
        let type, key, stateEnd;
        if (len > 0) {
          stateChanges = {
            systemVariables: {},
            schema: null,
            trackStateChange: null,
          };
        }
        while (packet.offset < end) {
          type = packet.readInt8();
          len = packet.readLengthCodedNumber(false, false) || 0;
          stateEnd = packet.offset + len;
          if (type === SESSION_CHANGE_SYSTEM_VARIABLES) {
            key = packet.readLengthCodedString(encoding);
            const val = packet.readLengthCodedString(encoding);
            (stateChanges!.systemVariables as any)[key as any] = val as any;
            if (key === 'character_set_client') {
              console.log('TODO ', 'character_set_client');
              //   const charsetNumber = EncodingToCharset[val];
              //   connection.config.charsetNumber = charsetNumber;
            }
          } else if (type === SESSION_CHANGE_SCHEMA) {
            key = packet.readLengthCodedString(encoding);
            stateChanges!.schema = key as any;
          } else if (type === SESSION_CHANGE_STATE_CHANGE) {
            stateChanges!.trackStateChange = packet.readLengthCodedString(
              encoding
            )! as any;
          } else {
            // unsupported session track type. For now just ignore
          }
          packet.offset = stateEnd;
        }
      }
    } else {
      this.info = packet.readString(undefined, encoding);
    }
    if (stateChanges) {
      this.stateChanges = stateChanges;
    }
    const m = this.info.match(/\schanged:\s*(\d+)/i);
    if (m !== null) {
      this.changedRows = parseInt(m[1], 10);
    }
  }
}
