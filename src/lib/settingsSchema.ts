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
  printer_name: z.string().default(""),
  printer_paper_size: z.string().default("80mm"),
  printer_font_size: z.string().default("normal"),
  printer_font_family: z.string().default("monospace"),
  printer_fields: z.array(z.string()).default(["name", "rfc", "phone", "address", "logo", "footer"]),
  printer_footer_msg: z.string().default("¡Gracias por su compra!"),
  low_stock_threshold: z.number().default(5),
});

export const BusinessSettingsSchema = z.object({
  target_utility: z.number().min(0).max(100).default(30),
  monthly_goals: z.number().nonnegative().default(0),
  config: BusinessConfigSchema.default({
    voice_keyword: "erika",
    earn_rate: 100,
    earn_points: 1,
    redeem_rate: 10,
    wholesale_min_qty: 10,
    wholesale_discount: 10,
    theme: "dark",
    business_name: "Ferretería ERIKA",
    business_rfc: "",
    business_phone: "",
    business_email: "",
    business_address: "",
    business_logo: "",
    printer_connected: true,
    printer_type: "system",
    printer_name: "",
    printer_paper_size: "80mm",
    printer_font_size: "normal",
    printer_font_family: "monospace",
    printer_fields: ["name", "rfc", "phone", "address", "logo", "footer"],
    printer_footer_msg: "¡Gracias por su compra!",
    low_stock_threshold: 5,
  }),
});

export type BusinessConfig = z.infer<typeof BusinessConfigSchema>;
export type BusinessSettings = z.infer<typeof BusinessSettingsSchema>;
