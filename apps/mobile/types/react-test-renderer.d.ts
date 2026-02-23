declare module 'react-test-renderer' {
  import type { ReactElement, ComponentType } from 'react'

  interface ReactTestInstance {
    type: string | ComponentType
    props: Record<string, any>
    parent: ReactTestInstance | null
    children: Array<ReactTestInstance | string>
    findAllByType(type: string | ComponentType): ReactTestInstance[]
    findAllByProps(props: Record<string, unknown>): ReactTestInstance[]
    findByType(type: string | ComponentType): ReactTestInstance
    findByProps(props: Record<string, unknown>): ReactTestInstance
    find(predicate: (instance: ReactTestInstance) => boolean): ReactTestInstance
    findAll(predicate: (instance: ReactTestInstance) => boolean): ReactTestInstance[]
    instance: unknown
  }

  interface ReactTestRenderer {
    root: ReactTestInstance
    toJSON(): unknown
    toTree(): unknown
    unmount(): void
    update(element: ReactElement): void
  }

  interface TestRendererOptions {
    createNodeMock?: (element: ReactElement) => unknown
  }

  export function create(
    element: ReactElement,
    options?: TestRendererOptions
  ): ReactTestRenderer

  export function act(
    callback: () => void | Promise<void>
  ): Promise<void>
}
