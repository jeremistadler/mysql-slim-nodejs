import { connect } from 'node:net'
import { QueryCommand } from './commands/QueryCommand'
import {
  closeConnection,
  createAuthorizedPromise,
  onReceivedPacket,
  onSocketClosed,
  onSocketData,
  onSocketError,
  unqueueNextCommand,
} from './connectionActions'
import { Conn, TcpConnectionProps } from './ConnectionType'
import { onSocketConnected } from './onSocketConnected'
import { PacketParser } from './PacketParser'
import { ResultSetHeaderPacket } from './packets/resultsetHeaderPacket'
import { ParsedRowType } from './textParser'

export function createMysqlConnection(config: TcpConnectionProps) {
  const conn: Conn = {
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
  }

  conn.parser.onPacket = onReceivedPacket(conn)

  conn.socket.on('connect', onSocketConnected(conn))
  conn.socket.on('error', onSocketError(conn))
  conn.socket.on('data', onSocketData(conn))
  conn.socket.on('close', onSocketClosed(conn))

  conn.connectTimeout = setTimeout(() => {
    console.log('Connection timeout...')
    conn.isClosing = true
    conn.socket.end()
  }, config.connectTimeout ?? 5000)

  return {
    waitUntilConnected: createAuthorizedPromise(conn),
    close: closeConnection(conn),

    query: (sql: string): Promise<ParsedRowType[]> => {
      const command = new QueryCommand({ sql, values: [] })
      conn.queuedCommands.push(command)
      if (conn.ongoingCommand === null) unqueueNextCommand(conn)

      return command.promise.then(() => {
        if (command._rows.length === 0)
          throw new Error('No resultsets, maybe use execute?')

        if (command._rows.length > 1)
          throw new Error('Too many resultsets, maybe use queryMultiple?')

        return command._rows[0]
      })
    },

    execute: (sql: string): Promise<ResultSetHeaderPacket | null> => {
      const command = new QueryCommand({ sql, values: [] })
      conn.queuedCommands.push(command)
      if (conn.ongoingCommand === null) unqueueNextCommand(conn)

      return command.promise.then(() => {
        if (command._rows.length > 0)
          throw new Error('Too many resultsets, maybe use query?')

        return command._resultSet
      })
    },
  }
}

export type Connection = ReturnType<typeof createMysqlConnection>
