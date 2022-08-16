import { MysqlConnection } from '../src/connection';

const conn = new MysqlConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'test',
  port: 3306,
});
