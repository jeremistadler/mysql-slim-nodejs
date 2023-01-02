import { connect, Socket, TcpSocketConnectOpts } from 'node:net';
import { ClientHandshake } from '../commands/ClientHandshakeCommand';
import { Command } from '../commands/command';
import { QueryCommand } from '../commands/QueryCommand';
import { ALL_CLIENT_CONSTANTS } from '../constants/clientConstants';
import { MysqlError } from '../MysqlError';
import { Packet } from '../packet';
import { PacketParser } from '../PacketParser';
import { ErrorPacket } from '../packets/errorPacket';
import { ResultSetHeaderPacket } from '../packets/resultsetHeaderPacket';
import { ParsedRowType } from '../textParser';

type TcpConnectionProps = Readonly<{
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
  debug: boolean;
  ssl: boolean;
}>;

export type Connection = {
  readonly config: TcpConnectionProps;
  readonly parser: PacketParser;

  socket: Socket;
  isClosing: boolean;

  connectTimeout: NodeJS.Timeout | null;

  sequenceId: number;

  ongoingCommand: null | Command;
  queuedCommands: Command[];

  clientEncoding: string;
  connectionId: number;
  serverEncoding: string;
  serverCapabilityFlags: number;

  fatalError: MysqlError | null;

  authPlugin: null | ((data: Buffer) => Buffer | null);

  authorized: boolean;
  authorizedResolvers: (() => void)[];
  errorCallbacks: ((error: MysqlError) => void)[];
};

export function createMysqlConnection(config: TcpConnectionProps) {
  const conn: Connection = {
    config,
    parser: new PacketParser(4),

    socket: connect(config.port, config.host),

    ongoingCommand: null,
    clientEncoding: 'utf8',
    serverEncoding: 'utf8',

    connectionId: 0,
    connectTimeout: null,
    isClosing: false,
    queuedCommands: [],
    sequenceId: 0,
    serverCapabilityFlags: 0,

    fatalError: null,
    authPlugin: null,

    authorized: false,
    authorizedResolvers: [],
    errorCallbacks: [],
  };

  conn.parser.onPacket = onReceivedPacket(conn);

  conn.socket.on('connect', onSocketConnected(conn));
  conn.socket.on('error', onSocketError(conn));
  conn.socket.on('data', onSocketData(conn));
  conn.socket.on('close', onSocketClosed(conn));

  conn.connectTimeout = setTimeout(() => {
    console.log('Connection timeout...');
    conn.isClosing = true;
    conn.socket.end();
  }, 5000);

  return {
    connect: createAuthorizedPromise(conn),
    close: closeConnection(conn),

    query: (sql: string): Promise<ParsedRowType[]> => {
      const command = new QueryCommand({ sql, values: [] });
      conn.queuedCommands.push(command);
      if (conn.ongoingCommand === null) unqueueNextCommand(conn);

      return command.promise.then(() => {
        if (command._rows.length === 0)
          throw new Error('No resultsets, maybe use execute?');

        if (command._rows.length > 1)
          throw new Error('Too many resultsets, maybe use queryMultiple?');

        return command._rows[0];
      });
    },

    execute: (sql: string): Promise<ResultSetHeaderPacket | null> => {
      const command = new QueryCommand({ sql, values: [] });
      conn.queuedCommands.push(command);
      if (conn.ongoingCommand === null) unqueueNextCommand(conn);

      return command.promise.then(() => {
        if (command._rows.length > 0)
          throw new Error('Too many resultsets, maybe use query?');

        return command._resultSet;
      });
    },
  };
}

function onSocketConnected(conn: Connection) {
  return () => {
    console.log('Connected...');
    if (conn.connectTimeout != null) {
      clearTimeout(conn.connectTimeout);
      conn.connectTimeout = null;
    }
    conn.ongoingCommand = new ClientHandshake(
      mergeFlags(getDefaultClientFlags())
    );
  };
}

function onSocketError(conn: Connection) {
  return (err: Error) => {
    console.error('onSocketError', err);
  };
}

function onSocketData(conn: Connection) {
  return (data: Buffer) => {
    // if (this.state === 'closed') return;

    conn.parser.execute(data);
  };
}

function onSocketClosed(conn: Connection) {
  return () => {
    console.log('onSocketClosed');
  };
}

function getSocketState(conn: Connection) {
  if (conn.socket.closed) return 'disconnected';
  if (conn.socket.connecting) return 'connecting';
  return 'connected';
}

function mergeFlags(flagStrings: (keyof typeof ALL_CLIENT_CONSTANTS)[]) {
  let flags = 0x0;

  for (const item of flagStrings) {
    flags |= ALL_CLIENT_CONSTANTS[item] || 0x0;
  }

  return flags;
}

function getDefaultClientFlags(options?: {
  multipleStatements: boolean;
  connectAttributes: boolean;
}) {
  const defaultFlags: (keyof typeof ALL_CLIENT_CONSTANTS)[] = [
    'LONG_PASSWORD',
    'FOUND_ROWS',
    'LONG_FLAG',
    'CONNECT_WITH_DB',
    'ODBC',
    'LOCAL_FILES',
    'IGNORE_SPACE',
    'PROTOCOL_41',
    'IGNORE_SIGPIPE',
    'TRANSACTIONS',
    'RESERVED',
    'SECURE_CONNECTION',
    'MULTI_RESULTS',
    'TRANSACTIONS',
    'SESSION_TRACK',
  ];
  if (options && options.multipleStatements) {
    defaultFlags.push('MULTI_STATEMENTS');
  }
  defaultFlags.push('PLUGIN_AUTH');
  defaultFlags.push('PLUGIN_AUTH_LENENC_CLIENT_DATA');

  if (options && options.connectAttributes) {
    defaultFlags.push('CONNECT_ATTRS');
  }
  return defaultFlags;
}

