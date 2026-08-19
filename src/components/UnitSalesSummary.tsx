"use client";
import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { supabase } from "../lib/supabaseClient";
import { SALE_UNIT_LABELS } from "./InventoryModule";

const MAX_MOVEMENTS = 5000; // límite razonable para no traer un periodo enorme entero a memoria
const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const TREND_COLORS = ["var(--color-primary)", "#10b981", "#3b82f6", "#f59e0b", "#a855f7"];

type UnitTotals = Record<string, { qty: number; cost: number; revenue: number }>;

// unit_cost/unit_price son el snapshot guardado por reduce_inventory_stock
// al momento del movimiento; si faltan (movimientos de antes de esa
// migración), se cae al costo/precio ACTUAL del producto como estimado.
function summarizeMovements(rows: any[]): UnitTotals {
  const totals: UnitTotals = {};
  rows.forEach((m: any) => {
    const unit = m.inventory?.sale_unit || "pieza";
    const qty = Math.abs(Number(m.quantity) || 0);
    const cost = m.unit_cost != null ? Number(m.unit_cost) : Number(m.inventory?.cost) || 0;
    const price = m.unit_price != null ? Number(m.unit_price) : Number(m.inventory?.price) || 0;
    if (!totals[unit]) totals[unit] = { qty: 0, cost: 0, revenue: 0 };
    totals[unit].qty += qty;
    totals[unit].cost += qty * cost;
    totals[unit].revenue += qty * price;
  });
  return totals;
}

