const { resolveUnitMaxWorkers } = require('./workers.cjs')

const unitMaxWorkers = resolveUnitMaxWorkers()

const unitConfig = {
  test: {
    environment: 'node',
    pool: 'forks',
    maxWorkers: unitMaxWorkers,
    isolate: true,
    fileParallelism: unitMaxWorkers > 1,
    passWithNoTests: false,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      '**/.next/**',
      '**/.turbo/**'
    ]
  }
}

module.exports = unitConfig
module.exports.unitConfig = unitConfig
