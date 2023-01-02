import { createMysqlConnection } from '../src/v2/connection';

describe('sum', () => {
  it('adds two numbers together', async () => {
    const conn = createMysqlConnection({
      host: '127.0.0.1',
      user: 'root',
      password: '',
      database: 'test',
      port: 3306,
      debug: false,
      ssl: false,
    });

    await conn.connect();

    await conn.close();
  });
});
