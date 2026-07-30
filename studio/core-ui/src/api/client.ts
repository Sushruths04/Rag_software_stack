/**
 * Typed client for the studio backend (studio/backend/api.py).
 *
 * Every function returns an ``ApiResult<T>`` instead of throwing, so a
 * caller never needs a try/catch to stay safe — the static demo (no
 * backend running) must keep working, so a network failure or a non-2xx
 * response is a normal, handled outcome here, not an exception.
 *
 * Requests are relative (``/api/...``) so the same code works in dev (via
 * the Vite proxy configured in vite.config.ts, which forwards to the
 * backend's default `uvicorn ... --port 8100`), in `vite preview`, and in
 * any production deployment that fronts both apps behind one origin. Set
 * ``VITE_API_BASE_URL`` to point at a different backend origin instead.
 */
import type { GraphDoc } from "../types/graph";
import { stripGraphForApi } from "../utils/toFlow";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

// B-M2: the desktop shell negotiates its engine sidecar's port at runtime
// (see useEngineSidecar), so the base URL can't be a build-time constant
// there — App.tsx calls setApiBaseUrl once the sidecar reports "ready".
// Everywhere else (browser/Plan-A, tests) this stays whatever
// VITE_API_BASE_URL resolved to at build time (usually "", relying on
// Vite's dev proxy).
let BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export function setApiBaseUrl(url: string): void {
  BASE_URL = url;
}

function apiUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), init);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body === "string" ? body : JSON.stringify(body);
    } catch {
      // no JSON body — fall through with just the status
    }
    return { ok: false, error: `HTTP ${res.status}${detail ? `: ${detail}` : ""}` };
  }

  try {
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: `invalid JSON response: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function postJson(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ---- registry -------------------------------------------------------------

export interface ApiPortSpec {
  name: string;
  type: string;
  multi: boolean;
  required: boolean;
}

export interface ApiBlockSpec {
  type: string;
  category: string;
  cost: "free" | "paid";
  inputs: ApiPortSpec[];
  outputs: ApiPortSpec[];
  params_schema: {
    properties?: Record<string, { default?: unknown; title?: string; type?: string }>;
    [key: string]: unknown;
  };
  locked_params: string[];
  estimate: boolean;
}

export interface BlocksResponse {
  blocks: ApiBlockSpec[];
}

export function getBlocks(): Promise<ApiResult<BlocksResponse>> {
  return request<BlocksResponse>("/api/blocks");
}

// ---- validate ---------------------------------------------------------------

export interface ApiGraphError {
  code: string;
  message: string;
  severity: "error" | "warning";
  block_id?: string | null;
  wire_id?: string | null;
  autofix?: Record<string, unknown> | null;
}

export interface ValidateResponse {
  valid: boolean;
  order: string[];
  errors: ApiGraphError[];
  warnings: ApiGraphError[];
  cost: { total_calls: number; paid_blocks: unknown[] } | null;
}

export function validateGraph(graph: GraphDoc): Promise<ApiResult<ValidateResponse>> {
  return request<ValidateResponse>("/api/graphs/validate", postJson(stripGraphForApi(graph)));
}

// ---- persistence --------------------------------------------------------

export interface SavedGraphResponse {
  id: string;
  graph: GraphDoc;
}

export interface GraphSummary {
  id: string;
  name: string;
  modified: string;
}

export interface ListGraphsResponse {
  graphs: GraphSummary[];
}

export function saveGraph(graph: GraphDoc): Promise<ApiResult<SavedGraphResponse>> {
  return request<SavedGraphResponse>("/api/graphs", postJson(stripGraphForApi(graph)));
}

export function loadGraph(id: string): Promise<ApiResult<SavedGraphResponse>> {
  return request<SavedGraphResponse>(`/api/graphs/${encodeURIComponent(id)}`);
}

export function listGraphs(): Promise<ApiResult<ListGraphsResponse>> {
  return request<ListGraphsResponse>("/api/graphs");
}

// ---- run ------------------------------------------------------------------

/** One typed fake/real artifact, matching studio/backend/stubs.py's
 * ``{"type", "ref", "meta"}`` convention. A ``ref`` prefixed ``"stub:"`` is a
 * fabricated placeholder — see utils/runFormat.ts's honesty-marker logic. */
export interface ApiArtifact {
  type: string;
  ref: string;
  meta: Record<string, unknown>;
}

export interface ApiBlockEvent {
  block_id: string;
  type: "block_started" | "block_finished" | "block_failed" | "block_skipped_cache";
  payload: Record<string, unknown>;
}

export interface RunResult {
  ok: boolean;
  failed_block: string | null;
  order: string[];
  events: ApiBlockEvent[];
  artifacts: Record<string, Record<string, ApiArtifact>>;
}

/** One PAID block's estimated cost, from the backend's compiler cost
 * roll-up (studio/backend/stubs.py's ``CostEstimate``). ``usd`` is ``null``
 * when the estimator only knows a call count, not a $/call price — never
 * fabricated on the frontend either. */
export interface PaidBlockEstimate {
  block_id: string;
  type: string;
  calls: number;
  usd: number | null;
  note: string;
}

/** POST /api/graphs/run's 402 response (05_BLOCK_CATALOG.md §2 spend gate):
 * the graph has PAID blocks and ``confirm_paid`` was not ``true``, so
 * nothing executed. */
export interface RunConfirmationRequired {
  ok: false;
  requiresConfirmation: true;
  paidBlocks: string[];
  estimated: PaidBlockEstimate[];
}

/**
 * ``networkError`` distinguishes the two ways a run can fail without
 * requiring paid-spend confirmation:
 *  - ``true``  — the ``fetch`` itself failed (connection refused, DNS,
 *    timeout, ...): no HTTP response was ever received, so the backend is
 *    genuinely unreachable. This is the ONLY case ``handleRun`` may fall
 *    back to the simulated/offline demo for.
 *  - ``false`` — an HTTP response WAS received (any status, including a
 *    rejection like 400 or a 5xx), so the backend is reachable and actively
 *    responded. Falling back to a fake demo here would hide a real
 *    rejection behind fabricated success data — ``handleRun`` must surface
 *    ``error`` to the user instead.
 */
export type RunApiResult =
  | { ok: true; data: RunResult; requiresConfirmation?: false }
  | { ok: false; error: string; requiresConfirmation?: false; networkError: boolean }
  | RunConfirmationRequired;

/**
 * POST /api/graphs/run. ``useStubs`` defaults to ``true``, matching the
 * backend's own default (the safe, zero-``rag_gt``-import path); the real
 * Run button explicitly requests ``useStubs: false`` to exercise the live
 * FREE-spine adapters where the graph has them.
 *
 * ``confirmPaid`` is left out of the posted body entirely unless explicitly
 * passed (rather than defaulting it to ``false`` in the body), so a plain
 * ``runGraph(graph)`` call posts byte-identical JSON to before this option
 * existed. Pass ``confirmPaid: true`` only after the caller has shown the
 * user a cost sheet (see ``CostConfirmSheet``) built from a prior call's
 * ``RunConfirmationRequired`` result.
 */
export function runGraph(
  graph: GraphDoc,
  opts: { useStubs?: boolean; confirmPaid?: boolean } = {},
): Promise<RunApiResult> {
  const useStubs = opts.useStubs ?? true;
  const body: Record<string, unknown> = { ...stripGraphForApi(graph) };
  if (opts.confirmPaid !== undefined) {
    body.confirm_paid = opts.confirmPaid;
  }
  return runRequest(`/api/graphs/run?use_stubs=${useStubs}`, body);
}

async function runRequest(path: string, body: unknown): Promise<RunApiResult> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), postJson(body));
  } catch (err) {
    // No HTTP response was ever received — this is the one genuine
    // "backend unreachable" case (see the RunApiResult doc comment above).
    return { ok: false, error: err instanceof Error ? err.message : String(err), networkError: true };
  }

  if (res.status === 402) {
    try {
      const data = (await res.json()) as { paid_blocks?: string[]; estimated?: PaidBlockEstimate[] };
      return {
        ok: false,
        requiresConfirmation: true,
        paidBlocks: data.paid_blocks ?? [],
        estimated: data.estimated ?? [],
      };
    } catch (err) {
      return { ok: false, error: `invalid JSON response: ${err instanceof Error ? err.message : String(err)}`, networkError: false };
    }
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body === "string" ? body : JSON.stringify(body);
    } catch {
      // no JSON body — fall through with just the status
    }
    // The backend WAS reached and actively rejected the request — a real
    // response, not a network failure. See the RunApiResult doc comment.
    return { ok: false, error: `HTTP ${res.status}${detail ? `: ${detail}` : ""}`, networkError: false };
  }

  try {
    const data = (await res.json()) as RunResult;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: `invalid JSON response: ${err instanceof Error ? err.message : String(err)}`, networkError: false };
  }
}
