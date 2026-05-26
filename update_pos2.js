const fs = require('fs');
const file = 'src/components/POSModule.tsx';
let code = fs.readFileSync(file, 'utf8');

// 1. Add focusedIndex state and normalize function
const stateAddition = 
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const playSuccessBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.15);
    } catch (e) {
      console.error("Audio no soportado");
    }
  };

  const normalizeString = (str: string) => {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  };
;
code = code.replace('  const [showAutocomplete, setShowAutocomplete] = useState(false);', stateAddition);

// 2. Play beep when voice search succeeds
const beepAddition = 
        // Umbral de seguridad para considerar un acierto (al menos 1 coincidencia sólida)
        if (matchedProduct && highestScore > 6) {
          playSuccessBeep();
          setSearchInput(matchedProduct.name);
;
code = code.replace(
        // Umbral de seguridad para considerar un acierto (al menos 1 coincidencia sólida)
        if (matchedProduct && highestScore > 6) {
          setSearchInput(matchedProduct.name);
, beepAddition);

// 3. Update autocomplete filtering to ignore accents and handle keyboard navigation
const filteredCatalogLogic = 
  const filteredCatalog = globalCatalog.filter(c => {
    if (searchInput.length < 2) return false;
    const searchNormalized = normalizeString(searchInput);
    return normalizeString(c.name).includes(searchNormalized) || 
           (c.code && normalizeString(c.code).includes(searchNormalized));
  }).slice(0, 15);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showAutocomplete || filteredCatalog.length === 0) return;
    
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex(prev => (prev < filteredCatalog.length - 1 ? prev + 1 : prev));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex(prev => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (focusedIndex >= 0 && focusedIndex < filteredCatalog.length) {
        const c = filteredCatalog[focusedIndex];
        addToCart(c.name, c.price, "pz", c.cost, 1, c.image_url);
        setSearchInput("");
        setShowAutocomplete(false);
        setFocusedIndex(-1);
      } else {
        handleSearchSubmit(e as any);
      }
    } else if (e.key === "Escape") {
      setShowAutocomplete(false);
      setFocusedIndex(-1);
    }
  };
;

code = code.replace(
  '          <form',
  filteredCatalogLogic + '\n          <form'
);

const inputReplacement = 
              <input
                type="text"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setShowAutocomplete(e.target.value.length > 1);
                  setFocusedIndex(-1);
                }}
                onFocus={() => setShowAutocomplete(searchInput.length > 1)}
                onBlur={() => setTimeout(() => { setShowAutocomplete(false); setFocusedIndex(-1); }, 200)}
                onKeyDown={handleKeyDown}
                placeholder="Buscar por Nombre, Código o Pistola Láser..."
;
code = code.replace(/<input[\s\S]*?placeholder="Buscar por Nombre, Código o Pistola Láser..."/, inputReplacement);

const mappingReplacement = 
                  {filteredCatalog.map((c, idx) => (
                    <div 
                      key={c.id} 
                      onClick={() => {
                        addToCart(c.name, c.price, "pz", c.cost, 1, c.image_url);
                        setSearchInput("");
                        setShowAutocomplete(false);
                        setFocusedIndex(-1);
                      }}
                      style={{
                        padding: "10px 15px",
                        borderBottom: "1px solid rgba(255,255,255,0.1)",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        background: focusedIndex === idx ? "rgba(16, 185, 129, 0.3)" : "transparent"
                      }}
                      onMouseEnter={() => setFocusedIndex(idx)}
                    >
;
code = code.replace(/\{globalCatalog\.filter\([\s\S]*?\.slice\(0, 15\)\.map\(c => \([\s\S]*?style=\{\{/m, mappingReplacement + \n                      style={{);

const noProductsReplacement = 
                  {filteredCatalog.length === 0 && (
;
code = code.replace(/\{globalCatalog\.filter\([\s\S]*?\.length === 0 && \(/m, noProductsReplacement);

fs.writeFileSync(file, code);
