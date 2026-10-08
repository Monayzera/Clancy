const { execSync } = require('child_process')

if (process.platform === 'darwin') {
  try {
    execSync('bash scripts/patch-dev-icon.sh', { stdio: 'inherit' })
  } catch {}
}
