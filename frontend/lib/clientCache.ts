type CacheEnvelope<T> = {
  value: T
  expiresAt: number
}

const memoryCache = new Map<string, CacheEnvelope<unknown>>()

function safeNow() {
  return Date.now()
}

function readFromStorage<T>(key: string): CacheEnvelope<T> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as CacheEnvelope<T>
  } catch {
    return null
  }
}

function writeToStorage<T>(key: string, envelope: CacheEnvelope<T>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(envelope))
  } catch {
    // Best-effort cache only
  }
}

export function getCached<T>(key: string): T | null {
  const now = safeNow()
  const fromMemory = memoryCache.get(key) as CacheEnvelope<T> | undefined
  if (fromMemory) {
    if (fromMemory.expiresAt > now) return fromMemory.value
    memoryCache.delete(key)
  }

  const fromStorage = readFromStorage<T>(key)
  if (!fromStorage) return null
  if (fromStorage.expiresAt <= now) {
    removeCached(key)
    return null
  }
  memoryCache.set(key, fromStorage as CacheEnvelope<unknown>)
  return fromStorage.value
}

export function setCached<T>(key: string, value: T, ttlMs: number) {
  const envelope: CacheEnvelope<T> = {
    value,
    expiresAt: safeNow() + ttlMs,
  }
  memoryCache.set(key, envelope as CacheEnvelope<unknown>)
  writeToStorage(key, envelope)
}

export function removeCached(key: string) {
  memoryCache.delete(key)
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Best-effort cache only
  }
}

export function removeCachedByPrefix(prefix: string) {
  for (const key of Array.from(memoryCache.keys())) {
    if (key.startsWith(prefix)) memoryCache.delete(key)
  }
  if (typeof window === 'undefined') return
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i)
      if (key && key.startsWith(prefix)) window.localStorage.removeItem(key)
    }
  } catch {
    // Best-effort cache only
  }
}
