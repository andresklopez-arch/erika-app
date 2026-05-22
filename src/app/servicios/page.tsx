"use client";
import ServicesModule from "../../components/ServicesModule";
import ProtectedRoute from "../../components/ProtectedRoute";

export default function ServiciosPage() {
  return (
    <ProtectedRoute permission="servicios">
      <div className="p-6">
        <ServicesModule />
      </div>
    </ProtectedRoute>
  );
}
