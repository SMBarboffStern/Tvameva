"use client";

import Link from "next/link";

import {
  ChangeEvent,
  Dispatch,
  DragEvent,
  RefObject,
  SetStateAction,
  useMemo,
  useRef,
  useState,
} from "react";

import * as XLSX from "xlsx";

import {
  parsePhoneNumberFromString,
} from "libphonenumber-js";

import type {
  CountryCode,
} from "libphonenumber-js";

// =====================================================
// TIPOS BÁSICOS
// =====================================================

type SpreadsheetCell =
  | string
  | number
  | boolean
  | null;

type SpreadsheetRow =
  Record<
    string,
    SpreadsheetCell
  >;

type ImportSource =
  | "device"
  | "drop"
  | "drive";

type ImportStage =
  | "source"
  | "preview"
  | "mapping"
  | "review"
  | "complete";

type ParsedSpreadsheet = {
  fileName: string;
  source: ImportSource;
  sheetName: string;
  columns: string[];
  rows: SpreadsheetRow[];
};

type ImportContactsProps = {
  organizationName: string;
};

// =====================================================
// MAPEO
// =====================================================

type ContactMapping = {
  firstName: string;
  lastName: string;

  phone: string;
  alternatePhone: string;

  email: string;
  city: string;
  course: string;
  contactedBy: string;
};

// =====================================================
// CONTACTO PREPARADO
// =====================================================

type PreparedContactStatus =
  | "valid"
  | "invalid-phone"
  | "missing-phone";

type PreparedContact = {
  rowNumber: number;

  firstName: string;
  lastName: string;

  originalPhone: string;
  alternatePhone: string;

  normalizedPhone:
    | string
    | null;

  email: string;
  city: string;
  course: string;
  contactedBy: string;

  status:
    PreparedContactStatus;

  sourceData:
    SpreadsheetRow;
};

// =====================================================
// REVISIÓN
// =====================================================

type ReviewStatus =
  | "ready"
  | "duplicate-file"
  | "duplicate-tvameva"
  | "invalid-phone"
  | "missing-phone";

type ReviewedContact =
  PreparedContact & {
    reviewStatus:
      ReviewStatus;
  };

// =====================================================
// RESULTADO FINAL
// =====================================================

type ImportSummary = {
  receivedCount: number;
  importedCount: number;

  skippedExistingCount: number;

  invalidCount: number;

  duplicatePayloadCount: number;
};

// =====================================================
// CONFIGURACIÓN
// =====================================================

const MAX_FILE_SIZE =
  10 * 1024 * 1024;

const MAX_ROWS =
  20000;

const ALLOWED_EXTENSIONS = [
  ".xlsx",
  ".xls",
  ".csv",
];

