import { createMysqlConnection } from '../src/v2/connection';

const conn = createMysqlConnection({
  host: '127.0.0.1',
  user: 'test123',
  password: '123',
  database: 'test',
  port: 3306,
  debug: true,
  ssl: false,
});

async function run() {
  const r1 = await conn.query('SELECT * FROM test82t1');
  const r2 = await conn.query('SELECT * FROM test82t1');
}

conn
  .connect()
  .then(() => {})
  .then((result) => {
    console.log('GOT RESULT!', result);

    return conn.query('SELECT * FROM test82t1');
  });
