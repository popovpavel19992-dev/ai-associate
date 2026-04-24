// src/components/cases/signatures/pdf-field-editor.tsx
"use client";

import * as React from "react";
import dynamic from "next/dynamic";
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

export interface PdfFieldEditorProps {
  pdfUrl: string;
  onReady?: (pageCount: number) => void;
}

export function PdfFieldEditor({ pdfUrl, onReady }: PdfFieldEditorProps) {
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageCount, setPageCount] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const canvasWrapperRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    configureWorker();
  }, []);

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

  const goPrev = () => setCurrentPage((p) => Math.max(1, p - 1));
  const goNext = () =>
    setCurrentPage((p) => Math.min(pageCount || p, p + 1));

  return (
    <div className="flex flex-col gap-3">
      {/* Placeholder toolbar — drag-drop field palette lands in wave 2 */}
      <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <span className="font-medium text-muted-foreground">
          Fields (coming soon)
        </span>
        <span className="text-xs text-muted-foreground">
          Drag field placement will be enabled in wave 2
        </span>
      </div>

      <div
        ref={canvasWrapperRef}
        data-pdf-canvas-wrapper
        data-current-page={currentPage}
        className="relative flex min-h-[400px] items-center justify-center overflow-auto rounded-md border bg-muted/20 p-4"
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
              <div className="text-sm text-muted-foreground">
                Loading PDF…
              </div>
            }
            error={
              <div className="text-sm text-destructive">
                Failed to render PDF.
              </div>
            }
          >
            {!loading && pageCount > 0 ? (
              <Page
                pageNumber={currentPage}
                width={800}
                renderAnnotationLayer={false}
                renderTextLayer={false}
              />
            ) : null}
          </Document>
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={goPrev}
          disabled={currentPage <= 1 || loading || !!error}
        >
          Prev
        </Button>
        <span className="text-sm text-muted-foreground">
          {loading || error
            ? "—"
            : `Page ${currentPage} of ${pageCount}`}
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
  );
}
