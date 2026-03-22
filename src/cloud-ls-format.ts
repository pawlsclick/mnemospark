import { CronExpressionParser } from "cron-parser";

import {
  isStorageLsListResponse,
  type StorageLsListObject,
  type StorageLsResponse,
} from "./cloud-storage.js";
import type { CloudDatastore } from "./cloud-datastore.js";
import { formatBytesForDisplay } from "./cloud-utils.js";

const LS_NAME_DISPLAY_MAX = 72;
const LS_PAY_DISPLAY_MAX = 28;
const LS_CRON_ID_MAX = 14;
const LS_TIME_FIELD_WIDTH = 12;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** S3 object times in listings use UTC (matches backend ISO timestamps). */
function formatLsTimeFieldUtc(iso: string | undefined, now: Date): string {
  const placeholder = "         -  ".slice(0, LS_TIME_FIELD_WIDTH);
  if (!iso) {
    return placeholder.padEnd(LS_TIME_FIELD_WIDTH, " ");
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return placeholder.padEnd(LS_TIME_FIELD_WIDTH, " ");
  }
  const mon = MONTHS_SHORT[d.getUTCMonth()] ?? "???";
  const day = String(d.getUTCDate()).padStart(2, " ");
  const y = d.getUTCFullYear();
  const nowY = now.getUTCFullYear();
  let core: string;
  if (y === nowY) {
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    core = `${mon} ${day} ${hh}:${mm}`;
  } else {
    core = `${mon} ${day}  ${y}`;
  }
  return core.padEnd(LS_TIME_FIELD_WIDTH, " ");
}

function truncateEnd(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  if (max <= 1) {
    return "…";
  }
  return `${value.slice(0, max - 1)}…`;
}

function truncateMiddle(value: string, max: number, suffixMin: number): string {
  if (value.length <= max) {
    return value;
  }
  if (max < suffixMin + 5) {
    return truncateEnd(value, max);
  }
  const suffixLen = Math.min(suffixMin, max - 5);
  const prefixLen = max - 3 - suffixLen;
  return `${value.slice(0, prefixLen)} … ${value.slice(-suffixLen)}`;
}

function formatCronIdCell(cronId: string | null, width: number): string {
  if (!cronId) {
    return "         -  ".slice(0, width).padStart(width, " ");
  }
  const t = truncateEnd(cronId, width);
  return t.padStart(width, " ");
}

function formatPaymentCell(
  amount: number | null,
  network: string | null,
  maxWidth: number,
): string {
  if (amount === null) {
    return "         -  ".slice(0, maxWidth).padStart(maxWidth, " ");
  }
  let s = amount.toFixed(6).replace(/\.?0+$/, "");
  if (network && network.trim()) {
    s = `${s} (${network.trim()})`;
  }
  return truncateEnd(s, maxWidth).padStart(maxWidth, " ");
}

function formatNextCronUtc(schedule: string, cronStatus: string, now: Date): string {
  const blank = "         -  ".slice(0, LS_TIME_FIELD_WIDTH).padEnd(LS_TIME_FIELD_WIDTH, " ");
  if (cronStatus !== "active") {
    return blank;
  }
  try {
    const expr = CronExpressionParser.parse(schedule, { tz: "UTC", currentDate: now });
    const next = expr.next().toDate();
    return formatLsTimeFieldUtc(next.toISOString(), now);
  } catch {
    return "?".padEnd(LS_TIME_FIELD_WIDTH, " ");
  }
}

type PreparedLsRow = {
  perm: string;
  ln: string;
  user: string;
  grp: string;
  sizeStr: string;
  s3time: string;
  cronIdRaw: string | null;
  nextRun: string;
  payRaw: string;
  nameRaw: string;
};

async function prepareRows(
  objects: StorageLsListObject[],
  walletAddress: string,
  datastore: CloudDatastore,
  now: Date,
): Promise<PreparedLsRow[]> {
  const sorted = [...objects].sort((a, b) => {
    const ta = a.last_modified ? Date.parse(a.last_modified) : Number.NaN;
    const tb = b.last_modified ? Date.parse(b.last_modified) : Number.NaN;
    const aOk = Number.isFinite(ta);
    const bOk = Number.isFinite(tb);
    if (aOk && bOk && tb !== ta) {
      return tb - ta;
    }
    if (aOk && !bOk) {
      return -1;
    }
    if (!aOk && bOk) {
      return 1;
    }
    return a.key.localeCompare(b.key);
  });

  const rows: PreparedLsRow[] = [];
  for (const obj of sorted) {
    const friendly = await datastore.findLatestFriendlyNameForObjectKey(walletAddress, obj.key);
    const cp = await datastore.findCronAndPaymentForObjectKey(walletAddress, obj.key);
    const sizeStr = formatBytesForDisplay(obj.size_bytes);
    const s3time = formatLsTimeFieldUtc(obj.last_modified, now);
    let cronIdDisp: string | null = null;
    let nextRun = "         -  ".slice(0, LS_TIME_FIELD_WIDTH).padEnd(LS_TIME_FIELD_WIDTH, " ");
    let payCell = "";
    if (cp) {
      cronIdDisp = cp.cronId;
      nextRun = formatNextCronUtc(cp.schedule, cp.cronStatus, now);
      payCell = formatPaymentCell(cp.amount, cp.network, LS_PAY_DISPLAY_MAX);
    } else {
      payCell = formatPaymentCell(null, null, LS_PAY_DISPLAY_MAX);
    }
    const nameRaw = friendly ? `${friendly} (${obj.key})` : obj.key;
    rows.push({
      perm: "----------",
      ln: " 1",
      user: "-       ",
      grp: "-       ",
      sizeStr,
      s3time,
      cronIdRaw: cronIdDisp,
      nextRun,
      payRaw: payCell,
      nameRaw: truncateMiddle(nameRaw, LS_NAME_DISPLAY_MAX, 8),
    });
  }
  return rows;
}

