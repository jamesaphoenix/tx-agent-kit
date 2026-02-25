'use client'

import type {
  CreateParams,
  CreateResult,
  DataProvider,
  DeleteManyParams,
  DeleteManyResult,
  DeleteParams,
  DeleteResult,
  GetListParams,
  GetListResult,
  GetManyParams,
  GetManyReferenceParams,
  GetManyReferenceResult,
  GetManyResult,
  GetOneParams,
  GetOneResult,
  Identifier,
  RaRecord,
  UpdateManyParams,
  UpdateManyResult,
  UpdateParams,
  UpdateResult
} from 'react-admin'
import { api } from '../axios'
import { cursorCache } from './cursor-cache'
import type { CursorPaginatedResponse } from './data-provider.types'
import { ADMIN_RESOURCES, type AdminResourceName } from './resource-registry'

const toResourceName = (resource: string): AdminResourceName => {
  if (resource in ADMIN_RESOURCES) {
    return resource as AdminResourceName
  }

  throw new Error(`Unsupported admin resource: ${resource}`)
}

const toSortOrder = (order: string | undefined): 'asc' | 'desc' =>
  order?.toLowerCase() === 'asc' ? 'asc' : 'desc'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const toFilterRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {}

const toFilterParams = (filter: Record<string, unknown>): Record<string, string> => {
  const params: Record<string, string> = {}

  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null || value === '') {
      continue
    }

    if (typeof value === 'string') {
      params[`filter[${key}]`] = value
      continue
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      params[`filter[${key}]`] = `${value}`
    }
  }

  return params
}

const toIdentifier = (value: unknown, fieldName: string): Identifier => {
  if (typeof value === 'string' || typeof value === 'number') {
    return value
  }

  throw new Error(`Invalid identifier for ${fieldName}`)
}

