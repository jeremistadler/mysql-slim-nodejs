import { Command } from '../commands/command';
import { MysqlError } from '../MysqlError';
import { Packet } from '../packet';
import { AuthSwitchRequestMoreDataPacket } from '../packets/authSwitchRequestMoreData';
import { AuthSwitchRequestPacket } from '../packets/authSwitchRequestPacket';
import { AuthSwitchResponsePacket } from '../packets/authSwitchResponsePacket';
import { Conn, handleFatalError, writePacket } from '../v2/connection';
import { caching_sha2_password } from './caching_sha2_password';

const standardAuthPlugins: Record<
  string,
  (connection: Conn) => (data: Buffer) => Buffer | null
> = {
  caching_sha2_password,
};

export function authSwitchRequest(
  packet: Packet,
  connection: Conn,
  command: Command
) {
  const { pluginName, pluginData } = AuthSwitchRequestPacket.fromPacket(packet);

  const authPlugin = standardAuthPlugins[pluginName];
  if (!authPlugin) {
    throw new Error(
      `Server requests authentication using unknown plugin ${pluginName}. See ${'TODO: add plugins doco here'} on how to configure or author authentication plugins.`
    );
  }

  connection.authPlugin = authPlugin(connection);

  Promise.resolve(connection.authPlugin!(pluginData))
    .then((data) => {
      if (data) {
        writePacket(connection, new AuthSwitchResponsePacket(data).toPacket());
      }
    })
    .catch((err) => {
      handleError(err, connection);
    });
}

export function authSwitchRequestMoreData(
  packet: Packet,
  connection: Conn,
  command: Command
) {
  const { data } = AuthSwitchRequestMoreDataPacket.fromPacket(packet);

  if (!connection.authPlugin) {
    throw new Error(
      'AuthPluginMoreData received but no auth plugin instance found'
    );
  }

  Promise.resolve(connection.authPlugin(data))
    .then((data) => {
      if (data) {
        writePacket(connection, new AuthSwitchResponsePacket(data).toPacket());
      }
    })
    .catch((err) => {
      handleError(err, connection);
    });
}

function handleError(err: any, connection: Conn) {
  const mysqlError = new MysqlError(
    err.message,
    'AUTH_SWITCH_PLUGIN_ERROR',
    true
  );
  mysqlError.cause = err;
  handleFatalError(connection, mysqlError);
}
