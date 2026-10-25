import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const host = process.env.DSH_VPS_HOST ?? 'root@43.160.219.124'
const release = process.env.DSH_RELEASE ?? `vps-${randomBytes(8).toString('hex')}`
if (!/^[a-zA-Z0-9_.@:-]+$/.test(host) || !/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(release))
  throw new Error('Invalid VPS host or release name.')

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    })
    if (input !== undefined) child.stdin.end(input)
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    )
  })
}

const temporary = await mkdtemp(join(tmpdir(), 'dsh-vps-'))
try {
  await run('pnpm', ['run', 'build:vps'])
  const archive = join(temporary, 'release.tar.gz')
  await run('tar', [
    '--no-xattrs',
    '-czf',
    archive,
    '.npmrc',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'backend/package.json',
    'frontend/package.json',
    'packages/dsh-cli/package.json',
    'packages/dsh-plugin-hub/package.json',
    'frontend/build',
    'deploy/docker',
    '.dockerignore',
  ])
  await run('ssh', [host, 'mkdir -p /opt/dsh-fish/releases'])
  await run('scp', [archive, `${host}:/opt/dsh-fish/releases/${release}.tar.gz`])
  await run(
    'ssh',
    [host, 'bash', '-se', '--', release],
    `
set -Eeuo pipefail
release="$1"
root=/opt/dsh-fish
release_dir="$root/releases/$release"
image="dsh-fish:$release"
[ ! -e "$release_dir" ] || { echo 'Release already exists; use a new immutable name.' >&2; exit 1; }
mkdir "$release_dir"
tar -xzf "$root/releases/$release.tar.gz" -C "$release_dir"
rm "$root/releases/$release.tar.gz"
docker build -f "$release_dir/deploy/docker/Dockerfile" -t "$image" "$release_dir"
mkdir -p "$root/shared/assets"
container=$(docker create "$image")
docker cp "$container:/app/frontend/build/client/assets/." "$root/shared/assets/"
docker rm "$container" >/dev/null
cd "$root/deploy"
cp .env "$root/shared/previous-release.env"
cp compose.yaml "$root/shared/previous-compose.yaml"
cp nginx.conf "$root/shared/previous-nginx.conf"
rollback() {
  echo 'Candidate failed; restoring previous release.' >&2
  cp "$root/shared/previous-release.env" .env
  cp "$root/shared/previous-compose.yaml" compose.yaml
  cat "$root/shared/previous-nginx.conf" > nginx.conf
  docker compose up -d --wait --wait-timeout 120
  docker compose exec --interactive=false -T origin nginx -s reload
}
trap 'rollback' ERR
cp "$release_dir/deploy/docker/compose.yaml" compose.yaml
cat "$release_dir/deploy/docker/nginx.conf" > nginx.conf
printf 'DSH_IMAGE=%s\\n' "$image" > .env
docker compose config --quiet
docker compose up -d --wait --wait-timeout 120
docker compose exec --interactive=false -T origin nginx -t
docker compose exec --interactive=false -T origin nginx -s reload
curl --max-time 10 --fail --silent --show-error --retry 5 --retry-all-errors --retry-delay 1 http://127.0.0.1:3090/api/ready
trap - ERR
echo "Released $image"
`,
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
