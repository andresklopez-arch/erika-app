// Empareja un item del carrito con su producto real del catálogo (en
// cualquiera de los dos sentidos: buscar el producto de un item del
// carrito, o buscar si un producto del catálogo fue vendido en el ticket).
//
// Antes TODO el POS emparejaba por `name`. Varios productos reales de esta
// tienda comparten el mismo nombre a propósito -- ej. "X-TRONG BLANCO
// DIRECTO BRILLANTE" existe en 4 presentaciones distintas (códigos
// EX-0200.10/.20/.30/.40), cada una con su propio precio y stock. Eso
// causaba 3 fallas encadenadas, todas confirmadas contra producción el
// 2026-08-25:
//   1. Agregar una segunda presentación distinta al carrito no creaba una
//      línea nueva -- colapsaba en la primera línea ya agregada (mismo
//      nombre), sumando cantidad pero cobrando el precio de la primera.
//   2. El aviso de "stock bajo" mostraba las existencias de CUALQUIER
//      presentación con ese nombre, no la que realmente estaba en el
//      carrito.
//   3. Al cobrar, el descuento de inventario le restaba stock a la
//      presentación equivocada (la primera que coincidiera por nombre en
//      el catálogo), no a la que de verdad se vendió.
//
// `code` es lo único realmente único por producto en el carrito (el `id`
// de Supabase no siempre viaja con el item). Si el item no trae código
// (tickets guardados antes de este fix, o productos sin código asignado),
// se cae de regreso a comparar por nombre, igual que el comportamiento
// anterior.
export interface MatchableProduct {
  name: string;
  code?: string | null;
}

export function matchesProduct(a: MatchableProduct, b: MatchableProduct): boolean {
  if (a.code && b.code) return a.code === b.code;
  return a.name === b.name;
}
