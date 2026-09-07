import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

/**
 * CSP violation sink.
 *
 * The site serves Content-Security-Policy-Report-ONLY with no report-uri, so
 * violations have been going to each visitor's browser console and nowhere
 * else. Nobody has ever seen one. Before that policy can be switched to
 * enforcing on a site taking card payments, somebody has to know what it would
 * break — and the answer has to come from real traffic, especially a real
 * checkout, not from guesswork.
 *
 * THIS ENDPOINT IS UNAUTHENTICATED BY NECESSITY. Browsers post violation
 * reports with no credentials, so it cannot be gated. Everything arriving is
 * therefore treated as hostile: the body is capped, the fields are truncated,
 * the file is capped, and only a fixed allowlist of keys is ever written.
 *
 * WHAT IS DELIBERATELY NOT STORED: `script-sample`, because it can contain
 * page content; and any IP address, cookie, user agent or request header. A
 * violation sink is a diagnostic, not an analytics pipeline.
 */

const MAX_BODY_CHARS = 65536;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FIELD_LEN = 500;

// Read per-call, NOT at module scope: a module-scope read is frozen at import
// and cannot be changed without a restart, which also makes it untestable.
function reportFile(): string {
  return process.env.CSP_REPORT_FILE || path.join(process.cwd(), "data", "csp-reports.jsonl");
}

function truncate(value: unknown): string {
  if (value == null) return "";
  return String(value).slice(0, MAX_FIELD_LEN);
}

/** Browsers send two different shapes. Accept both, emit one. */
function normalizeReports(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== "object") return [];

  // Legacy report-uri: { "csp-report": { ... } }
  if ("csp-report" in raw) {
    const report = (raw as Record<string, unknown>)["csp-report"];
    if (report && typeof report === "object" && !Array.isArray(report)) {
      return [report as Record<string, unknown>];
    }
    return [];
  }

  // Reporting API: [{ body: { ... } }, ...]
  if (Array.isArray(raw)) {
    const reports: Record<string, unknown>[] = [];
    for (const item of raw) {
      if (item && typeof item === "object" && "body" in item) {
        const body = (item as Record<string, unknown>)["body"];
        if (body && typeof body === "object" && !Array.isArray(body)) {
          reports.push(body as Record<string, unknown>);
        }
      }
    }
    return reports;
  }

  return [];
}

/**
 * Built key by key from a fixed list, never by copying the incoming object.
 * A spread here would mean any field a browser invents tomorrow lands on our
 * disk without anyone deciding it should.
 */
function buildRecord(report: Record<string, unknown>): string {
  return JSON.stringify({
    blockedUri: truncate(report["blocked-uri"]),
    violatedDirective: truncate(report["violated-directive"] || report["effective-directive"]),
    documentUri: truncate(report["document-uri"]),
    disposition: truncate(report.disposition),
    statusCode: truncate(report["status-code"]),
    lineNumber: truncate(report["line-number"]),
    sourceFile: truncate(report["source-file"]),
    receivedAt: new Date().toISOString(),
  });
}

async function appendReport(record: string): Promise<void> {
  const file = reportFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, record + "\n", "utf8");
}

export async function POST(req: Request): Promise<Response> {
  try {
    const text = await req.text();

    if (text.length > MAX_BODY_CHARS) {
      return new Response(null, { status: 413 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // A malformed body is not worth an error page, and telling a caller its
      // JSON was bad is telling it something it can probe with.
      return new Response(null, { status: 204 });
    }

    const reports = normalizeReports(parsed);

    if (reports.length > 0) {
      try {
        const stat = await fs.stat(reportFile());
        if (stat.size > MAX_FILE_BYTES) {
          // Stop growing rather than fill the disk. An unauthenticated
          // append-to-disk endpoint is otherwise a denial-of-service primitive.
          return new Response(null, { status: 204 });
        }
      } catch {
        // File does not exist yet - that is the normal first-report case.
      }

      for (const report of reports) {
        await appendReport(buildRecord(report));
      }
    }

    // Always 204, success or not. A browser can do nothing useful with an
    // error here, and a probe should learn nothing from the difference.
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[csp-report] unexpected error:", err);
    return new Response(null, { status: 204 });
  }
}
