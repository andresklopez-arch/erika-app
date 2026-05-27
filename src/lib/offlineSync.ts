import { supabase } from "./supabaseClient";

const DB_NAME = "ErikaOfflineDB";
const STORE_NAME = "cash_transactions";
const DB_VERSION = 1;

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };
  });
};

export const saveTransactionOffline = async (
  transaction: any,
): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.add({
      ...transaction,
      offline_created_at: new Date().toISOString(),
    });

    request.onsuccess = async () => {
      // Registrar Background Sync
      if ("serviceWorker" in navigator && "SyncManager" in window) {
        try {
          const swRegistration = await navigator.serviceWorker.ready;
          // @ts-expect-error sync is not standard yet
          await swRegistration.sync.register("sync-offline-sales");
          console.log("Background Sync registrado para 'sync-offline-sales'");
        } catch (err) {
          console.error("Background Sync falló:", err);
        }
      }
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
};

export const getOfflineTransactions = async (): Promise<any[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const clearOfflineTransactions = async (): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const syncOfflineTransactions = async (): Promise<number> => {
  if (!navigator.onLine) return 0;

  const pending = await getOfflineTransactions();
  if (pending.length === 0) return 0;

  let synced = 0;
  for (const t of pending) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, offline_created_at, ...data } = t;
    const { error } = await supabase.from("cash_transactions").insert(data);
    if (!error) {
      // In a real app we'd delete them one by one. Here we clear all at the end for simplicity.
      synced++;
    } else {
      console.error("Error syncing transaction", error);
    }
  }

  // Si logramos sincronizar todas, limpiamos la base de datos local
  if (synced === pending.length) {
    await clearOfflineTransactions();
  }

  return synced;
};
