import { createMysqlConnection } from '../src/v2/connection';

const conn = createMysqlConnection({
  host: '127.0.0.1',
  user: 'test123',
  password: '123',
  database: 'test',
  port: 3306,
  debug: false,
  ssl: false,
});

async function run() {
  await conn.connect();

  for (let ii = 0; ii < 5; ii++) {
    const start = performance.now();
    const ITERS = 10000;
    for (let i = 0; i < ITERS; i++) {
      await conn.query('SELECT * FROM test82t1');
    }

    const end = performance.now();
    const timeDiff = end - start;

    console.log((ITERS / (timeDiff / 1000)).toFixed(0), 'queries / s');
  }

  await conn.close();
}

run();
