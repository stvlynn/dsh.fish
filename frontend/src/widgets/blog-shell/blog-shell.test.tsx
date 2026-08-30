import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { LocaleProvider } from '@/shared/config/i18n'
import { BlogPostList } from './ui/blog-shell'

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
