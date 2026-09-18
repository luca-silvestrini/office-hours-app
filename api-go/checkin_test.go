package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"office-hours/api-go/geo"
)

// fakeSupabase stands in for the three Supabase endpoints checkin.go calls:
// GET /auth/v1/user, GET /rest/v1/office_hours_slots, POST /rest/v1/check_ins.
// The handler reads its base URL from NEXT_PUBLIC_SUPABASE_URL, so pointing
// that env var at this test server is what lets checkin.go run against it.
// alreadyCheckedIn lists slot ids that should look already-checked-in (409
// path), simulating a per-slot 23505 unique violation.
func fakeSupabase(t *testing.T, slots []slotRow, authUserID string, alreadyCheckedIn map[string]bool) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()

	mux.HandleFunc("/auth/v1/user", func(w http.ResponseWriter, r *http.Request) {
		if authUserID == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"id": authUserID})
	})

	mux.HandleFunc("/rest/v1/office_hours_slots", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(slots)
	})

	mux.HandleFunc("/rest/v1/check_ins", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		slotID, _ := body["slot_id"].(string)

		if alreadyCheckedIn[slotID] {
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"code":"23505","message":"duplicate key value violates unique constraint"}`))
			return
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode([]checkInRow{{
			ID:     "check-in-" + slotID,
			SlotID: slotID,
			UserID: authUserID,
			Method: "geolocation",
		}})
	})

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	t.Setenv("NEXT_PUBLIC_SUPABASE_URL", srv.URL)
	t.Setenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key")
	t.Setenv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
	return srv
}

const (
	testUserID    = "11111111-1111-1111-1111-111111111111"
	testOtherUser = "22222222-2222-2222-2222-222222222222"
	testSlotID    = "33333333-3333-3333-3333-333333333333"
	testSlotID2   = "44444444-4444-4444-4444-444444444444"

	// Near ASU's Tempe campus — well within CheckInRadiusMiles of the default
	// office coordinates used elsewhere is not required; these tests set the
	// office location explicitly via OFFICE_LATITUDE/OFFICE_LONGITUDE so the
	// "near" and "far" cases are unambiguous regardless of the real default.
	officeLat = 33.4242
	officeLon = -111.9281
)

func currentSlot(t *testing.T) slotRow {
	t.Helper()
	now := time.Now().UTC()
	return slotRow{
		ID:        testSlotID,
		UserID:    testUserID,
		StartTime: now.Add(-5 * time.Minute).Format(time.RFC3339),
		EndTime:   now.Add(55 * time.Minute).Format(time.RFC3339),
	}
}

// backToBackSlots returns the current slot plus a second one immediately
// following it — the shape a "repeat weekly" or one-off pair of adjacent
// claims would have.
func backToBackSlots(t *testing.T) []slotRow {
	t.Helper()
	first := currentSlot(t)
	firstEnd, err := time.Parse(time.RFC3339, first.EndTime)
	if err != nil {
		t.Fatalf("parse first end: %v", err)
	}
	second := slotRow{
		ID:        testSlotID2,
		UserID:    testUserID,
		StartTime: first.EndTime,
		EndTime:   firstEnd.Add(time.Hour).Format(time.RFC3339),
	}
	return []slotRow{first, second}
}

func doCheckInRequest(t *testing.T, body map[string]any, bearer string) *httptest.ResponseRecorder {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api-go/checkin", strings.NewReader(string(payload)))
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	rec := httptest.NewRecorder()
	Handler(rec, req)
	return rec
}

func TestCheckIn_HappyPath(t *testing.T) {
	t.Setenv("OFFICE_LATITUDE", "33.4242")
	t.Setenv("OFFICE_LONGITUDE", "-111.9281")
	fakeSupabase(t, []slotRow{currentSlot(t)}, testUserID, nil)

	rec := doCheckInRequest(t, map[string]any{
		"slot_ids": []string{testSlotID}, "latitude": officeLat, "longitude": officeLon,
	}, "valid-token")

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var got struct {
		CheckIns []checkInRow `json:"check_ins"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(got.CheckIns) != 1 || got.CheckIns[0].SlotID != testSlotID {
		t.Errorf("expected one check-in for slot %s, got %+v", testSlotID, got.CheckIns)
	}
}

