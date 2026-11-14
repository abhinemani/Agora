// Contract uploads read in the background. Reading a contract can take most of a minute, which is
// longer than some networks hold a request open, so the upload route answers at once with a job id
// and the page asks for the result until it is ready. Jobs live in this server's memory: they are
// short-lived, and one that is lost to a restart is simply uploaded again. Server-only.

import { randomBytes } from "node:crypto";

interface Job {
  owner: string;
  status: "working" | "done" | "failed";
  result?: unknown;
  error?: string;
  /** The HTTP status a failure would have had as a direct answer. */
  code?: number;
  at: number;
}

const KEEP_MS = 30 * 60 * 1000;
const jobs = ((globalThis as unknown as { __agoraParseJobs?: Map<string, Job> }).__agoraParseJobs ??= new Map<string, Job>());

/** Start `work` without waiting for it. `failure` turns what it throws into the message and status to report. */
export function startJob(owner: string, work: () => Promise<unknown>, failure: (err: unknown) => { error: string; code: number }): string {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.at > KEEP_MS) jobs.delete(id);
  const id = randomBytes(9).toString("hex");
  const job: Job = { owner, status: "working", at: now };
  jobs.set(id, job);
  work().then(
    (result) => Object.assign(job, { status: "done", result }),
    (err) => Object.assign(job, { status: "failed", ...failure(err) }),
  );
  return id;
}

/** A job, for the person who started it only. */
export function readJob(id: string, owner: string): Job | null {
  const job = jobs.get(id);
  return job && job.owner === owner ? job : null;
}
