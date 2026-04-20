import { enforceDbEffectSchemaParity, enforceDbJsonColumnEffectSchemaParity, enforceDbFactoryParity } from './db-schema-parity.mjs'
import { enforceDomainDirectoryContracts, enforceNoRootServiceBypass, enforceNoPromisePorts, enforceNoDefaultExportsInDdd } from './domain-structure.mjs'
import { enforceDbRepositoryDecodeContracts } from './repository-contracts.mjs'
import {
  enforceColocatedTestConventions,
  enforceApiIntegrationHarnessContracts,
  enforceApiHarnessPathResolutionContracts,
  enforceCriticalIntegrationCoverage,
  enforceWebIntegrationHarnessContracts,
  enforceGlobalIntegrationWorkspaceContracts,
  enforceTestFilesImportVitest,
  enforcePgTapTriggerCoverage
} from './test-contracts.mjs'
import { enforceWebApiGenerationContracts } from './web-api-contracts.mjs'
import {
  enforceNoSuppressionDirectives,
  enforceNoSourcePlaceholderComments,
  enforceNoBuildArtifactsInSource,
  enforceNoDirectProcessEnvInSource,
  enforceSingleRootEnvFilePolicy
} from './source-hygiene.mjs'
import { enforceRpcPlacement, enforceMigrationNamingConvention } from './temporal-contracts.mjs'
import { enforceApiMapperFieldCoverage } from './api-mapper-coverage.mjs'
import { enforcePortCreateMatchesSchema } from './port-create-coverage.mjs'
import { enforceMigrationCoversSchema } from './migration-coverage.mjs'
import { enforceDomainExtendsRowShape } from './domain-extends-parity.mjs'

export const runAllInvariants = () => {
  const errors = []

  enforceDbEffectSchemaParity(errors)
  enforceDbJsonColumnEffectSchemaParity(errors)
  enforceDbFactoryParity(errors)
  enforceDomainDirectoryContracts(errors)
  enforceNoRootServiceBypass(errors)
  enforceNoPromisePorts(errors)
  enforceDbRepositoryDecodeContracts(errors)
  enforceSingleRootEnvFilePolicy(errors)
  enforceNoSuppressionDirectives(errors)
  enforceWebApiGenerationContracts(errors)
  enforceColocatedTestConventions(errors)
  enforceApiIntegrationHarnessContracts(errors)
  enforceApiHarnessPathResolutionContracts(errors)
  enforceCriticalIntegrationCoverage(errors)
  enforceWebIntegrationHarnessContracts(errors)
  enforceGlobalIntegrationWorkspaceContracts(errors)
  enforcePgTapTriggerCoverage(errors)
  enforceNoDirectProcessEnvInSource(errors)
  enforceNoSourcePlaceholderComments(errors)
  enforceNoBuildArtifactsInSource(errors)
  enforceNoDefaultExportsInDdd(errors)
  enforceRpcPlacement(errors)
  enforceMigrationNamingConvention(errors)
  enforceTestFilesImportVitest(errors)
  enforceApiMapperFieldCoverage(errors)
  enforcePortCreateMatchesSchema(errors)
  enforceMigrationCoversSchema(errors)
  enforceDomainExtendsRowShape(errors)

  return errors
}
