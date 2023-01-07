import { createTestConnection } from './createTestConnection';

describe('InsertAndQuery', () => {
  it('products', async () => {
    const conn = await createTestConnection();

    await conn.execute('DROP TABLE IF EXISTS products');

    await conn.execute(`
    CREATE TABLE products (
        product_id INT AUTO_INCREMENT PRIMARY KEY,
        product_item VARCHAR(255) NOT NULL,

        use_by DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        price FLOAT,
        popularity DOUBLE,
        
        description_short TINYTEXT,
        description TEXT,
        description_long LONGTEXT,

        image BLOB,

        size enum ('small', 'medium', 'large') NOT NULL,


        myset SET('Travel','Sports','Dancing','Fine Dining')
    );
    `);

    const itemName = 'Hello World! åäö';
    const price = 1.234;
    const image = Buffer.from('abc');

    await conn.execute(`
        INSERT INTO products
        SET product_item = '${itemName}',

        use_by = ${dateToString(new Date('2023-01-07T13:39:01.000Z'))},

        price = ${price},
        popularity = ${price},

        image = X'${image.toString('hex')}',

        description_short = "${itemName}",
        description = "${itemName}",
        description_long = "${itemName}",
        size = 'medium',
        myset = 'Dancing'
    `);

    console.log('Inserted!');

    const result = await conn.query('SELECT * FROM products');
    expect(result).toMatchSnapshot();

    await conn.close();
  });
});

function dateToString(date: Date) {
  var dt = new Date(date);

  if (isNaN(dt.getTime())) {
    return 'NULL';
  }
  const year = dt.getUTCFullYear();
  const month = dt.getUTCMonth() + 1;
  const day = dt.getUTCDate();
  const hour = dt.getUTCHours();
  const minute = dt.getUTCMinutes();
  const second = dt.getUTCSeconds();
  const millisecond = dt.getUTCMilliseconds();

  // YYYY-MM-DD HH:mm:ss.mmm
  var str =
    zeroPad(year, 4) +
    '-' +
    zeroPad(month, 2) +
    '-' +
    zeroPad(day, 2) +
    ' ' +
    zeroPad(hour, 2) +
    ':' +
    zeroPad(minute, 2) +
    ':' +
    zeroPad(second, 2) +
    '.' +
    zeroPad(millisecond, 3);

  return '"' + str + '"';
}

function zeroPad(num: number, length: number) {
  let str = num.toString();
  while (str.length < length) {
    str = '0' + str;
  }

  return str;
}
