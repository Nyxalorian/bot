import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function createJsonStateStore(filePath, normalizeState) {
  let cachedState = null;
  let loadPromise = null;
  let writeQueue = Promise.resolve();

  async function readState() {
    if (cachedState) {
      return cachedState;
    }

    loadPromise ??= loadState()
      .then((state) => {
        cachedState = state;
        return state;
      })
      .finally(() => {
        loadPromise = null;
      });

    return loadPromise;
  }

  async function writeState(state = cachedState) {
    cachedState = normalizeState(state);
    const serializedState = `${JSON.stringify(cachedState, null, 2)}\n`;

    writeQueue = writeQueue
      .catch(() => {})
      .then(async () => {
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, serializedState);
      });

    return writeQueue;
  }

  async function loadState() {
    try {
      const rawState = await readFile(filePath, 'utf8');
      return normalizeState(JSON.parse(rawState));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return normalizeState(null);
      }

      throw error;
    }
  }

  return {
    read: readState,
    write: writeState,
  };
}
