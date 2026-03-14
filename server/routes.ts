import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import multer from "multer";
import * as storage from "./storage";
import { pool } from "./storage";
import * as ai from "./ai";
import { generateDummyRuns, clearAndReseedRuns, getRunCount } from "./seed";
import { uploadPhotoBuffer, streamObject } from "./objectStorage";
import { sendPushNotification, userWantsNotif } from "./notifications";
import crypto from "crypto";
import OAuth from "oauth-1.0a";

const GARMIN_REQUEST_TOKEN_URL = "https://connectapi.garmin.com/oauth-service/oauth/request_token";
const GARMIN_AUTH_URL = "https://connect.garmin.com/oauthConfirm";
const GARMIN_ACCESS_TOKEN_URL = "https://connectapi.garmin.com/oauth-service/oauth/access_token";
const GARMIN_ACTIVITIES_URL = "https://apis.garmin.com/wellness-api/rest/activities";

function makeGarminOAuth() {
  const key = process.env.GARMIN_CONSUMER_KEY;
  const secret = process.env.GARMIN_CONSUMER_SECRET;
  if (!key || !secret) return null;
  return new OAuth({
    consumer: { key, secret },
    signature_method: "HMAC-SHA1",
    hash_function(base_string: string, sigKey: string) {
      return crypto.createHmac("sha1", sigKey).update(base_string).digest("base64");
    },
  });
}

