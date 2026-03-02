import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import multer from "multer";
import * as storage from "./storage";
import { generateDummyRuns, clearAndReseedRuns, getRunCount } from "./seed";
import { uploadPhotoBuffer, streamObject } from "./objectStorage";
import { sendPushNotification } from "./notifications";

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
      const { email, password, firstName, lastName, username } = req.body;
      if (!email || !password || !firstName || !lastName || !username) return res.status(400).json({ message: "All fields required" });
      if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ message: "Username can only contain letters, numbers, and underscores" });
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(400).json({ message: "Email already in use" });
      const existingUsername = await storage.getUserByUsername(username);
      if (existingUsername) return res.status(400).json({ message: "Username already taken" });
      const name = `${firstName.trim()} ${lastName.trim()}`;
      const user = await storage.createUser({ email, password, name, username });
      req.session.userId = user.id;
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { identifier, password } = req.body;
      if (!identifier || !password) return res.status(400).json({ message: "Username/email and password required" });
      const user = await storage.getUserByEmailOrUsername(identifier.trim());
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

  app.post("/api/users/me/push-token", requireAuth, async (req, res) => {
    try {
      const { token } = req.body;
      await storage.updatePushToken(req.session.userId!, token ?? null);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/users/me/recent-distances", requireAuth, async (req, res) => {
    try {
      const distances = await storage.getUserRecentDistances(req.session.userId!);
      res.json(distances);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/users/me/achievements", requireAuth, async (req, res) => {
    const achievements = await storage.getUserAchievements(req.session.userId!);
    res.json(achievements);
  });

  app.get("/api/users/me/achievement-stats", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const stats = await storage.getAchievementStats(userId);
      await Promise.all([
        storage.checkAndAwardAchievements(userId, stats.total_miles ?? 0),
        storage.checkFriendAchievements(userId),
      ]);
      const earnedRows = await storage.getUserAchievements(userId);
      const earned_slugs = earnedRows.map((r: any) => r.slug).filter(Boolean);
      res.json({ earned_slugs, stats });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/users/me/unlock-progress", requireAuth, async (req, res) => {
    const progress = await storage.getHostUnlockProgress(req.session.userId!);
    res.json(progress);
  });

  app.get("/api/users/search", requireAuth, async (req, res) => {
    try {
      const q = (req.query.q as string || "").trim();
      if (!q || q.length < 2) return res.json([]);
      const results = await storage.searchUsers(q, req.session.userId!);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/users/:id/profile", requireAuth, async (req, res) => {
    try {
      const profile = await storage.getPublicUserProfile(req.params.id);
      if (!profile) return res.status(404).json({ message: "User not found" });
      res.json(profile);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/users/:id/friendship", requireAuth, async (req, res) => {
    try {
      if (req.params.id === req.session.userId) return res.json({ status: "self", friendshipId: null });
      const status = await storage.getFriendshipStatus(req.session.userId!, req.params.id);
      res.json(status);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/friends", requireAuth, async (req, res) => {
    try {
      const friends = await storage.getFriends(req.session.userId!);
      res.json(friends);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/friends/requests", requireAuth, async (req, res) => {
    try {
      const [incoming, sent] = await Promise.all([
        storage.getPendingRequests(req.session.userId!),
        storage.getSentRequests(req.session.userId!),
      ]);
      res.json({ incoming, sent });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/friends/request", requireAuth, async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ message: "userId required" });
      if (userId === req.session.userId) return res.status(400).json({ message: "Cannot add yourself" });
      const result = await storage.sendFriendRequest(req.session.userId!, userId);
      if (result.error) return res.status(400).json({ message: result.error === "already_friends" ? "Already friends" : "Request already sent" });
      res.json(result.data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/friends/:id/accept", requireAuth, async (req, res) => {
    try {
      const friendship = await storage.acceptFriendRequest(req.params.id, req.session.userId!);
      if (!friendship) return res.status(404).json({ message: "Request not found" });
      storage.checkFriendAchievements(req.session.userId!).catch(() => {});
      if (friendship.requester_id) {
        storage.checkFriendAchievements(friendship.requester_id).catch(() => {});
      }
      res.json(friendship);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/friends/:id", requireAuth, async (req, res) => {
    try {
      await storage.removeFriend(req.params.id, req.session.userId!);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
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
      const publicRuns = await storage.getPublicRuns(filters);
      if (req.session.userId) {
        const bounds = (filters.swLat !== undefined && filters.neLat !== undefined && filters.swLng !== undefined && filters.neLng !== undefined)
          ? { swLat: filters.swLat, neLat: filters.neLat, swLng: filters.swLng, neLng: filters.neLng }
          : undefined;
        const [friendLocked, invited] = await Promise.all([
          storage.getFriendPrivateRuns(req.session.userId, bounds),
          storage.getInvitedPrivateRuns(req.session.userId, bounds),
        ]);
        const combined = [...publicRuns, ...invited, ...friendLocked];
        const seen = new Set<string>();
        const deduped = combined.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
        return res.json(deduped);
      }
      res.json(publicRuns);
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
      const run = await storage.createRun({ ...req.body, hostId: req.session.userId! });
      res.status(201).json(run);
      // Notify friends (fire-and-forget)
      storage.getFriendsWithPushTokens(req.session.userId!).then((friends) => {
        const tokens = friends.map((f) => f.push_token).filter(Boolean);
        if (tokens.length) {
          const privacy = run.privacy === "private" ? "private" : "public";
          sendPushNotification(
            tokens,
            "New run from a friend 🏃",
            `${run.host_name} just posted a ${privacy} run — "${run.title}"`,
            { runId: run.id }
          );
        }
      }).catch(() => {});
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/runs/invite/:token", async (req, res) => {
    try {
      const run = await storage.getRunByInviteToken(req.params.token.toUpperCase());
      if (!run) return res.status(404).json({ message: "Invalid invite code" });
      if (req.session.userId) {
        await storage.grantRunAccess(run.id, req.session.userId);
      }
      res.json({ runId: run.id, title: run.title, hostName: run.host_name });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/runs/:id/access", requireAuth, async (req, res) => {
    try {
      const run = await storage.getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.privacy !== "private") return res.json({ hasAccess: true });
      const hasAccess = await storage.hasRunAccess(req.params.id, req.session.userId!);
      res.json({ hasAccess, hasPassword: !!run.invite_password });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/join-private", requireAuth, async (req, res) => {
    try {
      const { password, token } = req.body;
      const result = await storage.verifyAndJoinPrivateRun(req.params.id, req.session.userId!, password, token);
      if (result.error) {
        if (result.error === "run_not_found") return res.status(404).json({ message: "Run not found" });
        return res.status(403).json({ message: "Incorrect password or invite code" });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/invite", requireAuth, async (req, res) => {
    try {
      const { friendId } = req.body;
      const run = await storage.getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id !== req.session.userId) return res.status(403).json({ message: "Only host can invite" });
      await storage.inviteToRun(req.params.id, friendId, req.session.userId!);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Bookmarks & Plans ─────────────────────────────────────────────────────

  app.get("/api/runs/bookmarked", requireAuth, async (req, res) => {
    try {
      const runs = await storage.getBookmarkedRuns(req.session.userId!);
      res.json(runs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/runs/:id/status", requireAuth, async (req, res) => {
    try {
      const status = await storage.getRunStatus(req.session.userId!, req.params.id);
      res.json(status);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/bookmark", requireAuth, async (req, res) => {
    try {
      const run = await storage.getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      const result = await storage.toggleBookmark(req.session.userId!, req.params.id);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/plan", requireAuth, async (req, res) => {
    try {
      const run = await storage.getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id === req.session.userId) return res.status(400).json({ message: "You are the host" });
      const result = await storage.togglePlan(req.session.userId!, req.params.id);
      res.json(result);
      // Notify host only when planning (not unplanning), fire-and-forget
      if (result.planned) {
        storage.getUserById(run.host_id).then(async (host) => {
          if (host?.push_token) {
            const planner = await storage.getUserById(req.session.userId!);
            sendPushNotification(
              host.push_token,
              "Someone plans to run with you 📅",
              `${planner?.name ?? "Someone"} is planning to join "${run.title}"`,
              { runId: run.id }
            );
          }
        }).catch(() => {});
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/runs/:id", async (req, res) => {
    try {
      const run = await storage.getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.privacy === "private") {
        if (!req.session.userId) return res.status(403).json({ message: "Private run", isPrivate: true });
        const hasAccess = await storage.hasRunAccess(req.params.id, req.session.userId);
        if (!hasAccess) {
          return res.status(403).json({
            message: "Private run",
            isPrivate: true,
            hasPassword: !!run.invite_password,
            hostName: run.host_name,
            title: run.title,
          });
        }
      }
      res.json(run);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
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
      // Eligibility check based on strict mode
      const paceOk = user.avg_pace >= run.min_pace && user.avg_pace <= run.max_pace;
      const recentDistances = await storage.getUserRecentDistances(req.session.userId!);
      // New runners with no history are always allowed through — popup is handled client-side
      if (recentDistances.length > 0) {
        const distThreshold = run.is_strict ? 0.7 : 0.5;
        const distOk = recentDistances.some((d) => d >= run.min_distance * distThreshold);

        if (run.is_strict) {
          if (!paceOk && !distOk) {
            return res.status(400).json({ message: `Strict run: your pace (${user.avg_pace} min/mi) doesn't match and no recent run covers ${Math.round(distThreshold * 100)}%+ of the ${run.min_distance} mi distance` });
          }
          if (!paceOk) {
            return res.status(400).json({ message: `Strict run: your pace (${user.avg_pace} min/mi) must be between ${run.min_pace}–${run.max_pace} min/mi` });
          }
          if (!distOk) {
            return res.status(400).json({ message: `Strict run: you need at least one recent run covering ${Math.round(distThreshold * 100)}%+ of the planned ${run.min_distance} mi distance` });
          }
        } else {
          if (!paceOk && !distOk) {
            return res.status(400).json({ message: `Your pace (${user.avg_pace} min/mi) doesn't match and no recent run covers ${Math.round(distThreshold * 100)}%+ of the ${run.min_distance} mi planned distance` });
          }
        }
      }

      const participant = await storage.joinRun(req.params.id, req.session.userId!);
      res.json(participant);
      // Notify host (fire-and-forget)
      storage.getUserById(run.host_id).then((host) => {
        if (host?.push_token) {
          sendPushNotification(
            host.push_token,
            "Someone joined your run 🎉",
            `${user.name} joined "${run.title}"`,
            { runId: run.id }
          );
        }
      }).catch(() => {});
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
      const { title, date, distanceMiles, paceMinPerMile, durationSeconds, completed, planned, notes, routePath } = req.body;
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
        routePath: Array.isArray(routePath) ? routePath : null,
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

  // ─── Live Group Run ──────────────────────────────────────────────────────────

  app.post("/api/runs/:id/start", requireAuth, async (req, res) => {
    try {
      const run = await storage.startGroupRun(req.params.id, req.session.userId!);
      res.json(run);
    } catch (e: any) {
      const status = e.message === "Only the host can start the run" ? 403
        : e.message === "Run already started" ? 409 : 500;
      res.status(status).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/ping", requireAuth, async (req, res) => {
    try {
      const { latitude, longitude, cumulativeDistance = 0, pace = 0 } = req.body;
      if (latitude == null || longitude == null) return res.status(400).json({ message: "latitude and longitude required" });
      const result = await storage.pingRunLocation(
        req.params.id, req.session.userId!,
        parseFloat(latitude), parseFloat(longitude),
        parseFloat(cumulativeDistance), parseFloat(pace)
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/runs/:id/live", async (req, res) => {
    try {
      const state = await storage.getLiveRunState(req.params.id);
      if (!state) return res.status(404).json({ message: "Run not found" });
      res.json(state);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/runner-finish", requireAuth, async (req, res) => {
    try {
      const { finalDistance, finalPace } = req.body;
      if (finalDistance == null || finalPace == null) return res.status(400).json({ message: "finalDistance and finalPace required" });
      const result = await storage.finishRunnerRun(
        req.params.id, req.session.userId!,
        parseFloat(finalDistance), parseFloat(finalPace)
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/runs/:id/results", async (req, res) => {
    try {
      const results = await storage.getRunResults(req.params.id);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Saved Paths ─────────────────────────────────────────────────────────────

  app.get("/api/saved-paths", requireAuth, async (req, res) => {
    try {
      const paths = await storage.getSavedPaths(req.session.userId!);
      res.json(paths);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/saved-paths", requireAuth, async (req, res) => {
    try {
      const { name, routePath, distanceMiles } = req.body;
      if (!name || !routePath || !Array.isArray(routePath)) {
        return res.status(400).json({ message: "name and routePath are required" });
      }
      const path = await storage.createSavedPath(req.session.userId!, { name, routePath, distanceMiles });
      storage.matchCommunityPath(req.session.userId!, path.id, routePath, distanceMiles ?? null).catch(console.error);
      res.json(path);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/community-paths", async (req, res) => {
    try {
      const bounds = req.query.swLat
        ? {
            swLat: parseFloat(req.query.swLat as string),
            neLat: parseFloat(req.query.neLat as string),
            swLng: parseFloat(req.query.swLng as string),
            neLng: parseFloat(req.query.neLng as string),
          }
        : undefined;
      const paths = await storage.getCommunityPaths(bounds);
      res.json(paths);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/saved-paths/:id", requireAuth, async (req, res) => {
    try {
      const result = await storage.deleteSavedPath(req.params.id, req.session.userId!);
      res.json(result);
    } catch (e: any) {
      const status = e.message.includes("Not found") ? 404 : 500;
      res.status(status).json({ message: e.message });
    }
  });

  // ─── Run Photos ──────────────────────────────────────────────────────────────

  app.get("/api/runs/:id/photos", async (req: any, res) => {
    try {
      const photos = await storage.getRunPhotos(req.params.id);
      res.json(photos);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/photos", requireAuth, upload.single("photo"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No photo provided" });
      const run = await storage.getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      const participants = await storage.getRunParticipants(req.params.id);
      const isParticipant = participants.some((p: any) => p.id === req.session.userId);
      const isHost = run.host_id === req.session.userId;
      if (!isParticipant && !isHost) return res.status(403).json({ message: "Not a participant" });
      const ext = (req.file.originalname.split(".").pop() || "jpg").toLowerCase();
      const filename = `run-${req.params.id}-${req.session.userId}-${Date.now()}.${ext}`;
      const url = await uploadPhotoBuffer(req.file.buffer, filename, req.file.mimetype);
      const photo = await storage.addRunPhoto(req.params.id, req.session.userId!, url);
      res.status(201).json(photo);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/runs/:id/photos/:photoId", requireAuth, async (req: any, res) => {
    try {
      await storage.deleteRunPhoto(req.params.photoId, req.session.userId!);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Solo Run Photos ──────────────────────────────────────────────────────────

  app.get("/api/solo-runs/:id/photos", requireAuth, async (req: any, res) => {
    try {
      const photos = await storage.getSoloRunPhotos(req.params.id, req.session.userId!);
      res.json(photos);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/solo-runs/:id/photos", requireAuth, upload.single("photo"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No photo provided" });
      const ext = (req.file.originalname.split(".").pop() || "jpg").toLowerCase();
      const filename = `solo-${req.params.id}-${Date.now()}.${ext}`;
      const url = await uploadPhotoBuffer(req.file.buffer, filename, req.file.mimetype);
      const photo = await storage.addSoloRunPhoto(req.params.id, req.session.userId!, url);
      res.status(201).json(photo);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/solo-runs/:id/photos/:photoId", requireAuth, async (req: any, res) => {
    try {
      await storage.deleteSoloRunPhoto(req.params.photoId, req.session.userId!);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
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
