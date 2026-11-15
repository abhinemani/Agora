// Runs once when the server starts. With a database, the document store fills in the background (lib/doc-ingest.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startDocIngest } = await import("./lib/doc-ingest");
  startDocIngest();
  // A one-time check of the scan model against the main model's readings, when AGORA_SCAN_COMPARE asks for one.
  const { startScanComparison } = await import("./lib/scan-compare");
  startScanComparison();
}
