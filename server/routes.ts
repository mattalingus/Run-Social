import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import multer from "multer";
import nodemailer from "nodemailer";
import * as storage from "./storage";
import { pool } from "./storage";
import * as ai from "./ai";
import { generateDummyRuns, clearAndReseedRuns, getRunCount } from "./seed";
import { seedCommunityPaths } from "./seed-paths";
import { uploadPhotoBuffer, streamObject } from "./objectStorage";
import { sendPushNotification, userWantsNotif } from "./notifications";
import crypto from "crypto";
import OAuth from "oauth-1.0a";

const GARMIN_REQUEST_TOKEN_URL = "https://connectapi.garmin.com/oauth-service/oauth/request_token";
const GARMIN_AUTH_URL = "https://connect.garmin.com/oauthConfirm";
const GARMIN_ACCESS_TOKEN_URL = "https://connectapi.garmin.com/oauth-service/oauth/access_token";
const GARMIN_ACTIVITIES_URL = "https://apis.garmin.com/wellness-api/rest/activities";

// Server-side map: oauth_token (request token) → { userId, requestSecret }
// Bypasses session cookie loss when the in-app browser redirects back for the callback.
const garminPendingTokens = new Map<string, { userId: string; requestSecret: string }>();

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

const ALLOWED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic"]);

function validateUploadExtension(originalname: string): string | null {
  const ext = originalname.includes(".")
    ? originalname.split(".").pop()!.toLowerCase()
    : "";
  return ext && ALLOWED_IMAGE_EXTENSIONS.has(ext) ? ext : null;
}

function requireAuth(req: Request, res: Response, next: Function) {
  if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
  next();
}

