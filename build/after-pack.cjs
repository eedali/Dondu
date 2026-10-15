// electron-builder afterPack hook.
// We have no Apple certificate (`mac.identity: null`), so electron-builder skips
// signing entirely. An unsigned arm64 app will not launch at all on Apple Silicon,
// so we ad-hoc sign the bundle here — before the DMG is built.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = fs.readdirSync(context.appOutDir).find((n) => n.endsWith('.app'))
  if (!app) throw new Error(`afterPack: no .app in ${context.appOutDir}`)
  const appPath = path.join(context.appOutDir, app)

  // Electron finds its helper apps as "<CFBundleName> Helper.app"; a mismatch
  // (e.g. overriding CFBundleName in extendInfo) crashes the app at launch.
  const bundleName = execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleName', path.join(appPath, 'Contents', 'Info.plist')],
    { encoding: 'utf8' },
  ).trim()
  const helper = path.join(appPath, 'Contents', 'Frameworks', `${bundleName} Helper.app`)
  if (!fs.existsSync(helper)) throw new Error(`afterPack: missing helper ${helper}`)

  console.log(`  • ad-hoc signing  ${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
}
