const fs = require('fs');
const file = 'src/components/InventoryModule.tsx';
let code = fs.readFileSync(file, 'utf8');

// 1. Add create param state
code = code.replace(
  'const showImporter = tab === "carga";',
  'const showImporter = tab === "carga";\n  const createParam = searchParams ? searchParams.get("create") : null;'
);

// 2. Add New Product Modal state & function
const modalState = \
  const [showCreateModal, setShowCreateModal] = useState(!!createParam);
  const [newProductName, setNewProductName] = useState(createParam || "");
  const [newProductCode, setNewProductCode] = useState("");
  const [newProductCost, setNewProductCost] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newProductStock, setNewProductStock] = useState("1");
\;

code = code.replace(
  'const clearTabParam = () => {',
  modalState + '\n\n  const clearTabParam = () => {'
);

// 3. Add useEffect to open modal when param changes
const useEffectCode = \
  useEffect(() => {
    if (createParam) {
      setNewProductName(createParam);
      setShowCreateModal(true);
    }
  }, [createParam]);

  const handleCreateProduct = async () => {
    if (!newProductName) return alert("Nombre es requerido");
    const c = parseFloat(newProductCost) || 0;
    const p = parseFloat(newProductPrice) || 0;
    const s = parseInt(newProductStock) || 0;
    
    await supabase.from("inventory").insert({
      code: newProductCode || \SKU-\\,
      name: newProductName,
      cost: c,
      price: p > 0 ? p : c * 1.5,
      stock: s,
      minStock: 5,
      location: "Pendiente",
      supplier: "Pendiente",
      autoPriced: true
    });
    
    alert("✅ Producto creado con éxito");
    setShowCreateModal(false);
    fetchInventory();
    router.push("/inventario");
  };
\;

code = code.replace(
  '  const fetchInventory = async (showLoading = false) => {',
  useEffectCode + '\n  const fetchInventory = async (showLoading = false) => {'
);

// 4. Add the JSX for the Modal
const modalJSX = \
      {mounted && showCreateModal && createPortal(
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, backdropFilter: "blur(5px)" }}>
          <div className="glass-panel" style={{ width: "400px", padding: "20px", display: "flex", flexDirection: "column", gap: "10px", position: "relative" }}>
            <button onClick={() => { setShowCreateModal(false); router.push("/inventario"); }} style={{ position: "absolute", top: "10px", right: "10px", background: "transparent", border: "none", color: "white", fontSize: "1.2rem", cursor: "pointer" }}>✖</button>
            <h2 style={{ color: "var(--color-primary)", marginBottom: "10px" }}>➕ Crear Nuevo Producto</h2>
            
            <label style={{ fontSize: "0.85rem" }}>Nombre del Producto</label>
            <input type="text" value={newProductName} onChange={e => setNewProductName(e.target.value)} style={{ padding: "10px", borderRadius: "5px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
            
            <label style={{ fontSize: "0.85rem" }}>Código (Opcional, se autogenera)</label>
            <input type="text" value={newProductCode} onChange={e => setNewProductCode(e.target.value)} style={{ padding: "10px", borderRadius: "5px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
            
            <div style={{ display: "flex", gap: "10px" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <label style={{ fontSize: "0.85rem" }}>Costo ($)</label>
                <input type="number" value={newProductCost} onChange={e => setNewProductCost(e.target.value)} style={{ padding: "10px", borderRadius: "5px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <label style={{ fontSize: "0.85rem" }}>Precio Venta ($)</label>
                <input type="number" value={newProductPrice} onChange={e => setNewProductPrice(e.target.value)} style={{ padding: "10px", borderRadius: "5px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />
              </div>
            </div>

            <label style={{ fontSize: "0.85rem" }}>Stock Inicial</label>
            <input type="number" value={newProductStock} onChange={e => setNewProductStock(e.target.value)} style={{ padding: "10px", borderRadius: "5px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.3)", color: "white" }} />

            <button onClick={handleCreateProduct} className="btn-primary" style={{ marginTop: "15px" }}>Guardar Producto</button>
          </div>
        </div>,
        document.body
      )}
\;

code = code.replace(
  '{mounted && showClientModal && createPortal(',
  modalJSX + '\n      {mounted && showClientModal && createPortal('
);

fs.writeFileSync(file, code);
