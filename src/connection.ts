import { connect, Socket } from 'node:net';
import { ClientHandshake } from './commands/ClientHandshakeCommand';
import { Command } from './commands/command';
import { FOUND_ROWS } from './constants/clientConstants';
import { MysqlError } from './MysqlError';
import { Packet } from './packet';
import { PacketParser } from './PacketParser';

type TcpConnectionProps = Readonly<{
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
  debug: boolean;
}>;

export class MysqlConnection {
  private socket: Socket;
  private isClosing = false;

  private connectTimeout: NodeJS.Timeout | null = null;

  private sequenceId = 0;
  private compressedSequenceId = 0;

  private parser: PacketParser;

  private ongoingCommand: null | Command = null;
  private queuedCommands: Command[] = [];

  public clientEncoding = 'utf8';
  public connectionId: number = 0;
  public serverEncoding: string = 'utf8';
  public serverCapabilityFlags: number = 0;

  constructor(public readonly config: TcpConnectionProps) {
    this.parser = new PacketParser(this.onPacket, 4);

    this.socket = connect(config.port, config.host);

    this.socket.on('connect', this.onSocketConnected);
    this.socket.on('error', this.onSocketError);
    this.socket.on('data', this.onSocketData);
    this.socket.on('close', this.onSocketClosed);

    this.connectTimeout = setTimeout(() => {
      this.isClosing = true;
      this.socket.end();
    }, 5000);

    this.ongoingCommand = null;
  }

  private bumpSequenceId(numPackets: number) {
    this.sequenceId += numPackets;
    this.sequenceId %= 256;
  }

  public _resetSequenceId() {
    this.sequenceId = 0;
    this.compressedSequenceId = 0;
  }

  private protocolError(message: string, code: string) {
    // // Starting with MySQL 8.0.24, if the client closes the connection
    // // unexpectedly, the server will send a last ERR Packet, which we can
    // // safely ignore.
    // // https://dev.mysql.com/worklog/task/?id=12999
    // if (this.state === 'closed') {
    //   return;
    // }

    const err = new MysqlError(message, code || 'PROTOCOL_ERROR', true);
    // this.emit('error', err);
    console.error(err);
  }

  private onPacket = (packet: Packet) => {
    console.log(
      ` raw: ${packet.buffer
        .subarray(packet.offset, packet.offset + packet.length())
        .toString('hex')}`
    );

    if (this.sequenceId !== packet.sequenceId) {
      const err = new Error(
        `Warning: got packets out of order. Expected ${this.sequenceId} but received ${packet.sequenceId}`
      );
      // err.expected = this.sequenceId;
      // err.received = packet.sequenceId;
      // this.emit('warn', err); // REVIEW
      console.error(err.message);
    }

    if (!this.ongoingCommand) {
      const marker = packet.peekByte();
      // If it's an Err Packet, we should use it.
      if (marker === 0xff) {
        const error = ErrorPacket.fromPacket(packet);
        this.protocolError(error.message, error.code);
      } else {
        // Otherwise, it means it's some other unexpected packet.
        this.protocolError(
          'Unexpected packet while no commands in the queue',
          'PROTOCOL_UNEXPECTED_PACKET'
        );
      }
      this.close();
      return;
    }
    this.ongoingCommand.next?.(packet, this);
    this.ongoingCommand = this.queuedCommands.shift() ?? null;
    if (this.ongoingCommand) {
      this.sequenceId = 0;
      this.compressedSequenceId = 0;
      this.handlePacket(null);
    }
  };

  private onSocketConnected = () => {
    console.log('Connected...');

    this.ongoingCommand = new ClientHandshake(FOUND_ROWS);
  };

  private onSocketError = (err: Error) => {
    console.error(err);
  };

  private onSocketData = (data: Buffer) => {
    // if (this.state === 'closed') return;

    this.parser.execute(data);
  };

  private onSocketClosed = () => {
    console.log('Closed');
  };

  private getSocketState = () => {
    if (this.socket.closed) return 'disconnected';
    if (this.socket.connecting) return 'connecting';
    return 'connected';
  };

  public connect = (): Promise<void> => {
    if (this.getSocketState() === 'connected') return Promise.resolve();

    return new Promise((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('error', reject);
    });
  };

  _handleFatalError(err: MysqlError) {
    err.isFatal = true;
    // // stop receiving packets
    // this.stream.removeAllListeners('data');
    // this.addCommand = this._addCommandClosedState;
    // this.write = () => {
    //   this.emit('error', new Error("Can't write in closed state"));
    // };
    // this._notifyError(err);
    // this._fatalError = err;
  }

