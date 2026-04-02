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

/** Data column width for S3 last-modified (UTC). */
const LS_S3_COL_WIDTH = 12;
/** Fits header "NEXT PAYMENT DATE" and time cells. */
const LS_NEXT_COL_WIDTH = Math.max(LS_S3_COL_WIDTH, "NEXT PAYMENT DATE".length);

const HDR_SIZE = "SIZE";
const HDR_S3_TIME = "S3_TIME";
const HDR_CRON_JOB = "CRON JOB";
const HDR_NEXT_PAYMENT = "NEXT PAYMENT DATE";
const HDR_AMOUNT_DUE = "AMOUNT DUE";
const HDR_FILE_OR_KEY = "FILE NAME OR OBJECT-KEY";

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
function formatLsTimeFieldUtc(
  iso: string | undefined,
  now: Date,
  fieldWidth: number = LS_S3_COL_WIDTH,
): string {
  const placeholder = "         -  ".slice(0, fieldWidth);
  if (!iso) {
    return placeholder.padEnd(fieldWidth, " ");
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return placeholder.padEnd(fieldWidth, " ");
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
  return core.padEnd(fieldWidth, " ");
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
  const blank = "         -  ".slice(0, LS_NEXT_COL_WIDTH).padEnd(LS_NEXT_COL_WIDTH, " ");
  if (cronStatus !== "active") {
    return blank;
  }
  try {
    const expr = CronExpressionParser.parse(schedule, { tz: "UTC", currentDate: now });
    const next = expr.next().toDate();
    return formatLsTimeFieldUtc(next.toISOString(), now, LS_NEXT_COL_WIDTH);
  } catch {
    return "?".padEnd(LS_NEXT_COL_WIDTH, " ");
  }
}

type PreparedLsRow = {
  sizeStr: string;
  s3time: string;
  cronIdRaw: string | null;
  nextRun: string;
  payRaw: string;
  nameRaw: string;
};

function buildLsProseIntro(bucket: string): string[] {
  return [
    "☁️ mnemospark cloud",
    `Folder: ${bucket}`,
    "The columns: CRON JOB, NEXT PAYMENT DATE, AMOUNT DUE, FILE NAME are from this host's mnemospark SQLite catalog",
    "mnemospark cloud only stores the OBJECT-KEY for privacy",
  ];
}

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
    const s3time = formatLsTimeFieldUtc(obj.last_modified, now, LS_S3_COL_WIDTH);
    let cronIdDisp: string | null = null;
    let nextRun = "         -  ".slice(0, LS_NEXT_COL_WIDTH).padEnd(LS_NEXT_COL_WIDTH, " ");
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

type ColWidths = { sizeW: number; s3W: number; cronW: number; nextW: number; payW: number };

function columnWidths(rows: PreparedLsRow[]): ColWidths {
  let sizeW = HDR_SIZE.length;
  let s3W = Math.max(LS_S3_COL_WIDTH, HDR_S3_TIME.length);
  let nextW = LS_NEXT_COL_WIDTH;
  let cronW = HDR_CRON_JOB.length;
  let payW = HDR_AMOUNT_DUE.length;
  for (const r of rows) {
    sizeW = Math.max(sizeW, r.sizeStr.length);
    s3W = Math.max(s3W, r.s3time.length);
    nextW = Math.max(nextW, r.nextRun.length);
    const cid = r.cronIdRaw ? truncateEnd(r.cronIdRaw, LS_CRON_ID_MAX) : "";
    cronW = Math.max(cronW, cid.length || 1);
    payW = Math.max(payW, r.payRaw.length);
  }
  cronW = Math.min(Math.max(cronW, HDR_CRON_JOB.length), LS_CRON_ID_MAX);
  payW = Math.min(Math.max(payW, HDR_AMOUNT_DUE.length), LS_PAY_DISPLAY_MAX);
  return { sizeW, s3W, cronW, nextW, payW };
}

function renderRow(r: PreparedLsRow, w: ColWidths): string {
  const cronPadded = formatCronIdCell(r.cronIdRaw, w.cronW);
  return [
    r.sizeStr.padStart(w.sizeW, " "),
    r.s3time.padEnd(w.s3W, " "),
    cronPadded,
    r.nextRun.padEnd(w.nextW, " "),
    r.payRaw.padStart(w.payW, " "),
    r.nameRaw,
  ].join(" ");
}

function renderHeader(w: ColWidths): string {
  return [
    HDR_SIZE.padStart(w.sizeW, " "),
    HDR_S3_TIME.padEnd(w.s3W, " "),
    HDR_CRON_JOB.padStart(w.cronW, " "),
    HDR_NEXT_PAYMENT.padEnd(w.nextW, " "),
    HDR_AMOUNT_DUE.padStart(w.payW, " "),
    HDR_FILE_OR_KEY,
  ].join(" ");
}

/** Markdown fenced block for a single copy-paste command line (matches upload/ls table style). */
function formatLsCommandCopyBlock(commandLine: string): string {
  return ["```", commandLine, "```"].join("\n");
}

function formatLsWhatsNextFooter(walletAddress: string): string {
  const downloadLine = `/mnemospark cloud download wallet-address:${walletAddress} [object-key:<object-key> | name:<friendly-name>] [latest:true|at:<timestamp>] [async:true] [orchestrator:<inline|subagent>] [timeout-seconds:<n>]`;
  const deleteLine = `/mnemospark cloud delete wallet-address:${walletAddress} [object-key:<object-key> | name:<friendly-name>] [latest:true|at:<timestamp>]`;
  return [
    "What's next? Would you like to download or delete a file:",
    "",
    formatLsCommandCopyBlock(downloadLine),
    "",
    formatLsCommandCopyBlock(deleteLine),
  ].join("\n");
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
    const intro = buildLsProseIntro(result.bucket);
    if (result.objects.length === 0) {
      return [...intro, "", "No objects in this bucket."].join("\n");
    }
    const rows = await prepareRows(result.objects, ctx.walletAddress, ctx.datastore, now);
    const w = columnWidths(rows);
    const header = renderHeader(w);
    const bodyLines = rows.map((r) => renderRow(r, w));
    const truncLine = result.is_truncated ? "List truncated; more objects in bucket." : null;
    const prose = [...intro, ...(truncLine ? [truncLine] : [])].join("\n");
    const fence = ["```", [header, ...bodyLines].join("\n"), "```"].join("\n");
    return `${prose}\n\n${fence}\n\n${formatLsWhatsNextFooter(ctx.walletAddress)}`;
  }

  const friendly = await ctx.datastore.findLatestFriendlyNameForObjectKey(
    ctx.walletAddress,
    result.key,
  );
  const cp = await ctx.datastore.findCronAndPaymentForObjectKey(ctx.walletAddress, result.key);
  const sizeStr = formatBytesForDisplay(result.size_bytes);
  const s3time = formatLsTimeFieldUtc(undefined, now, LS_S3_COL_WIDTH);
  let payCell = formatPaymentCell(null, null, LS_PAY_DISPLAY_MAX);
  let cronIdDisp: string | null = null;
  let nextRun = "         -  ".slice(0, LS_NEXT_COL_WIDTH).padEnd(LS_NEXT_COL_WIDTH, " ");
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
  const prose = buildLsProseIntro(result.bucket).join("\n");
  const fence = ["```", [header, line].join("\n"), "```"].join("\n");
  return `${prose}\n\n${fence}\n\n${formatLsWhatsNextFooter(ctx.walletAddress)}`;
}
