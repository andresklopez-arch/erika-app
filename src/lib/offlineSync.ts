import { supabase } from "./supabaseClient";

const DB_NAME = "ErikaOfflineDB";
const STORE_NAME = "cash_transactions";
const DB_VERSION = 2;

let dbInstance: IDBDatabase | null = null;

export const initDB = (): Promise<IDBDatabase> => {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      dbInstance = request.result;
      
      // Cerrar conexion si hay actualizacion de version
      dbInstance.onversionchange = () => {
        if (dbInstance) {
          dbInstance.close();
          dbInstance = null;
        }
        console.warn("Conexion a IndexedDB cerrada por cambio de version.");
      };

      // Resetear cache en caso de error critico
      dbInstance.onerror = () => {
        dbInstance = null;
        console.error("Error critico detectado en IndexedDB. Reseteando conexion cacheada.");
      };

      resolve(dbInstance);
    };

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
      if (!db.objectStoreNames.contains("invoice_claims")) {
        db.createObjectStore("invoice_claims", {
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

export const saveInvoiceClaimOffline = async (
  claim: any,
): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("invoice_claims", "readwrite");
    const store = tx.objectStore("invoice_claims");
    const request = store.add({
      ...claim,
      offline_created_at: new Date().toISOString(),
    });

    request.onsuccess = async () => {
      if ("serviceWorker" in navigator && "SyncManager" in window) {
        try {
          const swRegistration = await navigator.serviceWorker.ready;
          // @ts-expect-error sync is not standard yet
          await swRegistration.sync.register("sync-offline-claims");
        } catch (err) {
          console.error("Background Sync falló:", err);
        }
      }
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
};

export const getOfflineInvoiceClaims = async (): Promise<any[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("invoice_claims", "readonly");
    const store = tx.objectStore("invoice_claims");
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const clearOfflineInvoiceClaims = async (): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("invoice_claims", "readwrite");
    const store = tx.objectStore("invoice_claims");
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const syncOfflineInvoiceClaims = async (): Promise<number> => {
  if (!navigator.onLine) return 0;

  const pending = await getOfflineInvoiceClaims();
  if (pending.length === 0) return 0;

  let synced = 0;
  for (const c of pending) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, offline_created_at, ...data } = c;
    const { error } = await supabase.from("invoice_claims").insert(data);
    if (!error) {
      synced++;
    } else {
      console.error("Error syncing invoice claim", error);
    }
  }

  if (synced === pending.length) {
    await clearOfflineInvoiceClaims();
  }

  return synced;
};

export const syncOfflineTransactions = async (): Promise<number> => {
  if (!navigator.onLine) return 0;

  // 1. Sincronizar transacciones de caja
  const pending = await getOfflineTransactions();
  let synced = 0;
  if (pending.length > 0) {
    for (const t of pending) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, offline_created_at, ...data } = t;
      const { error } = await supabase.from("cash_transactions").insert(data);
      if (!error) {
        synced++;
      } else {
        console.error("Error syncing transaction", error);
      }
    }
    if (synced === pending.length) {
      await clearOfflineTransactions();
    }
  }

  // 2. Sincronizar reclamos de factura
  await syncOfflineInvoiceClaims();

  return synced;
};
