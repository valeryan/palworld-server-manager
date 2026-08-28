import { NextResponse } from "next/server";
const fs = require("fs");
const dbm = require("@/lib/db");
const ra = require("@/lib/remoteauth");
const { P } = require("@/lib/paths");
const { lanAddresses } = require("@/lib/netinfo");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_PORT = 4317;

// The port the manager UI is actually reachable on = the port of the incoming request.
function managerPort(req) {
  try {
    const host = req.headers.get("host") || "";
    const p = host.split(":")[1];
    if (p) return Number(p);
  } catch {}
  return DEFAULT_PORT;
}

function urls(req) {
  const port = managerPort(req);
  const local = `http://127.0.0.1:${port}/remote`;
  const lan = lanAddresses().map((a) => ({
    address: a.address, primary: a.primary, url: `http://${a.address}:${port}/remote`,
  }));
  return { port, local, lan };
}

// Mirror the LAN-bind choice into a marker file electron/main.js reads at (re)start to
// pick 127.0.0.1 (loopback) vs 0.0.0.0 (LAN-reachable). The DB setting is the source of
// truth; this keeps main.js from needing to open sqlite before the server is up.
function writeBindMarker(lan) {
  try { fs.writeFileSync(P.remoteBind(), JSON.stringify({ host: lan ? "0.0.0.0" : "127.0.0.1" }), "utf8"); }
  catch { /* non-fatal — main.js falls back to loopback */ }
}

// Same idea for the chosen port: main.js reads this marker at (re)start to bind the server.
function writePortMarker(port) {
  try { fs.writeFileSync(P.remotePort(), JSON.stringify({ port }), "utf8"); }
  catch { /* non-fatal — main.js falls back to the default port */ }
}

function state(req) {
  return {
    enabled: ra.isEnabled(),
    lanBind: ra.lanBindEnabled(),
    // The port electron will bind on the next (re)start — what the input should show, and
    // which may differ from the port this request came in on until that restart happens.
    configuredPort: ra.managerPort(),
    // In a dev build the server is pinned by `next dev -p` and Electron doesn't own it, so a
    // port change can't take effect (even across restarts) — the UI uses this to say so
    // rather than telling the user to restart, which wouldn't help here.
    dev: process.env.NODE_ENV !== "production",
    ...urls(req),
  };
}

export async function GET(req) {
  if (!ra.requireAdmin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  return NextResponse.json({ ok: true, ...state(req) });
}

export async function POST(req) {
  if (!ra.requireAdmin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  let b = {};
  try { b = await req.json(); } catch {}

  let enabledNow = false;
  if ("enabled" in b) { ra.setEnabled(!!b.enabled); enabledNow = !!b.enabled; }
  if ("lanBind" in b) { ra.setLanBind(!!b.lanBind); writeBindMarker(!!b.lanBind); }
  if ("port" in b) {
    // Reject an out-of-range port up front so the user sees why, rather than silently
    // clamping to the default and leaving them puzzled.
    const n = Number(b.port);
    if (!Number.isInteger(n) || n < 1024 || n > 65535) {
      return NextResponse.json({ ok: false, error: "Port must be a whole number between 1024 and 65535." }, { status: 400 });
    }
    const saved = ra.setManagerPort(n);
    writePortMarker(saved);
  }

  const res = NextResponse.json({ ok: true, ...state(req) });
  // The session that enables Remote Access must stay trusted afterwards: hand it the admin
  // cookie so it isn't locked out the instant the token check turns on.
  if (enabledNow) { ra.ensureAdminToken(); ra.setAdminCookie(res, req); }
  return res;
}
