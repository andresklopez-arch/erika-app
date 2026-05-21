"use client";
import { useState, useEffect, useRef } from "react";
import { fuzzySearch } from "@/utils/levenshtein";

interface Product {
  id: string;
  name: string;
  price: number;
}

const MOCK_INVENTORY: Product[] = [
  { id: "1", name: "Martillo Truper 16oz", price: 120.5 },
  { id: "2", name: "Clavo para concreto 2 pulgadas", price: 45.0 },
  { id: "3", name: "Pintura Blanca 19L Comex", price: 1250.0 },
  { id: "4", name: "Cemento Tolteca 50kg", price: 210.0 },
  { id: "5", name: "Cable Calibre 12 AWG", price: 15.0 },
  { id: "6", name: "Brocha 3 pulgadas", price: 35.0 },
];

const TOP_SERVICES = [
  { id: "top1", name: "Venta de Cemento", price: 210.0 },
  { id: "top2", name: "Corte de Cable a la medida", price: 15.0 },
  { id: "top3", name: "Igualación de Pintura", price: 150.0 },
];

export default function SearchModule() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [history, setHistory] = useState<Product[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem("search_history");
    if (saved) {
      try { setHistory(JSON.parse(saved)); } catch (e) {}
    }
  }, []);

  useEffect(() => {
    if (query.trim()) {
      const found = fuzzySearch(query, MOCK_INVENTORY, (p) => p.name, 2);
      setResults(found.slice(0, 3));
    } else {
      setResults([]);
    }
  }, [query]);

  const saveToHistory = (product: Product) => {
    const newHistory = [product, ...history.filter(h => h.id !== product.id)].slice(0, 5);
    setHistory(newHistory);
    localStorage.setItem("search_history", JSON.stringify(newHistory));
    setQuery("");
    inputRef.current?.blur();
    alert(`Añadido a venta: ${product.name}`);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isFocused && results.length > 0) {
        if (e.key === "1" && results[0]) { e.preventDefault(); saveToHistory(results[0]); }
        if (e.key === "2" && results[1]) { e.preventDefault(); saveToHistory(results[1]); }
        if (e.key === "3" && results[2]) { e.preventDefault(); saveToHistory(results[2]); }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFocused, results, history]);

  const showHistoryOrTop = !query && isFocused;

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: '500px', margin: '0 auto' }}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Buscar producto (ej. martiyo, cemnto)..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setTimeout(() => setIsFocused(false), 200)}
        style={{
          width: '100%',
          padding: '12px 20px',
          borderRadius: '12px',
          border: '1px solid var(--color-primary)',
          background: 'rgba(0,0,0,0.5)',
          color: 'white',
          fontSize: '1rem',
          outline: 'none',
          boxShadow: 'var(--shadow-glow)'
        }}
      />

      {(results.length > 0 || showHistoryOrTop) && (
        <div className="glass-panel" style={{ position: 'absolute', top: '55px', left: 0, right: 0, zIndex: 10, padding: '15px' }}>
          {query && results.length > 0 && (
            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-secondary)', marginBottom: '10px' }}>Resultados (Presiona 1, 2 o 3)</p>
              {results.map((r, i) => (
                <div key={r.id} onClick={() => saveToHistory(r)} className="hover-item" style={{ padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', marginBottom: '5px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
                  <span><strong style={{ color: 'var(--color-primary)' }}>[{i + 1}]</strong> {r.name}</span>
                  <strong>${r.price.toFixed(2)}</strong>
                </div>
              ))}
            </div>
          )}

          {showHistoryOrTop && (
            <div>
              {history.length > 0 && (
                <div style={{ marginBottom: '15px' }}>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-accent)', marginBottom: '5px' }}>Búsquedas Recientes</p>
                  {history.map(h => (
                    <div key={h.id} onClick={() => saveToHistory(h)} style={{ padding: '8px', cursor: 'pointer', opacity: 0.8 }}>🕒 {h.name}</div>
                  ))}
                </div>
              )}
              
              <div>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-secondary)', marginBottom: '5px' }}>Servicios Rápidos</p>
                {TOP_SERVICES.map(s => (
                  <div key={s.id} onClick={() => saveToHistory(s as any)} style={{ padding: '8px', cursor: 'pointer', opacity: 0.8 }}>⭐ {s.name}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
