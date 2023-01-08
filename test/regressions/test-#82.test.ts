import { createTestConnection } from '../createTestConnection'

it('Test regression 82', async () => {
  const conn = await createTestConnection()

  const config = {
    table1: 'test.test82t1',
    table2: 'test.test82t2',
    view1: 'test.view82v1',
    view2: 'test.view82v2',
  }

  await conn.execute(`drop table if exists ${config.table1}`)
  await conn.execute(`drop table if exists ${config.table2}`)
  await conn.execute(`drop view if exists ${config.view1}`)
  await conn.execute(`drop view if exists ${config.view2}`)
  await conn.execute(
    `create table ${config.table1} (name1 varchar(20), linkId1 integer(11))`
  )
  await conn.execute(
    `create table ${config.table2} (name2 varchar(20), linkId2 integer(11))`
  )
  await conn.execute(
    `insert into ${config.table1} (name1, linkId1) values ("A", 1),("B", 2),("C", 3),("D", 4)`
  )
  await conn.execute(
    `insert into ${config.table2} (name2, linkId2) values ("AA", 1),("BB", 2),("CC", 3),("DD", 4)`
  )
  await conn.execute(
    `create view ${config.view1} as select name1, linkId1, name2 from ${config.table1} INNER JOIN ${config.table2} ON linkId1 = linkId2`
  )
  await conn.execute(
    `create view ${config.view2} as select name1, name2 from ${config.view1}`
  )

  const result = await conn.query(
    `select * from ${config.view2} order by name2 desc`
  )
  await conn.close()

  expect(result[0].name1).toBe('D')
  expect(result[1].name1).toBe('C')
  expect(result[2].name1).toBe('B')
  expect(result[3].name1).toBe('A')
  expect(result[0].name2).toBe('DD')
  expect(result[1].name2).toBe('CC')
  expect(result[2].name2).toBe('BB')
  expect(result[3].name2).toBe('AA')
})
