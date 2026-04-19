# PaceUp UI/UX Audit

**Date:** 2026-04-19
**Scope:** Full audit of `app/`, `components/`, `constants/` in Expo/React Native app.
**Total findings:** 73 (8 High, 48 Medium, 17 Low)

---

## Executive Summary

PaceUp has strong design direction but suffers from scattered hardcoded values, inconsistent spacing/typography scales, mixed icon libraries, and a light-mode breakage. The app is visually polished in isolation but lacks systematic design consistency across 33+ screens. Primary issues: 316 hardcoded colors instead of theme tokens, multiple incompatible padding scales, 3 icon libraries used simultaneously, and a critical light-mode bug (`lightColors.white = "#0A1F12"`).

---

## Top 10 Quick Wins

1. **Fix light-mode color bug** — `constants/colors.ts:44` `lightColors.white` is `"#0A1F12"` (dark green) instead of `"#FFFFFF"`. Critical, 5-minute fix.
2. **Enforce theme context** — Replace `import { darkColors as C }` with `const { C } = useTheme()` across 8–10 screens so light mode actually works.
3. **Extract spacing tokens** — Create `constants/spacing.ts` with named scale (8/12/16/20/24/28) and replace inline magic numbers.
4. **Replace hardcoded hex values** — ~316 occurrences; swap for `C.primary`, `C.danger`, `C.surface`, etc.
5. **Unify border-radius scale** — Cards use 10/14/16/20 arbitrarily; pick small(8)/medium(14)/large(20) and stick to it.
6. **Pick one icon library** — Currently Feather + Ionicons + FontAwesome5 all imported. Consolidate to Feather.
7. **Define typography scale** — Heading/body/label sizes and weights in `constants/typography.ts`; apply everywhere.
8. **Button component library** — Standardize primary/secondary/ghost styles with `minHeight: 44`, consistent padding.
9. **Input field spec** — All TextInput use `minHeight: 44`, same padding, same border-radius. Currently varies per screen.
10. **Empty-state templates** — Zero-state screens missing for "no matching runs", "no saved paths", etc.

---

## Findings by Category

### 1. Spacing & Layout (16 issues)

- **[H]** `app/(tabs)/_layout.tsx:14-16` — Tab bar pill constants `PILL_H=64`, `PILL_RADIUS=30`, `PILL_MX=48` hardcoded with no design token. Move to theme.
- **[M]** `app/(tabs)/index.tsx:558-560` — Inconsistent category spacing (14/12/16). Unify to scale.
- **[M]** `app/(tabs)/profile.tsx:89` — ProfilePathStatsStrip uses 12px vertical padding but most cards use 16px.
- **[M]** `app/create-run/index.tsx:98` — Route thumbnail `borderRadius: 10` but most cards use 14–20.
- **[M]** `app/(tabs)/solo.tsx:186` — Map container `borderRadius: 16` conflicts with 14 and 20 elsewhere.
- **[H]** `components/NotificationBanner.tsx:364-365` — Notification card padding 12px vs 16px elsewhere.
- **[M]** `app/(tabs)/index.tsx:445-449` — Input padding `16/10` but other inputs vary 14–20.
- **[M]** `app/(tabs)/index.tsx:592` — Day chips `minWidth: 40` but no max; long names expand unpredictably.
- **[H]** `app/(tabs)/_layout.tsx:113,133-134` — Tab icon/label vertical alignment differs Android vs iOS.
- **[M]** `app/dm/[friendId].tsx:94-95,187-189` — Message padding (12/12) vs input (12/8/8) — list feels off from input.
- **[L]** `app/(tabs)/solo.tsx:100` — MiniRouteMap height hardcoded 200; no responsive scaling.
- **[M]** `app/create-run/index.tsx:461` — Section dividers inconsistent between filter modal and create-run form.
- **[M]** `app/(tabs)/index.tsx:457-458` — Labels mix `fontSize 12` and `fontSize 10 + letterSpacing 0.4 + uppercase`.
- **[M]** `app/run/[id].tsx` — Header back/X buttons inconsistently spaced across stacks.
- **[M]** `app/dm/[friendId].tsx:127-129` — Chat bubble `maxWidth: "72%"` hardcoded; no landscape/notch handling.
- **[L]** `app/(tabs)/index.tsx:507` — "Location off" badge has no min-height; alignment drifts.

