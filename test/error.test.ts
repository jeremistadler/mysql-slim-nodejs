import { MysqlError } from '../src/MysqlError';
import { createTestConnection } from './createTestConnection';

describe('Errors', () => {
  it('errors on unclosed quote', async () => {
    const conn = await createTestConnection();

    await expect(conn.query('SELECT "hello')).rejects.toEqual(
      new MysqlError(
        "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '\"hello' at line 1",
        'ER_PARSE_ERROR',
        true
      )
    );

    await conn.close();
  });
});
