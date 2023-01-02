import { ErrorCodeById } from '../errorCodes';
import { MysqlError } from '../MysqlError';
import { Packet } from '../packet';

export class ErrorPacket {
  static toPacket(args: { message: string; code: number }, encoding: string) {
    const length = 13 + Buffer.byteLength(args.message, 'utf8');
    const packet = new Packet(0, Buffer.allocUnsafe(length), 0, length);
    packet.offset = 4;
    packet.writeInt8(0xff);
    packet.writeInt16(args.code);
    // TODO: sql state parameter
    packet.writeString('#_____', encoding);
    packet.writeString(args.message, encoding);
    packet._name = 'Error';
    return packet;
  }

  static fromPacket(packet: Packet) {
    packet.readInt8(); // marker
    const code = packet.readInt16();
    packet.readString(1, 'ascii'); // sql state marker
    // The SQL state of the ERR_Packet which is always 5 bytes long.
    // https://dev.mysql.com/doc/dev/mysql-server/8.0.11/page_protocol_basic_dt_strings.html#sect_protocol_basic_dt_string_fix
    packet.readString(5, 'ascii'); // sql state (ignore for now)
    const message = packet.readNullTerminatedString('utf8');
    return new MysqlError(message, ErrorCodeById[code], true);
  }
}
