/** Extract the filename from a path (everything after the last `/`). */
export function basename(path: string): string {
  return path.split("/").pop() || path;
}

/** Extract the directory portion of a path (everything before the last `/`). */
export function dirname(path: string): string {
  return path.substring(0, path.lastIndexOf("/"));
}

/** Compute a relative path from one file to another. */
export function buildRelativePath(fromFile: string, toFile: string): string {
  const fromDir = dirname(fromFile);
  const toDir = dirname(toFile);
  const toName = basename(toFile);

  if (fromDir === toDir) {
    return `./${toName}`;
  }

  const fromParts = fromDir.split("/");
  const toParts = toDir.split("/");

  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }

  const ups = fromParts.length - common;
  const downs = toParts.slice(common);

  return [...Array(ups).fill(".."), ...downs, toName].join("/");
}
