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
