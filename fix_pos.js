const fs = require('fs');
const file = 'src/components/POSModule.tsx';
let code = fs.readFileSync(file, 'utf8');

const regex = /\{showAutocomplete && \([\s\S]*?No se encontraron productos en el inventario.[\s\S]*?<\/button>[\s\S]*?<\/div>[\s\S]*?<\/div>[\s\S]*?<\/>\n\s*\)}/m;

const replacement = \{showAutocomplete && (
                      <>
                        <div style={{
                          position: "fixed",
                          top: 0, left: 0, right: 0, bottom: 0,
                          backgroundColor: "rgba(0,0,0,0.7)",
                          zIndex: 99,
                          backdropFilter: "blur(2px)"
                        }}></div>
                        <div style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          right: 0,
                          marginTop: "5px",
                          background: "#1a1a1a",
                          border: "1px solid var(--color-primary)",
                          borderRadius: "8px",
                          zIndex: 100,
                          maxHeight: "350px",
                          overflowY: "auto",
                          boxShadow: "0 10px 25px rgba(0,0,0,0.8)"
                        }}>
                          {filteredCatalog.map((c, idx) => (
                            <div 
                              key={c.id} 
                              onClick={async () => {
                                if (c.stock <= 0) {
                                  if (window.confirm(\El producto "\" está AGOTADO. ¿Deseas registrarlo en el Radar de Demanda (Ventas Perdidas)?\)) {
                                    await supabase.from("lost_sales_requests").insert({ term: c.name, type: "AGOTADO" });
                                    alert("✅ Registrado en el reporte de inteligencia.");
                                  }
                                } else {
                                  addToCart(c.name, c.price, "pz", c.cost, 1, c.image_url);
                                }
                                setSearchInput("");
                                setShowAutocomplete(false);
                                setFocusedIndex(-1);
                              }}
                              onMouseEnter={() => setFocusedIndex(idx)}
                              style={{
                                padding: "10px 15px",
                                borderBottom: "1px solid rgba(255,255,255,0.1)",
                                cursor: "pointer",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                background: focusedIndex === idx ? "rgba(16, 185, 129, 0.3)" : (c.stock <= 0 ? "rgba(239, 68, 68, 0.15)" : "transparent"),
                                opacity: c.stock <= 0 ? 0.7 : 1
                              }}
                            >
                              <div>
                                <div style={{ fontWeight: "bold", color: c.stock <= 0 ? "#ef4444" : "white" }}>
                                  {c.name} {c.stock <= 0 ? "(AGOTADO)" : ""}
                                </div>
                                <div style={{ fontSize: "0.8rem", color: "var(--color-secondary)" }}>Código: {c.code || "N/A"} | Stock: {c.stock}</div>
                              </div>
                              <div style={{ fontWeight: "bold", color: "var(--color-primary)" }}>
                                \
                              </div>
                            </div>
                          ))}
                          {filteredCatalog.length === 0 && (
                            <div style={{ padding: "15px", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
                              No se encontraron productos en el inventario.
                              <button 
                                onClick={async () => {
                                  if (searchInput.trim() !== "") {
                                    await supabase.from("lost_sales_requests").insert({ term: searchInput, type: "NUEVO_PRODUCTO" });
                                    alert(\✅ "\" registrado en el reporte de productos solicitados.\);
                                    setSearchInput("");
                                    setShowAutocomplete(false);
                                  }
                                }}
                                className="btn-primary" 
                                style={{ display: "block", width: "100%", marginTop: "10px", background: "transparent", border: "1px dashed var(--color-secondary)" }}
                              >
                                📝 Reportar como Solicitado
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    )}\;

if (regex.test(code)) {
    code = code.replace(regex, replacement);
    fs.writeFileSync(file, code);
    console.log("Success");
} else {
    console.log("Regex didn't match.");
}
