import { Packet } from '../packet';
import { Conn } from '../v2/connection';

export type CommandHandlePacketFn = null | {
  name: string;
  fn: (packet: Packet, connection: Conn) => CommandHandlePacketFn;
};

export type Command = {
  handlePacket: CommandHandlePacketFn;
  _commandName: string;
};
