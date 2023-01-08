import { ClientHandshake } from './commands/ClientHandshakeCommand'
import { flagListToInt, getDefaultClientFlags } from './connectionActions'
import { Conn } from './ConnectionType'

export function onSocketConnected(conn: Conn) {
  return () => {
    if (conn.connectTimeout != null) {
      clearTimeout(conn.connectTimeout)
      conn.connectTimeout = null
    }
    conn.ongoingCommand = new ClientHandshake(
      flagListToInt(
        getDefaultClientFlags({
          connectAttributes: true,
          multipleStatements: true,
        })
      )
    )
  }
}
