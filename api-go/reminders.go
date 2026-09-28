// Package handler implements GET /api-go/reminders — see health.go for the
// per-file routing convention this directory uses. This file is self-contained
// (duplicates the small Supabase REST helpers also found in checkin.go)
// because Vercel's Go builder compiles each listed file in its own isolated
// sandbox — see the vercel.json / README notes on why shared code between
// functions has to live in an importable package (geo/), not a sibling file.
//
// Triggered once a day by Vercel Cron (see vercel.json's `crons` entry) —
// deliberately daily, not tied to each slot's own check-in window opening,
// so it works on Vercel's Hobby plan (which only allows daily cron
// schedules; per-minute schedules need Pro). Each run sends one "here's your
// office hours today" digest email per user who has a claimed slot that day,
// rather than a per-slot ping right as its window opens. Vercel signs
// scheduled invocations with `Authorization: Bearer $CRON_SECRET`
// automatically, which is what authenticates this endpoint — there is no
// user session involved.
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

// checkInEarlyGraceMinutes mirrors the constant of the same name in
// checkin.go (and CHECK_IN_WINDOW_EARLY_MINUTES in src/lib/config.ts): the
// check-in window opens this many minutes before a slot's start_time. Only
// used here to tell the user when check-in opens, in the digest email's copy.
const checkInEarlyGraceMinutes = 10

// maxSlotsPerCheckIn mirrors the constant of the same name in checkin.go: a
// digest line item can cover at most this many back-to-back slots, because
// that's the most a single check-in call ever merges.
const maxSlotsPerCheckIn = 2

// officeTimeZone is where All Saints Catholic Newman Center (ASU, Tempe AZ)
// is located. Arizona does not observe DST, so a fixed IANA zone is safe
// year-round — no UTC-offset drift to account for. "Today" (which slots this
// digest covers) is computed in this zone, not UTC.
const officeTimeZone = "America/Phoenix"

var httpClient = &http.Client{Timeout: 10 * time.Second}

// resendAPIURL is a var (not a const) so tests can point it at a fake server.
var resendAPIURL = "https://api.resend.com/emails"

type reminderSlotRow struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
	Users     struct {
		Email string  `json:"email"`
		Name  *string `json:"name"`
	} `json:"users"`
}

// Handler implements GET /api-go/reminders.
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
	slots, err := fetchTodaysUnremindedSlots(ctx, time.Now().In(loc))
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("fetching today's slots failed: %v", err))
		return
	}

	sent, failed := 0, 0
	for _, userBlocks := range groupByUser(groupIntoChains(slots)) {
		if err := sendDigestEmail(userBlocks, loc); err != nil {
			failed++
			continue // one user's bad email shouldn't block the rest of the run
		}
		if err := markRemindersSent(ctx, slotIDs(flatten(userBlocks))); err != nil {
			failed++
			continue
		}
		sent++
	}

	writeJSON(w, http.StatusOK, map[string]any{"sent": sent, "failed": failed})
}

func isAuthorizedCronRequest(r *http.Request) bool {
	secret := os.Getenv("CRON_SECRET")
	return secret != "" && r.Header.Get("Authorization") == "Bearer "+secret
}

