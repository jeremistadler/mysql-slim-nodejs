import { randomBytes } from 'node:crypto'
import { PLUGIN_AUTH, SECURE_CONNECTION } from '../constants/clientConstants'
import { Packet } from '../packet'

// https://dev.mysql.com/doc/internals/en/connection-phase-packets.html#packet-Protocol::Handshake

export class HandshakePacket {
  protocolVersion: any
  serverVersion: any
  capabilityFlags: number
  connectionId: number
  authPluginData1: Buffer
  authPluginData2: Buffer
  characterSet: any
  statusFlags: any
  autPluginName: string
  flags: any
  charsetNumber: any
  connectAttributes: any

  constructor(args: any) {
    this.protocolVersion = args.protocolVersion
    this.serverVersion = args.serverVersion
    this.capabilityFlags = args.capabilityFlags
    this.connectionId = args.connectionId
    this.authPluginData1 = args.authPluginData1
    this.authPluginData2 = args.authPluginData2
    this.characterSet = args.characterSet
    this.statusFlags = args.statusFlags
    this.autPluginName = args.autPluginName
  }

  setScrambleData(cb: (err?: Error) => void) {
    randomBytes(20, (err, data) => {
      if (err) {
        cb(err)
        return
      }
      this.authPluginData1 = data.slice(0, 8)
      this.authPluginData2 = data.slice(8, 20)
      cb()
    })
  }

  static fromPacket(packet: Packet) {
    const args: Record<string, number | string | Buffer> = {}
    args.protocolVersion = packet.readInt8()
    args.serverVersion = packet.readNullTerminatedString('cesu8')
    args.connectionId = packet.readInt32()
    args.authPluginData1 = packet.readBuffer(8)
    packet.skip(1)
    const capabilityFlagsBuffer = Buffer.allocUnsafe(4)
    capabilityFlagsBuffer[0] = packet.readInt8()
    capabilityFlagsBuffer[1] = packet.readInt8()
    if (packet.haveMoreData()) {
      args.characterSet = packet.readInt8()
      args.statusFlags = packet.readInt16()
      // upper 2 bytes
      capabilityFlagsBuffer[2] = packet.readInt8()
      capabilityFlagsBuffer[3] = packet.readInt8()
      args.capabilityFlags = capabilityFlagsBuffer.readUInt32LE(0)
      if (args.capabilityFlags & PLUGIN_AUTH) {
        args.authPluginDataLength = packet.readInt8()
      } else {
        args.authPluginDataLength = 0
        packet.skip(1)
      }
      packet.skip(10)
    } else {
      args.capabilityFlags = capabilityFlagsBuffer.readUInt16LE(0)
    }

    const isSecureConnection = args.capabilityFlags & SECURE_CONNECTION
    if (isSecureConnection) {
      const authPluginDataLength = args.authPluginDataLength as number
      if (authPluginDataLength === 0) {
        // for Secure Password Authentication
        args.authPluginDataLength = 20
        args.authPluginData2 = packet.readBuffer(12)
        packet.skip(1)
      } else {
        // length > 0
        // for Custom Auth Plugin (PLUGIN_AUTH)
        const len = Math.max(13, authPluginDataLength - 8)
        args.authPluginData2 = packet.readBuffer(len)
      }
    }

    if (args.capabilityFlags & PLUGIN_AUTH) {
      args.autPluginName = packet.readNullTerminatedString('ascii')
    }

    return new HandshakePacket(args)
  }
}
