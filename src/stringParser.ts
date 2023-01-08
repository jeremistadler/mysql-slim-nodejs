export function decodeString(
  buffer: Buffer,
  encoding: string,
  start: number,
  end: number
) {
  if (encoding === 'utf8' || encoding === 'cesu8') {
    return buffer.toString('utf8', start, end)
  }

  if (Buffer.isEncoding(encoding)) {
    return buffer.toString(encoding, start, end)
  }

  console.error('Unsupported encoding', encoding, 'using latin')

  return buffer.toString('latin1', start, end)
}

export function encodeString(string: string, encoding: string) {
  if (Buffer.isEncoding(encoding)) {
    return Buffer.from(string, encoding)
  }

  console.error('Unsupported encoding', encoding, 'using latin')

  return Buffer.from(string, 'latin1')
}
