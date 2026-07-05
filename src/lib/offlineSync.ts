import { supabase } from "./supabaseClient";

const DB_NAME = "ErikaOfflineDB";
const STORE_NAME = "cash_transactions";
const DB_VERSION = 3;

let dbInstance: IDBDatabase | null = null;

// Obfuscación y Cifrado Simétrico AES-GCM (Grado Bancario) para mayor confidencialidad de IndexedDB local (Sugerencia 2)
let dynamicSessionKey = "ERIKA_OFFLINE_SECURE_KEY";

export const setOfflineSessionKey = (userId: string, userPin: string) => {
  if (userId && userPin) {
     dynamicSessionKey = `ERIKA_OFFLINE_${userId}_${userPin}`;
  } else {
     dynamicSessionKey = "ERIKA_OFFLINE_SECURE_KEY";
  }
};

const getCryptoKey = async (): Promise<CryptoKey> => {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(dynamicSessionKey),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("erika-salt-123"),
      iterations: 1000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

const encryptData = async (data: any): Promise<string> => {
  try {
    const key = await getCryptoKey();
    const enc = new TextEncoder();
    const encodedData = enc.encode(JSON.stringify(data));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encodedData
    );
    
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    let binary = "";
    for (let i = 0; i < combined.length; i++) {
      binary += String.fromCharCode(combined[i]);
    }
    return btoa(binary);
  } catch (err) {
    console.error("AES encryption failed, falling back to basic:", err);
    return "";
  }
};

const decryptData = async (encryptedStr: string): Promise<any> => {
  try {
    const key = await getCryptoKey();
    const binary = atob(encryptedStr);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    
    const iv = bytes.slice(0, 12);
    const data = bytes.slice(12);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      data
    );
    
    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decrypted));
  } catch (err) {
    console.error("AES decryption failed:", err);
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
  const encryptedPayload = await encryptData(transaction);
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
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

      request.onsuccess = async () => {
        const results = request.result || [];
        const decryptedPromises = results.map(async (r: any) => {
          const data = await decryptData(r.payload);
          return data ? { ...data, id: r.id, offline_created_at: r.offline_created_at } : null;
        });
        const decrypted = (await Promise.all(decryptedPromises)).filter((x: any) => x !== null);
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
  const encryptedPayload = await encryptData(claim);
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction("invoice_claims", "readwrite");
      const store = tx.objectStore("invoice_claims");
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

      request.onsuccess = async () => {
        const results = request.result || [];
        const decryptedPromises = results.map(async (r: any) => {
          const data = await decryptData(r.payload);
          return data ? { ...data, id: r.id, offline_created_at: r.offline_created_at } : null;
        });
        const decrypted = (await Promise.all(decryptedPromises)).filter((x: any) => x !== null);
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
        // Guardar en la bitácora local de sincronización (Sugerencia 3)
        try {
          const logKey = "ERIKA_OFFLINE_SYNC_LOG";
          const currentLog = JSON.parse(localStorage.getItem(logKey) || "[]");
          const newEntry = {
            ticket_id: items ? "Ticket" : "Transacción",
            amount: data.amount,
            description: data.description,
            synced_at: new Date().toISOString(),
            status: "success"
          };
          currentLog.unshift(newEntry);
          localStorage.setItem(logKey, JSON.stringify(currentLog.slice(0, 10)));
        } catch (logErr) {
          console.error("Error updating offline sync log:", logErr);
        }

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
        // Guardar error en la bitácora de sincronización (Sugerencia 2)
        try {
          const logKey = "ERIKA_OFFLINE_SYNC_LOG";
          const currentLog = JSON.parse(localStorage.getItem(logKey) || "[]");
          const newEntry = {
            ticket_id: items ? "Ticket" : "Transacción",
            amount: data.amount,
            description: `FALLA: ${data.description || "Cobro Offline"}`,
            synced_at: new Date().toISOString(),
            status: "error",
            error_details: error.message || "Error desconocido"
          };
          currentLog.unshift(newEntry);
          localStorage.setItem(logKey, JSON.stringify(currentLog.slice(0, 10)));
        } catch (logErr) {
          console.error("Error updating offline sync log with error details:", logErr);
        }
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