function columnWidths(rows: PreparedLsRow[]): {
  sizeW: number;
  cronW: number;
  payW: number;
} {
  let sizeW = 4;
  let cronW = 4;
  let payW = 3;
  for (const r of rows) {
    sizeW = Math.max(sizeW, r.sizeStr.length);
    const cid = r.cronIdRaw ? truncateEnd(r.cronIdRaw, LS_CRON_ID_MAX) : "";
    cronW = Math.max(cronW, cid.length || 1);
    payW = Math.max(payW, r.payRaw.length);
  }
  cronW = Math.min(Math.max(cronW, 4), LS_CRON_ID_MAX);
  payW = Math.min(Math.max(payW, 3), LS_PAY_DISPLAY_MAX);
  return { sizeW, cronW, payW };
}

function renderRow(r: PreparedLsRow, w: { sizeW: number; cronW: number; payW: number }): string {
  const cronPadded = formatCronIdCell(r.cronIdRaw, w.cronW);
  const sizePadded = r.sizeStr.padStart(w.sizeW, " ");
  const payPadded = r.payRaw.padStart(w.payW, " ");
  return [
    r.perm,
    r.ln,
    r.user,
    r.grp,
    sizePadded,
    r.s3time,
    cronPadded,
    r.nextRun,
    payPadded,
    r.nameRaw,
  ].join(" ");
}

function renderHeader(w: { sizeW: number; cronW: number; payW: number }): string {
  return [
    "PERM      ",
    "LN",
    "USER    ",
    "GRP     ",
    "SIZE".padStart(w.sizeW, " "),
    "S3_TIME     ".slice(0, LS_TIME_FIELD_WIDTH).padEnd(LS_TIME_FIELD_WIDTH, " "),
    "CRON".padStart(w.cronW, " "),
    "NEXT        ".slice(0, LS_TIME_FIELD_WIDTH).padEnd(LS_TIME_FIELD_WIDTH, " "),
    "PAY".padStart(w.payW, " "),
    "NAME",
  ].join(" ");
}

export async function buildMnemosparkLsMessage(
  result: StorageLsResponse,
  ctx: {
    walletAddress: string;
    datastore: CloudDatastore;
    now?: Date;
  },
): Promise<string> {
  const now = ctx.now ?? new Date();

  if (isStorageLsListResponse(result)) {
    const disclaimer =
      "Names, cron, and payment columns come from this machine's SQLite catalog when available; `-` means unknown locally. S3 is authoritative for which keys exist.";
    const legend =
      "Legend: S3_TIME and NEXT are UTC. NEXT is the next cron fire from the stored expression.";
    const bucketLine = `bucket: ${result.bucket}`;
    const sortLine =
      "sorted by: S3 last_modified descending (missing dates last), then key ascending.";
    if (result.objects.length === 0) {
      const lines = [disclaimer, "", bucketLine, "", "No objects in this bucket."];
      return lines.join("\n");
    }
    const rows = await prepareRows(result.objects, ctx.walletAddress, ctx.datastore, now);
    const w = columnWidths(rows);
    const header = renderHeader(w);
    const bodyLines = rows.map((r) => renderRow(r, w));
    const totalLine = `total ${String(result.objects.length)}`;
    const truncLine = result.is_truncated ? "List truncated; more objects in bucket." : null;
    const prose = [disclaimer, legend, bucketLine, sortLine, totalLine, truncLine]
      .filter((x): x is string => Boolean(x))
      .join("\n");
    const fence = ["```", [header, ...bodyLines].join("\n"), "```"].join("\n");
    return `${prose}\n\n${fence}`;
  }

  const friendly = await ctx.datastore.findLatestFriendlyNameForObjectKey(
    ctx.walletAddress,
    result.key,
  );
  const cp = await ctx.datastore.findCronAndPaymentForObjectKey(ctx.walletAddress, result.key);
  const sizeStr = formatBytesForDisplay(result.size_bytes);
  const s3time = formatLsTimeFieldUtc(undefined, now);
  let payCell = formatPaymentCell(null, null, LS_PAY_DISPLAY_MAX);
  let cronIdDisp: string | null = null;
  let nextRun = "         -  ".slice(0, LS_TIME_FIELD_WIDTH).padEnd(LS_TIME_FIELD_WIDTH, " ");
  if (cp) {
    cronIdDisp = cp.cronId;
    nextRun = formatNextCronUtc(cp.schedule, cp.cronStatus, now);
    payCell = formatPaymentCell(cp.amount, cp.network, LS_PAY_DISPLAY_MAX);
  }
  const nameShown = truncateMiddle(
    friendly ? `${friendly} (${result.key})` : result.key,
    LS_NAME_DISPLAY_MAX,
    8,
  );
  const prep: PreparedLsRow = {
    perm: "----------",
    ln: " 1",
    user: "-       ",
    grp: "-       ",
    sizeStr,
    s3time,
    cronIdRaw: cronIdDisp,
    nextRun,
    payRaw: payCell,
    nameRaw: nameShown,
  };
  const w = columnWidths([prep]);
  const header = renderHeader(w);
  const line = renderRow(prep, w);
  const disclaimer =
    "Names, cron, and payment columns come from this machine's SQLite catalog when available; `-` means unknown locally.";
  const legend = "Legend: S3_TIME and NEXT are UTC.";
  const prose = [disclaimer, legend, `bucket: ${result.bucket}`, ""].join("\n");
  const fence = ["```", [header, line].join("\n"), "```"].join("\n");
  return `${prose}\n${fence}`;
}