function formatPaceStr(avgPaceDecimal: number): string {
  const totalSec = Math.round(avgPaceDecimal * 60);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function postCrewRunRecap(runId: string): Promise<void> {
  const run = await storage.getRunById(runId);
  if (!run?.crew_id) return;
  const crew = await storage.getCrewById(run.crew_id);
  if (!crew) return;
  const statsRes = await pool.query(
    `SELECT COUNT(*) AS cnt, AVG(final_pace) AS avg_pace, AVG(final_distance) AS avg_dist
     FROM run_participants
     WHERE run_id = $1 AND final_pace IS NOT NULL AND final_pace > 0`,
    [runId]
  );
  const finisherCount = parseInt(statsRes.rows[0].cnt ?? "0");
  if (finisherCount < 2) return;
  const avgPace = parseFloat(statsRes.rows[0].avg_pace ?? "0");
  const avgDist = parseFloat(statsRes.rows[0].avg_dist ?? "0");
  const paceStr = avgPace > 0 ? formatPaceStr(avgPace) : "unknown";
  const recap = await ai.generateCrewRecap(crew.name, run.title, finisherCount, paceStr);
  const distPart = avgDist > 0 ? ` · ${avgDist.toFixed(1)} mi avg` : "";
  await storage.createCrewMessage(
    run.crew_id, "system", "PaceUp Bot", null,
    recap || `${crew.name} wrapped "${run.title}" — ${finisherCount} runners, ${paceStr} avg pace${distPart}.`,
    "milestone"
  );
}

export async function registerRoutes(app: Express): Promise<Server> {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET environment variable is required but not set");
  }

  await storage.initDb();
  await storage.cleanupStalePlannedRuns();

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
      secret: process.env.SESSION_SECRET,
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

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests, please try again later" },
  });

  app.post("/api/auth/register", authLimiter, async (req, res) => {
    try {
      const { email, password, firstName, lastName, username, gender } = req.body;
      if (!email || !password || !firstName || !lastName || !username) return res.status(400).json({ message: "All fields required" });
      if (gender && !["Man", "Woman", "Prefer not to say"].includes(gender)) return res.status(400).json({ message: "Invalid gender selection" });
      if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      if (!/^[^\s@]{2,30}$/.test(username) || !/[a-zA-Z0-9]/.test(username)) return res.status(400).json({ message: "Username must be 2–30 characters, contain no spaces or @, and include at least one letter or number" });
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
      if (e?.code === "23505") {
        return res.status(400).json({ message: "Email or username already taken" });
      }
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/auth/login", authLimiter, async (req, res) => {
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

  app.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email is required" });
      const user = await storage.getUserByEmail(email.trim());
      if (!user) return res.json({ ok: true });
      const token = await storage.createPasswordResetToken(user.id);
      const host = process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}:5000`
        : "https://PaceUp.replit.app";
      const resetUrl = `${host}/auth/reset?token=${token}`;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      if (!smtpUser || !smtpPass) {
        console.error("[forgot-password] SMTP_USER or SMTP_PASS not configured");
        return res.json({ ok: true });
      }
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transporter.sendMail({
        from: `"PaceUp" <${smtpUser}>`,
        to: user.email,
        subject: "Reset your PaceUp password",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
            <h2 style="color:#00D97E;">PaceUp</h2>
            <p>Hi ${user.name},</p>
            <p>We received a request to reset your password. Click the button below to choose a new one:</p>
            <a href="${resetUrl}" style="display:inline-block;background:#00D97E;color:#fff;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:bold;margin:16px 0;">Reset Password</a>
            <p style="color:#666;font-size:13px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
      });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[forgot-password]", e.message);
      res.json({ ok: true });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) return res.status(400).json({ message: "Token and password required" });
      if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      const userId = await storage.consumePasswordResetToken(token);
      if (!userId) return res.status(400).json({ message: "Invalid or expired reset link" });
      await storage.updateUserPassword(userId, password);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/auth/reset", (req, res) => {
    const token = req.query.token as string || "";
    res.send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset Password — PaceUp</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#050C09;color:#e8ede9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#0D1510;border-radius:20px;padding:32px;max-width:400px;width:100%}
h1{color:#00D97E;font-size:24px;margin-bottom:6px}
.sub{color:#8a9b8e;font-size:14px;margin-bottom:24px}
label{display:block;color:#8a9b8e;font-size:13px;margin-bottom:6px}
input{width:100%;padding:14px;border-radius:12px;border:1px solid #1a2a1f;background:#0A1410;color:#e8ede9;font-size:16px;margin-bottom:16px;outline:none}
input:focus{border-color:#00D97E}
.btn{width:100%;padding:14px;border-radius:14px;border:none;background:#00D97E;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
.btn:disabled{opacity:.5;cursor:default}
.msg{text-align:center;padding:12px;border-radius:10px;margin-top:12px;font-size:14px}
.msg.ok{background:#00D97E22;color:#00D97E}
.msg.err{background:#ff444422;color:#ff6b6b}
.open-app{display:block;text-align:center;margin-top:16px;color:#00D97E;font-size:14px}
</style>
</head><body>
<div class="card">
<h1>Reset Password</h1>
<p class="sub">Enter a new password for your PaceUp account.</p>
<form id="f" onsubmit="return go(event)">
<input type="hidden" name="token" value="${token.replace(/"/g,"&quot;")}">
<label>New Password</label>
<input type="password" id="pw" minlength="6" required placeholder="At least 6 characters">
<label>Confirm Password</label>
<input type="password" id="pw2" minlength="6" required placeholder="Re-enter password">
<button type="submit" class="btn" id="sub">Reset Password</button>
</form>
<div id="msg"></div>
<a class="open-app" href="paceup://reset-password?token=${token.replace(/"/g,"&quot;")}">Open in PaceUp app instead</a>
</div>
<script>
async function go(e){
  e.preventDefault();
  var pw=document.getElementById("pw").value,pw2=document.getElementById("pw2").value,m=document.getElementById("msg"),s=document.getElementById("sub");
  if(pw!==pw2){m.className="msg err";m.textContent="Passwords don't match";return false}
  s.disabled=true;s.textContent="Resetting...";
  try{
    var r=await fetch("/api/auth/reset-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:document.querySelector('[name=token]').value,password:pw})});
    var d=await r.json();
    if(r.ok){m.className="msg ok";m.textContent="Password reset! You can now log in with your new password.";document.getElementById("f").style.display="none"}
    else{m.className="msg err";m.textContent=d.message||"Reset failed";s.disabled=false;s.textContent="Reset Password"}
  }catch(x){m.className="msg err";m.textContent="Network error, try again";s.disabled=false;s.textContent="Reset Password"}
  return false
}
</script>
</body></html>`);
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
      const allowed = ["name", "avgPace", "avgDistance", "photoUrl", "notificationsEnabled", "distanceUnit", "profilePrivacy", "notifRunReminders", "notifFriendRequests", "notifCrewActivity", "notifWeeklySummary", "showRunRoutes", "gender", "appleHealthConnected", "healthConnectConnected"];
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

  app.post("/api/users/me/onboarding", requireAuth, async (req, res) => {
    try {
      const { activityType, monthlyGoal, yearlyGoal } = req.body;
      const activity = ["run", "ride", "walk"].includes(activityType) ? activityType : "run";
      await storage.updateUser(req.session.userId!, { defaultActivity: activity, onboardingComplete: true });
      if (monthlyGoal !== undefined || yearlyGoal !== undefined) {
        const mGoal = monthlyGoal !== undefined ? parseFloat(monthlyGoal) : undefined;
        const yGoal = yearlyGoal !== undefined ? parseFloat(yearlyGoal) : undefined;
        await storage.updateGoals(
          req.session.userId!,
          mGoal && !isNaN(mGoal) ? mGoal : undefined,
          yGoal && !isNaN(yGoal) ? yGoal : undefined,
          undefined
        );
      }
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

  app.get("/api/users/me/activity-history", requireAuth, async (req, res) => {
    try {
      const { type } = req.query;
      const runs = await storage.getSoloRuns(req.session.userId!);
      const filtered = runs
        .filter((r: any) => !r.is_deleted && r.completed && (!type || (r.activity_type ?? "run") === type))
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .map((r: any) => ({
          date: r.date,
          distance_miles: r.distance_miles,
          duration_seconds: r.duration_seconds,
          move_time_seconds: r.move_time_seconds,
          elevation_gain_ft: r.elevation_gain_ft,
          activity_type: r.activity_type ?? "run",
        }));
      res.json(filtered);
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
      const targetId = req.params.id as string;
      const requesterId = req.session.userId!;

      // Self — always allowed
      if (targetId !== requesterId) {
        // Block check: if the target user has blocked the requester, return 404 (don't reveal existence)
        const blocked = await storage.isBlockedBy(requesterId, targetId);
        if (blocked) return res.status(404).json({ message: "User not found" });

        // Privacy check: respect the target user's profile visibility setting
        const privacyRow = await pool.query(
          `SELECT profile_privacy FROM users WHERE id = $1`,
          [targetId]
        );
        if (!privacyRow.rows.length) return res.status(404).json({ message: "User not found" });
        const privacy = privacyRow.rows[0].profile_privacy ?? "public";

        if (privacy === "private") {
          // Check friendship
          const friendship = await storage.getFriendshipStatus(requesterId, targetId);
          if (friendship.status !== "friends") {
            return res.status(403).json({ message: "This profile is private" });
          }
        }
      }

      const profile = await storage.getPublicUserProfile(targetId);
      if (!profile) return res.status(404).json({ message: "User not found" });
      res.json(profile);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/users/:id/stats", requireAuth, async (req, res) => {
    try {
      const targetId = req.params.id as string;
      const requesterId = req.session.userId!;
      if (targetId !== requesterId) {
        const blocked = await storage.isBlockedBy(requesterId, targetId);
        if (blocked) return res.status(404).json({ message: "User not found" });
        const privacyRow = await pool.query(
          `SELECT profile_privacy FROM users WHERE id = $1`,
          [targetId]
        );
        if (!privacyRow.rows.length) return res.status(404).json({ message: "User not found" });
        const privacy = privacyRow.rows[0].profile_privacy ?? "public";
        if (privacy === "private") {
          const friendship = await storage.getFriendshipStatus(requesterId, targetId);
          if (friendship.status !== "friends") {
            return res.status(403).json({ message: "This profile is private" });
          }
        }
      }
      const activityType = String(req.query.activityType || "run");
      const result = await pool.query(`
        SELECT
          COALESCE(
            (SELECT SUM(sr.distance_miles) FROM solo_runs sr
             WHERE sr.user_id = $1 AND sr.completed = true AND sr.is_deleted IS NOT TRUE
             AND ($2 = 'mixed' OR sr.activity_type = $2)),
            0
          ) + COALESCE(
            (SELECT SUM(rp.final_distance) FROM run_participants rp
             JOIN runs r ON r.id = rp.run_id
             WHERE rp.user_id = $1 AND rp.final_distance IS NOT NULL
             AND ($2 = 'mixed' OR r.activity_type = $2)),
            0
          ) AS total_miles,
          COALESCE(
            (SELECT COUNT(*) FROM solo_runs sr
             WHERE sr.user_id = $1 AND sr.completed = true AND sr.is_deleted IS NOT TRUE
             AND ($2 = 'mixed' OR sr.activity_type = $2)),
            0
          ) + COALESCE(
            (SELECT COUNT(*) FROM run_participants rp
             JOIN runs r ON r.id = rp.run_id
             WHERE rp.user_id = $1 AND rp.final_distance IS NOT NULL
             AND ($2 = 'mixed' OR r.activity_type = $2)),
            0
          ) AS count,
          COALESCE(
            (SELECT AVG(p) FROM (
              SELECT NULLIF(sr.pace_min_per_mile, 0) AS p
              FROM solo_runs sr
              WHERE sr.user_id = $1 AND sr.completed = true AND sr.is_deleted IS NOT TRUE
              AND ($2 = 'mixed' OR sr.activity_type = $2)
              AND sr.pace_min_per_mile IS NOT NULL AND sr.pace_min_per_mile > 0
              UNION ALL
              SELECT NULLIF(rp.final_pace, 0) AS p
              FROM run_participants rp
              JOIN runs r ON r.id = rp.run_id
              WHERE rp.user_id = $1 AND rp.final_pace IS NOT NULL AND rp.final_pace > 0
              AND r.is_completed = true AND r.is_deleted IS NOT TRUE
              AND ($2 = 'mixed' OR r.activity_type = $2)
            ) paces),
            0
          ) AS avg_pace
      `, [targetId, activityType]);
      const row = result.rows[0];
      res.json({
        total_miles: parseFloat(row?.total_miles ?? 0),
        count: parseInt(row?.count ?? 0),
        avg_pace: parseFloat(row?.avg_pace ?? 0),
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── Block / Unblock ──────────────────────────────────────────────────────

  app.get("/api/users/:id/block-status", requireAuth, async (req, res) => {
    try {
      const targetId = req.params.id as string;
      const requesterId = req.session.userId!;
      if (targetId === requesterId) return res.json({ amBlocking: false, amBlockedBy: false });
      const [amBlocking, amBlockedBy] = await Promise.all([
        storage.isBlocking(requesterId, targetId),
        storage.isBlockedBy(requesterId, targetId),
      ]);
      res.json({ amBlocking, amBlockedBy });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/users/:id/block", requireAuth, async (req, res) => {
    try {
      const targetId = req.params.id as string;
      const requesterId = req.session.userId!;
      if (targetId === requesterId) return res.status(400).json({ message: "Cannot block yourself" });
      await storage.blockUser(requesterId, targetId);
      // Remove any existing friendship between the two users
      await pool.query(
        `DELETE FROM friendships WHERE (requester_id = $1 AND recipient_id = $2) OR (requester_id = $2 AND recipient_id = $1)`,
        [requesterId, targetId]
      );
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/users/:id/block", requireAuth, async (req, res) => {
    try {
      const targetId = req.params.id as string;
      await storage.unblockUser(req.session.userId!, targetId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/users/:id/friendship", requireAuth, async (req, res) => {
    try {
      if (req.params.id as string === req.session.userId) return res.json({ status: "self", friendshipId: null });
      const status = await storage.getFriendshipStatus(req.session.userId!, req.params.id as string);
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
      // Block guard: deny if either user has blocked the other
      const [iBlocked, theyBlocked] = await Promise.all([
        storage.isBlocking(req.session.userId!, userId),
        storage.isBlockedBy(req.session.userId!, userId),
      ]);
      if (iBlocked || theyBlocked) return res.status(404).json({ message: "User not found" });
      const result = await storage.sendFriendRequest(req.session.userId!, userId);
      if (result.error) return res.status(400).json({ message: result.error === "already_friends" ? "Already friends" : "Request already sent" });
      res.json(result.data);
      // Push notification to recipient — fire and forget
      Promise.all([
        pool.query(`SELECT name FROM users WHERE id = $1`, [req.session.userId!]),
        pool.query(`SELECT push_token, notifications_enabled, notif_friend_requests FROM users WHERE id = $1`, [userId]),
      ]).then(([senderRes, recipientRes]) => {
        const sender = senderRes.rows[0];
        const recipient = recipientRes.rows[0];
        if (sender && recipient && userWantsNotif(recipient, "friend_requests")) {
          sendPushNotification(
            recipient.push_token,
            "New Friend Request",
            `${sender.name} wants to connect on PaceUp`,
            { screen: "notifications" }
          ).catch((err: any) => console.error("[push] friend request notification failed:", err?.message ?? err));
        }
      }).catch((err: any) => console.error("[bg] friend request notification:", err?.message ?? err));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/friends/:id/accept", requireAuth, async (req, res) => {
    try {
      const friendship = await storage.acceptFriendRequest(req.params.id as string, req.session.userId!);
      if (!friendship) return res.status(404).json({ message: "Request not found" });
      storage.checkFriendAchievements(req.session.userId!).catch((err: any) => console.error("[bg]", err?.message ?? err));
      if (friendship.requester_id) {
        storage.checkFriendAchievements(friendship.requester_id).catch((err: any) => console.error("[bg]", err?.message ?? err));
        // Push to the original requester — fire and forget
        Promise.all([
          pool.query(`SELECT name FROM users WHERE id = $1`, [req.session.userId!]),
          pool.query(`SELECT push_token, notifications_enabled, notif_friend_requests FROM users WHERE id = $1`, [friendship.requester_id]),
        ]).then(([acceptorRes, requesterRes]) => {
          const acceptor = acceptorRes.rows[0];
          const requester = requesterRes.rows[0];
          if (acceptor && requester && userWantsNotif(requester, "friend_requests")) {
            sendPushNotification(
              requester.push_token,
              "Friend Request Accepted",
              `${acceptor.name} accepted your friend request`,
              { screen: "notifications" }
            ).catch((err: any) => console.error("[push] friend accept notification failed:", err?.message ?? err));
          }
        }).catch((err: any) => console.error("[bg] friend accept notification:", err?.message ?? err));
      }
      res.json(friendship);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/friends/:id", requireAuth, async (req, res) => {
    try {
      await storage.removeFriend(req.params.id as string, req.session.userId!);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/runs", async (req, res) => {
    try {
      const filters: any = {};
      const parseFloatGuarded = (val: string, field: string): number => {
        const n = parseFloat(val);
        if (isNaN(n)) throw Object.assign(new Error(`Invalid numeric value for ${field}`), { status: 400 });
        return n;
      };
      if (req.query.minPace as string) filters.minPace = parseFloatGuarded(req.query.minPace as string, "minPace");
      if (req.query.maxPace as string) filters.maxPace = parseFloatGuarded(req.query.maxPace as string, "maxPace");
      if (req.query.minDistance as string) filters.minDistance = parseFloatGuarded(req.query.minDistance as string, "minDistance");
      if (req.query.maxDistance as string) filters.maxDistance = parseFloatGuarded(req.query.maxDistance as string, "maxDistance");
      if (req.query.tag as string) filters.tag = req.query.tag as string;
      if (req.query.styles as string) {
        const raw = req.query.styles as string;
        filters.styles = raw.split(",").map(s => s.trim()).filter(Boolean);
      }
      if (req.query.swLat as string) filters.swLat = parseFloatGuarded(req.query.swLat as string, "swLat");
      if (req.query.swLng as string) filters.swLng = parseFloatGuarded(req.query.swLng as string, "swLng");
      if (req.query.neLat as string) filters.neLat = parseFloatGuarded(req.query.neLat as string, "neLat");
      if (req.query.neLng as string) filters.neLng = parseFloatGuarded(req.query.neLng as string, "neLng");
      const bounds = (filters.swLat !== undefined && filters.neLat !== undefined && filters.swLng !== undefined && filters.neLng !== undefined)
        ? { swLat: filters.swLat, neLat: filters.neLat, swLng: filters.swLng, neLng: filters.neLng }
        : undefined;
      const [publicRuns, publicCrewRuns] = await Promise.all([
        storage.getPublicRuns(filters),
        storage.getPublicCrewRuns(bounds),
      ]);
      if (req.session.userId) {
        const [friendLocked, invited, crewRuns, userCrewRows] = await Promise.all([
          storage.getFriendPrivateRuns(req.session.userId, bounds),
          storage.getInvitedPrivateRuns(req.session.userId, bounds),
          storage.getCrewVisibleRuns(req.session.userId, bounds),
          storage.getUserCrewIds(req.session.userId),
        ]);
        const userCrewIds = new Set(userCrewRows.map((r: any) => r.crew_id));
        const combined = [...publicRuns, ...publicCrewRuns, ...invited, ...friendLocked, ...crewRuns];
        const seen = new Set<string>();
        const deduped = combined.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
        deduped.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const annotated = deduped.map(r => ({ ...r, user_is_crew_member: r.crew_id ? userCrewIds.has(r.crew_id) : true }));
        return res.json(annotated);
      }
      const unauthCombined = [...publicRuns, ...publicCrewRuns];
      const unauthSeen = new Set<string>();
      const unauthDeduped = unauthCombined.filter(r => { if (unauthSeen.has(r.id)) return false; unauthSeen.add(r.id); return true; });
      unauthDeduped.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const unauthAnnotated = unauthDeduped.map(r => ({ ...r, user_is_crew_member: r.crew_id ? false : true }));
      res.json(unauthAnnotated);
    } catch (e: any) {
      res.status(e.status ?? 500).json({ message: e.message });
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
      const { text, voice } = req.body;
      if (!text) return res.status(400).json({ message: "Text required" });
      const buffer = await ai.generateTTS(text, voice);
      if (!buffer) return res.status(500).json({ message: "TTS failed" });
      res.set("Content-Type", "audio/mpeg");
      res.send(buffer);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/solo-runs/:id/ai-summary", requireAuth, async (req, res) => {
    try {
      const run = await storage.getSoloRunById(req.params.id as string);
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
      const readAtRow = await pool.query(`SELECT notifications_read_at FROM users WHERE id = $1`, [req.session.userId!]);
      const lastReadAt = readAtRow.rows[0]?.notifications_read_at ?? null;
      res.json({ items: data, lastReadAt });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/notifications/mark-read", requireAuth, async (req, res) => {
    try {
      await pool.query(`UPDATE users SET notifications_read_at = NOW() WHERE id = $1`, [req.session.userId!]);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/friends/respond", requireAuth, async (req, res) => {
    try {
      const { friendshipId, action } = req.body;
      if (!friendshipId || !action) return res.status(400).json({ message: "friendshipId and action required" });
      // Fetch before respond so we have the requester_id for the push
      const frRow = action === "accept"
        ? await pool.query(`SELECT requester_id FROM friends WHERE id = $1 AND addressee_id = $2`, [friendshipId, req.session.userId!])
        : null;
      await storage.respondToFriendRequest(friendshipId, req.session.userId!, action);
      res.json({ success: true });
      // Push to original requester when accepted — fire and forget
      if (action === "accept" && frRow?.rows[0]?.requester_id) {
        const requesterId = frRow.rows[0].requester_id as string;
        Promise.all([
          pool.query(`SELECT name FROM users WHERE id = $1`, [req.session.userId!]),
          pool.query(`SELECT push_token, notifications_enabled, notif_friend_requests FROM users WHERE id = $1`, [requesterId]),
        ]).then(([acceptorRes, requesterRes]) => {
          const acceptor = acceptorRes.rows[0];
          const requester = requesterRes.rows[0];
          if (acceptor && requester && userWantsNotif(requester, "friend_requests")) {
            sendPushNotification(
              requester.push_token,
              "Friend Request Accepted",
              `${acceptor.name} accepted your friend request`,
              { screen: "notifications" }
            ).catch((err: any) => console.error("[push] friend accept (v2) notification failed:", err?.message ?? err));
          }
        }).catch((err: any) => console.error("[bg] friend accept (v2) notification:", err?.message ?? err));
      }
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
      const SHA256_RE = /^[0-9a-f]{64}$/i;
      const limited = phoneHashes
        .filter((h: unknown): h is string => typeof h === "string" && SHA256_RE.test(h))
        .slice(0, 5000);
      if (limited.length === 0) return res.json([]);
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
      const fbTimeout = () => AbortSignal.timeout(10000);
      const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`, { signal: fbTimeout() });
      const tokenData = await tokenRes.json() as any;
      if (!tokenData.access_token) return res.status(400).send("Failed to get access token");
      const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${tokenData.access_token}`, { signal: fbTimeout() });
      const me = await meRes.json() as any;
      if (me.id) {
        await pool.query(`UPDATE users SET facebook_id = $1 WHERE id = $2`, [me.id, storedUserId]);
        try {
          const friendsRes = await fetch(`https://graph.facebook.com/v19.0/me/friends?fields=id&limit=5000&access_token=${tokenData.access_token}`, { signal: fbTimeout() });
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
      const runs = await storage.getStarredRunsForUser(req.params.id as string, 3);
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
              `${host?.name ?? host?.username ?? "A member"} posted "${run.title}" for your crew`,
              { runId: run.id }
            );
          }
        }).catch((err: any) => console.error("[bg]", err?.message ?? err));
      } else {
        storage.getFriendsWithPushTokensFiltered(req.session.userId!, 'notif_run_reminders').then((tokens) => {
          if (tokens.length) {
            const actLabel = run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run";
            const actEmoji = run.activity_type === "ride" ? "🚴" : run.activity_type === "walk" ? "🚶" : "🏃";
            // Build distance string from min/max distance
            const minDist = parseFloat(run.min_distance ?? 0);
            const maxDist = parseFloat(run.max_distance ?? 0);
            let distStr = "";
            if (minDist > 0 && maxDist > 0 && minDist !== maxDist) {
              distStr = ` ${minDist}–${maxDist} mi`;
            } else if (maxDist > 0) {
              distStr = ` ${maxDist} mi`;
            } else if (minDist > 0) {
              distStr = ` ${minDist} mi`;
            }
            // Format scheduled date/time
            const runDate = run.date ? new Date(run.date) : null;
            let timeStr = "";
            if (runDate && !isNaN(runDate.getTime())) {
              const time = runDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
              const date = runDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
              timeStr = ` at ${time} on ${date}`;
            }
            const displayName = host?.username ? `@${host.username}` : (host?.name ?? "A friend");
            sendPushNotification(
              tokens,
              `${actEmoji} ${displayName} posted a${distStr} ${actLabel}`,
              `${timeStr ? `Scheduled${timeStr}` : run.title} — join them!`,
              { runId: run.id, screen: "run", type: "friend_run_posted" }
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
      const bounds = (req.query.swLat as string && req.query.neLat as string && req.query.swLng as string && req.query.neLng as string)
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
      const path = await storage.publishSoloRunRoute(req.params.id as string, req.session.userId!, routeName);
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
      const crewId = req.params.id as string;
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
      const crewId = req.params.id as string;
      const userId = req.session.userId!;
      const isMember = await storage.isCrewMember(crewId, userId);
      if (!isMember) return res.status(403).json({ message: "Not a crew member" });

      const { message = "", gif_url, gif_preview_url } = req.body;
      if (!message && !gif_url) return res.status(400).json({ message: "Message or GIF required" });

      const user = await storage.getUserById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
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
      const run = await storage.getRunByInviteToken((req.params.token as string).toUpperCase());
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
      const runId = req.params.id as string;
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
      const runId = req.params.id as string;
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
      if (!user) return res.status(404).json({ message: "User not found" });
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
      const run = await storage.getRunById(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.privacy !== "private") return res.json({ hasAccess: true });
      const hasAccess = await storage.hasRunAccess(req.params.id as string, req.session.userId!);
      res.json({ hasAccess, hasPassword: !!run.invite_password });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/join-private", requireAuth, async (req, res) => {
    try {
      const { password, token } = req.body;
      const result = await storage.verifyAndJoinPrivateRun(req.params.id as string, req.session.userId!, password, token);
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
      const run = await storage.getRunById(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id !== req.session.userId) return res.status(403).json({ message: "Only host can invite" });
      await storage.inviteToRun(req.params.id as string, friendId, req.session.userId!);
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
      const status = await storage.getRunStatus(req.session.userId!, req.params.id as string);
      res.json(status);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/bookmark", requireAuth, async (req, res) => {
    try {
      const run = await storage.getRunById(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      const result = await storage.toggleBookmark(req.session.userId!, req.params.id as string);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/plan", requireAuth, async (req, res) => {
    try {
      const run = await storage.getRunById(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id === req.session.userId) return res.status(400).json({ message: "You are the host" });
      const result = await storage.togglePlan(req.session.userId!, req.params.id as string);
      res.json(result);
      // Notify host only when planning (not unplanning), fire-and-forget
      if (result.planned) {
        storage.getUserById(run.host_id).then(async (host) => {
          if (host && userWantsNotif(host, 'run_reminders')) {
            const planner = await storage.getUserById(req.session.userId!);
            sendPushNotification(
              host.push_token,
              `Someone plans to ${run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run"} with you 📅`,
              `${planner?.name ?? "Someone"} is planning to join "${run.title}"`,
              { runId: run.id }
            ).catch((err: any) => console.error("[push] plan notification failed:", err?.message ?? err));
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
      const run = await storage.getRunById(req.params.id as string);
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
        const hasAccess = await storage.hasRunAccess(req.params.id as string, req.session.userId);
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
    const participants = await storage.getRunParticipants(req.params.id as string);
    res.json(participants);
  });

  app.post("/api/runs/:id/join", requireAuth, async (req, res) => {
    try {
      const run = await storage.getRunById(req.params.id as string);
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

      const paceGroupLabel = req.body.paceGroupLabel ?? null;
      let participant;
      try {
        participant = await storage.joinRun(req.params.id as string, req.session.userId!, paceGroupLabel);
      } catch (joinErr: any) {
        if (joinErr.message === "EVENT_FULL") {
          return res.status(409).json({ message: "This event is full" });
        }
        throw joinErr;
      }
      res.json(participant);
      storage.getUserById(run.host_id).then((host) => {
        if (host && userWantsNotif(host, 'run_reminders')) {
          sendPushNotification(
            host.push_token,
            `Someone joined your ${run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run"} 🎉`,
            `${user.name} joined "${run.title}"`,
            { runId: run.id }
          ).catch((err: any) => console.error("[push] join notification failed:", err?.message ?? err));
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
      await storage.joinRun(req.params.id as string, req.session.userId!, paceGroupLabel);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/request-join", requireAuth, async (req, res) => {
    try {
      const run = await storage.getRunById(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id === req.session.userId) return res.status(400).json({ message: "You are the host" });
      const runDate = new Date(run.date);
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      if (runDate < twoHoursAgo) return res.status(400).json({ message: "This event has already taken place" });
      const participantCount = await storage.getRunParticipantCount(req.params.id as string);
      if (participantCount < run.max_participants) {
        return res.status(400).json({ message: "This event is not full — you can join directly" });
      }
      const result = await storage.requestJoinRun(req.params.id as string, req.session.userId!);
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
      const prior = await storage.getParticipantStatus(req.params.id as string, req.session.userId!);
      await storage.leaveRun(req.params.id as string, req.session.userId!);
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
      const updated = await storage.updateRunDateTime(req.params.id as string, req.session.userId!, date);
      const tokens = await storage.getRunBroadcastTokens(req.params.id as string);
      if (tokens.length) {
        const newDate = new Date(updated.date);
        const label = `${newDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${newDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
        sendPushNotification(
          tokens,
          "Run time updated ⏰",
          `"${updated.title}" has been rescheduled to ${label}`,
          { runId: req.params.id as string }
        );
      }
      res.json(updated);
    } catch (e: any) {
      res.status(e.message.includes("Only the host") ? 403 : 500).json({ message: e.message });
    }
  });

  app.delete("/api/runs/:id", requireAuth, async (req, res) => {
    try {
      const result = await storage.cancelRun(req.params.id as string, req.session.userId!);
      storage.getRunBroadcastTokens(req.params.id as string).then((broadcastTokens) => {
        if (broadcastTokens.length) {
          sendPushNotification(
            broadcastTokens,
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
      const run = await storage.getRunById(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id !== req.session.userId) {
        return res.status(403).json({ message: "Only the host can send messages to participants" });
      }
      const tokens = await storage.getRunBroadcastTokens(req.params.id as string);
      if (tokens.length) {
        sendPushNotification(tokens, `${run.title}`, message.trim(), { runId: req.params.id as string });
      }
      res.json({ sent: tokens.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/complete", requireAuth, async (req, res) => {
    try {
      const { milesLogged } = req.body;
      const miles = parseFloat(milesLogged);
      if (!isFinite(miles) || miles <= 0) {
        return res.status(400).json({ message: "Miles logged must be a positive number" });
      }
      const result = await storage.confirmRunCompletion(req.params.id as string, req.session.userId!, miles);
      res.json({ success: result.success });

      // Fire-and-forget: post participant completion to finisher + host crew chats
      const completerId = req.session.userId!;
      const completionMiles = miles;
      const completionRunId = req.params.id as string;
      (async () => {
        try {
          const run = await storage.getRunById(completionRunId);
          const hostId = run?.host_id;
          const [user, finisherCrews, hostCrews] = await Promise.all([
            storage.getUserById(completerId),
            storage.getUserCrewIds(completerId),
            hostId && hostId !== completerId ? storage.getUserCrewIds(hostId) : Promise.resolve([]),
          ]);
          if (!user) return;
          const allCrewIdSet = new Set<string>([
            ...finisherCrews.map((r: any) => r.crew_id),
            ...(hostCrews as any[]).map((r: any) => r.crew_id),
          ]);
          if (!allCrewIdSet.size) return;
          const firstName = user.name?.split(" ")[0] || user.name || "Someone";
          const activityType = run?.activity_type ?? "run";
          const aiMessage = await ai.generateSoloActivityPost(
            firstName, completionMiles, null, null, activityType
          );
          const metadata = {
            distance: completionMiles,
            pace: null,
            activityType,
            runId: completionRunId,
            isGroupRun: true,
          };
          for (const crewId of allCrewIdSet) {
            await storage.createCrewMessage(
              crewId, completerId, user.name, user.profilePhoto || null,
              aiMessage, "solo_activity", metadata
            );
          }
        } catch (bgErr: any) {
          console.error("[crew-complete-fanout]", bgErr?.message ?? bgErr);
        }
      })();

      if (result.crewStreakUpdated) {
        const runId = req.params.id as string;
        const { crewId, newStreak } = result.crewStreakUpdated;
        (async () => {
          try {
            const run = await storage.getRunById(runId);
            const crew = await storage.getCrewById(crewId);
            if (!run || !crew) return;
            const milestones = [4, 8, 12, 26, 52];
            if (milestones.includes(newStreak)) {
              const recap = await ai.generateCrewRecap(
                crew.name,
                run.title,
                (await storage.getRunParticipants(run.id)).length,
                (run.min_pace != null && run.max_pace != null
                  ? ((run.min_pace + run.max_pace) / 2).toFixed(2)
                  : "0")
              );
              await storage.createCrewMessage(
                crewId, "system", "PaceUp Bot", null,
                `🔥 ${newStreak} WEEK STREAK! ${recap || "This crew is on fire!"}`,
                "milestone"
              );
            }
            const rankings = await storage.getCrewRankings("national");
            const crewRankIdx = rankings.findIndex((r: any) => r.id === crewId);
            const crewRank = crewRankIdx === -1 ? 0 : crewRankIdx + 1;
            if (crewRank > 1 && crewRank < rankings.length) {
              const overtaken = rankings[crewRank];
              if (overtaken && overtaken.id !== crewId) {
                const nowMs = Date.now();
                const lastNotif = overtaken.last_overtake_notif_at ? new Date(overtaken.last_overtake_notif_at).getTime() : 0;
                if (nowMs - lastNotif > 60 * 60 * 1000) {
                  await storage.createCrewMessage(
                    overtaken.id, "system", "PaceUp Bot", null,
                    `⚠️ ${crew.name} just took your #${crewRank} spot — take it back!`,
                    "milestone"
                  );
                  await storage.updateCrew(overtaken.id, { last_overtake_notif_at: new Date() });
                }
              }
            }
          } catch (bgErr: any) {
            console.error("[bg] crew streak side-effects:", bgErr?.message ?? bgErr);
          }
        })();
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/runs/:id/my-rating", requireAuth, async (req, res) => {
    const rating = await storage.getUserRatingForRun(req.params.id as string, req.session.userId!);
    res.json(rating);
  });

  app.post("/api/runs/:id/rate", requireAuth, async (req, res) => {
    try {
      const run = await storage.getRunById(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      const participated = await storage.isParticipant(req.params.id as string, req.session.userId!);
      if (!participated && run.host_id !== req.session.userId) {
        return res.status(403).json({ message: "Only participants can rate" });
      }
      const { stars, tags } = req.body;
      if (!stars || stars < 1 || stars > 5) return res.status(400).json({ message: "Stars must be 1-5" });
      const result = await storage.rateHost({ runId: req.params.id as string, hostId: run.host_id, raterId: req.session.userId!, stars, tags: tags || [] });
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

  app.get("/api/solo-runs/achievements", requireAuth, async (req, res) => {
    try {
      const achievements = await storage.getSoloRunAchievements(req.session.userId!);
      res.json(achievements);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/solo-runs/:id/star", requireAuth, async (req, res) => {
    try {
      const run = await storage.toggleStarSoloRun(req.params.id as string, req.session.userId!);
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
      // Post solo activity to all crew chats in background (fire-and-forget)
      if (completed) {
        const resolvedUserId = req.session.userId!;
        const resolvedActivity = activityType === "ride" ? "ride" : activityType === "walk" ? "walk" : "run";
        const resolvedDist = parsedDist;
        const resolvedPace = parsedPace;
        const resolvedDuration = durationSeconds ? parseInt(durationSeconds) : null;
        const resolvedRunId = run.id;
        (async () => {
          try {
            const [user, crewRows, prCtx] = await Promise.all([
              storage.getUserById(resolvedUserId),
              storage.getUserCrewIds(resolvedUserId),
              storage.getUserPrContext(resolvedUserId, resolvedRunId),
            ]);
            if (!user || !crewRows.length) return;
            const firstName = user.name?.split(" ")[0] || user.name || "Someone";
            const isLongest = prCtx.maxDistance != null
              ? resolvedDist > prCtx.maxDistance
              : prCtx.totalRuns === 0;
            const isBestPace = resolvedPace != null && prCtx.bestPace != null
              ? resolvedPace < prCtx.bestPace
              : false;
            const aiMessage = await ai.generateSoloActivityPost(
              firstName, resolvedDist, resolvedPace, resolvedDuration, resolvedActivity,
              { isLongest, isBestPace, totalRuns: prCtx.totalRuns + 1 }
            );
            const metadata = {
              distance: resolvedDist,
              pace: resolvedPace,
              duration: resolvedDuration,
              activityType: resolvedActivity,
              runId: resolvedRunId,
            };
            for (const { crew_id } of crewRows) {
              await storage.createCrewMessage(
                crew_id, resolvedUserId, user.name, user.profilePhoto || null,
                aiMessage, "solo_activity", metadata
              );
            }
          } catch (err: any) {
            console.error("[crew-activity]", err?.message ?? err);
          }
        })();
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/solo-runs/:id/pr-tiers", requireAuth, async (req, res) => {
    try {
      const tiers = await storage.getSoloRunPrTiers(req.session.userId!, req.params.id as string);
      res.json(tiers);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/solo-runs/:id", requireAuth, async (req, res) => {
    try {
      const run = await storage.updateSoloRun(req.params.id as string, req.session.userId!, req.body);
      if (!run) return res.status(404).json({ message: "Run not found" });
      res.json(run);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/solo-runs/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteSoloRun(req.params.id as string, req.session.userId!);
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
      const ext = validateUploadExtension(req.file.originalname);
      if (!ext) {
        return res.status(400).json({ message: "Invalid file type. Only jpg, jpeg, png, gif, webp, and heic are allowed." });
      }
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
      const run = await storage.startGroupRun(req.params.id as string, req.session.userId!);
      res.json(run);
      const verb = run.activity_type === "ride" ? "Ride" : run.activity_type === "walk" ? "Walk" : "Run";
      Promise.all([
        storage.getRunPresentParticipantTokensFiltered(req.params.id as string, "notif_run_reminders"),
        storage.getRunParticipantTokensFiltered(req.params.id as string, "notif_run_reminders"),
      ]).then(([presentTokens, allTokens]) => {
        const presentSet = new Set(presentTokens);
        const nonPresentTokens = allTokens.filter((t) => !presentSet.has(t));
        // Already in-person → targeted auto-start notification
        if (presentTokens.length) {
          sendPushNotification(
            presentTokens,
            `${verb} is starting — tracking on! 🏃`,
            run.title,
            { type: "run_started_present", screen: "run-live", runId: req.params.id as string }
          );
        }
        // Not yet present → standard "go now" notification
        if (nonPresentTokens.length) {
          sendPushNotification(
            nonPresentTokens,
            `${verb} has started — Let's go! 🚀`,
            run.title,
            { screen: "run-live", runId: req.params.id as string }
          );
        }
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
        req.params.id as string, req.session.userId!,
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
      const state = await storage.getLiveRunState(req.params.id as string);
      if (!state) return res.status(404).json({ message: "Run not found" });
      res.json(state);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/runs/:id/host-route", async (req, res) => {
    try {
      const path = await storage.getHostRoutePath(req.params.id as string);
      res.json(path);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/runs/:id/tracking-path", async (req, res) => {
    try {
      const points = await storage.getHostRoutePath(req.params.id as string);
      res.json({ path: points });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/runner-finish", requireAuth, async (req, res) => {
    try {
      const { finalDistance, finalPace, mileSplits } = req.body;
      if (finalDistance == null || finalPace == null) return res.status(400).json({ message: "finalDistance and finalPace required" });
      const parsedDist = parseFloat(finalDistance);
      const parsedPace = parseFloat(finalPace);
      const safeDist = Number.isFinite(parsedDist) && parsedDist > 0 ? parsedDist : 0;
      const safePace = Number.isFinite(parsedPace) && parsedPace > 0 ? parsedPace : 0;
      const safeSplits = Array.isArray(mileSplits) && mileSplits.length > 0 ? mileSplits : null;
      const result = await storage.finishRunnerRun(
        req.params.id as string, req.session.userId!,
        safeDist, safePace, safeSplits
      );
      res.json({ success: result.success });
      // Fire-and-forget crew achievement check + crew recap if all finished
      const runIdForBg = req.params.id as string;
      const finisherUserId = req.session.userId!;
      const finisherDist = safeDist;
      const finisherPace = safePace;
      storage.getRunById(runIdForBg).then((run: any) => {
        if (run?.crew_id) {
          storage.checkAndAwardCrewAchievements(run.crew_id).catch((err: any) => console.error("[bg]", err?.message ?? err));
        }
      }).catch((err: any) => console.error("[bg]", err?.message ?? err));

      if (result.shouldComplete) {
        postCrewRunRecap(runIdForBg).catch((bgErr: any) =>
          console.error("[bg] crew recap (runner-finish):", bgErr?.message ?? bgErr)
        );
      }

      // Fire-and-forget: post participant finish to both their crews AND the host's crews
      if (finisherDist > 0) {
        (async () => {
          try {
            const run = await storage.getRunById(runIdForBg);
            const hostId = run?.host_id;
            const [user, finisherCrews, hostCrews] = await Promise.all([
              storage.getUserById(finisherUserId),
              storage.getUserCrewIds(finisherUserId),
              hostId && hostId !== finisherUserId ? storage.getUserCrewIds(hostId) : Promise.resolve([]),
            ]);
            if (!user) return;
            // Deduplicate crew IDs from both finisher and host
            const allCrewIdSet = new Set<string>([
              ...finisherCrews.map((r: any) => r.crew_id),
              ...(hostCrews as any[]).map((r: any) => r.crew_id),
            ]);
            if (!allCrewIdSet.size) return;
            const firstName = user.name?.split(" ")[0] || user.name || "Someone";
            const activityType = run?.activity_type ?? "run";
            const aiMessage = await ai.generateSoloActivityPost(
              firstName, finisherDist, finisherPace > 0 ? finisherPace : null, null, activityType
            );
            const metadata = {
              distance: finisherDist,
              pace: finisherPace > 0 ? finisherPace : null,
              activityType,
              runId: runIdForBg,
              isGroupRun: true,
            };
            for (const crewId of allCrewIdSet) {
              await storage.createCrewMessage(
                crewId, finisherUserId, user.name, user.profilePhoto || null,
                aiMessage, "solo_activity", metadata
              );
            }
          } catch (err: any) {
            console.error("[crew-group-finish]", err?.message ?? err);
          }
        })();
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/host-end", requireAuth, async (req, res) => {
    try {
      const run = await storage.getRunById(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id !== req.session.userId) return res.status(403).json({ message: "Only the host can end the run for everyone" });
      if (!run.is_active) return res.status(400).json({ message: "Run is not active" });
      await storage.forceCompleteRun(req.params.id as string);
      storage.finalizeTagAlongsForRun(req.params.id as string).catch((e: any) =>
        console.error('[tag-along] finalizeTagAlongsForRun error', e?.message)
      );
      res.json({ success: true });
      // Fire-and-forget: post AI crew recap to crew chat
      postCrewRunRecap(req.params.id as string).catch((bgErr: any) =>
        console.error("[bg] crew recap (host-end):", bgErr?.message ?? bgErr)
      );
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Tag-Along Endpoints ───────────────────────────────────────────────────

  app.post("/api/runs/:id/tag-along/request", requireAuth, async (req, res) => {
    try {
      const { targetUserId } = req.body;
      if (!targetUserId) return res.status(400).json({ message: "targetUserId required" });
      const requesterId = req.session.userId!;
      if (requesterId === targetUserId) return res.status(400).json({ message: "Cannot tag along with yourself" });

      const run = await storage.getRunById(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id === requesterId) return res.status(400).json({ message: "Host cannot tag along" });

      const request = await storage.createTagAlongRequest(req.params.id as string, requesterId, targetUserId);

      // Push notification to target
      const [requester, target] = await Promise.all([
        storage.getUserById(requesterId),
        storage.getUserById(targetUserId),
      ]);
      if (target?.push_token && target.notifications_enabled !== false) {
        const firstName = requester?.name?.split(" ")[0] ?? "Someone";
        sendPushNotification(
          target.push_token,
          "Tag-Along Request 🏃",
          `${firstName} wants to tag along with your GPS for "${run.title}". Accept?`,
          { type: "tag_along_request", runId: req.params.id as string, requestId: request.id }
        ).catch((err: any) => console.error("[push] tag-along request notification failed:", err?.message ?? err));
      }

      res.json(request);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/tag-along/accept/:requestId", requireAuth, async (req, res) => {
    try {
      const result = await storage.acceptTagAlongRequest(
        req.params.requestId as string,
        req.session.userId!,
        req.params.id as string
      );
      if (!result) return res.status(404).json({ message: "Request not found or already handled" });
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/tag-along/decline/:requestId", requireAuth, async (req, res) => {
    try {
      const result = await storage.declineTagAlongRequest(
        req.params.requestId as string,
        req.session.userId!,
        req.params.id as string
      );
      if (!result) return res.status(404).json({ message: "Request not found or already handled" });
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/tag-along/cancel/:requestId", requireAuth, async (req, res) => {
    try {
      const result = await storage.cancelTagAlongRequest(
        req.params.requestId as string,
        req.session.userId!,
        req.params.id as string
      );
      if (!result) return res.status(404).json({ message: "Request not found or already pending" });
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────

  app.get("/api/runs/:id/results", async (req, res) => {
    try {
      const results = await storage.getRunResults(req.params.id as string);
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
      const { name, routePath, distanceMiles, activityType, soloRunId } = req.body;
      if (!name || !routePath || !Array.isArray(routePath)) {
        return res.status(400).json({ message: "name and routePath are required" });
      }
      const path = await storage.createSavedPath(req.session.userId!, { name, routePath, distanceMiles, activityType, soloRunId: soloRunId || null });
      storage.matchCommunityPath(req.session.userId!, path.id, routePath, distanceMiles ?? null).catch(console.error);
      res.json(path);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/saved-paths/:id/share", requireAuth, async (req, res) => {
    try {
      const { toUserId } = req.body;
      if (!toUserId) return res.status(400).json({ message: "toUserId required" });
      const share = await storage.sharePathWithFriend(req.session.userId!, req.params.id as string, toUserId);
      res.json(share);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/saved-paths/:id/clone", requireAuth, async (req, res) => {
    try {
      const cloned = await storage.cloneSharedPath(req.params.id as string, req.session.userId!);
      res.json(cloned);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/saved-paths/:id/publish", requireAuth, async (req, res) => {
    try {
      const result = await storage.publishSavedPath(req.params.id as string, req.session.userId!);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/saved-paths/:id/runs", requireAuth, async (req, res) => {
    try {
      const runs = await storage.getSoloRunsByPathId(req.session.userId!, req.params.id as string);
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
      const path = await storage.updateSavedPath(req.params.id as string, req.session.userId!, name.trim());
      if (!path) return res.status(404).json({ message: "Path not found" });
      res.json(path);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/saved-paths/:id", requireAuth, async (req, res) => {
    try {
      const result = await storage.deleteSavedPath(req.params.id as string, req.session.userId!);
      res.json(result);
    } catch (e: any) {
      const status = e.message.includes("Not found") ? 404 : 500;
      res.status(status).json({ message: e.message });
    }
  });

  // ─── Run Photos ──────────────────────────────────────────────────────────────

  app.get("/api/runs/:id/photos", async (req: any, res) => {
    try {
      const photos = await storage.getRunPhotos(req.params.id as string);
      res.json(photos);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/runs/:id/photos", requireAuth, upload.single("photo"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No photo provided" });
      const run = await storage.getRunById(req.params.id as string);
      if (!run) return res.status(404).json({ message: "Run not found" });
      const participants = await storage.getRunParticipants(req.params.id as string);
      const isParticipant = participants.some((p: any) => p.id === req.session.userId);
      const isHost = run.host_id === req.session.userId;
      if (!isParticipant && !isHost) return res.status(403).json({ message: "Not a participant" });
      const ext = validateUploadExtension(req.file.originalname);
      if (!ext) {
        return res.status(400).json({ message: "Invalid file type. Only jpg, jpeg, png, gif, webp, and heic are allowed." });
      }
      const filename = `run-${req.params.id as string}-${req.session.userId}-${Date.now()}.${ext}`;
      const url = await uploadPhotoBuffer(req.file.buffer, filename, req.file.mimetype);
      const photo = await storage.addRunPhoto(req.params.id as string, req.session.userId!, url);
      res.status(201).json(photo);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/runs/:id/photos/:photoId", requireAuth, async (req: any, res) => {
    try {
      await storage.deleteRunPhoto(req.params.photoId as string, req.session.userId!);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Solo Run Photos ──────────────────────────────────────────────────────────

  app.get("/api/solo-runs/:id/photos", requireAuth, async (req: any, res) => {
    try {
      const photos = await storage.getSoloRunPhotos(req.params.id as string, req.session.userId!);
      res.json(photos);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/solo-runs/:id/photos", requireAuth, upload.single("photo"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No photo provided" });
      const soloRun = await storage.getSoloRunById(req.params.id as string);
      if (!soloRun) return res.status(404).json({ message: "Solo run not found" });
      if (soloRun.userId !== req.session.userId) return res.status(403).json({ message: "Not authorized" });
      const ext = validateUploadExtension(req.file.originalname);
      if (!ext) {
        return res.status(400).json({ message: "Invalid file type. Only jpg, jpeg, png, gif, webp, and heic are allowed." });
      }
      const filename = `solo-${req.params.id as string}-${Date.now()}.${ext}`;
      const url = await uploadPhotoBuffer(req.file.buffer, filename, req.file.mimetype);
      const photo = await storage.addSoloRunPhoto(req.params.id as string, req.session.userId!, url);
      res.status(201).json(photo);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/solo-runs/:id/photos/:photoId", requireAuth, async (req: any, res) => {
    try {
      await storage.deleteSoloRunPhoto(req.params.photoId as string, req.session.userId!);
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
      const scope = String(req.query.scope || "national");
      const value = String(req.query.value || "");

      const params: any[] = [activityType];
      let scopeFilter = "";
      if (scope === "state" && value) {
        params.push(value);
        scopeFilter = `AND c.home_state = $${params.length}`;
      } else if (scope === "metro" && value) {
        params.push(value);
        scopeFilter = `AND c.home_metro = $${params.length}`;
      }

      const result = await pool.query(`
        WITH crew_miles AS (
          SELECT
            c.id,
            c.name,
            c.emoji,
            c.image_url,
            c.home_state,
            c.home_metro,
            COUNT(DISTINCT cm.user_id)::int AS member_count,
            (
              COALESCE((
                SELECT SUM(sr.distance_miles)
                FROM solo_runs sr
                JOIN crew_members cm2 ON cm2.user_id = sr.user_id AND cm2.crew_id = c.id AND cm2.status = 'member'
                WHERE sr.completed = true AND sr.is_deleted IS NOT TRUE
                AND ($1 = 'mixed' OR sr.activity_type = $1)
              ), 0)
              +
              COALESCE((
                SELECT SUM(rp.final_distance)
                FROM run_participants rp
                JOIN runs r ON r.id = rp.run_id
                JOIN crew_members cm3 ON cm3.user_id = rp.user_id AND cm3.crew_id = c.id AND cm3.status = 'member'
                WHERE rp.final_distance IS NOT NULL
                AND ($1 = 'mixed' OR r.activity_type = $1)
              ), 0)
            ) AS total_miles
          FROM crews c
          LEFT JOIN crew_members cm ON cm.crew_id = c.id AND cm.status = 'member'
          WHERE 1=1 ${scopeFilter}
          GROUP BY c.id, c.name, c.emoji, c.image_url, c.home_state, c.home_metro
        )
        SELECT * FROM crew_miles
        WHERE total_miles > 0
        ORDER BY total_miles DESC
        LIMIT 100
      `, params);

      const ranked = result.rows.map((row: any, idx: number) => ({
        rank: idx + 1,
        id: row.id,
        name: row.name,
        emoji: row.emoji,
        image_url: row.image_url,
        home_state: row.home_state,
        home_metro: row.home_metro,
        member_count: row.member_count,
        total_miles: parseFloat(row.total_miles ?? 0),
      }));

      res.json(ranked);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
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
      await storage.respondToCrewInvite(req.params.crewId as string, req.session.userId!, accept ? 'accept' : 'decline');
      res.json({ ok: true });
    } catch (e: any) {
      if ((e as any).code === "MEMBER_CAP_REACHED") return res.status(400).json({ message: e.message, code: "MEMBER_CAP_REACHED" });
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/crews/search", requireAuth, async (req, res) => {
    try {
      const q = (req.query.q as string) || "";
      const friendsOnly = req.query.friends as string === "true";
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
      const result = await storage.requestToJoinCrew(req.params.id as string, req.session.userId!);
      if ("error" in result) {
        if (result.error === "member_cap_reached") {
          return res.status(400).json({ message: "This crew has reached its 100-member limit. The crew chief needs to upgrade.", code: "MEMBER_CAP_REACHED" });
        }
        return res.status(400).json({ message: result.error });
      }
      const crew = await storage.getCrewById(req.params.id as string);
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
      const crew = await storage.getCrewById(req.params.id as string);
      if (!crew) return res.status(404).json({ message: "Crew not found" });
      if (crew.created_by !== req.session.userId!) return res.status(403).json({ message: "Only the Crew Chief can view requests" });
      const requests = await storage.getCrewJoinRequests(req.params.id as string);
      res.json(requests);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/crews/:id/join-requests/:requesterId/respond", requireAuth, async (req, res) => {
    try {
      const crew = await storage.getCrewById(req.params.id as string);
      if (!crew) return res.status(404).json({ message: "Crew not found" });
      if (crew.created_by !== req.session.userId!) return res.status(403).json({ message: "Only the Crew Chief can respond to requests" });
      const { accept } = req.body;
      await storage.respondToCrewJoinRequest(req.params.id as string, req.params.requesterId as string, !!accept);
      const requester = await storage.getUserById(req.params.requesterId as string);
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
      const activityType = (req.query.activityType as string) || 'run';
      const crew = await storage.getCrewById(req.params.id as string, activityType);
      if (!crew) return res.status(404).json({ message: "Crew not found" });
      res.json(crew);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/crews/:id/invite", requireAuth, async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ message: "userId required" });
      await storage.inviteUserToCrew(req.params.id as string, userId, req.session.userId!);
      const invitedUser = await storage.getUserById(userId);
      const crew = await storage.getCrewById(req.params.id as string);
      if (crew && userWantsNotif(invitedUser, 'crew_activity')) {
        const inviter = await storage.getUserById(req.session.userId!);
        sendPushNotification(
          invitedUser!.push_token,
          `You've been invited to ${crew.name} 🏃`,
          `${inviter?.name ?? "Someone"} invited you to join their crew`,
          { crewId: req.params.id as string }
        );
      }
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/crews/:id", requireAuth, async (req, res) => {
    try {
      await storage.disbandCrewById(req.params.id as string, req.session.userId!);
      res.json({ ok: true });
    } catch (e: any) { res.status(e.message?.includes("Only the creator") ? 403 : 500).json({ message: e.message }); }
  });

  app.delete("/api/crews/:id/members/:memberId", requireAuth, async (req, res) => {
    try {
      await storage.removeCrewMember(req.params.id as string, req.session.userId!, req.params.memberId as string);
      res.json({ ok: true });
    } catch (e: any) {
      const status = e.message?.includes("Only the Crew Chief") ? 403 : e.message?.includes("not found") ? 404 : 500;
      res.status(status).json({ message: e.message });
    }
  });

  app.put("/api/crews/:crewId/members/:userId/role", requireAuth, async (req, res) => {
    try {
      const callerId = req.session.userId!;
      const { crewId, userId } = req.params as Record<string, string>;
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
      const result = await storage.leaveCrewById(req.params.id as string, req.session.userId!);
      res.json({ ok: true, disbanded: result?.disbanded ?? false });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch("/api/crews/:id/mute", requireAuth, async (req, res) => {
    try {
      const muted = await storage.toggleCrewChatMute(req.params.id as string, req.session.userId!);
      res.json({ muted });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/crews/:id/runs", requireAuth, async (req, res) => {
    try {
      const runs = await storage.getCrewRuns(req.params.id as string);
      res.json(runs);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/crews/:id/history", requireAuth, async (req, res) => {
    try {
      const history = await storage.getCrewRunHistory(req.params.id as string);
      res.json(history);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/crews/:id/achievements", requireAuth, async (req, res) => {
    try {
      const data = await storage.getCrewAchievements(req.params.id as string);
      res.json(data);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/crews/:id/subscription", requireAuth, async (req, res) => {
    try {
      const status = await storage.getCrewSubscriptionStatus(req.params.id as string);
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
      if (!subStatus) return res.status(200).json({ ok: true });
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
      const q = String(req.query.q as string || "").trim();
      const limit = Math.min(Number(req.query.limit as string) || 20, 50);
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
      const limit = Math.min(Number(req.query.limit as string) || 50, 100);
      const messages = await storage.getDmThread(req.session.userId!, req.params.friendId as string, limit);
      res.json(messages);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/dm/:friendId", requireAuth, async (req, res) => {
    try {
      const { message, gif_url, gif_preview_url } = req.body;
      const isGif = !!gif_url;
      if (!message?.trim() && !isGif) return res.status(400).json({ message: "Message required" });
      // Block guard: deny messaging a user who has blocked the sender, or vice versa
      const [iBlocked, theyBlocked] = await Promise.all([
        storage.isBlocking(req.session.userId!, req.params.friendId as string),
        storage.isBlockedBy(req.session.userId!, req.params.friendId as string),
      ]);
      if (iBlocked || theyBlocked) return res.status(403).json({ message: "Cannot send message to this user" });
      const messageType = isGif ? "gif" : "text";
      const metadata = isGif ? { gif_url, gif_preview_url } : undefined;
      const dm = await storage.sendDm(
        req.session.userId!,
        req.params.friendId as string,
        (message ?? "").trim(),
        messageType,
        metadata
      );
      res.json(dm);
      // Fire push notification to recipient (non-blocking)
      Promise.all([
        storage.getUserById(req.session.userId!),
        storage.getUserById(req.params.friendId as string),
      ]).then(([sender, recipient]) => {
        if (sender && userWantsNotif(recipient, "direct_messages")) {
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
      await storage.markDmRead(req.session.userId!, req.params.friendId as string);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/dm/:friendId", requireAuth, async (req, res) => {
    try {
      await storage.deleteDmThread(req.session.userId!, req.params.friendId as string);
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
      // Store the userId ↔ requestToken mapping server-side so the callback can look it
      // up without depending on the session cookie (which may drop in in-app browsers).
      garminPendingTokens.set(requestToken, { userId: req.session.userId!, requestSecret });
      // Clean up stale entries older than 15 minutes (map grows by at most one per connect attempt)
      setTimeout(() => garminPendingTokens.delete(requestToken), 15 * 60 * 1000);
      res.json({ authUrl: `${GARMIN_AUTH_URL}?oauth_token=${requestToken}` });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/garmin/callback", async (req: any, res) => {
    try {
      const oauth_token = String(req.query.oauth_token as string ?? "");
      const oauth_verifier = String(req.query.oauth_verifier as string ?? "");
      if (!oauth_token || !oauth_verifier) {
        return res.status(400).send("Missing OAuth parameters. Please try connecting Garmin again.");
      }

      // Prefer server-side map (session-cookie-independent).
      // Fall back to session userId for any other OAuth flows.
      const pending = garminPendingTokens.get(oauth_token);
      // Require the server-side pending entry (contains userId + requestSecret).
      // If it's missing (e.g. server restarted mid-OAuth), reject with a clear message
      // rather than proceeding with an empty request secret which would silently fail.
      if (!pending) {
        return res.status(400).send(
          "OAuth state expired. Please return to the PaceUp app and tap Connect again."
        );
      }
      const { userId, requestSecret } = pending;
      garminPendingTokens.delete(oauth_token);

      const oauthInst = makeGarminOAuth();
      if (!oauthInst) return res.status(503).send("Garmin integration is not configured.");
      const request = { url: GARMIN_ACCESS_TOKEN_URL, method: "POST" };
      const authData = oauthInst.authorize(request, { key: oauth_token, secret: requestSecret });
      const authHeader = oauthInst.toHeader({ ...authData, oauth_verifier } as OAuth.Authorization & { oauth_verifier: string });
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
      // Redirect to the PaceUp deep link so the app re-focuses and refetches status.
      // On devices without the app installed this falls back to the HTML success page.
      res.send(`<!DOCTYPE html><html><head><title>PaceUp — Garmin Connected</title>
<meta http-equiv="refresh" content="0;url=paceup://garmin-connected">
<style>body{background:#050C09;color:#fff;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;} h1{color:#00D97E;font-size:24px;} p{color:#aaa;margin-top:8px;} a{color:#00D97E;}</style></head>
<body>
<h1>Garmin Connected!</h1>
<p>Returning to PaceUp…</p>
<p><a href="paceup://garmin-connected">Tap here if the app didn't open automatically</a></p>
<script>window.location.href="paceup://garmin-connected";</script>
</body></html>`);
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
      const { workouts, source = "apple_health" } = req.body;
      if (!Array.isArray(workouts) || workouts.length === 0) {
        return res.status(400).json({ message: "No workouts provided" });
      }

      const isHealthConnect = source === "health_connect";

      let imported = 0;
      for (const w of workouts) {
        if (!w.id || !w.activityType || !w.startDate || !w.distanceMeters || !w.durationSeconds) continue;

        const distMiles = w.distanceMeters / 1609.344;
        const paceMinPerMile = w.durationSeconds > 0 && distMiles > 0
          ? (w.durationSeconds / 60) / distMiles
          : null;

        const typeMap: Record<string, string> = { run: "run", ride: "ride", walk: "walk" };
        const actType = typeMap[w.activityType] || "run";

        const activityData = {
          date: new Date(w.startDate),
          distanceMiles: Math.round(distMiles * 100) / 100,
          paceMinPerMile: paceMinPerMile ? Math.round(paceMinPerMile * 100) / 100 : null,
          durationSeconds: Math.round(w.durationSeconds),
          activityType: actType,
          title: "",
        };

        let wasNew: boolean;
        if (isHealthConnect) {
          activityData.title = `${actType === "ride" ? "Ride" : actType === "walk" ? "Walk" : "Run"} via Health Connect`;
          wasNew = await storage.saveHealthConnectActivity(userId, w.id, activityData);
        } else {
          activityData.title = `${actType === "ride" ? "Ride" : actType === "walk" ? "Walk" : "Run"} via ${w.sourceName || "Apple Health"}`;
          wasNew = await storage.saveHealthKitActivity(userId, w.id, activityData);
        }
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
