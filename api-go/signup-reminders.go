// Package handler implements GET /api-go/signup-reminders — see health.go
// for the per-file routing convention this directory uses. This file is
// self-contained (duplicates the small Supabase REST helpers also found in
// checkin.go / reminders.go) because Vercel's Go builder compiles each
// listed file in its own isolated sandbox — see the vercel.json / README
// notes on why shared code between functions has to live in an importable
// package (geo/), not a sibling file.
//
// Triggered once a week, Monday morning, by Vercel Cron (see vercel.json's
// `crons` entry). Unlike reminders.go (which reminds people about office
// hours they've already claimed for today), this looks at the week already
// under way — Sunday through Saturday, matching src/lib/week.ts's
// startOfWeek — and emails anyone who hasn't claimed all
// MAX_SLOTS_PER_USER_PER_WEEK slots yet, so they still have the rest of the
// week to sign up. Vercel signs scheduled invocations with `Authorization:
// Bearer $CRON_SECRET` automatically, which is what authenticates this
// endpoint — there is no user session involved.
package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// maxSlotsPerUserPerWeek mirrors MAX_SLOTS_PER_USER_PER_WEEK in
// src/lib/config.ts — a person is expected to hold this many slots a week.
const maxSlotsPerUserPerWeek = 2

// officeTimeZone mirrors the constant of the same name in reminders.go: All
// Saints Catholic Newman Center (ASU, Tempe AZ) does not observe DST, so a
// fixed IANA zone is safe year-round. The week this run checks (Sun–Sat) is
// computed in this zone, not UTC.
const officeTimeZone = "America/Phoenix"

var httpClient = &http.Client{Timeout: 10 * time.Second}

// resendAPIURL is a var (not a const) so tests can point it at a fake server.
var resendAPIURL = "https://api.resend.com/emails"

type reminderUserRow struct {
	ID    string  `json:"id"`
	Email string  `json:"email"`
	Name  *string `json:"name"`
}

type claimedSlotUserRow struct {
	UserID string `json:"user_id"`
}

type signupReminderLogRow struct {
	UserID string `json:"user_id"`
}

// Handler implements GET /api-go/signup-reminders.
func Handler(w http.ResponseWriter, r *http.Request) {
	if !isAuthorizedCronRequest(r) {
		writeError(w, http.StatusUnauthorized, "missing or invalid cron secret")
		return
	}

	loc, err := time.LoadLocation(officeTimeZone)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("loading office time zone failed: %v", err))
		return
	}

	ctx := r.Context()
	weekStart := startOfWeek(time.Now().In(loc))
	weekEnd := weekStart.AddDate(0, 0, 7)

	users, err := fetchUsers(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("fetching users failed: %v", err))
		return
	}

	counts, err := fetchClaimedSlotCounts(ctx, weekStart, weekEnd)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("fetching this week's slots failed: %v", err))
		return
	}

	alreadySent, err := fetchAlreadySent(ctx, weekStart)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("fetching reminder log failed: %v", err))
		return
	}

	sent, failed, skipped := 0, 0, 0
	for _, user := range users {
		claimed := counts[user.ID]
		if claimed >= maxSlotsPerUserPerWeek || alreadySent[user.ID] {
			skipped++
			continue
		}

		if err := sendSignupReminderEmail(user, claimed, weekStart, loc); err != nil {
			failed++
			continue // one user's bad email shouldn't block the rest of the run
		}
		if err := markSignupReminderSent(ctx, user.ID, weekStart); err != nil {
			failed++
			continue
		}
		sent++
	}

	writeJSON(w, http.StatusOK, map[string]any{"sent": sent, "failed": failed, "skipped": skipped})
}

func isAuthorizedCronRequest(r *http.Request) bool {
	secret := os.Getenv("CRON_SECRET")
	return secret != "" && r.Header.Get("Authorization") == "Bearer "+secret
}

// startOfWeek mirrors src/lib/week.ts's startOfWeek: midnight on the most
// recent Sunday (Go's time.Weekday numbers Sunday as 0, same as
// JavaScript's Date.getDay()).
func startOfWeek(now time.Time) time.Time {
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	return midnight.AddDate(0, 0, -int(midnight.Weekday()))
}

