import assert from 'assert';
import { createTestConnection } from '../createTestConnection';

const connectionPromise = createTestConnection();

const config = {
  table1: 'test82t1',
  table2: 'test82t2',
  view1: 'view82v1',
  view2: 'view82v2',
};

const prepareTestSet = async function () {
  const connection = await connectionPromise;

  await connection.execute(`drop table if exists ${config.table1}`);
  await connection.execute(`drop table if exists ${config.table2}`);
  await connection.execute(`drop view if exists ${config.view1}`);
  await connection.execute(`drop view if exists ${config.view2}`);
  await connection.execute(
    `create table ${config.table1} (name1 varchar(20), linkId1 integer(11))`
  );
  await connection.execute(
    `create table ${config.table2} (name2 varchar(20), linkId2 integer(11))`
  );
  await connection.execute(
    `insert into ${config.table1} (name1, linkId1) values ("A", 1),("B", 2),("C", 3),("D", 4)`
  );
  await connection.execute(
    `insert into ${config.table2} (name2, linkId2) values ("AA", 1),("BB", 2),("CC", 3),("DD", 4)`
  );
  await connection.execute(
    `create view ${config.view1} as select name1, linkId1, name2 from ${config.table1} INNER JOIN ${config.table2} ON linkId1 = linkId2`
  );
  await connection.execute(
    `create view ${config.view2} as select name1, name2 from ${config.view1}`
  );
};

prepareTestSet()
  .then(async () => {
    const conn = await connectionPromise;
    const result = await conn.query(
      `select * from ${config.view2} order by name2 desc`
    );
    await conn.close();

    console.log(result);

    assert.equal(result[0].name1, 'D');
    assert.equal(result[1].name1, 'C');
    assert.equal(result[2].name1, 'B');
    assert.equal(result[3].name1, 'A');
    assert.equal(result[0].name2, 'DD');
    assert.equal(result[1].name2, 'CC');
    assert.equal(result[2].name2, 'BB');
    assert.equal(result[3].name2, 'AA');
  })
  .catch((err) => {
    assert.fail(err);
  });
