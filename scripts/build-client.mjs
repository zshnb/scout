import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const dist = resolve('dist')
const name = process.platform === 'win32' ? 'scout.exe' : 'scout'
await mkdir(dist, { recursive: true })
const temp = await mkdtemp(join(dist, '.build-'))
try {
  const binary = join(temp, name)
  const build = await Bun.build({
    entrypoints: ['src/client/main.tsx'],
    target: 'bun',
    compile: { outfile: binary, autoloadDotenv: false, autoloadBunfig: false },
    minify: true,
    plugins: [{
      name: 'omit-ink-devtools',
      setup(builder) {
        // The release client has no React DevTools connection or optional DevTools peer.
        builder.onLoad({ filter: /[/\\]ink[/\\]build[/\\]devtools\.js$/ }, () => ({
          contents: 'export {}', loader: 'js',
        }))
      },
    }],
  })
  if (!build.success) throw new AggregateError(build.logs, '客户端构建失败')
  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--force', '--sign', '-', binary])
    execFileSync('codesign', ['--verify', '--strict', binary])
  }
  execFileSync(binary, ['--help'], { cwd: temp })
  await rename(binary, join(dist, name))
  console.log('已生成 ' + join(dist, name))
} finally {
  await rm(temp, { recursive: true, force: true })
}
