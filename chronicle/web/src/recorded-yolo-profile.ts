export function recordedYoloProfile(rootId: string): string | undefined {
  const prefix = 'yolo:', name = rootId.slice(prefix.length);
  return rootId.startsWith(prefix) && name.length > 0 && !/[^A-Za-z0-9._-]/.test(name) && name !== '.' && name !== '..' ? name : undefined;
}
