import { Socket } from 'node:net'
import { Command } from './commands/command'
import { MysqlError } from './MysqlError'
import { PacketParser } from './PacketParser'

export type TcpConnectionProps = Readonly<{
  host: string
  user: string
  password: string
  database: string
  port: number
  debug: boolean
  ssl: boolean

  connectTimeout?: number
}>

export type Conn = {
  readonly config: TcpConnectionProps
  readonly parser: PacketParser

  socket: Socket
  isClosing: boolean

  connectTimeout: NodeJS.Timeout | null

  sequenceId: number

  ongoingCommand: null | Command
  queuedCommands: Command[]

  clientEncoding: string
  connectionId: number
  serverEncoding: string
  serverCapabilityFlags: number

  fatalError: MysqlError | null

  authPlugin: null | ((data: Buffer) => Buffer | null)

  authorized: boolean
  authorizedResolvers: (() => void)[]
  errorCallbacks: ((error: MysqlError) => void)[]
}
