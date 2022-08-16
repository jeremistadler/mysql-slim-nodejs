import { MysqlConnection } from '../src/connection';

describe('sum', () => {
  it('adds two numbers together', async () => {
    const conn = new MysqlConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'test',
      port: 3306,
    });
  });
});
