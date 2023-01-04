import { MysqlError } from '../src/MysqlError';
import { createMysqlConnection } from '../src/v2/connection';

describe('Errors', () => {
  const conn = createMysqlConnection({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'test',
    port: 3306,
    debug: false,
    ssl: false,
  });

  it('errors on unclosed quote', async () => {
    await conn.connect();
    expect(conn.query('SELECT "hello')).rejects.toEqual(
      new MysqlError(
        "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '\"hello' at line 13",
        'ER_PARSE_ERROR',
        true
      )
    );
  });

  afterAll(conn.close);
});
