import { z } from "zod";

export const InventoryItemSchema = z.object({
  id: z.string(),
  code: z.string().optional().nullable().default(""),
  name: z.string().default("Producto sin nombre"),
  price: z.preprocess((val) => Number(val) || 0, z.number()),
  cost: z.preprocess((val) => Number(val) || 0, z.number()),
  stock: z.preprocess((val) => Number(val) || 0, z.number()),
  minStock: z.preprocess((val) => Number(val) || 5, z.number()),
  supplier: z.string().optional().nullable().default(""),
  location: z.string().optional().nullable().default(""),
  discount_pct: z.preprocess((val) => Number(val) || 0, z.number().default(0)),
  discount_start_at: z.string().optional().nullable(),
  discount_end_at: z.string().optional().nullable(),
});

export const CustomerSchema = z.object({
  id: z.string(),
  name: z.string().default("Cliente sin nombre"),
  phone: z.string().optional().nullable().default(""),
  rfc: z.string().optional().nullable().default(""),
  email: z.string().optional().nullable().default(""),
  company_name: z.string().optional().nullable().default(""),
  credit_limit: z.preprocess((val) => Number(val) || 0, z.number()),
  balance: z.preprocess((val) => Number(val) || 0, z.number()),
  points: z.preprocess((val) => Number(val) || 0, z.number()),
  deleted: z.boolean().optional().nullable().default(false),
  created_at: z.string().optional().nullable(),
});

export const LayawaySchema = z.object({
  id: z.string(),
  customer_id: z.string(),
  customer_name: z.string().default("Cliente sin nombre"),
  total_amount: z.preprocess((val) => Number(val) || 0, z.number()),
  balance: z.preprocess((val) => Number(val) || 0, z.number()),
  status: z.enum(["pending", "completed", "cancelled"]).default("pending"),
  items: z.preprocess(
    (val) => {
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch {
          return [];
        }
      }
      return Array.isArray(val) ? val : [];
    },
    z.array(
      z.object({
        id: z.string().optional(),
        name: z.string().default("Artículo sin nombre"),
        price: z.preprocess((val) => Number(val) || 0, z.number()),
        qty: z.preprocess((val) => Number(val) || 1, z.number()),
      })
    )
  ).default([]),
  created_at: z.string(),
  due_date: z.string(),
});

export const CashSessionSchema = z.object({
  id: z.string(),
  opened_at: z.string(),
  closed_at: z.string().optional().nullable(),
  opened_by: z.string().default("Sistema"),
  initial_balance: z.preprocess((val) => Number(val) || 0, z.number()),
  expected_balance: z.preprocess((val) => Number(val) || 0, z.number().optional().nullable()),
  counted_balance: z.preprocess((val) => Number(val) || 0, z.number().optional().nullable()),
  discrepancy: z.preprocess((val) => Number(val) || 0, z.number().optional().nullable()),
  status: z.enum(["open", "closed"]).default("open"),
});

export type InventoryItem = z.infer<typeof InventoryItemSchema>;
export type Customer = z.infer<typeof CustomerSchema>;
export type Layaway = z.infer<typeof LayawaySchema>;
export type CashSession = z.infer<typeof CashSessionSchema>;
