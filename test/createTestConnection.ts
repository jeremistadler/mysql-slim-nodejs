import { createMysqlConnection } from '../src/v2/connection';

export async function createTestConnection() {
  const conn = createMysqlConnection({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'test',
    port: 3306,
    debug: true,
    ssl: false,
  });

  await conn.connect();

  return conn;
}
