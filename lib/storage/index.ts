import { createR2Storage } from "./r2";
import type { Storage } from "./types";

let _storage: Storage | undefined;
export function getStorage(): Storage {
  if (!_storage) _storage = createR2Storage();
  return _storage;
}
export { buildAudioKey } from "./types";
export type { Storage } from "./types";
