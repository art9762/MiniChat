import type { Request, Response, NextFunction } from "express";

// Lightweight CSRF guard for friends-scope deployment:
// any state-changing request must carry a custom header that browsers
// will only send via fetch/XHR (CORS preflight-gated). Pure HTML form
// CSRF cannot set custom headers, so this blocks classic CSRF without
// the complexity of a token store. Keep paired with SameSite=Lax cookies
// and a strict CORS allow-list.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const REQUIRED_HEADER = "x-requested-with";
const REQUIRED_VALUE = "minichat";

export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const v = req.header(REQUIRED_HEADER);
  if (v && v.toLowerCase() === REQUIRED_VALUE) return next();
  return res.status(403).json({ error: "csrf: missing or invalid X-Requested-With header" });
}
