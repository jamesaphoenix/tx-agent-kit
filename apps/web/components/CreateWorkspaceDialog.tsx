'use client'

import { useEffect, useState, type SyntheticEvent } from 'react'
import {
  BrandSettingsFields,
  defaultBrandSettingsValues,
  type BrandSettingsValues
} from './BrandSettingsFields'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'

export interface CreateWorkspaceDialogInput {
  name: string
  website?: string | null
  brandSettings: BrandSettingsValues
}

interface CreateWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: CreateWorkspaceDialogInput) => void | Promise<void>
  isCreating?: boolean
  initialName?: string
}

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreate,
  isCreating = false,
  initialName = ''
}: CreateWorkspaceDialogProps) {
  const [name, setName] = useState(initialName)
  const [website, setWebsite] = useState('')
  const [brandSettings, setBrandSettings] = useState<BrandSettingsValues>(defaultBrandSettingsValues)

  useEffect(() => {
    if (!open) {
      return
    }

    setName(initialName)
    setWebsite('')
    setBrandSettings(defaultBrandSettingsValues)
  }, [initialName, open])

  const trimmedName = name.trim()

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (trimmedName.length < 2 || isCreating) {
      return
    }

    void onCreate({
      name: trimmedName,
      website: normalizeWebsite(website),
      brandSettings
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label="Create workspace" className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>
            Start with a name, website, and brand defaults. You can refine the palette later.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-workspace-name">Workspace name</Label>
              <Input
                id="create-workspace-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Workspace name"
                minLength={2}
                maxLength={64}
                required
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-workspace-website">Website</Label>
              <Input
                id="create-workspace-website"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder="example.com"
                inputMode="url"
                disabled={isCreating}
              />
            </div>
          </div>

          <BrandSettingsFields
            values={brandSettings}
            onChange={setBrandSettings}
            disabled={isCreating}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating || trimmedName.length < 2}>
              {isCreating ? 'Creating...' : 'Create workspace'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const normalizeWebsite = (rawWebsite: string): string | null => {
  const trimmed = rawWebsite.trim()
  if (trimmed.length === 0) {
    return null
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  return `https://${trimmed}`
}
