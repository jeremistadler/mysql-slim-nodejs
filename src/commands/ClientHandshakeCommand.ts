import { CharsetToEncoding } from '../charset_encodings';
import { ALL_CLIENT_CONSTANTS } from '../constants/clientConstants';
import { MysqlError } from '../MysqlError';
import { Packet } from '../packet';
import { HandshakePacket } from '../packets/handshake';
import { HandshakeResponse } from '../packets/handshakeResponse';
import {
  authorizedConnection,
  Connection,
  handleFatalError,
  writePacket,
} from '../v2/connection';
import { Command, CommandHandlePacketFn } from './command';
import {
  authSwitchRequest,
  authSwitchRequestMoreData,
} from '../authPlugins/authSwitcher';

// import Packets from '../packets/index';
// import ClientConstants from '../constants/client';
// import CharsetToEncoding from '../constants/charset_encodings';
// import auth41 from '../auth_41';

function flagNames(flags: number) {
  const res = [];
  for (const c in ALL_CLIENT_CONSTANTS) {
    if (flags & ((ALL_CLIENT_CONSTANTS as any)[c] as any)) {
      res.push(c.replace(/_/g, ' ').toLowerCase());
    }
  }
  return res;
}

export class ClientHandshake implements Command {
  handshake: null | HandshakePacket;
  clientFlags: number;
  autPluginName: any;
  onResult: any;
  handlePacket: CommandHandlePacketFn;
  _commandName = 'ClientHandshake';

  constructor(clientFlags: number) {
    this.handshake = null;
    this.clientFlags = clientFlags;
    this.handlePacket = this.handleHandshakeInitPacket;
  }

  sendCredentials(conn: Connection, handshake: HandshakePacket) {
    if (conn.config.debug) {
      // eslint-disable-next-line
      console.log(
        'Client handshake packet: flags:%d=(%s)',
        this.clientFlags,
        flagNames(this.clientFlags).join(', ')
      );
    }

    this.autPluginName = handshake.autPluginName;

    const handshakeResponse = new HandshakeResponse({
      flags: this.clientFlags,
      user: conn.config.user,
      database: conn.config.database,
      password: conn.config.password,
      charsetNumber: 0,
      authPluginData1: handshake.authPluginData1,
      authPluginData2: handshake.authPluginData2,
      compress: false,
      connectAttributes: {},
    });

    writePacket(conn, handshakeResponse.toPacket());
  }

  handleHandshakeInitPacket(
    helloPacket: Packet,
    connection: Connection
  ): CommandHandlePacketFn {
    this.handshake = HandshakePacket.fromPacket(helloPacket);

    if (connection.config.debug) {
      // eslint-disable-next-line
      console.log(
        'Server hello packet: capability flags:%d=(%s)',
        this.handshake.capabilityFlags,
        flagNames(this.handshake.capabilityFlags).join(', ')
      );
    }

    connection.serverCapabilityFlags = this.handshake.capabilityFlags;
    connection.serverEncoding = CharsetToEncoding[this.handshake.characterSet];
    connection.connectionId = this.handshake.connectionId;

    this.sendCredentials(connection, this.handshake);

    return this.handleHandshakeResult;
  }

  handleHandshakeResult(packet: Packet, connection: Connection) {
    const marker = packet.peekByte();
    // packet can be OK_Packet, ERR_Packet, AuthSwitchRequest, AuthNextFactor
    // or AuthMoreData
    if (marker === 0xfe || marker === 1 || marker === 0x02) {
      try {
        if (marker === 1) {
          authSwitchRequestMoreData(packet, connection, this);
        } else {
          // if authenticationFactor === 0, it means the server does not support
          // the multi-factor authentication capability
          // if (this.authenticationFactor !== 0) {
          //   // if we are past the first authentication factor, we should use the
          //   // corresponding password (if there is one)
          //   connection.config.password =
          //     this[`password${this.authenticationFactor}`];
          //   // update the current authentication factor
          //   this.authenticationFactor += 1;
          // }
          // if marker === 0x02, it means it is an AuthNextFactor packet,
          // which is similar in structure to an AuthSwitchRequest packet,
          // so, we can use it directly
          authSwitchRequest(packet, connection, this);
        }
        return ClientHandshake.prototype.handleHandshakeResult;
      } catch (err: any) {
        const mysqlError = new MysqlError(
          err.message,
          'AUTH_SWITCH_PLUGIN_ERROR',
          true
        );
        mysqlError.cause = err;

        if (this.onResult) {
          this.onResult(err);
        } else {
          handleFatalError(connection, mysqlError);
        }

        return null;
      }
    }

    if (marker !== 0) {
      const err = new MysqlError(
        'Unexpected packet during handshake phase',
        'HANDSHAKE_UNKNOWN_ERROR',
        true
      );
      // Unknown handshake errors are fatal

      if (this.onResult) {
        this.onResult(err);
      } else {
        handleFatalError(connection, err);
      }
      return null;
    }
    // this should be called from ClientHandshake command only
    // and skipped when called from ChangeUser command
    if (!connection.authorized) {
      authorizedConnection(connection);
      // if (connection.config.compress) {
      //   const enableCompression =
      //     require('../compressed_protocol.js').enableCompression;
      //   enableCompression(connection);
      // }
    }
    if (this.onResult) {
      this.onResult(null);
    }
    return null;
  }
}
