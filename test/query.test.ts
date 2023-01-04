import { createMysqlConnection } from '../src/v2/connection';

describe('Queries', () => {
  const conn = createMysqlConnection({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'test',
    port: 3306,
    debug: false,
    ssl: false,
  });

  it('Select 1', async () => {
    await conn.connect();
    const result = await conn.query('SELECT 1');
    expect(result).toEqual([{ '1': 1 }]);
  });

  it('Select Hello', async () => {
    await conn.connect();
    const result = await conn.query('SELECT "Hello"');
    expect(result).toEqual([{ Hello: 'Hello' }]);
  });

  it('Select Now', async () => {
    await conn.connect();
    const result = await conn.query('SELECT NOW() AS now');
    expect(result).toHaveLength(1);
    expect(typeof result[0].now).toBe('object');
    expect(typeof result[0].now).not.toBeNull();
  });

  it('Select roundtrip datetime', async () => {
    await conn.connect();
    const now = new Date();
    const result = await conn.query(
      'SELECT FROM_UNIXTIME(' + now.getTime() + ' / 1000) AS now'
    );
    expect(result[0].now).toEqual(now);
  });

  afterAll(conn.close);
});
