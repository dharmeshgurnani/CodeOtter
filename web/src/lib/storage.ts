// Web storage can throw (private mode, quota, disabled cookies). Every read falls back to null, every write is best-effort.
const get = (store: () => Storage, key: string) => {
  try { return store().getItem(key); } catch { return null; }
};
const set = (store: () => Storage, key: string, value: string | null) => {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, value);
  } catch { /* storage unavailable */ }
};

export const storageGet = (key: string) => get(() => localStorage, key);
export const storageSet = (key: string, value: string | null) => set(() => localStorage, key, value);
export const sessionGet = (key: string) => get(() => sessionStorage, key);
export const sessionSet = (key: string, value: string | null) => set(() => sessionStorage, key, value);
