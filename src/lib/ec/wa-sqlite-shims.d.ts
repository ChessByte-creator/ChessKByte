// wa-sqlite só publica tipos para a API principal; estes dois caminhos profundos ficam sem tipo.
declare module "wa-sqlite/src/VFS.js" {
  export class Base {
    mxPathName: number;
  }
  export const SQLITE_OK: number;
  export const SQLITE_IOERR: number;
  export const SQLITE_CANTOPEN: number;
  export const SQLITE_READONLY: number;
  export const SQLITE_IOERR_SHORT_READ: number;
  export const SQLITE_OPEN_READONLY: number;
  export const SQLITE_IOCAP_IMMUTABLE: number;
}

declare module "wa-sqlite/dist/wa-sqlite.mjs" {
  const factory: (config?: { locateFile?: (file: string) => string }) => Promise<unknown>;
  export default factory;
}
