import { Suspense } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import ImportContacts from "@/components/import-contacts";

// =====================================================
// PÁGINA DE IMPORTACIÓN
// =====================================================

export default function ImportPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ImportPageContent />
    </Suspense>
  );
}

// =====================================================
// CONTENIDO PROTEGIDO
// =====================================================

async function ImportPageContent() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const {
    data: memberships,
    error: membershipError,
  } = await supabase
    .from("memberships")
    .select(
      `
        id,
        role,
        organization_id,
        branch_id
      `
    )
    .eq("user_id", user.id)
    .limit(1);

  if (membershipError) {
    console.error(
      "Error obteniendo membresía:",
      membershipError
    );
  }

  const membership = memberships?.[0] ?? null;

  if (!membership) {
    redirect("/protected");
  }

  const {
    data: organization,
    error: organizationError,
  } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", membership.organization_id)
    .single();

  if (organizationError) {
    console.error(
      "Error obteniendo organización:",
      organizationError
    );
  }

  return (
    <ImportContacts
      organizationName={
        organization?.name ?? "Organización"
      }
    />
  );
}

// =====================================================
// CARGA
// =====================================================

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
      <div className="text-center">
        <p className="text-xl font-bold text-emerald-400">
          Tvameva
        </p>

        <p className="mt-3 text-sm text-slate-400">
          Preparando importador...
        </p>
      </div>
    </main>
  );
}