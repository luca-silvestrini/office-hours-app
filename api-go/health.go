// Package handler is the entrypoint package for every Vercel Go serverless
// function in this directory. Each *.go file that exports `Handler` becomes a
// route:  api-go/health.go  ->  GET /api-go/health
package handler

import (
	"encoding/json"
	"net/http"
	"time"
)

// Handler is a liveness probe used to confirm the Go build + routing pipeline is
// wired up on Vercel. Real functions (geolocation check-in, cron reminders) land
// in sibling files.
func Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":      true,
		"service": "office-hours-go",
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}
