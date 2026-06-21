import { resetPool } from '@tx-agent-kit/db'
import { closeRedisClients } from '@tx-agent-kit/redis'
import { afterAll } from 'vitest'

// Worker integration suites run under pool:'threads' with isolate:false, so a
// single thread is reused across files within a worker slot. getPool() opens a
// module-singleton pg Pool with idleTimeoutMillis 30s, and the redis client
// registry holds long-lived ioredis sockets; both keep the worker thread alive
// after the last test finishes, which vitest reports as "Worker exited
// unexpectedly" and resolves by force-killing the thread.
//
// Registering the teardown here (rather than per file) means no individual test
// can forget it. The hook mirrors the runtime shutdown path
// (apps/api/src/server-lib.ts, apps/worker/src/index.ts): connections are leased
// and released correctly during the tests, so ending the pool object and
// disconnecting the redis clients is risk-free.
afterAll(async () => {
  await Promise.all([resetPool(), closeRedisClients()])
})
