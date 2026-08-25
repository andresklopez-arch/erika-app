import toast from "react-hot-toast";

// Toast de fallo de impresión con botón "Reintentar" -- compartido entre
// CustomersModule.tsx, AccountsPayableModal.tsx y receiptPrinting.tsx
// (los 3 lugares que ganaron impresión Bluetooth el 2026-08-25). Antes cada
// fallo era un alert() que obligaba al cajero a volver a darle clic al
// botón original desde cero; en este punto ya se tienen los datos del
// ticket calculados, así que reintentar es solo volver a mandar los mismos
// bytes.
export function showPrintFailureToast(errorMsg: string | undefined, retry: () => void) {
  toast.error(
    (t) => (
      <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span>⚠️ Fallo al imprimir por Bluetooth: {errorMsg || "error desconocido"}</span>
        <button
          onClick={() => {
            toast.dismiss(t.id);
            retry();
          }}
          style={{
            background: "#fff",
            color: "#b91c1c",
            border: "none",
            borderRadius: "6px",
            padding: "4px 10px",
            fontWeight: "bold",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Reintentar
        </button>
      </span>
    ),
    { duration: 12000 },
  );
}
