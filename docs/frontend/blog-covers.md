# Blog covers

Every blog post declares a `cover` in frontmatter. The value is an absolute
public path under `/blog/covers/`, and every physical locale file for the same
post points to the same image.

```yaml
cover: /blog/covers/everything-is-a-plugin.webp
```

The collection schema and `readBlogPage` both require the field. The listing
uses it as a decorative card image, and the post header uses the same asset.
Cover artwork contains no translated prose, so sharing it across locales does
not create a language mismatch.

## Visual contract

The covers follow `gc-minimal-zine-poster-v0-3`:

- 16:9 landscape WebP at 1600×900.
- Warm, visibly fibrous paper with matte scan noise.
- Roughly 70–90% negative space.
- One small visual metaphor occupying roughly 8–25% of the canvas.
- One high-chroma accent, with grayscale supporting material.
- Sparse archival microtype, never a commercial headline or CTA.
- Flat printed fragments, no mockup depth, hard shadow, glossy surface, or
  full-bleed scene.

Each post gets a distinct recipe rather than changing only the accent color:

| Post                     | Visual metaphor                                            | Accent  |
| ------------------------ | ---------------------------------------------------------- | ------- |
| `everything-is-a-plugin` | Four torn fragments entering one profile sleeve            | Violet  |
| `v0-1-2-alpha-1`         | One request splitting into metadata and clean output paths | Cobalt  |
| `v4-preview`             | A long context tape passing four adapter stages            | Orange  |
| `2026-08`                | Four delivery surfaces connected to one shared source      | Magenta |

## Prompt template

Use this production prompt as the fixed family description, then replace the
bracketed metaphor and accent with the row above:

```text
Create a sparse 16:9 horizontal editorial zine cover on warm fibrous paper.
Keep 70–90% of the page empty. Place one small [visual metaphor] near the
optical center, assembled from flat torn-paper fragments with xerox softness
and slight print misregistration. Use grayscale ink plus one clear [accent]
accent visible at thumbnail size. Add only tiny archival microtype near an
edge. Keep the focal cluster inside the central 80% safe area and leave one
side open for responsive cropping. The image must feel scanned, matte, quiet,
and technical. No logo, CTA,
commercial headline, glossy mockup, hard shadow, 3D, neon, full-bleed scene,
busy scrapbook, or multicolor palette.
```

Inspect the four covers together at thumbnail size before publishing. They
must read as one family while retaining different focal structures.

## Inline explanatory diagrams

Posts that describe more than two interacting components include one compact
diagram. Editable, self-contained HTML sources live in
`frontend/assets/blog-diagrams/`; standalone exports live in
`frontend/public/blog/diagrams/` and MDX references them by absolute public
URL.

Diagrams follow the project-local `diagram-design` profile:

- use the `fit` canvas appropriate to the content, currently 960×540;
- reuse the site's cool neutral paper, IBM Plex typography, and one brand-blue
  accent;
- stay within nine nodes and twelve connectors;
- include `role="img"`, a resolving `aria-labelledby`, and non-empty `<title>`
  and `<desc>` elements;
- generate and self-check the HTML source first, then export the SVG node;
- localize the MDX image alternative text even though diagram labels remain
  English and shared across locales.

Run the diagram skill's `scripts/self_check.py` against every source HTML and
`xmllint --noout` against every exported SVG before publishing.
