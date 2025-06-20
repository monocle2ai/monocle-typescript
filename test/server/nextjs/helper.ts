import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { initializeTracing } from "./tracer";

const PORT = 8096;
const dev = process.env.NODE_ENV !== "production";

export class NextServer {
  private server: any;
  private app: any;
  private sdk: any;

  async start(): Promise<void> {
    console.log("Going to start Next.js server");

    try {
      this.sdk = initializeTracing();

      this.app = next({ dev, dir: __dirname });
      await this.app.prepare();

      const handle = this.app.getRequestHandler();

      this.server = createServer((req, res) => {
        const parsedUrl = parse(req.url!, true);
        handle(req, res, parsedUrl);
      });

      await new Promise<void>((resolve) => {
        this.server.listen(PORT, () => {
          console.log(`Next.js server started on port ${PORT}`);
          resolve();
        });
      });
    } catch (err) {
      console.error("Error starting Next.js server:", err);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server.close(() => {
          console.log("Next.js server stopped");
          resolve();
        });
      });
    }
  }

  getUrl(): string {
    return `http://127.0.0.1:${PORT}`;
  }
}


export function getUrl(): string {
  return `http://127.0.0.1:${PORT}`;
}
