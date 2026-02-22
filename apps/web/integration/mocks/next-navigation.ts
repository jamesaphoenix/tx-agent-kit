import { vi } from 'vitest'

export const mockRouter = {
  push: vi.fn<(path: string) => void>(),
  replace: vi.fn<(path: string) => void>(),
  refresh: vi.fn<() => void>(),
  prefetch: vi.fn<(path: string) => Promise<void>>().mockResolvedValue(),
  back: vi.fn<() => void>(),
  forward: vi.fn<() => void>()
}

export const resetMockRouter = (): void => {
  mockRouter.push.mockReset()
  mockRouter.replace.mockReset()
  mockRouter.refresh.mockReset()
  mockRouter.prefetch.mockReset()
  mockRouter.prefetch.mockResolvedValue()
  mockRouter.back.mockReset()
  mockRouter.forward.mockReset()
}

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  useSelectedLayoutSegment: () => null,
  redirect: vi.fn(),
  notFound: vi.fn()
}))