const DEFAULT_COUNTRY:
  CountryCode = "AR";

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export default function ImportContacts({
  organizationName,
}: ImportContactsProps) {
  const inputRef =
    useRef<HTMLInputElement | null>(
      null
    );

  const [
    spreadsheet,
    setSpreadsheet,
  ] =
    useState<ParsedSpreadsheet | null>(
      null
    );

  const [
    stage,
    setStage,
  ] =
    useState<ImportStage>(
      "source"
    );

  const [
    driveUrl,
    setDriveUrl,
  ] =
    useState("");

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    reviewing,
    setReviewing,
  ] =
    useState(false);

  const [
    importing,
    setImporting,
  ] =
    useState(false);

  const [
    dragging,
    setDragging,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null
    );

  const [
    mapping,
    setMapping,
  ] =
    useState<ContactMapping>(
      emptyMapping()
    );

  const [
    reviewedContacts,
    setReviewedContacts,
  ] =
    useState<
      ReviewedContact[]
    >([]);

  const [
    importSummary,
    setImportSummary,
  ] =
    useState<
      ImportSummary | null
    >(null);

  // ===================================================
  // CONTACTOS PREPARADOS
  // ===================================================

  const preparedContacts =
    useMemo(() => {
      if (!spreadsheet) {
        return [];
      }

      return prepareContacts(
        spreadsheet.rows,
        mapping
      );
    }, [
      spreadsheet,
      mapping,
    ]);

  // ===================================================
  // ARCHIVO LOCAL
  // ===================================================

  async function processLocalFile(
    file: File,
    source:
      | "device"
      | "drop"
  ) {
    setError(null);

    try {
      validateFile(file);

      setLoading(true);

      const buffer =
        await file.arrayBuffer();

      const parsed =
        parseWorkbook(
          buffer,
          file.name,
          source
        );

      loadSpreadsheet(
        parsed
      );
    } catch (error) {
      setError(
        getErrorMessage(
          error
        )
      );
    } finally {
      setLoading(false);
    }
  }

  // ===================================================
  // CARGAR PLANILLA
  // ===================================================

  function loadSpreadsheet(
    parsed:
      ParsedSpreadsheet
  ) {
    setSpreadsheet(
      parsed
    );

    setMapping(
      detectMapping(
        parsed.columns
      )
    );

    setReviewedContacts(
      []
    );

    setImportSummary(
      null
    );

    setStage(
      "preview"
    );
  }

  // ===================================================
  // SELECTOR LOCAL
  // ===================================================

  async function handleFileInput(
    event:
      ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    await processLocalFile(
      file,
      "device"
    );

    event.target.value =
      "";
  }

  // ===================================================
  // DRAG & DROP
  // ===================================================

  function handleDragOver(
    event:
      DragEvent<HTMLDivElement>
  ) {
    event.preventDefault();

    setDragging(
      true
    );
  }

  function handleDragLeave(
    event:
      DragEvent<HTMLDivElement>
  ) {
    event.preventDefault();

    setDragging(
      false
    );
  }

  async function handleDrop(
    event:
      DragEvent<HTMLDivElement>
  ) {
    event.preventDefault();

    setDragging(
      false
    );

    const file =
      event.dataTransfer.files?.[0];

    if (!file) {
      return;
    }

    await processLocalFile(
      file,
      "drop"
    );
  }

  // ===================================================
  // GOOGLE DRIVE
  // ===================================================

  async function handleDriveImport() {
    setError(null);

    const cleanUrl =
      driveUrl.trim();

    if (!cleanUrl) {
      setError(
        "Pegá un enlace de Google Drive o Google Sheets."
      );

      return;
    }

    try {
      setLoading(
        true
      );

      const response =
        await fetch(
          "/api/import/drive",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(
                {
                  url:
                    cleanUrl,
                }
              ),
          }
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            "No se pudo importar el archivo."
        );
      }

      const parsed:
        ParsedSpreadsheet = {
        fileName:
          result.fileName,

        source:
          "drive",

        sheetName:
          result.sheetName,

        columns:
          result.columns,

        rows:
          normalizeImportedRows(
            result.rows
          ),
      };

      loadSpreadsheet(
        parsed
      );
    } catch (error) {
      setError(
        getErrorMessage(
          error
        )
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  // ===================================================
  // REINICIAR
  // ===================================================

  function resetImport() {
    setSpreadsheet(
      null
    );

    setDriveUrl(
      ""
    );

    setMapping(
      emptyMapping()
    );

    setReviewedContacts(
      []
    );

    setImportSummary(
      null
    );

    setError(
      null
    );

    setStage(
      "source"
    );
  }

  // ===================================================
  // NAVEGACIÓN
  // ===================================================

  function continueToMapping() {
    if (!spreadsheet) {
      return;
    }

    setError(
      null
    );

    setStage(
      "mapping"
    );

    scrollTop();
  }

  function backToPreview() {
    setError(
      null
    );

    setStage(
      "preview"
    );

    scrollTop();
  }

  function backToMapping() {
    setError(
      null
    );

    setStage(
      "mapping"
    );

    scrollTop();
  }

  // ===================================================
  // REVISAR LOTE
  // ===================================================

  async function handleReviewLot() {
    if (!spreadsheet) {
      return;
    }

    setError(
      null
    );

    if (!mapping.phone) {
      setError(
        "Seleccioná una columna para Teléfono principal."
      );

      return;
    }

    try {
      setReviewing(
        true
      );

      const validPhones =
        preparedContacts
          .filter(
            (
              contact
            ) =>
              contact.status ===
                "valid" &&
              contact.normalizedPhone
          )
          .map(
            (
              contact
            ) =>
              contact.normalizedPhone as string
          );

      const uniquePhones =
        Array.from(
          new Set(
            validPhones
          )
        );

      const response =
        await fetch(
          "/api/import/review",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(
                {
                  phones:
                    uniquePhones,
                }
              ),
          }
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            "No se pudo revisar el lote."
        );
      }

      const existingPhones =
        new Set<string>(
          Array.isArray(
            result.existingPhones
          )
            ? result.existingPhones
            : []
        );

      const seenPhones =
        new Set<string>();

      const reviewed =
        preparedContacts.map(
          (
            contact
          ): ReviewedContact => {
            if (
              contact.status ===
              "missing-phone"
            ) {
              return {
                ...contact,

                reviewStatus:
                  "missing-phone",
              };
            }

            if (
              contact.status ===
              "invalid-phone"
            ) {
              return {
                ...contact,

                reviewStatus:
                  "invalid-phone",
              };
            }

            const phone =
              contact.normalizedPhone;

            if (!phone) {
              return {
                ...contact,

                reviewStatus:
                  "invalid-phone",
              };
            }

            if (
              seenPhones.has(
                phone
              )
            ) {
              return {
                ...contact,

                reviewStatus:
                  "duplicate-file",
              };
            }

            seenPhones.add(
              phone
            );

            if (
              existingPhones.has(
                phone
              )
            ) {
              return {
                ...contact,

                reviewStatus:
                  "duplicate-tvameva",
              };
            }

            return {
              ...contact,

              reviewStatus:
                "ready",
            };
          }
        );

      setReviewedContacts(
        reviewed
      );

      setStage(
        "review"
      );

      scrollTop();
    } catch (error) {
      setError(
        getErrorMessage(
          error
        )
      );
    } finally {
      setReviewing(
        false
      );
    }
  }

  // ===================================================
  // IMPORTAR CONTACTOS
  // ===================================================

  async function handleCommitImport() {
    if (!spreadsheet) {
      return;
    }

    setError(
      null
    );

    const readyContacts =
      reviewedContacts.filter(
        (contact) =>
          contact.reviewStatus ===
          "ready"
      );

    if (
      readyContacts.length === 0
    ) {
      setError(
        "No hay contactos listos para importar."
      );

      return;
    }

    try {
      setImporting(
        true
      );

      const response =
        await fetch(
          "/api/import/commit",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(
                {
                  metadata: {
                    fileName:
                      spreadsheet.fileName,

                    sheetName:
                      spreadsheet.sheetName,

                    source:
                      spreadsheet.source,
                  },

                  contacts:
                    readyContacts.map(
                      (
                        contact
                      ) => ({
                        firstName:
                          contact.firstName,

                        lastName:
                          contact.lastName,

                        phoneOriginal:
                          contact.originalPhone,

                        phoneE164:
                          contact.normalizedPhone,

                        email:
                          contact.email,

                        city:
                          contact.city,

                        course:
                          contact.course,

                        contactedBy:
                          contact.contactedBy,

                        sourceData:
                          contact.sourceData,
                      })
                    ),
                }
              ),
          }
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            "No se pudieron importar los contactos."
        );
      }

      setImportSummary(
        result as ImportSummary
      );

      setStage(
        "complete"
      );

      scrollTop();
    } catch (error) {
      setError(
        getErrorMessage(
          error
        )
      );
    } finally {
      setImporting(
        false
      );
    }
  }

  // ===================================================
  // INTERFAZ
  // ===================================================

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10 bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-5">
          <div>
            <h1 className="text-2xl font-bold">
              Tvameva
            </h1>

            <p className="text-sm text-slate-400">
              {
                organizationName
              }
            </p>
          </div>

          <Link
            href="/protected"
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
          >
            Volver al panel
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-10">
        <ImportProgress
          stage={stage}
        />

        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        {stage ===
          "source" && (
          <SourceStage
            inputRef={
              inputRef
            }
            driveUrl={
              driveUrl
            }
            setDriveUrl={
              setDriveUrl
            }
            loading={
              loading
            }
            dragging={
              dragging
            }
            onFileInput={
              handleFileInput
            }
            onDragOver={
              handleDragOver
            }
            onDragLeave={
              handleDragLeave
            }
            onDrop={
              handleDrop
            }
            onDriveImport={
              handleDriveImport
            }
          />
        )}

        {loading && (
          <LoadingNotice />
        )}

        {stage ===
          "preview" &&
          spreadsheet &&
          !loading && (
            <SpreadsheetPreview
              spreadsheet={
                spreadsheet
              }
              onReset={
                resetImport
              }
              onContinue={
                continueToMapping
              }
            />
          )}

        {stage ===
          "mapping" &&
          spreadsheet &&
          !loading && (
            <MappingStage
              spreadsheet={
                spreadsheet
              }
              mapping={
                mapping
              }
              setMapping={
                setMapping
              }
              preparedContacts={
                preparedContacts
              }
              reviewing={
                reviewing
              }
              onBack={
                backToPreview
              }
              onReset={
                resetImport
              }
              onReview={
                handleReviewLot
              }
            />
          )}

        {stage ===
          "review" &&
          spreadsheet && (
            <ReviewStage
              contacts={
                reviewedContacts
              }
              importing={
                importing
              }
              onBack={
                backToMapping
              }
              onImport={
                handleCommitImport
              }
            />
          )}

        {stage ===
          "complete" &&
          importSummary && (
            <CompleteStage
              summary={
                importSummary
              }
              onNewImport={
                resetImport
              }
            />
          )}
      </div>
    </main>
  );
}

