import r2 from "@convex-dev/r2/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(rateLimiter);
app.use(r2);

export default app;
