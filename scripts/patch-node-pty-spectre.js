const fs = require('fs')
const path = require('path')

const targets = [
  path.join(__dirname, '..', 'node_modules', 'node-pty', 'binding.gyp'),
  path.join(__dirname, '..', 'node_modules', 'node-pty', 'deps', 'winpty', 'src', 'winpty.gyp'),
]

for (const filePath of targets) {
  try {
    if (!fs.existsSync(filePath)) continue
    const content = fs.readFileSync(filePath, 'utf8')
    if (!content.includes("'SpectreMitigation': 'Spectre'")) continue
    const patched = content.replace(/'SpectreMitigation': 'Spectre'/g, "'SpectreMitigation': 'false'")
    fs.writeFileSync(filePath, patched, 'utf8')
    console.log('Patched:', filePath)
  } catch (err) {
    console.warn('Could not patch:', filePath, err.message)
  }
}
