import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { LocaleProvider } from '@/shared/config/i18n'
import { IconDefaults } from '@/shared/ui/icon'
import { BlogPostList } from './ui/blog-shell'
import { BlogMockUi, BlogStructureMap } from './ui/blog-visuals'

describe('BlogPostList', () => {
  it('links a decorative poster cover to each post', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LocaleProvider locale="en">
          <BlogPostList
            posts={[
              {
                url: '/blog/notes/everything-is-a-plugin',
                title: 'Everything is a plugin',
                description: 'How the composition boundary works.',
                date: '2026-08-29T00:00:00.000Z',
                seriesId: 'notes',
                seriesTitle: 'Technical notes',
                cover: '/blog/covers/everything-is-a-plugin.webp',
              },
            ]}
          />
        </LocaleProvider>
      </MemoryRouter>,
    )

    expect(html).toContain('src="/blog/covers/everything-is-a-plugin.webp"')
    expect(html).toMatch(/<img[^>]*alt=""/)
    expect(html).toContain('href="/blog/notes/everything-is-a-plugin"')
    expect(html).toContain('width="1600"')
    expect(html).toContain('height="900"')
  })
})

describe('BlogMockUi and BlogStructureMap', () => {
  it('renders interactive mock UI steps and structured HTML diagrams with semantic markup', () => {
    const mockHtml = renderToStaticMarkup(
      <IconDefaults>
        <BlogMockUi
          scene="deepseek-bot-arena"
          eyebrow="INTERACTIVE MOCK UI"
          title="Comparing DS Bot and Tobs"
          caption="Step through the ecosystem layers."
          step1Title="Step 1"
          step1Body="Body 1"
          step2Title="Step 2"
          step2Body="Body 2"
          step3Title="Step 3"
          step3Body="Body 3"
          step4Title="Step 4"
          step4Body="Body 4"
        />
      </IconDefaults>,
    )
    expect(mockHtml).toContain('role="tablist"')
    expect(mockHtml).toContain('role="tabpanel"')
    expect(mockHtml).toContain('Comparing DS Bot and Tobs')
    expect(mockHtml).toContain('@botharness/tobs')

    const mapHtml = renderToStaticMarkup(
      <IconDefaults>
        <BlogStructureMap
          diagram="harness-v0-2-1-architecture"
          eyebrow="HTML STRUCTURE MAP"
          title="Capability seams"
          caption="Three architectural columns."
          node1Title="Workspace"
          node1Body="Sidebar and CLI"
          node2Title="Execution"
          node2Body="SSH and Browser Use"
          node3Title="Platform"
          node3Body="Custom plugin indexes"
        />
      </IconDefaults>,
    )
    expect(mapHtml).toContain('Capability seams')
    expect(mapHtml).toContain('ctx.pluginMarket')
  })
})
