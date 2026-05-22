"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ReportesPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);

  return (
    <div
      style={{
        height: "80vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-primary)",
      }}
    >
      Redireccionando...
    </div>
  );
}
