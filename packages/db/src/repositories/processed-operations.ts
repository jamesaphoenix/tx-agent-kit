import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import {
  processedOperationRowSchema,
  type ProcessedOperationRowShape
} from '../effect-schemas/processed-operations.js'
import { dbDecodeFailed, toDbError, type DbError } from '../errors.js'
import { processedOperations } from '../schema.js'

const decodeProcessedOperationRow = Schema.decodeUnknown(processedOperationRowSchema)

const decodeNullableProcessedOperation = (
  value: unknown
): Effect.Effect<ProcessedOperationRowShape | null, DbError> => {
  if (value === null || value === undefined) {
    return Effect.succeed(null)
  }

  return decodeProcessedOperationRow(value).pipe(
    Effect.mapError((error) => dbDecodeFailed('processed operation row decode failed', error))
  )
}

export const processedOperationsRepository = {
  markProcessed: (input: { operationId: string; workspaceId: string; taskId: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const insertedRows = yield* db
          .insert(processedOperations)
          .values(input)
          .onConflictDoNothing()
          .returning()
          .execute()

        const inserted = yield* decodeNullableProcessedOperation(insertedRows[0] ?? null)
        if (!inserted) {
          return {
            operationId: input.operationId,
            alreadyProcessed: true
          }
        }

        return {
          operationId: inserted.operationId,
          alreadyProcessed: false
        }
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to mark operation as processed', error)))
}
