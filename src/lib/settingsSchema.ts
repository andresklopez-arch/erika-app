import { z } from "zod";

export const BusinessConfigSchema = z.object({
  voice_keyword: z.string().default("erika"),
  earn_rate: z.number().default(100),
  earn_points: z.number().default(1),
  redeem_rate: z.number().default(10),
  wholesale_min_qty: z.number().default(10),
  wholesale_discount: z.number().default(10),
  theme: z.string().default("dark"),
  business_name: z.string().default("Ferretería ERIKA"),
  business_rfc: z.string().default(""),
  business_phone: z.string().default(""),
  business_email: z.string().default(""),
  business_address: z.string().default(""),
  business_logo: z.string().default(""),
  printer_connected: z.boolean().default(true),
  printer_type: z.string().default("system"),
});

export const BusinessSettingsSchema = z.object({
  target_utility: z.number().min(0).max(100).default(30),
  monthly_goals: z.number().nonnegative().default(0),
  config: BusinessConfigSchema.default({}),
});

export type BusinessConfig = z.infer<typeof BusinessConfigSchema>;
export type BusinessSettings = z.infer<typeof BusinessSettingsSchema>;
