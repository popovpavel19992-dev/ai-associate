// src/components/cases/signatures/pdf-field-editor.tsx
"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// react-pdf must not be SSR'd — pdfjs-dist references browser-only globals
// (DOMMatrix, Path2D). Use next/dynamic with ssr: false for both sub-components
// and configure the worker via CDN to avoid bundling/copy-to-public overhead.
const Document = dynamic(
  () => import("react-pdf").then((mod) => mod.Document),
  { ssr: false },
);

const Page = dynamic(
  () => import("react-pdf").then((mod) => mod.Page),
  { ssr: false },
);

let workerConfigured = false;

function configureWorker() {
  if (workerConfigured) return;
  workerConfigured = true;
  // CDN worker — simpler than copying to /public. We can revisit if we need
  // offline support or stricter CSP.
  void import("react-pdf").then(({ pdfjs }) => {
    pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  });
  // react-pdf v10 ships its own CSS for text/annotation layers
  void import("react-pdf/dist/Page/AnnotationLayer.css");
  void import("react-pdf/dist/Page/TextLayer.css");
}

// ---------- Public types ----------

export type FieldType = "signature" | "date_signed" | "text" | "initials";

export interface Signer {
  /** 0-based index into the caller's signer list */
  index: number;
  label: string;
  /** any CSS color; applied to the field border + label chip */
  color: string;
}

