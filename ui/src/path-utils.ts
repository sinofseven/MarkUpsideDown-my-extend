/** Extract the filename from a path (everything after the last `/`). */
export function basename(path: string): string {
  return path.split("/").pop() || path;
}
