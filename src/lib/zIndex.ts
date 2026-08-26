// Niveles de zIndex para los modales de pantalla completa (position:fixed,
// top/left/right/bottom:0) de POSModule.tsx. Nace del bug del 2026-08-24
// (reporte de Ferretería Erika): el modal de autorización por PIN tenía
// zIndex:9999, más bajo que "Cancelación de Tickets"/"Consulta de
// Tickets" (zIndex:99999) -- al pedir el PIN estando esos modales ya
// abiertos, quedaba invisible detrás y era imposible autorizar nada.
//
// Usar estos niveles (no números sueltos) para cualquier modal nuevo de
// pantalla completa: evita que alguien reintroduzca un "9999" que en
// realidad necesitaba estar por encima de un MODAL_LARGE existente.
//
// No cubre los z-index pequeños de overlays DENTRO de un panel (dropdowns
// de sugerencias, tooltips, etc. -- esos son apilamiento local, no
// modal-sobre-modal, y viven con sus propios valores en cada sitio).
export const Z_INDEX = {
  // Modales estándar de pantalla completa (checkout, historial de sync,
  // alta rápida de cliente, historial de cliente, etc.)
  MODAL: 9999,
  // Modales grandes de lista + detalle (Consulta de Tickets Anteriores,
  // Cancelación de Tickets y Ventas).
  MODAL_LARGE: 99999,
  // Autorización por PIN (getPinAsync/requestPin) -- se puede disparar
  // desde CUALQUIER pantalla, incluyendo modales ya abiertos. Debe quedar
  // siempre por encima de todo lo demás en esta lista.
  AUTHORIZATION: 999999,
} as const;
