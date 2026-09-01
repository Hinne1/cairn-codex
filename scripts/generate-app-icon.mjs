import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const iconSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const sourcePath = resolve('build', 'icon.svg')
const outputPath = resolve('build', 'icon.ico')
const checkOnly = process.argv.includes('--check')
const previewIndex = process.argv.indexOf('--preview')
const previewPath = previewIndex >= 0 && process.argv[previewIndex + 1]
  ? resolve(process.argv[previewIndex + 1])
  : null

function pngDimensions(png) {
  const signature = '89504e470d0a1a0a'
  if (png.subarray(0, 8).toString('hex') !== signature || png.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('The SVG renderer did not produce a valid PNG icon frame.')
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

function createIco(frames) {
  const directorySize = 6 + frames.length * 16
  const header = Buffer.alloc(directorySize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)
  let offset = directorySize
  frames.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16
    header.writeUInt8(size === 256 ? 0 : size, entry)
    header.writeUInt8(size === 256 ? 0 : size, entry + 1)
    header.writeUInt8(0, entry + 2)
    header.writeUInt8(0, entry + 3)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...frames.map((frame) => frame.png)])
}

const source = await readFile(sourcePath)
const frames = iconSizes.map((size) => {
  const png = Buffer.from(new Resvg(source, {
    fitTo: { mode: 'width', value: size },
    shapeRendering: 2,
    textRendering: 2,
    imageRendering: 0
  }).render().asPng())
  const dimensions = pngDimensions(png)
  if (dimensions.width !== size || dimensions.height !== size) {
    throw new Error(`Generated ${dimensions.width}x${dimensions.height} instead of ${size}x${size}.`)
  }
  return { size, png }
})
const generated = createIco(frames)
if (checkOnly) {
  const current = await readFile(outputPath)
  if (!current.equals(generated)) {
    throw new Error('build/icon.ico is stale. Run npm.cmd run generate:app-icon.')
  }
  console.log(`App icon verified: ${iconSizes.join(', ')} px frames (${current.length} bytes).`)
} else {
  await writeFile(outputPath, generated)
  console.log(`Generated ${outputPath} with ${iconSizes.length} Windows icon frames.`)
}
if (previewPath) {
  await writeFile(previewPath, frames.at(-1).png)
  console.log(`Wrote app icon preview to ${previewPath}.`)
}
