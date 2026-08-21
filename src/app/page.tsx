import POSModule from "@/components/POSModule";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function VentasPage() {
  return (
    <ProtectedRoute permission="pos">
      <POSModule />
    </ProtectedRoute>
  );
}
