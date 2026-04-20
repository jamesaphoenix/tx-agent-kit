const unitConfig = require('./unit.cjs')
const { resolveIntegrationMaxWorkers } = require('./workers.cjs')

const integrationMaxWorkers = resolveIntegrationMaxWorkers()

const integrationConfig = {
  ...unitConfig,
  test: {
    ...unitConfig.test,
    testTimeout: 60000,
    hookTimeout: 60000,
    maxWorkers: integrationMaxWorkers,
    fileParallelism: integrationMaxWorkers > 1,
    pool: 'threads',
    isolate: false
  }
}

module.exports = integrationConfig
module.exports.integrationConfig = integrationConfig