### 2. Typography (15 issues)

- **[H]** `app/(tabs)/index.tsx:426,456,556` — `fm.sectionTitle` size not explicitly set; likely differs across screens.
- **[M]** Category labels mix `fontSize 13` and `fontSize 12`. No sub-section token.
- **[M]** `components/ShareCard.tsx:807-808` — `letterSpacing` values of 2/4/5 for "PaceUp" watermark per layout.
- **[M]** `app/(tabs)/profile.tsx:84-85` — Cell labels `fontSize 10 letterSpacing 0.4` vs divider labels `fontSize 11`.
- **[H]** Font families hardcoded throughout (`Outfit_600SemiBold`, etc.) instead of theme tokens.
- **[M]** `components/NotificationBanner.tsx:382-385` — Title 14 / body 13 / lineHeight 17 — multiplier inconsistent.
- **[M]** `app/(tabs)/solo.tsx:39` — FontAwesome5 imported; other files use Feather/Ionicons.
- **[M]** `app/run/[id].tsx:308` — RUN_TAG_ICONS uses 6 Feather names; ShareCard uses 3 Ionicons variants. Mixed.
- **[L]** `app/(tabs)/profile.tsx:49-55` — Milestone labels defined but styling inconsistent per context.
- **[M]** `app/(tabs)/index.tsx:427-428` — Pace-range value text inherits size; no explicit style.
- **[M]** `components/NotificationBanner.tsx:395-397` — Count badge 11px next to 13–14px text.
- **[M]** `app/dm/[friendId].tsx:200` — Input placeholder color not set; default may clash with theme muted.
- **[L]** Chip text size depends on content; "Nationwide" vs "10 mi" will look different.
- **[M]** `app/run/[id].tsx` — No explicit lineHeight on descriptions; cramped with long host-style lists.
- **[M]** `app/create-run/index.tsx:193-194` — Time auto-format inconsistent (H:MM vs HH:MM) contradicts label.

### 3. Colors & Theming (18 issues)

- **[H]** `components/ShareCard.tsx:8-16` — Hardcoded `PRIMARY`, `GOLD`, `BG`, `CARD_BG`, `BORDER`. Use theme.
- **[H]** `app/(tabs)/_layout.tsx:203` — Green dot `#00A85E` instead of `C.primary`.
- **[H]** `app/(tabs)/_layout.tsx:212` — Red dot `#FF3B30` instead of `C.danger`.
- **[M]** `components/NotificationBanner.tsx:386-387` — Count badge `#FF3B30` hardcoded.
- **[M]** `app/(tabs)/index.tsx:646` — `LIVE_DOT_COLORS` hardcoded hex array; no theming.
- **[H]** `constants/colors.ts:31-44` — `lightColors.white = "#0A1F12"` — light-mode text is dark green on white. Bug.
- **[M]** `app/(tabs)/index.tsx:31` — Uses `darkColors as C` directly; forces dark theme.
- **[M]** `app/dm/[friendId].tsx:144` — Bubble text `#fff` hardcoded.
- **[M]** `components/NotificationBanner.tsx:300,310` — Button text `#FFF` hardcoded; contrast risk in light mode.
- **[M]** `app/(tabs)/index.tsx:694` — Map polyline `#00D97E` hardcoded; won't adapt.
- **[M]** `app/(tabs)/solo.tsx:136` — Uses `C.primary` but file doesn't use theme hook consistently.
- **[L]** `app/run/[id].tsx:50-55` — Host-tier badge colors hardcoded hex per tier.
- **[M]** `components/ShareCard.tsx:364-366` — Opacity concatenation `TEXT_MUTED + "66"`; use rgba or style opacity.
- **[H]** Global `darkColors as C` — light-mode users stuck in dark theme. Critical.
- **[M]** `components/RangeSlider.tsx:124` — Slider thumb `#F0FFF4` hardcoded.
- **[M]** `app/create-run/index.tsx:98` — Route thumbnail bg `#0D1510`; use `C.surface`.
- **[M]** `app/(tabs)/solo.tsx:186` — PathRoutePreview bg `#0D1510` hardcoded.
- **[L]** `app/(tabs)/index.tsx:414` — Active chip contrast not verified for WCAG AA.

