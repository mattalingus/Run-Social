var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// server/metro-areas.ts
var metro_areas_exports = {};
__export(metro_areas_exports, {
  findMetroArea: () => findMetroArea,
  metroAreas: () => metroAreas
});
function findMetroArea(cityName, stateCode) {
  return metroAreas.find(
    (m) => m.name.toLowerCase() === cityName.toLowerCase() && m.state.toLowerCase() === stateCode.toLowerCase()
  );
}
var metroAreas;
var init_metro_areas = __esm({
  "server/metro-areas.ts"() {
    "use strict";
    metroAreas = [
      { name: "New York City", state: "NY", country: "US" },
      { name: "Los Angeles", state: "CA", country: "US" },
      { name: "Chicago", state: "IL", country: "US" },
      { name: "Houston", state: "TX", country: "US" },
      { name: "Phoenix", state: "AZ", country: "US" },
      { name: "Philadelphia", state: "PA", country: "US" },
      { name: "San Antonio", state: "TX", country: "US" },
      { name: "San Diego", state: "CA", country: "US" },
      { name: "Dallas", state: "TX", country: "US" },
      { name: "San Jose", state: "CA", country: "US" },
      { name: "Austin", state: "TX", country: "US" },
      { name: "Jacksonville", state: "FL", country: "US" },
      { name: "Fort Worth", state: "TX", country: "US" },
      { name: "Columbus", state: "OH", country: "US" },
      { name: "Charlotte", state: "NC", country: "US" },
      { name: "San Francisco", state: "CA", country: "US" },
      { name: "Indianapolis", state: "IN", country: "US" },
      { name: "Seattle", state: "WA", country: "US" },
      { name: "Denver", state: "CO", country: "US" },
      { name: "Washington", state: "DC", country: "US" },
      { name: "Boston", state: "MA", country: "US" },
      { name: "Nashville", state: "TN", country: "US" },
      { name: "El Paso", state: "TX", country: "US" },
      { name: "Detroit", state: "MI", country: "US" },
      { name: "Oklahoma City", state: "OK", country: "US" },
      { name: "Portland", state: "OR", country: "US" },
      { name: "Las Vegas", state: "NV", country: "US" },
      { name: "Memphis", state: "TN", country: "US" },
      { name: "Louisville", state: "KY", country: "US" },
      { name: "Baltimore", state: "MD", country: "US" },
      { name: "Milwaukee", state: "WI", country: "US" },
      { name: "Albuquerque", state: "NM", country: "US" },
      { name: "Tucson", state: "AZ", country: "US" },
      { name: "Fresno", state: "CA", country: "US" },
      { name: "Sacramento", state: "CA", country: "US" },
      { name: "Kansas City", state: "MO", country: "US" },
      { name: "Mesa", state: "AZ", country: "US" },
      { name: "Atlanta", state: "GA", country: "US" },
      { name: "Omaha", state: "NE", country: "US" },
      { name: "Colorado Springs", state: "CO", country: "US" },
      { name: "Raleigh", state: "NC", country: "US" },
      { name: "Long Beach", state: "CA", country: "US" },
      { name: "Virginia Beach", state: "VA", country: "US" },
      { name: "Miami", state: "FL", country: "US" },
      { name: "Oakland", state: "CA", country: "US" },
      { name: "Minneapolis", state: "MN", country: "US" },
      { name: "Tulsa", state: "OK", country: "US" },
      { name: "Bakersfield", state: "CA", country: "US" },
      { name: "Tampa", state: "FL", country: "US" },
      { name: "Wichita", state: "KS", country: "US" }
    ];
  }
});

// server/index.ts
import express from "express";

// server/routes.ts
import { createServer } from "node:http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import multer from "multer";
import nodemailer from "nodemailer";

