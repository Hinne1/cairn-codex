function rvaToOffset(bytes, sections, rva) {
  for (const section of sections) {
    const size = Math.max(section.virtualSize, section.rawSize)
    if (rva >= section.virtualAddress && rva < section.virtualAddress + size) {
      return section.rawOffset + (rva - section.virtualAddress)
    }
  }
  throw new Error(`PE RVA 0x${rva.toString(16)} is outside every section.`)
}

function readCString(bytes, offset) {
  let end = offset
  while (end < bytes.length && bytes[end] !== 0) end += 1
  if (end === bytes.length) throw new Error('PE import name is not null-terminated.')
  return bytes.toString('ascii', offset, end)
}

export function readPeImports(bytes) {
  if (bytes.length < 0x40 || bytes.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error('Native dependency input is not a PE image.')
  }
  const peOffset = bytes.readUInt32LE(0x3c)
  if (peOffset + 24 > bytes.length || bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error('Native dependency input has no valid PE header.')
  }
  const sectionCount = bytes.readUInt16LE(peOffset + 6)
  const optionalSize = bytes.readUInt16LE(peOffset + 20)
  const optionalOffset = peOffset + 24
  const magic = bytes.readUInt16LE(optionalOffset)
  const dataDirectoryOffset = magic === 0x20b ? optionalOffset + 112 : magic === 0x10b ? optionalOffset + 96 : -1
  if (dataDirectoryOffset < 0) throw new Error(`Unsupported PE optional-header magic 0x${magic.toString(16)}.`)
  const importRva = bytes.readUInt32LE(dataDirectoryOffset + 8)
  if (importRva === 0) return []

  const sectionOffset = optionalOffset + optionalSize
  const sections = []
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionOffset + index * 40
    sections.push({
      virtualSize: bytes.readUInt32LE(offset + 8),
      virtualAddress: bytes.readUInt32LE(offset + 12),
      rawSize: bytes.readUInt32LE(offset + 16),
      rawOffset: bytes.readUInt32LE(offset + 20)
    })
  }

  const imports = []
  let descriptor = rvaToOffset(bytes, sections, importRva)
  while (descriptor + 20 <= bytes.length) {
    const originalThunk = bytes.readUInt32LE(descriptor)
    const timestamp = bytes.readUInt32LE(descriptor + 4)
    const forwarder = bytes.readUInt32LE(descriptor + 8)
    const nameRva = bytes.readUInt32LE(descriptor + 12)
    const firstThunk = bytes.readUInt32LE(descriptor + 16)
    if ((originalThunk | timestamp | forwarder | nameRva | firstThunk) === 0) break
    imports.push(readCString(bytes, rvaToOffset(bytes, sections, nameRva)).toLocaleLowerCase())
    descriptor += 20
  }
  return [...new Set(imports)].sort()
}
