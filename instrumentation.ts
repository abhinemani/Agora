// Runs once when the server starts. With a database, the document store fills in the background (lib/doc-ingest.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startDocIngest } = await import("./lib/doc-ingest");
  startDocIngest();
}
