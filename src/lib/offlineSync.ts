import { supabase } from "./supabaseClient";

const DB_NAME = "ErikaOfflineDB";
const STORE_NAME = "cash_transactions";
const DB_VERSION = 3;

let dbInstance: IDBDatabase | null = null;

// Obfuscación y Cifrado XOR para mayor confidencialidad de IndexedDB local (Sugerencia 2)
const SECRET_KEY = "ERIKA_OFFLINE_SECURE_KEY";

const encryptData = (data: any): string => {
  try {
    const jsonStr = JSON.stringify(data);
    let result = "";
    for (let i = 0; i < jsonStr.length; i++) {
      result += String.fromCharCode(jsonStr.charCodeAt(i) ^ SECRET_KEY.charCodeAt(i % SECRET_KEY.length));
    }
    return btoa(unescape(encodeURIComponent(result)));
  } catch (err) {
    console.error("Error encrypting offline data:", err);
    return "";
  }
};

const decryptData = (encryptedStr: string): any => {
  try {
    const rawStr = decodeURIComponent(escape(atob(encryptedStr)));
    let result = "";
    for (let i = 0; i < rawStr.length; i++) {
      result += String.fromCharCode(rawStr.charCodeAt(i) ^ SECRET_KEY.charCodeAt(i % SECRET_KEY.length));
    }
    return JSON.parse(result);
  } catch (err) {
    console.error("Error decrypting offline data:", err);
    return null;
  }
};

export const initDB = (): Promise<IDBDatabase> => {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    // Timeout de 2 segundos para evitar bloqueos indefinidos
    const timeout = setTimeout(() => {
      console.warn("IndexedDB connection timeout.");
      reject(new Error("IndexedDB connection timeout."));
    }, 2000);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      clearTimeout(timeout);
      reject(request.error);
    };

    request.onsuccess = () => {
      clearTimeout(timeout);
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

    request.onblocked = () => {
      clearTimeout(timeout);
      console.warn("Conexion a IndexedDB bloqueada por otra pestaña.");
      reject(new Error("IndexedDB connection blocked by another tab."));
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
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const encryptedPayload = encryptData(transaction);
      const request = store.add({
        payload: encryptedPayload,
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
    } catch (err) {
      reject(err);
    }
  });
};

export const getOfflineTransactions = async (): Promise<any[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const results = request.result || [];
        const decrypted = results.map((r: any) => {
          const data = decryptData(r.payload);
          return data ? { ...data, id: r.id, offline_created_at: r.offline_created_at } : null;
        }).filter((x: any) => x !== null);
        resolve(decrypted);
      };
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
};

export const clearOfflineTransactions = async (): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
};

export const saveInvoiceClaimOffline = async (
  claim: any,
): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction("invoice_claims", "readwrite");
      const store = tx.objectStore("invoice_claims");
      const encryptedPayload = encryptData(claim);
      const request = store.add({
        payload: encryptedPayload,
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
    } catch (err) {
      reject(err);
    }
  });
};

export const getOfflineInvoiceClaims = async (): Promise<any[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction("invoice_claims", "readonly");
      const store = tx.objectStore("invoice_claims");
      const request = store.getAll();

      request.onsuccess = () => {
        const results = request.result || [];
        const decrypted = results.map((r: any) => {
          const data = decryptData(r.payload);
          return data ? { ...data, id: r.id, offline_created_at: r.offline_created_at } : null;
        }).filter((x: any) => x !== null);
        resolve(decrypted);
      };
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
};

export const clearOfflineInvoiceClaims = async (): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction("invoice_claims", "readwrite");
      const store = tx.objectStore("invoice_claims");
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
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
      const { id, offline_created_at, items, ...data } = t;
      const { error } = await supabase.from("cash_transactions").insert(data);
      if (!error) {
        synced++;
        // Sincronizar existencias e inventario del Kardex
        if (items && Array.isArray(items) && items.length > 0) {
          try {
            const { error: rpcErr } = await supabase.rpc("reduce_inventory_stock", {
              items: items.map((item: any) => ({ id: item.id, qty: item.qty })),
              ref_id: "OFFLINE-SYNC",
              user_name: "Sincronización Offline",
              move_type: "sale"
            });
            if (rpcErr) {
              console.warn("Falla al aplicar RPC en sincronización offline, reintentando con manual...", rpcErr);
              for (const item of items) {
                if (item.id) {
                  const { data: invItem } = await supabase.from("inventory").select("stock").eq("id", item.id).single();
                  if (invItem) {
                    await supabase.from("inventory").update({ stock: invItem.stock - item.qty }).eq("id", item.id);
                  }
                }
              }
            }
          } catch (invErr) {
            console.error("Error al sincronizar inventario offline:", invErr);
          }
        }
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