// fetchTodaysUnremindedSlots pulls every claimed, not-yet-reminded slot whose
// start_time falls within "today" in the office's time zone. Ordered by user
// then start_time so groupIntoChains can just walk the list once.
func fetchTodaysUnremindedSlots(ctx context.Context, now time.Time) ([]reminderSlotRow, error) {
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	endOfDay := startOfDay.AddDate(0, 0, 1)

	endpoint := fmt.Sprintf(
		"%s/rest/v1/office_hours_slots?select=id,user_id,start_time,end_time,users(email,name)"+
			"&status=eq.claimed&reminder_sent_at=is.null&start_time=gte.%s&start_time=lt.%s&order=user_id.asc,start_time.asc",
		supabaseURL(),
		url.QueryEscape(startOfDay.UTC().Format(time.RFC3339)),
		url.QueryEscape(endOfDay.UTC().Format(time.RFC3339)),
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

	var rows []reminderSlotRow
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// groupIntoChains merges consecutive rows for the same user into runs of
// back-to-back slots (next.start_time == current.end_time), capped at
// maxSlotsPerCheckIn — mirroring how checkin.go lets one check-in cover at
// most that many contiguous hours. Rows are assumed pre-sorted by
// (user_id, start_time), which the fetch query guarantees.
func groupIntoChains(rows []reminderSlotRow) [][]reminderSlotRow {
	var chains [][]reminderSlotRow
	var current []reminderSlotRow

	flush := func() {
		if len(current) > 0 {
			chains = append(chains, current)
			current = nil
		}
	}

	for _, row := range rows {
		if len(current) > 0 {
			prev := current[len(current)-1]
			contiguous := prev.UserID == row.UserID && prev.EndTime == row.StartTime
			if !contiguous || len(current) >= maxSlotsPerCheckIn {
				flush()
			}
		}
		current = append(current, row)
	}
	flush()

	return chains
}

// groupByUser buckets chains by user, so a user with two separate (non-back-
// to-back) slots the same day gets one digest email listing both, not two
// emails. Chains are assumed pre-sorted by user_id (groupIntoChains
// preserves the input's order), so same-user chains are always adjacent.
func groupByUser(chains [][]reminderSlotRow) [][][]reminderSlotRow {
	var users [][][]reminderSlotRow
	var current [][]reminderSlotRow

	flush := func() {
		if len(current) > 0 {
			users = append(users, current)
			current = nil
		}
	}

	for _, chain := range chains {
		if len(current) > 0 && current[0][0].UserID != chain[0].UserID {
			flush()
		}
		current = append(current, chain)
	}
	flush()

	return users
}

func flatten(blocks [][]reminderSlotRow) []reminderSlotRow {
	var rows []reminderSlotRow
	for _, block := range blocks {
		rows = append(rows, block...)
	}
	return rows
}

func slotIDs(rows []reminderSlotRow) []string {
	ids := make([]string, len(rows))
	for i, row := range rows {
		ids[i] = row.ID
	}
	return ids
}

func sendDigestEmail(blocks [][]reminderSlotRow, loc *time.Location) error {
	first := blocks[0][0]

	firstName := "there"
	if first.Users.Name != nil && strings.TrimSpace(*first.Users.Name) != "" {
		firstName = strings.Fields(*first.Users.Name)[0]
	}

	var items strings.Builder
	for _, block := range blocks {
		start := mustParseTime(block[0].StartTime).In(loc)
		end := mustParseTime(block[len(block)-1].EndTime).In(loc)
		checkInOpensAt := start.Add(-checkInEarlyGraceMinutes * time.Minute)
		fmt.Fprintf(&items,
			"<li><strong>%s–%s</strong> — check-in opens at %s</li>",
			start.Format("3:04 PM"), end.Format("3:04 PM MST"), checkInOpensAt.Format("3:04 PM"),
		)
	}

	day := mustParseTime(blocks[0][0].StartTime).In(loc).Format("Monday, Jan 2")
	subject := fmt.Sprintf("Office hours today: %s", day)
	html := fmt.Sprintf(
		"<p>Hi %s,</p><p>You have office hours today, %s:</p><ul>%s</ul>"+
			"<p>Head to the app to check in once you're at the office.</p>",
		firstName, day, items.String(),
	)

	payload, err := json.Marshal(map[string]any{
		"from":    os.Getenv("RESEND_FROM_EMAIL"),
		"to":      []string{first.Users.Email},
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

func markRemindersSent(ctx context.Context, ids []string) error {
	inList := "(" + strings.Join(ids, ",") + ")"
	endpoint := fmt.Sprintf("%s/rest/v1/office_hours_slots?id=in.%s", supabaseURL(), url.QueryEscape(inList))

	payload, err := json.Marshal(map[string]any{"reminder_sent_at": time.Now().UTC().Format(time.RFC3339)})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, endpoint, bytes.NewReader(payload))
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

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

func mustParseTime(value string) time.Time {
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}
	}
	return t
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
