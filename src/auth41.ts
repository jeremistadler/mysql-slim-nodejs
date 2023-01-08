/*
4.1 authentication: (http://bazaar.launchpad.net/~mysql/mysql-server/5.5/view/head:/sql/password.c)

  SERVER:  public_seed=create_random_string()
           send(public_seed)

  CLIENT:  recv(public_seed)
           hash_stage1=sha1("password")
           hash_stage2=sha1(hash_stage1)
           reply=xor(hash_stage1, sha1(public_seed,hash_stage2)

           // this three steps are done in scramble()

           send(reply)


  SERVER:  recv(reply)
           hash_stage1=xor(reply, sha1(public_seed,hash_stage2))
           candidate_hash2=sha1(hash_stage1)
           check(candidate_hash2==hash_stage2)

server stores sha1(sha1(password)) ( hash_stag2)
*/

import { createHash } from 'node:crypto'

function sha1(
  msg: string | Buffer | Uint8Array,
  msg1?: string | Buffer | Uint8Array,
  msg2?: string | Buffer | Uint8Array
) {
  const hash = createHash('sha1')
  hash.update(msg)

  if (msg1) {
    hash.update(msg1)
  }

  if (msg2) {
    hash.update(msg2)
  }

  return hash.digest()
}

export function xor(a: string | Buffer, b: string | Buffer): Buffer {
  if (!Buffer.isBuffer(a)) {
    a = Buffer.from(a, 'binary')
  }

  if (!Buffer.isBuffer(b)) {
    b = Buffer.from(b, 'binary')
  }

  const result = Buffer.allocUnsafe(a.length)

  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i]
  }
  return result
}

export function calculateToken(
  password: string | Buffer,
  scramble1: string | Buffer,
  scramble2: string | Buffer
) {
  // TODO: use buffers (not sure why strings here)
  if (!password) {
    return Buffer.alloc(0)
  }
  const stage1 = sha1(password)
  return calculateTokenFromPasswordSha(stage1, scramble1, scramble2)
}

export const calculateTokenFromPasswordSha = function (
  passwordSha: string | Buffer,
  scramble1: string | Buffer,
  scramble2: string | Buffer
) {
  // we use AUTH 41 here, and we need only the bytes we just need.
  const authPluginData1 = scramble1.slice(0, 8)
  const authPluginData2 = scramble2.slice(0, 12)
  const stage2 = sha1(passwordSha)
  const stage3 = sha1(authPluginData1, authPluginData2, stage2)
  return xor(stage3, passwordSha)
}

export const verifyToken = function (
  publicSeed1: string | Buffer,
  publicSeed2: string | Buffer,
  token: string | Buffer,
  doubleSha: Uint8Array
) {
  const hashStage1 = xor(token, sha1(publicSeed1, publicSeed2, doubleSha))
  const candidateHash2 = sha1(hashStage1)
  return candidateHash2.compare(doubleSha) === 0
}

export const doubleSha1 = function (password: string) {
  return sha1(sha1(password))
}

export function xorRotating(a: string | Buffer, seed: string | Buffer) {
  if (!Buffer.isBuffer(a)) {
    a = Buffer.from(a, 'binary')
  }

  if (!Buffer.isBuffer(seed)) {
    seed = Buffer.from(seed, 'binary')
  }

  const result = Buffer.allocUnsafe(a.length)
  const seedLen = seed.length

  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ seed[i % seedLen]
  }
  return result
}
