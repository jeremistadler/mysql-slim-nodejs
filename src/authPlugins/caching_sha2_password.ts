// https://mysqlserverteam.com/mysql-8-0-4-new-default-authentication-plugin-caching_sha2_password/

import { createHash, publicEncrypt } from 'node:crypto'
import { xor, xorRotating } from '../auth41'
import { Conn } from '../ConnectionType'

const PLUGIN_NAME = 'caching_sha2_password'

const REQUEST_SERVER_KEY_PACKET = Buffer.from([2])
const FAST_AUTH_SUCCESS_PACKET = Buffer.from([3])
const PERFORM_FULL_AUTHENTICATION_PACKET = Buffer.from([4])

const STATE_INITIAL = 0
const STATE_TOKEN_SENT = 1
const STATE_WAIT_SERVER_KEY = 2
const STATE_FINAL = -1

function sha256(msg: string) {
  const hash = createHash('sha256')
  hash.update(msg, 'binary')
  return hash.digest('binary')
}

function calculateToken(password: string, scramble: Buffer) {
  if (!password) {
    return Buffer.alloc(0)
  }
  const stage1 = sha256(Buffer.from(password, 'utf8').toString('binary'))
  const stage2 = sha256(stage1)
  const stage3 = sha256(stage2 + scramble.toString('binary'))
  return xor(stage1, stage3)
}

function encrypt(password: string, scramble: Buffer, key: Buffer) {
  const stage1 = xorRotating(
    Buffer.from(`${password}\0`, 'utf8').toString('binary'),
    scramble.toString('binary')
  )
  return publicEncrypt(key, stage1)
}

export function caching_sha2_password(connection: Conn) {
  let state = 0
  let scramble: Buffer | null = null

  const password = connection.config.password

  const authWithKey = (serverKey: Buffer) => {
    const _password = encrypt(password, scramble!, serverKey)
    state = STATE_FINAL
    return _password
  }

  return (data: Buffer) => {
    switch (state) {
      case STATE_INITIAL:
        scramble = data.subarray(0, 20)
        state = STATE_TOKEN_SENT
        return calculateToken(password, scramble)

      case STATE_TOKEN_SENT:
        if (FAST_AUTH_SUCCESS_PACKET.equals(data)) {
          state = STATE_FINAL
          return null
        }

        if (PERFORM_FULL_AUTHENTICATION_PACKET.equals(data)) {
          const isSecureConnection = connection.config.ssl
          if (isSecureConnection) {
            state = STATE_FINAL
            return Buffer.from(`${password}\0`, 'utf8')
          }

          // // if client provides key we can save one extra roundrip on first connection
          // if (pluginOptions.serverPublicKey) {
          //   return authWithKey(pluginOptions.serverPublicKey);
          // }

          state = STATE_WAIT_SERVER_KEY
          return REQUEST_SERVER_KEY_PACKET
        }
        throw new Error(
          `Invalid AuthMoreData packet received by ${PLUGIN_NAME} plugin in STATE_TOKEN_SENT state.`
        )
      case STATE_WAIT_SERVER_KEY:
        // if (pluginOptions.onServerPublicKey) {
        //   pluginOptions.onServerPublicKey(data);
        // }
        return authWithKey(data)
      case STATE_FINAL:
        throw new Error(
          `Unexpected data in AuthMoreData packet received by ${PLUGIN_NAME} plugin in STATE_FINAL state.`
        )
    }

    throw new Error(
      `Unexpected data in AuthMoreData packet received by ${PLUGIN_NAME} plugin in state ${state}`
    )
  }
}