export interface PlacedField {
  /** Client-generated stable id (uuid) */
  id: string;
  signerIndex: number;
  fieldType: FieldType;
  /** 1-based page number */
  page: number;
  /** All normalized fractions of page dimensions, top-left origin */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfFieldEditorProps {
  pdfUrl: string;
  signers: Signer[];
  fields: PlacedField[];
  onChange: (fields: PlacedField[]) => void;
  onReady?: (pageCount: number) => void;
}

// ---------- Helpers ----------

/**
 * Single source of truth for the coord convention: fractions of the rendered
 * page size, top-left origin. Pixel values are always relative to the rendered
 * canvas bounds measured at runtime.
 */
function pxToFraction(px: number, total: number): number {
  if (total <= 0) return 0;
  return clamp01(px / total);
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `f_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

// Default pixel sizes at the reference render width (PAGE_WIDTH_PX).
// Converted to normalized fractions relative to the rendered page box.
const PAGE_WIDTH_PX = 800;

const DEFAULT_SIZE_PX: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 180, h: 40 },
  initials: { w: 60, h: 30 },
  date_signed: { w: 100, h: 24 },
  text: { w: 160, h: 24 },
};

const FIELD_LABEL: Record<FieldType, string> = {
  signature: "Sig",
  initials: "Init",
  date_signed: "Date",
  text: "Text",
};

const FIELD_BUTTON_LABEL: Record<FieldType, string> = {
  signature: "Signature",
  initials: "Initials",
  date_signed: "Date",
  text: "Text",
};

// ---------- Component ----------

export function PdfFieldEditor({
  pdfUrl,
  signers,
  fields,
  onChange,
  onReady,
}: PdfFieldEditorProps) {
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageCount, setPageCount] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [activeSignerIndex, setActiveSignerIndex] = React.useState<number | null>(
    signers[0]?.index ?? null,
  );
  const [pendingType, setPendingType] = React.useState<FieldType | null>(null);
  const [selectedFieldId, setSelectedFieldId] = React.useState<string | null>(
    null,
  );

  // Keep activeSignerIndex valid if the signers list changes.
  React.useEffect(() => {
    if (
      activeSignerIndex === null ||
      !signers.some((s) => s.index === activeSignerIndex)
    ) {
      setActiveSignerIndex(signers[0]?.index ?? null);
    }
  }, [signers, activeSignerIndex]);

  const canvasWrapperRef = React.useRef<HTMLDivElement | null>(null);
  // pageBoxRef wraps the rendered react-pdf <Page/> canvas. Its bounding rect
  // is our source of truth for converting px<->fraction.
  const pageBoxRef = React.useRef<HTMLDivElement | null>(null);

  // Track rendered page box size so we can convert stored fractions back into
  // on-screen pixels for the overlay. ResizeObserver handles window resize and
  // react-pdf's async layout (canvas mounts after onLoadSuccess).
  const [pageSize, setPageSize] = React.useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  React.useEffect(() => {
    configureWorker();
  }, []);

  React.useEffect(() => {
    const el = pageBoxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setPageSize({ w: width, h: height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [currentPage, pageCount, loading]);

  const handleLoadSuccess = React.useCallback(
    ({ numPages }: { numPages: number }) => {
      setPageCount(numPages);
      setLoading(false);
      setError(null);
      onReady?.(numPages);
    },
    [onReady],
  );

  const handleLoadError = React.useCallback((err: Error) => {
    console.error("PdfFieldEditor: failed to load document", err);
    setLoading(false);
    setError(
      "Failed to load PDF. If this is a signed URL, it may have expired or CORS may be blocking the request.",
    );
  }, []);

  const goPrev = () => {
    setSelectedFieldId(null);
    setCurrentPage((p) => Math.max(1, p - 1));
  };
  const goNext = () => {
    setSelectedFieldId(null);
    setCurrentPage((p) => Math.min(pageCount || p, p + 1));
  };

  const activeSigner = signers.find((s) => s.index === activeSignerIndex) ?? null;

  // ---------- Placement ----------

  const handlePageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Ignore clicks that originated on a placed field (they handle selection
    // / drag themselves and stopPropagation).
    if (e.defaultPrevented) return;
    if (!pendingType) {
      // A bare click just clears selection.
      setSelectedFieldId(null);
      return;
    }
    if (activeSignerIndex === null) return;
    const box = pageBoxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const size = DEFAULT_SIZE_PX[pendingType];
    // Scale default px sizes against PAGE_WIDTH_PX reference so zooming later
    // doesn't distort defaults. Then convert to fractions of actual rect.
    const scale = rect.width / PAGE_WIDTH_PX;
    const widthPx = size.w * scale;
    const heightPx = size.h * scale;

    // Center field on click point, then clamp so it fits on-page.
    let px = e.clientX - rect.left - widthPx / 2;
    let py = e.clientY - rect.top - heightPx / 2;
    px = Math.max(0, Math.min(rect.width - widthPx, px));
    py = Math.max(0, Math.min(rect.height - heightPx, py));

    const newField: PlacedField = {
      id: generateId(),
      signerIndex: activeSignerIndex,
      fieldType: pendingType,
      page: currentPage,
      x: pxToFraction(px, rect.width),
      y: pxToFraction(py, rect.height),
      width: pxToFraction(widthPx, rect.width),
      height: pxToFraction(heightPx, rect.height),
    };

    onChange([...fields, newField]);
    setSelectedFieldId(newField.id);
    // One-shot placement — user picks the tool again to add another.
    setPendingType(null);
  };

  // ---------- Drag / resize ----------

  type DragMode = "move" | "resize";
  type DragState = {
    mode: DragMode;
    fieldId: string;
    startClientX: number;
    startClientY: number;
    startX: number; // fraction
    startY: number;
    startW: number;
    startH: number;
  };
  const dragRef = React.useRef<DragState | null>(null);

  const beginDrag = (
    e: React.MouseEvent,
    field: PlacedField,
    mode: DragMode,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedFieldId(field.id);
    dragRef.current = {
      mode,
      fieldId: field.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: field.x,
      startY: field.y,
      startW: field.width,
      startH: field.height,
    };
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
  };

  const onDragMove = React.useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const box = pageBoxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dxFrac = (e.clientX - drag.startClientX) / rect.width;
    const dyFrac = (e.clientY - drag.startClientY) / rect.height;

    onChangeRef.current((prev) =>
      prev.map((f) => {
        if (f.id !== drag.fieldId) return f;
        if (drag.mode === "move") {
          const x = clamp01(drag.startX + dxFrac);
          const y = clamp01(drag.startY + dyFrac);
          // Keep field fully inside page.
          const maxX = Math.max(0, 1 - f.width);
          const maxY = Math.max(0, 1 - f.height);
          return { ...f, x: Math.min(x, maxX), y: Math.min(y, maxY) };
        }
        // resize
        const minW = 20 / rect.width;
        const minH = 16 / rect.height;
        const width = clamp01(
          Math.max(minW, Math.min(1 - drag.startX, drag.startW + dxFrac)),
        );
        const height = clamp01(
          Math.max(minH, Math.min(1 - drag.startY, drag.startH + dyFrac)),
        );
        return { ...f, width, height };
      }),
    );
  }, []);

  const onDragEnd = React.useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
  }, [onDragMove]);

  // Stable ref so the global mousemove callback can mutate fields without
  // re-binding every render.
  const onChangeRef = React.useRef<(updater: (prev: PlacedField[]) => PlacedField[]) => void>(
    () => {},
  );
  React.useEffect(() => {
    onChangeRef.current = (updater) => onChange(updater(fields));
  }, [fields, onChange]);

  React.useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", onDragMove);
      window.removeEventListener("mouseup", onDragEnd);
    };
  }, [onDragMove, onDragEnd]);

  // ---------- Delete / keyboard ----------

  const deleteField = React.useCallback(
    (id: string) => {
      onChange(fields.filter((f) => f.id !== id));
      setSelectedFieldId((prev) => (prev === id ? null : prev));
    },
    [fields, onChange],
  );

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedFieldId) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      deleteField(selectedFieldId);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedFieldId, deleteField]);

  // ---------- Render ----------

  const fieldsOnPage = fields.filter((f) => f.page === currentPage);
  const signerOf = (i: number) => signers.find((s) => s.index === i);

  const placementArmed = pendingType !== null && activeSignerIndex !== null;

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
        {/* Active signer picker */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Signer:
          </span>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Active signer">
            {signers.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                No signers yet
              </span>
            ) : (
              signers.map((s) => {
                const active = s.index === activeSignerIndex;
                return (
                  <button
                    key={s.index}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setActiveSignerIndex(s.index)}
                    className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition ${
                      active
                        ? "border-foreground bg-background font-medium"
                        : "border-border bg-background/60 text-muted-foreground hover:bg-background"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    {s.label}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="mx-1 h-4 w-px bg-border" aria-hidden />

        {/* Field-type palette */}
        <div className="flex items-center gap-1" aria-label="Field type palette">
          {(Object.keys(FIELD_BUTTON_LABEL) as FieldType[]).map((t) => {
            const active = pendingType === t;
            return (
              <Button
                key={t}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() =>
                  setPendingType((prev) => (prev === t ? null : t))
                }
                disabled={activeSignerIndex === null}
                aria-pressed={active}
              >
                {FIELD_BUTTON_LABEL[t]}
              </Button>
            );
          })}
        </div>

        {/* Right: page nav */}
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={goPrev}
            disabled={currentPage <= 1 || loading || !!error}
          >
            Prev
          </Button>
          <span className="text-xs text-muted-foreground">
            {loading || error ? "—" : `Page ${currentPage} of ${pageCount}`}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={goNext}
            disabled={currentPage >= pageCount || loading || !!error}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Hint banner */}
      {signers.length > 0 && activeSignerIndex === null ? (
        <div className="rounded-md border border-dashed bg-background px-3 py-2 text-xs text-muted-foreground">
          Pick a signer to place fields.
        </div>
      ) : pendingType && activeSigner ? (
        <div className="rounded-md border border-dashed bg-background px-3 py-2 text-xs text-muted-foreground">
          Click on the page to place a{" "}
          <span className="font-medium text-foreground">
            {FIELD_BUTTON_LABEL[pendingType]}
          </span>{" "}
          field for{" "}
          <span
            className="font-medium"
            style={{ color: activeSigner.color }}
          >
            {activeSigner.label}
          </span>
          .
        </div>
      ) : null}

      {/* Canvas area */}
      <div
        ref={canvasWrapperRef}
        data-pdf-canvas-wrapper
        data-current-page={currentPage}
        className="relative flex min-h-[400px] items-start justify-center overflow-auto rounded-md border bg-muted/20 p-4"
      >
        {error ? (
          <div className="max-w-md text-center text-sm text-destructive">
            {error}
          </div>
        ) : (
          <Document
            file={pdfUrl}
            onLoadSuccess={handleLoadSuccess}
            onLoadError={handleLoadError}
            loading={
              <div className="text-sm text-muted-foreground">Loading PDF…</div>
            }
            error={
              <div className="text-sm text-destructive">
                Failed to render PDF.
              </div>
            }
          >
            {!loading && pageCount > 0 ? (
              <div
                ref={pageBoxRef}
                className="relative inline-block"
                style={{ cursor: placementArmed ? "crosshair" : "default" }}
                onClick={handlePageClick}
              >
                <Page
                  pageNumber={currentPage}
                  width={PAGE_WIDTH_PX}
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                />

                {/* Field overlay */}
                {pageSize.w > 0 &&
                  fieldsOnPage.map((f) => {
                    const s = signerOf(f.signerIndex);
                    const color = s?.color ?? "#6366f1";
                    const selected = f.id === selectedFieldId;
                    const left = f.x * pageSize.w;
                    const top = f.y * pageSize.h;
                    const width = f.width * pageSize.w;
                    const height = f.height * pageSize.h;
                    const label = `${FIELD_LABEL[f.fieldType]} – ${
                      s?.label ?? `Signer ${f.signerIndex + 1}`
                    }`;
                    return (
                      <div
                        key={f.id}
                        role="button"
                        tabIndex={0}
                        aria-label={label}
                        aria-pressed={selected}
                        onMouseDown={(e) => beginDrag(e, f, "move")}
                        onClick={(e) => {
                          // Swallow so page-level onClick doesn't place a new
                          // field on top of an existing one.
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedFieldId(f.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Delete" || e.key === "Backspace") {
                            e.preventDefault();
                            deleteField(f.id);
                          }
                        }}
                        className={`absolute flex select-none items-center justify-between gap-1 rounded-sm bg-white/70 text-[10px] leading-none shadow-sm backdrop-blur-sm ${
                          selected ? "ring-2 ring-offset-1" : ""
                        }`}
                        style={{
                          left,
                          top,
                          width,
                          height,
                          border: `2px solid ${color}`,
                          color,
                          cursor: "move",
                        }}
                      >
                        <span
                          className="truncate px-1 font-medium"
                          style={{ color }}
                        >
                          {label}
                        </span>
                        {selected ? (
                          <button
                            type="button"
                            aria-label={`Remove ${label}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              deleteField(f.id);
                            }}
                            className="mr-0.5 rounded-sm bg-white/80 p-0.5 text-destructive hover:bg-white"
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        ) : null}
                        {/* Resize handle */}
                        <span
                          role="presentation"
                          onMouseDown={(e) => beginDrag(e, f, "resize")}
                          className="absolute bottom-0 right-0 h-2 w-2 translate-x-1/2 translate-y-1/2 cursor-se-resize rounded-sm border bg-white"
                          style={{ borderColor: color }}
                        />
                      </div>
                    );
                  })}
              </div>
            ) : null}
          </Document>
        )}
      </div>
    </div>
  );
}
