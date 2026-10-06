import { NextRequest, NextResponse } from "next/server";

import * as XLSX from "xlsx";

// =====================================================
// CONFIGURACIÓN
// =====================================================

const MAX_DOWNLOAD_SIZE =
  10 * 1024 * 1024;

const MAX_ROWS = 20000;

// =====================================================
// POST
// =====================================================

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      await request.json();

    const rawUrl =
      String(body?.url ?? "").trim();

    if (!rawUrl) {
      return NextResponse.json(
        {
          error:
            "Falta el enlace de Google Drive.",
        },
        {
          status: 400,
        }
      );
    }

    const driveInfo =
      parseGoogleDriveUrl(
        rawUrl
      );

    if (!driveInfo) {
      return NextResponse.json(
        {
          error:
            "El enlace no parece ser un archivo válido de Google Drive o Google Sheets.",
        },
        {
          status: 400,
        }
      );
    }

    const downloadUrl =
      buildDownloadUrl(
        driveInfo
      );

    const response =
      await fetch(
        downloadUrl,
        {
          redirect: "follow",
          cache: "no-store",
        }
      );

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            "Google Drive no permitió acceder al archivo. Verificá que esté compartido como 'Cualquier persona con el enlace'.",
        },
        {
          status: 400,
        }
      );
    }

    const contentLength =
      response.headers.get(
        "content-length"
      );

    if (
      contentLength &&
      Number(contentLength) >
        MAX_DOWNLOAD_SIZE
    ) {
      return NextResponse.json(
        {
          error:
            "El archivo supera el límite de 10 MB.",
        },
        {
          status: 400,
        }
      );
    }

    const arrayBuffer =
      await response.arrayBuffer();

    if (
      arrayBuffer.byteLength >
      MAX_DOWNLOAD_SIZE
    ) {
      return NextResponse.json(
        {
          error:
            "El archivo supera el límite de 10 MB.",
        },
        {
          status: 400,
        }
      );
    }

    const workbook =
      XLSX.read(
        arrayBuffer,
        {
          type: "array",
        }
      );

    const sheetName =
      workbook.SheetNames[0];

    if (!sheetName) {
      return NextResponse.json(
        {
          error:
            "La planilla no contiene hojas.",
        },
        {
          status: 400,
        }
      );
    }

    const worksheet =
      workbook.Sheets[
        sheetName
      ];

    const rawRows =
      XLSX.utils.sheet_to_json<
        Record<string, unknown>
      >(worksheet, {
        defval: "",
        raw: false,
      });

    if (
      rawRows.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "La planilla está vacía.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      rawRows.length >
      MAX_ROWS
    ) {
      return NextResponse.json(
        {
          error:
            `La planilla contiene más de ${MAX_ROWS.toLocaleString(
              "es-AR"
            )} registros.`,
        },
        {
          status: 400,
        }
      );
    }

    const columns =
      collectColumns(
        rawRows
      );

    const rows =
      normalizeRows(
        rawRows,
        columns
      );

    return NextResponse.json({
      fileName:
        driveInfo.type ===
        "sheet"
          ? "Google Sheets"
          : "Google Drive",
      sheetName,
      columns,
      rows,
    });
  } catch (error) {
    console.error(
      "Error importando desde Drive:",
      error
    );

    return NextResponse.json(
      {
        error:
          "No se pudo procesar el archivo de Google Drive.",
      },
      {
        status: 500,
      }
    );
  }
}

// =====================================================
// GOOGLE DRIVE URL
// =====================================================

type DriveInfo =
  | {
      type: "sheet";
      id: string;
    }
  | {
      type: "file";
      id: string;
    };

function parseGoogleDriveUrl(
  rawUrl: string
): DriveInfo | null {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const hostname =
    url.hostname.toLowerCase();

  const allowedHosts = [
    "drive.google.com",
    "docs.google.com",
  ];

  if (
    !allowedHosts.includes(
      hostname
    )
  ) {
    return null;
  }

  // -----------------------------------------------
  // GOOGLE SHEETS
  // -----------------------------------------------

  const sheetsMatch =
    url.pathname.match(
      /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/
    );

  if (
    sheetsMatch?.[1]
  ) {
    return {
      type: "sheet",
      id: sheetsMatch[1],
    };
  }

  // -----------------------------------------------
  // GOOGLE DRIVE /file/d/ID
  // -----------------------------------------------

  const fileMatch =
    url.pathname.match(
      /\/file\/d\/([a-zA-Z0-9_-]+)/
    );

  if (
    fileMatch?.[1]
  ) {
    return {
      type: "file",
      id: fileMatch[1],
    };
  }

  // -----------------------------------------------
  // GOOGLE DRIVE ?id=ID
  // -----------------------------------------------

  const queryId =
    url.searchParams.get(
      "id"
    );

  if (queryId) {
    return {
      type: "file",
      id: queryId,
    };
  }

  return null;
}

// =====================================================
// URL DESCARGA
// =====================================================

function buildDownloadUrl(
  driveInfo: DriveInfo
) {
  if (
    driveInfo.type ===
    "sheet"
  ) {
    return (
      "https://docs.google.com/spreadsheets/d/" +
      encodeURIComponent(
        driveInfo.id
      ) +
      "/export?format=xlsx"
    );
  }

  return (
    "https://drive.google.com/uc?export=download&id=" +
    encodeURIComponent(
      driveInfo.id
    )
  );
}

// =====================================================
// COLUMNAS
// =====================================================

function collectColumns(
  rows: Record<
    string,
    unknown
  >[]
) {
  const columns =
    new Set<string>();

  for (const row of rows) {
    for (
      const key of Object.keys(row)
    ) {
      const cleanKey =
        key.trim();

      if (cleanKey) {
        columns.add(cleanKey);
      }
    }
  }

  return Array.from(columns);
}

// =====================================================
// NORMALIZACIÓN
// =====================================================

function normalizeRows(
  rows: Record<
    string,
    unknown
  >[],
  columns: string[]
) {
  return rows.map(
    (row) => {
      const normalized:
        Record<
          string,
          | string
          | number
          | boolean
          | null
        > = {};

      for (
        const column of columns
      ) {
        normalized[column] =
          normalizeCell(
            row[column]
          );
      }

      return normalized;
    }
  );
}

function normalizeCell(
  value: unknown
):
  | string
  | number
  | boolean
  | null {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  if (
    typeof value ===
      "string" ||
    typeof value ===
      "number" ||
    typeof value ===
      "boolean"
  ) {
    return value;
  }

  return String(value);
}