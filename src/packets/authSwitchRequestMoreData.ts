// http://dev.mysql.com/doc/internals/en/connection-phase-packets.html#packet-Protocol::AuthSwitchRequest

import { Packet } from '../packet';

export class AuthSwitchRequestMoreDataPacket {
  constructor(public data: Buffer) {}

  static fromPacket(packet: Packet) {
    packet.readInt8(); // marker
    const data = packet.readBuffer();
    return new AuthSwitchRequestMoreDataPacket(data);
  }

  static verifyMarker(packet: Packet) {
    return packet.peekByte() === 0x01;
  }
}
