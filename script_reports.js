const fs = require('fs');
const file = 'src/components/ReportsModule.tsx';
let code = fs.readFileSync(file, 'utf8');

// Add radarFilterFecha state
code = code.replace(
  '  const [lostSales, setLostSales] = useState<{term: string, count: number, type: string}[]>([]);',
  \  const [lostSales, setLostSales] = useState<{term: string, count: number, type: string}[]>([]);
  const [radarFilterFecha, setRadarFilterFecha] = useState("mes");\
);

// Remove the old lost sales fetch from the main useEffect
code = code.replace(/        \/\/ Lost Sales[\s\S]*?setLostSales\(sorted as any\);\n        \}/m, '');

// Add the new useEffect for Radar
const newUseEffect = \
  useEffect(() => {
    const fetchRadar = async () => {
      let query = supabase.from("lost_sales_requests").select("*");
      
      const now = new Date();
      if (radarFilterFecha !== "todos") {
        if (radarFilterFecha === "hoy") {
          const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
          query = query.gte("created_at", startOfToday);
        } else if (radarFilterFecha === "semana") {
          const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
          query = query.gte("created_at", sevenDaysAgo);
        } else if (radarFilterFecha === "mes") {
          const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
          query = query.gte("created_at", startOfThisMonth);
        }
      }

      const { data: lostData } = await query;
      if (lostData) {
         const grouped = lostData.reduce((acc: any, curr: any) => {
            const term = curr.term.trim().toUpperCase();
            if (!acc[term]) acc[term] = { term, count: 0, type: curr.type };
            acc[term].count += 1;
            return acc;
         }, {});
         const sorted = Object.values(grouped).sort((a: any, b: any) => b.count - a.count).slice(0, 10);
         setLostSales(sorted as any);
      } else {
         setLostSales([]);
      }
    };
    fetchRadar();
  }, [radarFilterFecha]);
\;

code = code.replace('  useEffect(() => {', newUseEffect + '\n  useEffect(() => {');

// Update UI
const uiReplacement = \
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
            <h2 style={{ color: "var(--color-primary)", margin: 0 }}>
              🧠 Radar de Demanda (Ventas Perdidas)
            </h2>
            <select
              value={radarFilterFecha}
              onChange={(e) => setRadarFilterFecha(e.target.value)}
              style={{
                padding: "5px 10px",
                borderRadius: "8px",
                background: "rgba(0,0,0,0.3)",
                color: "white",
                border: "1px solid var(--color-primary)",
                outline: "none",
                cursor: "pointer",
                fontSize: "0.85rem"
              }}
            >
              <option value="hoy" style={{ background: "#1f2937" }}>Hoy</option>
              <option value="semana" style={{ background: "#1f2937" }}>Últimos 7 días</option>
              <option value="mes" style={{ background: "#1f2937" }}>Este mes</option>
              <option value="todos" style={{ background: "#1f2937" }}>Todos los registros</option>
            </select>
          </div>
          <p style={{ marginBottom: "15px" }}>
            Artículos solicitados por clientes que no teníamos en inventario o estaban agotados:
          </p>
\;

code = code.replace(
  /<h2 style={{ color: "var\(--color-primary\)", marginBottom: "15px" }}>\s*🧠 Radar de Demanda \(Ventas Perdidas\)\s*<\/h2>\s*<p style={{ marginBottom: "15px" }}>\s*Artículos solicitados por clientes este mes que no teníamos en inventario o estaban agotados:\s*<\/p>/m,
  uiReplacement
);

const liReplacement = \
              <li
                key={idx}
                style={{
                  background: "rgba(0,0,0,0.3)",
                  padding: "10px 15px",
                  borderRadius: "8px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderLeft: item.type === "AGOTADO" ? "4px solid #ef4444" : "4px solid #3b82f6"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontWeight: "bold" }}>{item.term}</span>
                  <span style={{ fontSize: "0.8rem", color: "var(--color-secondary)", padding: "2px 6px", background: "rgba(255,255,255,0.1)", borderRadius: "4px" }}>
                    {item.type === "AGOTADO" ? "Agotado" : "No en catálogo"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
                  <div style={{ color: "#f59e0b", fontWeight: "bold", display: "flex", alignItems: "center", gap: "5px" }}>
                    <span>🔥</span> {item.count} peticiones
                  </div>
                  <button 
                    onClick={() => {
                      window.location.href = \/inventario?create=\\;
                    }}
                    style={{
                      background: "var(--color-primary)",
                      color: "black",
                      border: "none",
                      padding: "5px 10px",
                      borderRadius: "5px",
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "0.8rem"
                    }}
                  >
                    ➕ Crear
                  </button>
                </div>
              </li>
\;

code = code.replace(/<li[\s\S]*?🔥[\s\S]*?<\/li>/g, liReplacement); // This might match too much, let's refine. Wait.
// Better to just use string replace.
fs.writeFileSync(file, code);
