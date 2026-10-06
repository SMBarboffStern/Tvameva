"use client";

import {
  useMemo,
  useRef,
  useState,
} from "react";

// =====================================================
// TIPOS
// =====================================================

export type TemplatePreviewData = {
  nombre: string;
  apellido: string;
  curso: string;
  ciudad: string;
  sede: string;
};

type TemplateEditorProps = {
  mode: "create" | "edit";

  initialName?: string;
  initialBody?: string;

  previewData: TemplatePreviewData;

  saveAction: (
    formData: FormData
  ) => Promise<void>;
};

// =====================================================
// VARIABLES DISPONIBLES
// =====================================================

const VARIABLES = [
  {
    key: "saludo",
    label: "Saludo",
    example: "Buenas tardes",
  },
  {
    key: "nombre",
    label: "Nombre",
    example: "María",
  },
  {
    key: "apellido",
    label: "Apellido",
    example: "González",
  },
  {
    key: "curso",
    label: "Curso",
    example: "Meditación",
  },
  {
    key: "ciudad",
    label: "Ciudad",
    example: "Buenos Aires",
  },
  {
    key: "sede",
    label: "Sede",
    example: "Villa del Parque",
  },
];

// =====================================================
// COMPONENTE
// =====================================================

export default function TemplateEditor({
  mode,
  initialName = "",
  initialBody = "",
  previewData,
  saveAction,
}: TemplateEditorProps) {
  const textareaRef =
    useRef<HTMLTextAreaElement | null>(
      null
    );

  const [name, setName] =
    useState(initialName);

  const [body, setBody] =
    useState(initialBody);

  // ===================================================
  // PREVIEW
  // ===================================================

  const preview =
    useMemo(() => {
      return renderTemplate(
        body,
        {
          saludo:
            getGreeting(),

          nombre:
            previewData.nombre ||
            "María",

          apellido:
            previewData.apellido ||
            "González",

          curso:
            previewData.curso ||
            "Meditación",

          ciudad:
            previewData.ciudad ||
            "Buenos Aires",

          sede:
            previewData.sede ||
            "Villa del Parque",
        }
      );
    }, [
      body,
      previewData,
    ]);

  // ===================================================
  // INSERTAR VARIABLE
  // ===================================================

  function insertVariable(
    variable: string
  ) {
    const token =
      `{{${variable}}}`;

    const textarea =
      textareaRef.current;

    if (!textarea) {
      setBody(
        (current) =>
          `${current}${token}`
      );

      return;
    }

    const start =
      textarea.selectionStart;

    const end =
      textarea.selectionEnd;

    const newValue =
      body.slice(0, start) +
      token +
      body.slice(end);

    setBody(newValue);

    requestAnimationFrame(
      () => {
        textarea.focus();

        const nextPosition =
          start +
          token.length;

        textarea.setSelectionRange(
          nextPosition,
          nextPosition
        );
      }
    );
  }

  // ===================================================
  // UI
  // ===================================================

  return (
    <form
      action={saveAction}
      className="grid gap-7 xl:grid-cols-[1.15fr_0.85fr]"
    >
      {/* EDITOR */}

      <div className="space-y-6">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              {mode === "create"
                ? "Nueva plantilla"
                : "Editar plantilla"}
            </p>

            <h2 className="mt-2 text-2xl font-bold">
              Mensaje
            </h2>

            <p className="mt-2 text-sm text-slate-400">
              Escribí el mensaje y usá
              variables para personalizarlo
              automáticamente.
            </p>
          </div>

          {/* NOMBRE */}

          <div className="mt-7">
            <label
              htmlFor="name"
              className="mb-2 block text-sm font-medium text-slate-300"
            >
              Nombre de la plantilla
            </label>

            <input
              id="name"
              name="name"
              type="text"
              required
              maxLength={200}
              value={name}
              onChange={(event) =>
                setName(
                  event.target.value
                )
              }
              placeholder="Ej. Invitación a curso"
              className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-400"
            />
          </div>

          {/* VARIABLES */}

          <div className="mt-6">
            <p className="mb-3 text-sm font-medium text-slate-300">
              Insertar variable
            </p>

            <div className="flex flex-wrap gap-2">
              {VARIABLES.map(
                (variable) => (
                  <button
                    key={
                      variable.key
                    }
                    type="button"
                    onClick={() =>
                      insertVariable(
                        variable.key
                      )
                    }
                    className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20"
                  >
                    {`{{${variable.key}}}`}
                  </button>
                )
              )}
            </div>
          </div>

          {/* CUERPO */}

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between gap-4">
              <label
                htmlFor="body"
                className="text-sm font-medium text-slate-300"
              >
                Texto del mensaje
              </label>

              <span className="text-xs text-slate-600">
                {body.length} caracteres
              </span>
            </div>

            <textarea
              ref={textareaRef}
              id="body"
              name="body"
              required
              rows={16}
              value={body}
              onChange={(event) =>
                setBody(
                  event.target.value
                )
              }
              placeholder={`{{saludo}} {{nombre}} 👋

Te escribimos desde El Arte de Vivir para contarte sobre {{curso}}.`}
              className="w-full resize-y rounded-2xl border border-white/10 bg-slate-900 px-4 py-4 leading-7 text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-400"
            />
          </div>

          {/* AYUDA */}

          <div className="mt-5 rounded-2xl border border-white/10 bg-slate-900/50 p-5">
            <p className="font-medium text-slate-300">
              Variables disponibles
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {VARIABLES.map(
                (variable) => (
                  <div
                    key={
                      variable.key
                    }
                    className="text-xs text-slate-500"
                  >
                    <span className="font-mono text-emerald-300">
                      {`{{${variable.key}}}`}
                    </span>

                    {" → "}

                    {variable.example}
                  </div>
                )
              )}
            </div>
          </div>
        </div>

        {/* GUARDAR */}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={
              !name.trim() ||
              !body.trim()
            }
            className="rounded-xl bg-emerald-500 px-7 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mode === "create"
              ? "Guardar plantilla"
              : "Guardar cambios"}
          </button>
        </div>
      </div>

      {/* PREVIEW */}

      <div>
        <div className="sticky top-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Vista previa
          </p>

          <h3 className="mt-2 text-xl font-semibold">
            Así verá el mensaje
          </h3>

          <p className="mt-2 text-sm text-slate-400">
            Usamos un contacto real cuando
            está disponible.
          </p>

          {/* TELÉFONO */}

          <div className="mt-6 overflow-hidden rounded-[2rem] border border-white/10 bg-[#0b141a] shadow-2xl">
            <div className="border-b border-white/10 bg-[#202c33] px-5 py-4">
              <p className="font-semibold text-white">
                {previewData.nombre ||
                  "Contacto"}{" "}
                {previewData.apellido}
              </p>

              <p className="text-xs text-slate-400">
                WhatsApp
              </p>
            </div>

            <div className="min-h-[420px] bg-[#0b141a] p-5">
              {preview.trim() ? (
                <div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-sm bg-[#005c4b] px-4 py-3 shadow-lg">
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-white">
                    {preview}
                  </p>

                  <p className="mt-1 text-right text-[10px] text-emerald-100/60">
                    Vista previa
                  </p>
                </div>
              ) : (
                <div className="flex min-h-[350px] items-center justify-center text-center text-sm text-slate-600">
                  Escribí un mensaje para
                  ver la vista previa.
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-slate-900/50 p-4">
            <p className="text-xs text-slate-500">
              El saludo cambia
              automáticamente según el
              horario.
            </p>
          </div>
        </div>
      </div>
    </form>
  );
}

// =====================================================
// RENDER TEMPLATE
// =====================================================

function renderTemplate(
  template: string,
  variables: Record<
    string,
    string
  >
) {
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (
      fullMatch,
      key: string
    ) => {
      if (
        Object.prototype.hasOwnProperty.call(
          variables,
          key
        )
      ) {
        return variables[key];
      }

      return fullMatch;
    }
  );
}

// =====================================================
// SALUDO
// =====================================================

function getGreeting() {
  const hour =
    new Date().getHours();

  if (
    hour >= 5 &&
    hour < 12
  ) {
    return "Buenos días";
  }

  if (
    hour >= 12 &&
    hour < 20
  ) {
    return "Buenas tardes";
  }

  return "Hola";
}