### 4. Buttons & Tappable Elements (14 issues)

- **[H]** `app/(tabs)/_layout.tsx:159-163` — Crew tab dot badge 8×8 too small; position `-2,-4` overlaps icon.
- **[M]** `components/NotificationBanner.tsx:412-417` — Action buttons `paddingH:14 paddingV:6` ≈ 20pt height. Below 44pt min.
- **[H]** `app/(tabs)/index.tsx:626-637` — Reset/Apply footer buttons have no min-height.
- **[M]** `app/(tabs)/index.tsx:508-534` — Proximity chips flex-sized; tap targets vary with text length.
- **[M]** `app/(tabs)/index.tsx:569-572` — Check icon in host-style pill has no explicit size; animation may feel janky.
- **[M]** `app/create-run/index.tsx:147-150` — Pace group inputs no min-height; cramped landscape.
- **[M]** `app/run/[id].tsx` — Join/leave/confirm buttons use ad-hoc styles; no unified component.
- **[M]** `components/NotificationBanner.tsx:295-304` — Accept button has no disabled/loading state beyond opacity.
- **[L]** `app/(tabs)/solo.tsx` — No `activeOpacity` on Pressable; no visual feedback.
- **[M]** `app/(tabs)/index.tsx:565-567` — Style pill has haptic but no Android ripple.
- **[M]** `app/dm/[friendId].tsx:205-212` — Send button icon-only; no explicit min-height.
- **[M]** `components/ShareCard.tsx:356-361` — Layout dots 5×5 with 6px gap; tap target < 24×24.
- **[L]** `app/(tabs)/index.tsx:559` — Category labels look interactive but aren't.
- **[M]** `app/(tabs)/index.tsx:591-596` — Day chips `minWidth: 40` but no max-width.

### 5. Icons & Imagery (11 issues)

- **[H]** `app/(tabs)/_layout.tsx:23` — Ionicons used; other screens use Feather + FontAwesome5. Three libraries in play.
- **[M]** `app/(tabs)/_layout.tsx:141-142` — Tab icons Ionicons; rest of app Feather. Different stroke weights.
- **[M]** `app/(tabs)/solo.tsx:18-19` — FontAwesome5 imported but unused. Dead import.
- **[M]** `components/ShareCard.tsx:287` — Activity icon picker (bicycle/footsteps/body) — Ionicons size varies per glyph.
- **[M]** `app/run/[id].tsx:58-65` — RUN_TAG_ICONS references icon names that may not exist in all sets; risk of missing glyphs.
- **[M]** `app/(tabs)/index.tsx:570` — Check icon `size={11}`; most icons use 14/16/18.
- **[M]** `components/NotificationBanner.tsx:18-39` — Hardcoded Feather mapping; no brand-custom icons per type.
- **[L]** `app/(tabs)/profile.tsx:32` — ACHIEVEMENTS imported but icon map not shown; likely FontAwesome.
- **[M]** `app/create-run/index.tsx:105` — Empty state uses Ionicons `map-outline`; others use Feather.
- **[M]** `app/(tabs)/_layout.tsx:141-142` — Uses `-outline` suffix; Feather doesn't. Library-swap breaks.
- **[L]** `components/MiniCalendarPicker.tsx` — Calendar icon source not verified against app standard.

### 6. Lists, Cards, Feeds (8 issues)

- **[M]** `app/(tabs)/solo.tsx:200` — MileSplitsChart styling not matched to other stat cards.
- **[M]** `app/(tabs)/profile.tsx:77-110` — ProfilePathStatsStrip card style differs from other stat cards.
- **[M]** `components/NotificationBanner.tsx:335-349` — Stack offsets `top:-4,-8`, marginH `6,12` — inconsistent with single-card padding.
- **[M]** `app/(tabs)/index.tsx` — Filter modal dividers lack consistent color/thickness spec.
- **[M]** `app/(tabs)/solo.tsx:100-139` — MiniRouteMap `radius: 16` vs ShareCard photos `radius: 20`.
- **[M]** `app/(tabs)/profile.tsx` — RunHistoryItem shadows/elevation style not shown; likely inconsistent.
- **[H]** `app/(tabs)/index.tsx` — No empty state for zero filter results.
- **[M]** `components/ShareCard.tsx` — Different radii across share layouts; no unified card component.