async function garminFetch(url: string, method: string, oauthInst: any, token?: { key: string; secret: string }): Promise<any> {
  const request = { url, method };
  const authData = oauthInst.authorize(request, token ? { key: token.key, secret: token.secret } : undefined);
  const authHeader = oauthInst.toHeader(authData);
  const resp = await fetch(url, { method, headers: { ...authHeader, "Content-Type": "application/x-www-form-urlencoded" } });
  if (!resp.ok) throw new Error(`Garmin API error: ${resp.status} ${await resp.text()}`);
  return resp;
}

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

  if (process.env.NODE_ENV !== "production") {
    const runCount = await getRunCount();
    if (runCount === 0) {
      await generateDummyRuns(15);
      console.log("[seed] Inserted 15 dummy runs for Houston");
    }
  }

  app.use(
    session({
      store: new PgStore({ pool, createTableIfMissing: true }),
      secret: process.env.SESSION_SECRET || "paceup-secret-key",
      resave: false,
      saveUninitialized: false,
      proxy: true,
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
      const { email, password, firstName, lastName, username, gender } = req.body;
      if (!email || !password || !firstName || !lastName || !username) return res.status(400).json({ message: "All fields required" });
      if (gender && !["Man", "Woman", "Prefer not to say"].includes(gender)) return res.status(400).json({ message: "Invalid gender selection" });
      if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      if (!/^[^\s@]{2,30}$/.test(username)) return res.status(400).json({ message: "Username cannot contain spaces or @ and must be 2–30 characters" });
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(400).json({ message: "Email already in use" });
      const existingUsername = await storage.getUserByUsername(username);
      if (existingUsername) return res.status(400).json({ message: "Username already taken" });
      const name = `${firstName.trim()} ${lastName.trim()}`;
      const user = await storage.createUser({ email, password, name, username, gender });
      req.session.userId = user.id;
      const rememberToken = await storage.createRememberToken(user.id);
      const { password: _, ...safeUser } = user;
      res.json({ ...safeUser, rememberToken });
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
      const rememberToken = await storage.createRememberToken(user.id);
      const { password: _, ...safeUser } = user;
      res.json({ ...safeUser, rememberToken });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const { rememberToken } = req.body ?? {};
      if (rememberToken) await storage.deleteRememberToken(rememberToken).catch(() => {});
      if (req.session.userId) await storage.deleteUserRememberTokens(req.session.userId).catch(() => {});
    } catch {}
    req.session.destroy(() => res.json({ success: true }));
  });

  app.post("/api/auth/restore-session", async (req, res) => {
    try {
      const { token } = req.body ?? {};
      if (!token) return res.status(400).json({ message: "Token required" });
      const userId = await storage.validateRememberToken(token);
      if (!userId) return res.status(401).json({ message: "Invalid or expired token" });
      const user = await storage.getUserById(userId);
      if (!user) return res.status(401).json({ message: "User not found" });
      req.session.userId = userId;
      const newToken = await storage.createRememberToken(userId);
      const { password: _, ...safeUser } = user;
      res.json({ ...safeUser, rememberToken: newToken });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
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
      const allowed = ["name", "avgPace", "avgDistance", "photoUrl", "notificationsEnabled", "distanceUnit", "profilePrivacy", "notifRunReminders", "notifFriendRequests", "notifCrewActivity", "notifWeeklySummary", "showRunRoutes", "gender", "appleHealthConnected"];
      const updates: Record<string, any> = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      if (updates.gender && !["Man", "Woman", "Prefer not to say"].includes(updates.gender)) {
        return res.status(400).json({ message: "Invalid gender selection" });
      }
      const user = await storage.updateUser(req.session.userId!, updates);
      if (!user) return res.status(404).json({ message: "User not found" });
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });


  app.delete("/api/users/me", requireAuth, async (req, res) => {
    try {
      await storage.deleteUser(req.session.userId!);
      req.session.destroy(() => {});
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/users/me/name", requireAuth, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string") return res.status(400).json({ message: "Name is required" });
      const trimmed = name.trim();
      if (trimmed.length < 2 || trimmed.length > 30) return res.status(400).json({ message: "Name must be 2–30 characters" });
      if (!/^[a-zA-Z\s\-']+$/.test(trimmed)) return res.status(400).json({ message: "Name can only contain letters, spaces, hyphens, and apostrophes" });

      const current = await storage.getUserById(req.session.userId!);
      if (!current) return res.status(404).json({ message: "User not found" });

      if (current.name_changed_at) {
        const daysSince = (Date.now() - new Date(current.name_changed_at).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince < 30) {
          const daysRemaining = Math.ceil(30 - daysSince);
          return res.status(429).json({ message: `You can change your name again in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`, daysRemaining });
        }
      }

      const user = await storage.updateUser(req.session.userId!, { name: trimmed, nameChangedAt: new Date() });
      if (!user) return res.status(404).json({ message: "User not found" });
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/users/me/goals", requireAuth, async (req, res) => {
    try {
      const { monthlyGoal, yearlyGoal, paceGoal } = req.body;
      let parsedPace: number | null | undefined = undefined;
      if (paceGoal !== undefined) {
        if (paceGoal == null) parsedPace = null;
        else {
          const v = parseFloat(paceGoal);
          if (isNaN(v) || v <= 0) return res.status(400).json({ message: "Invalid pace goal value" });
          parsedPace = v;
        }
      }
      await storage.updateGoals(req.session.userId!, monthlyGoal, yearlyGoal, parsedPace);
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

  app.get("/api/users/me/run-records", requireAuth, async (req, res) => {
    try {
      const records = await storage.getUserRunRecords(req.session.userId!);
      res.json(records);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/users/me/top-runs", requireAuth, async (req, res) => {
    try {
      const topRuns = await storage.getUserTopRuns(req.session.userId!);
      res.json(topRuns);
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
        storage.checkAndAwardRideAchievements(userId),
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
      storage.checkFriendAchievements(req.session.userId!).catch((err: any) => console.error("[bg]", err?.message ?? err));
      if (friendship.requester_id) {
        storage.checkFriendAchievements(friendship.requester_id).catch((err: any) => console.error("[bg]", err?.message ?? err));
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
      const bounds = (filters.swLat !== undefined && filters.neLat !== undefined && filters.swLng !== undefined && filters.neLng !== undefined)
        ? { swLat: filters.swLat, neLat: filters.neLat, swLng: filters.swLng, neLng: filters.neLng }
        : undefined;
      const [publicRuns, publicCrewRuns] = await Promise.all([
        storage.getPublicRuns(filters),
        storage.getPublicCrewRuns(bounds),
      ]);
      if (req.session.userId) {
        const [friendLocked, invited, crewRuns] = await Promise.all([
          storage.getFriendPrivateRuns(req.session.userId, bounds),
          storage.getInvitedPrivateRuns(req.session.userId, bounds),
          storage.getCrewVisibleRuns(req.session.userId, bounds),
        ]);
        const combined = [...publicRuns, ...publicCrewRuns, ...invited, ...friendLocked, ...crewRuns];
        const seen = new Set<string>();
        const deduped = combined.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
        deduped.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        return res.json(deduped);
      }
      const unauthCombined = [...publicRuns, ...publicCrewRuns];
      const unauthSeen = new Set<string>();
      const unauthDeduped = unauthCombined.filter(r => { if (unauthSeen.has(r.id)) return false; unauthSeen.add(r.id); return true; });
      unauthDeduped.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      res.json(unauthDeduped);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/users/buddy-suggestions", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user || !user.gender || (user.gender !== "Man" && user.gender !== "Woman")) {
        return res.json({ eligible: false, groupRuns: 0, soloRuns: 0, suggestions: [] });
      }
      const eligibility = await storage.getBuddyEligibility(user.id);
      if (!eligibility.eligible) {
        return res.json({ eligible: false, groupRuns: eligibility.groupRuns, soloRuns: eligibility.soloRuns, suggestions: [] });
      }
      const suggestions = await storage.getBuddySuggestions(user.id, user.gender);
      res.json({ eligible: true, groupRuns: eligibility.groupRuns, soloRuns: eligibility.soloRuns, suggestions });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/tts", requireAuth, async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ message: "Text required" });
      const buffer = await ai.generateTTS(text);
      if (!buffer) return res.status(500).json({ message: "TTS failed" });
      res.set("Content-Type", "audio/mpeg");
      res.send(buffer);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/solo-runs/:id/ai-summary", requireAuth, async (req, res) => {
    try {
      const run = await storage.getSoloRunById(req.params.id);
      if (!run || run.user_id !== req.session.userId) return res.status(404).json({ message: "Run not found" });
      if ((run as any).ai_summary) return res.json({ summary: (run as any).ai_summary });
      const summary = await ai.generateRunSummary(run);
      if (summary) {
        await storage.updateSoloRun(run.id, req.session.userId!, { ai_summary: summary });
      }
      res.json({ summary });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/search-ai", requireAuth, async (req, res) => {
    try {
      const { q } = req.body;
      if (!q) return res.status(400).json({ message: "Query required" });
      const filters = await ai.generateSearchFilters(q);
      res.json(filters);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/notifications", requireAuth, async (req, res) => {
    try {
      const data = await storage.getNotifications(req.session.userId!);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/friends/respond", requireAuth, async (req, res) => {
    try {
      const { friendshipId, action } = req.body;
      if (!friendshipId || !action) return res.status(400).json({ message: "friendshipId and action required" });
      await storage.respondToFriendRequest(friendshipId, req.session.userId!, action);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/users/update-phone", requireAuth, async (req, res) => {
    try {
      const { phoneHash } = req.body;
      if (!phoneHash) return res.status(400).json({ message: "phoneHash required" });
      if (typeof phoneHash !== "string" || !/^[a-f0-9]{64}$/.test(phoneHash)) {
        return res.status(400).json({ message: "Invalid phone hash format" });
      }
      await pool.query(`UPDATE users SET phone_hash = $1 WHERE id = $2`, [phoneHash, req.session.userId]);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/users/find-by-contacts", requireAuth, async (req, res) => {
    try {
      const { phoneHashes } = req.body;
      if (!Array.isArray(phoneHashes) || phoneHashes.length === 0)
        return res.status(400).json({ message: "phoneHashes array required" });
      const limited = phoneHashes.slice(0, 5000);
      const result = await pool.query(
        `SELECT u.id, u.name, u.username, u.photo_url, u.total_miles, u.phone_hash
         FROM users u
         WHERE u.phone_hash = ANY($1::text[])
           AND u.id != $2
           AND u.id NOT IN (
             SELECT CASE WHEN requester_id = $2 THEN addressee_id ELSE requester_id END
             FROM friends
             WHERE (requester_id = $2 OR addressee_id = $2)
               AND status IN ('pending', 'accepted')
           )`,
        [limited, req.session.userId]
      );
      res.json(result.rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/auth/facebook/start", requireAuth, (req, res) => {
    const appId = process.env.FACEBOOK_APP_ID;
    if (!appId) return res.status(501).json({ message: "Facebook integration not configured" });
    const nonce = crypto.randomBytes(24).toString("hex");
    (req.session as any).fbOauthState = nonce;
    (req.session as any).fbOauthUserId = req.session.userId;
    req.session.save(() => {
      const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/facebook/callback`;
      const scope = "public_profile,user_friends";
      const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${nonce}&response_type=code`;
      res.json({ url });
    });
  });

  app.get("/api/auth/facebook/callback", async (req, res) => {
    try {
      const { code, state } = req.query as { code?: string; state?: string };
      if (!code || !state) return res.status(400).send("Missing code or state");
      const storedState = (req.session as any).fbOauthState;
      const storedUserId = (req.session as any).fbOauthUserId;
      if (!storedState || storedState !== state || !storedUserId) return res.status(403).send("Invalid OAuth state");
      delete (req.session as any).fbOauthState;
      delete (req.session as any).fbOauthUserId;
      const appId = process.env.FACEBOOK_APP_ID;
      const appSecret = process.env.FACEBOOK_APP_SECRET;
      if (!appId || !appSecret) return res.status(501).send("Facebook not configured");
      const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/facebook/callback`;
      const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`);
      const tokenData = await tokenRes.json() as any;
      if (!tokenData.access_token) return res.status(400).send("Failed to get access token");
      const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${tokenData.access_token}`);
      const me = await meRes.json() as any;
      if (me.id) {
        await pool.query(`UPDATE users SET facebook_id = $1 WHERE id = $2`, [me.id, storedUserId]);
        try {
          const friendsRes = await fetch(`https://graph.facebook.com/v19.0/me/friends?fields=id&limit=5000&access_token=${tokenData.access_token}`);
          const friendsData = await friendsRes.json() as any;
          if (friendsData.data && Array.isArray(friendsData.data) && friendsData.data.length > 0) {
            await pool.query(`DELETE FROM facebook_friends WHERE user_id = $1`, [storedUserId]);
            const friendIds = friendsData.data.map((f: any) => f.id).filter(Boolean);
            if (friendIds.length > 0) {
              const values = friendIds.map((_: string, i: number) => `($1, $${i + 2})`).join(", ");
              await pool.query(
                `INSERT INTO facebook_friends (user_id, fb_friend_id) VALUES ${values} ON CONFLICT DO NOTHING`,
                [storedUserId, ...friendIds]
              );
            }
          }
        } catch (friendErr) {
          console.error("Failed to fetch Facebook friends:", friendErr);
        }
      }
      res.send(`<html><body><script>window.close();</script><p>Connected! You can close this window.</p></body></html>`);
    } catch (e: any) {
      res.status(500).send("Facebook auth error: " + e.message);
    }
  });

  app.delete("/api/auth/facebook/disconnect", requireAuth, async (req, res) => {
    try {
      await pool.query(`DELETE FROM facebook_friends WHERE user_id = $1`, [req.session.userId]);
      await pool.query(`UPDATE users SET facebook_id = NULL WHERE id = $1`, [req.session.userId]);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/friends/facebook-suggestions", requireAuth, async (req, res) => {
    try {
      const userRow = await pool.query(`SELECT facebook_id FROM users WHERE id = $1`, [req.session.userId]);
      const fbId = userRow.rows[0]?.facebook_id;
      if (!fbId) return res.json([]);
      const result = await pool.query(
        `SELECT u.id, u.name, u.username, u.photo_url, u.total_miles
         FROM users u
         WHERE u.facebook_id IS NOT NULL
           AND u.id != $1
           AND (
             u.facebook_id IN (SELECT fb_friend_id FROM facebook_friends WHERE user_id = $1)
             OR u.id IN (SELECT ff.user_id FROM facebook_friends ff WHERE ff.fb_friend_id = $2)
           )
           AND u.id NOT IN (
             SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END
             FROM friends
             WHERE (requester_id = $1 OR addressee_id = $1)
               AND status IN ('pending', 'accepted')
           )
         LIMIT 50`,
        [req.session.userId, fbId]
      );
      res.json(result.rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/crews/invites/respond", requireAuth, async (req, res) => {
    try {
      const { crewId, action } = req.body;
      if (!crewId || !action) return res.status(400).json({ message: "crewId and action required" });
      await storage.respondToCrewInvite(crewId, req.session.userId!, action);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/requests/respond", requireAuth, async (req, res) => {
    try {
      const { participantId, action, runId } = req.body;
      if (!participantId || !action) return res.status(400).json({ message: "participantId and action required" });
      await storage.respondToJoinRequest(participantId, req.session.userId!, action);
      res.json({ success: true });
      if (runId) {
        Promise.all([storage.getRunById(runId), storage.getParticipantById(participantId)]).then(([run, participant]) => {
          if (!run || !participant) return;
          storage.getUserById(participant.user_id).then((requester) => {
            if (!requester?.push_token) return;
            const actLabel = run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run";
            if (action === "approve") {
              sendPushNotification(requester.push_token, `You're in! 🎉`, `Your request to join "${run.title}" was approved`, { runId });
            } else {
              sendPushNotification(requester.push_token, `Request declined`, `Your request to join "${run.title}" was not accepted`, { runId });
            }
          }).catch((err: any) => console.error("[bg]", err?.message ?? err));
        }).catch((err: any) => console.error("[bg]", err?.message ?? err));
      }
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

  app.get("/api/users/:id/starred-runs", requireAuth, async (req, res) => {
    try {
      const runs = await storage.getStarredRunsForUser(req.params.id, 3);
      res.json(runs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs", requireAuth, async (req, res) => {
    try {
      const host = await storage.getUserById(req.session.userId!);
      if (host && host.rating_count >= 5 && parseFloat(host.avg_rating ?? "5") < 3.5) {
        return res.status(403).json({
          message: "Your host rating is below the minimum required to host new runs. Attend runs as a participant — your rating may recover over time.",
        });
      }
      const minDist = parseFloat(req.body.minDistance ?? req.body.min_distance ?? 0);
      const maxDist = parseFloat(req.body.maxDistance ?? req.body.max_distance ?? 0);
      if (minDist < 0 || maxDist < 0) return res.status(400).json({ message: "Distance values must be positive" });
      if (maxDist > 0 && minDist > maxDist) return res.status(400).json({ message: "Minimum distance cannot exceed maximum distance" });
      const run = await storage.createRun({ ...req.body, hostId: req.session.userId!, savedPathId: req.body.savedPathId || null });
      res.status(201).json(run);
      // Notify — crew runs notify crew members; regular runs notify friends (fire-and-forget)
      if (run.crew_id) {
        // Auto-post context-aware prompt to crew chat
        (() => {
          const runDate = new Date(run.date);
          const dayStr = runDate.toLocaleDateString('en-US', { weekday: 'long' });
          const timeStr = runDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          const actLabel = run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run";
          const promptMsg = `📅 ${run.title} scheduled for ${dayStr} at ${timeStr}. Who's joining this ${actLabel}?`;
          storage.createCrewMessage(
            run.crew_id!,
            req.session.userId!,
            host?.name ?? 'Host',
            host?.photo_url ?? null,
            promptMsg,
            'prompt',
            { runId: run.id, quickReplies: ["I'm in! 💪", "Maybe 🤔", "Can't make it 😔"] }
          ).catch((err: any) => console.error("[bg]", err?.message ?? err));
        })();

        storage.getCrewMemberPushTokensFiltered(run.crew_id, 'notif_crew_activity').then((tokens) => {
          if (tokens.length) {
            const actLabel = run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run";
            sendPushNotification(
              tokens,
              `New crew ${actLabel} scheduled 🏃`,
              `${run.host_name} posted "${run.title}" for your crew`,
              { runId: run.id }
            );
          }
        }).catch((err: any) => console.error("[bg]", err?.message ?? err));
      } else {
        storage.getFriendsWithPushTokensFiltered(req.session.userId!, 'notif_run_reminders').then((tokens) => {
          if (tokens.length) {
            const privacy = run.privacy === "private" ? "private" : "public";
            sendPushNotification(
              tokens,
              "New activity from a friend 🏃",
              `${run.host_name} just posted a ${privacy} ${run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run"} — "${run.title}"`,
              { runId: run.id }
            );
          }
        }).catch((err: any) => console.error("[bg]", err?.message ?? err));
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/community-paths", async (req, res) => {
    try {
      const bounds = (req.query.swLat && req.query.neLat && req.query.swLng && req.query.neLng)
        ? {
            swLat: parseFloat(req.query.swLat as string),
            neLat: parseFloat(req.query.neLat as string),
            swLng: parseFloat(req.query.swLng as string),
            neLng: parseFloat(req.query.neLng as string)
          }
        : undefined;
      const paths = await storage.getCommunityPaths(bounds);
      res.json(paths);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/solo-runs/:id/publish-route", requireAuth, async (req, res) => {
    try {
      const { routeName } = req.body;
      if (!routeName) return res.status(400).json({ message: "routeName required" });
      const path = await storage.publishSoloRunRoute(req.params.id, req.session.userId!, routeName);
      res.json(path);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/crew-chat/has-new", requireAuth, async (req, res) => {
    try {
      const since = req.query.since as string;
      if (!since) return res.json({ hasNew: false });
      const result = await pool.query(
        `SELECT 1 FROM crew_messages cm
         JOIN crew_members mem ON mem.crew_id = cm.crew_id
           AND mem.user_id = $1
           AND mem.status = 'member'
         WHERE cm.created_at > $2
           AND cm.user_id != $1
         LIMIT 1`,
        [req.session.userId, new Date(since)]
      );
      res.json({ hasNew: result.rows.length > 0 });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/crews/:id/messages", requireAuth, async (req, res) => {
    try {
      const crewId = req.params.id;
      const userId = req.session.userId!;
      const isMember = await storage.isCrewMember(crewId, userId);
      if (!isMember) return res.status(403).json({ message: "Not a crew member" });

      const limit = parseInt(req.query.limit as string) || 50;
      const messages = await storage.getCrewMessages(crewId, limit);
      res.json(messages);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/crews/:id/messages", requireAuth, async (req, res) => {
    try {
      const crewId = req.params.id;
      const userId = req.session.userId!;
      const isMember = await storage.isCrewMember(crewId, userId);
      if (!isMember) return res.status(403).json({ message: "Not a crew member" });

      const { message = "", gif_url, gif_preview_url } = req.body;
      if (!message && !gif_url) return res.status(400).json({ message: "Message or GIF required" });

      const user = await storage.getUserById(userId);
      const messageType = gif_url ? "gif" : "text";
      const metadata = gif_url ? { gif_url, gif_preview_url } : undefined;
      const newMessage = await storage.createCrewMessage(
        crewId,
        userId,
        user.name,
        user.photo_url,
        message || "",
        messageType,
        metadata
      );
      res.status(201).json(newMessage);

      // Fire-and-forget: push to crew members who haven't muted the chat
      (async () => {
        try {
          const crew = await storage.pool.query(`SELECT name FROM crews WHERE id = $1`, [crewId]);
          const crewName = crew.rows[0]?.name ?? "Crew";
          const tokensRes = await storage.pool.query(
            `SELECT u.push_token FROM users u
             JOIN crew_members cm ON cm.user_id = u.id
             WHERE cm.crew_id = $1
               AND cm.status = 'member'
               AND cm.user_id != $2
               AND cm.chat_muted IS NOT TRUE
               AND u.push_token IS NOT NULL
               AND u.notifications_enabled = true
               AND u.notif_crew_activity = true`,
            [crewId, userId]
          );
          const tokens: string[] = tokensRes.rows.map((r: any) => r.push_token);
          if (tokens.length > 0) {
            const preview = gif_url ? "Sent a GIF 🎬" : (message.length > 60 ? message.slice(0, 57) + "…" : message);
            sendPushNotification(tokens, `${user.name} · ${crewName}`, preview, { crewId });
          }
        } catch (err: any) {
          console.error("[crew-chat-notif]", err?.message ?? err);
        }
      })();
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

  app.get("/api/runs/:id/messages", requireAuth, async (req, res) => {
    try {
      const runId = req.params.id;
      const userId = req.session.userId!;
      const isParticipant = await storage.isRunParticipant(runId, userId);
      const run = await storage.getRunById(runId);
      const isHost = run?.host_id === userId;

      if (!isParticipant && !isHost) {
        return res.status(403).json({ message: "Only participants can view messages" });
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const messages = await storage.getRunMessages(runId, limit);
      res.json(messages);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/messages", requireAuth, async (req, res) => {
    try {
      const runId = req.params.id;
      const userId = req.session.userId!;
      const { message } = req.body;

      if (!message) return res.status(400).json({ message: "Message is required" });

      const isParticipant = await storage.isRunParticipant(runId, userId);
      const run = await storage.getRunById(runId);
      const isHost = run?.host_id === userId;

      if (!isParticipant && !isHost) {
        return res.status(403).json({ message: "Only participants can send messages" });
      }

      const user = await storage.getUserById(userId);
      const newMessage = await storage.createRunMessage(
        runId,
        userId,
        user.name,
        user.photo_url,
        message
      );
      res.json(newMessage);
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

  app.get("/api/runs/planned", requireAuth, async (req, res) => {
    try {
      const runs = await storage.getPlannedRuns(req.session.userId!);
      res.json(runs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

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
          if (userWantsNotif(host, 'run_reminders')) {
            const planner = await storage.getUserById(req.session.userId!);
            sendPushNotification(
              host!.push_token,
              `Someone plans to ${run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run"} with you 📅`,
              `${planner?.name ?? "Someone"} is planning to join "${run.title}"`,
              { runId: run.id }
            );
          }
        }).catch((err: any) => console.error("[bg]", err?.message ?? err));
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/runs/community-activity", async (_req, res) => {
    try {
      const runs = await storage.getRecentCommunityActivity();
      res.json({ runs });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/runs/:id", async (req, res) => {
    try {
      const run = await storage.getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.crew_id) {
        if (!req.session.userId) return res.status(403).json({ message: "Crew run — members only", isCrewRun: true });
        // Host always has access to their own crew run regardless of membership
        if (run.host_id !== req.session.userId) {
          const member = await storage.isCrewMember(run.crew_id, req.session.userId);
          if (!member) return res.status(403).json({ message: "Crew run — members only", isCrewRun: true });
        }
      } else if (run.privacy === "friends") {
        if (!req.session.userId) return res.status(403).json({ message: "Friends only run", isFriendsOnly: true });
        if (run.host_id !== req.session.userId) {
          const friends = await storage.areFriends(req.session.userId, run.host_id);
          if (!friends) return res.status(403).json({ message: "Friends only run", isFriendsOnly: true });
        }
      } else if (run.privacy === "private") {
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
      // Eligibility checks only apply to strict runs
      if (run.is_strict) {
        const paceOk = user.avg_pace >= run.min_pace && user.avg_pace <= run.max_pace;
        const recentDistances = await storage.getUserRecentDistances(req.session.userId!);
        if (recentDistances.length > 0) {
          const distOk = recentDistances.some((d) => d >= run.min_distance * 0.7);
          if (!paceOk && !distOk) {
            return res.status(400).json({ message: `Strict run: your pace (${user.avg_pace} min/mi) doesn't match and no recent run covers 70%+ of the ${run.min_distance} mi distance` });
          }
          if (!paceOk) {
            return res.status(400).json({ message: `Strict run: your pace (${user.avg_pace} min/mi) must be between ${run.min_pace}–${run.max_pace} min/mi` });
          }
          if (!distOk) {
            return res.status(400).json({ message: `Strict run: you need at least one recent run covering 70%+ of the planned ${run.min_distance} mi distance` });
          }
        }
      }

      // Time guard: reject if event is more than 2 hours in the past
      const runDate = new Date(run.date);
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      if (runDate < twoHoursAgo) {
        return res.status(400).json({ message: "This event has already taken place" });
      }

      // Capacity check: reject if event is full
      if (run.max_participants) {
        const participantCount = await storage.getRunParticipantCount(req.params.id);
        if (participantCount >= run.max_participants) {
          return res.status(400).json({ message: "This event is full" });
        }
      }

      const paceGroupLabel = req.body.paceGroupLabel ?? null;
      const participant = await storage.joinRun(req.params.id, req.session.userId!, paceGroupLabel);
      res.json(participant);
      // Notify host (fire-and-forget)
      storage.getUserById(run.host_id).then((host) => {
        if (userWantsNotif(host, 'run_reminders')) {
          sendPushNotification(
            host!.push_token,
            `Someone joined your ${run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run"} 🎉`,
            `${user.name} joined "${run.title}"`,
            { runId: run.id }
          );
        }
      }).catch((err: any) => console.error("[bg]", err?.message ?? err));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Update pace group for an existing participant (used after proximity auto-join)
  app.patch("/api/runs/:id/pace-group", requireAuth, async (req, res) => {
    try {
      const { paceGroupLabel } = req.body;
      if (!paceGroupLabel) return res.status(400).json({ message: "paceGroupLabel required" });
      await storage.joinRun(req.params.id, req.session.userId!, paceGroupLabel);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/request-join", requireAuth, async (req, res) => {
    try {
      const run = await storage.getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id === req.session.userId) return res.status(400).json({ message: "You are the host" });
      const runDate = new Date(run.date);
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      if (runDate < twoHoursAgo) return res.status(400).json({ message: "This event has already taken place" });
      const participantCount = await storage.getRunParticipantCount(req.params.id);
      if (participantCount < run.max_participants) {
        return res.status(400).json({ message: "This event is not full — you can join directly" });
      }
      const result = await storage.requestJoinRun(req.params.id, req.session.userId!);
      if (result.alreadyExists && result.row.status !== "cancelled") {
        return res.status(400).json({ message: result.row.status === "pending" ? "already_requested" : "already_joined" });
      }
      res.json({ success: true, participantId: result.row.id });
      storage.getUserById(req.session.userId!).then((user) => {
        if (!user) return;
        storage.getUserById(run.host_id).then((host) => {
          if (host && userWantsNotif(host, 'run_reminders')) {
            sendPushNotification(
              host.push_token,
              `Join request for your full ${run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run"}`,
              `${user.name} wants to join "${run.title}"`,
              { runId: run.id }
            );
          }
        }).catch((err: any) => console.error("[bg]", err?.message ?? err));
      }).catch((err: any) => console.error("[bg]", err?.message ?? err));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/leave", requireAuth, async (req, res) => {
    try {
      const prior = await storage.getParticipantStatus(req.params.id, req.session.userId!);
      await storage.leaveRun(req.params.id, req.session.userId!);
      if (prior === "confirmed") {
        await storage.decrementCompletedRuns(req.session.userId!);
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/runs/:id", requireAuth, async (req, res) => {
    try {
      const { date } = req.body;
      if (!date) return res.status(400).json({ message: "date is required" });
      const updated = await storage.updateRunDateTime(req.params.id, req.session.userId!, date);
      const tokens = await storage.getRunParticipantTokensFiltered(req.params.id, 'notif_run_reminders');
      if (tokens.length) {
        const newDate = new Date(updated.date);
        const label = `${newDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${newDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
        sendPushNotification(
          tokens,
          "Run time updated ⏰",
          `"${updated.title}" has been rescheduled to ${label}`,
          { runId: req.params.id }
        );
      }
      res.json(updated);
    } catch (e: any) {
      res.status(e.message.includes("Only the host") ? 403 : 500).json({ message: e.message });
    }
  });

  app.delete("/api/runs/:id", requireAuth, async (req, res) => {
    try {
      const result = await storage.cancelRun(req.params.id, req.session.userId!);
      storage.getRunParticipantTokensFiltered(req.params.id, 'notif_run_reminders').then((filteredTokens) => {
        if (filteredTokens.length) {
          sendPushNotification(
            filteredTokens,
            "Run cancelled ❌",
            `"${result.title}" has been cancelled by the host`,
            {}
          );
        }
      }).catch((err: any) => console.error("[bg]", err?.message ?? err));
      res.json({ success: true });
    } catch (e: any) {
      res.status(e.message.includes("Only the host") ? 403 : 500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/broadcast", requireAuth, async (req, res) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ message: "Message is required" });
      }
      if (message.trim().length > 280) {
        return res.status(400).json({ message: "Message must be 280 characters or less" });
      }
      const run = await storage.getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id !== req.session.userId) {
        return res.status(403).json({ message: "Only the host can send messages to participants" });
      }
      const tokens = await storage.getRunBroadcastTokens(req.params.id);
      if (tokens.length) {
        sendPushNotification(tokens, `${run.title}`, message.trim(), { runId: req.params.id });
      }
      res.json({ sent: tokens.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/complete", requireAuth, async (req, res) => {
    try {
      const { milesLogged } = req.body;
      const miles = parseFloat(milesLogged) || 3;
      const result = await storage.confirmRunCompletion(req.params.id, req.session.userId!, miles);
      
      // Crew enhancements: Streak and Overtake
      const run = await storage.getRunById(req.params.id as string);
      if (run && run.crew_id) {
        const crew = await storage.getCrewById(run.crew_id);
        if (crew) {
          // Update streak
          const now = new Date();
          const lastRun = crew.last_run_week ? new Date(crew.last_run_week) : null;
          
          const getWeekNumber = (d: Date) => {
            const onejan = new Date(d.getFullYear(), 0, 1);
            return Math.ceil((((d.getTime() - onejan.getTime()) / 86400000) + onejan.getDay() + 1) / 7);
          };

          const currentWeek = getWeekNumber(now);
          const currentYear = now.getFullYear();
          const lastWeek = lastRun ? getWeekNumber(lastRun) : -1;
          const lastYear = lastRun ? lastRun.getFullYear() : -1;

          let newStreak = crew.current_streak_weeks || 0;
          if (lastYear === currentYear && lastWeek === currentWeek) {
            // Already ran this week
          } else if (lastYear === currentYear && lastWeek === currentWeek - 1) {
            newStreak++;
          } else if (lastYear === currentYear - 1 && lastWeek >= 52 && currentWeek === 1) {
            newStreak++;
          } else {
            newStreak = 1;
          }

          await storage.updateCrew(crew.id, { current_streak_weeks: newStreak, last_run_week: now });

          // Post milestone message
          const milestones = [4, 8, 12, 26, 52];
          if (milestones.includes(newStreak)) {
            const recap = await ai.generateCrewRecap(
              crew.name,
              run.title,
              (await storage.getRunParticipants(run.id)).length,
              (run.min_pace + run.max_pace / 2).toFixed(2) // Fallback avg pace
            );
            await storage.createCrewMessage(
              crew.id,
              "system",
              "PaceUp Bot",
              null,
              `🔥 ${newStreak} WEEK STREAK! ${recap || "This crew is on fire!"}`,
              "milestone"
            );
          }

          // Ranking Overtake Check
          const oldRankings = await storage.getCrewRankings("national");
          const crewOldRank = oldRankings.findIndex(r => r.id === crew.id) + 1;

          // Rankings might have changed after milesLogged update
          const newRankings = await storage.getCrewRankings("national");
          const crewNewRank = newRankings.findIndex(r => r.id === crew.id) + 1;

          if (crewNewRank < crewOldRank && crewOldRank > 0) {
            // We overtook someone
            const overtaken = newRankings[crewNewRank]; // The crew now at our old spot (roughly)
            if (overtaken && overtaken.id !== crew.id) {
              const nowMs = Date.now();
              const lastNotif = overtaken.last_overtake_notif_at ? new Date(overtaken.last_overtake_notif_at).getTime() : 0;
              if (nowMs - lastNotif > 60 * 60 * 1000) {
                await storage.createCrewMessage(
                  overtaken.id,
                  "system",
                  "PaceUp Bot",
                  null,
                  `⚠️ ${crew.name} just took your #${crewNewRank} spot — take it back!`,
                  "milestone"
                );
                await storage.updateCrew(overtaken.id, { last_overtake_notif_at: new Date() });
              }
            }
          }
        }
      }
      
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

  app.get("/api/solo-runs/starred", requireAuth, async (req, res) => {
    try {
      const runs = await storage.getStarredSoloRuns(req.session.userId!);
      res.json(runs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/solo-runs/:id/star", requireAuth, async (req, res) => {
    try {
      const run = await storage.toggleStarSoloRun(req.params.id, req.session.userId!);
      if (!run) return res.status(404).json({ message: "Run not found" });
      res.json(run);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/solo-runs", requireAuth, async (req, res) => {
    try {
      const { title, date, distanceMiles, paceMinPerMile, durationSeconds, completed, planned, notes, routePath, activityType, savedPathId, mileSplits, elevationGainFt, stepCount, moveTimeSeconds } = req.body;
      if (!date || !distanceMiles) return res.status(400).json({ message: "date and distanceMiles required" });
      const parsedDist = parseFloat(distanceMiles);
      const parsedPace = paceMinPerMile ? parseFloat(paceMinPerMile) : null;
      const run = await storage.createSoloRun({
        userId: req.session.userId!,
        title,
        date,
        distanceMiles: parsedDist,
        paceMinPerMile: parsedPace,
        durationSeconds: durationSeconds ? parseInt(durationSeconds) : null,
        completed: !!completed,
        planned: !!planned,
        notes,
        routePath: Array.isArray(routePath) ? routePath : null,
        activityType: activityType === "ride" ? "ride" : activityType === "walk" ? "walk" : "run",
        savedPathId: savedPathId || null,
        mileSplits: Array.isArray(mileSplits) && mileSplits.length > 0 ? mileSplits : null,
        elevationGainFt: elevationGainFt != null ? parseFloat(elevationGainFt) : null,
        stepCount: stepCount != null ? parseInt(stepCount) : null,
        moveTimeSeconds: moveTimeSeconds != null ? parseInt(moveTimeSeconds) : null,
      });
      // Compute PR tiers for completed runs
      let prTiers: { distanceTier: number | null; paceTier: number | null } = { distanceTier: null, paceTier: null };
      if (completed) {
        try { prTiers = await storage.getSoloRunPrTiers(req.session.userId!, run.id); } catch (_) {}
        storage.recomputeUserAvgPace(req.session.userId!).catch((err: any) => console.error("[bg]", err?.message ?? err));
      }
      res.status(201).json({ ...run, prTiers });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/solo-runs/:id/pr-tiers", requireAuth, async (req, res) => {
    try {
      const tiers = await storage.getSoloRunPrTiers(req.session.userId!, req.params.id);
      res.json(tiers);
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
      const verb = run.activity_type === "ride" ? "Ride" : run.activity_type === "walk" ? "Walk" : "Run";
      storage.getRunParticipantTokensFiltered(req.params.id, "notif_run_reminders").then((tokens) => {
        if (!tokens.length) return;
        sendPushNotification(
          tokens,
          `${verb} has started — Let's go! 🚀`,
          run.title,
          { screen: "run-live", runId: req.params.id }
        );
      }).catch((err: any) => console.error("[bg]", err?.message ?? err));
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

  app.get("/api/runs/:id/host-route", async (req, res) => {
    try {
      const path = await storage.getHostRoutePath(req.params.id);
      res.json(path);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/runs/:id/tracking-path", async (req, res) => {
    try {
      const points = await storage.getHostRoutePath(req.params.id);
      res.json({ path: points });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/runner-finish", requireAuth, async (req, res) => {
    try {
      const { finalDistance, finalPace } = req.body;
      if (finalDistance == null || finalPace == null) return res.status(400).json({ message: "finalDistance and finalPace required" });
      const parsedDist = parseFloat(finalDistance);
      const parsedPace = parseFloat(finalPace);
      const safeDist = Number.isFinite(parsedDist) && parsedDist > 0 ? parsedDist : 0;
      const safePace = Number.isFinite(parsedPace) && parsedPace > 0 ? parsedPace : 0;
      const result = await storage.finishRunnerRun(
        req.params.id, req.session.userId!,
        safeDist, safePace
      );
      res.json(result);
      // Fire-and-forget crew achievement check
      storage.getRunById(req.params.id).then((run: any) => {
        if (run?.crew_id) {
          storage.checkAndAwardCrewAchievements(run.crew_id).catch((err: any) => console.error("[bg]", err?.message ?? err));
        }
      }).catch((err: any) => console.error("[bg]", err?.message ?? err));
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
      const { name, routePath, distanceMiles, activityType } = req.body;
      if (!name || !routePath || !Array.isArray(routePath)) {
        return res.status(400).json({ message: "name and routePath are required" });
      }
      const path = await storage.createSavedPath(req.session.userId!, { name, routePath, distanceMiles, activityType });
      storage.matchCommunityPath(req.session.userId!, path.id, routePath, distanceMiles ?? null).catch(console.error);
      res.json(path);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/saved-paths/:id/runs", requireAuth, async (req, res) => {
    try {
      const runs = await storage.getSoloRunsByPathId(req.session.userId!, req.params.id);
      res.json(runs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/saved-paths/:id", requireAuth, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "name is required" });
      }
      const path = await storage.updateSavedPath(req.params.id, req.session.userId!, name.trim());
      if (!path) return res.status(404).json({ message: "Path not found" });
      res.json(path);
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
      const soloRun = await storage.getSoloRunById(req.params.id);
      if (!soloRun) return res.status(404).json({ message: "Solo run not found" });
      if (soloRun.userId !== req.session.userId) return res.status(403).json({ message: "Not authorized" });
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

  // ─── Crew Routes ────────────────────────────────────────────────────────────

  app.get("/api/crews", requireAuth, async (req, res) => {
    try {
      const crews = await storage.getCrewsByUser(req.session.userId!);
      res.json(crews);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/crews/rankings", requireAuth, async (req, res) => {
    try {
      const activityType = String(req.query.activityType || "run");
      const period = String(req.query.period || "all");

      let dateFilter = "";
      if (period === "week") {
        dateFilter = `AND r.date >= NOW() - INTERVAL '7 days'`;
      } else if (period === "month") {
        dateFilter = `AND r.date >= NOW() - INTERVAL '30 days'`;
      }

      const myCrewId = req.query.myCrewId ? String(req.query.myCrewId) : null;

      const allRankedResult = await pool.query(`
        SELECT
          c.id,
          c.name,
          c.emoji,
          c.image_url,
          COUNT(DISTINCT cm.user_id)::int AS member_count,
          COALESCE(SUM(rp.final_distance), 0)::real AS total_miles,
          COUNT(DISTINCT r.id)::int AS total_runs
        FROM crews c
        LEFT JOIN crew_members cm ON cm.crew_id = c.id
        LEFT JOIN runs r ON r.crew_id = c.id
          AND r.is_completed = true
          AND r.activity_type = $1
          AND r.is_deleted IS NOT TRUE
          ${dateFilter}
        LEFT JOIN run_participants rp ON rp.run_id = r.id AND rp.final_distance IS NOT NULL
        GROUP BY c.id, c.name, c.emoji, c.image_url
        HAVING COALESCE(SUM(rp.final_distance), 0) > 0
        ORDER BY total_miles DESC
      `, [activityType]);

      const allRanked = allRankedResult.rows.map((row: any, idx: number) => ({
        rank: idx + 1,
        id: row.id,
        name: row.name,
        emoji: row.emoji,
        image_url: row.image_url,
        member_count: row.member_count,
        total_miles: parseFloat(row.total_miles),
        total_runs: row.total_runs,
      }));

      const top100 = allRanked.slice(0, 100);
      const inTop100 = myCrewId ? top100.some((c: any) => c.id === myCrewId) : false;
      let myCrew = null;
      if (myCrewId && !inTop100) {
        myCrew = allRanked.find((c: any) => c.id === myCrewId) ?? null;
      }

      res.json({ top100, myCrew });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/crews/rankings", requireAuth, async (req, res) => {
    try {
      const { type, value } = req.query;
      if (!type || !["national", "state", "metro"].includes(type as string)) {
        return res.status(400).json({ message: "Invalid ranking type" });
      }
      const rankings = await storage.getCrewRankings(type as any, value as string);
      res.json(rankings);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/metro-areas", (req, res) => {
    const { metroAreas } = require("./metro-areas");
    res.json(metroAreas);
  });

  app.post("/api/crews", requireAuth, async (req, res) => {
    try {
      const { name, description, emoji, runStyle, tags, imageUrl, homeMetro, homeState } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Name is required" });
      if (name.trim().length > 20) return res.status(400).json({ message: "Crew name must be 20 characters or less" });
      const crew = await storage.createCrew({
        name: name.trim(),
        description,
        emoji: emoji || "🏃",
        createdBy: req.session.userId!,
        runStyle,
        tags: Array.isArray(tags) ? tags : [],
        imageUrl,
        homeMetro,
        homeState,
      });
      res.json(crew);
    } catch (e: any) {
      if ((e as any).code === "DUPLICATE_CREW_NAME") return res.status(409).json({ message: e.message });
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/crew-invites", requireAuth, async (req, res) => {
    try {
      const invites = await storage.getCrewInvites(req.session.userId!);
      res.json(invites);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/crew-invites/:crewId/respond", requireAuth, async (req, res) => {
    try {
      const { accept } = req.body;
      await storage.respondToCrewInvite(req.params.crewId, req.session.userId!, accept ? 'accept' : 'reject');
      res.json({ ok: true });
    } catch (e: any) {
      if ((e as any).code === "MEMBER_CAP_REACHED") return res.status(400).json({ message: e.message, code: "MEMBER_CAP_REACHED" });
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/crews/search", requireAuth, async (req, res) => {
    try {
      const q = (req.query.q as string) || "";
      const friendsOnly = req.query.friends === "true";
      if (!q.trim() && !friendsOnly) return res.json([]);
      const results = await storage.searchCrews(req.session.userId!, q, friendsOnly);
      res.json(results);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/crews/suggested", requireAuth, async (req, res) => {
    try {
      const userCrews = await storage.getCrewsByUser(req.session.userId!);
      if (userCrews.length >= 3) return res.json([]);
      const suggestions = await storage.getSuggestedCrews(req.session.userId!, 10);
      res.json(suggestions);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/crews/:id/join-request", requireAuth, async (req, res) => {
    try {
      const result = await storage.requestToJoinCrew(req.params.id, req.session.userId!);
      if ("error" in result) {
        if (result.error === "member_cap_reached") {
          return res.status(400).json({ message: "This crew has reached its 100-member limit. The crew chief needs to upgrade.", code: "MEMBER_CAP_REACHED" });
        }
        return res.status(400).json({ message: result.error });
      }
      const crew = await storage.getCrewById(req.params.id);
      if (crew) {
        const chief = await storage.getUserById(crew.created_by);
        const requester = await storage.getUserById(req.session.userId!);
        if (userWantsNotif(chief, 'crew_activity')) {
          sendPushNotification(
            chief!.push_token,
            `New join request for ${crew.name}`,
            `${requester?.name ?? "Someone"} wants to join your crew`,
            { crewId: crew.id, screen: "crew-requests" }
          );
        }
      }
      res.json(result);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/crews/:id/join-requests", requireAuth, async (req, res) => {
    try {
      const crew = await storage.getCrewById(req.params.id);
      if (!crew) return res.status(404).json({ message: "Crew not found" });
      if (crew.created_by !== req.session.userId!) return res.status(403).json({ message: "Only the Crew Chief can view requests" });
      const requests = await storage.getCrewJoinRequests(req.params.id);
      res.json(requests);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/crews/:id/join-requests/:requesterId/respond", requireAuth, async (req, res) => {
    try {
      const crew = await storage.getCrewById(req.params.id);
      if (!crew) return res.status(404).json({ message: "Crew not found" });
      if (crew.created_by !== req.session.userId!) return res.status(403).json({ message: "Only the Crew Chief can respond to requests" });
      const { accept } = req.body;
      await storage.respondToCrewJoinRequest(req.params.id, req.params.requesterId, !!accept);
      const requester = await storage.getUserById(req.params.requesterId);
      if (userWantsNotif(requester, 'crew_activity')) {
        sendPushNotification(
          requester!.push_token,
          accept ? `You're in! 🎉` : `Join request for ${crew.name}`,
          accept
            ? `${crew.name} accepted your request to join`
            : `Your request to join ${crew.name} was declined`,
          { crewId: crew.id }
        );
      }
      res.json({ ok: true });
    } catch (e: any) {
      if ((e as any).code === "MEMBER_CAP_REACHED") return res.status(400).json({ message: e.message, code: "MEMBER_CAP_REACHED" });
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/crews/:id", requireAuth, async (req, res) => {
    try {
      const crew = await storage.getCrewById(req.params.id);
      if (!crew) return res.status(404).json({ message: "Crew not found" });
      res.json(crew);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/crews/:id/invite", requireAuth, async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ message: "userId required" });
      await storage.inviteUserToCrew(req.params.id, userId, req.session.userId!);
      const invitedUser = await storage.getUserById(userId);
      const crew = await storage.getCrewById(req.params.id);
      if (crew && userWantsNotif(invitedUser, 'crew_activity')) {
        const inviter = await storage.getUserById(req.session.userId!);
        sendPushNotification(
          invitedUser!.push_token,
          `You've been invited to ${crew.name} 🏃`,
          `${inviter?.name ?? "Someone"} invited you to join their crew`,
          { crewId: req.params.id }
        );
      }
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/crews/:id", requireAuth, async (req, res) => {
    try {
      await storage.disbandCrewById(req.params.id, req.session.userId!);
      res.json({ ok: true });
    } catch (e: any) { res.status(e.message?.includes("Only the creator") ? 403 : 500).json({ message: e.message }); }
  });

  app.delete("/api/crews/:id/members/:memberId", requireAuth, async (req, res) => {
    try {
      await storage.removeCrewMember(req.params.id, req.session.userId!, req.params.memberId);
      res.json({ ok: true });
    } catch (e: any) {
      const status = e.message?.includes("Only the Crew Chief") ? 403 : e.message?.includes("not found") ? 404 : 500;
      res.status(status).json({ message: e.message });
    }
  });

  app.put("/api/crews/:crewId/members/:userId/role", requireAuth, async (req, res) => {
    try {
      const callerId = req.session.userId!;
      const { crewId, userId } = req.params;
      const { role } = req.body;
      if (!["officer", "member", "crew_chief"].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      const callerRole = await storage.getCrewMemberRole(crewId, callerId);
      if (callerRole !== "crew_chief") {
        return res.status(403).json({ message: "Only the Crew Chief can change roles" });
      }
      if (userId === callerId) {
        return res.status(400).json({ message: "You cannot change your own role" });
      }
      await storage.setCrewMemberRole(crewId, userId, role, callerId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/crews/:id/leave", requireAuth, async (req, res) => {
    try {
      const result = await storage.leaveCrewById(req.params.id, req.session.userId!);
      res.json({ ok: true, disbanded: result?.disbanded ?? false });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch("/api/crews/:id/mute", requireAuth, async (req, res) => {
    try {
      const muted = await storage.toggleCrewChatMute(req.params.id, req.session.userId!);
      res.json({ muted });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/crews/:id/runs", requireAuth, async (req, res) => {
    try {
      const runs = await storage.getCrewRuns(req.params.id);
      res.json(runs);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/crews/:id/history", requireAuth, async (req, res) => {
    try {
      const history = await storage.getCrewRunHistory(req.params.id);
      res.json(history);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/crews/:id/achievements", requireAuth, async (req, res) => {
    try {
      const data = await storage.getCrewAchievements(req.params.id);
      res.json(data);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/crews/:id/subscription", requireAuth, async (req, res) => {
    try {
      const status = await storage.getCrewSubscriptionStatus(req.params.id);
      if (!status) return res.status(404).json({ message: "Crew not found" });
      res.json(status);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/webhooks/revenuecat", async (req, res) => {
    try {
      const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
      if (!webhookSecret && process.env.NODE_ENV === "production") {
        console.error("[revenuecat webhook] REVENUECAT_WEBHOOK_SECRET not set in production — rejecting request");
        return res.status(500).json({ message: "Webhook not configured" });
      }
      if (webhookSecret) {
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${webhookSecret}`) {
          return res.status(401).json({ message: "Unauthorized" });
        }
      }
      const event = req.body?.event;
      if (!event) return res.status(200).json({ ok: true });
      const { type, app_user_id, product_id } = event;
      if (!app_user_id || !product_id) return res.status(200).json({ ok: true });
      const crewId = app_user_id.replace('crew_', '');
      const crew = await storage.getCrewById(crewId);
      if (!crew) return res.status(200).json({ ok: true });
      const subStatus = await storage.getCrewSubscriptionStatus(crewId);
      const currentTier = subStatus.subscription_tier;
      const isGrowth = product_id === 'crew_growth_monthly';
      const isBoost = product_id === 'crew_discovery_boost_monthly';
      const isPurchase = ['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE'].includes(type);
      const isCancellation = ['CANCELLATION', 'EXPIRATION'].includes(type);
      const hasGrowth = currentTier === 'growth' || currentTier === 'both';
      const hasBoost = currentTier === 'discovery_boost' || currentTier === 'both';

      let newHasGrowth = hasGrowth;
      let newHasBoost = hasBoost;

      if (isPurchase) {
        if (isGrowth) newHasGrowth = true;
        if (isBoost) newHasBoost = true;
      } else if (isCancellation) {
        if (isGrowth) newHasGrowth = false;
        if (isBoost) newHasBoost = false;
      }

      const newTier = newHasGrowth && newHasBoost ? 'both'
        : newHasGrowth ? 'growth'
        : newHasBoost ? 'discovery_boost'
        : 'none';

      if (newTier !== currentTier) {
        await storage.updateCrewSubscription(crewId, newTier);
      }
      res.status(200).json({ ok: true });
    } catch (e: any) {
      console.error("[revenuecat webhook]", e.message);
      res.status(200).json({ ok: true });
    }
  });

  app.get("/api/gifs/search", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const limit = Math.min(Number(req.query.limit) || 20, 50);
      const apiKey = process.env.GIPHY_API_KEY;
      if (!apiKey) return res.status(500).json({ message: "GIPHY API key not configured" });
      const url = q
        ? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(q)}&limit=${limit}&rating=g`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=${limit}&rating=g`;
      const resp = await fetch(url);
      const json = await resp.json() as any;
      const gifs = (json.data || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        gif_url: item.images?.fixed_height?.url || item.images?.original?.url || "",
        preview_url: item.images?.fixed_height_still?.url || item.images?.fixed_height?.url || "",
      }));
      res.json(gifs);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/dm/conversations", requireAuth, async (req, res) => {
    try {
      const convos = await storage.getDmConversations(req.session.userId!);
      res.json(convos);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/dm/unread-count", requireAuth, async (req, res) => {
    try {
      const count = await storage.getDmUnreadCount(req.session.userId!);
      res.json({ count });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/dm/:friendId", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const messages = await storage.getDmThread(req.session.userId!, req.params.friendId, limit);
      res.json(messages);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/dm/:friendId", requireAuth, async (req, res) => {
    try {
      const { message, gif_url, gif_preview_url } = req.body;
      const isGif = !!gif_url;
      if (!message?.trim() && !isGif) return res.status(400).json({ message: "Message required" });
      const messageType = isGif ? "gif" : "text";
      const metadata = isGif ? { gif_url, gif_preview_url } : undefined;
      const dm = await storage.sendDm(
        req.session.userId!,
        req.params.friendId,
        (message ?? "").trim(),
        messageType,
        metadata
      );
      res.json(dm);
      // Fire push notification to recipient (non-blocking)
      Promise.all([
        storage.getUserById(req.session.userId!),
        storage.getUserById(req.params.friendId),
      ]).then(([sender, recipient]) => {
        if (sender && recipient?.push_token && recipient.notifications_enabled !== false) {
          const body = isGif ? "Sent you a GIF 🏃" : (message ?? "").trim();
          sendPushNotification(
            recipient.push_token,
            sender.name,
            body,
            { screen: "dm", friendId: req.session.userId! }
          );
        }
      }).catch((err: any) => console.error("[bg]", err?.message ?? err));
    } catch (e: any) {
      if (e.message === "Not friends") return res.status(403).json({ message: "Not friends" });
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/dm/:friendId/read", requireAuth, async (req, res) => {
    try {
      await storage.markDmRead(req.session.userId!, req.params.friendId);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/dm/:friendId", requireAuth, async (req, res) => {
    try {
      await storage.deleteDmThread(req.session.userId!, req.params.friendId);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── Garmin Connect OAuth 1.0a ───────────────────────────────────────────────

  app.get("/api/garmin/status", requireAuth, async (req, res) => {
    try {
      const token = await storage.getGarminToken(req.session.userId!);
      let lastSync: string | null = null;
      if (token) {
        const result = await storage.getGarminLastSync(req.session.userId!);
        lastSync = result;
      }
      res.json({ connected: !!token, lastSync });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/garmin/auth", requireAuth, async (req, res) => {
    try {
      const oauthInst = makeGarminOAuth();
      if (!oauthInst) return res.status(503).json({ message: "Garmin integration is not configured. Add GARMIN_CONSUMER_KEY and GARMIN_CONSUMER_SECRET." });
      const callbackUrl = `${req.protocol}://${req.get("host")}/api/garmin/callback`;
      const reqResp = await garminFetch(GARMIN_REQUEST_TOKEN_URL + `?oauth_callback=${encodeURIComponent(callbackUrl)}`, "POST", oauthInst);
      const body = await reqResp.text();
      const params = new URLSearchParams(body);
      const requestToken = params.get("oauth_token");
      const requestSecret = params.get("oauth_token_secret");
      if (!requestToken || !requestSecret) return res.status(500).json({ message: "Failed to obtain request token from Garmin." });
      (req.session as any).garminRequestSecret = requestSecret;
      await new Promise<void>((r) => req.session.save(() => r()));
      res.json({ authUrl: `${GARMIN_AUTH_URL}?oauth_token=${requestToken}` });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/garmin/callback", async (req: any, res) => {
    try {
      const { oauth_token, oauth_verifier } = req.query as Record<string, string>;
      const userId = req.session?.userId as string | undefined;
      if (!userId || !oauth_token || !oauth_verifier) {
        return res.status(400).send("Missing OAuth parameters or session expired. Please try connecting Garmin again.");
      }
      const oauthInst = makeGarminOAuth();
      if (!oauthInst) return res.status(503).send("Garmin integration is not configured.");
      const request = { url: GARMIN_ACCESS_TOKEN_URL, method: "POST" };
      const authData = oauthInst.authorize(request, { key: oauth_token, secret: "" });
      const authHeader = oauthInst.toHeader({ ...authData, oauth_verifier });
      const accResp = await fetch(GARMIN_ACCESS_TOKEN_URL, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/x-www-form-urlencoded" },
        body: `oauth_verifier=${encodeURIComponent(oauth_verifier)}`,
      });
      if (!accResp.ok) {
        const errText = await accResp.text();
        return res.status(500).send(`Garmin token exchange failed: ${errText}`);
      }
      const accBody = await accResp.text();
      const accParams = new URLSearchParams(accBody);
      const accessToken = accParams.get("oauth_token");
      const accessSecret = accParams.get("oauth_token_secret");
      if (!accessToken || !accessSecret) return res.status(500).send("Invalid token response from Garmin.");
      await storage.saveGarminToken(userId, accessToken, accessSecret);
      res.send(`<!DOCTYPE html><html><head><title>PaceUp — Garmin Connected</title><style>body{background:#050C09;color:#fff;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;} h1{color:#00D97E;font-size:24px;} p{color:#aaa;margin-top:8px;}</style></head><body><h1>Garmin Connected!</h1><p>You can now return to the PaceUp app.</p></body></html>`);
    } catch (e: any) { res.status(500).send(`Error: ${e.message}`); }
  });

  app.post("/api/garmin/disconnect", requireAuth, async (req, res) => {
    try {
      await storage.saveGarminToken(req.session.userId!, "", "");
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/garmin/sync", requireAuth, async (req, res) => {
    try {
      const oauthInst = makeGarminOAuth();
      if (!oauthInst) return res.status(503).json({ message: "Garmin integration is not configured." });
      const tokenRow = await storage.getGarminToken(req.session.userId!);
      if (!tokenRow) return res.status(401).json({ message: "Garmin account not connected." });
      const token = { key: tokenRow.access_token, secret: tokenRow.token_secret };
      const since = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
      const activitiesUrl = `${GARMIN_ACTIVITIES_URL}?uploadStartTimeInSeconds=${since}&uploadEndTimeInSeconds=${Math.floor(Date.now() / 1000)}`;
      const resp = await garminFetch(activitiesUrl, "GET", oauthInst, token);
      const data = await resp.json();
      const activities: any[] = Array.isArray(data) ? data : data.activityList ?? [];
      let imported = 0;
      for (const act of activities) {
        const garminId = String(act.activityId ?? act.summaryId ?? "");
        if (!garminId) continue;
        const distMeters = act.distanceInMeters ?? act.totalDistanceInMeters ?? 0;
        const distMiles = distMeters * 0.000621371;
        const durationSec = act.durationInSeconds ?? act.timerDuration ?? null;
        const avgPaceSecPerMeter = durationSec && distMeters > 0 ? durationSec / distMeters : null;
        const paceMinPerMile = avgPaceSecPerMeter ? (avgPaceSecPerMeter * 1609.34) / 60 : null;
        const actTypeLower = (act.activityType ?? "").toLowerCase();
        const actType = actTypeLower.includes("cycl") ? "ride" : actTypeLower.includes("walk") || actTypeLower.includes("hik") ? "walk" : "run";
        const actTypeLabel = actType === "ride" ? "Garmin Ride" : actType === "walk" ? "Garmin Walk" : "Garmin Run";
        const wasNew = await storage.saveGarminActivity(req.session.userId!, garminId, {
          title: act.activityName ?? actTypeLabel,
          date: new Date((act.startTimeInSeconds ?? Math.floor(Date.now() / 1000)) * 1000),
          distanceMiles: distMiles,
          paceMinPerMile,
          durationSeconds: durationSec,
          activityType: actType,
        });
        if (wasNew) imported++;
      }
      res.json({ imported, total: activities.length });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/health/import", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session.userId!;
      const { workouts } = req.body;
      if (!Array.isArray(workouts) || workouts.length === 0) {
        return res.status(400).json({ message: "No workouts provided" });
      }

      let imported = 0;
      for (const w of workouts) {
        if (!w.id || !w.activityType || !w.startDate || !w.distanceMeters || !w.durationSeconds) continue;

        const distMiles = w.distanceMeters / 1609.344;
        const paceMinPerMile = w.durationSeconds > 0 && distMiles > 0
          ? (w.durationSeconds / 60) / distMiles
          : null;

        const typeMap: Record<string, string> = { run: "run", ride: "ride", walk: "walk" };
        const actType = typeMap[w.activityType] || "run";
        const title = `${actType === "ride" ? "Ride" : actType === "walk" ? "Walk" : "Run"} via ${w.sourceName || "Apple Health"}`;

        const wasNew = await storage.saveHealthKitActivity(userId, w.id, {
          title,
          date: new Date(w.startDate),
          distanceMiles: Math.round(distMiles * 100) / 100,
          paceMinPerMile: paceMinPerMile ? Math.round(paceMinPerMile * 100) / 100 : null,
          durationSeconds: Math.round(w.durationSeconds),
          activityType: actType,
        });
        if (wasNew) imported++;
      }
      res.json({ imported, total: workouts.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/seed-runs", requireAuth, async (req: any, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ message: "Not available in production" });
    }
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