// =====================================================
// BARRA DE PROGRESO
// =====================================================

function ImportProgress({
  stage,
}: {
  stage: ImportStage;
}) {
  const currentStep =
    stage === "source"
      ? 1
      : stage === "preview"
        ? 2
        : stage === "mapping"
          ? 3
          : 4;

  return (
    <div className="mb-9">
      <p className="text-sm font-medium text-emerald-400">
        Contactos
      </p>

      <h2 className="mt-2 text-3xl font-bold">
        Importar contactos
      </h2>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Step
          number={1}
          title="Elegir origen"
          active={
            currentStep >= 1
          }
        />

        <Step
          number={2}
          title="Revisar archivo"
          active={
            currentStep >= 2
          }
        />

        <Step
          number={3}
          title="Mapear columnas"
          active={
            currentStep >= 3
          }
        />

        <Step
          number={4}
          title="Revisar lote"
          active={
            currentStep >= 4
          }
        />
      </div>
    </div>
  );
}

function Step({
  number,
  title,
  active,
}: {
  number: number;
  title: string;
  active: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        active
          ? "border-emerald-500/30 bg-emerald-500/10"
          : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
            active
              ? "bg-emerald-500 text-slate-950"
              : "bg-slate-800 text-slate-500"
          }`}
        >
          {number}
        </div>

        <span
          className={
            active
              ? "font-medium text-white"
              : "text-slate-500"
          }
        >
          {title}
        </span>
      </div>
    </div>
  );
}

// =====================================================
// PASO 1
// =====================================================

function SourceStage({
  inputRef,
  driveUrl,
  setDriveUrl,
  loading,
  dragging,
  onFileInput,
  onDragOver,
  onDragLeave,
  onDrop,
  onDriveImport,
}: {
  inputRef:
    RefObject<HTMLInputElement | null>;

  driveUrl: string;

  setDriveUrl: (
    value: string
  ) => void;

  loading: boolean;
  dragging: boolean;

  onFileInput: (
    event:
      ChangeEvent<HTMLInputElement>
  ) => void;

  onDragOver: (
    event:
      DragEvent<HTMLDivElement>
  ) => void;

  onDragLeave: (
    event:
      DragEvent<HTMLDivElement>
  ) => void;

  onDrop: (
    event:
      DragEvent<HTMLDivElement>
  ) => void;

  onDriveImport:
    () => void;
}) {
  return (
    <>
      <p className="mb-7 max-w-3xl text-slate-400">
        Podés cargar una planilla
        desde tu dispositivo,
        arrastrarla directamente o
        importar un archivo mediante
        un enlace de Google Drive.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Desde dispositivo
          </p>

          <h3 className="mt-2 text-xl font-semibold">
            Excel o CSV
          </h3>

          <div
            onDragOver={
              onDragOver
            }
            onDragLeave={
              onDragLeave
            }
            onDrop={
              onDrop
            }
            className={`mt-6 flex min-h-[280px] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
              dragging
                ? "border-emerald-400 bg-emerald-500/10"
                : "border-white/10 bg-slate-900/50"
            }`}
          >
            <div className="text-4xl">
              📄
            </div>

            <p className="mt-4 font-semibold">
              Arrastrá tu archivo acá
            </p>

            <p className="mt-2 text-sm text-slate-400">
              XLSX, XLS o CSV
            </p>

            <p className="mt-1 text-xs text-slate-500">
              Máximo 10 MB
            </p>

            <button
              type="button"
              disabled={
                loading
              }
              onClick={() =>
                inputRef.current?.click()
              }
              className="mt-6 rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
            >
              Elegir archivo
            </button>

            <input
              ref={
                inputRef
              }
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={
                onFileInput
              }
              className="hidden"
            />
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Desde la nube
          </p>

          <h3 className="mt-2 text-xl font-semibold">
            Google Drive
          </h3>

          <div className="mt-6 rounded-2xl border border-white/10 bg-slate-900/50 p-6">
            <label
              htmlFor="drive-url"
              className="text-sm font-medium text-slate-300"
            >
              Enlace
            </label>

            <textarea
              id="drive-url"
              value={
                driveUrl
              }
              onChange={(
                event
              ) =>
                setDriveUrl(
                  event.target
                    .value
                )
              }
              rows={5}
              placeholder="https://drive.google.com/..."
              className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
            />

            <button
              type="button"
              disabled={
                loading
              }
              onClick={
                onDriveImport
              }
              className="mt-4 w-full rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
            >
              Importar desde Drive
            </button>

            <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs leading-5 text-amber-100/80">
              El archivo debe estar
              compartido como
              &quot;Cualquier persona
              con el enlace&quot;.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// =====================================================
// CARGANDO
// =====================================================

function LoadingNotice() {
  return (
    <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
      <p className="font-medium text-emerald-300">
        Analizando planilla...
      </p>

      <p className="mt-1 text-sm text-slate-400">
        Tvameva está leyendo las
        columnas y los registros.
      </p>
    </div>
  );
}

// =====================================================
// PASO 2
// =====================================================

function SpreadsheetPreview({
  spreadsheet,
  onReset,
  onContinue,
}: {
  spreadsheet:
    ParsedSpreadsheet;

  onReset:
    () => void;

  onContinue:
    () => void;
}) {
  const previewRows =
    spreadsheet.rows.slice(
      0,
      8
    );

  return (
    <section className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Archivo"
          value={
            spreadsheet.fileName
          }
        />

        <StatCard
          title="Hoja"
          value={
            spreadsheet.sheetName
          }
        />

        <StatCard
          title="Registros"
          value={String(
            spreadsheet.rows
              .length
          )}
        />

        <StatCard
          title="Columnas"
          value={String(
            spreadsheet.columns
              .length
          )}
        />
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Lectura correcta
            </p>

            <h3 className="mt-2 text-xl font-semibold">
              Tvameva encontró estas
              columnas
            </h3>
          </div>

          <button
            type="button"
            onClick={
              onReset
            }
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
          >
            Elegir otro archivo
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {spreadsheet.columns.map(
            (
              column
            ) => (
              <span
                key={
                  column
                }
                className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-200"
              >
                {column}
              </span>
            )
          )}
        </div>
      </div>

      <SpreadsheetTable
        spreadsheet={
          spreadsheet
        }
        rows={
          previewRows
        }
      />

      <div className="flex flex-col justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:flex-row sm:items-center">
        <div>
          <h3 className="font-semibold">
            Archivo listo
          </h3>

          <p className="mt-1 text-sm text-slate-400">
            Ahora vamos a relacionar
            estas columnas con los
            campos de Tvameva.
          </p>
        </div>

        <button
          type="button"
          onClick={
            onContinue
          }
          className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400"
        >
          Continuar al mapeo
        </button>
      </div>
    </section>
  );
}

// =====================================================
// TABLA ORIGINAL
// =====================================================

function SpreadsheetTable({
  spreadsheet,
  rows,
}: {
  spreadsheet:
    ParsedSpreadsheet;

  rows:
    SpreadsheetRow[];
}) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
      <div className="border-b border-white/10 p-6">
        <h3 className="text-xl font-semibold">
          Vista previa
        </h3>

        <p className="mt-1 text-sm text-slate-400">
          Mostrando los primeros{" "}
          {rows.length} registros.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-white/10 text-sm">
          <thead className="bg-white/[0.03]">
            <tr>
              {spreadsheet.columns.map(
                (
                  column
                ) => (
                  <th
                    key={
                      column
                    }
                    className="whitespace-nowrap px-4 py-3 text-left font-medium text-slate-300"
                  >
                    {column}
                  </th>
                )
              )}
            </tr>
          </thead>

          <tbody className="divide-y divide-white/5">
            {rows.map(
              (
                row,
                rowIndex
              ) => (
                <tr
                  key={
                    rowIndex
                  }
                >
                  {spreadsheet.columns.map(
                    (
                      column
                    ) => (
                      <td
                        key={`${rowIndex}-${column}`}
                        className="whitespace-nowrap px-4 py-3 text-slate-400"
                      >
                        {displayCell(
                          row[
                            column
                          ]
                        )}
                      </td>
                    )
                  )}
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =====================================================
// PASO 3 - MAPEO
// =====================================================

function MappingStage({
  spreadsheet,
  mapping,
  setMapping,
  preparedContacts,
  reviewing,
  onBack,
  onReset,
  onReview,
}: {
  spreadsheet:
    ParsedSpreadsheet;

  mapping:
    ContactMapping;

  setMapping:
    Dispatch<
      SetStateAction<ContactMapping>
    >;

  preparedContacts:
    PreparedContact[];

  reviewing:
    boolean;

  onBack:
    () => void;

  onReset:
    () => void;

  onReview:
    () => void;
}) {
  const validCount =
    preparedContacts.filter(
      (
        contact
      ) =>
        contact.status ===
        "valid"
    ).length;

  const invalidCount =
    preparedContacts.filter(
      (
        contact
      ) =>
        contact.status ===
        "invalid-phone"
    ).length;

  const missingCount =
    preparedContacts.filter(
      (
        contact
      ) =>
        contact.status ===
        "missing-phone"
    ).length;

  return (
    <section className="space-y-7">
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Mapeo inteligente
            </p>

            <h3 className="mt-2 text-2xl font-semibold">
              ¿Qué representa cada
              columna?
            </h3>

            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Tvameva hizo una
              sugerencia automática.
              Revisala y corregí
              cualquier campo que no
              corresponda.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={
                onBack
              }
              className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
            >
              Volver
            </button>

            <button
              type="button"
              onClick={
                onReset
              }
              className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
            >
              Cambiar archivo
            </button>
          </div>
        </div>

        <div className="mt-7 grid gap-5 md:grid-cols-2">
          <MappingSelect
            label="Nombre"
            description="Nombre de la persona"
            value={
              mapping.firstName
            }
            columns={
              spreadsheet.columns
            }
            onChange={(
              value
            ) =>
              setMapping(
                (
                  current
                ) => ({
                  ...current,

                  firstName:
                    value,
                })
              )
            }
          />

          <MappingSelect
            label="Apellido"
            description="Apellido de la persona"
            value={
              mapping.lastName
            }
            columns={
              spreadsheet.columns
            }
            onChange={(
              value
            ) =>
              setMapping(
                (
                  current
                ) => ({
                  ...current,

                  lastName:
                    value,
                })
              )
            }
          />

          <MappingSelect
            label="Teléfono principal"
            description="Celular o WhatsApp principal"
            value={
              mapping.phone
            }
            columns={
              spreadsheet.columns
            }
            required
            onChange={(
              value
            ) =>
              setMapping(
                (
                  current
                ) => ({
                  ...current,

                  phone:
                    value,
                })
              )
            }
          />

          <MappingSelect
            label="Teléfono alternativo"
            description="Se usa como respaldo si el principal es inválido o está vacío"
            value={
              mapping.alternatePhone
            }
            columns={
              spreadsheet.columns
            }
            onChange={(
              value
            ) =>
              setMapping(
                (
                  current
                ) => ({
                  ...current,

                  alternatePhone:
                    value,
                })
              )
            }
          />

          <MappingSelect
            label="Email"
            description="Correo electrónico"
            value={
              mapping.email
            }
            columns={
              spreadsheet.columns
            }
            onChange={(
              value
            ) =>
              setMapping(
                (
                  current
                ) => ({
                  ...current,

                  email:
                    value,
                })
              )
            }
          />

          <MappingSelect
            label="Ciudad"
            description="Ciudad o localidad"
            value={
              mapping.city
            }
            columns={
              spreadsheet.columns
            }
            onChange={(
              value
            ) =>
              setMapping(
                (
                  current
                ) => ({
                  ...current,

                  city:
                    value,
                })
              )
            }
          />

          <MappingSelect
            label="Curso"
            description="Curso o actividad"
            value={
              mapping.course
            }
            columns={
              spreadsheet.columns
            }
            onChange={(
              value
            ) =>
              setMapping(
                (
                  current
                ) => ({
                  ...current,

                  course:
                    value,
                })
              )
            }
          />

          <MappingSelect
            label="Quién contactó"
            description="Voluntario o referente"
            value={
              mapping.contactedBy
            }
            columns={
              spreadsheet.columns
            }
            onChange={(
              value
            ) =>
              setMapping(
                (
                  current
                ) => ({
                  ...current,

                  contactedBy:
                    value,
                })
              )
            }
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total"
          value={
            preparedContacts.length
          }
          text="Registros analizados"
        />

        <MetricCard
          title="Válidos"
          value={
            validCount
          }
          text="Con teléfono válido"
        />

        <MetricCard
          title="Teléfono inválido"
          value={
            invalidCount
          }
          text="Necesitan revisión"
        />

        <MetricCard
          title="Sin teléfono"
          value={
            missingCount
          }
          text="No se podrán contactar"
        />
      </div>

      {!mapping.phone && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
          Seleccioná una columna para{" "}
          <strong>
            Teléfono principal
          </strong>
          .
        </div>
      )}

      <PreparedPreview
        contacts={
          preparedContacts.slice(
            0,
            10
          )
        }
      />

      <div className="flex flex-col justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 lg:flex-row lg:items-center">
        <div>
          <h3 className="font-semibold">
            Mapeo preparado
          </h3>

          <p className="mt-1 text-sm text-slate-400">
            Tvameva comprobará ahora
            duplicados, números
            inválidos y contactos que
            ya existen.
          </p>
        </div>

        <button
          type="button"
          disabled={
            !mapping.phone ||
            reviewing
          }
          onClick={
            onReview
          }
          className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {reviewing
            ? "Revisando..."
            : "Revisar lote"}
        </button>
      </div>
    </section>
  );
}

// =====================================================
// PASO 4 - REVISAR LOTE
// =====================================================

function ReviewStage({
  contacts,
  importing,
  onBack,
  onImport,
}: {
  contacts:
    ReviewedContact[];

  importing:
    boolean;

  onBack:
    () => void;

  onImport:
    () => void;
}) {
  const ready =
    contacts.filter(
      (
        contact
      ) =>
        contact.reviewStatus ===
        "ready"
    );

  const duplicateFile =
    contacts.filter(
      (
        contact
      ) =>
        contact.reviewStatus ===
        "duplicate-file"
    );

  const duplicateTvameva =
    contacts.filter(
      (
        contact
      ) =>
        contact.reviewStatus ===
        "duplicate-tvameva"
    );

  const invalid =
    contacts.filter(
      (
        contact
      ) =>
        contact.reviewStatus ===
        "invalid-phone"
    );

  const missing =
    contacts.filter(
      (
        contact
      ) =>
        contact.reviewStatus ===
        "missing-phone"
    );

  return (
    <section className="space-y-7">
      <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.05] p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Revisión terminada
        </p>

        <h3 className="mt-2 text-2xl font-bold">
          El lote está listo para revisar
        </h3>

        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          Tvameva omitirá
          automáticamente los
          duplicados, teléfonos
          inválidos y registros sin
          teléfono.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          title="Listos"
          value={
            ready.length
          }
          text="Se importarán"
        />

        <MetricCard
          title="Duplicados archivo"
          value={
            duplicateFile.length
          }
          text="Repetidos en la planilla"
        />

        <MetricCard
          title="Ya existentes"
          value={
            duplicateTvameva.length
          }
          text="Ya están en Tvameva"
        />

        <MetricCard
          title="Inválidos"
          value={
            invalid.length
          }
          text="Teléfono no válido"
        />

        <MetricCard
          title="Sin teléfono"
          value={
            missing.length
          }
          text="Serán omitidos"
        />
      </div>

      <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
        <div className="border-b border-white/10 p-6">
          <h3 className="text-xl font-semibold">
            Detalle del lote
          </h3>

          <p className="mt-1 text-sm text-slate-400">
            Se analizaron{" "}
            {contacts.length} registros.
          </p>
        </div>

        <div className="max-h-[560px] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 border-b border-white/10 bg-slate-900">
              <tr>
                <th className="px-4 py-3 text-left text-slate-400">
                  Fila
                </th>

                <th className="px-4 py-3 text-left text-slate-400">
                  Estado
                </th>

                <th className="px-4 py-3 text-left text-slate-400">
                  Nombre
                </th>

                <th className="px-4 py-3 text-left text-slate-400">
                  Teléfono
                </th>

                <th className="px-4 py-3 text-left text-slate-400">
                  Email
                </th>

                <th className="px-4 py-3 text-left text-slate-400">
                  Resultado
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-white/5">
              {contacts.map(
                (
                  contact
                ) => (
                  <tr
                    key={
                      contact.rowNumber
                    }
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {
                        contact.rowNumber
                      }
                    </td>

                    <td className="whitespace-nowrap px-4 py-3">
                      <ReviewStatusBadge
                        status={
                          contact.reviewStatus
                        }
                      />
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-slate-300">
                      {[
                        contact.firstName,
                        contact.lastName,
                      ]
                        .filter(
                          Boolean
                        )
                        .join(
                          " "
                        ) ||
                        "—"}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-slate-300">
                      {contact.normalizedPhone ||
                        contact.originalPhone ||
                        "—"}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                      {contact.email ||
                        "—"}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                      {reviewDescription(
                        contact.reviewStatus
                      )}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col justify-between gap-5 rounded-3xl border border-white/10 bg-white/[0.03] p-6 lg:flex-row lg:items-center">
        <div>
          <h3 className="text-lg font-semibold">
            Se importarán{" "}
            <span className="text-emerald-400">
              {ready.length}
            </span>{" "}
            contactos
          </h3>

          <p className="mt-1 text-sm text-slate-400">
            Los demás registros no
            serán eliminados del
            archivo original; simplemente
            no se guardarán en Tvameva.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            disabled={
              importing
            }
            onClick={
              onBack
            }
            className="rounded-xl border border-white/10 px-5 py-3 text-slate-300 transition hover:bg-white/5 disabled:opacity-50"
          >
            Volver al mapeo
          </button>

          <button
            type="button"
            disabled={
              ready.length ===
                0 ||
              importing
            }
            onClick={
              onImport
            }
            className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {importing
              ? "Importando..."
              : `Importar ${ready.length} contactos`}
          </button>
        </div>
      </div>
    </section>
  );
}

// =====================================================
// IMPORTACIÓN COMPLETADA
// =====================================================

function CompleteStage({
  summary,
  onNewImport,
}: {
  summary:
    ImportSummary;

  onNewImport:
    () => void;
}) {
  return (
    <section className="mx-auto max-w-3xl">
      <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/[0.07] p-8 text-center md:p-12">
        <div className="text-5xl">
          ✓
        </div>

        <p className="mt-5 text-sm font-semibold uppercase tracking-[0.25em] text-emerald-400">
          Importación terminada
        </p>

        <h3 className="mt-3 text-3xl font-bold">
          {summary.importedCount} contactos importados
        </h3>

        <p className="mx-auto mt-3 max-w-xl text-slate-400">
          Tvameva guardó correctamente
          los contactos válidos en tu
          organización.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <MetricCard
            title="Importados"
            value={
              summary.importedCount
            }
            text="Guardados correctamente"
          />

          <MetricCard
            title="Ya existentes"
            value={
              summary.skippedExistingCount
            }
            text="No se duplicaron"
          />

          <MetricCard
            title="Descartados"
            value={
              summary.invalidCount +
              summary.duplicatePayloadCount
            }
            text="Inválidos o repetidos"
          />
        </div>

        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/protected"
            className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            Volver al panel
          </Link>

          <button
            type="button"
            onClick={
              onNewImport
            }
            className="rounded-xl border border-white/10 px-6 py-3 text-slate-300 transition hover:bg-white/5"
          >
            Importar otro archivo
          </button>
        </div>
      </div>
    </section>
  );
}

// =====================================================
// SELECTOR DE MAPEO
// =====================================================

function MappingSelect({
  label,
  description,
  value,
  columns,
  onChange,
  required = false,
}: {
  label: string;

  description:
    string;

  value: string;

  columns:
    string[];

  onChange: (
    value: string
  ) => void;

  required?:
    boolean;
}) {
  return (
    <div>
      <div className="mb-2">
        <label className="font-medium text-slate-200">
          {label}

          {required && (
            <span className="ml-1 text-emerald-400">
              *
            </span>
          )}
        </label>

        <p className="mt-1 text-xs text-slate-500">
          {description}
        </p>
      </div>

      <select
        value={
          value
        }
        onChange={(
          event
        ) =>
          onChange(
            event.target.value
          )
        }
        className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
      >
        <option value="">
          No importar
        </option>

        {columns.map(
          (
            column
          ) => (
            <option
              key={
                column
              }
              value={
                column
              }
            >
              {column}
            </option>
          )
        )}
      </select>
    </div>
  );
}

// =====================================================
// PREVIEW NORMALIZADO
// =====================================================

function PreparedPreview({
  contacts,
}: {
  contacts:
    PreparedContact[];
}) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
      <div className="border-b border-white/10 p-6">
        <h3 className="text-xl font-semibold">
          Así los interpretará Tvameva
        </h3>

        <p className="mt-1 text-sm text-slate-400">
          Vista previa después del
          mapeo y normalización.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-white/10 bg-white/[0.03]">
            <tr>
              <th className="px-4 py-3 text-left text-slate-400">
                Estado
              </th>

              <th className="px-4 py-3 text-left text-slate-400">
                Nombre
              </th>

              <th className="px-4 py-3 text-left text-slate-400">
                Apellido
              </th>

              <th className="px-4 py-3 text-left text-slate-400">
                Original
              </th>

              <th className="px-4 py-3 text-left text-slate-400">
                Normalizado
              </th>

              <th className="px-4 py-3 text-left text-slate-400">
                Email
              </th>

              <th className="px-4 py-3 text-left text-slate-400">
                Curso
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/5">
            {contacts.map(
              (
                contact
              ) => (
                <tr
                  key={
                    contact.rowNumber
                  }
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge
                      status={
                        contact.status
                      }
                    />
                  </td>

                  <td className="whitespace-nowrap px-4 py-3 text-slate-300">
                    {
                      contact.firstName
                    }
                  </td>

                  <td className="whitespace-nowrap px-4 py-3 text-slate-300">
                    {
                      contact.lastName
                    }
                  </td>

                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                    {
                      contact.originalPhone
                    }
                  </td>

                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-200">
                    {contact.normalizedPhone ??
                      "—"}
                  </td>

                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                    {
                      contact.email
                    }
                  </td>

                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                    {
                      contact.course
                    }
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =====================================================
// BADGES
// =====================================================

function StatusBadge({
  status,
}: {
  status:
    PreparedContactStatus;
}) {
  if (
    status === "valid"
  ) {
    return (
      <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
        Válido
      </span>
    );
  }

  if (
    status ===
    "missing-phone"
  ) {
    return (
      <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
        Sin teléfono
      </span>
    );
  }

  return (
    <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-xs text-red-300">
      Inválido
    </span>
  );
}

function ReviewStatusBadge({
  status,
}: {
  status:
    ReviewStatus;
}) {
  if (
    status === "ready"
  ) {
    return (
      <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
        Listo
      </span>
    );
  }

  if (
    status ===
    "duplicate-file"
  ) {
    return (
      <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-xs text-violet-300">
        Duplicado
      </span>
    );
  }

  if (
    status ===
    "duplicate-tvameva"
  ) {
    return (
      <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-xs text-blue-300">
        Ya existe
      </span>
    );
  }

  if (
    status ===
    "missing-phone"
  ) {
    return (
      <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
        Sin teléfono
      </span>
    );
  }

  return (
    <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-xs text-red-300">
      Inválido
    </span>
  );
}

// =====================================================
// DESCRIPCIÓN REVISIÓN
// =====================================================

function reviewDescription(
  status:
    ReviewStatus
) {
  switch (
    status
  ) {
    case "ready":
      return "Se importará";

    case "duplicate-file":
      return "Repetido dentro de la planilla";

    case "duplicate-tvameva":
      return "Ya existe en Tvameva";

    case "missing-phone":
      return "No tiene teléfono";

    case "invalid-phone":
      return "Teléfono no válido";
  }
}

// =====================================================
// MÉTRICAS
// =====================================================

function MetricCard({
  title,
  value,
  text,
}: {
  title:
    string;

  value:
    number;

  text:
    string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-sm text-slate-400">
        {title}
      </p>

      <p className="mt-2 text-3xl font-bold">
        {value}
      </p>

      <p className="mt-1 text-xs text-slate-500">
        {text}
      </p>
    </div>
  );
}

function StatCard({
  title,
  value,
}: {
  title:
    string;

  value:
    string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-xs uppercase tracking-wider text-slate-500">
        {title}
      </p>

      <p className="mt-2 truncate font-semibold text-slate-200">
        {value}
      </p>
    </div>
  );
}

// =====================================================
// MAPEO AUTOMÁTICO
// =====================================================

function emptyMapping():
  ContactMapping {
  return {
    firstName:
      "",

    lastName:
      "",

    phone:
      "",

    alternatePhone:
      "",

    email:
      "",

    city:
      "",

    course:
      "",

    contactedBy:
      "",
  };
}

function detectMapping(
  columns:
    string[]
): ContactMapping {
  const mapping =
    emptyMapping();

  mapping.firstName =
    findColumn(
      columns,
      [
        "nombre",
        "nombres",
        "name",
        "first name",
        "persona",
        "nombre y apellido",
      ]
    );

  mapping.lastName =
    findColumn(
      columns,
      [
        "apellido",
        "apellidos",
        "surname",
        "last name",
      ]
    );

  mapping.phone =
    findColumn(
      columns,
      [
        "celular",
        "whatsapp",
        "telefono celular",
        "teléfono celular",
        "movil",
        "móvil",
        "mobile",
      ]
    );

  mapping.alternatePhone =
    findAlternativeColumn(
      columns,
      [
        "telefono",
        "teléfono",
        "tel",
        "phone",
      ],
      mapping.phone
    );

  mapping.email =
    findColumn(
      columns,
      [
        "correo electronico",
        "correo electrónico",
        "correo",
        "email",
        "e-mail",
        "mail",
      ]
    );

  mapping.city =
    findColumn(
      columns,
      [
        "ciudad",
        "localidad",
        "localidad(es)",
        "city",
      ]
    );

  mapping.course =
    findColumn(
      columns,
      [
        "ultimo curso",
        "último curso",
        "curso",
        "actividad",
        "course",
      ]
    );

  mapping.contactedBy =
    findColumn(
      columns,
      [
        "quien contacto",
        "quién contacto",
        "quien contactó",
        "quién contactó",
        "contactado por",
      ]
    );

  return mapping;
}

function findColumn(
  columns:
    string[],

  candidates:
    string[]
) {
  const normalizedCandidates =
    candidates.map(
      normalizeHeader
    );

  const exact =
    columns.find(
      (
        column
      ) =>
        normalizedCandidates.includes(
          normalizeHeader(
            column
          )
        )
    );

  if (exact) {
    return exact;
  }

  const partial =
    columns.find(
      (
        column
      ) => {
        const normalized =
          normalizeHeader(
            column
          );

        return normalizedCandidates.some(
          (
            candidate
          ) =>
            normalized.includes(
              candidate
            ) ||
            candidate.includes(
              normalized
            )
        );
      }
    );

  return partial ??
    "";
}

function findAlternativeColumn(
  columns:
    string[],

  candidates:
    string[],

  exclude:
    string
) {
  const available =
    columns.filter(
      (
        column
      ) =>
        column !==
        exclude
    );

  return findColumn(
    available,
    candidates
  );
}

function normalizeHeader(
  value:
    string
) {
  return value
    .normalize(
      "NFD"
    )
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .trim();
}

// =====================================================
// PREPARAR CONTACTOS
// =====================================================

function prepareContacts(
  rows:
    SpreadsheetRow[],

  mapping:
    ContactMapping
): PreparedContact[] {
  return rows.map(
    (
      row,
      index
    ) => {
      const primaryRaw =
        getMappedValue(
          row,
          mapping.phone
        );

      const alternateRaw =
        getMappedValue(
          row,
          mapping.alternatePhone
        );

      const primaryClean =
        cleanPhoneValue(
          primaryRaw
        );

      const alternateClean =
        cleanPhoneValue(
          alternateRaw
        );

      const primaryNormalized =
        normalizePhone(
          primaryClean
        );

      const alternateNormalized =
        normalizePhone(
          alternateClean
        );

      /*
       * Prioridad:
       *
       * 1. teléfono principal válido
       * 2. teléfono alternativo válido
       * 3. principal inválido
       * 4. alternativo inválido
       */

      let selectedPhone =
        "";

      let normalizedPhone:
        string | null =
          null;

      if (
        primaryClean &&
        primaryNormalized
      ) {
        selectedPhone =
          primaryClean;

        normalizedPhone =
          primaryNormalized;
      } else if (
        alternateClean &&
        alternateNormalized
      ) {
        selectedPhone =
          alternateClean;

        normalizedPhone =
          alternateNormalized;
      } else if (
        primaryClean
      ) {
        selectedPhone =
          primaryClean;
      } else if (
        alternateClean
      ) {
        selectedPhone =
          alternateClean;
      }

      let status:
        PreparedContactStatus;

      if (
        !selectedPhone
      ) {
        status =
          "missing-phone";
      } else if (
        !normalizedPhone
      ) {
        status =
          "invalid-phone";
      } else {
        status =
          "valid";
      }

      return {
        /*
         * Excel:
         * fila 1 = encabezados.
         */
        rowNumber:
          index + 2,

        firstName:
          getMappedValue(
            row,
            mapping.firstName
          ),

        lastName:
          getMappedValue(
            row,
            mapping.lastName
          ),

        originalPhone:
          selectedPhone,

        alternatePhone:
          alternateClean,

        normalizedPhone,

        email:
          getMappedValue(
            row,
            mapping.email
          )
            .trim()
            .toLowerCase(),

        city:
          getMappedValue(
            row,
            mapping.city
          ),

        course:
          getMappedValue(
            row,
            mapping.course
          ),

        contactedBy:
          getMappedValue(
            row,
            mapping.contactedBy
          ),

        status,

        sourceData:
          row,
      };
    }
  );
}

function getMappedValue(
  row:
    SpreadsheetRow,

  column:
    string
) {
  if (!column) {
    return "";
  }

  return cellToPlainText(
    row[
      column
    ]
  ).trim();
}

// =====================================================
// TELÉFONOS
// =====================================================

function cleanPhoneValue(
  value:
    string
) {
  const expanded =
    expandScientificNotation(
      value.trim()
    );

  if (
    !expanded ||
    expanded === "0"
  ) {
    return "";
  }

  return expanded;
}

function normalizePhone(
  rawPhone:
    string
): string | null {
  if (!rawPhone) {
    return null;
  }

  let candidate =
    rawPhone
      .replace(
        /[^\d+]/g,
        ""
      )
      .trim();

  if (!candidate) {
    return null;
  }

  /*
   * 0054...
   * pasa a +54...
   */

  if (
    candidate.startsWith(
      "00"
    )
  ) {
    candidate =
      `+${candidate.slice(
        2
      )}`;
  }

  /*
   * 54911...
   * o 5411...
   *
   * Si ya comienza con el
   * código argentino 54,
   * lo tratamos como
   * internacional.
   */

  if (
    !candidate.startsWith(
      "+"
    ) &&
    candidate.startsWith(
      "54"
    ) &&
    candidate.length >= 11
  ) {
    candidate =
      `+${candidate}`;
  }

  const phone =
    parsePhoneNumberFromString(
      candidate,
      DEFAULT_COUNTRY
    );

  if (
    !phone ||
    !phone.isValid()
  ) {
    return null;
  }

  return phone.number;
}

// =====================================================
// ARCHIVO
// =====================================================

function validateFile(
  file:
    File
) {
  if (
    file.size >
    MAX_FILE_SIZE
  ) {
    throw new Error(
      "El archivo supera el límite de 10 MB."
    );
  }

  const lowerName =
    file.name.toLowerCase();

  const validExtension =
    ALLOWED_EXTENSIONS.some(
      (
        extension
      ) =>
        lowerName.endsWith(
          extension
        )
    );

  if (
    !validExtension
  ) {
    throw new Error(
      "Formato no compatible. Usá XLSX, XLS o CSV."
    );
  }
}

// =====================================================
// LEER XLSX / XLS / CSV
// =====================================================

function parseWorkbook(
  buffer:
    ArrayBuffer,

  fileName:
    string,

  source:
    | "device"
    | "drop"
): ParsedSpreadsheet {
  const workbook =
    XLSX.read(
      buffer,
      {
        type:
          "array",

        cellText:
          false,

        cellNF:
          true,

        raw:
          true,
      }
    );

  const sheetName =
    workbook.SheetNames[0];

  if (
    !sheetName
  ) {
    throw new Error(
      "La planilla no contiene hojas."
    );
  }

  const worksheet =
    workbook.Sheets[
      sheetName
    ];

  const rawRows =
    XLSX.utils.sheet_to_json<
      Record<
        string,
        unknown
      >
    >(
      worksheet,
      {
        defval:
          "",

        raw:
          true,
      }
    );

  if (
    rawRows.length === 0
  ) {
    throw new Error(
      "La planilla está vacía."
    );
  }

  if (
    rawRows.length >
    MAX_ROWS
  ) {
    throw new Error(
      `La planilla contiene más de ${MAX_ROWS.toLocaleString(
        "es-AR"
      )} registros.`
    );
  }

  const columns =
    collectColumns(
      rawRows
    );

  if (
    columns.length === 0
  ) {
    throw new Error(
      "No se pudieron detectar columnas."
    );
  }

  const rows =
    normalizeRows(
      rawRows,
      columns
    );

  return {
    fileName,
    source,
    sheetName,
    columns,
    rows,
  };
}

// =====================================================
// COLUMNAS
// =====================================================

function collectColumns(
  rows:
    Record<
      string,
      unknown
    >[]
) {
  const columns =
    new Set<string>();

  for (
    const row of rows
  ) {
    for (
      const key of
      Object.keys(
        row
      )
    ) {
      const cleanKey =
        key.trim();

      if (cleanKey) {
        columns.add(
          cleanKey
        );
      }
    }
  }

  return Array.from(
    columns
  );
}

// =====================================================
// NORMALIZACIÓN LOCAL
// =====================================================

function normalizeRows(
  rows:
    Record<
      string,
      unknown
    >[],

  columns:
    string[]
): SpreadsheetRow[] {
  return rows.map(
    (
      row
    ) => {
      const normalized:
        SpreadsheetRow = {};

      for (
        const column of
        columns
      ) {
        normalized[
          column
        ] =
          normalizeCell(
            row[
              column
            ]
          );
      }

      return normalized;
    }
  );
}

// =====================================================
// NORMALIZAR DRIVE
// =====================================================

function normalizeImportedRows(
  rows:
    unknown
): SpreadsheetRow[] {
  if (
    !Array.isArray(
      rows
    )
  ) {
    return [];
  }

  return rows.map(
    (
      rawRow
    ) => {
      const result:
        SpreadsheetRow = {};

      if (
        !rawRow ||
        typeof rawRow !==
          "object"
      ) {
        return result;
      }

      for (
        const [
          key,
          value,
        ] of
        Object.entries(
          rawRow
        )
      ) {
        result[
          key
        ] =
          normalizeCell(
            value
          );
      }

      return result;
    }
  );
}

// =====================================================
// CELDAS
// =====================================================

function normalizeCell(
  value:
    unknown
): SpreadsheetCell {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  if (
    typeof value ===
    "number"
  ) {
    if (
      Number.isFinite(
        value
      )
    ) {
      return value;
    }

    return "";
  }

  if (
    typeof value ===
    "string"
  ) {
    return expandScientificNotation(
      value
    );
  }

  if (
    typeof value ===
    "boolean"
  ) {
    return value;
  }

  return String(
    value
  );
}

// =====================================================
// NOTACIÓN CIENTÍFICA
// =====================================================

function expandScientificNotation(
  value:
    string
): string {
  const clean =
    value.trim();

  if (!clean) {
    return "";
  }

  const scientificPattern =
    /^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/;

  if (
    !scientificPattern.test(
      clean
    )
  ) {
    return clean;
  }

  const numericValue =
    Number(
      clean
    );

  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    return clean;
  }

  if (
    Number.isInteger(
      numericValue
    )
  ) {
    return numericValue.toFixed(
      0
    );
  }

  return String(
    numericValue
  );
}

// =====================================================
// MOSTRAR CELDAS
// =====================================================

function displayCell(
  value:
    SpreadsheetCell
) {
  return cellToPlainText(
    value
  );
}

function cellToPlainText(
  value:
    SpreadsheetCell
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (
    typeof value ===
    "number"
  ) {
    if (
      Number.isInteger(
        value
      )
    ) {
      return value.toFixed(
        0
      );
    }

    return String(
      value
    );
  }

  if (
    typeof value ===
    "boolean"
  ) {
    return value
      ? "Sí"
      : "No";
  }

  return expandScientificNotation(
    String(
      value
    )
  );
}

// =====================================================
// ERRORES
// =====================================================

function getErrorMessage(
  error:
    unknown
) {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  return "Ocurrió un error inesperado.";
}

// =====================================================
// SCROLL
// =====================================================

function scrollTop() {
  window.scrollTo({
    top: 0,

    behavior:
      "smooth",
  });
}