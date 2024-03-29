import { Packet } from './packet'
import { decodeString } from './stringParser'
import {
  MYSQL_TYPE_DATE,
  MYSQL_TYPE_DATETIME,
  MYSQL_TYPE_DATETIME2,
  MYSQL_TYPE_DECIMAL,
  MYSQL_TYPE_DOUBLE,
  MYSQL_TYPE_FLOAT,
  MYSQL_TYPE_INT24,
  MYSQL_TYPE_LONG,
  MYSQL_TYPE_LONGLONG,
  MYSQL_TYPE_NEWDATE,
  MYSQL_TYPE_NEWDECIMAL,
  MYSQL_TYPE_NULL,
  MYSQL_TYPE_SHORT,
  MYSQL_TYPE_STRING,
  MYSQL_TYPE_TIME,
  MYSQL_TYPE_TIME2,
  MYSQL_TYPE_TIMESTAMP,
  MYSQL_TYPE_TIMESTAMP2,
  MYSQL_TYPE_TINY,
  MYSQL_TYPE_VARCHAR,
  MYSQL_TYPE_VAR_STRING,
} from './typeConstants'

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

export type ParsedRowType = Record<string, string | number | boolean>

export function parseRow(fields: FieldInfo[], packet: Packet): ParsedRowType {
  const row: any = {}
  for (const field of fields) {
    const name = field.name

    const strLen = packet.readLengthCodedNumber(false, false)!
    const val = decodeString(
      packet.buffer,
      'utf8',
      packet.offset,
      packet.offset + strLen
    )
    packet.offset += strLen

    row[name] = val === null ? null : convertType(field, val)
  }
  return row
}

/** @ignore */
function convertType(field: FieldInfo, val: string): any {
  const { fieldType, fieldLen } = field

  switch (fieldType) {
    case MYSQL_TYPE_NULL:
      return null
    case MYSQL_TYPE_DECIMAL:
    case MYSQL_TYPE_NEWDECIMAL: // We might loose some precision in this case
    case MYSQL_TYPE_DOUBLE:
    case MYSQL_TYPE_FLOAT:
    case MYSQL_TYPE_DATETIME2:
      return parseFloat(val)
    case MYSQL_TYPE_TINY:
    case MYSQL_TYPE_SHORT:
    case MYSQL_TYPE_LONG:
    case MYSQL_TYPE_INT24:
      return parseInt(val)
    case MYSQL_TYPE_LONGLONG:
      if (
        Number(val) < Number.MIN_SAFE_INTEGER ||
        Number(val) > Number.MAX_SAFE_INTEGER
      ) {
        return BigInt(val)
      } else {
        return parseInt(val)
      }
    case MYSQL_TYPE_VARCHAR:
    case MYSQL_TYPE_VAR_STRING:
    case MYSQL_TYPE_STRING:
    case MYSQL_TYPE_TIME:
    case MYSQL_TYPE_TIME2:
      return val
    case MYSQL_TYPE_DATE:
    case MYSQL_TYPE_TIMESTAMP:
    case MYSQL_TYPE_DATETIME:
    case MYSQL_TYPE_NEWDATE:
    case MYSQL_TYPE_TIMESTAMP2:
    case MYSQL_TYPE_DATETIME2:
      return new Date(val)
    default:
      return val
  }
}
