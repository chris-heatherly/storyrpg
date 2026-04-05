const storage = new Map<string, string>();

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return storage.has(key) ? storage.get(key)! : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    storage.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    storage.delete(key);
  },
  async clear(): Promise<void> {
    storage.clear();
  },
};

export default AsyncStorage;
