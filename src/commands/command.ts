import { Packet } from '../packet';
import { Connection } from '../v2/connection';

export type CommandHandlePacketFn =
  | null
  | ((packet: Packet, connection: Connection) => CommandHandlePacketFn);

export type Command = {
  handlePacket: CommandHandlePacketFn;
  _commandName: string;
};
