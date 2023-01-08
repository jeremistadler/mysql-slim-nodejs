import { MysqlError } from '../MysqlError'
import { Packet } from '../packet'
import { ColumnDefinitionPacket } from '../packets/ColumnDefinitionPacket'
import { QueryPacket } from '../packets/queryPacket'
import { ResultSetHeaderPacket } from '../packets/resultsetHeaderPacket'
import { ParsedRowType, parseRow } from '../textParser'
import { Conn, handleFatalError, writePacket } from '../v2/connection'
import { Command, CommandHandlePacketFn } from './command'

const SERVER_MORE_RESULTS_EXISTS = 8

// http://dev.mysql.com/doc/internals/en/com-query.html
export class QueryCommand implements Command {
  sql: string
  values: any[]

  handlePacket: CommandHandlePacketFn
  _commandName = 'Query'
  private _fieldCount: number = 0
  private _receivedFieldsCount: number = 0
  _rows: ParsedRowType[][] = []
  _fields: ColumnDefinitionPacket[][] = []
  private _resultIndex: number = 0
  _resultSet: ResultSetHeaderPacket | null = null

  private completeCallback!: () => void
  private errorCallback!: (err: MysqlError) => void
  public promise: Promise<void>

  constructor(commandInput: { sql: string; values: any[] }) {
    this.sql = commandInput.sql
    this.values = commandInput.values
    // this._queryOptions = options;
    // this.namedPlaceholders = options.namedPlaceholders || false;
    // this.onResult = callback;
    // this.timeout = options.timeout;
    // this.queryTimeout = null;
    // this._fieldCount = 0;
    // this._rowParser = null;
    // this._fields = [];
    // this._rows = [];
    // this._receivedFieldsCount = 0;
    // this._resultIndex = 0;
    // this._localStream = null;
    // this._unpipeStream = function () {};
    // this._streamFactory = options.infileStreamFactory;
    // this._connection = null;

    this.handlePacket = { name: 'start', fn: this.handleStart }

    this.promise = new Promise<void>((resolve, reject) => {
      this.completeCallback = resolve
      this.errorCallback = reject
    })
  }

  public onPacketError(err: MysqlError) {
    this.errorCallback(err)
  }

  private handleStart(
    _packet: Packet,
    connection: Conn
  ): CommandHandlePacketFn {
    if (connection.config.debug) {
      // eslint-disable-next-line
      console.log('        Sending query command: %s', this.sql)
    }

    const cmdPacket = new QueryPacket(this.sql)
    writePacket(connection, cmdPacket.toPacket())

    return { name: 'resultsetHeader', fn: this.resultsetHeader }
  }

  private resultsetHeader(
    packet: Packet,
    connection: Conn
  ): CommandHandlePacketFn {
    const rs = new ResultSetHeaderPacket(packet, connection)
    this._fieldCount = rs.fieldCount

    if (connection.config.debug) {
      // eslint-disable-next-line
      console.log(
        `        Resultset header received, expecting ${rs.fieldCount} column definition packets`
      )
    }

    if (this._fieldCount === 0) {
      return this.doneInsert(rs)
    }

    this._receivedFieldsCount = 0
    this._rows.push([])
    this._fields.push([])

    return { name: 'readFields', fn: this.readField }
  }

  private readField(packet: Packet, connection: Conn): CommandHandlePacketFn {
    this._receivedFieldsCount++
    // Often there is much more data in the column definition than in the row itself
    // If you set manually _fields[0] to array of ColumnDefinition's (from previous call)
    // you can 'cache' result of parsing. Field packets still received, but ignored in that case
    // this is the reason _receivedFieldsCount exist (otherwise we could just use current length of fields array)
    if (this._fields[this._resultIndex].length !== this._fieldCount) {
      const field = new ColumnDefinitionPacket(packet)
      this._fields[this._resultIndex].push(field)
      if (connection.config.debug) {
        /* eslint-disable no-console */
        console.log('        Column definition:')
        console.log(`          name: ${field.field.name}`)
        console.log(`          type: ${field.field.fieldType}`)
        console.log(`         flags: ${field.field.fieldFlag}`)
        /* eslint-enable no-console */
      }
    }

    // last field received
    if (this._receivedFieldsCount === this._fieldCount) {
      // const fields = this._fields[this._resultIndex];
      // this.emit('fields', fields);

      // this._rowParser = new (getTextParser(
      //   fields,
      //   this.options,
      //   connection.config
      // ))(fields);
      return { name: 'eof', fn: this.fieldsEOF }
    }

    return { name: 'readMoreFields', fn: this.readField }
  }

  private done() {
    // if all ready timeout, return null directly
    // if (this.timeout && !this.queryTimeout) {
    //   return null;
    // }
    // else clear timer
    // if (this.queryTimeout) {
    //   Timers.clearTimeout(this.queryTimeout);
    //   this.queryTimeout = null;
    // }

    this.completeCallback()

    // if (this.onResult) {
    //   let rows, fields;
    //   if (this._resultIndex === 0) {
    //     rows = this._rows[0];
    //     fields = this._fields[0];
    //   } else {
    //     rows = this._rows;
    //     fields = this._fields;
    //   }
    //   if (fields) {
    //     process.nextTick(() => {
    //       this.onResult(null, rows, fields);
    //     });
    //   } else {
    //     process.nextTick(() => {
    //       this.onResult(null, rows);
    //     });
    //   }
    // }
    return null
  }

  private doneInsert(rs: ResultSetHeaderPacket | null): CommandHandlePacketFn {
    this._resultSet = rs

    if (rs != null && rs.serverStatus & SERVER_MORE_RESULTS_EXISTS) {
      this._resultIndex++
      return { name: 'header', fn: this.resultsetHeader }
    }

    return this.done()
  }

  private fieldsEOF(packet: Packet, connection: Conn): CommandHandlePacketFn {
    // check EOF
    if (!packet.isEOF()) {
      handleFatalError(
        connection,
        new MysqlError('Query not end of packet', '', true)
      )
      return null
    }
    return { name: 'readRow', fn: this.row }
  }

  private row(packet: Packet, _connection: Conn): CommandHandlePacketFn {
    if (packet.isEOF()) {
      const status = packet.eofStatusFlags()
      const moreResults = status & SERVER_MORE_RESULTS_EXISTS
      if (moreResults) {
        this._resultIndex++
        return { name: 'readNextResultsetHeader', fn: this.resultsetHeader }
      }
      return this.done()
    }

    let row
    try {
      row = parseRow(
        this._fields[this._resultIndex].map(f => f.field),
        packet
      )
    } catch (err) {
      console.error('parseRow error', err)
      // this._localStreamError = err;
      return this.doneInsert(null)
    }

    this._rows[this._resultIndex].push(row)

    return { name: 'readNextRow', fn: this.row }
  }
}
