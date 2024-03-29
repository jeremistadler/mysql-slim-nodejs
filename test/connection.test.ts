import { createMysqlConnection } from '../src/createMysqlConnection'

describe('Queries', () => {
  it('Select 1', async () => {
    const conn = createMysqlConnection({
      host: '127.0.0.1',
      user: 'test',
      password: 'testpassword',
      database: 'test',
      port: 3306,
      debug: false,
      ssl: false,
    })

    await conn.waitUntilConnected()

    await conn.close()
  })
})
