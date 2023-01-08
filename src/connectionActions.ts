import { QueryCommand } from './commands/QueryCommand'
import { Conn } from './ConnectionType'
import { ALL_CLIENT_CONSTANTS } from './constants/clientConstants'
import { MysqlError } from './MysqlError'
import { Packet } from './packet'
import { ErrorPacket } from './packets/errorPacket'

export function onSocketError(conn: Conn) {
  return (err: Error) => {
    console.error('onSocketError', err)
  }
}

export function onSocketData(conn: Conn) {
  return (data: Buffer) => {
    // if (this.state === 'closed') return;

    conn.parser.execute(data)
  }
}

export function onSocketClosed(conn: Conn) {
  return () => {
    //console.log('onSocketClosed');
  }
}

function getSocketState(conn: Conn) {
  if (conn.socket.closed) return 'disconnected'
  if (conn.socket.connecting) return 'connecting'
  return 'connected'
}

export function flagListToInt(
  flagStrings: (keyof typeof ALL_CLIENT_CONSTANTS)[]
) {
  let flags = 0x0

  for (const item of flagStrings) {
    flags |= ALL_CLIENT_CONSTANTS[item] || 0x0
  }

  return flags
}

export function getDefaultClientFlags(options: {
  multipleStatements: boolean
  connectAttributes: boolean
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
  ]
  if (options.multipleStatements) {
    defaultFlags.push('MULTI_STATEMENTS')
  }
  defaultFlags.push('PLUGIN_AUTH')
  defaultFlags.push('PLUGIN_AUTH_LENENC_CLIENT_DATA')

  if (options.connectAttributes) {
    defaultFlags.push('CONNECT_ATTRS')
  }
  return defaultFlags
}

export function createAuthorizedPromise(conn: Conn) {
  return (): Promise<void> => {
    if (conn.isClosing)
      return Promise.reject(
        new Error('Cannot connect a closed connection, please create a new one')
      )

    if (getSocketState(conn) === 'connected' && conn.authorized)
      return Promise.resolve()

    return new Promise((resolve, reject) => {
      conn.authorizedResolvers.push(resolve)
      conn.errorCallbacks.push(reject)
    })
  }
}

export function onReceivedPacket(conn: Conn) {
  return (packet: Packet) => {
    if (conn.sequenceId !== packet.sequenceId) {
      const err = new Error(
        `Warning: got packets out of order. Expected ${conn.sequenceId} but received ${packet.sequenceId}`
      )
      console.error(err.message)
    }

    bumpSequenceId(conn, packet.numPackets)

    if (conn.config.debug) {
      const commandName = conn.ongoingCommand
        ? conn.ongoingCommand._commandName
        : '(no command)'

      console.log(
        `Received ${commandName} ${
          conn.ongoingCommand?.handlePacket?.name || ''
        } (${[packet.sequenceId, packet.type(), packet.length()].join(',')})`
      )
    }

    if (conn.ongoingCommand === null || packet.type() === 'Error') {
      const marker = packet.peekByte()
      // If it's an Err Packet, we should use it.
      if (marker === 0xff) {
        const error = ErrorPacket.fromPacket(packet)

        if (error.code === 'ER_NET_READ_ERROR' && conn.isClosing) {
          // Ignore the error that server sends on close
          return
        }
        if (conn.config.debug) console.log(error.code, error.message)
        const mysqlError = new MysqlError(error.message, error.code, true)

        if (
          conn.ongoingCommand != null &&
          conn.ongoingCommand instanceof QueryCommand
        ) {
          conn.ongoingCommand.onPacketError(mysqlError)
        }

        handleFatalError(conn, mysqlError)
      } else {
        // Otherwise, it means it's some other unexpected packet.
        handleFatalError(
          conn,
          new MysqlError(
            'Unexpected packet while no commands in the queue',
            'PROTOCOL_UNEXPECTED_PACKET',
            true
          )
        )
      }

      conn.ongoingCommand = null
      conn.sequenceId = 0
      return
    }

    conn.ongoingCommand.handlePacket =
      conn.ongoingCommand!.handlePacket!.fn.call(
        conn.ongoingCommand,
        packet,
        conn
      )

    if (conn.ongoingCommand.handlePacket === null) {
      conn.ongoingCommand = null
      conn.sequenceId = 0
      unqueueNextCommand(conn)
    }
  }
}

export function unqueueNextCommand(conn: Conn) {
  if (conn.queuedCommands.length > 0) {
    conn.ongoingCommand = conn.queuedCommands.shift()!
    conn.ongoingCommand.handlePacket =
      conn.ongoingCommand!.handlePacket!.fn.call(
        conn.ongoingCommand,
        new Packet(0, Buffer.alloc(0), 0, 0),
        conn
      )
  }
}

export function bumpSequenceId(conn: Conn, numPackets: number) {
  conn.sequenceId += numPackets
  conn.sequenceId %= 256
}

export function closeConnection(conn: Conn) {
  return () => {
    if (conn.config.debug) console.log('Closing connection...')
    conn.isClosing = true

    return new Promise<void>(resolve => {
      conn.socket.end(() => {
        resolve()
      })
    })
  }
}

export function authorizedConnection(conn: Conn) {
  conn.authorized = true
  conn.authorizedResolvers.forEach(resolver => resolver())
}

function writeToSocket(conn: Conn, buffer: Buffer) {
  conn.socket.write(buffer, err => {
    if (err) {
      handleFatalError(conn, err as MysqlError)
    }
  })
}

export function handleFatalError(conn: Conn, error: MysqlError) {
  conn.isClosing = true
  conn.fatalError = error
  closeConnection(conn)()
  conn.errorCallbacks.forEach(fn => fn(error))

  conn.queuedCommands.forEach(command => {
    if (command instanceof QueryCommand)
      command.onPacketError(
        new MysqlError('An earlier command threw an error', 'PREV_ERROR', true)
      )
  })
  conn.queuedCommands = []
}

export function writePacket(conn: Conn, packet: Packet) {
  const MAX_PACKET_LENGTH = 16777215
  const length = packet.length()
  let chunk, offset, header

  if (conn.config.debug) {
    console.log(
      `Sending ${conn.ongoingCommand?._commandName} ${
        conn.ongoingCommand?.handlePacket?.name || ''
      } (${[conn.sequenceId, packet._name, packet.length()].join(',')})`
    )
  }

  if (length < MAX_PACKET_LENGTH) {
    packet.writeHeader(conn.sequenceId)

    bumpSequenceId(conn, 1)
    writeToSocket(conn, packet.buffer)
  } else {
    for (offset = 4; offset < 4 + length; offset += MAX_PACKET_LENGTH) {
      chunk = packet.buffer.subarray(offset, offset + MAX_PACKET_LENGTH)
      if (chunk.length === MAX_PACKET_LENGTH) {
        header = Buffer.from([0xff, 0xff, 0xff, conn.sequenceId])
      } else {
        header = Buffer.from([
          chunk.length & 0xff,
          (chunk.length >> 8) & 0xff,
          (chunk.length >> 16) & 0xff,
          conn.sequenceId,
        ])
      }

      bumpSequenceId(conn, 1)
      writeToSocket(conn, header)
      writeToSocket(conn, chunk)
    }
  }
}
