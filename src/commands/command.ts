import { Conn } from '../ConnectionType'
import { Packet } from '../packet'

export type CommandHandlePacketFn = null | {
  name: string
  fn: (packet: Packet, connection: Conn) => CommandHandlePacketFn
}

export type Command = {
  handlePacket: CommandHandlePacketFn
  _commandName: string
}