// server/storage.ts
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
var pool = new Pool({ connectionString: process.env.DATABASE_URL });
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function computePathDistanceKm(coords) {
  let dist = 0;
  for (let i = 1; i < coords.length; i++) {
    dist += haversineKm(coords[i - 1].latitude, coords[i - 1].longitude, coords[i].latitude, coords[i].longitude);
  }
  return dist;
}
function deduplicateRoutePath(coords) {
  const totalDistKm = computePathDistanceKm(coords);
  const distanceMiles = totalDistKm / 1.60934;
  if (coords.length < 6 || totalDistKm < 0.3) {
    return { path: coords, distanceMiles, loopDetected: false };
  }
  const cumDist = [0];
  for (let k = 1; k < coords.length; k++) {
    cumDist.push(
      cumDist[k - 1] + haversineKm(
        coords[k - 1].latitude,
        coords[k - 1].longitude,
        coords[k].latitude,
        coords[k].longitude
      )
    );
  }
  const THRESHOLD_KM = 0.04;
  const MIN_GAP_KM = 0.3;
  let closureAt = -1;
  let closureAnchor = -1;
  outer:
    for (let i = 3; i < coords.length; i++) {
      for (let j = 0; j < i; j++) {
        const gap = cumDist[i] - cumDist[j];
        if (gap < MIN_GAP_KM) continue;
        const d = haversineKm(
          coords[i].latitude,
          coords[i].longitude,
          coords[j].latitude,
          coords[j].longitude
        );
        if (d < THRESHOLD_KM) {
          closureAt = i;
          closureAnchor = j;
          break outer;
        }
      }
    }
  if (closureAt < 0) {
    return { path: coords, distanceMiles, loopDetected: false };
  }
  const trimmed = coords.slice(0, closureAt + 1);
  const trimmedMiles = computePathDistanceKm(trimmed) / 1.60934;
  return { path: trimmed, distanceMiles: trimmedMiles, loopDetected: true };
}
async function initDb() {
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'run_privacy') THEN
        CREATE TYPE run_privacy AS ENUM ('public', 'private', 'solo');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('runner', 'host');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'participant_status') THEN
        CREATE TYPE participant_status AS ENUM ('joined', 'confirmed', 'cancelled', 'pending');
      END IF;
    END $$;

    ALTER TYPE participant_status ADD VALUE IF NOT EXISTS 'pending';

    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      username TEXT UNIQUE,
      photo_url TEXT,
      avg_pace REAL DEFAULT 10,
      avg_distance REAL DEFAULT 3,
      total_miles REAL DEFAULT 0,
      miles_this_year REAL DEFAULT 0,
      miles_this_month REAL DEFAULT 0,
      monthly_goal REAL DEFAULT 50,
      yearly_goal REAL DEFAULT 500,
      completed_runs INTEGER DEFAULT 0,
      hosted_runs INTEGER DEFAULT 0,
      host_unlocked BOOLEAN DEFAULT false,
      role user_role DEFAULT 'runner',
      avg_rating REAL DEFAULT 0,
      rating_count INTEGER DEFAULT 0,
      notifications_enabled BOOLEAN DEFAULT true,
      strava_id TEXT,
      apple_health_id TEXT,
      garmin_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS runs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      host_id VARCHAR NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      description TEXT,
      privacy run_privacy DEFAULT 'public',
      date TIMESTAMP NOT NULL,
      location_lat REAL NOT NULL,
      location_lng REAL NOT NULL,
      location_name TEXT NOT NULL,
      min_distance REAL NOT NULL,
      max_distance REAL NOT NULL,
      min_pace REAL NOT NULL,
      max_pace REAL NOT NULL,
      tags TEXT[] DEFAULT '{}',
      is_completed BOOLEAN DEFAULT false,
      max_participants INTEGER DEFAULT 20,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS run_participants (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id VARCHAR NOT NULL REFERENCES runs(id),
      user_id VARCHAR NOT NULL REFERENCES users(id),
      status participant_status DEFAULT 'joined',
      joined_at TIMESTAMP DEFAULT NOW(),
      miles_logged REAL
    );

    CREATE TABLE IF NOT EXISTS host_ratings (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id VARCHAR NOT NULL REFERENCES runs(id),
      host_id VARCHAR NOT NULL REFERENCES users(id),
      rater_id VARCHAR NOT NULL REFERENCES users(id),
      stars INTEGER NOT NULL,
      tags TEXT[] DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS marker_icon TEXT DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS pace_goal REAL DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS distance_goal REAL DEFAULT 100;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS goal_period VARCHAR DEFAULT 'monthly';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS name_changed_at TIMESTAMPTZ DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS distance_unit VARCHAR DEFAULT 'miles';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_privacy VARCHAR DEFAULT 'public';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_run_reminders BOOLEAN DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_friend_requests BOOLEAN DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_crew_activity BOOLEAN DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_weekly_summary BOOLEAN DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS show_run_routes BOOLEAN DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT NULL;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS is_strict BOOLEAN DEFAULT false;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS run_style TEXT DEFAULT NULL;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS activity_type TEXT DEFAULT 'run';
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS notif_late_start_sent BOOLEAN DEFAULT false;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS notif_pre_run_sent BOOLEAN DEFAULT false;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
    ALTER TABLE users ALTER COLUMN avg_pace SET DEFAULT NULL;
    ALTER TABLE users ALTER COLUMN avg_distance SET DEFAULT NULL;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS mile_splits JSONB DEFAULT NULL;

    CREATE TABLE IF NOT EXISTS solo_runs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      date TIMESTAMP NOT NULL,
      distance_miles REAL NOT NULL,
      pace_min_per_mile REAL,
      duration_seconds INTEGER,
      completed BOOLEAN DEFAULT false,
      planned BOOLEAN DEFAULT false,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS route_path JSONB DEFAULT NULL;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS activity_type TEXT DEFAULT 'run';
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS is_starred BOOLEAN DEFAULT false;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS elevation_gain_ft REAL;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS ai_summary TEXT;

    CREATE TABLE IF NOT EXISTS friends (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      requester_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(requester_id, addressee_id)
    );
    ALTER TABLE friends ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP DEFAULT NULL;

    CREATE TABLE IF NOT EXISTS run_invites (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id VARCHAR NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      invitee_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invited_by VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(run_id, invitee_id)
    );

    ALTER TABLE runs ADD COLUMN IF NOT EXISTS invite_token TEXT DEFAULT NULL;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS invite_password TEXT DEFAULT NULL;

    ALTER TABLE achievements ADD COLUMN IF NOT EXISTS slug VARCHAR DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_read_at TIMESTAMP DEFAULT NULL;

    ALTER TABLE runs ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS is_present BOOLEAN DEFAULT false;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS final_distance REAL;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS final_pace REAL;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS final_rank INTEGER;
    CREATE UNIQUE INDEX IF NOT EXISTS run_participants_run_user_unique ON run_participants (run_id, user_id);

    CREATE TABLE IF NOT EXISTS run_tracking_points (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id VARCHAR NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      cumulative_distance REAL DEFAULT 0,
      pace REAL DEFAULT 0,
      recorded_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS saved_paths (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      route_path JSONB NOT NULL,
      distance_miles REAL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS saved_path_id VARCHAR REFERENCES saved_paths(id) ON DELETE SET NULL;
    ALTER TABLE saved_paths ADD COLUMN IF NOT EXISTS activity_type TEXT DEFAULT 'run';

    CREATE TABLE IF NOT EXISTS bookmarked_runs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      run_id VARCHAR NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, run_id)
    );

    CREATE TABLE IF NOT EXISTS planned_runs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      run_id VARCHAR NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, run_id)
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id),
      milestone INTEGER NOT NULL,
      earned_at TIMESTAMP DEFAULT NOW(),
      reward_eligible BOOLEAN DEFAULT true,
      reward_claimed BOOLEAN DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS community_paths (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      route_path JSONB NOT NULL,
      distance_miles REAL,
      contributor_count INTEGER DEFAULT 1,
      start_lat REAL NOT NULL,
      start_lng REAL NOT NULL,
      end_lat REAL NOT NULL,
      end_lng REAL NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS path_contributions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      community_path_id VARCHAR NOT NULL REFERENCES community_paths(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      saved_path_id VARCHAR REFERENCES saved_paths(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(community_path_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS run_photos (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id VARCHAR NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      photo_url TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS solo_run_photos (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      solo_run_id VARCHAR NOT NULL REFERENCES solo_runs(id) ON DELETE CASCADE,
      photo_url TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE runs ADD COLUMN IF NOT EXISTS crew_id VARCHAR REFERENCES crews(id) ON DELETE SET NULL;
    ALTER TABLE crews ADD COLUMN IF NOT EXISTS run_style TEXT DEFAULT NULL;
    ALTER TABLE crews ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

    CREATE TABLE IF NOT EXISTS crews (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      emoji TEXT DEFAULT '\u{1F3C3}',
      created_by VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS crew_members (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      crew_id VARCHAR NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'pending',
      invited_by VARCHAR REFERENCES users(id),
      joined_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(crew_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS crew_messages (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      crew_id VARCHAR NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_name TEXT NOT NULL,
      sender_photo TEXT,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_crew_messages_crew_created ON crew_messages(crew_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS run_messages (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id VARCHAR NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_name TEXT NOT NULL,
      sender_photo TEXT,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_run_messages_run_created ON run_messages(run_id, created_at DESC);

    ALTER TABLE community_paths ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;
    ALTER TABLE community_paths ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE community_paths ADD COLUMN IF NOT EXISTS created_by_name TEXT;
    ALTER TABLE community_paths ADD COLUMN IF NOT EXISTS run_count INTEGER DEFAULT 1;
    ALTER TABLE community_paths ADD COLUMN IF NOT EXISTS activity_type TEXT DEFAULT 'run';

    ALTER TABLE crew_messages ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text';
    ALTER TABLE crew_messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;
    ALTER TABLE crew_members ADD COLUMN IF NOT EXISTS chat_muted BOOLEAN DEFAULT false;
    ALTER TABLE crew_members ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'member';
    ALTER TABLE crews ADD COLUMN IF NOT EXISTS streak_risk_notif_week INTEGER DEFAULT NULL;
    -- Promote existing crew creators to crew_chief
    UPDATE crew_members cm SET role = 'crew_chief'
      FROM crews c
      WHERE c.id = cm.crew_id AND c.created_by = cm.user_id AND cm.role = 'member';

    CREATE TABLE IF NOT EXISTS direct_messages (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      read_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_dm_sender_recipient ON direct_messages(sender_id, recipient_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dm_recipient ON direct_messages(recipient_id, created_at DESC);
    ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text';
    ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_hash TEXT DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_id TEXT DEFAULT NULL;
    CREATE TABLE IF NOT EXISTS facebook_friends (
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fb_friend_id VARCHAR NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY(user_id, fb_friend_id)
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS garmin_access_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS garmin_token_secret TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_health_connected BOOLEAN DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS health_connect_connected BOOLEAN DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS default_activity TEXT DEFAULT 'run';
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS garmin_activity_id TEXT UNIQUE;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS apple_health_id TEXT UNIQUE;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS health_connect_id TEXT UNIQUE;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS step_count INTEGER;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS move_time_seconds INTEGER;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS tag_along_source_run_id VARCHAR REFERENCES runs(id) ON DELETE SET NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_solo_runs_tag_along ON solo_runs(user_id, tag_along_source_run_id) WHERE tag_along_source_run_id IS NOT NULL;
    ALTER TABLE crew_messages ALTER COLUMN user_id DROP NOT NULL;

    CREATE TABLE IF NOT EXISTS crew_achievements (
      id SERIAL PRIMARY KEY,
      crew_id VARCHAR NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
      achievement_key TEXT NOT NULL,
      achieved_at TIMESTAMP DEFAULT NOW(),
      achieved_value NUMERIC,
      UNIQUE(crew_id, achievement_key)
    );
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS saved_path_id VARCHAR REFERENCES saved_paths(id) ON DELETE SET NULL;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS pace_groups JSONB DEFAULT NULL;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS pace_group_label VARCHAR DEFAULT NULL;

    CREATE TABLE IF NOT EXISTS remember_tokens (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_remember_tokens_user ON remember_tokens(user_id);
    ALTER TABLE crews ADD COLUMN IF NOT EXISTS current_streak_weeks INTEGER DEFAULT 0;
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS last_run_week TIMESTAMP DEFAULT NULL;
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS home_metro TEXT DEFAULT NULL;
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS home_state TEXT DEFAULT NULL;
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS last_overtake_notif_at TIMESTAMP DEFAULT NULL;
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'none';
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS member_cap_override INTEGER DEFAULT NULL;

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token VARCHAR NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP DEFAULT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens(token);

    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS tag_along_of_user_id VARCHAR DEFAULT NULL;

    CREATE TABLE IF NOT EXISTS tag_along_requests (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id VARCHAR NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      requester_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(run_id, requester_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tag_along_run ON tag_along_requests(run_id, status);

    CREATE TABLE IF NOT EXISTS user_blocks (
      blocker_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (blocker_id, blocked_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_id);
    CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

    CREATE TABLE IF NOT EXISTS path_shares (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      from_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      saved_path_id VARCHAR NOT NULL REFERENCES saved_paths(id) ON DELETE CASCADE,
      path_name TEXT NOT NULL,
      path_distance_miles REAL,
      activity_type TEXT DEFAULT 'run',
      created_at TIMESTAMP DEFAULT NOW(),
      cloned BOOLEAN DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_path_shares_to ON path_shares(to_user_id);
    ALTER TABLE saved_paths ADD COLUMN IF NOT EXISTS community_path_id VARCHAR REFERENCES community_paths(id) ON DELETE SET NULL;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS mile_splits JSONB DEFAULT NULL;
  `);
  const dummyCheck = await pool.query(`SELECT COUNT(*) FROM users WHERE email LIKE 'dummy-%@paceup.dev'`);
  if (parseInt(dummyCheck.rows[0].count) > 0) {
    await pool.query(`DELETE FROM run_participants WHERE run_id IN (SELECT id FROM runs WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'dummy-%@paceup.dev'))`);
    await pool.query(`DELETE FROM bookmarked_runs WHERE run_id IN (SELECT id FROM runs WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'dummy-%@paceup.dev'))`);
    await pool.query(`DELETE FROM planned_runs WHERE run_id IN (SELECT id FROM runs WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'dummy-%@paceup.dev'))`);
    await pool.query(`DELETE FROM runs WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'dummy-%@paceup.dev')`);
    await pool.query(`DELETE FROM users WHERE email LIKE 'dummy-%@paceup.dev'`);
    console.log("[cleanup] Removed dummy seed accounts and their runs");
  }
}
async function getBuddyEligibility(userId) {
  const groupRes = await pool.query(
    `SELECT COUNT(DISTINCT rc.run_id) as count
     FROM run_completions rc
     WHERE rc.user_id = $1
       AND (SELECT COUNT(*) FROM run_completions rc2 WHERE rc2.run_id = rc.run_id) >= 2`,
    [userId]
  );
  const soloRes = await pool.query(
    `SELECT COUNT(*) as count FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE`,
    [userId]
  );
  const groupRuns = parseInt(groupRes.rows[0]?.count ?? "0");
  const soloRuns = parseInt(soloRes.rows[0]?.count ?? "0");
  const eligible = groupRuns >= 1 && soloRuns >= 3;
  return { eligible, groupRuns, soloRuns };
}
async function getBuddySuggestions(userId, gender) {
  const res = await pool.query(
    `SELECT id, name, username, photo_url, avg_pace, avg_distance, total_miles
     FROM users
     WHERE gender = $1 AND id != $2
       AND id NOT IN (
         SELECT CASE WHEN requester_id = $2 THEN addressee_id ELSE requester_id END
         FROM friends
         WHERE requester_id = $2 OR addressee_id = $2
       )
     ORDER BY RANDOM()
     LIMIT 10`,
    [gender, userId]
  );
  return res.rows;
}
async function getNotifications(userId) {
  const friendRequests = await pool.query(
    `SELECT fr.id, 'friend_request' as type, u.name as from_name, u.photo_url as from_photo, u.id as from_id, fr.created_at
     FROM friends fr
     JOIN users u ON u.id = fr.requester_id
     WHERE fr.addressee_id = $1 AND fr.status = 'pending'`,
    [userId]
  );
  const crewInvites = await pool.query(
    `SELECT cm.id, cm.crew_id, 'crew_invite' as type, c.name as crew_name, c.emoji,
            u.name as invited_by_name, cm.joined_at as created_at
     FROM crew_members cm
     JOIN crews c ON c.id = cm.crew_id
     JOIN users u ON u.id = cm.invited_by
     WHERE cm.user_id = $1 AND cm.status = 'pending' AND cm.invited_by != $1`,
    [userId]
  );
  const joinRequests = await pool.query(
    `SELECT rp.id, 'join_request' as type, u.name as from_name, r.title as run_title, rp.joined_at as created_at
     FROM run_participants rp
     JOIN runs r ON r.id = rp.run_id
     JOIN users u ON u.id = rp.user_id
     WHERE r.host_id = $1 AND rp.status = 'pending'`,
    [userId]
  );
  const eventReminders = await pool.query(
    `SELECT r.id, r.title, r.date, r.location_name, u.name as host_name, r.activity_type
     FROM run_participants rp
     JOIN runs r ON r.id = rp.run_id
     JOIN users u ON u.id = r.host_id
     WHERE rp.user_id = $1
       AND rp.status = 'confirmed'
       AND r.host_id != $1
       AND r.date BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
       AND (r.is_active = false OR r.is_active IS NULL)
     ORDER BY r.date ASC`,
    [userId]
  );
  const hostArrivals = await pool.query(
    `SELECT r.id, r.title, r.started_at, r.location_name, u.name as host_name, r.activity_type
     FROM run_participants rp
     JOIN runs r ON r.id = rp.run_id
     JOIN users u ON u.id = r.host_id
     WHERE rp.user_id = $1
       AND rp.status = 'confirmed'
       AND r.host_id != $1
       AND r.is_active = true
       AND r.started_at >= NOW() - INTERVAL '4 hours'
     ORDER BY r.started_at DESC`,
    [userId]
  );
  const distPRs = await pool.query(
    `SELECT sr.id, sr.distance_miles, sr.date, sr.activity_type
     FROM solo_runs sr
     WHERE sr.user_id = $1
       AND sr.completed = true
       AND sr.is_deleted IS NOT TRUE
       AND sr.date >= NOW() - INTERVAL '72 hours'
       AND EXISTS (
         SELECT 1 FROM solo_runs s3
         WHERE s3.user_id = $1 AND s3.completed = true
           AND s3.is_deleted IS NOT TRUE AND s3.id != sr.id AND s3.date < sr.date
       )
       AND sr.distance_miles > COALESCE((
         SELECT MAX(s2.distance_miles) FROM solo_runs s2
         WHERE s2.user_id = $1 AND s2.completed = true
           AND s2.is_deleted IS NOT TRUE AND s2.id != sr.id AND s2.date < sr.date
       ), 0)
     ORDER BY sr.date DESC
     LIMIT 1`,
    [userId]
  );
  const pacePRs = await pool.query(
    `SELECT sr.id, sr.pace_min_per_mile, sr.date, sr.activity_type
     FROM solo_runs sr
     WHERE sr.user_id = $1
       AND sr.completed = true
       AND sr.is_deleted IS NOT TRUE
       AND sr.distance_miles > 0.5
       AND sr.pace_min_per_mile >= 2.0
       AND sr.date >= NOW() - INTERVAL '72 hours'
       AND EXISTS (
         SELECT 1 FROM solo_runs s3
         WHERE s3.user_id = $1 AND s3.completed = true
           AND s3.is_deleted IS NOT TRUE AND s3.id != sr.id
           AND s3.distance_miles > 0.5 AND s3.pace_min_per_mile >= 2.0
           AND s3.date < sr.date
       )
       AND sr.pace_min_per_mile < COALESCE((
         SELECT MIN(s2.pace_min_per_mile) FROM solo_runs s2
         WHERE s2.user_id = $1 AND s2.completed = true
           AND s2.is_deleted IS NOT TRUE AND s2.id != sr.id
           AND s2.distance_miles > 0.5 AND s2.pace_min_per_mile >= 2.0
           AND s2.date < sr.date
       ), 999)
     ORDER BY sr.date DESC
     LIMIT 1`,
    [userId]
  );
  const crewJoinRequests = await pool.query(
    `SELECT cm.crew_id, cm.user_id as requester_id, u.name as requester_name, u.photo_url as requester_photo,
            c.name as crew_name, c.emoji, cm.joined_at as created_at
     FROM crew_members cm
     JOIN users u ON u.id = cm.user_id
     JOIN crews c ON c.id = cm.crew_id
     WHERE c.created_by = $1 AND cm.status = 'pending' AND cm.user_id != $1
       AND (cm.invited_by IS NULL OR cm.invited_by = cm.user_id)`,
    [userId]
  );
  const milestoneAchievements = await pool.query(
    `SELECT a.id, a.milestone, a.slug, a.earned_at
     FROM achievements a
     WHERE a.user_id = $1
       AND a.earned_at >= NOW() - INTERVAL '7 days'
     ORDER BY a.earned_at DESC
     LIMIT 10`,
    [userId]
  );
  const friendAccepted = await pool.query(
    `SELECT fr.id, 'friend_accepted' as type, u.name as friend_name, u.photo_url as friend_photo, u.id as friend_id, fr.accepted_at
     FROM friends fr
     JOIN users u ON u.id = fr.addressee_id
     WHERE fr.requester_id = $1 AND fr.status = 'accepted'
       AND fr.accepted_at IS NOT NULL
       AND fr.accepted_at >= NOW() - INTERVAL '48 hours'`,
    [userId]
  );
  const friendRunPosted = await pool.query(
    `SELECT r.id as run_id, r.title, r.activity_type, r.created_at, u.name as friend_name, u.photo_url as friend_photo, u.id as friend_id
     FROM runs r
     JOIN users u ON u.id = r.host_id
     WHERE r.created_at >= NOW() - INTERVAL '24 hours'
       AND r.host_id != $1
       AND r.host_id IN (
         SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END
         FROM friends
         WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'
       )
       AND NOT EXISTS (
         SELECT 1 FROM run_participants rp WHERE rp.run_id = r.id AND rp.user_id = $1
       )
     ORDER BY r.created_at DESC`,
    [userId]
  );
  const pathSharesNotifs = await pool.query(
    `SELECT ps.id, ps.path_name, ps.path_distance_miles, ps.activity_type, ps.cloned, ps.created_at,
            u.name as from_name, u.photo_url as from_photo
     FROM path_shares ps
     JOIN users u ON u.id = ps.from_user_id
     WHERE ps.to_user_id = $1
       AND ps.created_at >= NOW() - INTERVAL '14 days'
     ORDER BY ps.created_at DESC
     LIMIT 10`,
    [userId]
  );
  const prRunIds = /* @__PURE__ */ new Set();
  const prRows = [];
  for (const row of [...distPRs.rows, ...pacePRs.rows]) {
    if (!prRunIds.has(row.id)) {
      prRunIds.add(row.id);
      prRows.push(row);
    }
  }
  function fmtPace(p) {
    const m = Math.floor(p);
    const s = Math.round((p - m) * 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }
  const now = /* @__PURE__ */ new Date();
  const notifications = [
    ...hostArrivals.rows.map((r) => ({
      id: `ha_${r.id}`,
      type: "host_arrived",
      title: "Host Has Arrived",
      body: `${r.host_name} just started "${r.title}" \u2014 head over!`,
      data: { run_id: r.id, host_name: r.host_name, location_name: r.location_name, activity_type: r.activity_type },
      created_at: r.started_at
    })),
    ...friendRequests.rows.map((r) => ({
      id: r.id,
      type: "friend_request",
      title: "Friend Request",
      body: `${r.from_name} wants to connect on PaceUp`,
      from_name: r.from_name,
      from_photo: r.from_photo,
      data: { from_name: r.from_name, from_photo: r.from_photo, from_id: r.from_id },
      created_at: r.created_at
    })),
    ...crewInvites.rows.map((r) => ({
      id: r.id,
      type: "crew_invite",
      title: "Crew Invite",
      body: `${r.invited_by_name} invited you to join ${r.emoji ?? ""} ${r.crew_name}`,
      crew_id: r.crew_id,
      crew_name: r.crew_name,
      emoji: r.emoji,
      invited_by_name: r.invited_by_name,
      data: { crew_id: r.crew_id, crew_name: r.crew_name, emoji: r.emoji },
      created_at: r.created_at
    })),
    ...joinRequests.rows.map((r) => ({
      id: r.id,
      type: "join_request",
      title: "Join Request",
      body: `${r.from_name} wants to join "${r.run_title}"`,
      data: { participant_id: r.id, from_name: r.from_name, run_title: r.run_title },
      created_at: r.created_at
    })),
    ...crewJoinRequests.rows.map((r) => ({
      id: `cjr_${r.crew_id}_${r.requester_id}`,
      type: "crew_join_request",
      title: "Crew Join Request",
      body: `${r.requester_name} wants to join ${r.emoji ?? ""} ${r.crew_name}`,
      data: { crew_id: r.crew_id, requester_id: r.requester_id, requester_name: r.requester_name, requester_photo: r.requester_photo, crew_name: r.crew_name },
      created_at: r.created_at
    })),
    ...eventReminders.rows.map((r) => {
      const diffMs = new Date(r.date).getTime() - now.getTime();
      const diffH = Math.floor(diffMs / 36e5);
      const diffM = Math.floor(diffMs % 36e5 / 6e4);
      const timeStr = diffH > 0 ? `${diffH}h ${diffM}m` : `${diffM}m`;
      const actLabel = r.activity_type === "ride" ? "ride" : r.activity_type === "walk" ? "walk" : "run";
      return {
        id: `er_${r.id}`,
        type: "event_reminder",
        title: `Upcoming ${actLabel === "ride" ? "Ride" : actLabel === "walk" ? "Walk" : "Run"}`,
        body: `"${r.title}" with ${r.host_name} starts in ${timeStr}${r.location_name ? ` \xB7 ${r.location_name}` : ""}`,
        data: { run_id: r.id, host_name: r.host_name, location_name: r.location_name, date: r.date, activity_type: r.activity_type },
        created_at: now.toISOString()
      };
    }),
    ...friendAccepted.rows.map((r) => ({
      id: `fa_${r.id}`,
      type: "friend_accepted",
      title: "Friend Request Accepted",
      body: `${r.friend_name} accepted your friend request`,
      data: { friend_id: r.friend_id, friend_name: r.friend_name, friend_photo: r.friend_photo },
      created_at: r.accepted_at
    })),
    ...friendRunPosted.rows.map((r) => {
      const actLabel = r.activity_type === "ride" ? "ride" : r.activity_type === "walk" ? "walk" : "run";
      return {
        id: `frp_${r.run_id}`,
        type: "friend_run_posted",
        title: `Friend Posted a ${actLabel === "ride" ? "Ride" : actLabel === "walk" ? "Walk" : "Run"}`,
        body: `${r.friend_name} posted "${r.title}"`,
        data: { run_id: r.run_id, friend_id: r.friend_id, friend_name: r.friend_name, friend_photo: r.friend_photo, activity_type: r.activity_type },
        created_at: r.created_at
      };
    }),
    ...milestoneAchievements.rows.map((r) => ({
      id: `ach_${r.id}`,
      type: "milestone_achievement",
      title: "Achievement Unlocked",
      body: r.slug ? `You earned the "${r.slug}" achievement!` : `You reached milestone ${r.milestone}!`,
      data: { achievement_id: r.id, milestone: r.milestone, slug: r.slug },
      created_at: r.earned_at
    })),
    ...prRows.map((r) => {
      const isPacePR = distPRs.rows.find((d) => d.id === r.id) == null;
      const isDistPR = distPRs.rows.find((d) => d.id === r.id) != null;
      const isPPR = pacePRs.rows.find((p) => p.id === r.id) != null;
      const parts = [];
      if (isDistPR && r.distance_miles) parts.push(`${Math.round(r.distance_miles * 100) / 100} mi longest run`);
      if (isPPR && r.pace_min_per_mile) parts.push(`${fmtPace(r.pace_min_per_mile)}/mi fastest pace`);
      return {
        id: `pr_${r.id}`,
        type: "pr_notification",
        title: "\u{1F3C6} New Personal Record",
        body: parts.length ? parts.join(" \xB7 ") : "You set a new personal record!",
        data: { run_id: r.id, activity_type: r.activity_type },
        created_at: r.date
      };
    }),
    ...pathSharesNotifs.rows.map((r) => ({
      id: `ps_${r.id}`,
      type: "path_shared",
      title: "Route Shared With You",
      body: `${r.from_name} shared "${r.path_name}" with you`,
      from_name: r.from_name,
      from_photo: r.from_photo,
      share_id: r.id,
      path_name: r.path_name,
      path_distance_miles: r.path_distance_miles,
      cloned: r.cloned,
      created_at: r.created_at
    }))
  ];
  return notifications.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
async function respondToFriendRequest(friendshipId, userId, action) {
  if (action === "accept") {
    return pool.query(`UPDATE friends SET status = 'accepted', accepted_at = NOW() WHERE id = $1 AND addressee_id = $2`, [friendshipId, userId]);
  } else {
    return pool.query(`DELETE FROM friends WHERE id = $1 AND addressee_id = $2`, [friendshipId, userId]);
  }
}
async function respondToCrewInvite(crewId, userId, action) {
  if (action === "accept") {
    const memberCount = await getCrewMemberCount(crewId);
    const cap = await getCrewMemberCap(crewId);
    if (memberCount >= cap) {
      throw Object.assign(new Error("This crew has reached its member cap. The crew chief needs to upgrade to the Crew Growth plan."), { code: "MEMBER_CAP_REACHED" });
    }
    return pool.query(`UPDATE crew_members SET status = 'member', joined_at = NOW() WHERE crew_id = $1 AND user_id = $2`, [crewId, userId]);
  } else {
    return pool.query(`DELETE FROM crew_members WHERE crew_id = $1 AND user_id = $2`, [crewId, userId]);
  }
}
async function getParticipantById(participantId) {
  const res = await pool.query(`SELECT * FROM run_participants WHERE id = $1`, [participantId]);
  return res.rows[0] || null;
}
async function respondToJoinRequest(participantId, hostId, action) {
  if (action === "approve") {
    return pool.query(
      `UPDATE run_participants SET status = 'joined' 
       WHERE id = $1 AND run_id IN (SELECT id FROM runs WHERE host_id = $2)`,
      [participantId, hostId]
    );
  } else {
    return pool.query(
      `DELETE FROM run_participants 
       WHERE id = $1 AND run_id IN (SELECT id FROM runs WHERE host_id = $2)`,
      [participantId, hostId]
    );
  }
}
async function getRunMessages(runId, limit = 50) {
  const res = await pool.query(
    `SELECT * FROM run_messages WHERE run_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [runId, limit]
  );
  return res.rows;
}
async function createRunMessage(runId, userId, senderName, senderPhoto, message) {
  const res = await pool.query(
    `INSERT INTO run_messages (run_id, user_id, sender_name, sender_photo, message) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [runId, userId, senderName, senderPhoto, message]
  );
  return res.rows[0];
}
async function isRunParticipant(runId, userId) {
  const res = await pool.query(
    `SELECT 1 FROM run_participants WHERE run_id = $1 AND user_id = $2 AND status != 'cancelled'`,
    [runId, userId]
  );
  return res.rows.length > 0;
}
async function getUserByUsername(username) {
  const res = await pool.query(`SELECT * FROM users WHERE LOWER(username) = LOWER($1)`, [username]);
  return res.rows[0] || null;
}
async function getUserByEmailOrUsername(identifier) {
  const byEmail = await getUserByEmail(identifier);
  if (byEmail) return byEmail;
  return getUserByUsername(identifier);
}
async function createUser(data) {
  const hashedPassword = await bcrypt.hash(data.password, 10);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, username, avg_pace, avg_distance, gender, onboarding_complete) VALUES ($1, $2, $3, $4, NULL, NULL, $5, false) RETURNING *`,
    [data.email.toLowerCase(), hashedPassword, data.name, data.username?.toLowerCase() ?? null, data.gender ?? null]
  );
  return result.rows[0];
}
async function getUserByEmail(email) {
  const result = await pool.query(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
  return result.rows[0] || null;
}
async function getUserById(id) {
  const result = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
  return result.rows[0] || null;
}
async function verifyPassword(plain, hashed) {
  return bcrypt.compare(plain, hashed);
}
async function createPasswordResetToken(userId) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1e3);
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [userId, token, expiresAt]
  );
  return token;
}
async function consumePasswordResetToken(token) {
  const res = await pool.query(
    `UPDATE password_reset_tokens SET used_at = NOW() WHERE token = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING user_id`,
    [token]
  );
  return res.rows[0]?.user_id ?? null;
}
async function updateUserPassword(userId, newPassword) {
  const hashed = await bcrypt.hash(newPassword, 10);
  await pool.query(`UPDATE users SET password = $1 WHERE id = $2`, [hashed, userId]);
}
async function updateUser(id, updates) {
  const entries = Object.entries(updates).filter(([, v]) => v !== void 0);
  if (!entries.length) return null;
  const fields = entries.map(([k], i) => `${toSnake(k)} = $${i + 2}`).join(", ");
  const values = entries.map(([, v]) => v);
  const result = await pool.query(`UPDATE users SET ${fields} WHERE id = $1 RETURNING *`, [id, ...values]);
  return result.rows[0];
}
function toSnake(s) {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase();
}
async function updatePushToken(userId, token) {
  await pool.query(`UPDATE users SET push_token = $2 WHERE id = $1`, [userId, token]);
}
async function createRun(data) {
  const inviteToken = data.privacy === "private" ? Math.random().toString(36).substring(2, 10).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase() : null;
  const activityType = data.activityType === "ride" ? "ride" : data.activityType === "walk" ? "walk" : "run";
  const paceGroupsJson = data.paceGroups && data.paceGroups.length > 0 ? JSON.stringify(data.paceGroups) : null;
  const result = await pool.query(
    `INSERT INTO runs (host_id, title, description, privacy, date, location_lat, location_lng, location_name, min_distance, max_distance, min_pace, max_pace, tags, max_participants, invite_token, invite_password, is_strict, run_style, activity_type, crew_id, saved_path_id, pace_groups)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
    [data.hostId, data.title, data.description || null, data.privacy, data.date, data.locationLat, data.locationLng, data.locationName, data.minDistance, data.maxDistance, data.minPace, data.maxPace, data.tags, data.maxParticipants, inviteToken, data.invitePassword || null, data.isStrict ?? false, data.runStyle || null, activityType, data.crewId || null, data.savedPathId || null, paceGroupsJson]
  );
  return result.rows[0];
}
async function getUserRecentDistances(userId, limit = 10) {
  const result = await pool.query(
    `SELECT distance FROM (
       SELECT distance_miles AS distance, date FROM solo_runs
       WHERE user_id = $1 AND completed = true AND distance_miles IS NOT NULL
       UNION ALL
       SELECT rp.final_distance AS distance, r.date FROM run_participants rp
       JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.final_distance IS NOT NULL
     ) combined
     ORDER BY date DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows.map((r) => r.distance);
}
async function searchUsers(query, currentUserId) {
  const result = await pool.query(
    `SELECT id, name, username, photo_url, completed_runs, total_miles FROM users
     WHERE id != $1 AND (username ILIKE $2 OR name ILIKE $2)
     LIMIT 20`,
    [currentUserId, `%${query}%`]
  );
  return result.rows;
}
async function getFriends(userId) {
  const result = await pool.query(
    `SELECT u.id, u.name, u.username, u.photo_url, u.completed_runs, u.total_miles,
       f.id as friendship_id, f.status, f.created_at as friends_since
     FROM friends f
     JOIN users u ON (CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END) = u.id
     WHERE (f.requester_id = $1 OR f.addressee_id = $1) AND f.status = 'accepted'
     ORDER BY u.name ASC`,
    [userId]
  );
  return result.rows;
}
async function getSentRequests(userId) {
  const result = await pool.query(
    `SELECT u.id, u.name, u.photo_url, f.id as friendship_id, f.created_at
     FROM friends f JOIN users u ON f.addressee_id = u.id
     WHERE f.requester_id = $1 AND f.status = 'pending'`,
    [userId]
  );
  return result.rows;
}
async function getPendingRequests(userId) {
  const result = await pool.query(
    `SELECT u.id, u.name, u.photo_url, f.id as friendship_id, f.created_at
     FROM friends f JOIN users u ON f.requester_id = u.id
     WHERE f.addressee_id = $1 AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
    [userId]
  );
  return result.rows;
}
async function sendFriendRequest(requesterId, addresseeId) {
  const existing = await pool.query(
    `SELECT id, status FROM friends WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
    [requesterId, addresseeId]
  );
  if (existing.rows.length > 0) return { error: existing.rows[0].status === "accepted" ? "already_friends" : "already_requested" };
  const result = await pool.query(
    `INSERT INTO friends (requester_id, addressee_id, status) VALUES ($1, $2, 'pending') RETURNING *`,
    [requesterId, addresseeId]
  );
  return { data: result.rows[0] };
}
async function acceptFriendRequest(friendshipId, userId) {
  const result = await pool.query(
    `UPDATE friends SET status = 'accepted', accepted_at = NOW() WHERE id = $1 AND addressee_id = $2 RETURNING *`,
    [friendshipId, userId]
  );
  return result.rows[0] || null;
}
async function removeFriend(friendshipId, userId) {
  await pool.query(
    `DELETE FROM friends WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)`,
    [friendshipId, userId]
  );
}
async function areFriends(userA, userB) {
  const res = await pool.query(
    `SELECT 1 FROM friends WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)) AND status = 'accepted'`,
    [userA, userB]
  );
  return res.rows.length > 0;
}
async function createRememberToken(userId) {
  const raw = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(raw).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1e3);
  await pool.query(
    `INSERT INTO remember_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt]
  );
  return raw;
}
async function validateRememberToken(raw) {
  const hash = createHash("sha256").update(raw).digest("hex");
  const res = await pool.query(
    `SELECT user_id FROM remember_tokens WHERE token_hash = $1 AND expires_at > NOW()`,
    [hash]
  );
  return res.rows[0]?.user_id ?? null;
}
async function deleteRememberToken(raw) {
  const hash = createHash("sha256").update(raw).digest("hex");
  await pool.query(`DELETE FROM remember_tokens WHERE token_hash = $1`, [hash]);
}
async function deleteUserRememberTokens(userId) {
  await pool.query(`DELETE FROM remember_tokens WHERE user_id = $1`, [userId]);
}
async function getFriendPrivateRuns(userId, bounds) {
  let query = `SELECT r.id, r.title, r.date, r.location_lat, r.location_lng, r.location_name,
    r.min_pace, r.max_pace, r.min_distance, r.max_distance, r.max_participants, r.privacy,
    u.name as host_name, u.photo_url as host_photo, u.marker_icon as host_marker_icon, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.hosted_runs as host_hosted_runs,
    (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
    (SELECT COUNT(*) FROM planned_runs pr WHERE pr.run_id = r.id) as plan_count,
    true as is_locked
  FROM runs r
  JOIN users u ON u.id = r.host_id
  JOIN friends f ON ((f.requester_id = $1 AND f.addressee_id = r.host_id) OR (f.addressee_id = $1 AND f.requester_id = r.host_id))
  WHERE r.privacy = 'private' AND r.date > NOW() AND r.is_completed = false
    AND f.status = 'accepted' AND r.host_id != $1
    AND r.id NOT IN (SELECT run_id FROM run_invites WHERE invitee_id = $1)
    AND r.crew_id IS NULL`;
  const params = [userId];
  let idx = 2;
  if (bounds) {
    query += ` AND r.location_lat BETWEEN $${idx++} AND $${idx++} AND r.location_lng BETWEEN $${idx++} AND $${idx++}`;
    params.push(bounds.swLat, bounds.neLat, bounds.swLng, bounds.neLng);
  }
  query += ` ORDER BY r.date ASC LIMIT 50`;
  const result = await pool.query(query, params);
  return result.rows;
}
async function getInvitedPrivateRuns(userId, bounds) {
  let query = `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.photo_url as host_photo, u.marker_icon as host_marker_icon, u.hosted_runs as host_hosted_runs,
    (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
    (SELECT COUNT(*) FROM planned_runs pr WHERE pr.run_id = r.id) as plan_count,
    false as is_locked
  FROM runs r
  JOIN users u ON u.id = r.host_id
  JOIN run_invites ri ON ri.run_id = r.id AND ri.invitee_id = $1
  WHERE r.privacy = 'private' AND r.date > NOW() AND r.is_completed = false AND r.crew_id IS NULL`;
  const params = [userId];
  let idx = 2;
  if (bounds) {
    query += ` AND r.location_lat BETWEEN $${idx++} AND $${idx++} AND r.location_lng BETWEEN $${idx++} AND $${idx++}`;
    params.push(bounds.swLat, bounds.neLat, bounds.swLng, bounds.neLng);
  }
  query += ` ORDER BY r.date ASC LIMIT 50`;
  const result = await pool.query(query, params);
  return result.rows;
}
async function hasRunAccess(runId, userId) {
  const hostCheck = await pool.query(`SELECT id FROM runs WHERE id = $1 AND host_id = $2`, [runId, userId]);
  if (hostCheck.rows.length > 0) return true;
  const inviteCheck = await pool.query(`SELECT id FROM run_invites WHERE run_id = $1 AND invitee_id = $2`, [runId, userId]);
  return inviteCheck.rows.length > 0;
}
async function grantRunAccess(runId, userId) {
  await pool.query(
    `INSERT INTO run_invites (run_id, invitee_id, invited_by) SELECT $1, $2, host_id FROM runs WHERE id = $1 ON CONFLICT (run_id, invitee_id) DO NOTHING`,
    [runId, userId]
  );
}
async function isCrewMember(crewId, userId) {
  const res = await pool.query(
    `SELECT 1 FROM crew_members WHERE crew_id = $1 AND user_id = $2 AND status = 'member'`,
    [crewId, userId]
  );
  return res.rows.length > 0;
}
async function getUserCrewIds(userId) {
  const res = await pool.query(
    `SELECT crew_id FROM crew_members WHERE user_id = $1 AND status = 'member'`,
    [userId]
  );
  return res.rows;
}
async function getCrewVisibleRuns(userId, bounds) {
  let query = `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.photo_url as host_photo,
      u.marker_icon as host_marker_icon, u.hosted_runs as host_hosted_runs,
      (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
      false as is_locked,
      c.image_url as crew_photo_url
    FROM runs r
    JOIN users u ON u.id = r.host_id
    JOIN crew_members cm ON cm.crew_id = r.crew_id AND cm.user_id = $1 AND cm.status = 'member'
    LEFT JOIN crews c ON c.id = r.crew_id
    WHERE r.crew_id IS NOT NULL AND (r.is_active = true OR r.date > NOW() - INTERVAL '90 minutes') AND r.is_completed = false`;
  const params = [userId];
  query += ` ORDER BY r.date ASC LIMIT 100`;
  const result = await pool.query(query, params);
  return result.rows;
}
async function verifyAndJoinPrivateRun(runId, userId, password, token) {
  const run = await pool.query(`SELECT host_id, invite_password, invite_token FROM runs WHERE id = $1 AND privacy = 'private'`, [runId]);
  if (!run.rows[0]) return { error: "run_not_found" };
  const r = run.rows[0];
  if (password && r.invite_password && r.invite_password === password) {
    await grantRunAccess(runId, userId);
    return { success: true };
  }
  if (token && r.invite_token && r.invite_token.toUpperCase() === token.toUpperCase()) {
    await grantRunAccess(runId, userId);
    return { success: true };
  }
  return { error: "invalid_credentials" };
}
async function getRunByInviteToken(token) {
  const result = await pool.query(
    `SELECT r.*, u.name as host_name FROM runs r JOIN users u ON u.id = r.host_id WHERE r.invite_token = $1`,
    [token]
  );
  return result.rows[0] || null;
}
async function inviteToRun(runId, inviteeId, hostId) {
  await pool.query(
    `INSERT INTO run_invites (run_id, invitee_id, invited_by) VALUES ($1, $2, $3) ON CONFLICT (run_id, invitee_id) DO NOTHING`,
    [runId, inviteeId, hostId]
  );
}
async function updateMarkerIcon(userId, icon) {
  await pool.query(`UPDATE users SET marker_icon = $2 WHERE id = $1`, [userId, icon]);
}
async function getSoloRuns(userId) {
  const result = await pool.query(
    `SELECT * FROM solo_runs WHERE user_id = $1 AND is_deleted IS NOT TRUE ORDER BY date DESC`,
    [userId]
  );
  return result.rows;
}
async function getSoloRunAchievements(userId) {
  const result = await pool.query(
    `WITH
      half_mi AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0 AND distance_miles >= 0.5
      ),
      one_mi AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0 AND distance_miles >= 0.9
      ),
      two_mi AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0 AND distance_miles >= 1.9
      ),
      five_k AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0 AND distance_miles >= 3.0
      ),
      five_mi AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0 AND distance_miles >= 4.8
      ),
      ten_k AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0 AND distance_miles >= 6.0
      ),
      half_mara AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0 AND distance_miles >= 13.0
      ),
      full_mara AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0 AND distance_miles >= 26.0
      ),
      longest AS (
        SELECT id, RANK() OVER (ORDER BY distance_miles DESC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
      ),
      fastest AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0
      ),
      all_achievements AS (
        SELECT id, '\xBD mi' AS label, rnk FROM half_mi WHERE rnk <= 3
        UNION ALL SELECT id, '1 mi', rnk FROM one_mi WHERE rnk <= 3
        UNION ALL SELECT id, '2 mi', rnk FROM two_mi WHERE rnk <= 3
        UNION ALL SELECT id, '5K', rnk FROM five_k WHERE rnk <= 3
        UNION ALL SELECT id, '5 mi', rnk FROM five_mi WHERE rnk <= 3
        UNION ALL SELECT id, '10K', rnk FROM ten_k WHERE rnk <= 3
        UNION ALL SELECT id, 'Half', rnk FROM half_mara WHERE rnk <= 3
        UNION ALL SELECT id, 'Marathon', rnk FROM full_mara WHERE rnk <= 3
        UNION ALL SELECT id, 'Longest', rnk FROM longest WHERE rnk <= 3
        UNION ALL SELECT id, 'Fastest', rnk FROM fastest WHERE rnk <= 3
      )
    SELECT id, label, rnk FROM all_achievements ORDER BY id, rnk`,
    [userId]
  );
  const map = {};
  for (const row of result.rows) {
    if (!map[row.id]) map[row.id] = [];
    map[row.id].push({ label: row.label, rank: Math.min(row.rnk, 3) });
  }
  return map;
}
async function getSoloRunById(id) {
  const result = await pool.query(`SELECT * FROM solo_runs WHERE id = $1`, [id]);
  if (!result.rows.length) return null;
  const row = result.rows[0];
  return { ...row, userId: row.user_id, distanceMiles: row.distance_miles, paceMinPerMile: row.pace_min_per_mile, durationSeconds: row.duration_seconds, elevationGainFt: row.elevation_gain_ft };
}
async function createSoloRun(data) {
  const result = await pool.query(
    `INSERT INTO solo_runs (user_id, title, date, distance_miles, pace_min_per_mile, duration_seconds, completed, planned, notes, route_path, activity_type, saved_path_id, mile_splits, elevation_gain_ft, step_count, move_time_seconds)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [
      data.userId,
      data.title ?? null,
      data.date,
      data.distanceMiles,
      data.paceMinPerMile ?? null,
      data.durationSeconds ?? null,
      data.completed ?? false,
      data.planned ?? false,
      data.notes ?? null,
      data.routePath ? JSON.stringify(data.routePath) : null,
      data.activityType ?? "run",
      data.savedPathId ?? null,
      data.mileSplits ? JSON.stringify(data.mileSplits) : null,
      data.elevationGainFt ?? null,
      data.stepCount ?? null,
      data.moveTimeSeconds ?? null
    ]
  );
  return result.rows[0];
}
async function getSoloRunPrTiers(userId, runId) {
  const runRes = await pool.query(
    `SELECT distance_miles, pace_min_per_mile FROM solo_runs WHERE id = $1 AND user_id = $2 AND completed = true`,
    [runId, userId]
  );
  if (!runRes.rows[0]) return { distanceTier: null, paceTier: null };
  const { distance_miles, pace_min_per_mile } = runRes.rows[0];
  const distCountRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM solo_runs
     WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE AND id != $2
       AND distance_miles > $3`,
    [userId, runId, distance_miles]
  );
  const distRank = parseInt(distCountRes.rows[0]?.cnt ?? "0") + 1;
  const distanceTier = distRank <= 3 ? distRank : null;
  let paceTier = null;
  if (pace_min_per_mile && pace_min_per_mile > 0) {
    const paceCountRes = await pool.query(
      `SELECT COUNT(*) AS cnt FROM solo_runs
       WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE AND id != $2
         AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0
         AND distance_miles BETWEEN $3 * 0.75 AND $3 * 1.25
         AND pace_min_per_mile < $4`,
      [userId, runId, distance_miles, pace_min_per_mile]
    );
    const paceRank = parseInt(paceCountRes.rows[0]?.cnt ?? "0") + 1;
    paceTier = paceRank <= 3 ? paceRank : null;
  }
  return { distanceTier, paceTier };
}
async function getSoloRunsByPathId(userId, pathId) {
  const res = await pool.query(
    `SELECT * FROM solo_runs WHERE user_id = $1 AND saved_path_id = $2 AND completed = true AND is_deleted IS NOT TRUE ORDER BY date DESC`,
    [userId, pathId]
  );
  return res.rows;
}
async function getStarredSoloRuns(userId) {
  const result = await pool.query(
    `SELECT * FROM solo_runs WHERE user_id = $1 AND is_starred = true AND completed = true AND is_deleted IS NOT TRUE ORDER BY date DESC`,
    [userId]
  );
  return result.rows;
}
async function getUserPrContext(userId, excludeRunId) {
  const res = await pool.query(
    `SELECT
       MAX(distance_miles) AS max_distance,
       MIN(CASE WHEN pace_min_per_mile > 0 THEN pace_min_per_mile END) AS best_pace,
       COUNT(*) AS total_runs
     FROM solo_runs
     WHERE user_id = $1
       AND completed = true
       AND is_deleted IS NOT TRUE
       AND id != $2`,
    [userId, excludeRunId]
  );
  const row = res.rows[0];
  return {
    maxDistance: row.max_distance != null ? parseFloat(row.max_distance) : null,
    bestPace: row.best_pace != null ? parseFloat(row.best_pace) : null,
    totalRuns: parseInt(row.total_runs ?? "0")
  };
}
async function toggleStarSoloRun(id, userId) {
  const result = await pool.query(
    `UPDATE solo_runs SET is_starred = NOT is_starred WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId]
  );
  return result.rows[0] || null;
}
async function updateSoloRun(id, userId, updates) {
  const allowed = ["title", "date", "distance_miles", "pace_min_per_mile", "duration_seconds", "completed", "planned", "notes", "route_path", "is_starred", "elevation_gain_ft", "saved_path_id", "ai_summary"];
  const entries = Object.entries(updates).filter(([k]) => allowed.includes(k));
  if (!entries.length) return null;
  const fields = entries.map(([k], i) => `${k} = $${i + 3}`).join(", ");
  const values = entries.map(([, v]) => v);
  const result = await pool.query(
    `UPDATE solo_runs SET ${fields} WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId, ...values]
  );
  return result.rows[0] || null;
}
async function deleteSoloRun(id, userId) {
  await pool.query(
    `UPDATE solo_runs SET is_deleted = true WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
}
async function recomputeUserAvgPace(userId) {
  const paceRes = await pool.query(
    `SELECT AVG(pace_min_per_mile) AS avg_pace
     FROM solo_runs
     WHERE user_id = $1
       AND completed = true
       AND distance_miles > 0.5
       AND pace_min_per_mile IS NOT NULL
       AND pace_min_per_mile >= 2.0`,
    [userId]
  );
  const distRes = await pool.query(
    `SELECT AVG(distance_miles) AS avg_dist
     FROM solo_runs
     WHERE user_id = $1
       AND completed = true
       AND distance_miles > 0.1`,
    [userId]
  );
  const computedPace = paceRes.rows[0]?.avg_pace != null ? parseFloat(paceRes.rows[0].avg_pace) : null;
  const computedDist = distRes.rows[0]?.avg_dist != null ? parseFloat(distRes.rows[0].avg_dist) : null;
  await pool.query(`UPDATE users SET avg_pace = $2, avg_distance = $3 WHERE id = $1`, [userId, computedPace, computedDist]);
}
async function updateSoloGoals(userId, paceGoal, distanceGoal, goalPeriod) {
  await pool.query(
    `UPDATE users SET pace_goal = $2, distance_goal = $3, goal_period = $4 WHERE id = $1`,
    [userId, paceGoal, distanceGoal, goalPeriod]
  );
}
async function getPublicRuns(filters) {
  let query = `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.photo_url as host_photo, u.marker_icon as host_marker_icon, u.hosted_runs as host_hosted_runs,
    (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
    (SELECT COUNT(*) FROM planned_runs pr WHERE pr.run_id = r.id) as plan_count
    FROM runs r JOIN users u ON u.id = r.host_id
    WHERE r.privacy = 'public' AND (r.is_active = true OR r.date > NOW() - INTERVAL '90 minutes') AND r.is_completed = false AND r.crew_id IS NULL AND r.is_deleted IS NOT TRUE`;
  const params = [];
  let idx = 1;
  if (filters?.minPace !== void 0) {
    query += ` AND r.max_pace >= $${idx++}`;
    params.push(filters.minPace);
  }
  if (filters?.maxPace !== void 0) {
    query += ` AND r.min_pace <= $${idx++}`;
    params.push(filters.maxPace);
  }
  if (filters?.minDistance !== void 0) {
    query += ` AND r.max_distance >= $${idx++}`;
    params.push(filters.minDistance);
  }
  if (filters?.maxDistance !== void 0) {
    query += ` AND r.min_distance <= $${idx++}`;
    params.push(filters.maxDistance);
  }
  if (filters?.tag) {
    query += ` AND $${idx++} = ANY(r.tags)`;
    params.push(filters.tag);
  }
  if (filters?.styles && filters.styles.length > 0) {
    query += ` AND r.tags && $${idx++}`;
    params.push(filters.styles);
  }
  if (filters?.swLat !== void 0 && filters.neLat !== void 0) {
    query += ` AND r.location_lat BETWEEN $${idx++} AND $${idx++}`;
    params.push(filters.swLat, filters.neLat);
  }
  if (filters?.swLng !== void 0 && filters.neLng !== void 0) {
    query += ` AND r.location_lng BETWEEN $${idx++} AND $${idx++}`;
    params.push(filters.swLng, filters.neLng);
  }
  query += ` ORDER BY r.date ASC LIMIT 200`;
  const result = await pool.query(query, params);
  return result.rows;
}
async function getRunById(id) {
  const result = await pool.query(
    `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.rating_count as host_rating_count,
      u.photo_url as host_photo, u.avg_pace as host_avg_pace, u.hosted_runs as host_hosted_runs,
      c.name as crew_name,
      sp.name as saved_path_name,
      sp.route_path as saved_path_route,
      (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
      (SELECT COUNT(*) FROM planned_runs pr WHERE pr.run_id = r.id) as plan_count
     FROM runs r
     JOIN users u ON u.id = r.host_id
     LEFT JOIN crews c ON c.id = r.crew_id
     LEFT JOIN saved_paths sp ON sp.id = r.saved_path_id
     WHERE r.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}
async function getUserRuns(userId) {
  const result = await pool.query(
    `SELECT r.*, u.name as host_name,
      (SELECT rp2.status FROM run_participants rp2 WHERE rp2.run_id = r.id AND rp2.user_id = $1 LIMIT 1) as my_status,
      CASE WHEN r.host_id = $1 THEN true ELSE false END as is_host,
      COALESCE((SELECT rp3.is_present FROM run_participants rp3 WHERE rp3.run_id = r.id AND rp3.user_id = $1 LIMIT 1), false) as my_is_present,
      (SELECT rp5.final_distance FROM run_participants rp5 WHERE rp5.run_id = r.id AND rp5.user_id = $1 LIMIT 1) as my_final_distance,
      (SELECT rp6.final_pace FROM run_participants rp6 WHERE rp6.run_id = r.id AND rp6.user_id = $1 LIMIT 1) as my_final_pace,
      (SELECT rp7.mile_splits FROM run_participants rp7 WHERE rp7.run_id = r.id AND rp7.user_id = $1 LIMIT 1) as my_mile_splits,
      (SELECT json_agg(pt ORDER BY pt.recorded_at)
         FROM (
           SELECT latitude, longitude, recorded_at
           FROM run_tracking_points
           WHERE run_id = r.id AND user_id = $1
           ORDER BY recorded_at
           LIMIT 200
         ) pt
      ) as my_route_path
     FROM runs r
     JOIN users u ON u.id = r.host_id
     WHERE (r.host_id = $1 OR r.id IN (SELECT run_id FROM run_participants WHERE user_id = $1 AND status != 'cancelled'))
       AND r.is_deleted IS NOT TRUE
       AND (
         r.date > NOW()
         OR r.host_id = $1
         OR EXISTS (SELECT 1 FROM run_participants rp4 WHERE rp4.run_id = r.id AND rp4.user_id = $1 AND rp4.status != 'cancelled')
       )
     ORDER BY r.date DESC`,
    [userId]
  );
  return result.rows;
}
async function joinRun(runId, userId, paceGroupLabel) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT id FROM runs WHERE id = $1 FOR UPDATE`, [runId]);
    const existing = await client.query(
      `SELECT * FROM run_participants WHERE run_id = $1 AND user_id = $2`,
      [runId, userId]
    );
    if (existing.rows.length > 0) {
      if (existing.rows[0].status === "cancelled") {
        const runRow2 = await client.query(
          `SELECT max_participants FROM runs WHERE id = $1`,
          [runId]
        );
        const maxP2 = runRow2.rows[0]?.max_participants;
        if (maxP2) {
          const countRes = await client.query(
            `SELECT COUNT(*) FROM run_participants WHERE run_id = $1 AND status IN ('joined', 'confirmed')`,
            [runId]
          );
          if (parseInt(countRes.rows[0].count, 10) >= maxP2) {
            await client.query("ROLLBACK");
            throw new Error("EVENT_FULL");
          }
        }
        await client.query(
          `UPDATE run_participants SET status = 'joined', pace_group_label = $3 WHERE run_id = $1 AND user_id = $2`,
          [runId, userId, paceGroupLabel || null]
        );
      } else if (paceGroupLabel) {
        await client.query(
          `UPDATE run_participants SET pace_group_label = $3 WHERE run_id = $1 AND user_id = $2`,
          [runId, userId, paceGroupLabel]
        );
      }
      const updated = await client.query(
        `SELECT * FROM run_participants WHERE run_id = $1 AND user_id = $2`,
        [runId, userId]
      );
      await client.query("COMMIT");
      return updated.rows[0];
    }
    const runRow = await client.query(
      `SELECT max_participants FROM runs WHERE id = $1`,
      [runId]
    );
    const maxP = runRow.rows[0]?.max_participants;
    if (maxP) {
      const countRes = await client.query(
        `SELECT COUNT(*) FROM run_participants WHERE run_id = $1 AND status IN ('joined', 'confirmed')`,
        [runId]
      );
      if (parseInt(countRes.rows[0].count, 10) >= maxP) {
        await client.query("ROLLBACK");
        throw new Error("EVENT_FULL");
      }
    }
    const result = await client.query(
      `INSERT INTO run_participants (run_id, user_id, pace_group_label) VALUES ($1, $2, $3) RETURNING *`,
      [runId, userId, paceGroupLabel || null]
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
async function requestJoinRun(runId, userId) {
  const existing = await pool.query(
    `SELECT * FROM run_participants WHERE run_id = $1 AND user_id = $2`,
    [runId, userId]
  );
  if (existing.rows.length > 0) {
    return { alreadyExists: true, row: existing.rows[0] };
  }
  const result = await pool.query(
    `INSERT INTO run_participants (run_id, user_id, status) VALUES ($1, $2, 'pending') RETURNING *`,
    [runId, userId]
  );
  return { alreadyExists: false, row: result.rows[0] };
}
async function leaveRun(runId, userId) {
  await pool.query(
    `UPDATE run_participants SET status = 'cancelled' WHERE run_id = $1 AND user_id = $2`,
    [runId, userId]
  );
}
async function getParticipantStatus(runId, userId) {
  const result = await pool.query(
    `SELECT status FROM run_participants WHERE run_id = $1 AND user_id = $2`,
    [runId, userId]
  );
  return result.rows[0]?.status ?? null;
}
async function getRunParticipantCount(runId) {
  const result = await pool.query(
    `SELECT COUNT(*) FROM run_participants WHERE run_id = $1 AND status IN ('joined', 'confirmed')`,
    [runId]
  );
  return parseInt(result.rows[0].count, 10);
}
async function decrementCompletedRuns(userId) {
  await pool.query(
    `UPDATE users SET completed_runs = GREATEST(0, completed_runs - 1) WHERE id = $1`,
    [userId]
  );
}
async function getGarminToken(userId) {
  const result = await pool.query(
    `SELECT garmin_access_token as access_token, garmin_token_secret as token_secret FROM users WHERE id = $1`,
    [userId]
  );
  if (!result.rows[0]?.access_token) return null;
  return result.rows[0];
}
async function getGarminLastSync(userId) {
  const result = await pool.query(
    `SELECT MAX(created_at) as last_sync FROM solo_runs WHERE user_id = $1 AND garmin_activity_id IS NOT NULL`,
    [userId]
  );
  return result.rows[0]?.last_sync?.toISOString() ?? null;
}
async function saveGarminToken(userId, accessToken, tokenSecret) {
  await pool.query(
    `UPDATE users SET garmin_access_token = $1, garmin_token_secret = $2 WHERE id = $3`,
    [accessToken, tokenSecret, userId]
  );
}
async function saveGarminActivity(userId, garminActivityId, data) {
  const existing = await pool.query(
    `SELECT id FROM solo_runs WHERE garmin_activity_id = $1`,
    [garminActivityId]
  );
  if (existing.rows.length > 0) return false;
  await pool.query(
    `INSERT INTO solo_runs (user_id, garmin_activity_id, source, title, date, distance_miles, pace_min_per_mile, duration_seconds, activity_type, completed, planned)
     VALUES ($1, $2, 'garmin', $3, $4, $5, $6, $7, $8, true, false)`,
    [userId, garminActivityId, data.title, data.date, data.distanceMiles, data.paceMinPerMile, data.durationSeconds, data.activityType]
  );
  return true;
}
async function saveHealthKitActivity(userId, healthKitId, data) {
  const existing = await pool.query(
    `SELECT id FROM solo_runs WHERE apple_health_id = $1`,
    [healthKitId]
  );
  if (existing.rows.length > 0) return false;
  await pool.query(
    `INSERT INTO solo_runs (user_id, apple_health_id, source, title, date, distance_miles, pace_min_per_mile, duration_seconds, activity_type, completed, planned)
     VALUES ($1, $2, 'apple_health', $3, $4, $5, $6, $7, $8, true, false)`,
    [userId, healthKitId, data.title, data.date, data.distanceMiles, data.paceMinPerMile, data.durationSeconds, data.activityType]
  );
  return true;
}
async function saveHealthConnectActivity(userId, hcId, data) {
  const byId = await pool.query(
    `SELECT id FROM solo_runs WHERE health_connect_id = $1`,
    [hcId]
  );
  if (byId.rows.length > 0) return false;
  const windowStart = new Date(data.date.getTime() - 6e4);
  const windowEnd = new Date(data.date.getTime() + 6e4);
  const byTime = await pool.query(
    `SELECT id FROM solo_runs WHERE user_id = $1 AND date >= $2 AND date <= $3 AND completed = true`,
    [userId, windowStart, windowEnd]
  );
  if (byTime.rows.length > 0) return false;
  await pool.query(
    `INSERT INTO solo_runs (user_id, health_connect_id, source, title, date, distance_miles, pace_min_per_mile, duration_seconds, activity_type, completed, planned)
     VALUES ($1, $2, 'health_connect', $3, $4, $5, $6, $7, $8, true, false)`,
    [userId, hcId, data.title, data.date, data.distanceMiles, data.paceMinPerMile, data.durationSeconds, data.activityType]
  );
  return true;
}
async function getRunParticipantTokens(runId) {
  const result = await pool.query(
    `SELECT u.name, u.push_token
     FROM run_participants rp
     JOIN users u ON u.id = rp.user_id
     WHERE rp.run_id = $1 AND rp.status != 'cancelled' AND u.push_token IS NOT NULL`,
    [runId]
  );
  return result.rows;
}
async function updateRunDateTime(runId, userId, newDate) {
  const run = await pool.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  if (!run.rows.length) throw new Error("Run not found");
  if (run.rows[0].host_id !== userId) throw new Error("Only the host can edit this run");
  const updated = await pool.query(
    `UPDATE runs SET date = $2, notif_late_start_sent = false, notif_pre_run_sent = false WHERE id = $1 RETURNING *`,
    [runId, newDate]
  );
  return updated.rows[0];
}
async function cancelRun(runId, userId) {
  const run = await pool.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  if (!run.rows.length) throw new Error("Run not found");
  if (run.rows[0].host_id !== userId) throw new Error("Only the host can cancel this run");
  const tokens = await getRunParticipantTokens(runId);
  await pool.query(`DELETE FROM run_participants WHERE run_id = $1`, [runId]);
  await pool.query(`DELETE FROM run_invites WHERE run_id = $1`, [runId]);
  await pool.query(`DELETE FROM bookmarked_runs WHERE run_id = $1`, [runId]);
  await pool.query(`DELETE FROM run_photos WHERE run_id = $1`, [runId]);
  await pool.query(`DELETE FROM runs WHERE id = $1`, [runId]);
  return { title: run.rows[0].title, tokens };
}
async function getRunParticipants(runId) {
  const result = await pool.query(
    `SELECT u.id, u.name, u.photo_url, u.avg_pace, u.avg_distance, rp.status, rp.joined_at, rp.id as participation_id, rp.pace_group_label,
       (SELECT a.slug FROM achievements a
        WHERE a.user_id = u.id AND a.slug IN ('reliable_90','reliable_80','reliable_65','reliable_50')
        ORDER BY CASE a.slug
          WHEN 'reliable_90' THEN 1
          WHEN 'reliable_80' THEN 2
          WHEN 'reliable_65' THEN 3
          WHEN 'reliable_50' THEN 4
        END LIMIT 1) AS reliability_slug
     FROM run_participants rp JOIN users u ON u.id = rp.user_id
     WHERE rp.run_id = $1 AND rp.status != 'cancelled' ORDER BY rp.pace_group_label ASC NULLS LAST, rp.joined_at ASC`,
    [runId]
  );
  return result.rows;
}
async function confirmRunCompletion(runId, userId, milesLogged) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE run_participants SET status = 'confirmed', miles_logged = $3 WHERE run_id = $1 AND user_id = $2`,
      [runId, userId, milesLogged]
    );
    const userResult = await client.query(
      `UPDATE users SET
        completed_runs = completed_runs + 1,
        total_miles = total_miles + $2,
        miles_this_year = miles_this_year + $2,
        miles_this_month = miles_this_month + $2
       WHERE id = $1 RETURNING total_miles`,
      [userId, milesLogged]
    );
    const totalMiles = userResult.rows[0]?.total_miles;
    const runRes = await client.query(`SELECT host_id FROM runs WHERE id = $1`, [runId]);
    const hostId = runRes.rows[0]?.host_id;
    if (hostId && userId !== hostId) {
      const confirmedNonHost = await client.query(
        `SELECT COUNT(*) as cnt FROM run_participants WHERE run_id = $1 AND status = 'confirmed' AND user_id != $2`,
        [runId, hostId]
      );
      if (parseInt(confirmedNonHost.rows[0]?.cnt) === 1) {
        await client.query(`UPDATE users SET hosted_runs = hosted_runs + 1 WHERE id = $1`, [hostId]);
      }
    }
    if (totalMiles !== void 0) {
      await checkAndAwardAchievements(userId, totalMiles, client);
    }
    await checkHostUnlock(userId, client);
    const runData = await client.query(`SELECT crew_id FROM runs WHERE id = $1`, [runId]);
    let crewStreakUpdated = null;
    if (runData.rows[0]?.crew_id) {
      const crewId = runData.rows[0].crew_id;
      const crewRes = await client.query(
        `SELECT id, name, current_streak_weeks, last_run_week FROM crews WHERE id = $1 FOR UPDATE`,
        [crewId]
      );
      if (crewRes.rows[0]) {
        const crew = crewRes.rows[0];
        const now = /* @__PURE__ */ new Date();
        const lastRun = crew.last_run_week ? new Date(crew.last_run_week) : null;
        const getWeekNumber = (d) => {
          const onejan = new Date(d.getFullYear(), 0, 1);
          return Math.ceil(((d.getTime() - onejan.getTime()) / 864e5 + onejan.getDay() + 1) / 7);
        };
        const currentWeek = getWeekNumber(now);
        const currentYear = now.getFullYear();
        const lastWeek = lastRun ? getWeekNumber(lastRun) : -1;
        const lastYear = lastRun ? lastRun.getFullYear() : -1;
        let newStreak = crew.current_streak_weeks || 0;
        if (lastYear === currentYear && lastWeek === currentWeek) {
        } else if (lastYear === currentYear && lastWeek === currentWeek - 1) {
          newStreak++;
        } else if (lastYear === currentYear - 1 && lastWeek >= 52 && currentWeek === 1) {
          newStreak++;
        } else {
          newStreak = 1;
        }
        await client.query(
          `UPDATE crews SET current_streak_weeks = $2, last_run_week = $3 WHERE id = $1`,
          [crewId, newStreak, now]
        );
        crewStreakUpdated = { crewId, newStreak };
      }
    }
    await client.query("COMMIT");
    return { success: true, crewStreakUpdated };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
async function startGroupRun(runId, hostId) {
  const runRes = await pool.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  if (!runRes.rows.length) throw new Error("Run not found");
  const run = runRes.rows[0];
  if (run.host_id !== hostId) throw new Error("Only the host can start the run");
  if (run.is_active) throw new Error("Run already started");
  await pool.query(`UPDATE runs SET is_active = true, started_at = NOW() WHERE id = $1`, [runId]);
  await pool.query(
    `INSERT INTO run_participants (run_id, user_id, status, is_present)
     VALUES ($1, $2, 'joined', true)
     ON CONFLICT (run_id, user_id) DO UPDATE SET is_present = true`,
    [runId, hostId]
  );
  const latestPings = await pool.query(
    `SELECT DISTINCT ON (user_id) user_id, latitude, longitude
     FROM run_tracking_points WHERE run_id = $1 ORDER BY user_id, recorded_at DESC`,
    [runId]
  );
  for (const ping of latestPings.rows) {
    const dist = haversineKm(ping.latitude, ping.longitude, run.location_lat, run.location_lng);
    if (dist <= 0.1524) {
      await pool.query(
        `UPDATE run_participants SET is_present = true WHERE run_id = $1 AND user_id = $2 AND status != 'cancelled'`,
        [runId, ping.user_id]
      );
    }
  }
  return getRunById(runId);
}
async function pingRunLocation(runId, userId, latitude, longitude, cumulativeDistance, pace) {
  await pool.query(
    `INSERT INTO run_tracking_points (run_id, user_id, latitude, longitude, cumulative_distance, pace)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [runId, userId, latitude, longitude, cumulativeDistance, pace]
  );
  const runRes = await pool.query(`SELECT host_id, location_lat, location_lng, is_active FROM runs WHERE id = $1`, [runId]);
  if (!runRes.rows.length) return { isPresent: false, isActive: false };
  const run = runRes.rows[0];
  if (userId === run.host_id) {
    await pool.query(
      `INSERT INTO run_participants (run_id, user_id, status, is_present)
       SELECT $1, $2, 'joined', true
       WHERE NOT EXISTS (SELECT 1 FROM run_participants WHERE run_id = $1 AND user_id = $2)`,
      [runId, userId]
    );
  }
  let isPresent = false;
  if (run.is_active) {
    const distKm = haversineKm(latitude, longitude, run.location_lat, run.location_lng);
    const within500ft = distKm <= 0.1524;
    const isHost = userId === run.host_id;
    if (within500ft || isHost) {
      const upsertRes = await pool.query(
        `INSERT INTO run_participants (run_id, user_id, status, is_present)
         VALUES ($1, $2, 'joined', true)
         ON CONFLICT (run_id, user_id) DO UPDATE SET is_present = true
         WHERE run_participants.status != 'cancelled'
         RETURNING run_id`,
        [runId, userId]
      );
      isPresent = (upsertRes.rowCount ?? 0) > 0;
    } else {
      const presRes = await pool.query(
        `SELECT is_present FROM run_participants WHERE run_id = $1 AND user_id = $2 AND status != 'cancelled'`,
        [runId, userId]
      );
      isPresent = presRes.rows[0]?.is_present ?? false;
    }
  }
  return { isPresent, isActive: run.is_active };
}
async function getLiveRunState(runId) {
  const runRes = await pool.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  if (!runRes.rows.length) return null;
  const run = runRes.rows[0];
  const participantsRes = await pool.query(
    `SELECT rp.user_id, u.name, u.photo_url, rp.is_present, rp.final_distance, rp.final_pace, rp.final_rank,
       rp.tag_along_of_user_id,
       tp.latitude, tp.longitude, tp.cumulative_distance, tp.pace as current_pace, tp.recorded_at
     FROM run_participants rp
     JOIN users u ON u.id = rp.user_id
     LEFT JOIN LATERAL (
       SELECT * FROM run_tracking_points
       WHERE run_id = $1 AND user_id = rp.user_id
       ORDER BY recorded_at DESC LIMIT 1
     ) tp ON true
     WHERE rp.run_id = $1 AND rp.status != 'cancelled'
     ORDER BY rp.joined_at ASC`,
    [runId]
  );
  const tagAlongRes = await pool.query(
    `SELECT tar.*, ru.name as requester_name, tu.name as target_name
     FROM tag_along_requests tar
     JOIN users ru ON ru.id = tar.requester_id
     JOIN users tu ON tu.id = tar.target_id
     WHERE tar.run_id = $1 AND tar.status IN ('pending', 'accepted')`,
    [runId]
  );
  const STALE_THRESHOLD_MS = 90 * 1e3;
  const now = Date.now();
  const participants = participantsRes.rows.map((r) => {
    const lastPingAge = r.recorded_at ? now - new Date(r.recorded_at).getTime() : null;
    const isStale = r.is_present && r.final_pace == null && lastPingAge != null && lastPingAge > STALE_THRESHOLD_MS;
    return { ...r, isStale: !!isStale };
  });
  const activeCount = participants.filter((r) => r.is_present && !r.isStale && r.final_pace == null).length;
  const staleCount = participants.filter((r) => r.isStale).length;
  const presentCount = participants.filter((r) => r.is_present).length;
  return {
    isActive: run.is_active,
    isCompleted: run.is_completed,
    startedAt: run.started_at,
    hostId: run.host_id,
    presentCount,
    activeCount,
    staleCount,
    participants,
    tagAlongRequests: tagAlongRes.rows
  };
}
async function createTagAlongRequest(runId, requesterId, targetId) {
  const runRes = await pool.query(
    `SELECT privacy, is_active, is_completed, host_id FROM runs WHERE id = $1`,
    [runId]
  );
  if (!runRes.rows.length) throw new Error("Run not found");
  const run = runRes.rows[0];
  if (run.privacy === "solo") throw new Error("Cannot tag along on a solo run");
  if (!run.is_active || run.is_completed) throw new Error("Tag-along requests can only be sent during an active run");
  if (run.host_id === requesterId) throw new Error("Host cannot tag along");
  const reqParticipant = await pool.query(
    `SELECT 1 FROM run_participants WHERE run_id = $1 AND user_id = $2 AND status != 'cancelled'`,
    [runId, requesterId]
  );
  if (!reqParticipant.rows.length) throw new Error("You are not a participant in this run");
  const tgtParticipant = await pool.query(
    `SELECT 1 FROM run_participants WHERE run_id = $1 AND user_id = $2 AND status != 'cancelled'`,
    [runId, targetId]
  );
  if (!tgtParticipant.rows.length) throw new Error("Target is not a participant in this run");
  if (run.host_id === targetId) throw new Error("Cannot tag along with the host");
  const acceptedCheck = await pool.query(
    `SELECT 1 FROM tag_along_requests
     WHERE run_id = $1 AND status = 'accepted'
       AND (requester_id = $2 OR target_id = $2 OR requester_id = $3 OR target_id = $3)`,
    [runId, requesterId, targetId]
  );
  if (acceptedCheck.rows.length) throw new Error("One of these participants is already in an accepted tag-along for this run");
  const existing = await pool.query(
    `SELECT id, status FROM tag_along_requests WHERE run_id = $1 AND requester_id = $2`,
    [runId, requesterId]
  );
  if (existing.rows.length > 0) {
    const ex = existing.rows[0];
    await pool.query(
      `UPDATE tag_along_requests SET target_id = $2, status = 'pending', created_at = NOW() WHERE id = $1`,
      [ex.id, targetId]
    );
    const res2 = await pool.query(`SELECT * FROM tag_along_requests WHERE id = $1`, [ex.id]);
    return res2.rows[0];
  }
  const res = await pool.query(
    `INSERT INTO tag_along_requests (run_id, requester_id, target_id, status)
     VALUES ($1, $2, $3, 'pending') RETURNING *`,
    [runId, requesterId, targetId]
  );
  return res.rows[0];
}
async function acceptTagAlongRequest(requestId, targetId, runId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const runCheck = await client.query(
      `SELECT is_active, is_completed FROM runs WHERE id = $1`,
      [runId]
    );
    if (!runCheck.rows.length || !runCheck.rows[0].is_active || runCheck.rows[0].is_completed) {
      await client.query("ROLLBACK");
      throw new Error("Tag-along can only be accepted during an active run");
    }
    const reqRes = await client.query(
      `SELECT * FROM tag_along_requests WHERE id = $1 AND target_id = $2 AND run_id = $3 AND status = 'pending'`,
      [requestId, targetId, runId]
    );
    if (!reqRes.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }
    const req = reqRes.rows[0];
    const existingAccepted = await client.query(
      `SELECT 1 FROM tag_along_requests
       WHERE run_id = $1 AND status = 'accepted'
         AND (requester_id = $2 OR target_id = $2 OR requester_id = $3 OR target_id = $3)`,
      [runId, targetId, req.requester_id]
    );
    if (existingAccepted.rows.length) {
      await client.query("ROLLBACK");
      throw new Error("One of these participants is already in an accepted tag-along for this run");
    }
    const updated = await client.query(
      `UPDATE tag_along_requests SET status = 'accepted' WHERE id = $1 RETURNING *`,
      [requestId]
    );
    await client.query(
      `UPDATE run_participants SET tag_along_of_user_id = $3 WHERE run_id = $1 AND user_id = $2`,
      [runId, req.requester_id, targetId]
    );
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
async function declineTagAlongRequest(requestId, targetId, runId) {
  const res = await pool.query(
    `UPDATE tag_along_requests SET status = 'declined'
     WHERE id = $1 AND target_id = $2 AND run_id = $3 AND status = 'pending' RETURNING *`,
    [requestId, targetId, runId]
  );
  return res.rows.length > 0 ? res.rows[0] : null;
}
async function cancelTagAlongRequest(requestId, requesterId, runId) {
  const res = await pool.query(
    `UPDATE tag_along_requests SET status = 'declined'
     WHERE id = $1 AND requester_id = $2 AND run_id = $3 AND status = 'pending' RETURNING *`,
    [requestId, requesterId, runId]
  );
  return res.rows.length > 0 ? res.rows[0] : null;
}
async function finalizeTagAlongsForRun(runId) {
  const tagRes = await pool.query(
    `SELECT requester_id, target_id FROM tag_along_requests WHERE run_id = $1 AND status = 'accepted'`,
    [runId]
  );
  for (const row of tagRes.rows) {
    try {
      await createSoloRunForTagAlong(runId, row.requester_id, row.target_id);
    } catch (e) {
      console.error("[tag-along] finalizeTagAlongsForRun error for", row.requester_id, e?.message);
    }
  }
}
function haversineDistMi(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
async function createSoloRunForTagAlong(runId, tagAlongUserId, acceptorUserId) {
  const runRes = await pool.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  if (!runRes.rows.length) return false;
  const run = runRes.rows[0];
  const existingCheck = await pool.query(
    `SELECT 1 FROM solo_runs WHERE user_id = $1 AND tag_along_source_run_id = $2 LIMIT 1`,
    [tagAlongUserId, runId]
  );
  if (existingCheck.rows.length > 0) return false;
  const routeRes = await pool.query(
    `SELECT latitude, longitude, recorded_at FROM run_tracking_points
     WHERE run_id = $1 AND user_id = $2 ORDER BY recorded_at ASC`,
    [runId, acceptorUserId]
  );
  const pts = routeRes.rows;
  const partRes = await pool.query(
    `SELECT final_distance, final_pace FROM run_participants WHERE run_id = $1 AND user_id = $2`,
    [runId, acceptorUserId]
  );
  let finalDist = partRes.rows[0]?.final_distance ?? null;
  let finalPace = partRes.rows[0]?.final_pace ?? null;
  if ((!finalDist || finalDist <= 0) && pts.length >= 2) {
    let gpsDist = 0;
    for (let i = 1; i < pts.length; i++) {
      gpsDist += haversineDistMi(
        parseFloat(pts[i - 1].latitude),
        parseFloat(pts[i - 1].longitude),
        parseFloat(pts[i].latitude),
        parseFloat(pts[i].longitude)
      );
    }
    if (gpsDist > 0.01) {
      finalDist = gpsDist;
      const firstTs = new Date(pts[0].recorded_at).getTime();
      const lastTs = new Date(pts[pts.length - 1].recorded_at).getTime();
      const elapsedMin = (lastTs - firstTs) / 6e4;
      finalPace = elapsedMin > 0 && gpsDist > 0 ? elapsedMin / gpsDist : null;
    }
  }
  if (!finalDist || finalDist <= 0) return false;
  const routePath = pts.length > 0 ? JSON.stringify(pts.map((r) => ({ latitude: r.latitude, longitude: r.longitude }))) : null;
  const duration = finalPace && finalPace > 0 && finalDist > 0 ? Math.round(finalPace * 60 * finalDist) : null;
  const actType = run.activity_type || "run";
  const label = actType === "ride" ? "Ride" : actType === "walk" ? "Walk" : "Run";
  const title = `${run.title} (Tag-Along ${label})`;
  await pool.query(
    `INSERT INTO solo_runs (user_id, title, date, distance_miles, pace_min_per_mile, duration_seconds, completed, route_path, activity_type, tag_along_source_run_id)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7::jsonb, $8, $9)`,
    [tagAlongUserId, title, run.date, finalDist, finalPace, duration, routePath, actType, runId]
  );
  return true;
}
async function finishRunnerRun(runId, userId, finalDistance, finalPace, mileSplits) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO run_participants (run_id, user_id, status, is_present)
       VALUES ($1, $2, 'joined', true)
       ON CONFLICT (run_id, user_id) DO UPDATE SET is_present = true`,
      [runId, userId]
    );
    await client.query(
      `UPDATE run_participants SET final_distance = $3, final_pace = $4, mile_splits = $5 WHERE run_id = $1 AND user_id = $2`,
      [runId, userId, finalDistance, finalPace, mileSplits && mileSplits.length > 0 ? JSON.stringify(mileSplits) : null]
    );
    const runRes = await client.query(`SELECT host_id FROM runs WHERE id = $1`, [runId]);
    let shouldComplete = false;
    if (runRes.rows.length) {
      const remaining = await client.query(
        `SELECT COUNT(*) FROM run_participants
         WHERE run_id = $1 AND is_present = true AND final_pace IS NULL AND status != 'cancelled'`,
        [runId]
      );
      shouldComplete = parseInt(remaining.rows[0].count) === 0;
      if (shouldComplete) {
        await client.query(
          `UPDATE runs SET is_completed = true, is_active = false WHERE id = $1`,
          [runId]
        );
        await computeLeaderboardRanksWithClient(runId, client);
        await client.query(
          `DELETE FROM planned_runs WHERE run_id = $1`,
          [runId]
        );
      }
    }
    await client.query("COMMIT");
    if (shouldComplete) {
      finalizeTagAlongsForRun(runId).catch(
        (e) => console.error("[tag-along] finalizeTagAlongsForRun error", e?.message)
      );
    } else if (finalDistance > 0 && finalPace > 0) {
      pool.query(
        `SELECT requester_id FROM tag_along_requests
         WHERE run_id = $1 AND target_id = $2 AND status = 'accepted'`,
        [runId, userId]
      ).then(async (tagRes) => {
        for (const row of tagRes.rows) {
          try {
            await createSoloRunForTagAlong(runId, row.requester_id, userId);
          } catch (e) {
            console.error("[tag-along] Failed to create solo run for", row.requester_id, e?.message);
          }
        }
      }).catch((e) => console.error("[tag-along] query error", e?.message));
    }
    return { success: true, shouldComplete };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
async function computeLeaderboardRanksWithClient(runId, db) {
  const runInfoRes = await db.query(`SELECT crew_id FROM runs WHERE id = $1`, [runId]);
  const isCrewRun = runInfoRes.rows.length > 0 && !!runInfoRes.rows[0].crew_id;
  if (isCrewRun) {
    const groupsRes = await db.query(
      `SELECT DISTINCT pace_group_label FROM run_participants
       WHERE run_id = $1 AND final_pace IS NOT NULL AND final_pace > 0`,
      [runId]
    );
    for (const groupRow of groupsRes.rows) {
      const label = groupRow.pace_group_label;
      const finishedRes = await db.query(
        `SELECT user_id, final_pace FROM run_participants
         WHERE run_id = $1 AND final_pace IS NOT NULL AND final_pace > 0
           AND (pace_group_label = $2 OR ($2::text IS NULL AND pace_group_label IS NULL))
         ORDER BY final_pace ASC`,
        [runId, label]
      );
      for (let i = 0; i < finishedRes.rows.length; i++) {
        await db.query(
          `UPDATE run_participants SET final_rank = $3 WHERE run_id = $1 AND user_id = $2`,
          [runId, finishedRes.rows[i].user_id, i + 1]
        );
      }
    }
  } else {
    const finishedRes = await db.query(
      `SELECT user_id, final_pace FROM run_participants
       WHERE run_id = $1 AND final_pace IS NOT NULL AND final_pace > 0 ORDER BY final_pace ASC`,
      [runId]
    );
    for (let i = 0; i < finishedRes.rows.length; i++) {
      await db.query(
        `UPDATE run_participants SET final_rank = $3 WHERE run_id = $1 AND user_id = $2`,
        [runId, finishedRes.rows[i].user_id, i + 1]
      );
    }
  }
}
async function forceCompleteRun(runId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const unfinished = await client.query(
      `SELECT rp.user_id
       FROM run_participants rp
       WHERE rp.run_id = $1 AND rp.is_present = true
         AND rp.final_pace IS NULL AND rp.status != 'cancelled'`,
      [runId]
    );
    for (const row of unfinished.rows) {
      const tpRes = await client.query(
        `SELECT cumulative_distance,
                COALESCE(
                  (SELECT pace FROM run_tracking_points
                   WHERE run_id = $1 AND user_id = $2 AND pace > 0
                   ORDER BY recorded_at DESC LIMIT 1),
                  pace
                ) AS pace
         FROM run_tracking_points
         WHERE run_id = $1 AND user_id = $2
         ORDER BY recorded_at DESC LIMIT 1`,
        [runId, row.user_id]
      );
      if (tpRes.rows.length > 0) {
        const safeDist = parseFloat(tpRes.rows[0].cumulative_distance) || 0;
        const safePace = parseFloat(tpRes.rows[0].pace) || 0;
        if (safeDist > 0) {
          await client.query(
            `UPDATE run_participants SET final_distance = $3, final_pace = $4, status = 'confirmed'
             WHERE run_id = $1 AND user_id = $2`,
            [runId, row.user_id, safeDist, safePace]
          );
        } else {
          await client.query(
            `UPDATE run_participants SET status = 'confirmed'
             WHERE run_id = $1 AND user_id = $2`,
            [runId, row.user_id]
          );
        }
      } else {
        await client.query(
          `UPDATE run_participants SET status = 'confirmed'
           WHERE run_id = $1 AND user_id = $2`,
          [runId, row.user_id]
        );
      }
    }
    await client.query(
      `UPDATE runs SET is_completed = true, is_active = false WHERE id = $1`,
      [runId]
    );
    await computeLeaderboardRanksWithClient(runId, client);
    await client.query(
      `DELETE FROM planned_runs WHERE run_id = $1`,
      [runId]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
async function getRunResults(runId) {
  const result = await pool.query(
    `SELECT rp.user_id, u.name, u.photo_url, rp.final_distance, rp.final_pace, rp.final_rank, rp.is_present, rp.pace_group_label
     FROM run_participants rp
     JOIN users u ON u.id = rp.user_id
     WHERE rp.run_id = $1
       AND rp.status != 'cancelled'
       AND (rp.is_present = true OR rp.final_distance IS NOT NULL)
     ORDER BY rp.pace_group_label ASC NULLS LAST, rp.final_rank ASC NULLS LAST, rp.joined_at ASC`,
    [runId]
  );
  return result.rows;
}
async function getHostRoutePath(runId) {
  const runRes = await pool.query(`SELECT host_id FROM runs WHERE id = $1`, [runId]);
  if (!runRes.rows.length) return [];
  const hostId = runRes.rows[0].host_id;
  const result = await pool.query(
    `SELECT latitude, longitude FROM run_tracking_points
     WHERE run_id = $1 AND user_id = $2
     ORDER BY recorded_at ASC`,
    [runId, hostId]
  );
  return result.rows;
}
async function checkHostUnlock(userId, db = pool) {
  const result = await db.query(
    `SELECT COUNT(DISTINCT r.host_id) as unique_hosts, COUNT(*) as total_runs
     FROM run_participants rp
     JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.host_id != $1`,
    [userId]
  );
  const { unique_hosts, total_runs } = result.rows[0];
  if (parseInt(total_runs) >= 3 && parseInt(unique_hosts) >= 2) {
    await db.query(
      `UPDATE users SET host_unlocked = true, role = 'host' WHERE id = $1`,
      [userId]
    );
    return true;
  }
  return false;
}
async function getHostUnlockProgress(userId) {
  const result = await pool.query(
    `SELECT COUNT(DISTINCT r.host_id) as unique_hosts, COUNT(*) as total_runs
     FROM run_participants rp
     JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.host_id != $1`,
    [userId]
  );
  return { unique_hosts: parseInt(result.rows[0].unique_hosts), total_runs: parseInt(result.rows[0].total_runs) };
}
async function awardSlug(userId, slug, db = pool) {
  const existing = await db.query(
    `SELECT id FROM achievements WHERE user_id = $1 AND slug = $2`,
    [userId, slug]
  );
  if (existing.rows.length === 0) {
    await db.query(
      `INSERT INTO achievements (user_id, milestone, slug) VALUES ($1, 0, $2)`,
      [userId, slug]
    );
    return true;
  }
  return false;
}
async function toggleCrewChatMute(crewId, userId) {
  const current = await pool.query(
    `SELECT chat_muted FROM crew_members WHERE crew_id = $1 AND user_id = $2`,
    [crewId, userId]
  );
  if (!current.rows.length) throw new Error("Not a crew member");
  const newMuted = !current.rows[0].chat_muted;
  await pool.query(
    `UPDATE crew_members SET chat_muted = $3 WHERE crew_id = $1 AND user_id = $2`,
    [crewId, userId, newMuted]
  );
  return newMuted;
}
async function checkAndAwardAchievements(userId, totalMiles, db = pool) {
  const user = await db.query(`SELECT completed_runs, hosted_runs FROM users WHERE id = $1`, [userId]);
  const { completed_runs, hosted_runs } = user.rows[0] ?? {};
  if (totalMiles >= 25) await awardSlug(userId, "miles_25", db);
  if (totalMiles >= 100) {
    await awardSlug(userId, "miles_100", db);
  }
  if (totalMiles >= 250) {
    await awardSlug(userId, "miles_250", db);
  }
  if (completed_runs >= 1) await awardSlug(userId, "first_step", db);
  if (completed_runs >= 5) await awardSlug(userId, "five_alive", db);
  if (completed_runs >= 10) await awardSlug(userId, "ten_toes_down", db);
  if (hosted_runs >= 1) await awardSlug(userId, "host_in_making", db);
  if (hosted_runs >= 5) await awardSlug(userId, "crew_builder", db);
  const maxSingleRun = await db.query(
    `SELECT COALESCE(MAX(miles_logged), 0) as max FROM run_participants WHERE user_id = $1 AND status = 'confirmed'`,
    [userId]
  );
  const maxMiles = parseFloat(maxSingleRun.rows[0]?.max ?? 0);
  if (maxMiles >= 13.1) await awardSlug(userId, "half_marathon", db);
  if (maxMiles >= 26.2) await awardSlug(userId, "marathoner", db);
  const publicJoined = await db.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.privacy = 'public' AND r.host_id != $1`,
    [userId]
  );
  if (parseInt(publicJoined.rows[0]?.cnt) >= 1) await awardSlug(userId, "social_starter", db);
  const squadRuns = await db.query(
    `SELECT COUNT(DISTINCT rp.run_id) as cnt FROM run_participants rp WHERE rp.user_id = $1 AND rp.status = 'confirmed'
     AND (SELECT COUNT(*) FROM run_participants rp2 WHERE rp2.run_id = rp.run_id AND rp2.status != 'cancelled') >= 3`,
    [userId]
  );
  if (parseInt(squadRuns.rows[0]?.cnt) >= 1) await awardSlug(userId, "squad_runner", db);
  const monthlyMax = await db.query(
    `SELECT COALESCE(MAX(cnt), 0) as max FROM (
       SELECT DATE_TRUNC('month', r.date) as m, COUNT(*) as cnt
       FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed'
       GROUP BY m
     ) sub`,
    [userId]
  );
  if (parseInt(monthlyMax.rows[0]?.max) >= 8) await awardSlug(userId, "monthly_grinder", db);
  const streakResult = await db.query(
    `WITH dates AS (
       SELECT DISTINCT DATE_TRUNC('day', r.date)::date AS d
       FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed'
       ORDER BY d
     ), gaps AS (
       SELECT d, d - LAG(d) OVER (ORDER BY d) AS gap FROM dates
     ), groups AS (
       SELECT d, SUM(CASE WHEN gap IS NULL OR gap != 1 THEN 1 ELSE 0 END) OVER (ORDER BY d) AS grp FROM gaps
     )
     SELECT COALESCE(MAX(cnt), 0) AS max FROM (SELECT grp, COUNT(*) AS cnt FROM groups GROUP BY grp) sub`,
    [userId]
  );
  if (parseInt(streakResult.rows[0]?.max) >= 3) await awardSlug(userId, "streak_week", db);
  const nightRuns = await db.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') >= 20`,
    [userId]
  );
  if (parseInt(nightRuns.rows[0]?.cnt) >= 5) await awardSlug(userId, "night_owl", db);
  const morningRuns = await db.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') < 7`,
    [userId]
  );
  if (parseInt(morningRuns.rows[0]?.cnt) >= 10) await awardSlug(userId, "morning_warrior", db);
  const communityLeader = await db.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE r.host_id = $1 AND rp.user_id != $1 AND rp.status = 'confirmed'`,
    [userId]
  );
  if (parseInt(communityLeader.rows[0]?.cnt) >= 20) await awardSlug(userId, "community_leader", db);
  const committedRes = await db.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status != 'cancelled' AND r.date < NOW()`,
    [userId]
  );
  const committedCount = parseInt(committedRes.rows[0]?.cnt ?? 0);
  if (committedCount >= 5) {
    const presentRes = await db.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status != 'cancelled' AND rp.is_present = true AND r.date < NOW()`,
      [userId]
    );
    const presentCount = parseInt(presentRes.rows[0]?.cnt ?? 0);
    const rate = presentCount / committedCount * 100;
    if (rate >= 50) await awardSlug(userId, "reliable_50", db);
    if (rate >= 65) await awardSlug(userId, "reliable_65", db);
    if (rate >= 80) await awardSlug(userId, "reliable_80", db);
    if (rate >= 90) await awardSlug(userId, "reliable_90", db);
  }
}
async function checkFriendAchievements(userId) {
  const friends = await pool.query(
    `SELECT COUNT(*) as cnt FROM friends WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'`,
    [userId]
  );
  if (parseInt(friends.rows[0]?.cnt) >= 1) await awardSlug(userId, "connected");
}
async function getUserAchievements(userId) {
  const result = await pool.query(
    `SELECT * FROM achievements WHERE user_id = $1 ORDER BY earned_at ASC`,
    [userId]
  );
  return result.rows;
}
async function getAchievementStats(userId) {
  const user = await pool.query(
    `SELECT completed_runs, total_miles, hosted_runs, avg_pace FROM users WHERE id = $1`,
    [userId]
  );
  const u = user.rows[0] ?? {};
  const [
    friendsRes,
    publicJoinedRes,
    squadRunsRes,
    maxSingleRunRes,
    monthlyMaxRes,
    streakRes,
    nightRunsRes,
    morningRunsRes,
    communityLeaderRes,
    uniqueLocRes,
    twoWeekRes,
    comebackRes,
    // Ride-specific
    completedRidesRes,
    publicRidesJoinedRes,
    squadRidesRes,
    rideTotalMilesRes,
    rideMaxSingleRes,
    rideMonthlyMaxRes,
    rideStreakRes,
    nightRidesRes,
    morningRidesRes,
    rideCommunityRes,
    rideUniqueLocRes,
    rideTwoWeekRes,
    rideComebackRes,
    rideHostedRes
  ] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) as cnt FROM friends WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.privacy = 'public' AND r.host_id != $1`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(DISTINCT rp.run_id) as cnt FROM run_participants rp
       WHERE rp.user_id = $1 AND rp.status = 'confirmed'
       AND (SELECT COUNT(*) FROM run_participants rp2 WHERE rp2.run_id = rp.run_id AND rp2.status != 'cancelled') >= 3`,
      [userId]
    ),
    pool.query(
      `SELECT COALESCE(MAX(miles_logged), 0) as max FROM run_participants WHERE user_id = $1 AND status = 'confirmed'`,
      [userId]
    ),
    pool.query(
      `SELECT COALESCE(MAX(cnt), 0) as max FROM (
         SELECT DATE_TRUNC('month', r.date) as m, COUNT(*) as cnt
         FROM run_participants rp JOIN runs r ON r.id = rp.run_id
         WHERE rp.user_id = $1 AND rp.status = 'confirmed'
         GROUP BY m
       ) sub`,
      [userId]
    ),
    pool.query(
      `WITH dates AS (
         SELECT DISTINCT DATE_TRUNC('day', r.date)::date AS d
         FROM run_participants rp JOIN runs r ON r.id = rp.run_id
         WHERE rp.user_id = $1 AND rp.status = 'confirmed'
         ORDER BY d
       ), gaps AS (
         SELECT d, d - LAG(d) OVER (ORDER BY d) AS gap FROM dates
       ), groups AS (
         SELECT d, SUM(CASE WHEN gap IS NULL OR gap != 1 THEN 1 ELSE 0 END) OVER (ORDER BY d) AS grp FROM gaps
       )
       SELECT COALESCE(MAX(cnt), 0) AS max FROM (SELECT grp, COUNT(*) AS cnt FROM groups GROUP BY grp) sub`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') >= 20`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') < 7`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE r.host_id = $1 AND rp.user_id != $1 AND rp.status = 'confirmed'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(DISTINCT r.location_name) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed'`,
      [userId]
    ),
    pool.query(
      `WITH run_dates AS (
         SELECT r.date FROM run_participants rp JOIN runs r ON r.id = rp.run_id
         WHERE rp.user_id = $1 AND rp.status = 'confirmed'
         ORDER BY r.date
       )
       SELECT COALESCE(MAX(cnt), 0) AS max FROM (
         SELECT r1.date, COUNT(*) as cnt FROM run_dates r1
         JOIN run_dates r2 ON r2.date BETWEEN r1.date AND r1.date + INTERVAL '14 days'
         GROUP BY r1.date
       ) sub`,
      [userId]
    ),
    pool.query(
      `WITH run_dates AS (
         SELECT r.date FROM run_participants rp JOIN runs r ON r.id = rp.run_id
         WHERE rp.user_id = $1 AND rp.status = 'confirmed'
         ORDER BY r.date
       ), gaps AS (
         SELECT date, LAG(date) OVER (ORDER BY date) AS prev_date,
           date - LAG(date) OVER (ORDER BY date) AS gap FROM run_dates
       )
       SELECT COUNT(*) > 0 AS had_gap FROM gaps WHERE gap > INTERVAL '30 days'`,
      [userId]
    ),
    // ── Ride stats ──────────────────────────────────────────────────────────
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.privacy = 'public' AND r.host_id != $1 AND r.activity_type = 'ride'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(DISTINCT rp.run_id) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
       AND (SELECT COUNT(*) FROM run_participants rp2 WHERE rp2.run_id = rp.run_id AND rp2.status != 'cancelled') >= 3`,
      [userId]
    ),
    pool.query(
      `SELECT COALESCE(SUM(rp.miles_logged), 0) as total FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
      [userId]
    ),
    pool.query(
      `SELECT COALESCE(MAX(rp.miles_logged), 0) as max FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
      [userId]
    ),
    pool.query(
      `SELECT COALESCE(MAX(cnt), 0) as max FROM (
         SELECT DATE_TRUNC('month', r.date) as m, COUNT(*) as cnt
         FROM run_participants rp JOIN runs r ON r.id = rp.run_id
         WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
         GROUP BY m
       ) sub`,
      [userId]
    ),
    pool.query(
      `WITH dates AS (
         SELECT DISTINCT DATE_TRUNC('day', r.date)::date AS d
         FROM run_participants rp JOIN runs r ON r.id = rp.run_id
         WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
         ORDER BY d
       ), gaps AS (
         SELECT d, d - LAG(d) OVER (ORDER BY d) AS gap FROM dates
       ), groups AS (
         SELECT d, SUM(CASE WHEN gap IS NULL OR gap != 1 THEN 1 ELSE 0 END) OVER (ORDER BY d) AS grp FROM gaps
       )
       SELECT COALESCE(MAX(cnt), 0) AS max FROM (SELECT grp, COUNT(*) AS cnt FROM groups GROUP BY grp) sub`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
       AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') >= 20`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
       AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') < 7`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE r.host_id = $1 AND rp.user_id != $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(DISTINCT r.location_name) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
      [userId]
    ),
    pool.query(
      `WITH run_dates AS (
         SELECT r.date FROM run_participants rp JOIN runs r ON r.id = rp.run_id
         WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
         ORDER BY r.date
       )
       SELECT COALESCE(MAX(cnt), 0) AS max FROM (
         SELECT r1.date, COUNT(*) as cnt FROM run_dates r1
         JOIN run_dates r2 ON r2.date BETWEEN r1.date AND r1.date + INTERVAL '14 days'
         GROUP BY r1.date
       ) sub`,
      [userId]
    ),
    pool.query(
      `WITH run_dates AS (
         SELECT r.date FROM run_participants rp JOIN runs r ON r.id = rp.run_id
         WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
         ORDER BY r.date
       ), gaps AS (
         SELECT date, LAG(date) OVER (ORDER BY date) AS prev_date,
           date - LAG(date) OVER (ORDER BY date) AS gap FROM run_dates
       )
       SELECT COUNT(*) > 0 AS had_gap FROM gaps WHERE gap > INTERVAL '30 days'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM runs WHERE host_id = $1 AND activity_type = 'ride'`,
      [userId]
    )
  ]);
  const maxSingleMiles = parseFloat(maxSingleRunRes.rows[0]?.max ?? 0);
  const rideTotalMiles = parseFloat(rideTotalMilesRes.rows[0]?.total ?? 0);
  const rideMaxSingle = parseFloat(rideMaxSingleRes.rows[0]?.max ?? 0);
  const committedStatRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status != 'cancelled' AND r.date < NOW()`,
    [userId]
  );
  const committedStatCount = parseInt(committedStatRes.rows[0]?.cnt ?? 0);
  let attendanceRatePct = null;
  if (committedStatCount >= 5) {
    const presentStatRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status != 'cancelled' AND rp.is_present = true AND r.date < NOW()`,
      [userId]
    );
    const presentStatCount = parseInt(presentStatRes.rows[0]?.cnt ?? 0);
    attendanceRatePct = Math.round(presentStatCount / committedStatCount * 100);
  }
  return {
    completed_runs: parseInt(u.completed_runs ?? 0),
    total_miles: parseFloat(u.total_miles ?? 0),
    hosted_runs: parseInt(u.hosted_runs ?? 0),
    avg_pace: parseFloat(u.avg_pace ?? 10),
    friends_count: parseInt(friendsRes.rows[0]?.cnt ?? 0),
    public_runs_joined: parseInt(publicJoinedRes.rows[0]?.cnt ?? 0),
    squad_runs_count: parseInt(squadRunsRes.rows[0]?.cnt ?? 0),
    max_single_run_miles: maxSingleMiles,
    max_single_run_miles_x10: Math.round(maxSingleMiles * 10),
    monthly_max_runs: parseInt(monthlyMaxRes.rows[0]?.max ?? 0),
    max_streak_days: parseInt(streakRes.rows[0]?.max ?? 0),
    night_runs_count: parseInt(nightRunsRes.rows[0]?.cnt ?? 0),
    morning_runs_count: parseInt(morningRunsRes.rows[0]?.cnt ?? 0),
    participants_hosted_total: parseInt(communityLeaderRes.rows[0]?.cnt ?? 0),
    unique_locations: parseInt(uniqueLocRes.rows[0]?.cnt ?? 0),
    max_runs_in_14_days: parseInt(twoWeekRes.rows[0]?.max ?? 0),
    had_comeback: comebackRes.rows[0]?.had_gap === true ? 1 : 0,
    has_sub7_pace: parseFloat(u.avg_pace ?? 10) < 7 ? 1 : 0,
    negative_split_count: 0,
    five_k_crusher_count: 0,
    pace_perfect_count: 0,
    // Ride stats
    completed_rides: parseInt(completedRidesRes.rows[0]?.cnt ?? 0),
    public_rides_joined: parseInt(publicRidesJoinedRes.rows[0]?.cnt ?? 0),
    squad_rides_count: parseInt(squadRidesRes.rows[0]?.cnt ?? 0),
    ride_total_miles: rideTotalMiles,
    ride_max_single_miles: rideMaxSingle,
    ride_monthly_max: parseInt(rideMonthlyMaxRes.rows[0]?.max ?? 0),
    ride_max_streak_days: parseInt(rideStreakRes.rows[0]?.max ?? 0),
    night_rides_count: parseInt(nightRidesRes.rows[0]?.cnt ?? 0),
    morning_rides_count: parseInt(morningRidesRes.rows[0]?.cnt ?? 0),
    ride_participants_hosted: parseInt(rideCommunityRes.rows[0]?.cnt ?? 0),
    ride_unique_locations: parseInt(rideUniqueLocRes.rows[0]?.cnt ?? 0),
    ride_max_in_14_days: parseInt(rideTwoWeekRes.rows[0]?.max ?? 0),
    had_ride_comeback: rideComebackRes.rows[0]?.had_gap === true ? 1 : 0,
    ride_hosted_count: parseInt(rideHostedRes.rows[0]?.cnt ?? 0),
    has_fast_ride: rideMaxSingle >= 20 ? 1 : 0,
    ride_pace_perfect_count: 0,
    attendance_rate_pct: attendanceRatePct
  };
}
async function checkAndAwardRideAchievements(userId) {
  const ridesRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
    [userId]
  );
  const hostedRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM runs WHERE host_id = $1 AND activity_type = 'ride'`,
    [userId]
  );
  const completedRides = parseInt(ridesRes.rows[0]?.cnt ?? 0);
  const hostedRides = parseInt(hostedRes.rows[0]?.cnt ?? 0);
  if (completedRides >= 1) await awardSlug(userId, "first_ride");
  if (completedRides >= 5) await awardSlug(userId, "five_rides");
  if (completedRides >= 10) await awardSlug(userId, "ten_rides");
  if (completedRides >= 25) await awardSlug(userId, "ride_grinder");
  if (hostedRides >= 1) await awardSlug(userId, "ride_host_debut");
  if (hostedRides >= 5) await awardSlug(userId, "ride_crew_builder");
  const rideMilesRes = await pool.query(
    `SELECT COALESCE(SUM(rp.miles_logged), 0) as total FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
    [userId]
  );
  const totalRideMiles = parseFloat(rideMilesRes.rows[0]?.total ?? 0);
  if (totalRideMiles >= 25) await awardSlug(userId, "ride_miles_25");
  if (totalRideMiles >= 100) await awardSlug(userId, "ride_miles_100");
  if (totalRideMiles >= 250) await awardSlug(userId, "ride_miles_250");
  if (totalRideMiles >= 500) await awardSlug(userId, "ride_miles_500");
  const maxSingleRide = await pool.query(
    `SELECT COALESCE(MAX(rp.miles_logged), 0) as max FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
    [userId]
  );
  const maxRideMiles = parseFloat(maxSingleRide.rows[0]?.max ?? 0);
  if (maxRideMiles >= 50) await awardSlug(userId, "half_century");
  if (maxRideMiles >= 100) await awardSlug(userId, "century_ride");
  const publicRideRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.privacy = 'public' AND r.host_id != $1 AND r.activity_type = 'ride'`,
    [userId]
  );
  if (parseInt(publicRideRes.rows[0]?.cnt) >= 1) await awardSlug(userId, "social_cyclist");
  const squadRideRes = await pool.query(
    `SELECT COUNT(DISTINCT rp.run_id) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
     AND (SELECT COUNT(*) FROM run_participants rp2 WHERE rp2.run_id = rp.run_id AND rp2.status != 'cancelled') >= 3`,
    [userId]
  );
  if (parseInt(squadRideRes.rows[0]?.cnt) >= 1) await awardSlug(userId, "squad_rider");
  const rideParticipants = await pool.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE r.host_id = $1 AND rp.user_id != $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
    [userId]
  );
  if (parseInt(rideParticipants.rows[0]?.cnt) >= 20) await awardSlug(userId, "ride_community_leader");
  const nightRideRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
     AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') >= 20`,
    [userId]
  );
  if (parseInt(nightRideRes.rows[0]?.cnt) >= 5) await awardSlug(userId, "night_rider");
  const morningRideRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
     AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') < 7`,
    [userId]
  );
  if (parseInt(morningRideRes.rows[0]?.cnt) >= 10) await awardSlug(userId, "morning_cyclist");
}
async function rateHost(data) {
  const existing = await pool.query(
    `SELECT id FROM host_ratings WHERE run_id = $1 AND rater_id = $2`,
    [data.runId, data.raterId]
  );
  if (existing.rows.length > 0) throw new Error("Already rated this run");
  await pool.query(
    `INSERT INTO host_ratings (run_id, host_id, rater_id, stars, tags) VALUES ($1,$2,$3,$4,$5)`,
    [data.runId, data.hostId, data.raterId, data.stars, data.tags]
  );
  const avg = await pool.query(
    `SELECT AVG(stars) as avg, COUNT(*) as count FROM host_ratings WHERE host_id = $1`,
    [data.hostId]
  );
  await pool.query(
    `UPDATE users SET avg_rating = $2, rating_count = $3 WHERE id = $1`,
    [data.hostId, parseFloat(avg.rows[0].avg).toFixed(1), parseInt(avg.rows[0].count)]
  );
  return { success: true };
}
async function getUserRatingForRun(runId, raterId) {
  const result = await pool.query(
    `SELECT * FROM host_ratings WHERE run_id = $1 AND rater_id = $2`,
    [runId, raterId]
  );
  return result.rows[0] || null;
}
async function updateGoals(userId, monthlyGoal, yearlyGoal, paceGoal) {
  const updates = [];
  const values = [userId];
  if (monthlyGoal !== void 0) {
    updates.push(`monthly_goal = $${values.length + 1}`);
    values.push(monthlyGoal);
  }
  if (yearlyGoal !== void 0) {
    updates.push(`yearly_goal = $${values.length + 1}`);
    values.push(yearlyGoal);
  }
  if (paceGoal !== void 0) {
    updates.push(`pace_goal = $${values.length + 1}`);
    values.push(paceGoal);
  }
  if (!updates.length) return;
  await pool.query(`UPDATE users SET ${updates.join(", ")} WHERE id = $1`, values);
}
async function getSavedPaths(userId) {
  const res = await pool.query(
    `SELECT * FROM saved_paths WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return res.rows;
}
async function createSavedPath(userId, data) {
  const { path: dedupedPath, distanceMiles: computedDist, loopDetected } = deduplicateRoutePath(data.routePath);
  const finalDist = loopDetected ? computedDist : data.distanceMiles != null && data.distanceMiles > 0 ? data.distanceMiles : computedDist > 0 ? computedDist : null;
  const res = await pool.query(
    `INSERT INTO saved_paths (user_id, name, route_path, distance_miles, activity_type)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, data.name, JSON.stringify(dedupedPath), finalDist, data.activityType ?? "run"]
  );
  const newPath = res.rows[0];
  if (data.soloRunId) {
    await pool.query(
      `UPDATE solo_runs SET saved_path_id = $1 WHERE id = $2 AND user_id = $3`,
      [newPath.id, data.soloRunId, userId]
    );
  }
  return newPath;
}
async function updateSavedPath(id, userId, name) {
  const res = await pool.query(
    `UPDATE saved_paths SET name = $3 WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId, name]
  );
  return res.rows[0] || null;
}
async function deleteSavedPath(id, userId) {
  const res = await pool.query(
    `DELETE FROM saved_paths WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId]
  );
  if (!res.rows.length) throw new Error("Not found or not authorized");
  return { success: true };
}
async function sharePathWithFriend(fromUserId, pathId, toUserId) {
  const pathRes = await pool.query(`SELECT * FROM saved_paths WHERE id = $1 AND user_id = $2`, [pathId, fromUserId]);
  const path2 = pathRes.rows[0];
  if (!path2) throw new Error("Path not found");
  const friendRes = await pool.query(
    `SELECT 1 FROM friends
     WHERE status = 'accepted'
       AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
    [fromUserId, toUserId]
  );
  if (!friendRes.rows.length) throw new Error("You can only share routes with friends");
  const res = await pool.query(
    `INSERT INTO path_shares (from_user_id, to_user_id, saved_path_id, path_name, path_distance_miles, activity_type)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [fromUserId, toUserId, pathId, path2.name, path2.distance_miles, path2.activity_type ?? "run"]
  );
  return res.rows[0];
}
async function cloneSharedPath(shareId, toUserId) {
  const shareRes = await pool.query(`SELECT * FROM path_shares WHERE id = $1 AND to_user_id = $2`, [shareId, toUserId]);
  const share = shareRes.rows[0];
  if (!share) throw new Error("Share not found");
  const pathRes = await pool.query(`SELECT * FROM saved_paths WHERE id = $1`, [share.saved_path_id]);
  const path2 = pathRes.rows[0];
  if (!path2) throw new Error("Path no longer exists");
  const newRes = await pool.query(
    `INSERT INTO saved_paths (user_id, name, route_path, distance_miles, activity_type)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [toUserId, path2.name, path2.route_path, path2.distance_miles, path2.activity_type ?? "run"]
  );
  await pool.query(`UPDATE path_shares SET cloned = true WHERE id = $1`, [shareId]);
  return newRes.rows[0];
}
async function publishSavedPath(pathId, userId) {
  const pathRes = await pool.query(`SELECT * FROM saved_paths WHERE id = $1 AND user_id = $2`, [pathId, userId]);
  const path2 = pathRes.rows[0];
  if (!path2) throw new Error("Path not found");
  if (path2.community_path_id) {
    const existing = await pool.query(`SELECT * FROM community_paths WHERE id = $1`, [path2.community_path_id]);
    if (existing.rows[0]) return { alreadyPublished: true, communityPath: existing.rows[0] };
  }
  const user = await getUserById(userId);
  if (!user) throw new Error("User not found");
  const routePath = typeof path2.route_path === "string" ? JSON.parse(path2.route_path) : path2.route_path;
  if (!routePath || routePath.length < 2) throw new Error("Route must have at least 2 points");
  const startLat = routePath[0].latitude;
  const startLng = routePath[0].longitude;
  const endLat = routePath[routePath.length - 1].latitude;
  const endLng = routePath[routePath.length - 1].longitude;
  const cpRes = await pool.query(
    `INSERT INTO community_paths (name, route_path, distance_miles, is_public, created_by_user_id, created_by_name, start_lat, start_lng, end_lat, end_lng, activity_type, run_count)
     VALUES ($1, $2, $3, true, $4, $5, $6, $7, $8, $9, $10, 0) RETURNING *`,
    [path2.name, path2.route_path, path2.distance_miles, userId, user.name, startLat, startLng, endLat, endLng, path2.activity_type ?? "run"]
  );
  const communityPath = cpRes.rows[0];
  await pool.query(`UPDATE saved_paths SET community_path_id = $1 WHERE id = $2`, [communityPath.id, pathId]);
  await pool.query(
    `INSERT INTO path_contributions (community_path_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [communityPath.id, userId]
  );
  return { alreadyPublished: false, communityPath };
}
async function getCommunityPaths(bounds) {
  let query = `SELECT *, (SELECT COUNT(*) FROM path_contributions WHERE community_path_id = cp.id) as contribution_count FROM community_paths cp WHERE is_public = true`;
  const params = [];
  if (bounds) {
    params.push(bounds.swLat, bounds.neLat, bounds.swLng, bounds.neLng);
    query += ` AND start_lat >= $1 AND start_lat <= $2 AND start_lng >= $3 AND start_lng <= $4`;
  }
  query += ` ORDER BY run_count DESC, updated_at DESC LIMIT 50`;
  const res = await pool.query(query, params);
  return res.rows;
}
async function publishSoloRunRoute(soloRunId, userId, routeName) {
  const soloRes = await pool.query(`SELECT * FROM solo_runs WHERE id = $1 AND user_id = $2`, [soloRunId, userId]);
  const soloRun = soloRes.rows[0];
  if (!soloRun) throw new Error("Solo run not found");
  const routePath = soloRun.route_path;
  if (!routePath || !Array.isArray(routePath) || routePath.length < 2) {
    throw new Error("Route must have at least 2 points to publish");
  }
  const user = await getUserById(userId);
  if (!user) throw new Error("User not found");
  const startLat = routePath[0].latitude;
  const startLng = routePath[0].longitude;
  const endLat = routePath[routePath.length - 1].latitude;
  const endLng = routePath[routePath.length - 1].longitude;
  const result = await pool.query(
    `INSERT INTO community_paths (name, route_path, distance_miles, is_public, created_by_user_id, created_by_name, start_lat, start_lng, end_lat, end_lng, activity_type, run_count)
     VALUES ($1, $2, $3, true, $4, $5, $6, $7, $8, $9, $10, 1) RETURNING *`,
    [routeName, JSON.stringify(routePath), soloRun.distance_miles, userId, user.name, startLat, startLng, endLat, endLng, soloRun.activity_type || "run"]
  );
  const newPath = result.rows[0];
  await pool.query(
    `INSERT INTO path_contributions (community_path_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [newPath.id, userId]
  );
  return newPath;
}
async function getCrewMessages(crewId, limit = 50) {
  const result = await pool.query(
    `SELECT * FROM crew_messages WHERE crew_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [crewId, limit]
  );
  return result.rows;
}
async function createCrewMessage(crewId, userId, senderName, senderPhoto, message, messageType = "text", metadata = null) {
  const result = await pool.query(
    `INSERT INTO crew_messages (crew_id, user_id, sender_name, sender_photo, message, message_type, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [crewId, userId, senderName, senderPhoto, message, messageType, metadata ? JSON.stringify(metadata) : null]
  );
  return result.rows[0];
}
async function isParticipant(runId, userId) {
  const res = await pool.query(
    `SELECT 1 FROM run_participants WHERE run_id = $1 AND user_id = $2 AND status != 'cancelled'`,
    [runId, userId]
  );
  return res.rows.length > 0;
}
async function matchCommunityPath(userId, savedPathId, routePath, distanceMiles) {
  if (routePath.length < 2) return;
  const start = routePath[0];
  const end = routePath[routePath.length - 1];
  const dist = distanceMiles ?? 0;
  const existing = await pool.query(
    `SELECT cp.*,
       (SELECT COUNT(*) FROM path_contributions pc WHERE pc.community_path_id = cp.id AND pc.user_id = $1) as already_contributed
     FROM community_paths cp
     WHERE ABS(cp.start_lat - $2) < 0.005
       AND ABS(cp.start_lng - $3) < 0.005
       AND ABS(cp.end_lat - $4) < 0.005
       AND ABS(cp.end_lng - $5) < 0.005
       AND ($6::float = 0 OR cp.distance_miles IS NULL OR ABS(cp.distance_miles - $6::float) / GREATEST($6::float, 0.1) < 0.35)
     ORDER BY cp.contributor_count DESC LIMIT 1`,
    [userId, start.latitude, start.longitude, end.latitude, end.longitude, dist]
  );
  if (existing.rows.length > 0) {
    const cp = existing.rows[0];
    if (parseInt(cp.already_contributed) > 0) return;
    await pool.query(
      `INSERT INTO path_contributions (community_path_id, user_id, saved_path_id)
       VALUES ($1, $2, $3) ON CONFLICT (community_path_id, user_id) DO NOTHING`,
      [cp.id, userId, savedPathId]
    );
    await pool.query(
      `UPDATE community_paths
       SET contributor_count = (SELECT COUNT(DISTINCT user_id) FROM path_contributions WHERE community_path_id = $1),
           updated_at = NOW()
       WHERE id = $1`,
      [cp.id]
    );
  } else {
    const distLabel = dist > 0 ? `${dist.toFixed(1)} mi Route` : "Running Route";
    const cpRes = await pool.query(
      `INSERT INTO community_paths (name, route_path, distance_miles, contributor_count, start_lat, start_lng, end_lat, end_lng)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7) RETURNING id`,
      [distLabel, JSON.stringify(routePath), distanceMiles ?? null, start.latitude, start.longitude, end.latitude, end.longitude]
    );
    await pool.query(
      `INSERT INTO path_contributions (community_path_id, user_id, saved_path_id) VALUES ($1, $2, $3)`,
      [cpRes.rows[0].id, userId, savedPathId]
    );
  }
}
async function toggleBookmark(userId, runId) {
  const existing = await pool.query(
    `SELECT id FROM bookmarked_runs WHERE user_id = $1 AND run_id = $2`,
    [userId, runId]
  );
  if (existing.rows.length > 0) {
    await pool.query(`DELETE FROM bookmarked_runs WHERE user_id = $1 AND run_id = $2`, [userId, runId]);
    return { bookmarked: false };
  } else {
    await pool.query(
      `INSERT INTO bookmarked_runs (user_id, run_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, runId]
    );
    return { bookmarked: true };
  }
}
async function togglePlan(userId, runId) {
  const existing = await pool.query(
    `SELECT id FROM planned_runs WHERE user_id = $1 AND run_id = $2`,
    [userId, runId]
  );
  if (existing.rows.length > 0) {
    await pool.query(`DELETE FROM planned_runs WHERE user_id = $1 AND run_id = $2`, [userId, runId]);
    return { planned: false };
  } else {
    await pool.query(
      `INSERT INTO planned_runs (user_id, run_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, runId]
    );
    return { planned: true };
  }
}
async function getRunStatus(userId, runId) {
  const [bRes, pRes] = await Promise.all([
    pool.query(`SELECT id FROM bookmarked_runs WHERE user_id = $1 AND run_id = $2`, [userId, runId]),
    pool.query(`SELECT id FROM planned_runs WHERE user_id = $1 AND run_id = $2`, [userId, runId])
  ]);
  return {
    is_bookmarked: bRes.rows.length > 0,
    is_planned: pRes.rows.length > 0
  };
}
async function getPlannedRuns(userId) {
  const result = await pool.query(
    `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.photo_url as host_photo,
      u.marker_icon as host_marker_icon,
      (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
      pr.created_at as planned_at
     FROM planned_runs pr
     JOIN runs r ON r.id = pr.run_id
     JOIN users u ON u.id = r.host_id
     WHERE pr.user_id = $1
       AND r.date >= NOW() - INTERVAL '3 hours'
       AND r.is_completed = false
       AND r.is_deleted IS NOT TRUE
       AND NOT EXISTS (
         SELECT 1 FROM run_participants rp2
         WHERE rp2.run_id = r.id AND rp2.user_id = $1 AND rp2.status = 'confirmed'
       )
     ORDER BY r.date ASC`,
    [userId]
  );
  return result.rows;
}
async function getBookmarkedRuns(userId) {
  const result = await pool.query(
    `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.photo_url as host_photo,
      u.marker_icon as host_marker_icon,
      (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
      b.created_at as bookmarked_at
     FROM bookmarked_runs b
     JOIN runs r ON r.id = b.run_id
     JOIN users u ON u.id = r.host_id
     WHERE b.user_id = $1
     ORDER BY b.created_at DESC`,
    [userId]
  );
  return result.rows;
}
async function getStarredRunsForUser(userId, limit = 3) {
  const result = await pool.query(
    `SELECT r.id, r.title, r.date, r.location, r.distance_miles, r.activity_type, r.min_pace, r.max_pace
     FROM bookmarked_runs b
     JOIN runs r ON r.id = b.run_id
     WHERE b.user_id = $1
     ORDER BY b.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}
async function getRunPhotos(runId) {
  const res = await pool.query(
    `SELECT rp.*, u.name as uploader_name, u.photo_url as uploader_avatar
     FROM run_photos rp
     JOIN users u ON u.id = rp.user_id
     WHERE rp.run_id = $1
     ORDER BY rp.created_at ASC`,
    [runId]
  );
  return res.rows;
}
async function addRunPhoto(runId, userId, photoUrl) {
  const res = await pool.query(
    `INSERT INTO run_photos (run_id, user_id, photo_url) VALUES ($1, $2, $3) RETURNING *`,
    [runId, userId, photoUrl]
  );
  return res.rows[0];
}
async function deleteRunPhoto(photoId, userId) {
  await pool.query(`DELETE FROM run_photos WHERE id = $1 AND user_id = $2`, [photoId, userId]);
}
async function getSoloRunPhotos(soloRunId, userId) {
  const res = await pool.query(
    `SELECT srp.* FROM solo_run_photos srp
     JOIN solo_runs sr ON sr.id = srp.solo_run_id
     WHERE srp.solo_run_id = $1 AND sr.user_id = $2
     ORDER BY srp.created_at ASC`,
    [soloRunId, userId]
  );
  return res.rows;
}
async function addSoloRunPhoto(soloRunId, userId, photoUrl) {
  const check = await pool.query(`SELECT id FROM solo_runs WHERE id = $1 AND user_id = $2`, [soloRunId, userId]);
  if (!check.rows[0]) throw new Error("Solo run not found");
  const res = await pool.query(
    `INSERT INTO solo_run_photos (solo_run_id, photo_url) VALUES ($1, $2) RETURNING *`,
    [soloRunId, photoUrl]
  );
  return res.rows[0];
}
async function deleteSoloRunPhoto(photoId, userId) {
  await pool.query(
    `DELETE FROM solo_run_photos WHERE id = $1
     AND solo_run_id IN (SELECT id FROM solo_runs WHERE user_id = $2)`,
    [photoId, userId]
  );
}
async function getPublicUserProfile(userId) {
  const userRes = await pool.query(
    `SELECT id, name, photo_url, avg_rating FROM users WHERE id = $1`,
    [userId]
  );
  if (!userRes.rows.length) return null;
  const u = userRes.rows[0];
  const [friendsRes, achievementsRes, liveStatsRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) as cnt FROM friends
       WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'`,
      [userId]
    ),
    pool.query(`SELECT slug FROM achievements WHERE user_id = $1`, [userId]),
    pool.query(`
      SELECT
        COALESCE(
          (SELECT SUM(sr.distance_miles) FROM solo_runs sr
           WHERE sr.user_id = $1 AND sr.completed = true AND sr.is_deleted IS NOT TRUE),
          0
        ) + COALESCE(
          (SELECT SUM(rp.final_distance) FROM run_participants rp
           WHERE rp.user_id = $1 AND rp.final_distance IS NOT NULL),
          0
        ) AS total_miles,
        COALESCE(
          (SELECT COUNT(*) FROM solo_runs sr
           WHERE sr.user_id = $1 AND sr.completed = true AND sr.is_deleted IS NOT TRUE),
          0
        ) + COALESCE(
          (SELECT COUNT(*) FROM run_participants rp
           WHERE rp.user_id = $1 AND rp.final_distance IS NOT NULL),
          0
        ) AS completed_runs,
        COALESCE(
          (SELECT COUNT(*) FROM runs r
           WHERE r.host_id = $1 AND r.is_completed = true AND r.is_deleted IS NOT TRUE),
          0
        ) AS hosted_runs,
        COALESCE(
          (SELECT AVG(NULLIF(sr.pace_min_per_mile, 0)) FROM solo_runs sr
           WHERE sr.user_id = $1 AND sr.completed = true AND sr.is_deleted IS NOT TRUE),
          0
        ) AS avg_pace
    `, [userId])
  ]);
  const live = liveStatsRes.rows[0];
  return {
    id: u.id,
    name: u.name,
    photo_url: u.photo_url,
    avg_pace: parseFloat(live?.avg_pace ?? 0),
    hosted_runs: parseInt(live?.hosted_runs ?? 0),
    completed_runs: parseInt(live?.completed_runs ?? 0),
    total_miles: parseFloat(live?.total_miles ?? 0),
    avg_rating: parseFloat(u.avg_rating ?? 0),
    friends_count: parseInt(friendsRes.rows[0]?.cnt ?? "0"),
    earned_slugs: achievementsRes.rows.map((r) => r.slug)
  };
}
async function getFriendshipStatus(currentUserId, targetUserId) {
  const res = await pool.query(
    `SELECT id, status, requester_id FROM friends
     WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
    [currentUserId, targetUserId]
  );
  if (!res.rows.length) return { status: "none", friendshipId: null };
  const row = res.rows[0];
  if (row.status === "accepted") return { status: "friends", friendshipId: row.id };
  if (row.requester_id === currentUserId) return { status: "pending_sent", friendshipId: row.id };
  return { status: "pending_received", friendshipId: row.id };
}
async function getUserTopRuns(userId) {
  const longestRes = await pool.query(
    `SELECT dist, date, pace, title, run_type FROM (
       SELECT distance_miles as dist, date, pace_min_per_mile as pace, title, 'solo' as run_type
       FROM solo_runs WHERE user_id = $1 AND completed = true AND distance_miles IS NOT NULL
       UNION ALL
       SELECT rp.final_distance as dist, r.date, rp.final_pace as pace, r.title, 'group' as run_type
       FROM run_participants rp
       JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.final_distance IS NOT NULL
     ) combined
     ORDER BY dist DESC LIMIT 5`,
    [userId]
  );
  const fastestRes = await pool.query(
    `SELECT dist, date, pace, title, run_type FROM (
       SELECT distance_miles as dist, date, pace_min_per_mile as pace, title, 'solo' as run_type
       FROM solo_runs WHERE user_id = $1 AND completed = true
         AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0
       UNION ALL
       SELECT rp.final_distance as dist, r.date, rp.final_pace as pace, r.title, 'group' as run_type
       FROM run_participants rp
       JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.final_pace IS NOT NULL AND rp.final_pace > 0
     ) combined
     ORDER BY pace ASC LIMIT 5`,
    [userId]
  );
  const parse = (r) => ({
    dist: r.dist ? parseFloat(r.dist) : null,
    date: r.date,
    pace: r.pace ? parseFloat(r.pace) : null,
    title: r.title,
    run_type: r.run_type
  });
  return {
    longestRuns: longestRes.rows.map(parse),
    fastestRuns: fastestRes.rows.map(parse)
  };
}
async function getUserRunRecords(userId) {
  const longestRes = await pool.query(
    `SELECT MAX(dist) as longest FROM (
       SELECT distance_miles as dist FROM solo_runs WHERE user_id = $1 AND completed = true
       UNION ALL
       SELECT final_distance as dist FROM run_participants WHERE user_id = $1 AND final_distance IS NOT NULL
     ) combined`,
    [userId]
  );
  const fastestRes = await pool.query(
    `SELECT MIN(pace_min_per_mile) as fastest_pace FROM solo_runs
     WHERE user_id = $1 AND completed = true AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0`,
    [userId]
  );
  return {
    longest_run: longestRes.rows[0]?.longest ? parseFloat(longestRes.rows[0].longest) : null,
    fastest_pace: fastestRes.rows[0]?.fastest_pace ? parseFloat(fastestRes.rows[0].fastest_pace) : null
  };
}
async function createCrew(data) {
  const existing = await pool.query(`SELECT id FROM crews WHERE LOWER(name) = LOWER($1)`, [data.name]);
  if (existing.rows.length > 0) {
    throw Object.assign(new Error("A crew with that name already exists. Please choose a different name."), { code: "DUPLICATE_CREW_NAME" });
  }
  const res = await pool.query(
    `INSERT INTO crews (name, description, emoji, created_by, run_style, tags, image_url, home_metro, home_state) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [data.name, data.description ?? null, data.emoji, data.createdBy, data.runStyle ?? null, data.tags ?? [], data.imageUrl ?? null, data.homeMetro ?? null, data.homeState ?? null]
  );
  const crew = res.rows[0];
  await pool.query(
    `INSERT INTO crew_members (crew_id, user_id, status, invited_by) VALUES ($1, $2, 'member', $3)`,
    [crew.id, data.createdBy, data.createdBy]
  );
  return crew;
}
async function updateCrew(crewId, data) {
  const keys = Object.keys(data);
  if (keys.length === 0) return null;
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const res = await pool.query(
    `UPDATE crews SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`,
    [...Object.values(data), crewId]
  );
  return res.rows[0];
}
async function getCrewRankings(type, value) {
  let filterClause = "";
  const params = [];
  if (type === "state" && value) {
    filterClause = "AND c.home_state = $1";
    params.push(value);
  } else if (type === "metro" && value) {
    filterClause = "AND c.home_metro = $1";
    params.push(value);
  }
  const res = await pool.query(
    `WITH active_members AS (
       -- Members who completed a group or solo run in the last 30 days
       SELECT DISTINCT cm.crew_id, cm.user_id
       FROM crew_members cm
       WHERE cm.status = 'member'
         AND (
           EXISTS (
             SELECT 1 FROM run_completions rc
             JOIN runs r ON r.id = rc.run_id
             WHERE rc.user_id = cm.user_id AND r.crew_id = cm.crew_id
               AND rc.created_at > NOW() - INTERVAL '30 days'
           )
           OR EXISTS (
             SELECT 1 FROM solo_runs sr
             WHERE sr.user_id = cm.user_id AND sr.completed = true
               AND sr.created_at > NOW() - INTERVAL '30 days'
           )
         )
     ),
     qualifying_events AS (
       -- Crew runs with 3+ participant completions
       SELECT r.crew_id, r.id as run_id, COUNT(rc.user_id) as completion_count,
              COALESCE(SUM(rc.distance_miles), 0) as event_miles
       FROM runs r
       JOIN run_completions rc ON rc.run_id = r.id
       WHERE r.crew_id IS NOT NULL
       GROUP BY r.crew_id, r.id
       HAVING COUNT(rc.user_id) >= 3
     ),
     crew_stats AS (
       SELECT
         c.id as crew_id,
         GREATEST(COUNT(DISTINCT am.user_id), 1) as active_members,
         COUNT(DISTINCT qe.run_id) as qualifying_events,
         COALESCE(SUM(qe.completion_count), 0) as total_participants,
         COALESCE(SUM(qe.event_miles), 0) as total_miles,
         GREATEST(EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 86400, 7) as days_active
       FROM crews c
       LEFT JOIN active_members am ON am.crew_id = c.id
       LEFT JOIN qualifying_events qe ON qe.crew_id = c.id
       GROUP BY c.id, c.created_at
     )
     SELECT c.*,
       u.name as created_by_name,
       cs.active_members,
       cs.qualifying_events,
       cs.total_miles,
       (SELECT COUNT(*) FROM crew_members cm2 WHERE cm2.crew_id = c.id AND cm2.status = 'member') as member_count,
       ROUND(CAST(cs.total_participants AS NUMERIC) / cs.active_members, 4) as participation_rate,
       ROUND(CAST(cs.total_miles AS NUMERIC) / cs.active_members, 2) as miles_per_member,
       ROUND(CAST(cs.qualifying_events AS NUMERIC) / (cs.days_active / 7), 2) as events_per_week,
       ROUND(
         (CAST(cs.total_participants AS NUMERIC) / cs.active_members * 50) +
         (CAST(cs.total_miles AS NUMERIC) / cs.active_members * 30) +
         (CAST(cs.qualifying_events AS NUMERIC) / (cs.days_active / 7) * 20),
         1
       ) as crew_score
     FROM crews c
     JOIN users u ON u.id = c.created_by
     JOIN crew_stats cs ON cs.crew_id = c.id
     WHERE 1=1 ${filterClause}
     ORDER BY crew_score DESC
     LIMIT 50`,
    params
  );
  return res.rows;
}
async function getCrewMemberRole(crewId, userId) {
  const res = await pool.query(
    `SELECT role FROM crew_members WHERE crew_id = $1 AND user_id = $2 AND status = 'member'`,
    [crewId, userId]
  );
  return res.rows[0]?.role ?? "member";
}
async function setCrewMemberRole(crewId, targetUserId, newRole, callerUserId) {
  if (newRole === "crew_chief") {
    await pool.query(
      `UPDATE crew_members SET role = 'officer' WHERE crew_id = $1 AND user_id = $2`,
      [crewId, callerUserId]
    );
  }
  await pool.query(
    `UPDATE crew_members SET role = $3 WHERE crew_id = $1 AND user_id = $2`,
    [crewId, targetUserId, newRole]
  );
}
async function getCrewsAtStreakRisk() {
  const currentWeek = getISOWeek(/* @__PURE__ */ new Date());
  const res = await pool.query(
    `SELECT c.id, c.name, c.current_streak_weeks, c.streak_risk_notif_week
     FROM crews c
     WHERE c.current_streak_weeks > 0
       AND (c.streak_risk_notif_week IS NULL OR c.streak_risk_notif_week != $1)
       AND NOT EXISTS (
         SELECT 1 FROM runs r
         WHERE r.crew_id = c.id
           AND r.is_deleted IS NOT TRUE
           AND r.date >= date_trunc('week', NOW())
           AND r.date < date_trunc('week', NOW()) + INTERVAL '7 days'
       )`,
    [currentWeek]
  );
  return res.rows;
}
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
}
async function getCrewsByUser(userId) {
  const res = await pool.query(
    `SELECT c.*, cm.status, cm.chat_muted,
       (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id AND status = 'member') AS member_count,
       u.name AS created_by_name,
       CASE WHEN c.created_by = $1
         THEN (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id AND status = 'pending' AND invited_by = user_id)
         ELSE 0
       END AS pending_request_count
     FROM crews c
     JOIN crew_members cm ON cm.crew_id = c.id AND cm.user_id = $1 AND cm.status = 'member'
     JOIN users u ON u.id = c.created_by
     ORDER BY c.created_at DESC`,
    [userId]
  );
  return res.rows;
}
async function getCrewJoinRequests(crewId) {
  const res = await pool.query(
    `SELECT cm.user_id, cm.joined_at AS requested_at, u.name, u.username, u.photo_url, u.avg_pace, u.completed_runs
     FROM crew_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.crew_id = $1 AND cm.status = 'pending' AND cm.invited_by = cm.user_id
     ORDER BY cm.joined_at ASC`,
    [crewId]
  );
  return res.rows;
}
async function respondToCrewJoinRequest(crewId, requesterId, accept) {
  if (accept) {
    const memberCount = await getCrewMemberCount(crewId);
    const cap = await getCrewMemberCap(crewId);
    if (memberCount >= cap) {
      throw Object.assign(new Error("This crew has reached its member cap. Upgrade to the Crew Growth plan to add more members."), { code: "MEMBER_CAP_REACHED" });
    }
    await pool.query(
      `UPDATE crew_members SET status = 'member', invited_by = invited_by WHERE crew_id = $1 AND user_id = $2 AND status = 'pending'`,
      [crewId, requesterId]
    );
  } else {
    await pool.query(
      `DELETE FROM crew_members WHERE crew_id = $1 AND user_id = $2 AND status = 'pending'`,
      [crewId, requesterId]
    );
  }
}
async function getCrewById(crewId, activityType = "run") {
  const crew = await pool.query(
    `SELECT c.*, u.name AS created_by_name,
       (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id AND status = 'member') AS member_count
     FROM crews c
     LEFT JOIN users u ON u.id = c.created_by
     WHERE c.id = $1`,
    [crewId]
  );
  if (!crew.rows[0]) return null;
  const row = crew.rows[0];
  const members = await pool.query(
    `SELECT cm.*, u.name, u.photo_url, u.hosted_runs, u.default_activity,
       COALESCE((
         SELECT AVG(p) FROM (
           SELECT NULLIF(sr.pace_min_per_mile, 0) AS p
           FROM solo_runs sr
           WHERE sr.user_id = u.id AND sr.completed = true AND sr.is_deleted IS NOT TRUE
           AND sr.activity_type = COALESCE(u.default_activity, 'run')
           AND sr.pace_min_per_mile IS NOT NULL AND sr.pace_min_per_mile > 0
           UNION ALL
           SELECT NULLIF(rp.final_pace, 0) AS p
           FROM run_participants rp
           JOIN runs r ON r.id = rp.run_id
           WHERE rp.user_id = u.id AND rp.final_pace IS NOT NULL AND rp.final_pace > 0
           AND r.is_completed = true AND r.is_deleted IS NOT TRUE
           AND r.activity_type = COALESCE(u.default_activity, 'run')
         ) paces
       ), 0) AS avg_pace
     FROM crew_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.crew_id = $1 AND cm.status = 'member'
     ORDER BY cm.joined_at ASC`,
    [crewId]
  );
  return { ...row, member_count: parseInt(row.member_count ?? "0"), members: members.rows };
}
async function getCrewInvites(userId) {
  const res = await pool.query(
    `SELECT cm.*, c.name AS crew_name, c.emoji, c.description,
       (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id AND status = 'member') AS member_count,
       u.name AS invited_by_name
     FROM crew_members cm
     JOIN crews c ON c.id = cm.crew_id
     JOIN users u ON u.id = cm.invited_by
     WHERE cm.user_id = $1 AND cm.status = 'pending'
     ORDER BY cm.joined_at DESC`,
    [userId]
  );
  return res.rows;
}
async function inviteUserToCrew(crewId, userId, invitedBy) {
  await pool.query(
    `INSERT INTO crew_members (crew_id, user_id, status, invited_by)
     VALUES ($1, $2, 'pending', $3)
     ON CONFLICT (crew_id, user_id) DO NOTHING`,
    [crewId, userId, invitedBy]
  );
}
async function removeCrewMember(crewId, requesterId, targetUserId) {
  const crew = await pool.query(`SELECT created_by FROM crews WHERE id = $1`, [crewId]);
  if (!crew.rows[0]) throw new Error("Crew not found");
  if (crew.rows[0].created_by !== requesterId) throw new Error("Only the Crew Chief can remove members");
  if (targetUserId === requesterId) throw new Error("You cannot remove yourself \u2014 use Leave Crew instead");
  await pool.query(
    `DELETE FROM crew_members WHERE crew_id = $1 AND user_id = $2`,
    [crewId, targetUserId]
  );
}
async function leaveCrewById(crewId, userId) {
  const countRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM crew_members WHERE crew_id = $1 AND status = 'member' AND user_id != $2`,
    [crewId, userId]
  );
  const remaining = parseInt(countRes.rows[0]?.cnt ?? 0);
  if (remaining === 0) {
    await pool.query(`DELETE FROM crews WHERE id = $1`, [crewId]);
    return { disbanded: true };
  }
  const crewRes = await pool.query(`SELECT created_by FROM crews WHERE id = $1`, [crewId]);
  const isCreator = crewRes.rows[0]?.created_by === userId;
  if (isCreator) {
    const nextRes = await pool.query(
      `SELECT user_id FROM crew_members WHERE crew_id = $1 AND user_id != $2 AND status = 'member' ORDER BY joined_at ASC LIMIT 1`,
      [crewId, userId]
    );
    const newOwner = nextRes.rows[0]?.user_id;
    if (newOwner) {
      await pool.query(`UPDATE crews SET created_by = $1 WHERE id = $2`, [newOwner, crewId]);
    }
  }
  await pool.query(`DELETE FROM crew_members WHERE crew_id = $1 AND user_id = $2`, [crewId, userId]);
  return { disbanded: false };
}
async function disbandCrewById(crewId, userId) {
  const crewRes = await pool.query(`SELECT created_by FROM crews WHERE id = $1`, [crewId]);
  if (!crewRes.rows[0]) throw new Error("Crew not found");
  if (crewRes.rows[0].created_by !== userId) throw new Error("Only the creator can disband this crew");
  await pool.query(`DELETE FROM crews WHERE id = $1`, [crewId]);
}
async function getCrewRuns(crewId) {
  const res = await pool.query(
    `SELECT r.*, u.name AS host_name, u.photo_url AS host_photo,
       (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) AS participant_count
     FROM runs r
     JOIN users u ON u.id = r.host_id
     WHERE r.crew_id = $1
       AND r.date > NOW()
     ORDER BY r.date ASC`,
    [crewId]
  );
  return res.rows;
}
async function getCrewRunHistory(crewId) {
  const res = await pool.query(
    `SELECT r.id, r.title, r.date, r.min_distance, r.activity_type, r.host_id,
            u.name AS host_name,
            COALESCE(
              AVG(rp.final_pace) FILTER (WHERE rp.is_present = true AND rp.final_pace IS NOT NULL),
              0
            ) AS avg_attendee_pace,
            COUNT(rp.user_id) FILTER (WHERE rp.is_present = true) AS attendee_count
     FROM runs r
     JOIN users u ON u.id = r.host_id
     LEFT JOIN run_participants rp ON rp.run_id = r.id
     WHERE r.crew_id = $1
       AND r.date < NOW()
     GROUP BY r.id, u.name
     ORDER BY r.date DESC
     LIMIT 20`,
    [crewId]
  );
  return res.rows;
}
async function getCrewStats(crewId) {
  const res = await pool.query(
    `SELECT
       COALESCE(SUM(rp.final_distance), 0) AS total_miles,
       COUNT(DISTINCT r.id) FILTER (WHERE EXISTS (
         SELECT 1 FROM run_participants rp2
         WHERE rp2.run_id = r.id AND rp2.is_present = true
       )) AS total_events,
       (SELECT COUNT(*) FROM crew_members WHERE crew_id = $1 AND status = 'member') AS total_members
     FROM runs r
     LEFT JOIN run_participants rp ON rp.run_id = r.id AND rp.final_distance IS NOT NULL
     WHERE r.crew_id = $1 AND r.date < NOW()`,
    [crewId]
  );
  return {
    totalMiles: parseFloat(res.rows[0]?.total_miles ?? "0"),
    totalEvents: parseInt(res.rows[0]?.total_events ?? "0", 10),
    totalMembers: parseInt(res.rows[0]?.total_members ?? "0", 10)
  };
}
async function getCrewAchievements(crewId) {
  const [achievements, stats] = await Promise.all([
    pool.query(
      `SELECT * FROM crew_achievements WHERE crew_id = $1 ORDER BY achieved_at ASC`,
      [crewId]
    ),
    getCrewStats(crewId)
  ]);
  return { achievements: achievements.rows, stats };
}
async function checkAndAwardCrewAchievements(crewId) {
  try {
    const stats = await getCrewStats(crewId);
    const newKeys = [];
    const MILESTONES = [
      { key: "miles_50", category: "miles", threshold: 50, label: "50 Miles", msg: "\u{1F3C5} The crew just hit 50 miles together! Keep running!" },
      { key: "miles_100", category: "miles", threshold: 100, label: "100 Miles", msg: "\u{1F3C5} 100 miles together \u2014 incredible!" },
      { key: "miles_250", category: "miles", threshold: 250, label: "250 Miles", msg: "\u{1F3C5} 250 miles as a crew. Unstoppable!" },
      { key: "miles_500", category: "miles", threshold: 500, label: "500 Miles", msg: "\u{1F525} 500 miles! The crew is on fire!" },
      { key: "miles_1000", category: "miles", threshold: 1e3, label: "1,000 Miles", msg: "\u{1F3C6} 1,000 crew miles! Legendary!" },
      { key: "miles_2500", category: "miles", threshold: 2500, label: "2,500 Miles", msg: "\u{1F3C6} 2,500 crew miles. Elite status!" },
      { key: "miles_5000", category: "miles", threshold: 5e3, label: "5,000 Miles", msg: "\u{1F3C6} 5,000 miles together \u2014 you're history!" },
      { key: "events_1", category: "events", threshold: 1, label: "First Run", msg: "\u{1F3AF} First crew event complete! The journey begins." },
      { key: "events_5", category: "events", threshold: 5, label: "5 Events", msg: "\u{1F389} 5 events completed as a crew!" },
      { key: "events_10", category: "events", threshold: 10, label: "10 Events", msg: "\u{1F389} 10 crew events! You're building something special." },
      { key: "events_25", category: "events", threshold: 25, label: "25 Events", msg: "\u{1F389} 25 crew events \u2014 keep the streak alive!" },
      { key: "events_50", category: "events", threshold: 50, label: "50 Events", msg: "\u{1F3C6} 50 events as a crew. Legendary dedication!" },
      { key: "events_100", category: "events", threshold: 100, label: "100 Events", msg: "\u{1F3C6} 100 crew events! Hall of fame crew!" },
      { key: "members_5", category: "members", threshold: 5, label: "5 Members", msg: "\u{1F465} 5 members strong! The squad is growing." },
      { key: "members_10", category: "members", threshold: 10, label: "10 Members", msg: "\u{1F465} 10 crew members! Squad goals achieved." },
      { key: "members_25", category: "members", threshold: 25, label: "25 Members", msg: "\u{1F465} 25 members! You're building a real community." },
      { key: "members_50", category: "members", threshold: 50, label: "50 Members", msg: "\u{1F465} 50 crew members \u2014 that's a movement!" }
    ];
    for (const m of MILESTONES) {
      const value = m.category === "miles" ? stats.totalMiles : m.category === "events" ? stats.totalEvents : stats.totalMembers;
      if (value < m.threshold) continue;
      const existing = await pool.query(
        `SELECT id FROM crew_achievements WHERE crew_id = $1 AND achievement_key = $2`,
        [crewId, m.key]
      );
      if (existing.rows.length > 0) continue;
      await pool.query(
        `INSERT INTO crew_achievements (crew_id, achievement_key, achieved_value) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [crewId, m.key, value]
      );
      await pool.query(
        `INSERT INTO crew_messages (crew_id, sender_name, message, message_type)
         VALUES ($1, 'PaceUp', $2, 'milestone')`,
        [crewId, m.msg]
      );
      newKeys.push(m.key);
    }
    return newKeys;
  } catch (_) {
    return [];
  }
}
async function searchCrews(userId, query, friendsOnly) {
  if (friendsOnly) {
    const res2 = await pool.query(
      `SELECT DISTINCT c.*,
         (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id AND status = 'member') AS member_count,
         u.name AS created_by_name,
         EXISTS(SELECT 1 FROM crew_members WHERE crew_id = c.id AND user_id = $1 AND status = 'member') AS is_member,
         EXISTS(SELECT 1 FROM crew_members WHERE crew_id = c.id AND user_id = $1 AND status = 'pending') AS has_requested
       FROM crews c
       JOIN crew_members cm2 ON cm2.crew_id = c.id AND cm2.status = 'member'
       JOIN friends f ON (
         (f.requester_id = $1 AND f.addressee_id = cm2.user_id) OR
         (f.addressee_id = $1 AND f.requester_id = cm2.user_id)
       )
       JOIN users u ON u.id = c.created_by
       WHERE f.status = 'accepted'
         AND cm2.user_id != $1
         ${query ? "AND LOWER(c.name) LIKE $2" : ""}
       ORDER BY member_count DESC
       LIMIT 30`,
      query ? [userId, `%${query.toLowerCase()}%`] : [userId]
    );
    return res2.rows;
  }
  if (!query.trim()) return [];
  const res = await pool.query(
    `SELECT c.*,
       (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id AND status = 'member') AS member_count,
       u.name AS created_by_name,
       EXISTS(SELECT 1 FROM crew_members WHERE crew_id = c.id AND user_id = $1 AND status = 'member') AS is_member,
       EXISTS(SELECT 1 FROM crew_members WHERE crew_id = c.id AND user_id = $1 AND status = 'pending') AS has_requested
     FROM crews c
     JOIN users u ON u.id = c.created_by
     WHERE LOWER(c.name) LIKE $2
     ORDER BY member_count DESC
     LIMIT 30`,
    [userId, `%${query.toLowerCase()}%`]
  );
  return res.rows;
}
async function getCrewMemberCount(crewId) {
  const res = await pool.query(
    `SELECT COUNT(*) as cnt FROM crew_members WHERE crew_id = $1 AND status = 'member'`,
    [crewId]
  );
  return parseInt(res.rows[0].cnt, 10);
}
async function getCrewMemberCap(crewId) {
  const res = await pool.query(
    `SELECT subscription_tier, member_cap_override FROM crews WHERE id = $1`,
    [crewId]
  );
  if (!res.rows[0]) return 100;
  const { subscription_tier, member_cap_override } = res.rows[0];
  if (member_cap_override) return member_cap_override;
  if (subscription_tier === "growth" || subscription_tier === "both") return 999999;
  return 100;
}
async function updateCrewSubscription(crewId, tier) {
  await pool.query(
    `UPDATE crews SET subscription_tier = $2 WHERE id = $1`,
    [crewId, tier]
  );
}
async function getCrewSubscriptionStatus(crewId) {
  const res = await pool.query(
    `SELECT subscription_tier, member_cap_override FROM crews WHERE id = $1`,
    [crewId]
  );
  if (!res.rows[0]) return null;
  const memberCount = await getCrewMemberCount(crewId);
  const cap = await getCrewMemberCap(crewId);
  return {
    subscription_tier: res.rows[0].subscription_tier || "none",
    member_cap_override: res.rows[0].member_cap_override,
    member_count: memberCount,
    member_cap: cap,
    at_cap: memberCount >= cap
  };
}
async function getSuggestedCrews(userId, limit = 10) {
  const userRes = await pool.query(
    `SELECT home_metro, home_state,
       (SELECT r.run_style FROM runs r WHERE r.host_id = $1 AND r.run_style IS NOT NULL GROUP BY r.run_style ORDER BY COUNT(*) DESC LIMIT 1) AS preferred_run_style
     FROM users WHERE id = $1`,
    [userId]
  );
  const userMetro = userRes.rows[0]?.home_metro || null;
  const userState = userRes.rows[0]?.home_state || null;
  const userRunStyle = userRes.rows[0]?.preferred_run_style || null;
  const fetchLimit = limit * 3;
  const res = await pool.query(
    `SELECT c.*,
       (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id AND status = 'member') AS member_count,
       u.name AS created_by_name,
       c.image_url,
       (SELECT COUNT(DISTINCT r.id) FROM runs r WHERE r.crew_id = c.id AND r.is_completed = true AND r.date > NOW() - INTERVAL '30 days') AS recent_activity,
       CASE WHEN c.subscription_tier IN ('discovery_boost', 'both') THEN true ELSE false END AS is_boosted,
       CASE WHEN c.subscription_tier IN ('discovery_boost', 'both') THEN 1.3 ELSE 1.0 END AS boost_factor,
       CASE WHEN c.home_metro = $2 AND $2 IS NOT NULL THEN 20 ELSE 0 END AS metro_bonus,
       CASE WHEN c.home_state = $3 AND $3 IS NOT NULL THEN 10 ELSE 0 END AS state_bonus,
       CASE WHEN c.run_style = $4 AND $4 IS NOT NULL THEN 15 ELSE 0 END AS run_style_bonus,
       COALESCE(c.subscription_tier, 'none') AS sub_tier
     FROM crews c
     JOIN users u ON u.id = c.created_by
     WHERE NOT EXISTS (
       SELECT 1 FROM crew_members cm WHERE cm.crew_id = c.id AND cm.user_id = $1
     )
     ORDER BY
       (CASE WHEN c.subscription_tier IN ('discovery_boost', 'both') THEN 1.3 ELSE 1.0 END) *
       (
         (SELECT COUNT(DISTINCT r.id) FROM runs r WHERE r.crew_id = c.id AND r.is_completed = true AND r.date > NOW() - INTERVAL '30 days') * 10 +
         (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id AND status = 'member') * 2 +
         CASE WHEN c.home_metro = $2 AND $2 IS NOT NULL THEN 20 ELSE 0 END +
         CASE WHEN c.home_state = $3 AND $3 IS NOT NULL THEN 10 ELSE 0 END +
         CASE WHEN c.run_style = $4 AND $4 IS NOT NULL THEN 15 ELSE 0 END
       ) DESC
     LIMIT $5`,
    [userId, userMetro, userState, userRunStyle, fetchLimit]
  );
  const rows = res.rows;
  const boostedTiers = ["discovery_boost", "both"];
  const freeCrews = rows.filter((r) => !boostedTiers.includes(r.sub_tier));
  const boostedCrews = rows.filter((r) => boostedTiers.includes(r.sub_tier));
  const minFreeSlots = Math.ceil(limit / 2);
  const freeToAdd = freeCrews.slice(0, Math.max(minFreeSlots, limit - boostedCrews.length));
  const boostedToAdd = boostedCrews.slice(0, limit - freeToAdd.length);
  const result = [];
  let fi = 0, bi = 0;
  for (let i = 0; i < limit && (fi < freeToAdd.length || bi < boostedToAdd.length); i++) {
    if (bi < boostedToAdd.length && fi >= minFreeSlots) {
      result.push(boostedToAdd[bi++]);
    } else if (fi < freeToAdd.length) {
      result.push(freeToAdd[fi++]);
    } else if (bi < boostedToAdd.length) {
      result.push(boostedToAdd[bi++]);
    }
  }
  return result;
}
async function getPublicCrewRuns(filters) {
  let query = `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.photo_url as host_photo,
      u.marker_icon as host_marker_icon, u.hosted_runs as host_hosted_runs,
      (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
      (SELECT COUNT(*) FROM planned_runs pr WHERE pr.run_id = r.id) as plan_count,
      c.name as crew_name, c.emoji as crew_emoji, c.image_url as crew_photo_url
    FROM runs r
    JOIN users u ON u.id = r.host_id
    JOIN crews c ON c.id = r.crew_id
    WHERE r.crew_id IS NOT NULL
      AND r.privacy = 'public'
      AND (r.is_active = true OR r.date > NOW() - INTERVAL '90 minutes')
      AND r.is_completed = false
      AND r.is_deleted IS NOT TRUE`;
  const params = [];
  let idx = 1;
  if (filters?.swLat !== void 0 && filters.neLat !== void 0) {
    query += ` AND r.location_lat BETWEEN $${idx++} AND $${idx++}`;
    params.push(filters.swLat, filters.neLat);
  }
  if (filters?.swLng !== void 0 && filters.neLng !== void 0) {
    query += ` AND r.location_lng BETWEEN $${idx++} AND $${idx++}`;
    params.push(filters.swLng, filters.neLng);
  }
  query += ` ORDER BY r.date ASC LIMIT 100`;
  const result = await pool.query(query, params);
  return result.rows;
}
async function requestToJoinCrew(crewId, userId) {
  const existing = await pool.query(
    `SELECT status FROM crew_members WHERE crew_id = $1 AND user_id = $2`,
    [crewId, userId]
  );
  if (existing.rows.length > 0) {
    return { error: existing.rows[0].status === "member" ? "already_member" : "already_requested" };
  }
  const memberCount = await getCrewMemberCount(crewId);
  const cap = await getCrewMemberCap(crewId);
  if (memberCount >= cap) {
    return { error: "member_cap_reached" };
  }
  await pool.query(
    `INSERT INTO crew_members (crew_id, user_id, status, invited_by) VALUES ($1, $2, 'pending', $2)`,
    [crewId, userId]
  );
  return { ok: true };
}
async function getCrewMemberPushTokensFiltered(crewId, notifField) {
  const res = await pool.query(
    `SELECT u.push_token FROM users u
     JOIN crew_members cm ON cm.user_id = u.id
     WHERE cm.crew_id = $1 AND cm.status = 'member'
       AND u.push_token IS NOT NULL
       AND u.notifications_enabled = true
       AND u.${notifField} = true`,
    [crewId]
  );
  return res.rows.map((r) => r.push_token);
}
async function getFriendsWithPushTokensFiltered(userId, notifField) {
  const result = await pool.query(
    `SELECT u.push_token
     FROM friends f
     JOIN users u ON (CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END) = u.id
     WHERE (f.requester_id = $1 OR f.addressee_id = $1)
       AND f.status = 'accepted'
       AND u.push_token IS NOT NULL
       AND u.notifications_enabled = true
       AND u.${notifField} = true`,
    [userId]
  );
  return result.rows.map((r) => r.push_token);
}
async function getRunParticipantTokensFiltered(runId, notifField) {
  const result = await pool.query(
    `SELECT u.push_token
     FROM run_participants rp
     JOIN users u ON rp.user_id = u.id
     WHERE rp.run_id = $1 AND rp.status != 'cancelled'
       AND u.push_token IS NOT NULL
       AND u.notifications_enabled = true
       AND u.${notifField} = true`,
    [runId]
  );
  return result.rows.map((r) => r.push_token);
}
async function getRunPresentParticipantTokensFiltered(runId, notifField) {
  const result = await pool.query(
    `SELECT u.push_token
     FROM run_participants rp
     JOIN users u ON rp.user_id = u.id
     WHERE rp.run_id = $1 AND rp.status != 'cancelled'
       AND rp.is_present = true
       AND u.push_token IS NOT NULL
       AND u.notifications_enabled = true
       AND u.${notifField} = true`,
    [runId]
  );
  return result.rows.map((r) => r.push_token);
}
async function getRunBroadcastTokens(runId) {
  const result = await pool.query(
    `SELECT u.push_token FROM run_participants rp
     JOIN users u ON rp.user_id = u.id
     WHERE rp.run_id = $1 AND rp.status != 'cancelled'
       AND u.push_token IS NOT NULL AND u.notifications_enabled = true
     UNION
     SELECT u.push_token FROM planned_runs pr
     JOIN users u ON pr.user_id = u.id
     WHERE pr.run_id = $1
       AND u.push_token IS NOT NULL AND u.notifications_enabled = true`,
    [runId]
  );
  return result.rows.map((r) => r.push_token);
}
async function deleteUser(userId) {
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
}
async function getUsersForWeeklySummary() {
  const res = await pool.query(
    `SELECT id, name, push_token FROM users
     WHERE notifications_enabled = true
       AND notif_weekly_summary = true
       AND push_token IS NOT NULL`
  );
  return res.rows;
}
async function getWeeklyStatsForUser(userId) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3);
  const res = await pool.query(
    `SELECT COUNT(*) as runs,
            COALESCE(SUM(distance_mi), 0) as total_mi,
            COALESCE(SUM(duration_seconds), 0) as total_seconds
     FROM solo_runs
     WHERE user_id = $1 AND completed_at >= $2`,
    [userId, since]
  );
  return {
    runs: parseInt(res.rows[0].runs, 10),
    totalMi: parseFloat(res.rows[0].total_mi),
    totalSeconds: parseInt(res.rows[0].total_seconds, 10)
  };
}
async function getDmConversations(userId) {
  const res = await pool.query(
    `SELECT
       other_user.id as friend_id,
       other_user.name as friend_name,
       other_user.username as friend_username,
       other_user.photo_url as friend_photo,
       last_msg.message as last_message,
       last_msg.created_at as last_message_at,
       last_msg.sender_id as last_sender_id,
       COUNT(unread.id) as unread_count
     FROM (
       SELECT DISTINCT
         CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END as other_id
       FROM direct_messages
       WHERE sender_id = $1 OR recipient_id = $1
     ) pairs
     JOIN users other_user ON other_user.id = pairs.other_id
     JOIN LATERAL (
       SELECT message, created_at, sender_id
       FROM direct_messages
       WHERE (sender_id = $1 AND recipient_id = pairs.other_id)
          OR (sender_id = pairs.other_id AND recipient_id = $1)
       ORDER BY created_at DESC
       LIMIT 1
     ) last_msg ON true
     LEFT JOIN direct_messages unread
       ON unread.recipient_id = $1
      AND unread.sender_id = pairs.other_id
      AND unread.read_at IS NULL
     GROUP BY other_user.id, other_user.name, other_user.username, other_user.photo_url,
              last_msg.message, last_msg.created_at, last_msg.sender_id
     ORDER BY last_msg.created_at DESC`,
    [userId]
  );
  return res.rows;
}
async function getDmThread(userId, friendId, limit = 50) {
  const res = await pool.query(
    `SELECT dm.*, 
       sender.name as sender_name,
       sender.photo_url as sender_photo
     FROM direct_messages dm
     JOIN users sender ON sender.id = dm.sender_id
     WHERE (dm.sender_id = $1 AND dm.recipient_id = $2)
        OR (dm.sender_id = $2 AND dm.recipient_id = $1)
     ORDER BY dm.created_at DESC
     LIMIT $3`,
    [userId, friendId, limit]
  );
  return res.rows;
}
async function sendDm(senderId, recipientId, message, messageType = "text", metadata) {
  const friendCheck = await pool.query(
    `SELECT id FROM friends
     WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
       AND status = 'accepted'`,
    [senderId, recipientId]
  );
  if (friendCheck.rows.length === 0) throw new Error("Not friends");
  const res = await pool.query(
    `INSERT INTO direct_messages (sender_id, recipient_id, message, message_type, metadata)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [senderId, recipientId, message, messageType, metadata ? JSON.stringify(metadata) : null]
  );
  return res.rows[0];
}
async function markDmRead(userId, friendId) {
  await pool.query(
    `UPDATE direct_messages SET read_at = NOW()
     WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL`,
    [userId, friendId]
  );
}
async function deleteDmThread(userId, friendId) {
  await pool.query(
    `DELETE FROM direct_messages
     WHERE (sender_id = $1 AND recipient_id = $2)
        OR (sender_id = $2 AND recipient_id = $1)`,
    [userId, friendId]
  );
}
async function getDmUnreadCount(userId) {
  const res = await pool.query(
    `SELECT COUNT(*) as cnt FROM direct_messages
     WHERE recipient_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return parseInt(res.rows[0].cnt, 10);
}
async function getRecentCommunityActivity() {
  const res = await pool.query(`
    SELECT r.id, r.title, r.location_name, r.activity_type,
           COALESCE(r.started_at, r.date) AS completed_at,
           u.name AS host_name,
           COALESCE(r.max_distance, 0) AS max_distance,
           COUNT(DISTINCT rp.user_id) AS participant_count
    FROM runs r
    JOIN users u ON u.id = r.host_id
    LEFT JOIN run_participants rp
      ON rp.run_id = r.id AND rp.status IN ('confirmed', 'joined')
    WHERE r.is_completed = true
      AND COALESCE(r.started_at, r.date) >= NOW() - INTERVAL '14 days'
    GROUP BY r.id, u.name
    ORDER BY (COUNT(DISTINCT rp.user_id) * 2 + COALESCE(r.max_distance, 0)) DESC,
             COALESCE(r.started_at, r.date) DESC
    LIMIT 12
  `);
  return res.rows.map((row) => ({
    ...row,
    participant_count: parseInt(row.participant_count, 10)
  }));
}
async function blockUser(blockerId, blockedId) {
  await pool.query(
    `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [blockerId, blockedId]
  );
}
async function unblockUser(blockerId, blockedId) {
  await pool.query(
    `DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`,
    [blockerId, blockedId]
  );
}
async function isBlockedBy(requesterId, targetId) {
  const res = await pool.query(
    `SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`,
    [targetId, requesterId]
  );
  return res.rows.length > 0;
}
async function isBlocking(requesterId, targetId) {
  const res = await pool.query(
    `SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`,
    [requesterId, targetId]
  );
  return res.rows.length > 0;
}

// server/ai.ts
import OpenAI from "openai";
if (!process.env.OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY is not set. AI features will be disabled or fallback to defaults.");
}
var openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy"
});
async function generateRunSummary(stats) {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an elite AI running coach. Provide a concise, motivating summary of a run based on the provided stats. Keep it under 150 characters. Use a supportive, professional tone. Avoid emojis."
        },
        {
          role: "user",
          content: `Stats: Distance ${stats.distanceMiles} miles, Pace ${stats.paceMinPerMile} min/mile, Duration ${Math.floor(stats.durationSeconds / 60)} minutes, Elevation gain ${stats.elevationGainFt} ft.`
        }
      ],
      max_tokens: 60
    });
    return response.choices[0].message.content?.trim() || null;
  } catch (err) {
    console.error("[AI] generateRunSummary error:", err);
    return null;
  }
}
async function generateCrewRecap(crewName, runTitle, participantCount, avgPace) {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an AI assistant for a running crew. Write a quick, enthusiastic recap of a group run for the crew chat. Mention the crew name and basic stats. Keep it under 200 characters. No emojis."
        },
        {
          role: "user",
          content: `Crew: ${crewName}. Run: ${runTitle}. Participants: ${participantCount}. Avg Pace: ${avgPace}.`
        }
      ],
      max_tokens: 100
    });
    return response.choices[0].message.content?.trim() || null;
  } catch (err) {
    console.error("[AI] generateCrewRecap error:", err);
    return null;
  }
}
async function generateSearchFilters(query) {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Extract running/cycling search filters from natural language. Return JSON with keys: paceMax (number), distMin (number), distMax (number), tags (string array). If a filter isn't mentioned, omit it. Only return the JSON."
        },
        {
          role: "user",
          content: query
        }
      ],
      response_format: { type: "json_object" }
    });
    return JSON.parse(response.choices[0].message.content || "{}");
  } catch (err) {
    console.error("[AI] generateSearchFilters error:", err);
    return null;
  }
}
async function generateWeeklyInsight(userName, stats) {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a performance analyst. Provide one insightful sentence for a runner's weekly summary. Compare to typical progress or highlight a specific achievement in the data. No emojis."
        },
        {
          role: "user",
          content: `Runner: ${userName}. This week: ${stats.runs} runs, ${stats.totalMi.toFixed(1)} miles, ${Math.floor(stats.totalSeconds / 60)} minutes.`
        }
      ],
      max_tokens: 80
    });
    return response.choices[0].message.content?.trim() || null;
  } catch (err) {
    console.error("[AI] generateWeeklyInsight error:", err);
    return null;
  }
}
async function generateSoloActivityPost(name, distanceMiles, paceMinPerMile, durationSeconds, activityType, prContext) {
  const activity = activityType === "ride" ? "bike ride" : activityType === "walk" ? "walk" : "run";
  const distStr = `${distanceMiles.toFixed(1)} mi`;
  const paceStr = paceMinPerMile ? `${Math.floor(paceMinPerMile)}:${String(Math.round(paceMinPerMile % 1 * 60)).padStart(2, "0")} /mi` : null;
  const timeStr = durationSeconds ? `${Math.floor(durationSeconds / 60)} min` : null;
  const details = [distStr, paceStr ? `${paceStr} pace` : null, timeStr].filter(Boolean).join(", ");
  const prNotes = [];
  if (prContext?.isLongest) prNotes.push(`longest ${activity} ever`);
  if (prContext?.isBestPace) prNotes.push("fastest pace ever");
  const milestones = [5, 10, 25, 50, 100, 200, 500];
  if (prContext && milestones.includes(prContext.totalRuns)) {
    prNotes.push(`workout #${prContext.totalRuns} milestone`);
  }
  const prLine = prNotes.length > 0 ? ` Notable: ${prNotes.join(", ")}.` : "";
  if (!process.env.OPENAI_API_KEY) {
    const prSuffix = prNotes.length > 0 ? ` That's their ${prNotes[0]}!` : "";
    return `${name} just logged a ${activity}: ${details}.${prSuffix}`;
  }
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a hype man for a running crew app. A member just logged a solo workout. Write one short, casual, celebratory message for the crew chat. Use the person's first name naturally. Mention the activity and key stats conversationally \u2014 don't just list them. If there are notable personal records or milestones, weave them in naturally (e.g., 'that's their longest run yet' or 'new pace PR'). Sound like a real person texting the group. Under 160 characters. No emojis. No hashtags."
        },
        {
          role: "user",
          content: `Name: ${name}. Activity: ${activity}. Stats: ${details}.${prLine}`
        }
      ],
      max_tokens: 60
    });
    return response.choices[0].message.content?.trim() || `${name} just logged a ${activity}: ${details}.`;
  } catch (err) {
    console.error("[AI] generateSoloActivityPost error:", err);
    return `${name} just logged a ${activity}: ${details}.`;
  }
}
var ALLOWED_VOICES = ["alloy", "echo", "fable", "nova", "onyx", "shimmer"];
async function generateTTS(text, voice = "nova") {
  if (!process.env.OPENAI_API_KEY) return null;
  const safeVoice = ALLOWED_VOICES.includes(voice) ? voice : "nova";
  try {
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: safeVoice,
      input: text
    });
    const buffer = Buffer.from(await mp3.arrayBuffer());
    return buffer;
  } catch (err) {
    console.error("[AI] generateTTS error:", err);
    return null;
  }
}

