'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import {
  CheckSquare,
  File,
  FileText,
  Film,
  FolderPlus,
  Folders,
  Image as ImageIcon,
  Music,
  Pencil,
  Plus,
  Square,
  Trash2,
  X
} from 'lucide-react'
import { DashboardShell } from '../../../../../../components/DashboardShell'
import { useCurrentPrincipal } from '../../../../../../hooks/use-session-store'
import {
  useAssetsListAssets,
  useAssetsListCollections,
  useAssetsListCollectionAssets,
  useAssetsGetAssetSignedUrl,
  useAssetsGetAssetThumbnailSignedUrl,
  assetsSoftDeleteAsset,
  assetsRequestUpload,
  assetsUploadContent,
  assetsConfirmUpload,
  assetsCreateCollection,
  assetsUpdateCollection,
  assetsRemoveCollection,
  assetsAddAssetToCollection,
  assetsRemoveAssetFromCollection,
  getAssetsListAssetsQueryKey,
  useAssetsSearchAssets,
  getAssetsSearchAssetsQueryKey,
  getAssetsListCollectionsQueryKey,
  getAssetsListCollectionAssetsQueryKey
} from '../../../../../../lib/api/generated/assets/assets'
import { notify } from '../../../../../../lib/notify'
import { resolveBrowserUrl } from '../../../../../../lib/url-state'
import type { AssetsListAssets200DataItem } from '../../../../../../lib/api/generated/schemas/assetsListAssets200DataItem'
import type { AssetsListCollections200DataItem } from '../../../../../../lib/api/generated/schemas/assetsListCollections200DataItem'
import { PermissionsGate } from '@/components/PermissionsGate'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'

type ViewMode = 'card' | 'list'
type AssetTypeFilter = 'all' | 'image' | 'video' | 'audio' | 'gif' | 'document'
type SortField = 'createdAt' | 'originalFilename' | 'fileSize'

