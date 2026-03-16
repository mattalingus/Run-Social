import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  boolean,
  integer,
  real,
  timestamp,
  pgEnum,
  serial,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const runPrivacyEnum = pgEnum("run_privacy", ["public", "private", "solo"]);
export const userRoleEnum = pgEnum("user_role", ["runner", "host"]);
export const participantStatusEnum = pgEnum("participant_status", ["joined", "confirmed", "cancelled"]);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  username: text("username").unique(),
  gender: text("gender"), // "Man", "Woman", "Prefer not to say"
  photoUrl: text("photo_url"),
  avgPace: real("avg_pace").default(10),
  avgDistance: real("avg_distance").default(3),
  totalMiles: real("total_miles").default(0),
  milesThisYear: real("miles_this_year").default(0),
  milesThisMonth: real("miles_this_month").default(0),
  monthlyGoal: real("monthly_goal").default(50),
  yearlyGoal: real("yearly_goal").default(500),
  completedRuns: integer("completed_runs").default(0),
  hostedRuns: integer("hosted_runs").default(0),
  hostUnlocked: boolean("host_unlocked").default(false),
  role: userRoleEnum("role").default("runner"),
  avgRating: real("avg_rating").default(0),
  ratingCount: integer("rating_count").default(0),
  notificationsEnabled: boolean("notifications_enabled").default(true),
  stravaId: text("strava_id"),
  appleHealthId: text("apple_health_id"),
  garminId: text("garmin_id"),
  garminAccessToken: text("garmin_access_token"),
  garminTokenSecret: text("garmin_token_secret"),
  notificationsReadAt: timestamp("notifications_read_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const runs = pgTable("runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  hostId: varchar("host_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  privacy: runPrivacyEnum("privacy").default("public"),
  date: timestamp("date").notNull(),
  locationLat: real("location_lat").notNull(),
  locationLng: real("location_lng").notNull(),
  locationName: text("location_name").notNull(),
  minDistance: real("min_distance").notNull(),
  maxDistance: real("max_distance").notNull(),
  minPace: real("min_pace").notNull(),
  maxPace: real("max_pace").notNull(),
  tags: text("tags").array().default(sql`'{}'`),
  isCompleted: boolean("is_completed").default(false),
  maxParticipants: integer("max_participants").default(20),
  createdAt: timestamp("created_at").defaultNow(),
});

export const runParticipants = pgTable("run_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => runs.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  status: participantStatusEnum("status").default("joined"),
  joinedAt: timestamp("joined_at").defaultNow(),
  milesLogged: real("miles_logged"),
});

export const hostRatings = pgTable("host_ratings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => runs.id),
  hostId: varchar("host_id").notNull().references(() => users.id),
  raterId: varchar("rater_id").notNull().references(() => users.id),
  stars: integer("stars").notNull(),
  tags: text("tags").array().default(sql`'{}'`),
  createdAt: timestamp("created_at").defaultNow(),
});

export const achievements = pgTable("achievements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  milestone: integer("milestone").notNull(),
  earnedAt: timestamp("earned_at").defaultNow(),
  rewardEligible: boolean("reward_eligible").default(true),
  rewardClaimed: boolean("reward_claimed").default(false),
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
  name: true,
});

export const insertRunSchema = createInsertSchema(runs).omit({
  id: true,
  createdAt: true,
  isCompleted: true,
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  token: varchar("token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").default(sql`NOW()`),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunParticipant = typeof runParticipants.$inferSelect;
export type HostRating = typeof hostRatings.$inferSelect;
export type Achievement = typeof achievements.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
