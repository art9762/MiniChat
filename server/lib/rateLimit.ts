import rateLimit from "express-rate-limit";

const common = {
  standardHeaders: true,
  legacyHeaders: false,
};

export const loginLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 5,
  message: { error: "too many login attempts, slow down" },
});

export const registerLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60_000,
  limit: 10,
  message: { error: "too many registrations from this IP" },
});

export const redeemLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60_000,
  limit: 20,
  message: { error: "too many redeem attempts" },
});

export const chatLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 30,
  // limit per authenticated user when available, otherwise per IP
  keyGenerator: (req: any) => req.user?.id || req.ip,
  message: { error: "rate limit: 30 chat requests/minute" },
});

// Agent CLI inside a container can loop — cap proxy calls per workspace token / IP.
export const agentProxyLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 120,
  keyGenerator: (req: any) => req.header("x-api-key") || req.ip,
  message: { error: "rate limit: agent proxy 120 req/minute" },
});

// File operations on the workspace (listing, content, mutations).
export const filesLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 120,
  keyGenerator: (req: any) => req.user?.id || req.ip,
  message: { error: "rate limit: 120 file ops/minute" },
});