// server/seed.ts
import { Pool as Pool2 } from "pg";
var pool2 = new Pool2({ connectionString: process.env.DATABASE_URL });
var HOUSTON_LAT = 29.7604;
var HOUSTON_LNG = -95.3698;
var STYLES = ["Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];
var TITLES = [
  "Morning Miles in Midtown",
  "Buffalo Bayou Bridge Run",
  "Memorial Park Loop",
  "Heights Neighborhood Jog",
  "Downtown Discovery Run",
  "Rice University Track Workout",
  "Hermann Park Sunrise Run",
  "Museum District 5K",
  "Galleria Area Sprint",
  "Montrose Morning Crew",
  "Energy Corridor Run",
  "Uptown Saturday Stroll",
  "Greenway Plaza Circuit",
  "River Oaks Route",
  "Cypress Creek Trail Blast",
  "South Loop Easy Miles",
  "Westheimer Winder",
  "Pearland Park Run",
  "Katy Prairie Discovery",
  "Sugarland Social Jog"
];
var DUMMY_HOSTS = [
  { name: "Marcus T.", pfp: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face", icon: "\u{1F525}" },
  { name: "Aisha K.", pfp: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=face" },
  { name: "Devon R.", pfp: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop&crop=face", icon: "\u26A1" },
  { name: "Sofia M.", pfp: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop&crop=face" },
  { name: "Jamal W.", pfp: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop&crop=face", icon: "\u{1F3C6}" },
  { name: "Lily C.", pfp: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&h=200&fit=crop&crop=face", icon: "\u{1F33F}" },
  { name: "Brendan O.", pfp: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&h=200&fit=crop&crop=face" },
  { name: "Priya S.", pfp: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop&crop=face", icon: "\u{1F3AF}" },
  { name: "Tyler H.", pfp: "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=200&h=200&fit=crop&crop=face" },
  { name: "Naomi J.", pfp: "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=200&h=200&fit=crop&crop=face", icon: "\u{1F31F}" }
];
function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
async function getOrCreateDummyHost(host) {
  const email = `dummy-${host.name.toLowerCase().replace(/[^a-z]/g, "")}@paceup.dev`;
  const existing = await pool2.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing.rows.length > 0) {
    if (host.icon) {
      await pool2.query(`UPDATE users SET marker_icon = $2 WHERE id = $1`, [existing.rows[0].id, host.icon]);
    }
    return existing.rows[0].id;
  }
  const inserted = await pool2.query(
    `INSERT INTO users (email, password, name, photo_url, marker_icon, host_unlocked, role) VALUES ($1, $2, $3, $4, $5, true, 'host') RETURNING id`,
    [email, "not-a-real-password-hash", host.name, host.pfp, host.icon ?? null]
  );
  return inserted.rows[0].id;
}
async function generateDummyRuns(count = 15) {
  const titlePool = [...TITLES];
  for (let i = 0; i < count; i++) {
    const host = DUMMY_HOSTS[i % DUMMY_HOSTS.length];
    const hostId = await getOrCreateDummyHost(host);
    const lat = HOUSTON_LAT + randFloat(-0.03, 0.03);
    const lng = HOUSTON_LNG + randFloat(-0.03, 0.03);
    const paceMin = randFloat(6.5, 9.5);
    const paceMax = paceMin + randFloat(0.5, 1.5);
    const distMin = randFloat(3, 6);
    const distMax = distMin + randFloat(2, 4);
    const style = pick(STYLES);
    const daysAhead = Math.floor(Math.random() * 7);
    const hoursAhead = 5 + Math.floor(Math.random() * 14);
    const date = /* @__PURE__ */ new Date();
    date.setDate(date.getDate() + daysAhead);
    date.setHours(hoursAhead, 0, 0, 0);
    const title = titlePool.length > 0 ? titlePool.splice(Math.floor(Math.random() * titlePool.length), 1)[0] : `Houston Run ${i + 1}`;
    await pool2.query(
      `INSERT INTO runs (host_id, title, privacy, date, location_lat, location_lng, location_name, min_distance, max_distance, min_pace, max_pace, tags, max_participants)
       VALUES ($1,$2,'public',$3,$4,$5,$6,$7,$8,$9,$10,$11,20)`,
      [hostId, title, date.toISOString(), lat, lng, "Houston, TX", distMin, distMax, paceMin, paceMax, [style]]
    );
  }
}
async function clearAndReseedRuns(count = 20) {
  await pool2.query(
    `DELETE FROM run_participants WHERE run_id IN (
      SELECT r.id FROM runs r
      JOIN users u ON u.id = r.host_id
      WHERE u.email LIKE 'dummy-%@paceup.dev'
    )`
  );
  await pool2.query(
    `DELETE FROM runs WHERE host_id IN (
      SELECT id FROM users WHERE email LIKE 'dummy-%@paceup.dev'
    )`
  );
  await generateDummyRuns(count);
}
async function getRunCount() {
  const result = await pool2.query(`SELECT COUNT(*) as count FROM runs WHERE date > NOW() AND is_completed = false`);
  return parseInt(result.rows[0].count, 10);
}

// server/objectStorage.ts
import { Storage } from "@google-cloud/storage";
var REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
var BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
var objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token"
      }
    },
    universe_domain: "googleapis.com"
  },
  projectId: ""
});
var bucket = objectStorageClient.bucket(BUCKET_ID);
async function uploadPhotoBuffer(buffer, filename, contentType) {
  const objectPath = `public/photos/${filename}`;
  const file = bucket.file(objectPath);
  await file.save(buffer, {
    metadata: { contentType },
    resumable: false
  });
  try {
    await file.makePublic();
    return `https://storage.googleapis.com/${BUCKET_ID}/${objectPath}`;
  } catch {
    return `/api/objects/${objectPath}`;
  }
}
async function streamObject(objectPath) {
  const file = bucket.file(objectPath);
  const [metadata] = await file.getMetadata();
  const contentType = metadata.contentType || "application/octet-stream";
  const stream = file.createReadStream();
  return { stream, contentType };
}

// server/notifications.ts
var EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
async function sendPushNotification(tokens, title, body, data) {
  const tokenList = Array.isArray(tokens) ? tokens : [tokens];
  const valid = tokenList.filter((t) => t && t.startsWith("ExponentPushToken["));
  if (!valid.length) return;
  const messages = valid.map((to) => ({
    to,
    title,
    body,
    sound: "default",
    data: data ?? {}
  }));
  try {
    await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(messages)
    });
  } catch (err) {
    console.error("[push] Failed to send notification:", err);
  }
}
var notifFieldMap = {
  run_reminders: "notif_run_reminders",
  crew_activity: "notif_crew_activity",
  weekly_summary: "notif_weekly_summary",
  friend_requests: "notif_friend_requests"
};
function userWantsNotif(user, type) {
  if (!user) return false;
  if (user.notifications_enabled === false) return false;
  if (!user.push_token) return false;
  const field = notifFieldMap[type];
  return user[field] !== false;
}

// server/routes.ts
import crypto from "crypto";
import OAuth from "oauth-1.0a";
var GARMIN_REQUEST_TOKEN_URL = "https://connectapi.garmin.com/oauth-service/oauth/request_token";
var GARMIN_AUTH_URL = "https://connect.garmin.com/oauthConfirm";
var GARMIN_ACCESS_TOKEN_URL = "https://connectapi.garmin.com/oauth-service/oauth/access_token";
var GARMIN_ACTIVITIES_URL = "https://apis.garmin.com/wellness-api/rest/activities";
var garminPendingTokens = /* @__PURE__ */ new Map();
function makeGarminOAuth() {
  const key = process.env.GARMIN_CONSUMER_KEY;
  const secret = process.env.GARMIN_CONSUMER_SECRET;
  if (!key || !secret) return null;
  return new OAuth({
    consumer: { key, secret },
    signature_method: "HMAC-SHA1",
    hash_function(base_string, sigKey) {
      return crypto.createHmac("sha1", sigKey).update(base_string).digest("base64");
    }
  });
}
async function garminFetch(url, method, oauthInst, token) {
  const request = { url, method };
  const authData = oauthInst.authorize(request, token ? { key: token.key, secret: token.secret } : void 0);
  const authHeader = oauthInst.toHeader(authData);
  const resp = await fetch(url, { method, headers: { ...authHeader, "Content-Type": "application/x-www-form-urlencoded" } });
  if (!resp.ok) throw new Error(`Garmin API error: ${resp.status} ${await resp.text()}`);
  return resp;
}
var upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
var PgStore = connectPgSimple(session);
var ALLOWED_IMAGE_EXTENSIONS = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "gif", "webp", "heic"]);
function validateUploadExtension(originalname) {
  const ext = originalname.includes(".") ? originalname.split(".").pop().toLowerCase() : "";
  return ext && ALLOWED_IMAGE_EXTENSIONS.has(ext) ? ext : null;
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
  next();
}
function formatPaceStr(avgPaceDecimal) {
  const totalSec = Math.round(avgPaceDecimal * 60);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
async function postCrewRunRecap(runId) {
  const run = await getRunById(runId);
  if (!run?.crew_id) return;
  const crew = await getCrewById(run.crew_id);
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
  const recap = await generateCrewRecap(crew.name, run.title, finisherCount, paceStr);
  const distPart = avgDist > 0 ? ` \xB7 ${avgDist.toFixed(1)} mi avg` : "";
  await createCrewMessage(
    run.crew_id,
    "system",
    "PaceUp Bot",
    null,
    recap || `${crew.name} wrapped "${run.title}" \u2014 ${finisherCount} runners, ${paceStr} avg pace${distPart}.`,
    "milestone"
  );
}
async function registerRoutes(app2) {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET environment variable is required but not set");
  }
  await initDb();
  if (process.env.NODE_ENV !== "production") {
    const runCount = await getRunCount();
    if (runCount === 0) {
      await generateDummyRuns(15);
      console.log("[seed] Inserted 15 dummy runs for Houston");
    }
  }
  app2.use(
    session({
      store: new PgStore({ pool, createTableIfMissing: true }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1e3,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax"
      }
    })
  );
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1e3,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests, please try again later" }
  });
  app2.post("/api/auth/register", authLimiter, async (req, res) => {
    try {
      const { email, password, firstName, lastName, username, gender } = req.body;
      if (!email || !password || !firstName || !lastName || !username) return res.status(400).json({ message: "All fields required" });
      if (gender && !["Man", "Woman", "Prefer not to say"].includes(gender)) return res.status(400).json({ message: "Invalid gender selection" });
      if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      if (!/^[^\s@]{2,30}$/.test(username) || !/[a-zA-Z0-9]/.test(username)) return res.status(400).json({ message: "Username must be 2\u201330 characters, contain no spaces or @, and include at least one letter or number" });
      const existing = await getUserByEmail(email);
      if (existing) return res.status(400).json({ message: "Email already in use" });
      const existingUsername = await getUserByUsername(username);
      if (existingUsername) return res.status(400).json({ message: "Username already taken" });
      const name = `${firstName.trim()} ${lastName.trim()}`;
      const user = await createUser({ email, password, name, username, gender });
      req.session.userId = user.id;
      const rememberToken = await createRememberToken(user.id);
      const { password: _, ...safeUser } = user;
      res.json({ ...safeUser, rememberToken });
    } catch (e) {
      if (e?.code === "23505") {
        return res.status(400).json({ message: "Email or username already taken" });
      }
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/auth/login", authLimiter, async (req, res) => {
    try {
      const { identifier, password } = req.body;
      if (!identifier || !password) return res.status(400).json({ message: "Username/email and password required" });
      const user = await getUserByEmailOrUsername(identifier.trim());
      if (!user) return res.status(401).json({ message: "Invalid credentials" });
      const valid = await verifyPassword(password, user.password);
      if (!valid) return res.status(401).json({ message: "Invalid credentials" });
      req.session.userId = user.id;
      const rememberToken = await createRememberToken(user.id);
      const { password: _, ...safeUser } = user;
      res.json({ ...safeUser, rememberToken });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/auth/logout", async (req, res) => {
    try {
      const { rememberToken } = req.body ?? {};
      if (rememberToken) await deleteRememberToken(rememberToken).catch(() => {
      });
      if (req.session.userId) await deleteUserRememberTokens(req.session.userId).catch(() => {
      });
    } catch {
    }
    req.session.destroy(() => res.json({ success: true }));
  });
  app2.post("/api/auth/restore-session", async (req, res) => {
    try {
      const { token } = req.body ?? {};
      if (!token) return res.status(400).json({ message: "Token required" });
      const userId = await validateRememberToken(token);
      if (!userId) return res.status(401).json({ message: "Invalid or expired token" });
      const user = await getUserById(userId);
      if (!user) return res.status(401).json({ message: "User not found" });
      req.session.userId = userId;
      const newToken = await createRememberToken(userId);
      const { password: _, ...safeUser } = user;
      res.json({ ...safeUser, rememberToken: newToken });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email is required" });
      const user = await getUserByEmail(email.trim());
      if (!user) return res.json({ ok: true });
      const token = await createPasswordResetToken(user.id);
      const host = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}:5000` : "https://PaceUp.replit.app";
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
        auth: { user: smtpUser, pass: smtpPass }
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
        `
      });
      res.json({ ok: true });
    } catch (e) {
      console.error("[forgot-password]", e.message);
      res.json({ ok: true });
    }
  });
  app2.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) return res.status(400).json({ message: "Token and password required" });
      if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      const userId = await consumePasswordResetToken(token);
      if (!userId) return res.status(400).json({ message: "Invalid or expired reset link" });
      await updateUserPassword(userId, password);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/auth/reset", (req, res) => {
    const token = req.query.token || "";
    res.send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset Password \u2014 PaceUp</title>
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
<input type="hidden" name="token" value="${token.replace(/"/g, "&quot;")}">
<label>New Password</label>
<input type="password" id="pw" minlength="6" required placeholder="At least 6 characters">
<label>Confirm Password</label>
<input type="password" id="pw2" minlength="6" required placeholder="Re-enter password">
<button type="submit" class="btn" id="sub">Reset Password</button>
</form>
<div id="msg"></div>
<a class="open-app" href="paceup://reset-password?token=${token.replace(/"/g, "&quot;")}">Open in PaceUp app instead</a>
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
  app2.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    const user = await getUserById(req.session.userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    const { password: _, ...safeUser } = user;
    res.json(safeUser);
  });
  app2.put("/api/users/me", requireAuth, async (req, res) => {
    try {
      const allowed = ["name", "avgPace", "avgDistance", "photoUrl", "notificationsEnabled", "distanceUnit", "profilePrivacy", "notifRunReminders", "notifFriendRequests", "notifCrewActivity", "notifWeeklySummary", "showRunRoutes", "gender", "appleHealthConnected", "healthConnectConnected"];
      const updates = {};
      for (const key of allowed) {
        if (req.body[key] !== void 0) updates[key] = req.body[key];
      }
      if (updates.gender && !["Man", "Woman", "Prefer not to say"].includes(updates.gender)) {
        return res.status(400).json({ message: "Invalid gender selection" });
      }
      const user = await updateUser(req.session.userId, updates);
      if (!user) return res.status(404).json({ message: "User not found" });
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.delete("/api/users/me", requireAuth, async (req, res) => {
    try {
      await deleteUser(req.session.userId);
      req.session.destroy(() => {
      });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.put("/api/users/me/name", requireAuth, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string") return res.status(400).json({ message: "Name is required" });
      const trimmed = name.trim();
      if (trimmed.length < 2 || trimmed.length > 30) return res.status(400).json({ message: "Name must be 2\u201330 characters" });
      if (!/^[a-zA-Z\s\-']+$/.test(trimmed)) return res.status(400).json({ message: "Name can only contain letters, spaces, hyphens, and apostrophes" });
      const current = await getUserById(req.session.userId);
      if (!current) return res.status(404).json({ message: "User not found" });
      if (current.name_changed_at) {
        const daysSince = (Date.now() - new Date(current.name_changed_at).getTime()) / (1e3 * 60 * 60 * 24);
        if (daysSince < 30) {
          const daysRemaining = Math.ceil(30 - daysSince);
          return res.status(429).json({ message: `You can change your name again in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`, daysRemaining });
        }
      }
      const user = await updateUser(req.session.userId, { name: trimmed, nameChangedAt: /* @__PURE__ */ new Date() });
      if (!user) return res.status(404).json({ message: "User not found" });
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.put("/api/users/me/goals", requireAuth, async (req, res) => {
    try {
      const { monthlyGoal, yearlyGoal, paceGoal } = req.body;
      let parsedPace = void 0;
      if (paceGoal !== void 0) {
        if (paceGoal == null) parsedPace = null;
        else {
          const v = parseFloat(paceGoal);
          if (isNaN(v) || v <= 0) return res.status(400).json({ message: "Invalid pace goal value" });
          parsedPace = v;
        }
      }
      await updateGoals(req.session.userId, monthlyGoal, yearlyGoal, parsedPace);
      const user = await getUserById(req.session.userId);
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/users/me/onboarding", requireAuth, async (req, res) => {
    try {
      const { activityType, monthlyGoal, yearlyGoal } = req.body;
      const activity = ["run", "ride", "walk"].includes(activityType) ? activityType : "run";
      await updateUser(req.session.userId, { defaultActivity: activity, onboardingComplete: true });
      if (monthlyGoal !== void 0 || yearlyGoal !== void 0) {
        const mGoal = monthlyGoal !== void 0 ? parseFloat(monthlyGoal) : void 0;
        const yGoal = yearlyGoal !== void 0 ? parseFloat(yearlyGoal) : void 0;
        await updateGoals(
          req.session.userId,
          mGoal && !isNaN(mGoal) ? mGoal : void 0,
          yGoal && !isNaN(yGoal) ? yGoal : void 0,
          void 0
        );
      }
      const user = await getUserById(req.session.userId);
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/users/me/push-token", requireAuth, async (req, res) => {
    try {
      const { token } = req.body;
      await updatePushToken(req.session.userId, token ?? null);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/users/me/recent-distances", requireAuth, async (req, res) => {
    try {
      const distances = await getUserRecentDistances(req.session.userId);
      res.json(distances);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/users/me/run-records", requireAuth, async (req, res) => {
    try {
      const records = await getUserRunRecords(req.session.userId);
      res.json(records);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/users/me/top-runs", requireAuth, async (req, res) => {
    try {
      const topRuns = await getUserTopRuns(req.session.userId);
      res.json(topRuns);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/users/me/activity-history", requireAuth, async (req, res) => {
    try {
      const { type } = req.query;
      const runs = await getSoloRuns(req.session.userId);
      const filtered = runs.filter((r) => !r.is_deleted && r.completed && (!type || (r.activity_type ?? "run") === type)).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((r) => ({
        date: r.date,
        distance_miles: r.distance_miles,
        duration_seconds: r.duration_seconds,
        move_time_seconds: r.move_time_seconds,
        elevation_gain_ft: r.elevation_gain_ft,
        activity_type: r.activity_type ?? "run"
      }));
      res.json(filtered);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/users/me/achievements", requireAuth, async (req, res) => {
    const achievements = await getUserAchievements(req.session.userId);
    res.json(achievements);
  });
  app2.get("/api/users/me/achievement-stats", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const stats = await getAchievementStats(userId);
      await Promise.all([
        checkAndAwardAchievements(userId, stats.total_miles ?? 0),
        checkFriendAchievements(userId),
        checkAndAwardRideAchievements(userId)
      ]);
      const earnedRows = await getUserAchievements(userId);
      const earned_slugs = earnedRows.map((r) => r.slug).filter(Boolean);
      res.json({ earned_slugs, stats });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app2.get("/api/users/me/unlock-progress", requireAuth, async (req, res) => {
    const progress = await getHostUnlockProgress(req.session.userId);
    res.json(progress);
  });
  app2.get("/api/users/search", requireAuth, async (req, res) => {
    try {
      const q = (req.query.q || "").trim();
      if (!q || q.length < 2) return res.json([]);
      const results = await searchUsers(q, req.session.userId);
      res.json(results);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/users/:id/profile", requireAuth, async (req, res) => {
    try {
      const targetId = req.params.id;
      const requesterId = req.session.userId;
      if (targetId !== requesterId) {
        const blocked = await isBlockedBy(requesterId, targetId);
        if (blocked) return res.status(404).json({ message: "User not found" });
        const privacyRow = await pool.query(
          `SELECT profile_privacy FROM users WHERE id = $1`,
          [targetId]
        );
        if (!privacyRow.rows.length) return res.status(404).json({ message: "User not found" });
        const privacy = privacyRow.rows[0].profile_privacy ?? "public";
        if (privacy === "private") {
          const friendship = await getFriendshipStatus(requesterId, targetId);
          if (friendship.status !== "friends") {
            return res.status(403).json({ message: "This profile is private" });
          }
        }
      }
      const profile = await getPublicUserProfile(targetId);
      if (!profile) return res.status(404).json({ message: "User not found" });
      res.json(profile);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/users/:id/stats", requireAuth, async (req, res) => {
    try {
      const targetId = req.params.id;
      const requesterId = req.session.userId;
      if (targetId !== requesterId) {
        const blocked = await isBlockedBy(requesterId, targetId);
        if (blocked) return res.status(404).json({ message: "User not found" });
        const privacyRow = await pool.query(
          `SELECT profile_privacy FROM users WHERE id = $1`,
          [targetId]
        );
        if (!privacyRow.rows.length) return res.status(404).json({ message: "User not found" });
        const privacy = privacyRow.rows[0].profile_privacy ?? "public";
        if (privacy === "private") {
          const friendship = await getFriendshipStatus(requesterId, targetId);
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
        avg_pace: parseFloat(row?.avg_pace ?? 0)
      });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/users/:id/block-status", requireAuth, async (req, res) => {
    try {
      const targetId = req.params.id;
      const requesterId = req.session.userId;
      if (targetId === requesterId) return res.json({ amBlocking: false, amBlockedBy: false });
      const [amBlocking, amBlockedBy] = await Promise.all([
        isBlocking(requesterId, targetId),
        isBlockedBy(requesterId, targetId)
      ]);
      res.json({ amBlocking, amBlockedBy });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/users/:id/block", requireAuth, async (req, res) => {
    try {
      const targetId = req.params.id;
      const requesterId = req.session.userId;
      if (targetId === requesterId) return res.status(400).json({ message: "Cannot block yourself" });
      await blockUser(requesterId, targetId);
      await pool.query(
        `DELETE FROM friendships WHERE (requester_id = $1 AND recipient_id = $2) OR (requester_id = $2 AND recipient_id = $1)`,
        [requesterId, targetId]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.delete("/api/users/:id/block", requireAuth, async (req, res) => {
    try {
      const targetId = req.params.id;
      await unblockUser(req.session.userId, targetId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/users/:id/friendship", requireAuth, async (req, res) => {
    try {
      if (req.params.id === req.session.userId) return res.json({ status: "self", friendshipId: null });
      const status = await getFriendshipStatus(req.session.userId, req.params.id);
      res.json(status);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/friends", requireAuth, async (req, res) => {
    try {
      const friends = await getFriends(req.session.userId);
      res.json(friends);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/friends/requests", requireAuth, async (req, res) => {
    try {
      const [incoming, sent] = await Promise.all([
        getPendingRequests(req.session.userId),
        getSentRequests(req.session.userId)
      ]);
      res.json({ incoming, sent });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/friends/request", requireAuth, async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ message: "userId required" });
      if (userId === req.session.userId) return res.status(400).json({ message: "Cannot add yourself" });
      const [iBlocked, theyBlocked] = await Promise.all([
        isBlocking(req.session.userId, userId),
        isBlockedBy(req.session.userId, userId)
      ]);
      if (iBlocked || theyBlocked) return res.status(404).json({ message: "User not found" });
      const result = await sendFriendRequest(req.session.userId, userId);
      if (result.error) return res.status(400).json({ message: result.error === "already_friends" ? "Already friends" : "Request already sent" });
      res.json(result.data);
      Promise.all([
        pool.query(`SELECT name FROM users WHERE id = $1`, [req.session.userId]),
        pool.query(`SELECT push_token, notifications_enabled, notif_friend_requests FROM users WHERE id = $1`, [userId])
      ]).then(([senderRes, recipientRes]) => {
        const sender = senderRes.rows[0];
        const recipient = recipientRes.rows[0];
        if (sender && recipient && userWantsNotif(recipient, "friend_requests")) {
          sendPushNotification(
            recipient.push_token,
            "New Friend Request",
            `${sender.name} wants to connect on PaceUp`,
            { screen: "notifications" }
          ).catch((err) => console.error("[push] friend request notification failed:", err?.message ?? err));
        }
      }).catch((err) => console.error("[bg] friend request notification:", err?.message ?? err));
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.put("/api/friends/:id/accept", requireAuth, async (req, res) => {
    try {
      const friendship = await acceptFriendRequest(req.params.id, req.session.userId);
      if (!friendship) return res.status(404).json({ message: "Request not found" });
      checkFriendAchievements(req.session.userId).catch((err) => console.error("[bg]", err?.message ?? err));
      if (friendship.requester_id) {
        checkFriendAchievements(friendship.requester_id).catch((err) => console.error("[bg]", err?.message ?? err));
        Promise.all([
          pool.query(`SELECT name FROM users WHERE id = $1`, [req.session.userId]),
          pool.query(`SELECT push_token, notifications_enabled, notif_friend_requests FROM users WHERE id = $1`, [friendship.requester_id])
        ]).then(([acceptorRes, requesterRes]) => {
          const acceptor = acceptorRes.rows[0];
          const requester = requesterRes.rows[0];
          if (acceptor && requester && userWantsNotif(requester, "friend_requests")) {
            sendPushNotification(
              requester.push_token,
              "Friend Request Accepted",
              `${acceptor.name} accepted your friend request`,
              { screen: "notifications" }
            ).catch((err) => console.error("[push] friend accept notification failed:", err?.message ?? err));
          }
        }).catch((err) => console.error("[bg] friend accept notification:", err?.message ?? err));
      }
      res.json(friendship);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.delete("/api/friends/:id", requireAuth, async (req, res) => {
    try {
      await removeFriend(req.params.id, req.session.userId);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/runs", async (req, res) => {
    try {
      const filters = {};
      const parseFloatGuarded = (val, field) => {
        const n = parseFloat(val);
        if (isNaN(n)) throw Object.assign(new Error(`Invalid numeric value for ${field}`), { status: 400 });
        return n;
      };
      if (req.query.minPace) filters.minPace = parseFloatGuarded(req.query.minPace, "minPace");
      if (req.query.maxPace) filters.maxPace = parseFloatGuarded(req.query.maxPace, "maxPace");
      if (req.query.minDistance) filters.minDistance = parseFloatGuarded(req.query.minDistance, "minDistance");
      if (req.query.maxDistance) filters.maxDistance = parseFloatGuarded(req.query.maxDistance, "maxDistance");
      if (req.query.tag) filters.tag = req.query.tag;
      if (req.query.styles) {
        const raw = req.query.styles;
        filters.styles = raw.split(",").map((s) => s.trim()).filter(Boolean);
      }
      if (req.query.swLat) filters.swLat = parseFloatGuarded(req.query.swLat, "swLat");
      if (req.query.swLng) filters.swLng = parseFloatGuarded(req.query.swLng, "swLng");
      if (req.query.neLat) filters.neLat = parseFloatGuarded(req.query.neLat, "neLat");
      if (req.query.neLng) filters.neLng = parseFloatGuarded(req.query.neLng, "neLng");
      const bounds = filters.swLat !== void 0 && filters.neLat !== void 0 && filters.swLng !== void 0 && filters.neLng !== void 0 ? { swLat: filters.swLat, neLat: filters.neLat, swLng: filters.swLng, neLng: filters.neLng } : void 0;
      const [publicRuns, publicCrewRuns] = await Promise.all([
        getPublicRuns(filters),
        getPublicCrewRuns(bounds)
      ]);
      if (req.session.userId) {
        const [friendLocked, invited, crewRuns, userCrewRows] = await Promise.all([
          getFriendPrivateRuns(req.session.userId, bounds),
          getInvitedPrivateRuns(req.session.userId, bounds),
          getCrewVisibleRuns(req.session.userId, bounds),
          getUserCrewIds(req.session.userId)
        ]);
        const userCrewIds = new Set(userCrewRows.map((r) => r.crew_id));
        const combined = [...publicRuns, ...publicCrewRuns, ...invited, ...friendLocked, ...crewRuns];
        const seen = /* @__PURE__ */ new Set();
        const deduped = combined.filter((r) => {
          if (seen.has(r.id)) return false;
          seen.add(r.id);
          return true;
        });
        deduped.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const annotated = deduped.map((r) => ({ ...r, user_is_crew_member: r.crew_id ? userCrewIds.has(r.crew_id) : true }));
        return res.json(annotated);
      }
      const unauthCombined = [...publicRuns, ...publicCrewRuns];
      const unauthSeen = /* @__PURE__ */ new Set();
      const unauthDeduped = unauthCombined.filter((r) => {
        if (unauthSeen.has(r.id)) return false;
        unauthSeen.add(r.id);
        return true;
      });
      unauthDeduped.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const unauthAnnotated = unauthDeduped.map((r) => ({ ...r, user_is_crew_member: r.crew_id ? false : true }));
      res.json(unauthAnnotated);
    } catch (e) {
      res.status(e.status ?? 500).json({ message: e.message });
    }
  });
  app2.get("/api/users/buddy-suggestions", requireAuth, async (req, res) => {
    try {
      const user = await getUserById(req.session.userId);
      if (!user || !user.gender || user.gender !== "Man" && user.gender !== "Woman") {
        return res.json({ eligible: false, groupRuns: 0, soloRuns: 0, suggestions: [] });
      }
      const eligibility = await getBuddyEligibility(user.id);
      if (!eligibility.eligible) {
        return res.json({ eligible: false, groupRuns: eligibility.groupRuns, soloRuns: eligibility.soloRuns, suggestions: [] });
      }
      const suggestions = await getBuddySuggestions(user.id, user.gender);
      res.json({ eligible: true, groupRuns: eligibility.groupRuns, soloRuns: eligibility.soloRuns, suggestions });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/tts", requireAuth, async (req, res) => {
    try {
      const { text, voice } = req.body;
      if (!text) return res.status(400).json({ message: "Text required" });
      const buffer = await generateTTS(text, voice);
      if (!buffer) return res.status(500).json({ message: "TTS failed" });
      res.set("Content-Type", "audio/mpeg");
      res.send(buffer);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/solo-runs/:id/ai-summary", requireAuth, async (req, res) => {
    try {
      const run = await getSoloRunById(req.params.id);
      if (!run || run.user_id !== req.session.userId) return res.status(404).json({ message: "Run not found" });
      if (run.ai_summary) return res.json({ summary: run.ai_summary });
      const summary = await generateRunSummary(run);
      if (summary) {
        await updateSoloRun(run.id, req.session.userId, { ai_summary: summary });
      }
      res.json({ summary });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/runs/search-ai", requireAuth, async (req, res) => {
    try {
      const { q } = req.body;
      if (!q) return res.status(400).json({ message: "Query required" });
      const filters = await generateSearchFilters(q);
      res.json(filters);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/notifications", requireAuth, async (req, res) => {
    try {
      const data = await getNotifications(req.session.userId);
      const readAtRow = await pool.query(`SELECT notifications_read_at FROM users WHERE id = $1`, [req.session.userId]);
      const lastReadAt = readAtRow.rows[0]?.notifications_read_at ?? null;
      res.json({ items: data, lastReadAt });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/notifications/mark-read", requireAuth, async (req, res) => {
    try {
      await pool.query(`UPDATE users SET notifications_read_at = NOW() WHERE id = $1`, [req.session.userId]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/friends/respond", requireAuth, async (req, res) => {
    try {
      const { friendshipId, action } = req.body;
      if (!friendshipId || !action) return res.status(400).json({ message: "friendshipId and action required" });
      const frRow = action === "accept" ? await pool.query(`SELECT requester_id FROM friends WHERE id = $1 AND addressee_id = $2`, [friendshipId, req.session.userId]) : null;
      await respondToFriendRequest(friendshipId, req.session.userId, action);
      res.json({ success: true });
      if (action === "accept" && frRow?.rows[0]?.requester_id) {
        const requesterId = frRow.rows[0].requester_id;
        Promise.all([
          pool.query(`SELECT name FROM users WHERE id = $1`, [req.session.userId]),
          pool.query(`SELECT push_token, notifications_enabled, notif_friend_requests FROM users WHERE id = $1`, [requesterId])
        ]).then(([acceptorRes, requesterRes]) => {
          const acceptor = acceptorRes.rows[0];
          const requester = requesterRes.rows[0];
          if (acceptor && requester && userWantsNotif(requester, "friend_requests")) {
            sendPushNotification(
              requester.push_token,
              "Friend Request Accepted",
              `${acceptor.name} accepted your friend request`,
              { screen: "notifications" }
            ).catch((err) => console.error("[push] friend accept (v2) notification failed:", err?.message ?? err));
          }
        }).catch((err) => console.error("[bg] friend accept (v2) notification:", err?.message ?? err));
      }
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/users/update-phone", requireAuth, async (req, res) => {
    try {
      const { phoneHash } = req.body;
      if (!phoneHash) return res.status(400).json({ message: "phoneHash required" });
      if (typeof phoneHash !== "string" || !/^[a-f0-9]{64}$/.test(phoneHash)) {
        return res.status(400).json({ message: "Invalid phone hash format" });
      }
      await pool.query(`UPDATE users SET phone_hash = $1 WHERE id = $2`, [phoneHash, req.session.userId]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/users/find-by-contacts", requireAuth, async (req, res) => {
    try {
      const { phoneHashes } = req.body;
      if (!Array.isArray(phoneHashes) || phoneHashes.length === 0)
        return res.status(400).json({ message: "phoneHashes array required" });
      const SHA256_RE = /^[0-9a-f]{64}$/i;
      const limited = phoneHashes.filter((h) => typeof h === "string" && SHA256_RE.test(h)).slice(0, 5e3);
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
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/auth/facebook/start", requireAuth, (req, res) => {
    const appId = process.env.FACEBOOK_APP_ID;
    if (!appId) return res.status(501).json({ message: "Facebook integration not configured" });
    const nonce = crypto.randomBytes(24).toString("hex");
    req.session.fbOauthState = nonce;
    req.session.fbOauthUserId = req.session.userId;
    req.session.save(() => {
      const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/facebook/callback`;
      const scope = "public_profile,user_friends";
      const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${nonce}&response_type=code`;
      res.json({ url });
    });
  });
  app2.get("/api/auth/facebook/callback", async (req, res) => {
    try {
      const { code, state } = req.query;
      if (!code || !state) return res.status(400).send("Missing code or state");
      const storedState = req.session.fbOauthState;
      const storedUserId = req.session.fbOauthUserId;
      if (!storedState || storedState !== state || !storedUserId) return res.status(403).send("Invalid OAuth state");
      delete req.session.fbOauthState;
      delete req.session.fbOauthUserId;
      const appId = process.env.FACEBOOK_APP_ID;
      const appSecret = process.env.FACEBOOK_APP_SECRET;
      if (!appId || !appSecret) return res.status(501).send("Facebook not configured");
      const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/facebook/callback`;
      const fbTimeout = () => AbortSignal.timeout(1e4);
      const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`, { signal: fbTimeout() });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) return res.status(400).send("Failed to get access token");
      const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${tokenData.access_token}`, { signal: fbTimeout() });
      const me = await meRes.json();
      if (me.id) {
        await pool.query(`UPDATE users SET facebook_id = $1 WHERE id = $2`, [me.id, storedUserId]);
        try {
          const friendsRes = await fetch(`https://graph.facebook.com/v19.0/me/friends?fields=id&limit=5000&access_token=${tokenData.access_token}`, { signal: fbTimeout() });
          const friendsData = await friendsRes.json();
          if (friendsData.data && Array.isArray(friendsData.data) && friendsData.data.length > 0) {
            await pool.query(`DELETE FROM facebook_friends WHERE user_id = $1`, [storedUserId]);
            const friendIds = friendsData.data.map((f) => f.id).filter(Boolean);
            if (friendIds.length > 0) {
              const values = friendIds.map((_, i) => `($1, $${i + 2})`).join(", ");
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
    } catch (e) {
      res.status(500).send("Facebook auth error: " + e.message);
    }
  });
  app2.delete("/api/auth/facebook/disconnect", requireAuth, async (req, res) => {
    try {
      await pool.query(`DELETE FROM facebook_friends WHERE user_id = $1`, [req.session.userId]);
      await pool.query(`UPDATE users SET facebook_id = NULL WHERE id = $1`, [req.session.userId]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/friends/facebook-suggestions", requireAuth, async (req, res) => {
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
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/crews/invites/respond", requireAuth, async (req, res) => {
    try {
      const { crewId, action } = req.body;
      if (!crewId || !action) return res.status(400).json({ message: "crewId and action required" });
      await respondToCrewInvite(crewId, req.session.userId, action);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/runs/requests/respond", requireAuth, async (req, res) => {
    try {
      const { participantId, action, runId } = req.body;
      if (!participantId || !action) return res.status(400).json({ message: "participantId and action required" });
      await respondToJoinRequest(participantId, req.session.userId, action);
      res.json({ success: true });
      if (runId) {
        Promise.all([getRunById(runId), getParticipantById(participantId)]).then(([run, participant]) => {
          if (!run || !participant) return;
          getUserById(participant.user_id).then((requester) => {
            if (!requester?.push_token) return;
            const actLabel = run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run";
            if (action === "approve") {
              sendPushNotification(requester.push_token, `You're in! \u{1F389}`, `Your request to join "${run.title}" was approved`, { runId });
            } else {
              sendPushNotification(requester.push_token, `Request declined`, `Your request to join "${run.title}" was not accepted`, { runId });
            }
          }).catch((err) => console.error("[bg]", err?.message ?? err));
        }).catch((err) => console.error("[bg]", err?.message ?? err));
      }
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/runs/mine", requireAuth, async (req, res) => {
    try {
      const runs = await getUserRuns(req.session.userId);
      res.json(runs);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/users/:id/starred-runs", requireAuth, async (req, res) => {
    try {
      const runs = await getStarredRunsForUser(req.params.id, 3);
      res.json(runs);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/runs", requireAuth, async (req, res) => {
    try {
      const host = await getUserById(req.session.userId);
      if (host && host.rating_count >= 5 && parseFloat(host.avg_rating ?? "5") < 3.5) {
        return res.status(403).json({
          message: "Your host rating is below the minimum required to host new runs. Attend runs as a participant \u2014 your rating may recover over time."
        });
      }
      const minDist = parseFloat(req.body.minDistance ?? req.body.min_distance ?? 0);
      const maxDist = parseFloat(req.body.maxDistance ?? req.body.max_distance ?? 0);
      if (minDist < 0 || maxDist < 0) return res.status(400).json({ message: "Distance values must be positive" });
      if (maxDist > 0 && minDist > maxDist) return res.status(400).json({ message: "Minimum distance cannot exceed maximum distance" });
      const run = await createRun({ ...req.body, hostId: req.session.userId, savedPathId: req.body.savedPathId || null });
      res.status(201).json(run);
      if (run.crew_id) {
        (() => {
          const runDate = new Date(run.date);
          const dayStr = runDate.toLocaleDateString("en-US", { weekday: "long" });
          const timeStr = runDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
          const actLabel = run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run";
          const promptMsg = `\u{1F4C5} ${run.title} scheduled for ${dayStr} at ${timeStr}. Who's joining this ${actLabel}?`;
          createCrewMessage(
            run.crew_id,
            req.session.userId,
            host?.name ?? "Host",
            host?.photo_url ?? null,
            promptMsg,
            "prompt",
            { runId: run.id, quickReplies: ["I'm in! \u{1F4AA}", "Maybe \u{1F914}", "Can't make it \u{1F614}"] }
          ).catch((err) => console.error("[bg]", err?.message ?? err));
        })();
        getCrewMemberPushTokensFiltered(run.crew_id, "notif_crew_activity").then((tokens) => {
          if (tokens.length) {
            const actLabel = run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run";
            sendPushNotification(
              tokens,
              `New crew ${actLabel} scheduled \u{1F3C3}`,
              `${host?.name ?? host?.username ?? "A member"} posted "${run.title}" for your crew`,
              { runId: run.id }
            );
          }
        }).catch((err) => console.error("[bg]", err?.message ?? err));
      } else {
        getFriendsWithPushTokensFiltered(req.session.userId, "notif_run_reminders").then((tokens) => {
          if (tokens.length) {
            const actLabel = run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run";
            const actEmoji = run.activity_type === "ride" ? "\u{1F6B4}" : run.activity_type === "walk" ? "\u{1F6B6}" : "\u{1F3C3}";
            const minDist2 = parseFloat(run.min_distance ?? 0);
            const maxDist2 = parseFloat(run.max_distance ?? 0);
            let distStr = "";
            if (minDist2 > 0 && maxDist2 > 0 && minDist2 !== maxDist2) {
              distStr = ` ${minDist2}\u2013${maxDist2} mi`;
            } else if (maxDist2 > 0) {
              distStr = ` ${maxDist2} mi`;
            } else if (minDist2 > 0) {
              distStr = ` ${minDist2} mi`;
            }
            const runDate = run.date ? new Date(run.date) : null;
            let timeStr = "";
            if (runDate && !isNaN(runDate.getTime())) {
              const time = runDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
              const date = runDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
              timeStr = ` at ${time} on ${date}`;
            }
            const displayName = host?.username ? `@${host.username}` : host?.name ?? "A friend";
            sendPushNotification(
              tokens,
              `${actEmoji} ${displayName} posted a${distStr} ${actLabel}`,
              `${timeStr ? `Scheduled${timeStr}` : run.title} \u2014 join them!`,
              { runId: run.id, screen: "run", type: "friend_run_posted" }
            );
          }
        }).catch((err) => console.error("[bg]", err?.message ?? err));
      }
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/community-paths", async (req, res) => {
    try {
      const bounds = req.query.swLat && req.query.neLat && req.query.swLng && req.query.neLng ? {
        swLat: parseFloat(req.query.swLat),
        neLat: parseFloat(req.query.neLat),
        swLng: parseFloat(req.query.swLng),
        neLng: parseFloat(req.query.neLng)
      } : void 0;
      const paths = await getCommunityPaths(bounds);
      res.json(paths);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/solo-runs/:id/publish-route", requireAuth, async (req, res) => {
    try {
      const { routeName } = req.body;
      if (!routeName) return res.status(400).json({ message: "routeName required" });
      const path2 = await publishSoloRunRoute(req.params.id, req.session.userId, routeName);
      res.json(path2);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/crew-chat/has-new", requireAuth, async (req, res) => {
    try {
      const since = req.query.since;
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
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/crews/:id/messages", requireAuth, async (req, res) => {
    try {
      const crewId = req.params.id;
      const userId = req.session.userId;
      const isMember = await isCrewMember(crewId, userId);
      if (!isMember) return res.status(403).json({ message: "Not a crew member" });
      const limit = parseInt(req.query.limit) || 50;
      const messages = await getCrewMessages(crewId, limit);
      res.json(messages);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/crews/:id/messages", requireAuth, async (req, res) => {
    try {
      const crewId = req.params.id;
      const userId = req.session.userId;
      const isMember = await isCrewMember(crewId, userId);
      if (!isMember) return res.status(403).json({ message: "Not a crew member" });
      const { message = "", gif_url, gif_preview_url } = req.body;
      if (!message && !gif_url) return res.status(400).json({ message: "Message or GIF required" });
      const user = await getUserById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      const messageType = gif_url ? "gif" : "text";
      const metadata = gif_url ? { gif_url, gif_preview_url } : void 0;
      const newMessage = await createCrewMessage(
        crewId,
        userId,
        user.name,
        user.photo_url,
        message || "",
        messageType,
        metadata
      );
      res.status(201).json(newMessage);
      (async () => {
        try {
          const crew = await pool.query(`SELECT name FROM crews WHERE id = $1`, [crewId]);
          const crewName = crew.rows[0]?.name ?? "Crew";
          const tokensRes = await pool.query(
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
          const tokens = tokensRes.rows.map((r) => r.push_token);
          if (tokens.length > 0) {
            const preview = gif_url ? "Sent a GIF \u{1F3AC}" : message.length > 60 ? message.slice(0, 57) + "\u2026" : message;
            sendPushNotification(tokens, `${user.name} \xB7 ${crewName}`, preview, { crewId });
          }
        } catch (err) {
          console.error("[crew-chat-notif]", err?.message ?? err);
        }
      })();
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/runs/invite/:token", async (req, res) => {
    try {
      const run = await getRunByInviteToken(req.params.token.toUpperCase());
      if (!run) return res.status(404).json({ message: "Invalid invite code" });
      if (req.session.userId) {
        await grantRunAccess(run.id, req.session.userId);
      }
      res.json({ runId: run.id, title: run.title, hostName: run.host_name });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/runs/:id/messages", requireAuth, async (req, res) => {
    try {
      const runId = req.params.id;
      const userId = req.session.userId;
      const isParticipant2 = await isRunParticipant(runId, userId);
      const run = await getRunById(runId);
      const isHost = run?.host_id === userId;
      if (!isParticipant2 && !isHost) {
        return res.status(403).json({ message: "Only participants can view messages" });
      }
      const limit = parseInt(req.query.limit) || 50;
      const messages = await getRunMessages(runId, limit);
      res.json(messages);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/messages", requireAuth, async (req, res) => {
    try {
      const runId = req.params.id;
      const userId = req.session.userId;
      const { message } = req.body;
      if (!message) return res.status(400).json({ message: "Message is required" });
      const isParticipant2 = await isRunParticipant(runId, userId);
      const run = await getRunById(runId);
      const isHost = run?.host_id === userId;
      if (!isParticipant2 && !isHost) {
        return res.status(403).json({ message: "Only participants can send messages" });
      }
      const user = await getUserById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      const newMessage = await createRunMessage(
        runId,
        userId,
        user.name,
        user.photo_url,
        message
      );
      res.json(newMessage);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/runs/:id/access", requireAuth, async (req, res) => {
    try {
      const run = await getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.privacy !== "private") return res.json({ hasAccess: true });
      const hasAccess = await hasRunAccess(req.params.id, req.session.userId);
      res.json({ hasAccess, hasPassword: !!run.invite_password });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/join-private", requireAuth, async (req, res) => {
    try {
      const { password, token } = req.body;
      const result = await verifyAndJoinPrivateRun(req.params.id, req.session.userId, password, token);
      if (result.error) {
        if (result.error === "run_not_found") return res.status(404).json({ message: "Run not found" });
        return res.status(403).json({ message: "Incorrect password or invite code" });
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/invite", requireAuth, async (req, res) => {
    try {
      const { friendId } = req.body;
      const run = await getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id !== req.session.userId) return res.status(403).json({ message: "Only host can invite" });
      await inviteToRun(req.params.id, friendId, req.session.userId);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/runs/planned", requireAuth, async (req, res) => {
    try {
      const runs = await getPlannedRuns(req.session.userId);
      res.json(runs);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/runs/bookmarked", requireAuth, async (req, res) => {
    try {
      const runs = await getBookmarkedRuns(req.session.userId);
      res.json(runs);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/runs/:id/status", requireAuth, async (req, res) => {
    try {
      const status = await getRunStatus(req.session.userId, req.params.id);
      res.json(status);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/bookmark", requireAuth, async (req, res) => {
    try {
      const run = await getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      const result = await toggleBookmark(req.session.userId, req.params.id);
      res.json(result);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/plan", requireAuth, async (req, res) => {
    try {
      const run = await getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id === req.session.userId) return res.status(400).json({ message: "You are the host" });
      const result = await togglePlan(req.session.userId, req.params.id);
      res.json(result);
      if (result.planned) {
        getUserById(run.host_id).then(async (host) => {
          if (host && userWantsNotif(host, "run_reminders")) {
            const planner = await getUserById(req.session.userId);
            sendPushNotification(
              host.push_token,
              `Someone plans to ${run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run"} with you \u{1F4C5}`,
              `${planner?.name ?? "Someone"} is planning to join "${run.title}"`,
              { runId: run.id }
            ).catch((err) => console.error("[push] plan notification failed:", err?.message ?? err));
          }
        }).catch((err) => console.error("[bg]", err?.message ?? err));
      }
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/runs/community-activity", async (_req, res) => {
    try {
      const runs = await getRecentCommunityActivity();
      res.json({ runs });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/runs/:id", async (req, res) => {
    try {
      const run = await getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.crew_id) {
        if (!req.session.userId) return res.status(403).json({ message: "Crew run \u2014 members only", isCrewRun: true });
        if (run.host_id !== req.session.userId) {
          const member = await isCrewMember(run.crew_id, req.session.userId);
          if (!member) return res.status(403).json({ message: "Crew run \u2014 members only", isCrewRun: true });
        }
      } else if (run.privacy === "friends") {
        if (!req.session.userId) return res.status(403).json({ message: "Friends only run", isFriendsOnly: true });
        if (run.host_id !== req.session.userId) {
          const friends = await areFriends(req.session.userId, run.host_id);
          if (!friends) return res.status(403).json({ message: "Friends only run", isFriendsOnly: true });
        }
      } else if (run.privacy === "private") {
        if (!req.session.userId) return res.status(403).json({ message: "Private run", isPrivate: true });
        const hasAccess = await hasRunAccess(req.params.id, req.session.userId);
        if (!hasAccess) {
          return res.status(403).json({
            message: "Private run",
            isPrivate: true,
            hasPassword: !!run.invite_password,
            hostName: run.host_name,
            title: run.title
          });
        }
      }
      res.json(run);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/runs/:id/participants", async (req, res) => {
    const participants = await getRunParticipants(req.params.id);
    res.json(participants);
  });
  app2.post("/api/runs/:id/join", requireAuth, async (req, res) => {
    try {
      const run = await getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id === req.session.userId) return res.status(400).json({ message: "You are the host" });
      const user = await getUserById(req.session.userId);
      if (run.is_strict) {
        const paceOk = user.avg_pace >= run.min_pace && user.avg_pace <= run.max_pace;
        const recentDistances = await getUserRecentDistances(req.session.userId);
        if (recentDistances.length > 0) {
          const distOk = recentDistances.some((d) => d >= run.min_distance * 0.7);
          if (!paceOk && !distOk) {
            return res.status(400).json({ message: `Strict run: your pace (${user.avg_pace} min/mi) doesn't match and no recent run covers 70%+ of the ${run.min_distance} mi distance` });
          }
          if (!paceOk) {
            return res.status(400).json({ message: `Strict run: your pace (${user.avg_pace} min/mi) must be between ${run.min_pace}\u2013${run.max_pace} min/mi` });
          }
          if (!distOk) {
            return res.status(400).json({ message: `Strict run: you need at least one recent run covering 70%+ of the planned ${run.min_distance} mi distance` });
          }
        }
      }
      const runDate = new Date(run.date);
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1e3);
      if (runDate < twoHoursAgo) {
        return res.status(400).json({ message: "This event has already taken place" });
      }
      const paceGroupLabel = req.body.paceGroupLabel ?? null;
      let participant;
      try {
        participant = await joinRun(req.params.id, req.session.userId, paceGroupLabel);
      } catch (joinErr) {
        if (joinErr.message === "EVENT_FULL") {
          return res.status(409).json({ message: "This event is full" });
        }
        throw joinErr;
      }
      res.json(participant);
      getUserById(run.host_id).then((host) => {
        if (host && userWantsNotif(host, "run_reminders")) {
          sendPushNotification(
            host.push_token,
            `Someone joined your ${run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run"} \u{1F389}`,
            `${user.name} joined "${run.title}"`,
            { runId: run.id }
          ).catch((err) => console.error("[push] join notification failed:", err?.message ?? err));
        }
      }).catch((err) => console.error("[bg]", err?.message ?? err));
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.patch("/api/runs/:id/pace-group", requireAuth, async (req, res) => {
    try {
      const { paceGroupLabel } = req.body;
      if (!paceGroupLabel) return res.status(400).json({ message: "paceGroupLabel required" });
      await joinRun(req.params.id, req.session.userId, paceGroupLabel);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/request-join", requireAuth, async (req, res) => {
    try {
      const run = await getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id === req.session.userId) return res.status(400).json({ message: "You are the host" });
      const runDate = new Date(run.date);
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1e3);
      if (runDate < twoHoursAgo) return res.status(400).json({ message: "This event has already taken place" });
      const participantCount = await getRunParticipantCount(req.params.id);
      if (participantCount < run.max_participants) {
        return res.status(400).json({ message: "This event is not full \u2014 you can join directly" });
      }
      const result = await requestJoinRun(req.params.id, req.session.userId);
      if (result.alreadyExists && result.row.status !== "cancelled") {
        return res.status(400).json({ message: result.row.status === "pending" ? "already_requested" : "already_joined" });
      }
      res.json({ success: true, participantId: result.row.id });
      getUserById(req.session.userId).then((user) => {
        if (!user) return;
        getUserById(run.host_id).then((host) => {
          if (host && userWantsNotif(host, "run_reminders")) {
            sendPushNotification(
              host.push_token,
              `Join request for your full ${run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run"}`,
              `${user.name} wants to join "${run.title}"`,
              { runId: run.id }
            );
          }
        }).catch((err) => console.error("[bg]", err?.message ?? err));
      }).catch((err) => console.error("[bg]", err?.message ?? err));
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/leave", requireAuth, async (req, res) => {
    try {
      const prior = await getParticipantStatus(req.params.id, req.session.userId);
      await leaveRun(req.params.id, req.session.userId);
      if (prior === "confirmed") {
        await decrementCompletedRuns(req.session.userId);
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.patch("/api/runs/:id", requireAuth, async (req, res) => {
    try {
      const { date } = req.body;
      if (!date) return res.status(400).json({ message: "date is required" });
      const updated = await updateRunDateTime(req.params.id, req.session.userId, date);
      const tokens = await getRunBroadcastTokens(req.params.id);
      if (tokens.length) {
        const newDate = new Date(updated.date);
        const label = `${newDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${newDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
        sendPushNotification(
          tokens,
          "Run time updated \u23F0",
          `"${updated.title}" has been rescheduled to ${label}`,
          { runId: req.params.id }
        );
      }
      res.json(updated);
    } catch (e) {
      res.status(e.message.includes("Only the host") ? 403 : 500).json({ message: e.message });
    }
  });
  app2.delete("/api/runs/:id", requireAuth, async (req, res) => {
    try {
      const result = await cancelRun(req.params.id, req.session.userId);
      getRunBroadcastTokens(req.params.id).then((broadcastTokens) => {
        if (broadcastTokens.length) {
          sendPushNotification(
            broadcastTokens,
            "Run cancelled \u274C",
            `"${result.title}" has been cancelled by the host`,
            {}
          );
        }
      }).catch((err) => console.error("[bg]", err?.message ?? err));
      res.json({ success: true });
    } catch (e) {
      res.status(e.message.includes("Only the host") ? 403 : 500).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/broadcast", requireAuth, async (req, res) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ message: "Message is required" });
      }
      if (message.trim().length > 280) {
        return res.status(400).json({ message: "Message must be 280 characters or less" });
      }
      const run = await getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id !== req.session.userId) {
        return res.status(403).json({ message: "Only the host can send messages to participants" });
      }
      const tokens = await getRunBroadcastTokens(req.params.id);
      if (tokens.length) {
        sendPushNotification(tokens, `${run.title}`, message.trim(), { runId: req.params.id });
      }
      res.json({ sent: tokens.length });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/complete", requireAuth, async (req, res) => {
    try {
      const { milesLogged } = req.body;
      const miles = parseFloat(milesLogged);
      if (!isFinite(miles) || miles <= 0) {
        return res.status(400).json({ message: "Miles logged must be a positive number" });
      }
      const result = await confirmRunCompletion(req.params.id, req.session.userId, miles);
      res.json({ success: result.success });
      const completerId = req.session.userId;
      const completionMiles = miles;
      const completionRunId = req.params.id;
      (async () => {
        try {
          const run = await getRunById(completionRunId);
          const hostId = run?.host_id;
          const [user, finisherCrews, hostCrews] = await Promise.all([
            getUserById(completerId),
            getUserCrewIds(completerId),
            hostId && hostId !== completerId ? getUserCrewIds(hostId) : Promise.resolve([])
          ]);
          if (!user) return;
          const allCrewIdSet = /* @__PURE__ */ new Set([
            ...finisherCrews.map((r) => r.crew_id),
            ...hostCrews.map((r) => r.crew_id)
          ]);
          if (!allCrewIdSet.size) return;
          const firstName = user.name?.split(" ")[0] || user.name || "Someone";
          const activityType = run?.activity_type ?? "run";
          const aiMessage = await generateSoloActivityPost(
            firstName,
            completionMiles,
            null,
            null,
            activityType
          );
          const metadata = {
            distance: completionMiles,
            pace: null,
            activityType,
            runId: completionRunId,
            isGroupRun: true
          };
          for (const crewId of allCrewIdSet) {
            await createCrewMessage(
              crewId,
              completerId,
              user.name,
              user.profilePhoto || null,
              aiMessage,
              "solo_activity",
              metadata
            );
          }
        } catch (bgErr) {
          console.error("[crew-complete-fanout]", bgErr?.message ?? bgErr);
        }
      })();
      if (result.crewStreakUpdated) {
        const runId = req.params.id;
        const { crewId, newStreak } = result.crewStreakUpdated;
        (async () => {
          try {
            const run = await getRunById(runId);
            const crew = await getCrewById(crewId);
            if (!run || !crew) return;
            const milestones = [4, 8, 12, 26, 52];
            if (milestones.includes(newStreak)) {
              const recap = await generateCrewRecap(
                crew.name,
                run.title,
                (await getRunParticipants(run.id)).length,
                run.min_pace != null && run.max_pace != null ? ((run.min_pace + run.max_pace) / 2).toFixed(2) : "0"
              );
              await createCrewMessage(
                crewId,
                "system",
                "PaceUp Bot",
                null,
                `\u{1F525} ${newStreak} WEEK STREAK! ${recap || "This crew is on fire!"}`,
                "milestone"
              );
            }
            const rankings = await getCrewRankings("national");
            const crewRankIdx = rankings.findIndex((r) => r.id === crewId);
            const crewRank = crewRankIdx === -1 ? 0 : crewRankIdx + 1;
            if (crewRank > 1 && crewRank < rankings.length) {
              const overtaken = rankings[crewRank];
              if (overtaken && overtaken.id !== crewId) {
                const nowMs = Date.now();
                const lastNotif = overtaken.last_overtake_notif_at ? new Date(overtaken.last_overtake_notif_at).getTime() : 0;
                if (nowMs - lastNotif > 60 * 60 * 1e3) {
                  await createCrewMessage(
                    overtaken.id,
                    "system",
                    "PaceUp Bot",
                    null,
                    `\u26A0\uFE0F ${crew.name} just took your #${crewRank} spot \u2014 take it back!`,
                    "milestone"
                  );
                  await updateCrew(overtaken.id, { last_overtake_notif_at: /* @__PURE__ */ new Date() });
                }
              }
            }
          } catch (bgErr) {
            console.error("[bg] crew streak side-effects:", bgErr?.message ?? bgErr);
          }
        })();
      }
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/runs/:id/my-rating", requireAuth, async (req, res) => {
    const rating = await getUserRatingForRun(req.params.id, req.session.userId);
    res.json(rating);
  });
  app2.post("/api/runs/:id/rate", requireAuth, async (req, res) => {
    try {
      const run = await getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      const participated = await isParticipant(req.params.id, req.session.userId);
      if (!participated && run.host_id !== req.session.userId) {
        return res.status(403).json({ message: "Only participants can rate" });
      }
      const { stars, tags } = req.body;
      if (!stars || stars < 1 || stars > 5) return res.status(400).json({ message: "Stars must be 1-5" });
      const result = await rateHost({ runId: req.params.id, hostId: run.host_id, raterId: req.session.userId, stars, tags: tags || [] });
      res.json(result);
    } catch (e) {
      if (e.message === "Already rated this run") return res.status(400).json({ message: e.message });
      res.status(500).json({ message: e.message });
    }
  });
  app2.patch("/api/users/me/marker-icon", requireAuth, async (req, res) => {
    try {
      const { icon } = req.body;
      await updateMarkerIcon(req.session.userId, icon ?? null);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/solo-runs", requireAuth, async (req, res) => {
    try {
      const runs = await getSoloRuns(req.session.userId);
      res.json(runs);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/solo-runs/starred", requireAuth, async (req, res) => {
    try {
      const runs = await getStarredSoloRuns(req.session.userId);
      res.json(runs);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/solo-runs/achievements", requireAuth, async (req, res) => {
    try {
      const achievements = await getSoloRunAchievements(req.session.userId);
      res.json(achievements);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.patch("/api/solo-runs/:id/star", requireAuth, async (req, res) => {
    try {
      const run = await toggleStarSoloRun(req.params.id, req.session.userId);
      if (!run) return res.status(404).json({ message: "Run not found" });
      res.json(run);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/solo-runs", requireAuth, async (req, res) => {
    try {
      const { title, date, distanceMiles, paceMinPerMile, durationSeconds, completed, planned, notes, routePath, activityType, savedPathId, mileSplits, elevationGainFt, stepCount, moveTimeSeconds } = req.body;
      if (!date || !distanceMiles) return res.status(400).json({ message: "date and distanceMiles required" });
      const parsedDist = parseFloat(distanceMiles);
      const parsedPace = paceMinPerMile ? parseFloat(paceMinPerMile) : null;
      const run = await createSoloRun({
        userId: req.session.userId,
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
        moveTimeSeconds: moveTimeSeconds != null ? parseInt(moveTimeSeconds) : null
      });
      let prTiers = { distanceTier: null, paceTier: null };
      if (completed) {
        try {
          prTiers = await getSoloRunPrTiers(req.session.userId, run.id);
        } catch (_) {
        }
        recomputeUserAvgPace(req.session.userId).catch((err) => console.error("[bg]", err?.message ?? err));
      }
      res.status(201).json({ ...run, prTiers });
      if (completed) {
        const resolvedUserId = req.session.userId;
        const resolvedActivity = activityType === "ride" ? "ride" : activityType === "walk" ? "walk" : "run";
        const resolvedDist = parsedDist;
        const resolvedPace = parsedPace;
        const resolvedDuration = durationSeconds ? parseInt(durationSeconds) : null;
        const resolvedRunId = run.id;
        (async () => {
          try {
            const [user, crewRows, prCtx] = await Promise.all([
              getUserById(resolvedUserId),
              getUserCrewIds(resolvedUserId),
              getUserPrContext(resolvedUserId, resolvedRunId)
            ]);
            if (!user || !crewRows.length) return;
            const firstName = user.name?.split(" ")[0] || user.name || "Someone";
            const isLongest = prCtx.maxDistance != null ? resolvedDist > prCtx.maxDistance : prCtx.totalRuns === 0;
            const isBestPace = resolvedPace != null && prCtx.bestPace != null ? resolvedPace < prCtx.bestPace : false;
            const aiMessage = await generateSoloActivityPost(
              firstName,
              resolvedDist,
              resolvedPace,
              resolvedDuration,
              resolvedActivity,
              { isLongest, isBestPace, totalRuns: prCtx.totalRuns + 1 }
            );
            const metadata = {
              distance: resolvedDist,
              pace: resolvedPace,
              duration: resolvedDuration,
              activityType: resolvedActivity,
              runId: resolvedRunId
            };
            for (const { crew_id } of crewRows) {
              await createCrewMessage(
                crew_id,
                resolvedUserId,
                user.name,
                user.profilePhoto || null,
                aiMessage,
                "solo_activity",
                metadata
              );
            }
          } catch (err) {
            console.error("[crew-activity]", err?.message ?? err);
          }
        })();
      }
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/solo-runs/:id/pr-tiers", requireAuth, async (req, res) => {
    try {
      const tiers = await getSoloRunPrTiers(req.session.userId, req.params.id);
      res.json(tiers);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.put("/api/solo-runs/:id", requireAuth, async (req, res) => {
    try {
      const run = await updateSoloRun(req.params.id, req.session.userId, req.body);
      if (!run) return res.status(404).json({ message: "Run not found" });
      res.json(run);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.delete("/api/solo-runs/:id", requireAuth, async (req, res) => {
    try {
      await deleteSoloRun(req.params.id, req.session.userId);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.put("/api/users/me/solo-goals", requireAuth, async (req, res) => {
    try {
      const { paceGoal, distanceGoal, goalPeriod } = req.body;
      await updateSoloGoals(
        req.session.userId,
        paceGoal != null ? parseFloat(paceGoal) : null,
        parseFloat(distanceGoal) || 100,
        goalPeriod || "monthly"
      );
      const user = await getUserById(req.session.userId);
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/upload/photo", requireAuth, upload.single("photo"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No photo provided" });
      const ext = validateUploadExtension(req.file.originalname);
      if (!ext) {
        return res.status(400).json({ message: "Invalid file type. Only jpg, jpeg, png, gif, webp, and heic are allowed." });
      }
      const filename = `${req.session.userId}-${Date.now()}.${ext}`;
      const url = await uploadPhotoBuffer(req.file.buffer, filename, req.file.mimetype);
      res.json({ url });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get(/^\/api\/objects\/(.+)$/, async (req, res) => {
    try {
      const objectPath = req.params[0];
      const { stream, contentType } = await streamObject(objectPath);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=31536000");
      stream.pipe(res);
      stream.on("error", () => res.status(404).json({ message: "Not found" }));
    } catch (e) {
      res.status(404).json({ message: "Not found" });
    }
  });
  app2.post("/api/runs/:id/start", requireAuth, async (req, res) => {
    try {
      const run = await startGroupRun(req.params.id, req.session.userId);
      res.json(run);
      const verb = run.activity_type === "ride" ? "Ride" : run.activity_type === "walk" ? "Walk" : "Run";
      Promise.all([
        getRunPresentParticipantTokensFiltered(req.params.id, "notif_run_reminders"),
        getRunParticipantTokensFiltered(req.params.id, "notif_run_reminders")
      ]).then(([presentTokens, allTokens]) => {
        const presentSet = new Set(presentTokens);
        const nonPresentTokens = allTokens.filter((t) => !presentSet.has(t));
        if (presentTokens.length) {
          sendPushNotification(
            presentTokens,
            `${verb} is starting \u2014 tracking on! \u{1F3C3}`,
            run.title,
            { type: "run_started_present", screen: "run-live", runId: req.params.id }
          );
        }
        if (nonPresentTokens.length) {
          sendPushNotification(
            nonPresentTokens,
            `${verb} has started \u2014 Let's go! \u{1F680}`,
            run.title,
            { screen: "run-live", runId: req.params.id }
          );
        }
      }).catch((err) => console.error("[bg]", err?.message ?? err));
    } catch (e) {
      const status = e.message === "Only the host can start the run" ? 403 : e.message === "Run already started" ? 409 : 500;
      res.status(status).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/ping", requireAuth, async (req, res) => {
    try {
      const { latitude, longitude, cumulativeDistance = 0, pace = 0 } = req.body;
      if (latitude == null || longitude == null) return res.status(400).json({ message: "latitude and longitude required" });
      const result = await pingRunLocation(
        req.params.id,
        req.session.userId,
        parseFloat(latitude),
        parseFloat(longitude),
        parseFloat(cumulativeDistance),
        parseFloat(pace)
      );
      res.json(result);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/runs/:id/live", async (req, res) => {
    try {
      const state = await getLiveRunState(req.params.id);
      if (!state) return res.status(404).json({ message: "Run not found" });
      res.json(state);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/runs/:id/host-route", async (req, res) => {
    try {
      const path2 = await getHostRoutePath(req.params.id);
      res.json(path2);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/runs/:id/tracking-path", async (req, res) => {
    try {
      const points = await getHostRoutePath(req.params.id);
      res.json({ path: points });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/runner-finish", requireAuth, async (req, res) => {
    try {
      const { finalDistance, finalPace, mileSplits } = req.body;
      if (finalDistance == null || finalPace == null) return res.status(400).json({ message: "finalDistance and finalPace required" });
      const parsedDist = parseFloat(finalDistance);
      const parsedPace = parseFloat(finalPace);
      const safeDist = Number.isFinite(parsedDist) && parsedDist > 0 ? parsedDist : 0;
      const safePace = Number.isFinite(parsedPace) && parsedPace > 0 ? parsedPace : 0;
      const safeSplits = Array.isArray(mileSplits) && mileSplits.length > 0 ? mileSplits : null;
      const result = await finishRunnerRun(
        req.params.id,
        req.session.userId,
        safeDist,
        safePace,
        safeSplits
      );
      res.json({ success: result.success });
      const runIdForBg = req.params.id;
      const finisherUserId = req.session.userId;
      const finisherDist = safeDist;
      const finisherPace = safePace;
      getRunById(runIdForBg).then((run) => {
        if (run?.crew_id) {
          checkAndAwardCrewAchievements(run.crew_id).catch((err) => console.error("[bg]", err?.message ?? err));
        }
      }).catch((err) => console.error("[bg]", err?.message ?? err));
      if (result.shouldComplete) {
        postCrewRunRecap(runIdForBg).catch(
          (bgErr) => console.error("[bg] crew recap (runner-finish):", bgErr?.message ?? bgErr)
        );
      }
      if (finisherDist > 0) {
        (async () => {
          try {
            const run = await getRunById(runIdForBg);
            const hostId = run?.host_id;
            const [user, finisherCrews, hostCrews] = await Promise.all([
              getUserById(finisherUserId),
              getUserCrewIds(finisherUserId),
              hostId && hostId !== finisherUserId ? getUserCrewIds(hostId) : Promise.resolve([])
            ]);
            if (!user) return;
            const allCrewIdSet = /* @__PURE__ */ new Set([
              ...finisherCrews.map((r) => r.crew_id),
              ...hostCrews.map((r) => r.crew_id)
            ]);
            if (!allCrewIdSet.size) return;
            const firstName = user.name?.split(" ")[0] || user.name || "Someone";
            const activityType = run?.activity_type ?? "run";
            const aiMessage = await generateSoloActivityPost(
              firstName,
              finisherDist,
              finisherPace > 0 ? finisherPace : null,
              null,
              activityType
            );
            const metadata = {
              distance: finisherDist,
              pace: finisherPace > 0 ? finisherPace : null,
              activityType,
              runId: runIdForBg,
              isGroupRun: true
            };
            for (const crewId of allCrewIdSet) {
              await createCrewMessage(
                crewId,
                finisherUserId,
                user.name,
                user.profilePhoto || null,
                aiMessage,
                "solo_activity",
                metadata
              );
            }
          } catch (err) {
            console.error("[crew-group-finish]", err?.message ?? err);
          }
        })();
      }
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/host-end", requireAuth, async (req, res) => {
    try {
      const run = await getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id !== req.session.userId) return res.status(403).json({ message: "Only the host can end the run for everyone" });
      if (!run.is_active) return res.status(400).json({ message: "Run is not active" });
      await forceCompleteRun(req.params.id);
      finalizeTagAlongsForRun(req.params.id).catch(
        (e) => console.error("[tag-along] finalizeTagAlongsForRun error", e?.message)
      );
      res.json({ success: true });
      postCrewRunRecap(req.params.id).catch(
        (bgErr) => console.error("[bg] crew recap (host-end):", bgErr?.message ?? bgErr)
      );
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/tag-along/request", requireAuth, async (req, res) => {
    try {
      const { targetUserId } = req.body;
      if (!targetUserId) return res.status(400).json({ message: "targetUserId required" });
      const requesterId = req.session.userId;
      if (requesterId === targetUserId) return res.status(400).json({ message: "Cannot tag along with yourself" });
      const run = await getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      if (run.host_id === requesterId) return res.status(400).json({ message: "Host cannot tag along" });
      const request = await createTagAlongRequest(req.params.id, requesterId, targetUserId);
      const [requester, target] = await Promise.all([
        getUserById(requesterId),
        getUserById(targetUserId)
      ]);
      if (target?.push_token && target.notifications_enabled !== false) {
        const firstName = requester?.name?.split(" ")[0] ?? "Someone";
        sendPushNotification(
          target.push_token,
          "Tag-Along Request \u{1F3C3}",
          `${firstName} wants to tag along with your GPS for "${run.title}". Accept?`,
          { type: "tag_along_request", runId: req.params.id, requestId: request.id }
        ).catch((err) => console.error("[push] tag-along request notification failed:", err?.message ?? err));
      }
      res.json(request);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/tag-along/accept/:requestId", requireAuth, async (req, res) => {
    try {
      const result = await acceptTagAlongRequest(
        req.params.requestId,
        req.session.userId,
        req.params.id
      );
      if (!result) return res.status(404).json({ message: "Request not found or already handled" });
      res.json(result);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/tag-along/decline/:requestId", requireAuth, async (req, res) => {
    try {
      const result = await declineTagAlongRequest(
        req.params.requestId,
        req.session.userId,
        req.params.id
      );
      if (!result) return res.status(404).json({ message: "Request not found or already handled" });
      res.json(result);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/tag-along/cancel/:requestId", requireAuth, async (req, res) => {
    try {
      const result = await cancelTagAlongRequest(
        req.params.requestId,
        req.session.userId,
        req.params.id
      );
      if (!result) return res.status(404).json({ message: "Request not found or already pending" });
      res.json(result);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  });
  app2.get("/api/runs/:id/results", async (req, res) => {
    try {
      const results = await getRunResults(req.params.id);
      res.json(results);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/saved-paths", requireAuth, async (req, res) => {
    try {
      const paths = await getSavedPaths(req.session.userId);
      res.json(paths);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/saved-paths", requireAuth, async (req, res) => {
    try {
      const { name, routePath, distanceMiles, activityType, soloRunId } = req.body;
      if (!name || !routePath || !Array.isArray(routePath)) {
        return res.status(400).json({ message: "name and routePath are required" });
      }
      const path2 = await createSavedPath(req.session.userId, { name, routePath, distanceMiles, activityType, soloRunId: soloRunId || null });
      matchCommunityPath(req.session.userId, path2.id, routePath, distanceMiles ?? null).catch(console.error);
      res.json(path2);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/saved-paths/:id/share", requireAuth, async (req, res) => {
    try {
      const { toUserId } = req.body;
      if (!toUserId) return res.status(400).json({ message: "toUserId required" });
      const share = await sharePathWithFriend(req.session.userId, req.params.id, toUserId);
      res.json(share);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/saved-paths/:id/clone", requireAuth, async (req, res) => {
    try {
      const cloned = await cloneSharedPath(req.params.id, req.session.userId);
      res.json(cloned);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/saved-paths/:id/publish", requireAuth, async (req, res) => {
    try {
      const result = await publishSavedPath(req.params.id, req.session.userId);
      res.json(result);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/saved-paths/:id/runs", requireAuth, async (req, res) => {
    try {
      const runs = await getSoloRunsByPathId(req.session.userId, req.params.id);
      res.json(runs);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.patch("/api/saved-paths/:id", requireAuth, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "name is required" });
      }
      const path2 = await updateSavedPath(req.params.id, req.session.userId, name.trim());
      if (!path2) return res.status(404).json({ message: "Path not found" });
      res.json(path2);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.delete("/api/saved-paths/:id", requireAuth, async (req, res) => {
    try {
      const result = await deleteSavedPath(req.params.id, req.session.userId);
      res.json(result);
    } catch (e) {
      const status = e.message.includes("Not found") ? 404 : 500;
      res.status(status).json({ message: e.message });
    }
  });
  app2.get("/api/runs/:id/photos", async (req, res) => {
    try {
      const photos = await getRunPhotos(req.params.id);
      res.json(photos);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/runs/:id/photos", requireAuth, upload.single("photo"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No photo provided" });
      const run = await getRunById(req.params.id);
      if (!run) return res.status(404).json({ message: "Run not found" });
      const participants = await getRunParticipants(req.params.id);
      const isParticipant2 = participants.some((p) => p.id === req.session.userId);
      const isHost = run.host_id === req.session.userId;
      if (!isParticipant2 && !isHost) return res.status(403).json({ message: "Not a participant" });
      const ext = validateUploadExtension(req.file.originalname);
      if (!ext) {
        return res.status(400).json({ message: "Invalid file type. Only jpg, jpeg, png, gif, webp, and heic are allowed." });
      }
      const filename = `run-${req.params.id}-${req.session.userId}-${Date.now()}.${ext}`;
      const url = await uploadPhotoBuffer(req.file.buffer, filename, req.file.mimetype);
      const photo = await addRunPhoto(req.params.id, req.session.userId, url);
      res.status(201).json(photo);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.delete("/api/runs/:id/photos/:photoId", requireAuth, async (req, res) => {
    try {
      await deleteRunPhoto(req.params.photoId, req.session.userId);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/solo-runs/:id/photos", requireAuth, async (req, res) => {
    try {
      const photos = await getSoloRunPhotos(req.params.id, req.session.userId);
      res.json(photos);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/solo-runs/:id/photos", requireAuth, upload.single("photo"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No photo provided" });
      const soloRun = await getSoloRunById(req.params.id);
      if (!soloRun) return res.status(404).json({ message: "Solo run not found" });
      if (soloRun.userId !== req.session.userId) return res.status(403).json({ message: "Not authorized" });
      const ext = validateUploadExtension(req.file.originalname);
      if (!ext) {
        return res.status(400).json({ message: "Invalid file type. Only jpg, jpeg, png, gif, webp, and heic are allowed." });
      }
      const filename = `solo-${req.params.id}-${Date.now()}.${ext}`;
      const url = await uploadPhotoBuffer(req.file.buffer, filename, req.file.mimetype);
      const photo = await addSoloRunPhoto(req.params.id, req.session.userId, url);
      res.status(201).json(photo);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.delete("/api/solo-runs/:id/photos/:photoId", requireAuth, async (req, res) => {
    try {
      await deleteSoloRunPhoto(req.params.photoId, req.session.userId);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/crews", requireAuth, async (req, res) => {
    try {
      const crews = await getCrewsByUser(req.session.userId);
      res.json(crews);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/crews/rankings", requireAuth, async (req, res) => {
    try {
      const activityType = String(req.query.activityType || "run");
      const scope = String(req.query.scope || "national");
      const value = String(req.query.value || "");
      const params = [activityType];
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
      const ranked = result.rows.map((row, idx) => ({
        rank: idx + 1,
        id: row.id,
        name: row.name,
        emoji: row.emoji,
        image_url: row.image_url,
        home_state: row.home_state,
        home_metro: row.home_metro,
        member_count: row.member_count,
        total_miles: parseFloat(row.total_miles ?? 0)
      }));
      res.json(ranked);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/metro-areas", (req, res) => {
    const { metroAreas: metroAreas2 } = (init_metro_areas(), __toCommonJS(metro_areas_exports));
    res.json(metroAreas2);
  });
  app2.post("/api/crews", requireAuth, async (req, res) => {
    try {
      const { name, description, emoji, runStyle, tags, imageUrl, homeMetro, homeState } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Name is required" });
      if (name.trim().length > 20) return res.status(400).json({ message: "Crew name must be 20 characters or less" });
      const crew = await createCrew({
        name: name.trim(),
        description,
        emoji: emoji || "\u{1F3C3}",
        createdBy: req.session.userId,
        runStyle,
        tags: Array.isArray(tags) ? tags : [],
        imageUrl,
        homeMetro,
        homeState
      });
      res.json(crew);
    } catch (e) {
      if (e.code === "DUPLICATE_CREW_NAME") return res.status(409).json({ message: e.message });
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/crew-invites", requireAuth, async (req, res) => {
    try {
      const invites = await getCrewInvites(req.session.userId);
      res.json(invites);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/crew-invites/:crewId/respond", requireAuth, async (req, res) => {
    try {
      const { accept } = req.body;
      await respondToCrewInvite(req.params.crewId, req.session.userId, accept ? "accept" : "decline");
      res.json({ ok: true });
    } catch (e) {
      if (e.code === "MEMBER_CAP_REACHED") return res.status(400).json({ message: e.message, code: "MEMBER_CAP_REACHED" });
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/crews/search", requireAuth, async (req, res) => {
    try {
      const q = req.query.q || "";
      const friendsOnly = req.query.friends === "true";
      if (!q.trim() && !friendsOnly) return res.json([]);
      const results = await searchCrews(req.session.userId, q, friendsOnly);
      res.json(results);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/crews/suggested", requireAuth, async (req, res) => {
    try {
      const userCrews = await getCrewsByUser(req.session.userId);
      if (userCrews.length >= 3) return res.json([]);
      const suggestions = await getSuggestedCrews(req.session.userId, 10);
      res.json(suggestions);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/crews/:id/join-request", requireAuth, async (req, res) => {
    try {
      const result = await requestToJoinCrew(req.params.id, req.session.userId);
      if ("error" in result) {
        if (result.error === "member_cap_reached") {
          return res.status(400).json({ message: "This crew has reached its 100-member limit. The crew chief needs to upgrade.", code: "MEMBER_CAP_REACHED" });
        }
        return res.status(400).json({ message: result.error });
      }
      const crew = await getCrewById(req.params.id);
      if (crew) {
        const chief = await getUserById(crew.created_by);
        const requester = await getUserById(req.session.userId);
        if (userWantsNotif(chief, "crew_activity")) {
          sendPushNotification(
            chief.push_token,
            `New join request for ${crew.name}`,
            `${requester?.name ?? "Someone"} wants to join your crew`,
            { crewId: crew.id, screen: "crew-requests" }
          );
        }
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/crews/:id/join-requests", requireAuth, async (req, res) => {
    try {
      const crew = await getCrewById(req.params.id);
      if (!crew) return res.status(404).json({ message: "Crew not found" });
      if (crew.created_by !== req.session.userId) return res.status(403).json({ message: "Only the Crew Chief can view requests" });
      const requests = await getCrewJoinRequests(req.params.id);
      res.json(requests);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/crews/:id/join-requests/:requesterId/respond", requireAuth, async (req, res) => {
    try {
      const crew = await getCrewById(req.params.id);
      if (!crew) return res.status(404).json({ message: "Crew not found" });
      if (crew.created_by !== req.session.userId) return res.status(403).json({ message: "Only the Crew Chief can respond to requests" });
      const { accept } = req.body;
      await respondToCrewJoinRequest(req.params.id, req.params.requesterId, !!accept);
      const requester = await getUserById(req.params.requesterId);
      if (userWantsNotif(requester, "crew_activity")) {
        sendPushNotification(
          requester.push_token,
          accept ? `You're in! \u{1F389}` : `Join request for ${crew.name}`,
          accept ? `${crew.name} accepted your request to join` : `Your request to join ${crew.name} was declined`,
          { crewId: crew.id }
        );
      }
      res.json({ ok: true });
    } catch (e) {
      if (e.code === "MEMBER_CAP_REACHED") return res.status(400).json({ message: e.message, code: "MEMBER_CAP_REACHED" });
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/crews/:id", requireAuth, async (req, res) => {
    try {
      const activityType = req.query.activityType || "run";
      const crew = await getCrewById(req.params.id, activityType);
      if (!crew) return res.status(404).json({ message: "Crew not found" });
      res.json(crew);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/crews/:id/invite", requireAuth, async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ message: "userId required" });
      await inviteUserToCrew(req.params.id, userId, req.session.userId);
      const invitedUser = await getUserById(userId);
      const crew = await getCrewById(req.params.id);
      if (crew && userWantsNotif(invitedUser, "crew_activity")) {
        const inviter = await getUserById(req.session.userId);
        sendPushNotification(
          invitedUser.push_token,
          `You've been invited to ${crew.name} \u{1F3C3}`,
          `${inviter?.name ?? "Someone"} invited you to join their crew`,
          { crewId: req.params.id }
        );
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.delete("/api/crews/:id", requireAuth, async (req, res) => {
    try {
      await disbandCrewById(req.params.id, req.session.userId);
      res.json({ ok: true });
    } catch (e) {
      res.status(e.message?.includes("Only the creator") ? 403 : 500).json({ message: e.message });
    }
  });
  app2.delete("/api/crews/:id/members/:memberId", requireAuth, async (req, res) => {
    try {
      await removeCrewMember(req.params.id, req.session.userId, req.params.memberId);
      res.json({ ok: true });
    } catch (e) {
      const status = e.message?.includes("Only the Crew Chief") ? 403 : e.message?.includes("not found") ? 404 : 500;
      res.status(status).json({ message: e.message });
    }
  });
  app2.put("/api/crews/:crewId/members/:userId/role", requireAuth, async (req, res) => {
    try {
      const callerId = req.session.userId;
      const { crewId, userId } = req.params;
      const { role } = req.body;
      if (!["officer", "member", "crew_chief"].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      const callerRole = await getCrewMemberRole(crewId, callerId);
      if (callerRole !== "crew_chief") {
        return res.status(403).json({ message: "Only the Crew Chief can change roles" });
      }
      if (userId === callerId) {
        return res.status(400).json({ message: "You cannot change your own role" });
      }
      await setCrewMemberRole(crewId, userId, role, callerId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.delete("/api/crews/:id/leave", requireAuth, async (req, res) => {
    try {
      const result = await leaveCrewById(req.params.id, req.session.userId);
      res.json({ ok: true, disbanded: result?.disbanded ?? false });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.patch("/api/crews/:id/mute", requireAuth, async (req, res) => {
    try {
      const muted = await toggleCrewChatMute(req.params.id, req.session.userId);
      res.json({ muted });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/crews/:id/runs", requireAuth, async (req, res) => {
    try {
      const runs = await getCrewRuns(req.params.id);
      res.json(runs);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/crews/:id/history", requireAuth, async (req, res) => {
    try {
      const history = await getCrewRunHistory(req.params.id);
      res.json(history);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/crews/:id/achievements", requireAuth, async (req, res) => {
    try {
      const data = await getCrewAchievements(req.params.id);
      res.json(data);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/crews/:id/subscription", requireAuth, async (req, res) => {
    try {
      const status = await getCrewSubscriptionStatus(req.params.id);
      if (!status) return res.status(404).json({ message: "Crew not found" });
      res.json(status);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/webhooks/revenuecat", async (req, res) => {
    try {
      const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
      if (!webhookSecret && process.env.NODE_ENV === "production") {
        console.error("[revenuecat webhook] REVENUECAT_WEBHOOK_SECRET not set in production \u2014 rejecting request");
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
      const crewId = app_user_id.replace("crew_", "");
      const crew = await getCrewById(crewId);
      if (!crew) return res.status(200).json({ ok: true });
      const subStatus = await getCrewSubscriptionStatus(crewId);
      if (!subStatus) return res.status(200).json({ ok: true });
      const currentTier = subStatus.subscription_tier;
      const isGrowth = product_id === "crew_growth_monthly";
      const isBoost = product_id === "crew_discovery_boost_monthly";
      const isPurchase = ["INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE"].includes(type);
      const isCancellation = ["CANCELLATION", "EXPIRATION"].includes(type);
      const hasGrowth = currentTier === "growth" || currentTier === "both";
      const hasBoost = currentTier === "discovery_boost" || currentTier === "both";
      let newHasGrowth = hasGrowth;
      let newHasBoost = hasBoost;
      if (isPurchase) {
        if (isGrowth) newHasGrowth = true;
        if (isBoost) newHasBoost = true;
      } else if (isCancellation) {
        if (isGrowth) newHasGrowth = false;
        if (isBoost) newHasBoost = false;
      }
      const newTier = newHasGrowth && newHasBoost ? "both" : newHasGrowth ? "growth" : newHasBoost ? "discovery_boost" : "none";
      if (newTier !== currentTier) {
        await updateCrewSubscription(crewId, newTier);
      }
      res.status(200).json({ ok: true });
    } catch (e) {
      console.error("[revenuecat webhook]", e.message);
      res.status(200).json({ ok: true });
    }
  });
  app2.get("/api/gifs/search", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const limit = Math.min(Number(req.query.limit) || 20, 50);
      const apiKey = process.env.GIPHY_API_KEY;
      if (!apiKey) return res.status(500).json({ message: "GIPHY API key not configured" });
      const url = q ? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(q)}&limit=${limit}&rating=g` : `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=${limit}&rating=g`;
      const resp = await fetch(url);
      const json = await resp.json();
      const gifs = (json.data || []).map((item) => ({
        id: item.id,
        title: item.title,
        gif_url: item.images?.fixed_height?.url || item.images?.original?.url || "",
        preview_url: item.images?.fixed_height_still?.url || item.images?.fixed_height?.url || ""
      }));
      res.json(gifs);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/dm/conversations", requireAuth, async (req, res) => {
    try {
      const convos = await getDmConversations(req.session.userId);
      res.json(convos);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/dm/unread-count", requireAuth, async (req, res) => {
    try {
      const count = await getDmUnreadCount(req.session.userId);
      res.json({ count });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/dm/:friendId", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const messages = await getDmThread(req.session.userId, req.params.friendId, limit);
      res.json(messages);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/dm/:friendId", requireAuth, async (req, res) => {
    try {
      const { message, gif_url, gif_preview_url } = req.body;
      const isGif = !!gif_url;
      if (!message?.trim() && !isGif) return res.status(400).json({ message: "Message required" });
      const [iBlocked, theyBlocked] = await Promise.all([
        isBlocking(req.session.userId, req.params.friendId),
        isBlockedBy(req.session.userId, req.params.friendId)
      ]);
      if (iBlocked || theyBlocked) return res.status(403).json({ message: "Cannot send message to this user" });
      const messageType = isGif ? "gif" : "text";
      const metadata = isGif ? { gif_url, gif_preview_url } : void 0;
      const dm = await sendDm(
        req.session.userId,
        req.params.friendId,
        (message ?? "").trim(),
        messageType,
        metadata
      );
      res.json(dm);
      Promise.all([
        getUserById(req.session.userId),
        getUserById(req.params.friendId)
      ]).then(([sender, recipient]) => {
        if (sender && recipient?.push_token && recipient.notifications_enabled !== false) {
          const body = isGif ? "Sent you a GIF \u{1F3C3}" : (message ?? "").trim();
          sendPushNotification(
            recipient.push_token,
            sender.name,
            body,
            { screen: "dm", friendId: req.session.userId }
          );
        }
      }).catch((err) => console.error("[bg]", err?.message ?? err));
    } catch (e) {
      if (e.message === "Not friends") return res.status(403).json({ message: "Not friends" });
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/dm/:friendId/read", requireAuth, async (req, res) => {
    try {
      await markDmRead(req.session.userId, req.params.friendId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.delete("/api/dm/:friendId", requireAuth, async (req, res) => {
    try {
      await deleteDmThread(req.session.userId, req.params.friendId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/garmin/status", requireAuth, async (req, res) => {
    try {
      const token = await getGarminToken(req.session.userId);
      let lastSync = null;
      if (token) {
        const result = await getGarminLastSync(req.session.userId);
        lastSync = result;
      }
      res.json({ connected: !!token, lastSync });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/garmin/auth", requireAuth, async (req, res) => {
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
      garminPendingTokens.set(requestToken, { userId: req.session.userId, requestSecret });
      setTimeout(() => garminPendingTokens.delete(requestToken), 15 * 60 * 1e3);
      res.json({ authUrl: `${GARMIN_AUTH_URL}?oauth_token=${requestToken}` });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.get("/api/garmin/callback", async (req, res) => {
    try {
      const oauth_token = String(req.query.oauth_token ?? "");
      const oauth_verifier = String(req.query.oauth_verifier ?? "");
      if (!oauth_token || !oauth_verifier) {
        return res.status(400).send("Missing OAuth parameters. Please try connecting Garmin again.");
      }
      const pending = garminPendingTokens.get(oauth_token);
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
      const authHeader = oauthInst.toHeader({ ...authData, oauth_verifier });
      const accResp = await fetch(GARMIN_ACCESS_TOKEN_URL, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/x-www-form-urlencoded" },
        body: `oauth_verifier=${encodeURIComponent(oauth_verifier)}`
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
      await saveGarminToken(userId, accessToken, accessSecret);
      res.send(`<!DOCTYPE html><html><head><title>PaceUp \u2014 Garmin Connected</title>
<meta http-equiv="refresh" content="0;url=paceup://garmin-connected">
<style>body{background:#050C09;color:#fff;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;} h1{color:#00D97E;font-size:24px;} p{color:#aaa;margin-top:8px;} a{color:#00D97E;}</style></head>
<body>
<h1>Garmin Connected!</h1>
<p>Returning to PaceUp\u2026</p>
<p><a href="paceup://garmin-connected">Tap here if the app didn't open automatically</a></p>
<script>window.location.href="paceup://garmin-connected";</script>
</body></html>`);
    } catch (e) {
      res.status(500).send(`Error: ${e.message}`);
    }
  });
  app2.post("/api/garmin/disconnect", requireAuth, async (req, res) => {
    try {
      await saveGarminToken(req.session.userId, "", "");
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/garmin/sync", requireAuth, async (req, res) => {
    try {
      const oauthInst = makeGarminOAuth();
      if (!oauthInst) return res.status(503).json({ message: "Garmin integration is not configured." });
      const tokenRow = await getGarminToken(req.session.userId);
      if (!tokenRow) return res.status(401).json({ message: "Garmin account not connected." });
      const token = { key: tokenRow.access_token, secret: tokenRow.token_secret };
      const since = Math.floor(Date.now() / 1e3) - 30 * 24 * 60 * 60;
      const activitiesUrl = `${GARMIN_ACTIVITIES_URL}?uploadStartTimeInSeconds=${since}&uploadEndTimeInSeconds=${Math.floor(Date.now() / 1e3)}`;
      const resp = await garminFetch(activitiesUrl, "GET", oauthInst, token);
      const data = await resp.json();
      const activities = Array.isArray(data) ? data : data.activityList ?? [];
      let imported = 0;
      for (const act of activities) {
        const garminId = String(act.activityId ?? act.summaryId ?? "");
        if (!garminId) continue;
        const distMeters = act.distanceInMeters ?? act.totalDistanceInMeters ?? 0;
        const distMiles = distMeters * 621371e-9;
        const durationSec = act.durationInSeconds ?? act.timerDuration ?? null;
        const avgPaceSecPerMeter = durationSec && distMeters > 0 ? durationSec / distMeters : null;
        const paceMinPerMile = avgPaceSecPerMeter ? avgPaceSecPerMeter * 1609.34 / 60 : null;
        const actTypeLower = (act.activityType ?? "").toLowerCase();
        const actType = actTypeLower.includes("cycl") ? "ride" : actTypeLower.includes("walk") || actTypeLower.includes("hik") ? "walk" : "run";
        const actTypeLabel = actType === "ride" ? "Garmin Ride" : actType === "walk" ? "Garmin Walk" : "Garmin Run";
        const wasNew = await saveGarminActivity(req.session.userId, garminId, {
          title: act.activityName ?? actTypeLabel,
          date: new Date((act.startTimeInSeconds ?? Math.floor(Date.now() / 1e3)) * 1e3),
          distanceMiles: distMiles,
          paceMinPerMile,
          durationSeconds: durationSec,
          activityType: actType
        });
        if (wasNew) imported++;
      }
      res.json({ imported, total: activities.length });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/health/import", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const { workouts, source = "apple_health" } = req.body;
      if (!Array.isArray(workouts) || workouts.length === 0) {
        return res.status(400).json({ message: "No workouts provided" });
      }
      const isHealthConnect = source === "health_connect";
      let imported = 0;
      for (const w of workouts) {
        if (!w.id || !w.activityType || !w.startDate || !w.distanceMeters || !w.durationSeconds) continue;
        const distMiles = w.distanceMeters / 1609.344;
        const paceMinPerMile = w.durationSeconds > 0 && distMiles > 0 ? w.durationSeconds / 60 / distMiles : null;
        const typeMap = { run: "run", ride: "ride", walk: "walk" };
        const actType = typeMap[w.activityType] || "run";
        const activityData = {
          date: new Date(w.startDate),
          distanceMiles: Math.round(distMiles * 100) / 100,
          paceMinPerMile: paceMinPerMile ? Math.round(paceMinPerMile * 100) / 100 : null,
          durationSeconds: Math.round(w.durationSeconds),
          activityType: actType,
          title: ""
        };
        let wasNew;
        if (isHealthConnect) {
          activityData.title = `${actType === "ride" ? "Ride" : actType === "walk" ? "Walk" : "Run"} via Health Connect`;
          wasNew = await saveHealthConnectActivity(userId, w.id, activityData);
        } else {
          activityData.title = `${actType === "ride" ? "Ride" : actType === "walk" ? "Walk" : "Run"} via ${w.sourceName || "Apple Health"}`;
          wasNew = await saveHealthKitActivity(userId, w.id, activityData);
        }
        if (wasNew) imported++;
      }
      res.json({ imported, total: workouts.length });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  app2.post("/api/admin/seed-runs", requireAuth, async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ message: "Not available in production" });
    }
    try {
      const { count = 20 } = req.body;
      await clearAndReseedRuns(count);
      res.json({ success: true, message: `Generated ${count} runs` });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/weekly-summary.ts
async function sendWeeklySummaries() {
  console.log("[weekly-summary] Sending weekly summaries...");
  const users = await getUsersForWeeklySummary();
  for (const user of users) {
    try {
      const stats = await getWeeklyStatsForUser(user.id);
      if (stats.runs === 0) continue;
      const mi = stats.totalMi.toFixed(1);
      const mins = Math.floor(stats.totalSeconds / 60);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      const timeLabel = h > 0 ? `${h}h ${m}m` : `${m}m`;
      const insight = await generateWeeklyInsight(user.name, stats);
      const body = insight ? `${stats.runs} run${stats.runs !== 1 ? "s" : ""} \xB7 ${mi} mi \xB7 ${timeLabel} \u2014 ${insight}` : `${stats.runs} run${stats.runs !== 1 ? "s" : ""} \xB7 ${mi} mi \xB7 ${timeLabel} this week \u2014 keep it up!`;
      await sendPushNotification(
        user.push_token,
        `Your weekly PaceUp summary \u{1F4CA}`,
        body,
        { screen: "profile" }
      );
    } catch (err) {
      console.error(`[weekly-summary] Failed for user ${user.id}:`, err);
    }
  }
  console.log(`[weekly-summary] Sent to ${users.length} eligible users`);
}
function msUntilNextSunday8pm() {
  const now = /* @__PURE__ */ new Date();
  const day = now.getUTCDay();
  const daysUntilSunday = day === 0 ? 7 : 7 - day;
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + daysUntilSunday);
  next.setUTCHours(20, 0, 0, 0);
  return Math.max(next.getTime() - now.getTime(), 1e3);
}
function scheduleWeeklySummary() {
  function scheduleNext() {
    const delay = msUntilNextSunday8pm();
    const hours = Math.round(delay / 1e3 / 3600);
    console.log(`[weekly-summary] Next send in ~${hours}h (Sunday 8pm UTC)`);
    setTimeout(async () => {
      try {
        await sendWeeklySummaries();
      } catch (err) {
        console.error("[weekly-summary] Batch error:", err);
      }
      scheduleNext();
    }, delay);
  }
  scheduleNext();
}
function getCurrentISOWeek() {
  const now = /* @__PURE__ */ new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
}
async function checkCrewStreakAtRisk() {
  console.log("[streak-risk] Checking crews at streak risk...");
  try {
    const crews = await getCrewsAtStreakRisk();
    const currentWeek = getCurrentISOWeek();
    for (const crew of crews) {
      try {
        const weeksLabel = crew.current_streak_weeks === 1 ? "1-week" : `${crew.current_streak_weeks}-week`;
        await createCrewMessage(
          crew.id,
          "system",
          "PaceUp Bot",
          null,
          `\u26A0\uFE0F Heads up! Your ${weeksLabel} streak is at risk \u2014 no run logged this week yet. Schedule one to keep it alive! \u{1F525}`,
          "milestone"
        );
        await updateCrew(crew.id, { streak_risk_notif_week: currentWeek });
        console.log(`[streak-risk] Sent at-risk warning to crew ${crew.id} (${crew.name})`);
      } catch (err) {
        console.error(`[streak-risk] Failed for crew ${crew.id}:`, err);
      }
    }
    console.log(`[streak-risk] Checked ${crews.length} crews`);
  } catch (err) {
    console.error("[streak-risk] Batch error:", err);
  }
}
function scheduleStreakAtRiskCheck() {
  const run = async () => {
    try {
      await checkCrewStreakAtRisk();
    } catch (err) {
      console.error("[streak-risk] Scheduler error:", err);
    }
  };
  setTimeout(run, 1e4);
  setInterval(run, 24 * 60 * 60 * 1e3);
  console.log("[streak-risk] Streak-at-risk checker scheduled (daily)");
}

// server/late-start-monitor.ts
var CHECK_INTERVAL_MS = 5 * 60 * 1e3;
async function checkLateStarts() {
  try {
    const result = await pool.query(
      `SELECT r.id, r.title, r.activity_type,
              u.push_token AS host_push_token,
              u.notifications_enabled,
              u.notif_run_reminders
       FROM runs r
       JOIN users u ON u.id = r.host_id
       WHERE r.is_active = false
         AND r.is_completed = false
         AND (r.is_deleted IS NULL OR r.is_deleted = false)
         AND r.notif_late_start_sent = false
         AND r.date < NOW() - INTERVAL '25 minutes'
         AND r.date > NOW() - INTERVAL '35 minutes'`
    );
    if (result.rows.length > 0) {
      const ids = result.rows.map((r) => r.id);
      await pool.query(
        `UPDATE runs SET notif_late_start_sent = true WHERE id = ANY($1)`,
        [ids]
      );
      for (const run of result.rows) {
        const type = run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run";
        if (run.host_push_token && run.notifications_enabled !== false && run.notif_run_reminders !== false) {
          await sendPushNotification(
            run.host_push_token,
            `\u23F0 Start your ${type} soon`,
            `"${run.title}" was scheduled 30 minutes ago. Start it now or it will be automatically removed in 30 minutes.`,
            { screen: "run", runId: run.id }
          );
        }
        console.log(`[late-start] Notified host for run ${run.id} ("${run.title}")`);
      }
    }
  } catch (err) {
    console.error("[late-start] Check failed:", err);
  }
}
async function cleanupUnstartedRuns() {
  try {
    const result = await pool.query(
      `UPDATE runs
       SET is_deleted = true
       WHERE is_active = false
         AND is_completed = false
         AND (is_deleted IS NULL OR is_deleted = false)
         AND date < NOW() - INTERVAL '60 minutes'
       RETURNING id, title`
    );
    if (result.rowCount && result.rowCount > 0) {
      for (const r of result.rows) {
        console.log(`[late-start] Auto-removed unstarted run ${r.id} ("${r.title}")`);
      }
    }
  } catch (err) {
    console.error("[late-start] Unstarted run cleanup failed:", err);
  }
}
async function cleanupStaleActiveRuns() {
  try {
    const stale = await pool.query(
      `SELECT id, title, crew_id FROM runs
       WHERE is_active = true
         AND is_completed = false
         AND started_at < NOW() - INTERVAL '8 hours'`
    );
    for (const r of stale.rows) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const lockRes = await client.query(
          `SELECT id FROM runs WHERE id = $1 AND is_active = true AND is_completed = false FOR UPDATE`,
          [r.id]
        );
        if (lockRes.rows.length === 0) {
          await client.query("ROLLBACK");
          continue;
        }
        const finishedParticipants = await client.query(
          `SELECT rp.user_id, rp.final_distance
           FROM run_participants rp
           WHERE rp.run_id = $1 AND rp.final_pace IS NOT NULL AND rp.status != 'confirmed'`,
          [r.id]
        );
        for (const p of finishedParticipants.rows) {
          const miles = parseFloat(p.final_distance) || 3;
          await client.query(
            `UPDATE run_participants SET status = 'confirmed', miles_logged = $3 WHERE run_id = $1 AND user_id = $2`,
            [r.id, p.user_id, miles]
          );
          await client.query(
            `UPDATE users SET
              completed_runs = completed_runs + 1,
              total_miles = total_miles + $2,
              miles_this_year = miles_this_year + $2,
              miles_this_month = miles_this_month + $2
             WHERE id = $1`,
            [p.user_id, miles]
          );
        }
        if (r.crew_id && finishedParticipants.rows.length > 0) {
          const crew = await client.query(
            `SELECT id, current_streak_weeks, last_run_week FROM crews WHERE id = $1 FOR UPDATE`,
            [r.crew_id]
          );
          if (crew.rows.length > 0) {
            const c = crew.rows[0];
            const now = /* @__PURE__ */ new Date();
            const lastRun = c.last_run_week ? new Date(c.last_run_week) : null;
            const getWeekNumber = (d) => {
              const onejan = new Date(d.getFullYear(), 0, 1);
              return Math.ceil(((d.getTime() - onejan.getTime()) / 864e5 + onejan.getDay() + 1) / 7);
            };
            const currentWeek = getWeekNumber(now);
            const currentYear = now.getFullYear();
            const lastWeek = lastRun ? getWeekNumber(lastRun) : -1;
            const lastYear = lastRun ? lastRun.getFullYear() : -1;
            let newStreak = c.current_streak_weeks || 0;
            if (lastYear === currentYear && lastWeek === currentWeek) {
            } else if (lastYear === currentYear && lastWeek === currentWeek - 1) {
              newStreak++;
            } else if (lastYear === currentYear - 1 && lastWeek >= 52 && currentWeek === 1) {
              newStreak++;
            } else {
              newStreak = 1;
            }
            await client.query(
              `UPDATE crews SET current_streak_weeks = $2, last_run_week = $3 WHERE id = $1`,
              [r.crew_id, newStreak, now]
            );
            console.log(`[late-start] Updated crew ${r.crew_id} streak to ${newStreak} weeks`);
          }
        }
        const ranksRes = await client.query(
          `SELECT user_id, final_pace FROM run_participants
           WHERE run_id = $1 AND final_pace IS NOT NULL AND final_pace > 0 ORDER BY final_pace ASC`,
          [r.id]
        );
        for (let i = 0; i < ranksRes.rows.length; i++) {
          await client.query(
            `UPDATE run_participants SET final_rank = $3 WHERE run_id = $1 AND user_id = $2`,
            [r.id, ranksRes.rows[i].user_id, i + 1]
          );
        }
        await client.query(
          `UPDATE runs SET is_completed = true, is_active = false WHERE id = $1`,
          [r.id]
        );
        await client.query("COMMIT");
        console.log(`[late-start] Auto-completed stale run ${r.id} ("${r.title}") with ${finishedParticipants.rows.length} credited`);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {
        });
        console.error(`[late-start] Auto-completion failed for run ${r.id}:`, err?.message);
      } finally {
        client.release();
      }
    }
    const neverStarted = await pool.query(
      `UPDATE runs
       SET is_active = false
       WHERE is_active = true
         AND started_at IS NULL
         AND date < NOW() - INTERVAL '3 hours'
       RETURNING id, title`
    );
    if (neverStarted.rowCount && neverStarted.rowCount > 0) {
      for (const r of neverStarted.rows) {
        console.log(`[late-start] Reset stuck-active run ${r.id} ("${r.title}")`);
      }
    }
  } catch (err) {
    console.error("[late-start] Stale run cleanup failed:", err);
  }
}
var PRE_RUN_PHRASES = [
  (type, title) => `Lace up \u2014 your ${type} starts in 30 minutes! \u{1F45F}`,
  (type, title) => `30 min to go. Your crew is counting on you \u{1F4AA}`,
  (type, title) => `Time to get moving \u2014 "${title}" kicks off in 30!`,
  (type, title) => `Head out now so you make it to the start on time \u{1F3C3}`,
  (type, title) => `Your ${type} is almost here. Don't leave your crew hanging!`,
  (type, title) => `30 minutes until "${title}" \u2014 get those miles ready \u{1F525}`,
  (type, title) => `Almost time! "${title}" starts in 30. See you out there \u{1F31F}`,
  (type, title) => `Your ${type} is starting soon \u2014 warm up and head over!`,
  (type, title) => `30-minute warning: "${title}" is about to begin. Let's go! \u{1F680}`,
  (type, title) => `Rise and roll \u2014 "${title}" kicks off in 30 minutes \u26A1`
];
async function checkPreRunReminders() {
  try {
    const result = await pool.query(
      `UPDATE runs
       SET notif_pre_run_sent = true
       WHERE is_active = false
         AND is_completed = false
         AND (is_deleted IS NULL OR is_deleted = false)
         AND notif_pre_run_sent = false
         AND date > NOW() + INTERVAL '25 minutes'
         AND date < NOW() + INTERVAL '35 minutes'
       RETURNING id, title, activity_type, host_id`
    );
    if (!result.rows.length) return;
    for (const run of result.rows) {
      const type = run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run";
      const phraseIdx = Math.floor(Math.random() * PRE_RUN_PHRASES.length);
      const body = PRE_RUN_PHRASES[phraseIdx](type, run.title);
      const title = `\u23F1 ${run.title} starts soon`;
      const data = { screen: "run", runId: run.id };
      const hostRes = await pool.query(
        `SELECT push_token, notifications_enabled, notif_run_reminders
         FROM users WHERE id = $1`,
        [run.host_id]
      );
      const host = hostRes.rows[0];
      const participantsRes = await pool.query(
        `SELECT u.push_token, u.notifications_enabled, u.notif_run_reminders
         FROM run_participants rp
         JOIN users u ON u.id = rp.user_id
         WHERE rp.run_id = $1
           AND rp.status IN ('joined', 'confirmed')
           AND rp.user_id != $2
           AND u.push_token IS NOT NULL`,
        [run.id, run.host_id]
      );
      const tokenSet = /* @__PURE__ */ new Set();
      if (host?.push_token && host.notifications_enabled !== false && host.notif_run_reminders !== false && host.push_token.startsWith("ExponentPushToken[")) {
        tokenSet.add(host.push_token);
      }
      for (const p of participantsRes.rows) {
        if (p.push_token && p.notifications_enabled !== false && p.notif_run_reminders !== false) {
          tokenSet.add(p.push_token);
        }
      }
      const tokens = Array.from(tokenSet);
      if (tokens.length > 0) {
        await sendPushNotification(tokens, title, body, data);
      }
      console.log(`[pre-run] Sent reminder for run ${run.id} ("${run.title}") to ${tokens.length} recipient(s)`);
    }
  } catch (err) {
    console.error("[pre-run] Check failed:", err);
  }
}
async function checkAndPromoteHost() {
  try {
    const staleHosts = await pool.query(
      `SELECT r.id, r.host_id
       FROM runs r
       WHERE r.is_active = true
         AND r.is_completed = false
         AND r.started_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM run_tracking_points tp
           WHERE tp.run_id = r.id
             AND tp.user_id = r.host_id
             AND tp.recorded_at > NOW() - INTERVAL '5 minutes'
         )`
    );
    for (const run of staleHosts.rows) {
      const bestRunner = await pool.query(
        `SELECT DISTINCT ON (tp.user_id) tp.user_id, tp.cumulative_distance
         FROM run_tracking_points tp
         JOIN run_participants rp ON rp.run_id = tp.run_id AND rp.user_id = tp.user_id
         WHERE tp.run_id = $1
           AND tp.user_id != $2
           AND rp.is_present = true
           AND rp.final_pace IS NULL
           AND tp.recorded_at > NOW() - INTERVAL '5 minutes'
         ORDER BY tp.user_id, tp.recorded_at DESC`,
        [run.id, run.host_id]
      );
      if (bestRunner.rows.length > 0) {
        const sorted = bestRunner.rows.sort(
          (a, b) => parseFloat(b.cumulative_distance) - parseFloat(a.cumulative_distance)
        );
        const newHostId = sorted[0].user_id;
        await pool.query(`UPDATE runs SET host_id = $1 WHERE id = $2`, [newHostId, run.id]);
        console.log(`[late-start] Auto-promoted user ${newHostId} to host for run ${run.id} (original host went silent)`);
      }
    }
  } catch (err) {
    console.error("[late-start] Host promotion check failed:", err);
  }
}
function scheduleLateStartMonitor() {
  console.log("[late-start] Monitor started \u2014 checking every 5 minutes");
  setInterval(() => {
    checkPreRunReminders();
    checkLateStarts();
    cleanupStaleActiveRuns();
    cleanupUnstartedRuns();
    checkAndPromoteHost();
  }, CHECK_INTERVAL_MS);
  checkPreRunReminders();
  checkLateStarts();
  cleanupStaleActiveRuns();
  cleanupUnstartedRuns();
  checkAndPromoteHost();
}

// server/ghost-run-cleanup.ts
var CHECK_INTERVAL_MS2 = 30 * 60 * 1e3;
async function closeGhostRuns() {
  try {
    const result = await pool.query(
      `UPDATE runs
       SET is_active = false, is_completed = true
       WHERE is_active = true
         AND (is_completed IS NULL OR is_completed = false)
         AND (
           date < NOW() - INTERVAL '4 hours'
           OR NOT EXISTS (
             SELECT 1 FROM run_tracking_points
             WHERE run_id = runs.id
               AND recorded_at > NOW() - INTERVAL '4 hours'
           )
         )
       RETURNING id, title`
    );
    if (result.rows.length > 0) {
      console.log(
        `[ghost-run-cleanup] Auto-closed ${result.rows.length} ghost run(s):`,
        result.rows.map((r) => `"${r.title}" (${r.id})`).join(", ")
      );
    }
  } catch (err) {
    console.error("[ghost-run-cleanup] Error:", err?.message ?? err);
  }
}
function scheduleGhostRunCleanup() {
  closeGhostRuns().catch(() => {
  });
  setInterval(() => {
    closeGhostRuns().catch(() => {
    });
  }, CHECK_INTERVAL_MS2);
  console.log("[ghost-run-cleanup] Scheduled (every 30 min)");
}

// server/index.ts
import * as fs from "fs";
import * as path from "path";
var app = express();
var log = console.log;
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }
    const origin = req.header("origin");
    const isLocalhost = origin?.startsWith("http://localhost:") || origin?.startsWith("http://127.0.0.1:");
    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path2 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path2.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path2} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
function configureExpoAndLanding(app2) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  const deleteAccountPath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "delete-account.html"
  );
  const deleteAccountHtml = fs.readFileSync(deleteAccountPath, "utf-8");
  app2.get("/delete-account", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(deleteAccountHtml);
  });
  const privacyPolicyPath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "privacy-policy.html"
  );
  const privacyPolicyHtml = fs.readFileSync(privacyPolicyPath, "utf-8");
  app2.get("/privacy-policy", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(privacyPolicyHtml);
  });
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }
    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName
      });
    }
    next();
  });
  app2.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app2.use(express.static(path.resolve(process.cwd(), "static-build")));
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
(async () => {
  app.set("trust proxy", 1);
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  configureExpoAndLanding(app);
  const server = await registerRoutes(app);
  setupErrorHandler(app);
  scheduleWeeklySummary();
  scheduleStreakAtRiskCheck();
  scheduleLateStartMonitor();
  scheduleGhostRunCleanup();
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true
    },
    () => {
      log(`express server serving on port ${port}`);
    }
  );
})();
