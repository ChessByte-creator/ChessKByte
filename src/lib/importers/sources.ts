import { Decompress } from "fzstd";

export type FileFormat = "zstd" | "gzip" | "sqlite" | "zip" | "bzip2" | "text";

export async function sniffFormat(file: File): Promise<FileFormat> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (head[0] === 0x28 && head[1] === 0xb5 && head[2] === 0x2f && head[3] === 0xfd) return "zstd";
  if (head[0] === 0x1f && head[1] === 0x8b) return "gzip";
  if (head[0] === 0x50 && head[1] === 0x4b) return "zip";
  if (head[0] === 0x42 && head[1] === 0x5a && head[2] === 0x68) return "bzip2";
  const magic = String.fromCharCode(...head.slice(0, 15));
  if (magic === "SQLite format 3") return "sqlite";
  return "text";
}

export type Progress = (readBytes: number, totalBytes: number) => void;

/** Lê o arquivo em pedaços (sem limite de tamanho) e devolve os bytes já descomprimidos. */
export async function* decodedChunks(file: File, format: FileFormat, onProgress?: Progress, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const total = file.size;
  let read = 0;
  if (format === "gzip") {
    if (typeof DecompressionStream === "undefined") throw new Error("Este navegador não descomprime .gz.");
    const stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
    const reader = stream.getReader();
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) return;
      read = Math.min(total, read + Math.ceil(value.length / 4));
      onProgress?.(read, total);
      yield value;
    }
  }
  const reader = file.stream().getReader();
  if (format === "zstd") {
    const queue: Uint8Array[] = [];
    const decoder = new Decompress((chunk) => {
      queue.push(chunk);
    });
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) {
        decoder.push(new Uint8Array(0), true);
      } else {
        read += value.length;
        onProgress?.(read, total);
        decoder.push(value, false);
      }
      while (queue.length > 0) yield queue.shift() as Uint8Array;
      if (done) return;
    }
  }
  if (format === "text") {
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) return;
      read += value.length;
      onProgress?.(read, total);
      yield value;
    }
  }
  throw new Error(formatMessage(format));
}

export function formatMessage(format: FileFormat) {
  if (format === "zip") return "Arquivos .zip não são suportados. Extraia primeiro ou use .zst/.gz.";
  if (format === "bzip2") return "Arquivos .bz2 não são suportados. Use .zst ou .gz.";
  return "Formato não suportado.";
}

/** Descomprime e devolve linhas de texto, sem carregar o arquivo inteiro na memória. */
export async function* textLines(file: File, format: FileFormat, onProgress?: Progress, signal?: AbortSignal): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8");
  let rest = "";
  for await (const chunk of decodedChunks(file, format, onProgress, signal)) {
    rest += decoder.decode(chunk, { stream: true });
    let start = 0;
    for (;;) {
      const end = rest.indexOf("\n", start);
      if (end < 0) break;
      const line = rest.slice(start, end);
      yield line.endsWith("\r") ? line.slice(0, -1) : line;
      start = end + 1;
    }
    rest = rest.slice(start);
  }
  rest += decoder.decode();
  if (rest) yield rest;
}