  _handleNetworkError(err: MysqlError) {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
    // Do not throw an error when a connection ends with a RST,ACK packet
    if (err.code === 'ECONNRESET' && this.isClosing) {
      return;
    }
    this._handleFatalError(err);
  }

  public close = () => {
    this.isClosing = true;
    console.log('Closing...');

    return new Promise<void>((resolve) => {
      this.socket.end(() => {
        resolve();
      });
    });
  };

  private write(buffer: Buffer) {
    this.socket.write(buffer, (err) => {
      if (err) {
        this._handleNetworkError(err as any);
      }
    });
  }

  writePacket(packet: Packet) {
    const MAX_PACKET_LENGTH = 16777215;
    const length = packet.length();
    let chunk, offset, header;
    if (length < MAX_PACKET_LENGTH) {
      packet.writeHeader(this.sequenceId);
      if (this.config.debug) {
        console.log(
          `${this.connectionId} <== ${
            this.ongoingCommand!._commandName
          }#${this.ongoingCommand!.stateName()}(${[
            this.sequenceId,
            packet._name,
            packet.length(),
          ].join(',')})`
        );
        console.log(
          `${this.connectionId} <== ${packet.buffer.toString('hex')}`
        );
      }
      this.bumpSequenceId(1);
      this.write(packet.buffer);
    } else {
      if (this.config.debug) {
        // eslint-disable-next-line no-console
        console.log(
          `${this.connectionId} <== Writing large packet, raw content not written:`
        );
        // eslint-disable-next-line no-console
        console.log(
          `${this.connectionId} <== ${
            this.ongoingCommand!._commandName
          }#${this.ongoingCommand!.stateName()}(${[
            this.sequenceId,
            packet._name,
            packet.length(),
          ].join(',')})`
        );
      }
      for (offset = 4; offset < 4 + length; offset += MAX_PACKET_LENGTH) {
        chunk = packet.buffer.slice(offset, offset + MAX_PACKET_LENGTH);
        if (chunk.length === MAX_PACKET_LENGTH) {
          header = Buffer.from([0xff, 0xff, 0xff, this.sequenceId]);
        } else {
          header = Buffer.from([
            chunk.length & 0xff,
            (chunk.length >> 8) & 0xff,
            (chunk.length >> 16) & 0xff,
            this.sequenceId,
          ]);
        }
        this.bumpSequenceId(1);
        this.write(header);
        this.write(chunk);
      }
    }
  }

  handlePacket(packet: Packet | null) {
    if (packet) {
      if (this.sequenceId !== packet.sequenceId) {
        const err = new Error(
          `Warning: got packets out of order. Expected ${this.sequenceId} but received ${packet.sequenceId}`
        );
        err.expected = this.sequenceId;
        err.received = packet.sequenceId;
        // this.emit('warn', err); // REVIEW
        // eslint-disable-next-line no-console
        console.error(err.message);
      }
      this.bumpSequenceId(packet.numPackets);
    }
    if (this.config.debug) {
      if (packet) {
        // eslint-disable-next-line no-console
        console.log(
          ` raw: ${packet.buffer
            .slice(packet.offset, packet.offset + packet.length())
            .toString('hex')}`
        );
        // eslint-disable-next-line no-console
        console.trace();
        const commandName = this.ongoingCommand
          ? this.ongoingCommand._commandName
          : '(no command)';
        const stateName = this.ongoingCommand
          ? this.ongoingCommand.stateName()
          : '(no command)';
        // eslint-disable-next-line no-console
        console.log(
          `${this.connectionId} ==> ${commandName}#${stateName}(${[
            packet.sequenceId,
            packet.type(),
            packet.length(),
          ].join(',')})`
        );
      }
    }
    if (!this.ongoingCommand) {
      const marker = packet.peekByte();
      // If it's an Err Packet, we should use it.
      if (marker === 0xff) {
        const error = Packets.Error.fromPacket(packet);
        this.protocolError(error.message, error.code);
      } else {
        // Otherwise, it means it's some other unexpected packet.
        this.protocolError(
          'Unexpected packet while no commands in the queue',
          'PROTOCOL_UNEXPECTED_PACKET'
        );
      }
      this.close();
      return;
    }
    const done = this.execute(packet, this);
    if (done && this.queuedCommands.length > 0) {
      this.ongoingCommand = this.queuedCommands.shift()!;
      this.sequenceId = 0;
      this.compressedSequenceId = 0;
      this.handlePacket();
    }
  }
}
