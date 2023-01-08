import { createMysqlConnection } from '../src/createMysqlConnection'

export async function createTestConnection() {
  const conn = createMysqlConnection({
    host: '127.0.0.1',
    user: 'test',
    password: 'testpassword',
    database: 'test',
    port: 3306,
    debug: false,
    ssl: false,
  })

  await conn.waitUntilConnected()

  return conn
}
