import {
  NextResponse,
  type NextRequest,
} from "next/server";

import {
  updateSession,
} from "@/lib/supabase/proxy";

// =====================================================
// TVAMEVA PROXY
// =====================================================

export async function proxy(
  request: NextRequest
) {
  const pathname =
    request.nextUrl.pathname;

  // ===================================================
  // SYSTEM API
  // ===================================================
  //
  // Estas rutas NO utilizan la sesión del usuario.
  //
  // Se autentican internamente mediante:
  //
  // SYSTEM_WORKER_SECRET
  //
  // Ejemplo:
  //
  // /api/system/campaigns/run
  //
  // Esto permite que un scheduler externo pueda
  // ejecutar Tvameva aunque ningún usuario esté
  // logueado en el navegador.
  //
  // La ruta sigue estando protegida: el endpoint
  // valida el Bearer Token antes de ejecutar nada.
  // ===================================================

  if (
    pathname.startsWith(
      "/api/system/"
    )
  ) {
    return NextResponse.next({
      request,
    });
  }

  // ===================================================
  // RESTO DE TVAMEVA
  // ===================================================
  //
  // Todo el resto continúa utilizando la protección
  // normal de Supabase.
  // ===================================================

  return await updateSession(
    request
  );
}

// =====================================================
// MATCHER
// =====================================================

export const config = {
  matcher: [
    /*
     * Ejecutamos el proxy para todas las rutas excepto:
     *
     * - _next/static
     * - _next/image
     * - favicon.ico
     * - imágenes estáticas
     *
     * /api/system/* sí entra al proxy,
     * pero arriba hacemos el bypass de sesión.
     */

    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};