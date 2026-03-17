export const MNEMOSPARK_TRACE_ID_HEADER = "X-Mnemospark-Trace-Id";
export const MNEMOSPARK_OPERATION_ID_HEADER = "X-Mnemospark-Operation-Id";

export type RequestCorrelation = {
  traceId?: string;
  operationId?: string;
};

export function applyCorrelationHeaders(
  headers: Record<string, string>,
  correlation?: RequestCorrelation,
): Record<string, string> {
  const traceId = correlation?.traceId?.trim();
  if (traceId) {
    headers[MNEMOSPARK_TRACE_ID_HEADER] = traceId;
  }

  const operationId = correlation?.operationId?.trim();
  if (operationId) {
    headers[MNEMOSPARK_OPERATION_ID_HEADER] = operationId;
  }

  return headers;
}
