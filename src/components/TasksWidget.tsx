"use client";
import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "./AuthProvider";

interface InternalTask {
  id: string;
  created_at: string;
  title: string;
  assigned_to: string;
  status: "pending" | "completed";
  created_by: string;
}

export default function TasksWidget() {
  const { currentUser } = useAuth();
  const [tasks, setTasks] = useState<InternalTask[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [dbError, setDbError] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState("all");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchTasks = async () => {
    try {
      const { data, error } = await supabase
        .from("internal_tasks")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        setDbError(true);
      } else if (data) {
        setTasks(data);
        setDbError(false);
      }
    } catch (e) {
      setDbError(true);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 60000); // 1 min

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      clearInterval(interval);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    try {
      const { error } = await supabase.from("internal_tasks").insert([
        {
          title: newTaskTitle,
          assigned_to: newTaskAssignee,
          status: "pending",
          created_by: currentUser?.name || "System"
        }
      ]);
      
      if (error) {
        console.error("Error adding task:", error);
        alert(`❌ Error al guardar la tarea: ${error.message || "Problema de políticas RLS en Supabase"}`);
      } else {
        setNewTaskTitle("");
        fetchTasks();
      }
    } catch (err: any) {
      console.error(err);
      alert(`❌ Error de conexión/sistema al agregar: ${err.message || "Desconocido"}`);
    }
  };

  const handleToggleTask = async (task: InternalTask) => {
    const newStatus = task.status === "pending" ? "completed" : "pending";
    try {
      const { error } = await supabase
        .from("internal_tasks")
        .update({ status: newStatus })
        .eq("id", task.id);
      
      if (error) {
        console.error("Error updating task:", error);
        alert(`❌ Error al actualizar la tarea: ${error.message || "Problema de RLS"}`);
      } else {
        fetchTasks();
      }
    } catch (err: any) {
      console.error(err);
      alert(`❌ Error técnico al actualizar: ${err.message || "Desconocido"}`);
    }
  };

  const handleDeleteTask = async (id: string) => {
    if (confirm("¿Eliminar esta tarea permanentemente?")) {
      try {
        const { error } = await supabase.from("internal_tasks").delete().eq("id", id);
        
        if (error) {
          console.error("Error deleting task:", error);
          alert(`❌ Error al eliminar la tarea: ${error.message || "Problema de RLS"}`);
        } else {
          fetchTasks();
        }
      } catch (err: any) {
        console.error(err);
        alert(`❌ Error técnico al eliminar: ${err.message || "Desconocido"}`);
      }
    }
  };

  const myPendingTasks = tasks.filter(t => 
    t.status === "pending" && 
    (t.assigned_to === "all" || t.assigned_to === currentUser?.role)
  );

  return (
    <div 
      ref={dropdownRef}
      style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end"
      }}
      className="no-print"
    >
      {isOpen && (
        <div
          className="glass-panel animate-fade-in"
          style={{
            width: "350px",
            background: "rgba(22, 22, 34, 0.95)",
            border: "1px solid var(--color-primary)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            borderRadius: "12px",
            marginBottom: "15px",
            padding: "15px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            maxHeight: "450px"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, color: "white", fontSize: "1.1rem" }}>📝 Tareas Internas</h3>
            <button 
              onClick={() => setIsOpen(false)}
              style={{ background: "transparent", border: "none", color: "var(--color-secondary)", cursor: "pointer" }}
            >
              ✕
            </button>
          </div>

          {dbError ? (
            <div style={{ background: "rgba(239, 68, 68, 0.15)", padding: "10px", borderRadius: "8px", fontSize: "0.8rem", color: "#fca5a5", border: "1px solid #ef4444" }}>
              <strong>Falta la tabla 'internal_tasks'</strong> en Supabase.
              <br/><br/>
              <code>
                CREATE TABLE public.internal_tasks (
                  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
                  title TEXT NOT NULL,
                  assigned_to TEXT NOT NULL,
                  status TEXT DEFAULT 'pending',
                  created_by TEXT
                );
              </code>
              <br/><br/>
              <button onClick={fetchTasks} className="btn-primary" style={{ padding: "4px 8px", fontSize: "0.7rem", marginTop: "5px" }}>Reintentar</button>
            </div>
          ) : (
            <>
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px", paddingRight: "5px" }}>
                {tasks.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "20px", color: "rgba(255,255,255,0.4)", fontSize: "0.9rem" }}>
                    No hay tareas registradas.
                  </div>
                ) : (
                  tasks.map(t => (
                    <div 
                      key={t.id}
                      style={{
                        background: "rgba(0,0,0,0.3)",
                        padding: "10px",
                        borderRadius: "8px",
                        borderLeft: `3px solid ${t.status === 'completed' ? '#10b981' : '#f59e0b'}`,
                        display: "flex",
                        gap: "10px",
                        alignItems: "flex-start",
                        opacity: t.status === 'completed' ? 0.6 : 1
                      }}
                    >
                      <input 
                        type="checkbox" 
                        checked={t.status === 'completed'}
                        onChange={() => handleToggleTask(t)}
                        style={{ marginTop: "4px", cursor: "pointer" }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ 
                          fontSize: "0.9rem", 
                          color: "white", 
                          textDecoration: t.status === 'completed' ? 'line-through' : 'none' 
                        }}>
                          {t.title}
                        </div>
                        <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.5)", marginTop: "4px" }}>
                          Para: {t.assigned_to === 'all' ? 'Todos' : t.assigned_to} | Por: {t.created_by}
                        </div>
                      </div>
                      <button 
                        onClick={() => handleDeleteTask(t.id)}
                        style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "1rem" }}
                      >
                        🗑
                      </button>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handleAddTask} style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "10px" }}>
                <input 
                  type="text" 
                  required
                  placeholder="Nueva tarea..."
                  value={newTaskTitle}
                  onChange={e => setNewTaskTitle(e.target.value)}
                  style={{ width: "100%", padding: "8px", borderRadius: "6px", background: "rgba(0,0,0,0.5)", border: "1px solid var(--glass-border)", color: "white", fontSize: "0.85rem" }}
                />
                <div style={{ display: "flex", gap: "5px" }}>
                  <select 
                    value={newTaskAssignee}
                    onChange={e => setNewTaskAssignee(e.target.value)}
                    style={{ flex: 1, padding: "8px", borderRadius: "6px", background: "rgba(0,0,0,0.5)", border: "1px solid var(--glass-border)", color: "white", fontSize: "0.85rem" }}
                  >
                    <option value="all">Para: Todos</option>
                    <option value="admin">Para: Admin</option>
                    <option value="cajero">Para: Cajero</option>
                    <option value="tecnico">Para: Técnico</option>
                  </select>
                  <button type="submit" className="btn-primary" style={{ padding: "8px 12px", fontSize: "0.85rem" }}>
                    + Add
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      )}

      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "50px",
          height: "50px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, var(--color-primary), #059669)",
          border: "none",
          boxShadow: myPendingTasks.length > 0 
            ? "0 0 15px rgba(16,185,129,0.8), 0 0 0 4px rgba(16,185,129,0.2)"
            : "0 4px 15px rgba(0,0,0,0.3)",
          color: "white",
          fontSize: "1.5rem",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          transition: "transform 0.2s"
        }}
        onMouseEnter={e => e.currentTarget.style.transform = "scale(1.1)"}
        onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
      >
        📝
        {myPendingTasks.length > 0 && (
          <span style={{
            position: "absolute",
            top: "-5px",
            right: "-5px",
            background: "#ef4444",
            color: "white",
            fontSize: "0.7rem",
            fontWeight: "bold",
            width: "20px",
            height: "20px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px solid #161622"
          }}>
            {myPendingTasks.length}
          </span>
        )}
      </button>
    </div>
  );
}