func TestCheckIn_BackToBack_BothCredited(t *testing.T) {
	t.Setenv("OFFICE_LATITUDE", "33.4242")
	t.Setenv("OFFICE_LONGITUDE", "-111.9281")
	fakeSupabase(t, backToBackSlots(t), testUserID, nil)

	rec := doCheckInRequest(t, map[string]any{
		"slot_ids": []string{testSlotID, testSlotID2}, "latitude": officeLat, "longitude": officeLon,
	}, "valid-token")

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var got struct {
		CheckIns []checkInRow `json:"check_ins"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(got.CheckIns) != 2 {
		t.Fatalf("expected both slots credited from one check-in, got %+v", got.CheckIns)
	}
}

func TestCheckIn_BackToBack_PartialDuplicate(t *testing.T) {
	t.Setenv("OFFICE_LATITUDE", "33.4242")
	t.Setenv("OFFICE_LONGITUDE", "-111.9281")
	fakeSupabase(t, backToBackSlots(t), testUserID, map[string]bool{testSlotID: true})

	rec := doCheckInRequest(t, map[string]any{
		"slot_ids": []string{testSlotID, testSlotID2}, "latitude": officeLat, "longitude": officeLon,
	}, "valid-token")

	// One of the two was already checked in — that's not fatal as long as the
	// other one succeeds.
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 (partial success), got %d: %s", rec.Code, rec.Body.String())
	}
	var got struct {
		CheckIns []checkInRow `json:"check_ins"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if len(got.CheckIns) != 1 || got.CheckIns[0].SlotID != testSlotID2 {
		t.Fatalf("expected only the not-yet-checked-in slot credited, got %+v", got.CheckIns)
	}
}

func TestCheckIn_TooManySlotIDs(t *testing.T) {
	fakeSupabase(t, backToBackSlots(t), testUserID, nil)
	rec := doCheckInRequest(t, map[string]any{
		"slot_ids": []string{testSlotID, testSlotID2, "55555555-5555-5555-5555-555555555555"},
		"latitude": officeLat, "longitude": officeLon,
	}, "valid-token")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for more than 2 slot_ids, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCheckIn_MissingBearerToken(t *testing.T) {
	fakeSupabase(t, []slotRow{currentSlot(t)}, testUserID, nil)

	rec := doCheckInRequest(t, map[string]any{
		"slot_ids": []string{testSlotID}, "latitude": officeLat, "longitude": officeLon,
	}, "")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCheckIn_InvalidToken(t *testing.T) {
	fakeSupabase(t, []slotRow{currentSlot(t)}, "", nil)

	rec := doCheckInRequest(t, map[string]any{
		"slot_ids": []string{testSlotID}, "latitude": officeLat, "longitude": officeLon,
	}, "expired-token")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCheckIn_WrongOwner(t *testing.T) {
	t.Setenv("OFFICE_LATITUDE", "33.4242")
	t.Setenv("OFFICE_LONGITUDE", "-111.9281")
	slot := currentSlot(t)
	slot.UserID = testOtherUser
	fakeSupabase(t, []slotRow{slot}, testUserID, nil)

	rec := doCheckInRequest(t, map[string]any{
		"slot_ids": []string{testSlotID}, "latitude": officeLat, "longitude": officeLon,
	}, "valid-token")

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCheckIn_TooFarAway(t *testing.T) {
	t.Setenv("OFFICE_LATITUDE", "33.4242")
	t.Setenv("OFFICE_LONGITUDE", "-111.9281")
	fakeSupabase(t, []slotRow{currentSlot(t)}, testUserID, nil)

	// New York City — nowhere near the Tempe office coordinates above.
	rec := doCheckInRequest(t, map[string]any{
		"slot_ids": []string{testSlotID}, "latitude": 40.7128, "longitude": -74.0060,
	}, "valid-token")

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if _, ok := body["distance_miles"]; !ok {
		t.Errorf("expected distance_miles in response, got %v", body)
	}
}

func TestCheckIn_OutsideTimeWindow(t *testing.T) {
	t.Setenv("OFFICE_LATITUDE", "33.4242")
	t.Setenv("OFFICE_LONGITUDE", "-111.9281")
	future := time.Now().UTC().Add(3 * time.Hour)
	slot := slotRow{
		ID:        testSlotID,
		UserID:    testUserID,
		StartTime: future.Format(time.RFC3339),
		EndTime:   future.Add(time.Hour).Format(time.RFC3339),
	}
	fakeSupabase(t, []slotRow{slot}, testUserID, nil)

	rec := doCheckInRequest(t, map[string]any{
		"slot_ids": []string{testSlotID}, "latitude": officeLat, "longitude": officeLon,
	}, "valid-token")

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCheckIn_AlreadyCheckedIn(t *testing.T) {
	t.Setenv("OFFICE_LATITUDE", "33.4242")
	t.Setenv("OFFICE_LONGITUDE", "-111.9281")
	fakeSupabase(t, []slotRow{currentSlot(t)}, testUserID, map[string]bool{testSlotID: true})

	rec := doCheckInRequest(t, map[string]any{
		"slot_ids": []string{testSlotID}, "latitude": officeLat, "longitude": officeLon,
	}, "valid-token")

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCheckIn_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api-go/checkin", nil)
	rec := httptest.NewRecorder()
	Handler(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rec.Code)
	}
}

func TestCheckIn_InvalidCoordinates(t *testing.T) {
	fakeSupabase(t, []slotRow{currentSlot(t)}, testUserID, nil)
	rec := doCheckInRequest(t, map[string]any{
		"slot_ids": []string{testSlotID}, "latitude": 200.0, "longitude": 0.0,
	}, "valid-token")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// Sanity check that the geo package (used directly by checkin.go) computes
// what these tests assume: Tempe to Tempe is near, Tempe to NYC is far.
func TestGeoSanityForFixtures(t *testing.T) {
	t.Setenv("OFFICE_LATITUDE", "33.4242")
	t.Setenv("OFFICE_LONGITUDE", "-111.9281")
	if ok, d := geo.WithinOfficeRadius(officeLat, officeLon); !ok {
		t.Fatalf("expected office coordinates to be within radius, distance=%f", d)
	}
	if ok, _ := geo.WithinOfficeRadius(40.7128, -74.0060); ok {
		t.Fatalf("expected NYC to be outside radius")
	}
}