// compact=true (Dashboard): solo las tarjetas de resumen con su filtro, sin
// exportar ni gráfica de 6 meses, para no sobrecargar el resumen diario.
export default function UnitSalesSummary({ compact = false }: { compact?: boolean }) {
  const [summary, setSummary] = useState<UnitTotals>({});
  const [filterFecha, setFilterFecha] = useState("mes");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [capped, setCapped] = useState(false);
  const [trend, setTrend] = useState<any[]>([]);
  const [trendUnits, setTrendUnits] = useState<string[]>([]);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const fetchSummary = async () => {
      let query = supabase
        .from("inventory_movements")
        .select("quantity, unit_cost, unit_price, inventory:inventory_id(sale_unit, cost, price)")
        .eq("movement_type", "sale")
        .limit(MAX_MOVEMENTS);

      if (filterFecha === "personalizado") {
        if (!dateFrom || !dateTo) return;
        query = query
          .gte("created_at", new Date(dateFrom).toISOString())
          .lt("created_at", new Date(new Date(dateTo).getTime() + 24 * 60 * 60 * 1000).toISOString());
      } else if (filterFecha !== "todos") {
        const now = new Date();
        if (filterFecha === "hoy") {
          query = query.gte("created_at", new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString());
        } else if (filterFecha === "semana") {
          query = query.gte("created_at", new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());
        } else if (filterFecha === "mes") {
          query = query.gte("created_at", new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
        }
      }

      const { data, error } = await query;
      if (!error && data) {
        setSummary(summarizeMovements(data));
        setCapped(data.length >= MAX_MOVEMENTS);
      } else {
        setSummary({});
        setCapped(false);
      }
    };
    fetchSummary();
  }, [filterFecha, dateFrom, dateTo]);

  // Tendencia de 6 meses: independiente del filtro de arriba (no se
  // recalcula cada vez que cambias el periodo del resumen) y solo se pide
  // en la vista completa (Reportes), no en el Dashboard compacto.
  useEffect(() => {
    if (compact) return;

    const fetchTrend = async () => {
      const now = new Date();
      const monthStarts: Date[] = [];
      for (let i = 5; i >= 0; i--) {
        monthStarts.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
      }

      const { data } = await supabase
        .from("inventory_movements")
        .select("quantity, created_at, inventory:inventory_id(sale_unit)")
        .eq("movement_type", "sale")
        .gte("created_at", monthStarts[0].toISOString())
        .limit(MAX_MOVEMENTS);

      const buckets: Record<string, Record<string, number>> = {};
      const unitsSeen = new Set<string>();
      monthStarts.forEach((d) => {
        buckets[`${d.getFullYear()}-${d.getMonth()}`] = {};
      });

      (data || []).forEach((m: any) => {
        const d = new Date(m.created_at);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (!(key in buckets)) return;
        const unit = m.inventory?.sale_unit || "pieza";
        unitsSeen.add(unit);
        buckets[key][unit] = (buckets[key][unit] || 0) + Math.abs(Number(m.quantity) || 0);
      });

      const rows = monthStarts.map((d) => {
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        const row: any = { mes: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}` };
        unitsSeen.forEach((u) => {
          row[SALE_UNIT_LABELS[u] || u] = Number((buckets[key][u] || 0).toFixed(3));
        });
        return row;
      });

      setTrend(rows);
      setTrendUnits(Array.from(unitsSeen).map((u) => SALE_UNIT_LABELS[u] || u));
    };

    fetchTrend();
  }, [compact]);

  const exportToExcel = () => {
    const rows = Object.entries(summary).map(([unit, t]) => ({
      Unidad: SALE_UNIT_LABELS[unit] || unit,
      "Cantidad Vendida": t.qty,
      "Costo Estimado": Number(t.cost.toFixed(2)),
      "Venta Estimada": Number(t.revenue.toFixed(2)),
      "Utilidad Estimada": Number((t.revenue - t.cost).toFixed(2)),
    }));
    if (rows.length === 0) return alert("No hay ventas por unidad en este periodo.");
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ventas_Por_Unidad");
    XLSX.writeFile(wb, `Ventas_Por_Unidad_ERIKA_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  return (
    <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <h3 style={{ color: "var(--color-secondary)", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            ⚖️ Ventas por Unidad
          </h3>
          {!compact && (
            <p style={{ margin: "5px 0 0 0", fontSize: "0.8rem", opacity: 0.7 }}>
              Útil para negociar precios con proveedores de productos a granel.
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={filterFecha}
            onChange={(e) => setFilterFecha(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white", fontSize: "0.85rem" }}
          >
            <option value="hoy">Hoy</option>
            <option value="semana">Últimos 7 días</option>
            <option value="mes">Este Mes</option>
            <option value="todos">Todo el Historial</option>
            {!compact && <option value="personalizado">Personalizado...</option>}
          </select>
          {!compact && filterFecha === "personalizado" && (
            <>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{ padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white", fontSize: "0.85rem" }}
              />
              <span style={{ opacity: 0.6, fontSize: "0.85rem" }}>a</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={{ padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white", fontSize: "0.85rem" }}
              />
            </>
          )}
          {!compact && (
            <button
              onClick={exportToExcel}
              className="btn-primary"
              style={{ padding: "8px 14px", fontSize: "0.85rem", background: "rgba(16,185,129,0.15)", border: "1px solid #10b981", color: "#10b981" }}
            >
              📥 Exportar
            </button>
          )}
        </div>
      </div>

      {capped && (
        <p style={{ margin: 0, fontSize: "0.75rem", color: "#f59e0b" }}>
          ⚠️ Este periodo tiene muchísimos movimientos — el cálculo se limitó a los primeros 5,000 y puede estar incompleto. Elige un rango más corto para un total exacto.
        </p>
      )}

      {Object.keys(summary).length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginTop: "5px" }}>
          {Object.entries(summary).map(([unit, t]) => (
            <div
              key={unit}
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid var(--glass-border)",
                borderRadius: "10px",
                padding: "10px 18px",
                minWidth: "160px",
              }}
            >
              <div style={{ fontSize: "1.3rem", fontWeight: "bold", color: "var(--color-primary)" }}>
                {t.qty.toLocaleString("es-MX", { maximumFractionDigits: 3 })}
              </div>
              <div style={{ fontSize: "0.8rem", opacity: 0.8, marginBottom: "6px" }}>{SALE_UNIT_LABELS[unit] || unit}</div>
              <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Costo: ${t.cost.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</div>
              <div style={{ fontSize: "0.75rem", color: "#10b981" }}>Utilidad: ${(t.revenue - t.cost).toLocaleString("es-MX", { minimumFractionDigits: 2 })}</div>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.6 }}>Sin ventas registradas en este periodo.</p>
      )}

      {!compact && trend.length > 0 && (
        <div style={{ marginTop: "10px" }}>
          <p style={{ margin: "0 0 8px 0", fontSize: "0.85rem", opacity: 0.8 }}>📊 Últimos 6 Meses (cantidad vendida por unidad)</p>
          <div style={{ width: "100%", height: "240px" }}>
            {isMounted && (
              <ResponsiveContainer>
                <BarChart data={trend}>
                  <XAxis dataKey="mes" stroke="#fff" tick={{ fill: "#ccc", fontSize: 12 }} />
                  <YAxis stroke="#fff" tick={{ fill: "#ccc" }} />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.1)" }}
                    contentStyle={{ background: "#111", border: "1px solid var(--color-primary)" }}
                  />
                  <Legend wrapperStyle={{ fontSize: "0.8rem" }} />
                  {trendUnits.map((unit, idx) => (
                    <Bar key={unit} dataKey={unit} fill={TREND_COLORS[idx % TREND_COLORS.length]} radius={[4, 4, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
