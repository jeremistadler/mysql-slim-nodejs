import { Packet } from '../packet'
import { decodeString } from '../stringParser'

// creating JS string is relatively expensive (compared to
// reading few bytes from buffer) because all string properties
// except for name are unlikely to be used we postpone
// string conversion until property access
//
// TODO: watch for integration benchmarks (one with real network buffer)
// there could be bad side effect as keeping reference to a buffer makes it
// sit in the memory longer (usually until final .query() callback)
// Latest v8 perform much better in regard to bufferer -> string conversion,
// at some point of time this optimisation might become unnecessary
// see https://github.com/sidorares/node-mysql2/pull/137
//

export interface FieldInfo {
  catalog: string
  schema: string
  table: string
  originTable: string
  name: string
  originName: string
  encoding: number
  fieldLen: number
  fieldType: number
  fieldFlag: number
  decimals: number
  defaultVal: string
}

export class ColumnDefinitionPacket {
  field: FieldInfo

  constructor(packet: Packet) {
    const _buf = packet.buffer

    const catalogLength = packet.readLengthCodedNumber(false, false)!
    const catalog = decodeString(
      _buf,
      'utf8',
      packet.offset,
      packet.offset + catalogLength
    )
    packet.offset += catalogLength

    const _schemaLength = packet.readLengthCodedNumber(false, false)!
    const schema = decodeString(
      _buf,
      'utf8',
      packet.offset,
      packet.offset + _schemaLength
    )
    packet.offset += _schemaLength

    const _tableLength = packet.readLengthCodedNumber(false, false)!
    const table = decodeString(
      _buf,
      'utf8',
      packet.offset,
      packet.offset + _tableLength
    )
    packet.offset += _tableLength

    const _orgTableLength = packet.readLengthCodedNumber(false, false)!
    const orgTable = decodeString(
      _buf,
      'utf8',
      packet.offset,
      packet.offset + _orgTableLength
    )
    packet.offset += _orgTableLength

    const _nameLength = packet.readLengthCodedNumber(false, false)!
    const name = decodeString(
      _buf,
      'utf8',
      packet.offset,
      packet.offset + _nameLength
    )
    packet.offset += _nameLength

    const _orgNameLength = packet.readLengthCodedNumber(false, false)!
    const orgName = decodeString(
      _buf,
      'utf8',
      packet.offset,
      packet.offset + _orgNameLength
    )
    packet.offset += _orgNameLength

    packet.skip(1) //  length of the following fields (always 0x0c)

    const characterSet = packet.readInt16()
    const columnLength = packet.readInt32()
    const columnType = packet.readInt8()
    const flags = packet.readInt16()
    const decimals = packet.readInt8()

    packet.skip(1) //  length of the following fields (always 0x0c)
    let defaultValue = ''

    if (packet.haveMoreData()) {
      const defaultLength = packet.readLengthCodedNumber(false, false)!
      defaultValue = decodeString(
        _buf,
        'utf8',
        packet.offset,
        packet.offset + defaultLength
      )
    }

    this.field = {
      catalog: catalog,
      schema: schema,
      name: name,
      originName: orgName,
      table: table,
      originTable: orgTable,
      fieldLen: columnLength,
      fieldType: columnType,
      fieldFlag: flags,
      encoding: characterSet,
      defaultVal: defaultValue,
      decimals: decimals,
    }
  }
}