func fetchUsers(ctx context.Context) ([]reminderUserRow, error) {
	endpoint := fmt.Sprintf("%s/rest/v1/users?select=id,email,name", supabaseURL())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	setServiceRoleHeaders(req)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}

	var rows []reminderUserRow
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// fetchClaimedSlotCounts returns, per user, how many slots they've claimed
// with start_time in [weekStart, weekEnd). A row in office_hours_slots
// exists only when claimed (see the table's design note in migration 0001),
// so no extra status filter is needed here.
func fetchClaimedSlotCounts(ctx context.Context, weekStart, weekEnd time.Time) (map[string]int, error) {
	endpoint := fmt.Sprintf(
		"%s/rest/v1/office_hours_slots?select=user_id&start_time=gte.%s&start_time=lt.%s",
		supabaseURL(),
		url.QueryEscape(weekStart.UTC().Format(time.RFC3339)),
		url.QueryEscape(weekEnd.UTC().Format(time.RFC3339)),
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	setServiceRoleHeaders(req)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}

	var rows []claimedSlotUserRow
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}

	counts := make(map[string]int, len(rows))
	for _, row := range rows {
		counts[row.UserID]++
	}
	return counts, nil
}

func fetchAlreadySent(ctx context.Context, weekStart time.Time) (map[string]bool, error) {
	endpoint := fmt.Sprintf(
		"%s/rest/v1/signup_reminder_log?select=user_id&week_start=eq.%s",
		supabaseURL(), weekStart.Format("2006-01-02"),
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	setServiceRoleHeaders(req)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}

	var rows []signupReminderLogRow
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}

	sent := make(map[string]bool, len(rows))
	for _, row := range rows {
		sent[row.UserID] = true
	}
	return sent, nil
}

func sendSignupReminderEmail(user reminderUserRow, claimed int, weekStart time.Time, loc *time.Location) error {
	firstName := "there"
	if user.Name != nil && strings.TrimSpace(*user.Name) != "" {
		firstName = strings.Fields(*user.Name)[0]
	}

	weekLabel := fmt.Sprintf("week of %s", weekStart.In(loc).Format("Jan 2"))

	var subject, bodyText string
	switch claimed {
	case 0:
		subject = "Reminder: sign up for office hours this week"
		bodyText = fmt.Sprintf(
			"You haven't signed up for any office hours slots for the %s yet. Please claim your %d slots for the week.",
			weekLabel, maxSlotsPerUserPerWeek,
		)
	default:
		remaining := maxSlotsPerUserPerWeek - claimed
		subject = "Reminder: you're missing an office hours slot this week"
		bodyText = fmt.Sprintf(
			"You've signed up for %d of your %d office hours slots for the %s. Please claim your remaining %d before the week is out.",
			claimed, maxSlotsPerUserPerWeek, weekLabel, remaining,
		)
	}

	siteURL := strings.TrimRight(os.Getenv("NEXT_PUBLIC_SITE_URL"), "/")
	html := fmt.Sprintf(
		`<div style="text-align:center;margin-bottom:24px;">`+
			`<img src="%s/brand/crest.png" alt="All Saints Catholic Newman Center crest" width="72" style="height:auto;">`+
			`</div>`+
			`<p>Hi %s,</p><p>%s</p>`+
			`<p><a href="%s" style="display:inline-block;padding:10px 20px;background:#7a1f2b;color:#fff;`+
			`text-decoration:none;border-radius:6px;">Sign up now</a></p>`+
			`<p style="margin-top:28px;color:#666;">— All Saints Catholic Newman Center at Arizona State University</p>`,
		siteURL, firstName, bodyText, siteURL,
	)

	payload, err := json.Marshal(map[string]any{
		"from":    os.Getenv("RESEND_FROM_EMAIL"),
		"to":      []string{user.Email},
		"subject": subject,
		"html":    html,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, resendAPIURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("RESEND_API_KEY"))
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("resend send failed: %d %s", resp.StatusCode, string(body))
	}
	return nil
}

// markSignupReminderSent logs that this user has been reminded for this
// week, so a later cron run this same week (a manual re-trigger, say) won't
// email them twice. A unique-violation response means another concurrent
// run already logged it — not an error, just already handled.
func markSignupReminderSent(ctx context.Context, userID string, weekStart time.Time) error {
	endpoint := fmt.Sprintf("%s/rest/v1/signup_reminder_log", supabaseURL())

	payload, err := json.Marshal(map[string]any{
		"user_id":    userID,
		"week_start": weekStart.Format("2006-01-02"),
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	setServiceRoleHeaders(req)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if resp.StatusCode == http.StatusConflict || strings.Contains(string(body), "23505") {
		return nil
	}
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

func setServiceRoleHeaders(req *http.Request) {
	key := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	req.Header.Set("apikey", key)
	req.Header.Set("Authorization", "Bearer "+key)
}

func supabaseURL() string {
	return strings.TrimRight(os.Getenv("NEXT_PUBLIC_SUPABASE_URL"), "/")
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
