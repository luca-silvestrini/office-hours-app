// Package handler implements POST /api-go/checkin — see health.go for the
// per-file routing convention this directory uses.
//
// This function verifies a caller's identity by forwarding their bearer token
// to Supabase's own GET /auth/v1/user, rather than verifying the JWT locally.
// This project's tokens are signed with Supabase's newer asymmetric (ES256)
// signing keys, so local verification would mean fetching and caching a JWKS
// — one extra HTTP round-trip here is simpler and needs zero new
// dependencies (this module has none today; see go.mod).
package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"office-hours/api-go/geo"
)

// checkInEarlyGraceMinutes mirrors CHECK_IN_WINDOW_EARLY_MINUTES in
// src/lib/config.ts. Kept as an independent constant deliberately: the
// frontend copy only decides whether to *show* the check-in button; this one
// is the actual source of truth enforced server-side.
const checkInEarlyGraceMinutes = 10

var httpClient = &http.Client{Timeout: 10 * time.Second}

var errDuplicateCheckIn = errors.New("duplicate check-in")

type checkInRequest struct {
	SlotID    string  `json:"slot_id"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type slotRow struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
}

type checkInRow struct {
	ID            string  `json:"id"`
	SlotID        string  `json:"slot_id"`
	UserID        string  `json:"user_id"`
	Method        string  `json:"method"`
	Latitude      float64 `json:"latitude"`
	Longitude     float64 `json:"longitude"`
	DistanceMiles float64 `json:"distance_miles"`
}

// Handler implements POST /api-go/checkin.
func Handler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "missing bearer token")
		return
	}

	var req checkInRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.SlotID == "" || req.Latitude < -90 || req.Latitude > 90 || req.Longitude < -180 || req.Longitude > 180 {
		writeError(w, http.StatusBadRequest, "invalid slot_id or coordinates")
		return
	}

	userID, err := authenticatedUserID(r.Context(), token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid or expired session")
		return
	}

	withinRadius, distance := geo.WithinOfficeRadius(req.Latitude, req.Longitude)
	if !withinRadius {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"error":          "too far from the office to check in",
			"distance_miles": distance,
		})
		return
	}

	slot, err := fetchSlot(r.Context(), req.SlotID)
	if err != nil {
		writeError(w, http.StatusNotFound, "slot not found")
		return
	}
	if slot.UserID != userID {
		writeError(w, http.StatusForbidden, "that slot isn't yours")
		return
	}

	start, errStart := time.Parse(time.RFC3339, slot.StartTime)
	end, errEnd := time.Parse(time.RFC3339, slot.EndTime)
	if errStart != nil || errEnd != nil {
		writeError(w, http.StatusInternalServerError, "malformed slot time")
		return
	}
	now := time.Now().UTC()
	windowOpensAt := start.Add(-checkInEarlyGraceMinutes * time.Minute)
	if now.Before(windowOpensAt) || now.After(end) {
		writeError(w, http.StatusBadRequest, "check-in window is not open for this slot")
		return
	}

	created, err := insertCheckIn(r.Context(), req.SlotID, userID, req.Latitude, req.Longitude, distance)
	if err != nil {
		if errors.Is(err, errDuplicateCheckIn) {
			writeError(w, http.StatusConflict, "already checked in for this slot")
			return
		}
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, created)
}

func bearerToken(r *http.Request) string {
	const prefix = "Bearer "
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, prefix) {
		return ""
	}
	return strings.TrimPrefix(auth, prefix)
}

func authenticatedUserID(ctx context.Context, token string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, supabaseURL()+"/auth/v1/user", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("apikey", os.Getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY"))

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("auth check failed: %d", resp.StatusCode)
	}

	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil || body.ID == "" {
		return "", fmt.Errorf("unexpected auth response")
	}
	return body.ID, nil
}

func fetchSlot(ctx context.Context, slotID string) (*slotRow, error) {
	endpoint := fmt.Sprintf(
		"%s/rest/v1/office_hours_slots?id=eq.%s&select=id,user_id,start_time,end_time",
		supabaseURL(), url.QueryEscape(slotID),
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
		return nil, fmt.Errorf("slot lookup failed: %d", resp.StatusCode)
	}

	var rows []slotRow
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("slot not found")
	}
	return &rows[0], nil
}

func insertCheckIn(ctx context.Context, slotID, userID string, lat, lon, distance float64) (*checkInRow, error) {
	payload, err := json.Marshal(map[string]any{
		"slot_id":        slotID,
		"user_id":        userID,
		"method":         "geolocation",
		"latitude":       lat,
		"longitude":      lon,
		"distance_miles": distance,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, supabaseURL()+"/rest/v1/check_ins", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	setServiceRoleHeaders(req)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == http.StatusConflict || strings.Contains(string(body), "23505") {
		return nil, errDuplicateCheckIn
	}
	if resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("insert failed: %d %s", resp.StatusCode, string(body))
	}

	var rows []checkInRow
	if err := json.Unmarshal(body, &rows); err != nil || len(rows) == 0 {
		return nil, fmt.Errorf("unexpected insert response")
	}
	return &rows[0], nil
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
