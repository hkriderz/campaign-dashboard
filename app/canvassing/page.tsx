export default function CanvassingPage() {
  return (
    <div className="max-w-2xl mx-auto py-20 text-center">
      <span className="text-5xl mb-4 block" aria-hidden="true">🚶</span>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
        Canvassing Dashboard
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mb-6">
        This module will display canvassing data from Google Sheets and
        uploaded campaign files organized by candidate.
      </p>
      <div className="rounded-xl border border-dashed border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 p-6 text-left space-y-2">
        <p className="font-semibold text-violet-800 dark:text-violet-300 text-sm">Coming next:</p>
        <ul className="text-sm text-violet-700 dark:text-violet-300 space-y-1 list-disc list-inside">
          <li>Google Sheets API integration for historical data</li>
          <li>CSV file upload for curated canvassing reports</li>
          <li>Google Drive folder auto-ingest per campaign</li>
          <li>Per-candidate canvassing stats and charts</li>
        </ul>
      </div>
    </div>
  );
}
