import http from "http";
import { spawn } from "child_process";

const PORT = 3100;
const MAX_OUTPUT = 10000;
const TIMEOUT_MS = 10000;

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/exec") {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "invalid json" }));
      return;
    }

    const { language, code } = parsed;
    if (!language || !code) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "language and code required" }));
      return;
    }

    let cmd, args;
    if (language === "python") {
      cmd = "python3";
      args = ["-c", code];
    } else if (language === "javascript") {
      cmd = "node";
      args = ["-e", code];
    } else {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "unsupported language" }));
      return;
    }

    const startMs = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let done = false;

    const proc = spawn(cmd, args, {
      timeout: TIMEOUT_MS,
      env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
    });

    const killTimer = setTimeout(() => {
      if (!done) {
        timedOut = true;
        proc.kill("SIGKILL");
      }
    }, TIMEOUT_MS);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT) stdout = stdout.slice(0, MAX_OUTPUT);
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_OUTPUT) stderr = stderr.slice(0, MAX_OUTPUT);
    });

    proc.on("close", (exitCode) => {
      done = true;
      clearTimeout(killTimer);
      const durationMs = Date.now() - startMs;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        stdout: stdout.slice(0, MAX_OUTPUT),
        stderr: stderr.slice(0, MAX_OUTPUT),
        exitCode: timedOut ? -1 : (exitCode ?? -1),
        durationMs,
        timedOut,
      }));
    });

    proc.on("error", (err) => {
      done = true;
      clearTimeout(killTimer);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[sandbox] listening on :${PORT}`);
});
