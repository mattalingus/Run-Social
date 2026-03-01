import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import multer from "multer";
import * as storage from "./storage";
import { generateDummyRuns, clearAndReseedRuns, getRunCount } from "./seed";
import { uploadPhotoBuffer, streamObject } from "./objectStorage";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

const PgStore = connectPgSimple(session);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function requireAuth(req: Request, res: Response, next: Function) {
  if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {
  await storage.initDb();

  const runCount = await getRunCount();
  if (runCount === 0) {
    await generateDummyRuns(15);
    console.log("[seed] Inserted 15 dummy runs for Houston");
  }

  app.use(
    session({
      store: new PgStore({ pool, createTableIfMissing: true }),
      secret: process.env.SESSION_SECRET || "paceup-secret-key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      },
    })
  );

  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password || !name) return res.status(400).json({ message: "All fields required" });
      if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(400).json({ message: "Email already in use" });
      const user = await storage.createUser({ email, password, name });
      req.session.userId = user.id;
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ message: "Email and password required" });
      const user = await storage.getUserByEmail(email);
      if (!user) return res.status(401).json({ message: "Invalid credentials" });
      const valid = await storage.verifyPassword(password, user.password);
      if (!valid) return res.status(401).json({ message: "Invalid credentials" });
      req.session.userId = user.id;
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const user = await storage.getUserById(req.session.userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    const { password: _, ...safeUser } = user;
    res.json(safeUser);
  });

  app.put("/api/users/me", requireAuth, async (req, res) => {
    try {
      const allowed = ["name", "avgPace", "avgDistance", "photoUrl", "notificationsEnabled"];
      const updates: Record<string, any> = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      const user = await storage.updateUser(req.session.userId!, updates);
      if (!user) return res.status(404).json({ message: "User not found" });
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/users/me/goals", requireAuth, async (req, res) => {
    try {
      const { monthlyGoal, yearlyGoal } = req.body;
      await storage.updateGoals(req.session.userId!, monthlyGoal, yearlyGoal);
      const user = await storage.getUserById(req.session.userId!);
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/users/me/achievements", requireAuth, async (req, res) => {
    const achievements = await storage.getUserAchievements(req.session.userId!);
    res.json(achievements);
  });

  app.get("/api/users/me/unlock-progress", requireAuth, async (req, res) => {
    const progress = await storage.getHostUnlockProgress(req.session.userId!);
    res.json(progress);
  });

  app.get("/api/runs", async (req, res) => {
    try {
      const filters: any = {};
      if (req.query.minPace) filters.minPace = parseFloat(req.query.minPace as string);
      if (req.query.maxPace) filters.maxPace = parseFloat(req.query.maxPace as string);
      if (req.query.minDistance) filters.minDistance = parseFloat(req.query.minDistance as string);
      if (req.query.maxDistance) filters.maxDistance = parseFloat(req.query.maxDistance as string);
      if (req.query.tag) filters.tag = req.query.tag as string;
      if (req.query.styles) {
        const raw = req.query.styles as string;
        filters.styles = raw.split(",").map(s => s.trim()).filter(Boolean);
      }
      if (req.query.swLat) filters.swLat = parseFloat(req.query.swLat as string);
      if (req.query.swLng) filters.swLng = parseFloat(req.query.swLng as string);
      if (req.query.neLat) filters.neLat = parseFloat(req.query.neLat as string);
      if (req.query.neLng) filters.neLng = parseFloat(req.query.neLng as string);
      const runs = await storage.getPublicRuns(filters);
      res.json(runs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/runs/mine", requireAuth, async (req, res) => {
    try {
      const runs = await storage.getUserRuns(req.session.userId!);
      res.json(runs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user?.host_unlocked) return res.status(403).json({ message: "Host privileges required" });
      const run = await storage.createRun({ ...req.body, hostId: req.session.userId! });
      res.status(201).json(run);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/runs/:id", async (req, res) => {
    const run = await storage.getRunById(req.params.id);
    if (!run) return res.status(404).json({ message: "Run not found" });
    res.json(run);
  });

  app.get("/api/runs/:id/participants", async (req, res) => {
    const participants = await storage.getRunParticipants(req.params.id);
    res.json(participants);
  });

  app.post("/api/runs/:id/join", requireAuth, async (req, res) => {
    try {
      const run = await storage.getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id === req.session.userId) return res.status(400).json({ message: "You are the host" });
      const user = await storage.getUserById(req.session.userId!);
      if (user.avg_pace < run.min_pace || user.avg_pace > run.max_pace) {
        return res.status(400).json({ message: `Your pace (${user.avg_pace} min/mi) doesn't match run requirements (${run.min_pace}–${run.max_pace} min/mi)` });
      }
      if (user.avg_distance < run.min_distance) {
        return res.status(400).json({ message: `Your average distance (${user.avg_distance} mi) is below minimum (${run.min_distance} mi)` });
      }
      const participant = await storage.joinRun(req.params.id, req.session.userId!);
      res.json(participant);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/leave", requireAuth, async (req, res) => {
    await storage.leaveRun(req.params.id, req.session.userId!);
    res.json({ success: true });
  });

  app.post("/api/runs/:id/complete", requireAuth, async (req, res) => {
    try {
      const { milesLogged } = req.body;
      const miles = parseFloat(milesLogged) || 3;
      const result = await storage.confirmRunCompletion(req.params.id, req.session.userId!, miles);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/runs/:id/my-rating", requireAuth, async (req, res) => {
    const rating = await storage.getUserRatingForRun(req.params.id, req.session.userId!);
    res.json(rating);
  });

  app.post("/api/runs/:id/rate", requireAuth, async (req, res) => {
    try {
      const run = await storage.getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      const participated = await storage.isParticipant(req.params.id, req.session.userId!);
      if (!participated && run.host_id !== req.session.userId) {
        return res.status(403).json({ message: "Only participants can rate" });
      }
      const { stars, tags } = req.body;
      if (!stars || stars < 1 || stars > 5) return res.status(400).json({ message: "Stars must be 1-5" });
      const result = await storage.rateHost({ runId: req.params.id, hostId: run.host_id, raterId: req.session.userId!, stars, tags: tags || [] });
      res.json(result);
    } catch (e: any) {
      if (e.message === "Already rated this run") return res.status(400).json({ message: e.message });
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/users/me/marker-icon", requireAuth, async (req, res) => {
    try {
      const { icon } = req.body;
      await storage.updateMarkerIcon(req.session.userId!, icon ?? null);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/solo-runs", requireAuth, async (req, res) => {
    try {
      const runs = await storage.getSoloRuns(req.session.userId!);
      res.json(runs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/solo-runs", requireAuth, async (req, res) => {
    try {
      const { title, date, distanceMiles, paceMinPerMile, durationSeconds, completed, planned, notes } = req.body;
      if (!date || !distanceMiles) return res.status(400).json({ message: "date and distanceMiles required" });
      const run = await storage.createSoloRun({
        userId: req.session.userId!,
        title,
        date,
        distanceMiles: parseFloat(distanceMiles),
        paceMinPerMile: paceMinPerMile ? parseFloat(paceMinPerMile) : null,
        durationSeconds: durationSeconds ? parseInt(durationSeconds) : null,
        completed: !!completed,
        planned: !!planned,
        notes,
      });
      res.status(201).json(run);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/solo-runs/:id", requireAuth, async (req, res) => {
    try {
      const run = await storage.updateSoloRun(req.params.id, req.session.userId!, req.body);
      if (!run) return res.status(404).json({ message: "Run not found" });
      res.json(run);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/solo-runs/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteSoloRun(req.params.id, req.session.userId!);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/users/me/solo-goals", requireAuth, async (req, res) => {
    try {
      const { paceGoal, distanceGoal, goalPeriod } = req.body;
      await storage.updateSoloGoals(
        req.session.userId!,
        paceGoal != null ? parseFloat(paceGoal) : null,
        parseFloat(distanceGoal) || 100,
        goalPeriod || "monthly"
      );
      const user = await storage.getUserById(req.session.userId!);
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Photo upload ────────────────────────────────────────────────────────────

  app.post("/api/upload/photo", requireAuth, upload.single("photo"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No photo provided" });
      const ext = (req.file.originalname.split(".").pop() || "jpg").toLowerCase();
      const filename = `${req.session.userId}-${Date.now()}.${ext}`;
      const url = await uploadPhotoBuffer(req.file.buffer, filename, req.file.mimetype);
      res.json({ url });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Serve object storage files ───────────────────────────────────────────────

  app.get(/^\/api\/objects\/(.+)$/, async (req: any, res) => {
    try {
      const objectPath = req.params[0];
      const { stream, contentType } = await streamObject(objectPath);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=31536000");
      stream.pipe(res);
      stream.on("error", () => res.status(404).json({ message: "Not found" }));
    } catch (e: any) {
      res.status(404).json({ message: "Not found" });
    }
  });

  app.post("/api/admin/seed-runs", async (req, res) => {
    try {
      const { count = 20 } = req.body;
      await clearAndReseedRuns(count);
      res.json({ success: true, message: `Generated ${count} runs` });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
