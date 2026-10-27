import type { MDXComponents } from 'mdx/types'
import { BlogMockUi, BlogStructureMap } from '@/widgets/blog-shell'
import { asMdxComponents, proseMdxComponents } from '@/shared/ui/mdx-prose'

export function blogMdxComponents(extra?: MDXComponents): MDXComponents {
  return asMdxComponents(proseMdxComponents(), {
    BlogMockUi,
    BlogStructureMap,
    ...extra,
  })
}
