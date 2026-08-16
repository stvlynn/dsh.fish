/**
 * pnpm git specifier for the hub bundle.
 *
 * The bundle lives in `packages/dsh-plugin-hub`, not at the repository root.
 * `github:stvlynn/dsh.fish#main` installs the website package (`dsh-fish`),
 * which declares no `dsh.bundle`, so the harness activates no layer.
 */
export const HUB_PLUGIN_SPEC = 'github:stvlynn/dsh.fish#path:packages/dsh-plugin-hub'
