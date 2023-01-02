import { MysqlConnection } from '../src/connection';

describe('sum', () => {
  it('adds two numbers together', async () => {
    const conn = new MysqlConnection({
      host: '127.0.0.1',
      user: 'root',
      password: '',
      database: 'test',
      port: 3306,
      debug: false,
    });

    await conn.connect();

    await conn.close();
  });
});
