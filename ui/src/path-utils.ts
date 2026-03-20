/** Extract the filename from a path (everything after the last `/`). */
export function basename(path: string): string {
  return path.split("/").pop() || path;
}

/** Compute a relative path from one file to another. */
export function buildRelativePath(fromFile: string, toFile: string): string {
  const fromDir = fromFile.substring(0, fromFile.lastIndexOf("/"));
  const toDir = toFile.substring(0, toFile.lastIndexOf("/"));
  const toName = toFile.substring(toFile.lastIndexOf("/") + 1);

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
