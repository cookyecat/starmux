import { isSafeInteger } from "./validation.js";
// P1 local-only file path and file type gate. Not an OS sandbox.
import { lstat,realpath } from "node:fs/promises";
import path from "node:path";

export class ScopeDenied extends Error {
  constructor(public readonly code: string) { super("File scope denied: "+code); this.name="ScopeDenied"; }
}
export async function resolveScopedRead({ root, relativePath, allowedFiles, maxBytes=4096 }: {root: unknown; relativePath: unknown; allowedFiles: readonly string[]; maxBytes?: number}) {
  if (typeof root!=="string" || !path.isAbsolute(root)) throw new ScopeDenied("INVALID_ROOT");
  if (typeof relativePath!=="string" || relativePath.length===0 || relativePath.length>200 ||
      relativePath.includes("\0") || path.isAbsolute(relativePath) || relativePath.includes("\\"))
    throw new ScopeDenied("INVALID_NAME");
  const components=relativePath.split("/");
  if (components.some(x=>x==="" || x==="." || x===".."))
    throw new ScopeDenied("TRAVERSAL");
  if (!Array.isArray(allowedFiles) || !allowedFiles.includes(relativePath))
    throw new ScopeDenied("NOT_ALLOWLISTED");
  if (!isSafeInteger(maxBytes) || maxBytes<1 || maxBytes>1048576)
    throw new ScopeDenied("INVALID_LIMIT");
  const canonicalRoot=await realpath(root);
  // Refuse every symlink in untrusted path components (not just final target).
  let next=canonicalRoot;
  for (const component of components) {
    next=path.join(next,component);
    if ((await lstat(next)).isSymbolicLink()) throw new ScopeDenied("SYMLINK");
  }
  const resolved=await realpath(path.join(canonicalRoot,...components));
  if (!resolved.startsWith(canonicalRoot+path.sep)) throw new ScopeDenied("ESCAPES_ROOT");
  const metadata=await lstat(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1)
    throw new ScopeDenied("UNSAFE_FILE_TYPE");
  if (metadata.size>maxBytes) throw new ScopeDenied("TOO_LARGE");
  return Object.freeze({absolutePath:resolved,size:metadata.size});
}
