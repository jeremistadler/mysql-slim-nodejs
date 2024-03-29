import { randomBytes } from 'crypto'
import { createTestConnection } from './createTestConnection'

describe('Queries', () => {
  const conn = createTestConnection()

  it('Select 1', async () => {
    const result = await (await conn).query('SELECT 1')
    expect(result).toEqual([{ '1': 1 }])
  })

  it('Select Hello', async () => {
    const result = await (await conn).query('SELECT "Hello"')
    expect(result).toEqual([{ Hello: 'Hello' }])
  })

  it('Select Now', async () => {
    const result = await (await conn).query('SELECT NOW() AS now')
    expect(result).toHaveLength(1)
    expect(typeof result[0].now).toBe('object')
    expect(typeof result[0].now).not.toBeNull()
  })

  it('Select roundtrip datetime', async () => {
    const now = new Date()
    const result = await (
      await conn
    ).query('SELECT FROM_UNIXTIME(' + now.getTime() + ' / 1000) AS now')
    expect(result[0].now).toEqual(now)
  })

  it('Select random ints one at a time', async () => {
    for (let i = 0; i < 100; i++) {
      const int = randomIntFromInterval(
        Number.MIN_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER
      )
      const result = await (await conn).query('SELECT ' + int + ' AS t1')
      expect(result[0].t1).toEqual(int)
    }
  })

  it('Select random ints in one query', async () => {
    const numbers: number[] = []

    for (let i = 0; i < 100; i++) {
      const int = randomIntFromInterval(
        Number.MIN_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER
      )
      numbers.push(int)
    }

    const result = await (
      await conn
    ).query(
      'SELECT ' +
        numbers[0] +
        ' AS t1 ' +
        numbers
          .slice(1)
          .map(num => `UNION SELECT ${num}`)
          .join(' ')
    )
    expect(result.map(f => f.t1)).toEqual(numbers)
  })

  it('Select random doubles in one query', async () => {
    const numbers: number[] = []

    for (let i = 0; i < 1; i++) {
      const int = Math.random()
      numbers.push(int)
    }

    const result = await (
      await conn
    ).query(
      'SELECT ' +
        numbers[0] +
        ' AS t1 ' +
        numbers
          .slice(1)
          .map(num => `UNION SELECT ${num}`)
          .join(' ')
    )
    expect(result).toHaveLength(numbers.length)
    result.forEach((num, index) => {
      expect(num.t1).toBeCloseTo(numbers[index])
    })
  })

  it('Select different data types', async () => {
    const result = await (
      await conn
    ).query(
      `-- Test Comment
      SELECT 
       NULL AS t1, 
       1 AS t2,
       -100000 AS t3,
       0 AS t4
      `
    )
    expect(result).toEqual([
      {
        t1: null,
        t2: 1,
        t3: -100000,
        t4: 0,
      },
    ])
  })

  it('Select large string', async () => {
    const largeString = randomBytes(16777215).toString('hex')
    const result = await (await conn).query(`SELECT '${largeString}' AS t1`)
    expect(result).toEqual([
      {
        t1: largeString,
      },
    ])
  })

  it('Select twice in a row', async () => {
    const con = await conn

    const a = con.query('SELECT "a"')
    const b = con.query('SELECT "b"')
    const c = con.query('SELECT "c"')

    const result = await con.query('SELECT "d"')
    expect(result).toEqual([{ d: 'd' }])
  })

  afterAll(async () => (await conn).close())
})

function randomIntFromInterval(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1) + min)
}
