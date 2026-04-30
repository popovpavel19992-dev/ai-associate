"use client";

// src/app/respond/[token]/thank-you/page.tsx


export default function ThankYouPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-16 px-4">
      <div className="mx-auto max-w-xl rounded-lg bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">
          Responses submitted
        </h1>
        <p className="mt-3 text-sm text-gray-700">
          Thank you. Your discovery responses have been recorded and the
          propounding party has been notified.
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Please retain this confirmation for your records.
        </p>
        <button
          type="button"
          onClick={() => typeof window !== "undefined" && window.print()}
          className="mt-6 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Print confirmation
        </button>
      </div>
    </div>
  );
}
