import { Packet } from '../packet';

// http://dev.mysql.com/doc/internals/en/connection-phase-packets.html#packet-Protocol::AuthSwitchRequest

export class AuthSwitchResponsePacket {
  constructor(public data: Buffer) {}

  toPacket() {
    const length = 4 + this.data.length;
    const buffer = Buffer.allocUnsafe(length);
    const packet = new Packet(0, buffer, 0, length);
    packet.offset = 4;
    packet.writeBuffer(this.data);
    return packet;
  }

  static fromPacket(packet: Packet) {
    const data = packet.readBuffer();
    return new AuthSwitchResponsePacket(data);
  }
}
