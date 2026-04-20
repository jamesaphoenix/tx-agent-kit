'use client'

import {
  workspaceIndustries,
  workspaceIndustryLabels,
  type BrandSettings
} from '@tx-agent-kit/contracts'
import { useId } from 'react'
import CreatableSelect from 'react-select/creatable'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type BrandSettingsValues = BrandSettings

export interface BrandSettingsFieldsProps {
  values: BrandSettingsValues
  onChange: (next: BrandSettingsValues) => void
  disabled?: boolean
}

interface IndustryOption {
  value: string
  label: string
}

const industryOptions: IndustryOption[] = workspaceIndustries.map((key) => ({
  value: key,
  label: workspaceIndustryLabels[key]
}))

interface ColorFieldConfig {
  key: keyof BrandSettingsValues['colors']
  label: string
}

const colorFields: ColorFieldConfig[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Background' },
  { key: 'text', label: 'Text' }
]

function ColorField({
  id,
  label,
  value,
  onChange,
  disabled
}: {
  id: string
  label: string
  value: string
  onChange: (hex: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0">
        <input
          type="color"
          id={`${id}-picker`}
          value={value || '#000000'}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="absolute inset-0 w-10 h-10 cursor-pointer opacity-0"
          aria-label={`${label} color picker`}
        />
        <div
          className="w-10 h-10 rounded-lg border-2 border-border shadow-sm transition-shadow hover:shadow-md"
          style={{ backgroundColor: value || '#000000' }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <Label htmlFor={`${id}-hex`} className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </Label>
        <Input
          id={`${id}-hex`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          maxLength={7}
          disabled={disabled}
          className="mt-0.5 font-mono text-sm h-8"
        />
      </div>
    </div>
  )
}

export function BrandSettingsFields({ values, onChange, disabled }: BrandSettingsFieldsProps) {
  const instanceId = useId()

  const updateColor = (key: keyof BrandSettingsValues['colors'], hex: string) => {
    onChange({
      ...values,
      colors: { ...values.colors, [key]: hex }
    })
  }

  const selectedIndustryOption: IndustryOption | null = values.industry
    ? industryOptions.find((o) => o.value === values.industry) ?? { value: values.industry, label: values.industry }
    : null

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Brand palette</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {colorFields.map((field) => (
            <ColorField
              key={field.key}
              id={`${instanceId}-color-${field.key}`}
              label={field.label}
              value={values.colors[field.key]}
              onChange={(hex) => updateColor(field.key, hex)}
              disabled={disabled}
            />
          ))}
        </div>

        <div className="flex items-center gap-1.5 pt-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Preview</span>
          <div className="flex gap-1">
            {colorFields.map((field) => (
              <div
                key={field.key}
                className="w-6 h-6 rounded-full border border-border shadow-sm"
                style={{ backgroundColor: values.colors[field.key] || '#E5E7EB' }}
                title={`${field.label}: ${values.colors[field.key] || 'not set'}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Brand identity</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${instanceId}-industry`} className="text-sm font-medium">
            Industry
          </Label>
          <CreatableSelect
            inputId={`${instanceId}-industry`}
            instanceId={`${instanceId}-industry-select`}
            options={industryOptions}
            value={selectedIndustryOption}
            isDisabled={disabled}
            placeholder="Select or type your industry..."
            formatCreateLabel={(input) => `Use "${input}"`}
            onChange={(option) => {
              onChange({ ...values, industry: (option?.value ?? '').slice(0, 100) })
            }}
            onCreateOption={(input) => {
              onChange({ ...values, industry: input.slice(0, 100) })
            }}
            classNamePrefix="brand-industry-select"
            classNames={{
              control: () => disabled ? 'cursor-not-allowed' : 'cursor-pointer',
              dropdownIndicator: () => disabled ? 'cursor-not-allowed' : 'cursor-pointer',
              clearIndicator: () => 'cursor-pointer',
              option: () => 'cursor-pointer'
            }}
            menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
            styles={{
              menuPortal: (base) => ({ ...base, zIndex: 1600 }),
              control: (base) => ({
                ...base,
                borderRadius: '0.5rem',
                borderColor: 'hsl(var(--border))',
                cursor: disabled ? 'not-allowed' : 'pointer',
                minHeight: '36px',
                fontSize: '0.875rem',
                '&:hover': { borderColor: 'hsl(var(--ring))' }
              }),
              option: (base, state) => ({
                ...base,
                fontSize: '0.875rem',
                cursor: 'pointer',
                backgroundColor: state.isFocused ? 'hsl(var(--accent))' : 'transparent',
                color: 'hsl(var(--foreground))'
              })
            }}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={`${instanceId}-audience`} className="text-sm font-medium">
              Target audience
            </Label>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {values.targetAudience.length}/500
            </span>
          </div>
          <textarea
            id={`${instanceId}-audience`}
            value={values.targetAudience}
            onChange={(e) => onChange({ ...values, targetAudience: e.target.value })}
            placeholder="e.g. B2B SaaS decision makers, 30-50, tech-savvy executives..."
            maxLength={500}
            rows={2}
            disabled={disabled}
            className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={`${instanceId}-guidelines`} className="text-sm font-medium">
              Brand guidelines
            </Label>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {values.brandGuidelines.length}/500
            </span>
          </div>
          <textarea
            id={`${instanceId}-guidelines`}
            value={values.brandGuidelines}
            onChange={(e) => onChange({ ...values, brandGuidelines: e.target.value })}
            placeholder="e.g. Professional but approachable. Avoid jargon. Use active voice..."
            maxLength={500}
            rows={3}
            disabled={disabled}
            className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none"
          />
        </div>
      </div>
    </div>
  )
}

export const defaultBrandSettingsValues: BrandSettingsValues = {
  colors: {
    primary: '#6366F1',
    secondary: '#8B5CF6',
    accent: '#F59E0B',
    background: '#FFFFFF',
    text: '#1A1A2E'
  },
  brandGuidelines: '',
  industry: '',
  targetAudience: ''
}
