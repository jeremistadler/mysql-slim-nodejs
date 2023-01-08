import { Packet } from '../packet'

const QUERY_COMMAND_CODE = 0x03

export class QueryPacket {
  constructor(public query: string) {}

  toPacket() {
    const buf = Buffer.from(this.query)
    const length = 5 + buf.length
    const buffer = Buffer.allocUnsafe(length)
    const packet = new Packet(0, buffer, 0, length)
    packet.offset = 4
    packet.writeInt8(QUERY_COMMAND_CODE)
    packet.writeBuffer(buf)
    return packet
  }
}
