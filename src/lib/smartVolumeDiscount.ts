// Lógica pura del Descuento Inteligente por Volumen -- extraída de
// POSModule.tsx (que sigue re-exportando getSmartVolumeDiscount para no
// romper sus imports existentes en QuotesModule.tsx) al mismo lugar que
// parsePercent.ts, quoteTotalCheck.ts y posItemMatch.ts: sin JSX ni
// imports de navegador, para poder:
//   1. Reutilizarla en InventoryModule.tsx (preview de precio en vivo al
//      crear una regla) sin arrastrar todo POSModule.tsx (que sí importa
//      cosas de navegador como html5-qrcode).
//   2. Requerirla directo desde un script de Node (scripts/test-decimal-discount.js)
//      para probar la aplicación real de un descuento con decimales, no
//      solo que el campo lo acepta.

export interface SmartVolumeTier {
  minQty: number;
  discountPct: number;
}

export interface SmartVolumeRule {
  id?: string;
  name: string;
  targetType: "keyword" | "supplier" | "product" | "all";
  targetValue: string;
  tiers: SmartVolumeTier[];
  active: boolean;
}

const normalize = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

// 🧠 Evaluador de Descuento Inteligente por Volumen y Escalas (ej. Pijas a partir de 20 pz -> 5%, 30 pz -> 30%)
export const getSmartVolumeDiscount = (
  item: any,
  rules: any[]
): { discountPct: number; tierQty?: number; ruleName?: string } => {
  if (!item || !rules || !Array.isArray(rules) || rules.length === 0) {
    return { discountPct: 0 };
  }

  const itemNameNorm = normalize(item.name || "");
  const itemCodeNorm = (item.code || "").toLowerCase().trim();
  const itemSupplierNorm = (item.supplier || "").toLowerCase().trim();
  const qty = Number(item.qty || 1);

  let bestDiscount = 0;
  let bestTierQty = 0;
  let bestRuleName = "";

  for (const rule of rules) {
    if (!rule || !rule.active || !Array.isArray(rule.tiers) || rule.tiers.length === 0) continue;

    let matches = false;
    const targetValNorm = normalize(rule.targetValue || "");

    if (rule.targetType === "all") {
      matches = true;
    } else if (rule.targetType === "keyword") {
      matches = targetValNorm !== "" && itemNameNorm.includes(targetValNorm);
    } else if (rule.targetType === "supplier") {
      matches = targetValNorm !== "" && itemSupplierNorm.includes(targetValNorm);
    } else if (rule.targetType === "product") {
      matches =
        targetValNorm !== "" &&
        (String(item.id || "") === rule.targetValue ||
          itemCodeNorm === targetValNorm ||
          itemNameNorm === targetValNorm);
    }

    if (matches) {
      // Ordenar escalas de mayor cantidad a menor para aplicar el tramo más alto alcanzado
      const sortedTiers = [...rule.tiers].sort((a: any, b: any) => b.minQty - a.minQty);
      for (const tier of sortedTiers) {
        if (qty >= tier.minQty) {
          if (tier.discountPct > bestDiscount) {
            bestDiscount = tier.discountPct;
            bestTierQty = tier.minQty;
            bestRuleName = rule.name;
          }
          break;
        }
      }
    }
  }

  return { discountPct: bestDiscount, tierQty: bestTierQty, ruleName: bestRuleName };
};

// 💡 Detecta la siguiente escala de volumen alcanzable para sugerir al cajero (Upsell)
export const getNextSmartVolumeTier = (
  item: any,
  rules: any[]
): { nextQty: number; discountPct: number; diff: number; ruleName: string } | null => {
  if (!item || !rules || !Array.isArray(rules) || rules.length === 0) return null;

  const itemNameNorm = normalize(item.name || "");
  const itemCodeNorm = (item.code || "").toLowerCase().trim();
  const itemSupplierNorm = (item.supplier || "").toLowerCase().trim();
  const qty = Number(item.qty || 1);

  let bestNextTier: { nextQty: number; discountPct: number; diff: number; ruleName: string } | null = null;

  for (const rule of rules) {
    if (!rule || !rule.active || !Array.isArray(rule.tiers) || rule.tiers.length === 0) continue;

    let matches = false;
    const targetValNorm = normalize(rule.targetValue || "");

    if (rule.targetType === "all") {
      matches = true;
    } else if (rule.targetType === "keyword") {
      matches = targetValNorm !== "" && itemNameNorm.includes(targetValNorm);
    } else if (rule.targetType === "supplier") {
      matches = targetValNorm !== "" && itemSupplierNorm.includes(targetValNorm);
    } else if (rule.targetType === "product") {
      matches =
        targetValNorm !== "" &&
        (String(item.id || "") === rule.targetValue ||
          itemCodeNorm === targetValNorm ||
          itemNameNorm === targetValNorm);
    }

    if (matches) {
      const sortedTiers = [...rule.tiers].sort((a: any, b: any) => a.minQty - b.minQty);
      for (const tier of sortedTiers) {
        if (tier.minQty > qty) {
          const diff = tier.minQty - qty;
          if (!bestNextTier || diff < bestNextTier.diff) {
            bestNextTier = {
              nextQty: tier.minQty,
              discountPct: tier.discountPct,
              diff,
              ruleName: rule.name
            };
          }
          break;
        }
      }
    }
  }

  return bestNextTier;
};