const toIdentifierArray = (value: unknown, fieldName: string): Identifier[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid identifier list for ${fieldName}`)
  }

  return value.map((entry, index) => toIdentifier(entry, `${fieldName}[${index}]`))
}

const buildCursorCacheKey = (resource: string, params: GetListParams): string => {
  const perPage = params.pagination?.perPage ?? 25
  const sortField = params.sort?.field ?? 'id'
  const sortOrder = toSortOrder(params.sort?.order)
  const filter = toFilterRecord(params.filter as unknown)

  return JSON.stringify({ resource, perPage, sortField, sortOrder, filter })
}

const endpointForId = (endpoint: string, id: Identifier): string =>
  `${endpoint}/${encodeURIComponent(`${id}`)}`

const getOneRecord = async (resource: string, id: Identifier): Promise<RaRecord> => {
  const resourceName = toResourceName(resource)
  const config = ADMIN_RESOURCES[resourceName]
  const response = await api.get<RaRecord>(endpointForId(config.endpoint, id))
  return response.data
}

const updateRecord = async (resource: string, id: Identifier, payload: unknown): Promise<RaRecord> => {
  const resourceName = toResourceName(resource)
  const config = ADMIN_RESOURCES[resourceName]
  const response = await api.patch<RaRecord>(endpointForId(config.endpoint, id), payload)
  return response.data
}

const deleteRecord = async (resource: string, id: Identifier): Promise<RaRecord> => {
  const resourceName = toResourceName(resource)
  const config = ADMIN_RESOURCES[resourceName]
  const response = await api.delete<RaRecord>(endpointForId(config.endpoint, id))
  return response.data
}

const getList = async <RecordType extends RaRecord = RaRecord>(
  resource: string,
  params: GetListParams
): Promise<GetListResult<RecordType>> => {
  const resourceName = toResourceName(resource)
  const config = ADMIN_RESOURCES[resourceName]

  const page = params.pagination?.page ?? 1
  const perPage = params.pagination?.perPage ?? 25
  const sortBy = params.sort?.field ?? config.defaultSortBy
  const sortOrder = toSortOrder(params.sort?.order)
  const filter = toFilterRecord(params.filter as unknown)

  const cacheKey = buildCursorCacheKey(resource, params)
  cursorCache.ensureFirstPage(cacheKey)
  const cursor = cursorCache.getCursor(cacheKey, page)

  const queryParams: Record<string, string> = {
    limit: `${perPage}`,
    sortBy,
    sortOrder,
    ...toFilterParams(filter)
  }

  if (cursor) {
    queryParams.cursor = cursor
  }

  const response = await api.get<CursorPaginatedResponse<RecordType>>(config.endpoint, {
    params: queryParams
  })

  cursorCache.setCursor(cacheKey, page + 1, response.data.nextCursor)

  return {
    data: response.data.data,
    total: response.data.total
  }
}

const getOne = async <RecordType extends RaRecord = RaRecord>(
  resource: string,
  params: GetOneParams<RecordType>
): Promise<GetOneResult<RecordType>> => {
  const id = toIdentifier(params.id as unknown, 'getOne.id')
  const data = await getOneRecord(resource, id)

  return { data: data as RecordType }
}

const getMany = async <RecordType extends RaRecord = RaRecord>(
  resource: string,
  params: GetManyParams<RecordType>
): Promise<GetManyResult<RecordType>> => {
  const ids = toIdentifierArray(params.ids as unknown, 'getMany.ids')
  const resourceName = toResourceName(resource)
  const config = ADMIN_RESOURCES[resourceName]
  const response = await api.post<{ data: RecordType[] }>(`${config.endpoint}/batch/get-many`, { ids })

  return { data: response.data.data }
}

const getManyReference = async <RecordType extends RaRecord = RaRecord>(
  resource: string,
  params: GetManyReferenceParams
): Promise<GetManyReferenceResult<RecordType>> => {
  const filter: Record<string, unknown> = {
    ...toFilterRecord(params.filter as unknown),
    [params.target]: params.id
  }

  return getList<RecordType>(resource, {
    pagination: params.pagination,
    sort: params.sort,
    filter,
    signal: params.signal
  })
}

const create = async <
  RecordType extends Omit<RaRecord, 'id'> = Omit<RaRecord, 'id'>,
  ResultRecordType extends RaRecord = RecordType & { id: Identifier }
>(
  resource: string,
  params: CreateParams<RecordType>
): Promise<CreateResult<ResultRecordType>> => {
  const resourceName = toResourceName(resource)
  const config = ADMIN_RESOURCES[resourceName]
  const response = await api.post<ResultRecordType>(config.endpoint, params.data)
  cursorCache.clearAll()

  return { data: response.data }
}

const update = async <RecordType extends RaRecord = RaRecord>(
  resource: string,
  params: UpdateParams<RecordType>
): Promise<UpdateResult<RecordType>> => {
  const id = toIdentifier(params.id as unknown, 'update.id')
  const data = await updateRecord(resource, id, params.data)
  cursorCache.clearAll()

  return { data: data as RecordType }
}

const updateMany = async <RecordType extends RaRecord = RaRecord>(
  resource: string,
  params: UpdateManyParams<RecordType>
): Promise<UpdateManyResult<RecordType>> => {
  const ids = toIdentifierArray(params.ids as unknown, 'updateMany.ids')
  const updatedRows = await Promise.all(ids.map((id) => updateRecord(resource, id, params.data)))
  const updatedIds = updatedRows.map((row) =>
    toIdentifier(row.id, 'updateMany.result.id') as RecordType['id']
  )

  cursorCache.clearAll()
  return { data: updatedIds }
}

const remove = async <RecordType extends RaRecord = RaRecord>(
  resource: string,
  params: DeleteParams<RecordType>
): Promise<DeleteResult<RecordType>> => {
  const id = toIdentifier(params.id as unknown, 'delete.id')
  const data = await deleteRecord(resource, id)
  cursorCache.clearAll()

  return { data: data as RecordType }
}

const removeMany = async <RecordType extends RaRecord = RaRecord>(
  resource: string,
  params: DeleteManyParams<RecordType>
): Promise<DeleteManyResult<RecordType>> => {
  const ids = toIdentifierArray(params.ids as unknown, 'deleteMany.ids')
  const deletedRows = await Promise.all(ids.map((id) => deleteRecord(resource, id)))
  const deletedIds = deletedRows.map((row) =>
    toIdentifier(row.id, 'deleteMany.result.id') as RecordType['id']
  )

  cursorCache.clearAll()
  return { data: deletedIds }
}

export const dataProvider: DataProvider = {
  getList,
  getOne,
  getMany,
  getManyReference,
  create,
  update,
  updateMany,
  delete: remove,
  deleteMany: removeMany
}
