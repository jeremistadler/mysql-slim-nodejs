import { MysqlError } from '../src/MysqlError';
import { createMysqlConnection } from '../src/v2/connection';
import { createTestConnection } from './createTestConnection';

describe('Errors', () => {
  const conn = createTestConnection();

  it('errors on unclosed quote', async () => {
    expect((await conn).query('SELECT "hello')).rejects.toEqual(
      new MysqlError(
        "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '\"hello' at line 13",
        'ER_PARSE_ERROR',
        true
      )
    );
  });

  afterAll(async () => (await conn).close());
});
