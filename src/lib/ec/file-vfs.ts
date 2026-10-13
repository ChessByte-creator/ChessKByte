import * as VFS from "wa-sqlite/src/VFS.js";

/** Leitura síncrona de um arquivo (no navegador: File + FileReaderSync dentro de um Worker). */
export type SyncReader = { size: number; read: (offset: number, length: number) => Uint8Array };

const BLOCK = 64 * 1024;
const MAX_BLOCKS = 256; // ~16 MB de cache

/**
 * Cache de blocos de 64 KB: o SQLite pede páginas de 4 KB (ou 64 KB); ler o disco/arquivo de pouco em pouco
 * seria lento. Só os blocos tocados pelas consultas são lidos; o arquivo inteiro nunca vai para a memória.
 */
export function cachedReader(raw: SyncReader): SyncReader {
  const blocks = new Map<number, Uint8Array>();
  function block(index: number) {
    const hit = blocks.get(index);
    if (hit) {
      blocks.delete(index);
      blocks.set(index, hit);
      return hit;
    }
    const start = index * BLOCK;
    const data = raw.read(start, Math.min(BLOCK, raw.size - start));
    blocks.set(index, data);
    if (blocks.size > MAX_BLOCKS) blocks.delete(blocks.keys().next().value as number);
    return data;
  }
  return {
    size: raw.size,
    read(offset, length) {
      const end = Math.min(offset + length, raw.size);
      if (end <= offset) return new Uint8Array(0);
      const out = new Uint8Array(end - offset);
      let at = offset;
      while (at < end) {
        const index = Math.floor(at / BLOCK);
        const data = block(index);
        const from = at - index * BLOCK;
        const take = Math.min(data.length - from, end - at);
        if (take <= 0) break;
        out.set(data.subarray(from, from + take), at - offset);
        at += take;
      }
      return out;
    },
  };
}

/** VFS somente-leitura do wa-sqlite: cada arquivo "aberto" é um SyncReader. */
export class FileVFS extends VFS.Base {
  name = "byte-file";
  private readonly open = new Map<number, SyncReader>();

  constructor(private readonly files: Map<string, SyncReader>) {
    super();
  }

  private find(name: string | null) {
    if (!name) return undefined;
    return this.files.get(name) ?? this.files.get(name.replace(/^\/+/, ""));
  }

  xOpen(name: string | null, fileId: number, _flags: number, pOutFlags: DataView) {
    const reader = this.find(name);
    if (!reader) return VFS.SQLITE_CANTOPEN;
    this.open.set(fileId, reader);
    pOutFlags.setInt32(0, VFS.SQLITE_OPEN_READONLY, true);
    return VFS.SQLITE_OK;
  }

  xClose(fileId: number) {
    this.open.delete(fileId);
    return VFS.SQLITE_OK;
  }

  // Em tempo de execução o wa-sqlite entrega um Uint8Array (os tipos do pacote descrevem outra forma).
  // @ts-expect-error tipo de pData diferente do declarado em wa-sqlite
  xRead(fileId: number, pData: Uint8Array, iOffset: number) {
    const reader = this.open.get(fileId);
    if (!reader) return VFS.SQLITE_IOERR;
    const data = reader.read(iOffset, pData.byteLength);
    pData.set(data);
    if (data.length < pData.byteLength) {
      pData.fill(0, data.length);
      return VFS.SQLITE_IOERR_SHORT_READ;
    }
    return VFS.SQLITE_OK;
  }

  xWrite() {
    return VFS.SQLITE_READONLY;
  }

  xTruncate() {
    return VFS.SQLITE_READONLY;
  }

  xSync() {
    return VFS.SQLITE_OK;
  }

  xFileSize(fileId: number, pSize64: DataView) {
    const reader = this.open.get(fileId);
    if (!reader) return VFS.SQLITE_IOERR;
    pSize64.setBigInt64(0, BigInt(reader.size), true);
    return VFS.SQLITE_OK;
  }

  xAccess(name: string, _flags: number, pResOut: DataView) {
    pResOut.setInt32(0, this.find(name) ? 1 : 0, true);
    return VFS.SQLITE_OK;
  }

  xDelete() {
    return VFS.SQLITE_READONLY;
  }

  xDeviceCharacteristics() {
    return VFS.SQLITE_IOCAP_IMMUTABLE;
  }
}