function createAuthorizedPromise(conn: Connection) {
  return (): Promise<void> => {
    if (conn.isClosing)
      return Promise.reject(
        new Error('Cannot connect a closed connection, please create a new one')
      );

    if (getSocketState(conn) === 'connected' && conn.authorized)
      return Promise.resolve();

    return new Promise((resolve, reject) => {
      conn.authorizedResolvers.push(resolve);
      conn.errorCallbacks.push(reject);
    });
  };
}

function onReceivedPacket(conn: Connection) {
  return (packet: Packet) => {
    if (conn.sequenceId !== packet.sequenceId) {
      const err = new Error(
        `Warning: got packets out of order. Expected ${conn.sequenceId} but received ${packet.sequenceId}`
      );
      console.error(err.message);
    }

    bumpSequenceId(conn, packet.numPackets);

    if (conn.config.debug) {
      const commandName = conn.ongoingCommand
        ? conn.ongoingCommand._commandName
        : '(no command)';

      console.log(
        `Received ${commandName}(${[
          packet.sequenceId,
          packet.type(),
          packet.length(),
        ].join(',')})`
      );
    }

    if (conn.ongoingCommand === null || packet.type() === 'Error') {
      const marker = packet.peekByte();
      // If it's an Err Packet, we should use it.
      if (marker === 0xff) {
        const error = ErrorPacket.fromPacket(packet);

        if (error.code === 'ER_NET_READ_ERROR' && conn.isClosing) {
          // Ignore the error that server sends on close
          return;
        }

        handleFatalError(conn, new MysqlError(error.message, error.code, true));
      } else {
        // Otherwise, it means it's some other unexpected packet.
        handleFatalError(
          conn,
          new MysqlError(
            'Unexpected packet while no commands in the queue',
            'PROTOCOL_UNEXPECTED_PACKET',
            true
          )
        );
      }

      return;
    }

    conn.ongoingCommand.handlePacket = conn.ongoingCommand!.handlePacket!(
      packet,
      conn
    );

    if (conn.ongoingCommand.handlePacket === null) {
      conn.ongoingCommand = null;
      conn.sequenceId = 0;
      unqueueNextCommand(conn);
    }
  };
}

function unqueueNextCommand(conn: Connection) {
  if (conn.queuedCommands.length > 0) {
    conn.ongoingCommand = conn.queuedCommands.shift()!;
    conn.ongoingCommand.handlePacket = conn.ongoingCommand!.handlePacket!(
      new Packet(0, Buffer.alloc(0), 0, 0),
      conn
    );
  }
}

export function bumpSequenceId(conn: Connection, numPackets: number) {
  conn.sequenceId += numPackets;
  conn.sequenceId %= 256;
}

function closeConnection(conn: Connection) {
  return () => {
    console.log('closeConnection');
    conn.isClosing = true;

    return new Promise<void>((resolve) => {
      conn.socket.end(() => {
        resolve();
      });
    });
  };
}

export function authorizedConnection(conn: Connection) {
  conn.authorized = true;

  console.log('Authorized!');

  conn.authorizedResolvers.forEach((resolver) => resolver());
}

function writeToSocket(conn: Connection, buffer: Buffer) {
  conn.socket.write(buffer, (err) => {
    if (err) {
      handleFatalError(conn, err as MysqlError);
    }
  });
}

export function handleFatalError(conn: Connection, error: MysqlError) {
  conn.isClosing = true;
  conn.fatalError = error;
  closeConnection(conn)();
  conn.errorCallbacks.forEach((fn) => fn(error));
}

export function writePacket(conn: Connection, packet: Packet) {
  const MAX_PACKET_LENGTH = 16777215;
  const length = packet.length();
  let chunk, offset, header;

  if (conn.config.debug) {
    console.log(
      `Sending ${conn.ongoingCommand?._commandName} (${[
        conn.sequenceId,
        packet._name,
        packet.length(),
      ].join(',')})`
    );
  }

  if (length < MAX_PACKET_LENGTH) {
    packet.writeHeader(conn.sequenceId);

    bumpSequenceId(conn, 1);
    writeToSocket(conn, packet.buffer);
  } else {
    for (offset = 4; offset < 4 + length; offset += MAX_PACKET_LENGTH) {
      chunk = packet.buffer.subarray(offset, offset + MAX_PACKET_LENGTH);
      if (chunk.length === MAX_PACKET_LENGTH) {
        header = Buffer.from([0xff, 0xff, 0xff, conn.sequenceId]);
      } else {
        header = Buffer.from([
          chunk.length & 0xff,
          (chunk.length >> 8) & 0xff,
          (chunk.length >> 16) & 0xff,
          conn.sequenceId,
        ]);
      }

      bumpSequenceId(conn, 1);
      writeToSocket(conn, header);
      writeToSocket(conn, chunk);
    }
  }
}