const seenOperations = new Set<string>()

export interface ProcessTaskInput {
  operationId: string
  taskId: string
  workspaceId: string
}

export const activities = {
  processTask: (input: ProcessTaskInput): Promise<{ operationId: string; alreadyProcessed: boolean }> => {
    if (seenOperations.has(input.operationId)) {
      return Promise.resolve({
        operationId: input.operationId,
        alreadyProcessed: true
      })
    }

    seenOperations.add(input.operationId)

    return Promise.resolve({
      operationId: input.operationId,
      alreadyProcessed: false
    })
  }
}
