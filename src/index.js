
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const config = require("./config");

const { auth, users } = require("./routes/auth");
const { routing, mappings } = require("./routes/config");

const app = express();

app.set("trust proxy", 1);

app.use(helmet());

// CORS
const allowedOrigins = config.corsOrigin
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: false,
  }),
);

app.use(express.json({ limit: "2mb" }));

// Health check: does not depend on MongoDB
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Connect to MongoDB and reuse the connection
let mongoPromise;

async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (!mongoPromise) {
    mongoPromise = mongoose.connect(config.mongoUri).catch((error) => {
      mongoPromise = null;
      throw error;
    });
  }

  await mongoPromise;
}

// Connect before handling database-dependent API routes
app.use(async (_req, res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    console.error("Mongo connection failed:", error.message);

    res.status(503).json({
      error: "Database temporarily unavailable",
    });
  }
});

// Incoming CollegeSera API
app.use("/api/v1/leads", require("./routes/ingest"));

// Admin panel API
app.use(
  "/api",
  rateLimit({
    windowMs: 60e3,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.use("/api/auth", auth);
app.use("/api/users", users);
app.use("/api/clients", require("./routes/clients"));
app.use("/api/routing", routing);
app.use("/api/mappings", mappings);
app.use("/api", require("./routes/leads"));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);

  res.status(500).json({
    error: "Something went wrong on our side",
  });
});

// Local development only; Vercel imports the exported app
if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`API listening on port ${config.port}`);
  });

  if (config.runWorkerInApi) {
    require("./worker").startWorker();
  }
}

module.exports = app;