const ASSET_TYPE_LABELS: Record<string, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  gif: 'GIF',
  document: 'Document'
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800'
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) {return `${bytes} B`}
  if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(1)} KB`}
  if (bytes < 1024 * 1024 * 1024) {return `${(bytes / (1024 * 1024)).toFixed(1)} MB`}
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

type MediaAssetResponse = AssetsListAssets200DataItem
type MediaCollectionResponse = AssetsListCollections200DataItem
type CollectionDialogMode = 'create' | 'edit'
const ASSET_PAGE_LIMIT = 25

type UploadQueueItem = {
  readonly id: string
  readonly name: string
  readonly size: number
  readonly status: 'pending' | 'uploading' | 'uploaded' | 'deduplicated' | 'failed'
  readonly error?: string
}

const AssetTypeIcon = ({ assetType }: { assetType: string }) => {
  const className = "h-5 w-5"
  if (assetType === 'image' || assetType === 'gif') {return <ImageIcon className={className} aria-hidden="true" />}
  if (assetType === 'video') {return <Film className={className} aria-hidden="true" />}
  if (assetType === 'audio') {return <Music className={className} aria-hidden="true" />}
  if (assetType === 'document') {return <FileText className={className} aria-hidden="true" />}
  return <File className={className} aria-hidden="true" />
}

const AssetPreview = ({
  asset,
  teamId,
  compact = false
}: {
  asset: MediaAssetResponse
  teamId: string
  compact?: boolean
}) => {
  const canRenderImage = asset.assetType === 'image' || asset.assetType === 'gif'
  const thumbnailQuery = useAssetsGetAssetThumbnailSignedUrl(teamId, asset.id, {
    query: {
      enabled: Boolean(asset.thumbnailPath),
      staleTime: 5 * 60 * 1000
    }
  })
  const originalQuery = useAssetsGetAssetSignedUrl(teamId, asset.id, {
    query: {
      enabled: canRenderImage && !asset.thumbnailPath,
      staleTime: 5 * 60 * 1000
    }
  })
  const previewUrl = thumbnailQuery.data?.url ?? originalQuery.data?.url ?? null

  if (canRenderImage && previewUrl) {
    return (
      <img
        src={previewUrl}
        alt={asset.originalFilename}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    )
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
      <AssetTypeIcon assetType={asset.assetType} />
      {!compact && (
        <span className="sr-only">
          {ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}
        </span>
      )}
    </div>
  )
}

export default function MediaPage() {
  const params = useParams<{ orgId: string; teamId: string }>()
  const { orgId, teamId } = params
  const principal = useCurrentPrincipal()
  const queryClient = useQueryClient()

  const [viewMode, setViewMode] = useState<ViewMode>('card')
  const [typeFilter, setTypeFilter] = useState<AssetTypeFilter>('all')
  const [sortField, setSortField] = useState<SortField>('createdAt')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCollectionId, setSelectedCollectionId] = useState('all')
  const [assetCursor, setAssetCursor] = useState<string | undefined>(undefined)
  const [assetCursorStack, setAssetCursorStack] = useState<ReadonlyArray<string>>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [assetToDelete, setAssetToDelete] = useState<MediaAssetResponse | null>(null)
  const [assetToAddToCollection, setAssetToAddToCollection] = useState<MediaAssetResponse | null>(null)
  const [addTargetCollectionId, setAddTargetCollectionId] = useState('')
  const [addingAssetToCollection, setAddingAssetToCollection] = useState(false)
  const [bulkAddTargetCollectionId, setBulkAddTargetCollectionId] = useState('')
  const [bulkAddingToCollection, setBulkAddingToCollection] = useState(false)
  const [bulkRemovingFromCollection, setBulkRemovingFromCollection] = useState(false)
  const [bulkDeletingAssets, setBulkDeletingAssets] = useState(false)
  const [showBulkAddDialog, setShowBulkAddDialog] = useState(false)
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false)
  const [selectedAssetIds, setSelectedAssetIds] = useState<ReadonlyArray<string>>([])
  const [removingAssetFromCollectionId, setRemovingAssetFromCollectionId] = useState<string | null>(null)
  const [showCollectionsManager, setShowCollectionsManager] = useState(false)
  const [showCollectionDialog, setShowCollectionDialog] = useState(false)
  const [collectionDialogMode, setCollectionDialogMode] = useState<CollectionDialogMode>('create')
  const [collectionFormName, setCollectionFormName] = useState('')
  const [collectionFormDescription, setCollectionFormDescription] = useState('')
  const [collectionToEdit, setCollectionToEdit] = useState<MediaCollectionResponse | null>(null)
  const [collectionToDelete, setCollectionToDelete] = useState<MediaCollectionResponse | null>(null)
  const [savingCollection, setSavingCollection] = useState(false)
  const [deletingCollection, setDeletingCollection] = useState(false)
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadQueue, setUploadQueue] = useState<ReadonlyArray<UploadQueueItem>>([])
  const [draggingUpload, setDraggingUpload] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedSearchQuery = searchQuery.trim()
  const resetAssetPagination = () => {
    setAssetCursor(undefined)
    setAssetCursorStack([])
    setSelectedAssetIds([])
  }
  const assetTypeFilterParam = typeFilter === 'all' ? undefined : typeFilter
  const commonAssetParams = {
    cursor: assetCursor,
    limit: String(ASSET_PAGE_LIMIT),
    sortBy: sortField,
    sortOrder,
    ...(assetTypeFilterParam ? { 'filter[assetType]': assetTypeFilterParam } : {})
  }
  const collectionsQuery = useAssetsListCollections(teamId, { sortBy: 'createdAt', sortOrder: 'desc' })
  const collections = collectionsQuery.data?.data ?? []
  const selectedCollection = selectedCollectionId === 'all'
    ? null
    : collections.find((collection) => collection.id === selectedCollectionId) ?? null
  const assetsQuery = useAssetsListAssets(teamId, commonAssetParams, {
    query: { enabled: selectedCollectionId === 'all' && trimmedSearchQuery.length === 0 }
  })
  const searchAssetsQuery = useAssetsSearchAssets(teamId, {
    cursor: assetCursor,
    limit: String(ASSET_PAGE_LIMIT),
    query: trimmedSearchQuery,
    sortBy: 'createdAt',
    sortOrder,
    ...(assetTypeFilterParam ? { 'filter[assetType]': assetTypeFilterParam } : {})
  }, {
    query: { enabled: selectedCollectionId === 'all' && trimmedSearchQuery.length > 0 }
  })
  const collectionAssetsQuery = useAssetsListCollectionAssets(teamId, selectedCollectionId, commonAssetParams, {
    query: { enabled: selectedCollectionId !== 'all' }
  })

  const activeAssetsQuery = (() => {
    if (selectedCollectionId !== 'all') {return collectionAssetsQuery}
    if (trimmedSearchQuery.length > 0) {return searchAssetsQuery}
    return assetsQuery
  })()
  const assets = (activeAssetsQuery.data?.data ?? [])
  const assetTotal = activeAssetsQuery.data?.total ?? 0
  const nextAssetCursor = activeAssetsQuery.data?.nextCursor ?? null
  const hasPreviousAssetPage = assetCursorStack.length > 0
  const showAssetPagination = assetTotal > 0
  const pageStart = assetTotal === 0 ? 0 : assetCursorStack.length * ASSET_PAGE_LIMIT + 1
  const pageEnd = assetTotal === 0 ? 0 : Math.min(pageStart + assets.length - 1, assetTotal)
  const loading = activeAssetsQuery.isLoading
  const collectionSubmitLabel = (() => {
    if (savingCollection) {return 'Saving...'}
    if (collectionDialogMode === 'create') {return 'Create'}
    return 'Save'
  })()

  useEffect(() => {
    if (selectedCollectionId === 'all') {return}
    if (collectionsQuery.isLoading) {return}
    const exists = collections.some((collection) => collection.id === selectedCollectionId)
    if (!exists) {
      setSelectedCollectionId('all')
      resetAssetPagination()
    }
  }, [collections, collectionsQuery.isLoading, selectedCollectionId])

  useEffect(() => {
    const currentAssetIds = new Set(assets.map((asset) => asset.id))
    setSelectedAssetIds((current) => {
      const next = current.filter((id) => currentAssetIds.has(id))
      return next.length === current.length ? current : next
    })
  }, [assets])

  const invalidateAssets = () => {
    void queryClient.invalidateQueries({ queryKey: getAssetsListAssetsQueryKey(teamId) })
    void queryClient.invalidateQueries({ queryKey: getAssetsSearchAssetsQueryKey(teamId) })
    if (selectedCollectionId !== 'all') {
      void queryClient.invalidateQueries({
        queryKey: getAssetsListCollectionAssetsQueryKey(teamId, selectedCollectionId)
      })
    }
  }

  const invalidateCollections = () => {
    void queryClient.invalidateQueries({ queryKey: getAssetsListCollectionsQueryKey(teamId) })
  }

  const toggleAssetSelection = (assetId: string) => {
    setSelectedAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId]
    )
  }

  const toggleAllVisibleAssets = () => {
    setSelectedAssetIds((current) => {
      const visibleIds = filteredAssets.map((asset) => asset.id)
      if (visibleIds.length === 0) {return current}
      if (visibleIds.every((id) => current.includes(id))) {
        return current.filter((id) => !visibleIds.includes(id))
      }
      return Array.from(new Set([...current, ...visibleIds]))
    })
  }

  const clearSelection = () => {
    setSelectedAssetIds([])
  }

  const handleNextPage = () => {
    if (!nextAssetCursor) {return}
    setAssetCursorStack((current) => [...current, assetCursor ?? ''])
    setAssetCursor(nextAssetCursor)
    clearSelection()
  }

  const handlePreviousPage = () => {
    if (assetCursorStack.length === 0) {return}
    const previousCursor = assetCursorStack[assetCursorStack.length - 1]
    setAssetCursorStack((current) => current.slice(0, -1))
    setAssetCursor(previousCursor && previousCursor.length > 0 ? previousCursor : undefined)
    clearSelection()
  }

  const filteredAssets = assets.filter((asset) => {
    if (typeFilter !== 'all' && asset.assetType !== typeFilter) {return false}
    if (selectedCollectionId !== 'all' && trimmedSearchQuery.length > 0) {
      const query = trimmedSearchQuery.toLowerCase()
      const matchesFilename = asset.originalFilename.toLowerCase().includes(query)
      const matchesTitle = asset.aiTitle?.toLowerCase().includes(query) ?? false
      const matchesDescription = asset.aiDescription?.toLowerCase().includes(query) ?? false
      if (!matchesFilename && !matchesTitle && !matchesDescription) {return false}
    }
    return true
  })
  const selectedAssetIdSet = new Set(selectedAssetIds)
  const selectedAssets = filteredAssets.filter((asset) => selectedAssetIdSet.has(asset.id))
  const allVisibleSelected = filteredAssets.length > 0 && filteredAssets.every((asset) => selectedAssetIdSet.has(asset.id))

  const handleDeleteClick = (asset: MediaAssetResponse) => {
    setAssetToDelete(asset)
    setShowDeleteDialog(true)
  }

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!assetToDelete || deletingId) {return}
    setDeletingId(assetToDelete.id)
    setError(null)
    try {
      await assetsSoftDeleteAsset(teamId, assetToDelete.id)
      setShowDeleteDialog(false)
      resetAssetPagination()
      setAssetToDelete(null)
      invalidateAssets()
    } catch (error) {
      const message = notify.apiError(error, 'Failed to delete asset')
      setError(message)
    } finally {
      setDeletingId(null)
    }
  }

  const openCreateCollectionDialog = () => {
    setCollectionDialogMode('create')
    setCollectionToEdit(null)
    setCollectionFormName('')
    setCollectionFormDescription('')
    setError(null)
    setShowCollectionDialog(true)
  }

  const openEditCollectionDialog = (collection: MediaCollectionResponse) => {
    setCollectionDialogMode('edit')
    setCollectionToEdit(collection)
    setCollectionFormName(collection.name)
    setCollectionFormDescription(collection.description ?? '')
    setError(null)
    setShowCollectionDialog(true)
  }

  const handleCollectionSubmit = async (): Promise<void> => {
    const name = collectionFormName.trim()
    if (name.length === 0 || savingCollection) {return}
    setSavingCollection(true)
    setError(null)

    try {
      const description = collectionFormDescription.trim()
      if (collectionDialogMode === 'create') {
        await assetsCreateCollection(teamId, {
          name,
          description: description.length > 0 ? description : null
        })
      } else if (collectionToEdit) {
        await assetsUpdateCollection(teamId, collectionToEdit.id, {
          name,
          description: description.length > 0 ? description : null
        })
      }
      invalidateCollections()
      setShowCollectionDialog(false)
      setCollectionToEdit(null)
      setCollectionFormName('')
      setCollectionFormDescription('')
    } catch (error) {
      const message = notify.apiError(error, 'Failed to save collection')
      setError(message)
    } finally {
      setSavingCollection(false)
    }
  }

  const handleDeleteCollection = async (): Promise<void> => {
    if (!collectionToDelete || deletingCollection) {return}
    setDeletingCollection(true)
    setError(null)

    try {
      await assetsRemoveCollection(teamId, collectionToDelete.id)
      if (selectedCollectionId === collectionToDelete.id) {
        setSelectedCollectionId('all')
        resetAssetPagination()
      }
      invalidateCollections()
      void queryClient.invalidateQueries({
        queryKey: getAssetsListCollectionAssetsQueryKey(teamId, collectionToDelete.id)
      })
      setCollectionToDelete(null)
    } catch (error) {
      const message = notify.apiError(error, 'Failed to delete collection')
      setError(message)
    } finally {
      setDeletingCollection(false)
    }
  }

  const openAddToCollectionDialog = (asset: MediaAssetResponse) => {
    setAssetToAddToCollection(asset)
    setAddTargetCollectionId(selectedCollectionId !== 'all' ? selectedCollectionId : collections[0]?.id ?? '')
    setError(null)
  }

  const handleAddToCollection = async (): Promise<void> => {
    if (!assetToAddToCollection || !addTargetCollectionId || addingAssetToCollection) {return}
    setAddingAssetToCollection(true)
    setError(null)

    try {
      await assetsAddAssetToCollection(teamId, addTargetCollectionId, {
        assetId: assetToAddToCollection.id
      })
      void queryClient.invalidateQueries({
        queryKey: getAssetsListCollectionAssetsQueryKey(teamId, addTargetCollectionId)
      })
      setAssetToAddToCollection(null)
      setAddTargetCollectionId('')
      notify.success('Asset added to collection')
    } catch (error) {
      const message = notify.apiError(error, 'Failed to add asset to collection')
      setError(message)
    } finally {
      setAddingAssetToCollection(false)
    }
  }

  const openBulkAddDialog = () => {
    setBulkAddTargetCollectionId(selectedCollectionId !== 'all' ? selectedCollectionId : collections[0]?.id ?? '')
    setError(null)
    setShowBulkAddDialog(true)
  }

  const handleBulkAddToCollection = async (): Promise<void> => {
    if (selectedAssetIds.length === 0 || !bulkAddTargetCollectionId || bulkAddingToCollection) {return}
    setBulkAddingToCollection(true)
    setError(null)

    try {
      const results = await Promise.allSettled(
        selectedAssetIds.map((assetId) =>
          assetsAddAssetToCollection(teamId, bulkAddTargetCollectionId, { assetId })
        )
      )
      const failed = results.filter((result) => result.status === 'rejected').length
      if (failed > 0) {
        throw new Error(`Failed to add ${failed} selected asset${failed === 1 ? '' : 's'} to the collection`)
      }
      void queryClient.invalidateQueries({
        queryKey: getAssetsListCollectionAssetsQueryKey(teamId, bulkAddTargetCollectionId)
      })
      setShowBulkAddDialog(false)
      setBulkAddTargetCollectionId('')
      clearSelection()
      notify.success('Assets added to collection')
    } catch (error) {
      const message = notify.apiError(error, 'Failed to add selected assets to collection')
      setError(message)
    } finally {
      setBulkAddingToCollection(false)
    }
  }

  const handleRemoveFromCollection = async (asset: MediaAssetResponse): Promise<void> => {
    if (selectedCollectionId === 'all' || removingAssetFromCollectionId) {return}
    setRemovingAssetFromCollectionId(asset.id)
    setError(null)

    try {
      await assetsRemoveAssetFromCollection(teamId, selectedCollectionId, asset.id)
      void queryClient.invalidateQueries({
        queryKey: getAssetsListCollectionAssetsQueryKey(teamId, selectedCollectionId)
      })
      notify.success('Asset removed from collection')
    } catch (error) {
      const message = notify.apiError(error, 'Failed to remove asset from collection')
      setError(message)
    } finally {
      setRemovingAssetFromCollectionId(null)
    }
  }

  const handleBulkRemoveFromCollection = async (): Promise<void> => {
    if (selectedCollectionId === 'all' || selectedAssetIds.length === 0 || bulkRemovingFromCollection) {return}
    setBulkRemovingFromCollection(true)
    setError(null)

    try {
      const results = await Promise.allSettled(
        selectedAssetIds.map((assetId) =>
          assetsRemoveAssetFromCollection(teamId, selectedCollectionId, assetId)
        )
      )
      const failed = results.filter((result) => result.status === 'rejected').length
      if (failed > 0) {
        throw new Error(`Failed to remove ${failed} selected asset${failed === 1 ? '' : 's'} from the collection`)
      }
      void queryClient.invalidateQueries({
        queryKey: getAssetsListCollectionAssetsQueryKey(teamId, selectedCollectionId)
      })
      clearSelection()
      notify.success('Assets removed from collection')
    } catch (error) {
      const message = notify.apiError(error, 'Failed to remove selected assets from collection')
      setError(message)
    } finally {
      setBulkRemovingFromCollection(false)
    }
  }

  const handleBulkDeleteConfirm = async (): Promise<void> => {
    if (selectedAssetIds.length === 0 || bulkDeletingAssets) {return}
    setBulkDeletingAssets(true)
    setError(null)

    try {
      const results = await Promise.allSettled(
        selectedAssetIds.map((assetId) => assetsSoftDeleteAsset(teamId, assetId))
      )
      const failed = results.filter((result) => result.status === 'rejected').length
      if (failed > 0) {
        throw new Error(`Failed to delete ${failed} selected asset${failed === 1 ? '' : 's'}`)
      }
      setShowBulkDeleteDialog(false)
      resetAssetPagination()
      invalidateAssets()
      notify.success('Assets deleted')
    } catch (error) {
      const message = notify.apiError(error, 'Failed to delete selected assets')
      setError(message)
    } finally {
      setBulkDeletingAssets(false)
    }
  }

  const browserHostName = resolveBrowserUrl('/').hostname
  const prefersLocalUploadProxy = browserHostName === 'localhost' || browserHostName === '127.0.0.1'

  const uploadSingleFile = async (file: File): Promise<'uploaded' | 'deduplicated'> => {
    const result = await assetsRequestUpload(teamId, {
      fileName: file.name,
      fileSize: file.size,
      contentHash: null,
      mimeType: file.type || 'application/octet-stream'
    })

    if (result.deduplicated) {
      return 'deduplicated'
    }

    if (prefersLocalUploadProxy) {
      await assetsUploadContent(teamId, result.uploadId, {
        data: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream'
        }
      })
    } else {
      const uploadResponse = await fetch(result.presignedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' }
      })

      if (!uploadResponse.ok) {
        const detail = (await uploadResponse.text()).trim()
        throw new Error(detail || `Upload failed with status ${uploadResponse.status}`)
      }
    }

    await assetsConfirmUpload(teamId, result.uploadId)
    return 'uploaded'
  }

  const handleUploadFiles = async (files: ReadonlyArray<File>): Promise<void> => {
    if (uploading) {return}
    const uploadFiles = files.filter((file) => file.size >= 0)
    if (uploadFiles.length === 0) {return}

    const queueItems = uploadFiles.map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      name: file.name,
      size: file.size,
      status: 'pending' as const
    }))

    setUploading(true)
    setUploadQueue(queueItems)
    setError(null)
    let uploadedCount = 0
    let failedCount = 0

    try {
      for (const [index, file] of uploadFiles.entries()) {
        const queueId = queueItems[index]?.id
        if (!queueId) {continue}
        setUploadQueue((current) => current.map((item) =>
          item.id === queueId ? { ...item, status: 'uploading' } : item
        ))

        try {
          const result = await uploadSingleFile(file)
          uploadedCount += 1
          setUploadQueue((current) => current.map((item) =>
            item.id === queueId ? { ...item, status: result } : item
          ))
        } catch (error) {
          failedCount += 1
          const message = notify.apiError(error, `Failed to upload ${file.name}`)
          setUploadQueue((current) => current.map((item) =>
            item.id === queueId ? { ...item, status: 'failed', error: message } : item
          ))
        }
      }

      if (uploadedCount > 0) {
        resetAssetPagination()
        invalidateAssets()
      }
      if (failedCount === 0) {
        setShowUploadDialog(false)
        setUploadQueue([])
      } else {
        setError(`Uploaded ${uploadedCount} file${uploadedCount === 1 ? '' : 's'}; ${failedCount} failed.`)
      }
    } finally {
      setUploading(false)
    }
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.currentTarget.value = ''
    if (files.length > 0) {
      void handleUploadFiles(files)
    }
  }

  const handleDropUpload = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDraggingUpload(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) {
      void handleUploadFiles(files)
    }
  }

  const handleSort = (field: SortField) => {
    resetAssetPagination()
    if (field === sortField) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  return (
    <DashboardShell
      title="Media"
      subtitle="Manage your team's media assets."
      principalEmail={principal?.email}
      orgId={orgId}
      teamId={teamId}
    >
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border" role="group" aria-label="View mode">
              <Button
                variant={viewMode === 'card' ? 'default' : 'ghost'}
                size="sm"
                className="rounded-r-none"
                onClick={() => setViewMode('card')}
                aria-pressed={viewMode === 'card'}
              >
                Cards
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="sm"
                className="rounded-l-none"
                onClick={() => setViewMode('list')}
                aria-pressed={viewMode === 'list'}
              >
                List
              </Button>
            </div>
            <Input
              placeholder="Search assets..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                resetAssetPagination()
              }}
              className="w-full sm:w-64"
              aria-label="Search assets"
            />
            <select
              value={selectedCollectionId}
              onChange={(e) => {
                setSelectedCollectionId(e.target.value)
                resetAssetPagination()
              }}
              className="h-9 cursor-pointer rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Filter by collection"
            >
              <option value="all">All media</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>{collection.name}</option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value as AssetTypeFilter)
                resetAssetPagination()
              }}
              className="h-9 cursor-pointer rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Filter by type"
            >
              <option value="all">All types</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
              <option value="audio">Audio</option>
              <option value="gif">GIFs</option>
              <option value="document">Documents</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PermissionsGate permission="manage_assets">
              <Button size="lg" variant="outline" onClick={() => setShowCollectionsManager(true)}>
                <Folders aria-hidden="true" />
                Collections
              </Button>
            </PermissionsGate>
            <PermissionsGate permission="upload_assets">
              <Button size="lg" onClick={() => setShowUploadDialog(true)}>
                <Plus aria-hidden="true" />
                Upload Asset
              </Button>
            </PermissionsGate>
          </div>
        </div>

        {selectedAssets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
            <span className="text-sm font-medium">{selectedAssets.length} selected</span>
            <PermissionsGate permission="manage_assets">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openBulkAddDialog}
                disabled={collections.length === 0}
              >
                <FolderPlus aria-hidden="true" />
                Add to collection
              </Button>
              {selectedCollection && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { void handleBulkRemoveFromCollection() }}
                  disabled={bulkRemovingFromCollection}
                >
                  <X aria-hidden="true" />
                  {bulkRemovingFromCollection ? 'Removing...' : 'Remove from collection'}
                </Button>
              )}
            </PermissionsGate>
            <PermissionsGate permission="delete_assets">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setShowBulkDeleteDialog(true)}
              >
                <Trash2 aria-hidden="true" />
                Delete selected
              </Button>
            </PermissionsGate>
            <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
              Clear
            </Button>
          </div>
        )}

        {/* Error */}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Loading */}
        {loading && assets.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        )}

        {/* Empty state */}
        {!loading && filteredAssets.length === 0 && !error && (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-sm">
              {assets.length === 0 ? 'No assets yet. Upload your first file to get started.' : 'No assets match your filters.'}
            </p>
          </div>
        )}

        {/* Card View */}
        {viewMode === 'card' && filteredAssets.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filteredAssets.map((asset) => (
              <Card key={asset.id} className="overflow-hidden">
                <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                  <AssetPreview asset={asset} teamId={teamId} />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="absolute left-2 top-2 h-8 w-8 bg-background/90 shadow-sm"
                    onClick={() => toggleAssetSelection(asset.id)}
                    aria-label={`${selectedAssetIdSet.has(asset.id) ? 'Deselect' : 'Select'} ${asset.originalFilename}`}
                  >
                    {selectedAssetIdSet.has(asset.id)
                      ? <CheckSquare className="h-4 w-4" aria-hidden="true" />
                      : <Square className="h-4 w-4" aria-hidden="true" />}
                  </Button>
                </div>
                <CardContent className="p-2.5">
                  <p className="text-sm font-medium truncate" title={asset.originalFilename}>
                    {asset.originalFilename}
                  </p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-muted-foreground">{formatFileSize(asset.fileSize)}</span>
                    <Badge variant="outline" className={`text-xs ${STATUS_COLORS[asset.processingStatus] ?? ''}`}>
                      {asset.processingStatus}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 mt-2">
                    <Badge variant="secondary" className="text-xs">
                      {ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}
                    </Badge>
                    <div className="ml-auto flex items-center gap-1">
                    <PermissionsGate permission="manage_assets">
                      {selectedCollectionId === 'all' ? (
                        collections.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => openAddToCollectionDialog(asset)}
                            aria-label={`Add ${asset.originalFilename} to collection`}
                          >
                            <FolderPlus className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        )
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => { void handleRemoveFromCollection(asset) }}
                          disabled={removingAssetFromCollectionId === asset.id}
                          aria-label={`Remove ${asset.originalFilename} from collection`}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </PermissionsGate>
                    <PermissionsGate permission="delete_assets">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive"
                        onClick={() => handleDeleteClick(asset)}
                        aria-label={`Delete ${asset.originalFilename}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </PermissionsGate>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* List View */}
        {viewMode === 'list' && filteredAssets.length > 0 && (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="h-9">
                  <TableHead className="w-10 px-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={toggleAllVisibleAssets}
                      aria-label={allVisibleSelected ? 'Deselect all visible assets' : 'Select all visible assets'}
                    >
                      {allVisibleSelected
                        ? <CheckSquare className="h-4 w-4" aria-hidden="true" />
                        : <Square className="h-4 w-4" aria-hidden="true" />}
                    </Button>
                  </TableHead>
                  <TableHead className="w-14 px-2">Preview</TableHead>
                  <TableHead
                    className="cursor-pointer select-none px-2"
                    onClick={() => handleSort('originalFilename')}
                  >
                    Filename {sortField === 'originalFilename' && (sortOrder === 'asc' ? '\u2191' : '\u2193')}
                  </TableHead>
                  <TableHead className="w-28 px-2">Type</TableHead>
                  <TableHead
                    className="w-24 cursor-pointer select-none px-2"
                    onClick={() => handleSort('fileSize')}
                  >
                    Size {sortField === 'fileSize' && (sortOrder === 'asc' ? '\u2191' : '\u2193')}
                  </TableHead>
                  <TableHead className="w-28 px-2">Status</TableHead>
                  <TableHead
                    className="w-32 cursor-pointer select-none px-2"
                    onClick={() => handleSort('createdAt')}
                  >
                    Created {sortField === 'createdAt' && (sortOrder === 'asc' ? '\u2191' : '\u2193')}
                  </TableHead>
                  <TableHead className="w-28 px-2 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAssets.map((asset) => (
                  <TableRow key={asset.id} className="h-14">
                    <TableCell className="px-2 py-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        onClick={() => toggleAssetSelection(asset.id)}
                        aria-label={`${selectedAssetIdSet.has(asset.id) ? 'Deselect' : 'Select'} ${asset.originalFilename}`}
                      >
                        {selectedAssetIdSet.has(asset.id)
                          ? <CheckSquare className="h-4 w-4" aria-hidden="true" />
                          : <Square className="h-4 w-4" aria-hidden="true" />}
                      </Button>
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      <div className="h-10 w-10 overflow-hidden rounded-md border bg-muted">
                        <AssetPreview asset={asset} teamId={teamId} compact />
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs truncate px-2 py-1.5 font-medium" title={asset.originalFilename}>
                      {asset.originalFilename}
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      <Badge variant="secondary" className="text-xs">
                        {ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-2 py-1.5 text-sm">{formatFileSize(asset.fileSize)}</TableCell>
                    <TableCell className="px-2 py-1.5">
                      <Badge variant="outline" className={`text-xs ${STATUS_COLORS[asset.processingStatus] ?? ''}`}>
                        {asset.processingStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-2 py-1.5 text-sm text-muted-foreground">
                      {new Date(asset.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      <div className="flex justify-end gap-1">
                      <PermissionsGate permission="manage_assets">
                        {selectedCollectionId === 'all' ? (
                          collections.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => openAddToCollectionDialog(asset)}
                              aria-label={`Add ${asset.originalFilename} to collection`}
                            >
                              <FolderPlus className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          )
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => { void handleRemoveFromCollection(asset) }}
                            disabled={removingAssetFromCollectionId === asset.id}
                            aria-label={`Remove ${asset.originalFilename} from collection`}
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        )}
                      </PermissionsGate>
                      <PermissionsGate permission="delete_assets">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive"
                          onClick={() => handleDeleteClick(asset)}
                          aria-label={`Delete ${asset.originalFilename}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </PermissionsGate>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {showAssetPagination && (
          <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Showing {pageStart}-{pageEnd} of {assetTotal}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePreviousPage}
                disabled={!hasPreviousAssetPage || loading}
                aria-label="Previous page"
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleNextPage}
                disabled={!nextAssetCursor || loading}
                aria-label="Next page"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Asset</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{assetToDelete?.originalFilename}&rdquo;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => { void handleDeleteConfirm() }}
              disabled={!!deletingId}
            >
              {deletingId ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk delete confirmation dialog */}
      <Dialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Selected Assets</DialogTitle>
            <DialogDescription>
              Delete {selectedAssets.length} selected asset{selectedAssets.length === 1 ? '' : 's'}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => { void handleBulkDeleteConfirm() }}
              disabled={bulkDeletingAssets}
            >
              {bulkDeletingAssets ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Collections manager dialog */}
      <Dialog open={showCollectionsManager} onOpenChange={setShowCollectionsManager}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Collections</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <p className="text-sm font-medium">All media</p>
                <p className="text-xs text-muted-foreground">{assetsQuery.data?.total ?? assets.length} assets</p>
              </div>
              <Button
                type="button"
                variant={selectedCollectionId === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setSelectedCollectionId('all')
                  resetAssetPagination()
                  setShowCollectionsManager(false)
                }}
              >
                View
              </Button>
            </div>
            {collections.map((collection) => (
              <div key={collection.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{collection.name}</p>
                  {collection.description && (
                    <p className="truncate text-xs text-muted-foreground">{collection.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant={selectedCollectionId === collection.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setSelectedCollectionId(collection.id)
                      resetAssetPagination()
                      setShowCollectionsManager(false)
                    }}
                  >
                    View
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => {
                      setShowCollectionsManager(false)
                      openEditCollectionDialog(collection)
                    }}
                    aria-label={`Edit ${collection.name}`}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive"
                    onClick={() => {
                      setShowCollectionsManager(false)
                      setCollectionToDelete(collection)
                    }}
                    aria-label={`Delete ${collection.name}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCollectionsManager(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setShowCollectionsManager(false)
                openCreateCollectionDialog()
              }}
            >
              <FolderPlus aria-hidden="true" />
              New Collection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Collection create/edit dialog */}
      <Dialog open={showCollectionDialog} onOpenChange={setShowCollectionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {collectionDialogMode === 'create' ? 'New Collection' : 'Edit Collection'}
            </DialogTitle>
            <DialogDescription>
              Organize media into reusable groups for campaigns and creative workflows.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Collection name</span>
              <Input
                value={collectionFormName}
                onChange={(event) => setCollectionFormName(event.target.value)}
                maxLength={128}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Collection description</span>
              <textarea
                value={collectionFormDescription}
                onChange={(event) => setCollectionFormDescription(event.target.value)}
                className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCollectionDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => { void handleCollectionSubmit() }}
              disabled={savingCollection || collectionFormName.trim().length === 0}
            >
              {collectionSubmitLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Collection delete confirmation dialog */}
      <Dialog open={!!collectionToDelete} onOpenChange={(open) => {
        if (!open) { setCollectionToDelete(null) }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Collection</DialogTitle>
            <DialogDescription>
              Delete &ldquo;{collectionToDelete?.name}&rdquo;? The assets will remain in your media library.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCollectionToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => { void handleDeleteCollection() }}
              disabled={deletingCollection}
            >
              {deletingCollection ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add asset to collection dialog */}
      <Dialog open={!!assetToAddToCollection} onOpenChange={(open) => {
        if (!open) {
          setAssetToAddToCollection(null)
          setAddTargetCollectionId('')
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Collection</DialogTitle>
            <DialogDescription>
              Add &ldquo;{assetToAddToCollection?.originalFilename}&rdquo; to a media collection.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Target collection</span>
              <select
                value={addTargetCollectionId}
                onChange={(event) => setAddTargetCollectionId(event.target.value)}
                className="h-9 cursor-pointer rounded-md border border-input bg-background px-3 text-sm"
              >
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>{collection.name}</option>
                ))}
              </select>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssetToAddToCollection(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => { void handleAddToCollection() }}
              disabled={addingAssetToCollection || addTargetCollectionId.length === 0}
            >
              {addingAssetToCollection ? 'Adding...' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk add to collection dialog */}
      <Dialog open={showBulkAddDialog} onOpenChange={(open) => {
        setShowBulkAddDialog(open)
        if (!open) { setBulkAddTargetCollectionId('') }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Selected Assets</DialogTitle>
            <DialogDescription>
              Add {selectedAssets.length} selected asset{selectedAssets.length === 1 ? '' : 's'} to a media collection.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Target collection</span>
              <select
                value={bulkAddTargetCollectionId}
                onChange={(event) => setBulkAddTargetCollectionId(event.target.value)}
                className="h-9 cursor-pointer rounded-md border border-input bg-background px-3 text-sm"
              >
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>{collection.name}</option>
                ))}
              </select>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkAddDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => { void handleBulkAddToCollection() }}
              disabled={bulkAddingToCollection || bulkAddTargetCollectionId.length === 0}
            >
              {bulkAddingToCollection ? 'Adding...' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Assets</DialogTitle>
            <DialogDescription>
              Select one or more files to upload to your team's media library.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <label
              htmlFor="file-upload"
              data-testid="asset-upload-dropzone"
              onDragEnter={(event) => {
                event.preventDefault()
                setDraggingUpload(true)
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setDraggingUpload(true)
              }}
              onDragLeave={(event) => {
                event.preventDefault()
                setDraggingUpload(false)
              }}
              onDrop={handleDropUpload}
              className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer transition-colors hover:bg-muted/50 ${
                draggingUpload ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              <p className="text-sm text-muted-foreground">
                {uploading ? 'Uploading...' : 'Click to select files or drop them here'}
              </p>
              <input
                id="file-upload"
                type="file"
                className="hidden"
                onChange={handleFileSelect}
                disabled={uploading}
                accept="image/*,video/*,audio/*,.gif,.pdf,.doc,.docx"
                multiple
              />
            </label>
            {uploadQueue.length > 0 && (
              <div className="max-h-52 space-y-2 overflow-y-auto rounded-md border p-2">
                {uploadQueue.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium" title={item.name}>{item.name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(item.size)}</p>
                      {item.error && <p className="text-xs text-destructive">{item.error}</p>}
                    </div>
                    <Badge
                      variant={item.status === 'failed' ? 'destructive' : 'secondary'}
                      className="shrink-0 text-xs"
                    >
                      {item.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  )
}