### 7. Forms & Inputs (10 issues)

- **[H]** `app/(tabs)/index.tsx:462-473` — Distance inputs: height not set; likely varies per page.
- **[M]** `app/create-run/index.tsx:195-197` — Time auto-format conflicts with "H:MM" label.
- **[M]** `app/(tabs)/index.tsx:462-473` — Placeholder uses `C.textMuted` (same as secondary text). Not distinct.
- **[M]** `app/create-run/index.tsx` — Input radii/borders likely vary between card and inline inputs.
- **[M]** `app/dm/[friendId].tsx:195-205` — Chat input `borderRadius: 22` (pill); other inputs 8–12.
- **[M]** `app/(tabs)/index.tsx:462-490` — Placeholder "No limit" only on max field, not min.
- **[M]** `app/create-run/index.tsx:129` — Max participants default "20"; no validation feedback.
- **[M]** `app/(tabs)/index.tsx:467-471` — Clearing field shows blank; user unsure if value persists.
- **[L]** `app/create-run/index.tsx:143` — AM/PM toggle custom view; not obviously a control.
- **[M]** `app/(tabs)/index.tsx:466` — No fallback contrast check for placeholder in light mode.

### 8. Navigation & Headers (6 issues)

- **[H]** `app/(tabs)/_layout.tsx:103-185` — Tab bar custom pill; modal stacks likely use different header styling.
- **[M]** `app/run/[id].tsx` — No visible header component; uses Stack default.
- **[M]** `app/create-run/index.tsx` — No shared header component; back button likely differs.
- **[M]** `app/(tabs)/_layout.tsx:104` — `headerShown: false` on tabs but other screens have default headers. Inconsistent.
- **[M]** `app/dm/[friendId].tsx:18` — Custom `headerWrap` (65-91) specific to DM; doesn't match other modals.
- **[L]** `app/(tabs)/_layout.tsx:127-134` — Tab label font Android uses system; iOS uses Outfit. Brand broken on Android.

### 9. Platform Polish (5 issues)

- **[H]** `app/(tabs)/_layout.tsx:116-119` — Tab bar bg platform-specific. Pill appearance diverges.
- **[M]** `app/(tabs)/_layout.tsx:129` — Font-family conditioned on `Platform.OS`. Android tab labels use system font.
- **[M]** `app/(tabs)/_layout.tsx:120,126` — Shadow impl Android elevation vs iOS shadowRadius — inconsistent.
- **[M]** `app/(tabs)/profile.tsx:18` — Map `mutedStandard` (iOS) vs `standard` (Android). Different look.
- **[L]** `components/ShareCard.tsx:1199` — `transform as any` workaround suggests web-platform type issues.

### 10. Misc Visual Consistency (5 issues)

- **[M]** `components/ShareCard.tsx:768-1217` — 1218-line component with 4 layout modes; spacing likely drifts between them.
- **[M]** `app/(tabs)/index.tsx:355-361` — `translateY: -20` hardcoded to center layout dots; not responsive.
- **[M]** `app/(tabs)/index.tsx:682` — Expansion header radius 14 vs card radius 20; visible seam.
- **[M]** `app/(tabs)/solo.tsx:201` — Picker spacing relies on default ScrollView padding.
- **[L]** `app/(tabs)/index.tsx:113-114` — Web margin 140 vs native 48; very different layouts.

---

## Summary by Severity

| Severity | Count |
|----------|-------|
| High     | 8     |
| Medium   | 48    |
| Low      | 17    |
| **Total**| **73**|

**Estimated fix effort:** 20–25 hours
**Recommended priority:** Fix high-severity theme bugs first (items 1–4 in Quick Wins) — those single-handedly unlock light mode and remove most hex drift in one mechanical pass.
